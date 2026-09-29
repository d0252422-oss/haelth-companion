// Existing connector payloads and device grants. No Web context or privileged fallback.
import { authenticateNativeUser, scoreErrorCode, shortcutRecordToMutation, validateMutation } from "./index.ts";
import { sameCanonicalUserId } from "./canonical-user-id.ts";
import { readManualRequest } from "./manual-request-body.ts";
import { scopedWorkerSql } from "./worker-sql-context.ts";
import { LocalEngineRuntime } from "./local-engine-runtime.ts";
import { logPersistedSyncReceipt } from "./sync-trigger-diagnostic.ts";
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
    async handle(request: Request, admin?: any) {
      try {
        if (request.method !== "POST") {
          return result(405, {
            error: "METHOD_NOT_ALLOWED",
          });
        }
        const path = new URL(request.url).pathname,
          shortcut = path.endsWith("/v1/connectors/ios-shortcut/ingest");
        const statusRequest = path.endsWith("/v1/mobile/connectors/status");
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
        const native = !shortcut && !session;
        let nativeOwner: string | null = null;
        let nativeDigest: string | null = null;
        if (native) {
          if (!admin) throw Error("NATIVE_AUTH_PROVIDER_UNAVAILABLE");
          const verified = await authenticateNativeUser(request, admin);
          // A random, request-local capability is never sent to Android. The
          // issuing RPC resolves the linked ACTIVE owner from the verified Auth ID.
          nativeDigest = await sha(Array.from(crypto.getRandomValues(new Uint8Array(32)))
            .map((x) => x.toString(16).padStart(2, "0")).join(""));
          const { data, error } = await admin.rpc("beta_issue_native_ingest_scope", {
            p_auth_user_id: verified.auth_user_id,
            p_capability_digest: nativeDigest,
          });
          if (error) {
            if (String(error.message || "").includes("NATIVE_IDENTITY_NOT_LINKED")) {
              throw Error("NATIVE_IDENTITY_NOT_LINKED");
            }
            throw Error("NATIVE_SCOPE_UNAVAILABLE");
          }
          if (!/^[0-9a-f-]{36}$/i.test(String(data))) {
            throw Error("NATIVE_SCOPE_UNAVAILABLE");
          }
          nativeOwner = String(data);
        }
        const response = await sql.withSession({
          kind: shortcut ? "shortcut" : native ? "native" : "app",
          session,
          digest: nativeDigest ?? await sha(auth.slice(7)),
        }, () =>
          sql.begin(async (tx: any) => {
            const [identity] =
              await tx`select private.delegated_worker_user() as id,private.delegated_worker_platform() as platform`;
            if (!identity?.id) throw Error("INVALID_WORKER_SESSION");
            if (native && !sameCanonicalUserId(identity.id, nativeOwner)) {
              throw Error("NATIVE_IDENTITY_CONFLICT");
            }
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
              if (native) {
                const [consumed] = await tx`select private.consume_native_ingest_scope() as ok`;
                if (!consumed?.ok) throw Error("INVALID_NATIVE_SCOPE");
              }
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
            if (native) {
              const [consumed] = await tx`select private.consume_native_ingest_scope() as ok`;
              if (!consumed?.ok) throw Error("INVALID_NATIVE_SCOPE");
            }
            return result(receipts.rejected.length ? 207 : 200, receipts);
          }));
        if (body.sync_diagnostic && (response.status === 200 || response.status === 207)) {
          const receipt = await response.clone().json().catch(() => ({}));
          logPersistedSyncReceipt(statusRequest ? "connector_status" : "ingestion",
            body.sync_diagnostic, response.status,
            statusRequest ? { last_result: body.last_result } : receipt,
            { platform: native ? "android" : shortcut ? "ios" : null,
              auth_kind: native ? "native_bearer" : shortcut ? "shortcut_credential" : "app_session" });
        }
        return response;
      } catch (e) {
        const code = String((e as any)?.code || ""),
          message = (e as Error).message,
          retryable = ["55P03", "57014", "40001", "40P01", "25P03", "25P04"]
            .includes(code);
        return result(
          retryable
            ? 503
            : Number.isInteger((e as any)?.status)
            ? (e as any).status
            : /_UNAVAILABLE$/.test(message)
            ? 503
            : /SESSION|AUTH/.test(message)
            ? 401
            : /INVALID_NATIVE_SCOPE|NATIVE_IDENTITY_NOT_LINKED/.test(message)
            ? 401
            : /CROSS_USER|PLATFORM/.test(message)
            ? 403
            : 400,
          {
            error: retryable
              ? "DB_TIMEOUT_RETRYABLE"
              : Number.isInteger((e as any)?.status) && /^[A-Z_]+$/.test(String((e as any)?.code))
              ? (e as any).code
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
export function scoreWorkerFailureCode(error: unknown): string {
  const classified = scoreErrorCode(error);
  return classified === "SCORE_RECOMPUTE_FAILED"
    ? "WORKER_RECOMPUTE_FAILED"
    : classified;
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
          // Persist only the existing allowlisted classifier, never the raw
          // exception message (which may contain SQL or health-data details).
          const failureCode = scoreWorkerFailureCode(e);
          failureCodes.push(failureCode);
          await sql`select public.beta_fail_score_recompute(${job.canonical_user_id},${day}::date,${job.generation},${token},${failureCode},true)`;
        }
      }
      return { claimed: jobs.length, completed, failed, failureCodes };
    },
  };
}
