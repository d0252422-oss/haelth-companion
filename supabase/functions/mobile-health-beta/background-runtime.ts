// Existing connector payloads and device grants. No Web context or privileged fallback.
import { shortcutRecordToMutation, validateMutation } from "./index.ts";
import { sameCanonicalUserId } from "./canonical-user-id.ts";
import { readManualRequest } from "./manual-request-body.ts";
import { scopedWorkerSql } from "./worker-sql-context.ts";
import { LocalEngineRuntime } from "./local-engine-runtime.ts";
const sha = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ).map((x) => x.toString(16).padStart(2, "0")).join("");
const result = (status: number, data: any) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });
export function createDelegatedIngestion(raw: any) {
  const sql = scopedWorkerSql(raw, "health_native_ingest");
  return {
    sql,
    async handle(request: Request) {
      try {
        if (request.method !== "POST") {
          return result(405, {
            error: "METHOD_NOT_ALLOWED",
          });
        }
        const path = new URL(request.url).pathname,
          shortcut = path.endsWith("/v1/connectors/ios-shortcut/ingest");
        const session = request.headers.get(
            shortcut ? "x-shortcut-session-id" : "x-app-session-id",
          ) || "",
          auth = request.headers.get("authorization") || "";
        if (!auth.startsWith("Bearer ") || auth.length < 16) {
          return result(
            401,
            { error: "INVALID_SESSION" },
          );
        }
        const body = await readManualRequest(request);
        return await sql.withSession({
          kind: shortcut ? "shortcut" : "app",
          session,
          digest: await sha(auth.slice(7)),
        }, () =>
          sql.begin(async (tx: any) => {
            const [identity] =
              await tx`select private.delegated_worker_user() as id,private.delegated_worker_platform() as platform`;
            if (!identity?.id) throw Error("INVALID_WORKER_SESSION");
            const statusRequest = path.endsWith("/v1/mobile/connectors/status");
            if (
              body.environment !== "beta" &&
              !(statusRequest && body.environment === undefined)
            ) throw Error("WRONG_ENVIRONMENT");
            if (!sameCanonicalUserId(body.canonical_user_id, identity.id)) {
              throw Error("CROSS_USER_UPLOAD");
            }
            if (statusRequest) {
              if (body.platform !== identity.platform) {
                throw Error("PLATFORM_MISMATCH");
              }
              const lastResult = String(body.last_result || "UNKNOWN");
              const successful = [
                "SYNCED",
                "SYNCED_RECENT",
                "SYNCED_PARTIAL",
                "NO_DATA",
              ].includes(lastResult);
              const attempted = body.last_attempt_at ||
                new Date().toISOString();
              await tx`select pg_advisory_xact_lock(hashtextextended(${identity.id},0))`;
              const [previous] = await tx`select last_success_at from public.beta_connector_status where canonical_user_id=${identity.id} and platform=${identity.platform}`;
              await tx`select public.beta_report_connector_status(${identity.id},${body.platform},${body.connector_type},${body.connector_version},${attempted},${
                body.last_success_at || (successful ? attempted : previous?.last_success_at ?? null)
              },${lastResult},${
                Array.isArray(body.available_domains)
                  ? body.available_domains
                  : []
              },${body.permission_state_if_known || "UNKNOWN"})`;
              return result(200, {
                status: "RECORDED",
                score_recompute: successful ? "QUEUED" : "NOT_QUEUED",
              });
            }
            let mutations: any[];
            if (shortcut) {
              if (
                body.schema_version !== "hdl-v2.connector-ingestion.v1" ||
                body.provider !== "apple_health" ||
                body.connector_type !== "ios_shortcut"
              ) throw Error("SCHEMA_VERSION_MISMATCH");
              if (
                !Number.isFinite(Date.parse(String(body.sync_window_start))) ||
                !Number.isFinite(Date.parse(String(body.sync_window_end)))
              ) throw Error("BAD_SYNC_WINDOW");
              if (!Array.isArray(body.records) || body.records.length > 250) {
                throw Error("INVALID_BATCH");
              }
              mutations = await Promise.all(
                body.records.map((record: any) =>
                  shortcutRecordToMutation(record, identity.id)
                ),
              );
              mutations = mutations.map((m) => ({
                ...m,
                canonical_user_id: identity.id,
                platform: "ios",
              }));
            } else {
              if (
                !Array.isArray(body.mutations) || body.mutations.length > 100
              ) throw Error("INVALID_BATCH");
              mutations = body.mutations.map((m: any) =>
                validateMutation(m, identity.id, identity.platform)
              );
            }
            for (const m of mutations) {
              if (
                m.platform !== identity.platform ||
                m.record && m.record.platform !== identity.platform
              ) throw Error("PLATFORM_MISMATCH");
            }
            // Serialize only this tenant's source reconciliation; repeat/batch retries stay atomic.
            await tx`select pg_advisory_xact_lock(hashtextextended(${identity.id},0))`;
            const receipts: any = {
              accepted_idempotency_keys: [],
              duplicate_idempotency_keys: [],
              rejected: [],
              score_status: "QUEUED",
            };
            // Existing SQL batch bound100, Shortcut contract bound250: chunks remain one tx.
            for (let i = 0; i < mutations.length; i += 100) {
              const [row] =
                await tx`select public.beta_ingest_health_mutation_batch(${identity.id},${
                  tx.json(mutations.slice(i, i + 100))
                }) as receipt`;
              for (
                const k of [
                  "accepted_idempotency_keys",
                  "duplicate_idempotency_keys",
                  "rejected",
                ]
              ) {
                receipts[k].push(...row.receipt[k]);
              }
            }
            return result(receipts.rejected.length ? 207 : 200, receipts);
          }));
      } catch (e) {
        const code = String((e as any)?.code || ""),
          message = (e as Error).message,
          retryable = ["55P03", "57014", "40001", "40P01", "25P03", "25P04"]
            .includes(code);
        return result(
          retryable
            ? 503
            : /SESSION|AUTH/.test(message)
            ? 401
            : /CROSS_USER|PLATFORM/.test(message)
            ? 403
            : 400,
          {
            error: retryable
              ? "DB_TIMEOUT_RETRYABLE"
              : /^[A-Z_]+$/.test(message)
              ? message
              : "INGESTION_FAILED",
            retryable,
          },
        );
      }
    },
  };
}
export async function createRecomputeWorker(raw: any) {
  const sql = scopedWorkerSql(raw, "health_recompute_worker");
  const runtime = new LocalEngineRuntime({}, async () => {
    throw Error("NO_INTERACTIVE_IDENTITY");
  }, async () => {
    throw Error("NO_INTERACTIVE_IDENTITY");
  }, { kind: "hosted", sql, release: "AB" });
  await runtime.start();
  return {
    sql,
    async drain(limit = 3) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 5) {
        throw Error(
          "INVALID_WORKER_LIMIT",
        );
      }
      const token = crypto.randomUUID(),
        jobs =
          await sql`select * from public.beta_claim_score_recompute(${token},null,${limit})`;
      let completed = 0, failed = 0;
      const failureCodes: string[] = [];
      for (const job of jobs) {
        const day = job.score_date instanceof Date
          ? job.score_date.toISOString().slice(0, 10)
          : String(job.score_date);
        try {
          await sql.withJob(
            { ...job, score_date: day, token },
            () => runtime.processClaimedJob(job, token),
          );
          completed++;
        } catch (e) {
          failed++;
          failureCodes.push(
            /^[0-9A-Z_]+$/.test(String((e as any).code || (e as Error).message))
              ? String((e as any).code || (e as Error).message)
              : "WORKER_RECOMPUTE_FAILED",
          );
          await sql`select public.beta_fail_score_recompute(${job.canonical_user_id},${day}::date,${job.generation},${token},'WORKER_RECOMPUTE_FAILED',true)`;
        }
      }
      return { claimed: jobs.length, completed, failed, failureCodes };
    },
  };
}
