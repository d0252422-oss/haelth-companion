// Non-production integration adapter. Pure portable engine; Python is reference/test-only.
import postgres from "npm:postgres@3.4.8";
import { PortableEngineRuntime } from "./engine-portable.ts";
import { authenticateNativeUser, resolveNativeIdentity } from "./index.ts";
import { recomputeBetaScore } from "./score-bridge.ts";
import { ManualBodyLocalStore, localReadRange, manualDate, rejectClientIdentity, manualBodyAnalysis } from "./manual-body-local.ts";
import { ManualTrainingLocalStore } from "./manual-training-local.ts";
import {resolveVerifiedManualWebIdentity,prepareManualRead,prepareManualWrite,manualPrivilegedRead} from './manual-web-identity.ts';

type Json = Record<string, any>;
const pgDay = (value: any) =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
const safeName = (name: string) => {
  if (!/^[a-z_]+$/.test(name)) throw Error("INVALID_IDENTIFIER");
  return name;
};
const digest = async (value: unknown) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(value)),
      ),
    ),
  ).map((b) => b.toString(16).padStart(2, "0")).join("");
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const dateOnly = manualDate;

// Minimal PostgreSQL implementation of the existing bridge's repository surface; no fake rows.
export function pgAdmin(
  sql: any,
  verify: (token: string) => Promise<Json>,
  beforePersist?: (tx: any, args: Json) => Promise<void>,
): any {
  return {
    auth: {
      getUser: async (token: string) => {
        try {
          return { data: { user: await verify(token) }, error: null };
        } catch (error) {
          return { data: null, error: { code: error instanceof Error && error.message === "AUTH_SERVICE_UNAVAILABLE" ? "AUTH_SERVICE_UNAVAILABLE" : "INVALID_TOKEN" } };
        }
      },
    },
    async rpc(name: string, args: Json) {
      try {
        const entries = Object.entries(args),
          text = `select * from public.${safeName(name)}(${
            entries.map(([key], i) => `${safeName(key)} := $${i + 1}`).join(",")
          })`;
        const values = entries.map(([, v]) =>
          v instanceof Date
            ? v.toISOString()
            : v !== null && typeof v === "object"
            ? sql.json(v)
            : v
        );
        const run = async (tx: any) => {
          if (name === "beta_persist_score_bundle" && beforePersist) {
            await beforePersist(tx, args);
          }
          const rows = await tx.unsafe(text, values);
          return rows.length === 1 && Object.keys(rows[0]).length === 1 &&
              name in rows[0]
            ? rows[0][name]
            : rows;
        };
        const data = name === "beta_persist_score_bundle" && beforePersist
          ? await sql.begin(run)
          : await run(sql);
        return { data, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    from(table: string) {
      if (!["beta_health_records", "beta_health_scores"].includes(table)) {
        throw Error("UNSUPPORTED_TABLE");
      }
      let cols = "*", offset = 0, limit = 1000;
      const filters: string[] = [],
        values: unknown[] = [],
        orders: string[] = [];
      const add = (field: string, op: string, v: unknown) => {
        values.push(v);
        filters.push(`${safeName(field)} ${op} $${values.length}`);
        return query;
      };
      const query: any = {
        select: (s: string) => {
          if (!/^[a-z_,]+$/.test(s)) throw Error("INVALID_COLUMNS");
          cols = s;
          return query;
        },
        eq: (f: string, v: unknown) => add(f, "=", v),
        is: (f: string, v: unknown) => {
          if (v !== null) throw Error("INVALID_FILTER");
          filters.push(safeName(f) + " is null");
          return query;
        },
        in: (f: string, v: string[]) =>
          add(f, "= any", "{" + v.join(",") + "}"),
        overlaps: (f: string, v: string[]) =>
          add(f, "&&", "{" + v.join(",") + "}"),
        order: (f: string, o: Json) => {
          orders.push(safeName(f) + (o.ascending ? " asc" : " desc"));
          return query;
        },
        range: (a: number, b: number) => {
          offset = a;
          limit = b - a + 1;
          return query;
        },
        limit: (n: number) => {
          limit = n;
          return query;
        },
        then(resolve: any, reject: any) {
          const where = filters.map((s) =>
            s.replace(/= any (\$\d+)/, "= any($1::text[])")
          ).join(" and ");
          return sql.unsafe(
            `select ${cols} from public.${table} where ${where || "true"} ${
              orders.length ? "order by " + orders.join(",") : ""
            } limit ${limit} offset ${offset}`,
            values,
          )
            .then(
              (data: unknown) => resolve({ data, error: null }),
              (error: unknown) => resolve({ data: null, error }),
            ).catch(reject);
        },
      };
      return query;
    },
  };
}

export class LocalEngineRuntime {
  sql: any;
  worker: any;
  verify: (token: string) => Promise<Json>;
  timings: Json[] = [];
  private activeRequests = 0;
  manualBody: ManualBodyLocalStore;
  manualTraining: ManualTrainingLocalStore;
  constructor(config: Json, verify: (token: string) => Promise<Json>, private verifyWeb?: (token:string)=>Promise<{subject:string,email:string}>) {
    if (
      Deno.env.get("HEALTH_ENGINE_LOCAL_ONLY") !== "1" ||
      !(config.host === "127.0.0.1" || (config.host === "host.docker.internal" && Deno.env.get("HEALTH_MANUAL_EDGE_REHEARSAL") === "1" && !Deno.env.get("DENO_DEPLOYMENT_ID"))) ||
      !/^health_engine_[a-f0-9]{32}$/.test(config.database)
    ) throw Error("UNSAFE_DATABASE_TARGET");
    this.sql = postgres({
      ...config,
      max: 8,
      connect_timeout: 5,
      connection: {
        "health.engine.experimental": "on",
        lock_timeout: 2000,
        statement_timeout: 10000,
        idle_in_transaction_session_timeout: 10000,
        transaction_timeout: 15000,
      },
    });
    this.verify = verify;
    this.worker = new PortableEngineRuntime();
    this.manualBody = new ManualBodyLocalStore(this.sql);
    this.manualTraining = new ManualTrainingLocalStore(this.sql);
  }
  async start() {
    await this.worker.start();
  }
  async close() {
    await this.worker.close();
    await this.sql.end();
  }
  async identity(request: Request) {
    if(request.headers.get('x-health-session-kind')==='web') {
      if(!this.verifyWeb||Deno.env.get('HEALTH_MANUAL_WEB_SESSION_LOCAL')!=='1')throw Error('WEB_SESSION_ADAPTER_DISABLED');
      const token=/^Bearer (.+)$/.exec(request.headers.get('authorization')||'')?.[1];
      if(!token)throw Error('INVALID_WEB_SESSION');
      let verified;
      try { verified=await this.verifyWeb(token); }
      catch(error) { if(error instanceof Error&&['AUTH_SERVICE_UNAVAILABLE','WEB_SESSION_VERIFICATION_UNAVAILABLE'].includes(error.message))throw Error('AUTH_SERVICE_UNAVAILABLE');throw Error('INVALID_WEB_SESSION'); }
      return await resolveVerifiedManualWebIdentity(this.sql,verified);
    }
    const admin = pgAdmin(this.sql, this.verify);
    const auth = await authenticateNativeUser(request, admin);
    const mapped = await resolveNativeIdentity(
      admin,
      String(auth.auth_user_id),
      true,
    );
    if (!mapped) throw Error("IDENTITY_MISSING");
    return {
      kind: 'native', auth: String(auth.auth_user_id),
      canonical: String(mapped.canonical_user_id),
    };
  }
  async read(identity: Json, table: string, range = localReadRange()) {
    if (
      !["engine_meals", "engine_output_history", "engine_output_heads"]
        .includes(table)
    ) throw Error("INVALID_TABLE");
    return await this.sql.begin(async (tx: any) => {
      await prepareManualRead(tx,identity);
      const dateColumn = table === "engine_meals"
        ? "local_date"
        : "calculation_date";
      const rows = await tx.unsafe(
        `select * from public.${table} where canonical_user_id=$1 and ${dateColumn} between $2::date and $3::date limit 5001`,
        [identity.canonical, range.start, range.end],
      );
      if (rows.length > 5000) throw Error("READ_BOUND_EXCEEDED");
      return rows;
    });
  }
  async mutate(identity: Json, input: Json, remove = false) {
    for (
      const field of ["user_id", "canonical_user_id", "owner_id", "subject_ref"]
    ) if (field in input) throw Error("CLIENT_IDENTITY_FORBIDDEN");
    const requestId = String(input.clientRequestId || ""),
      mealId = String(input.mealRecordId || crypto.randomUUID());
    if (!/^[0-9a-f-]{36}$/.test(requestId) || !/^[0-9a-f-]{36}$/.test(mealId)) {
      throw Error("INVALID_MUTATION_ID");
    }
    const hash = await digest({ input, remove });
    return await this.sql.begin(async (tx: any) => {
      await prepareManualWrite(tx,identity);
      await tx`select pg_advisory_xact_lock(hashtextextended(${identity.canonical},0))`;
      const receipt =
        await tx`select * from private.engine_mutation_receipts where canonical_user_id=${identity.canonical} and request_id=${requestId}`;
      if (receipt.length) {
        if (receipt[0].input_hash !== hash) throw Error("REQUEST_ID_CONFLICT");
        return { ...receipt[0].response, replayed: true };
      }
      const old =
        (await tx`select * from public.engine_meals where canonical_user_id=${identity.canonical} and meal_id=${mealId} for update`)[
          0
        ];
      if (input.mealRecordId && !old) throw Error("MEAL_NOT_FOUND");
      if (old?.deleted) throw Error("MEAL_DELETED");
      if (old && Number(input.revision) !== Number(old.revision)) {
        throw Error("STALE_REVISION");
      }
      const revision = old ? Number(old.revision) + 1 : 1,
        date = remove ? pgDay(old.local_date) : dateOnly(input.date);
      if (date > today()) throw Error("FUTURE_MEAL_UNSUPPORTED");
      const time = String(input.time || "12:00");
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Error("INVALID_TIME");
      const at = date + "T" + time + ":00+08:00";
      const labelMode = input.labelMode === true,
        grams = Number(input.weightGrams);
      if (
        labelMode &&
        (!Number.isFinite(grams) || grams <= 0 || grams > 10000 ||
          !String(input.referenceSource || "").trim())
      ) throw Error("LABEL_PROVENANCE_REQUIRED");
      const nutrients: Json = {};
      for (
        const [ui, key] of Object.entries({
          calories: "calories",
          protein: "protein_g",
          carbs: "carbs_g",
          fat: "fat_g",
          fiber: "fiber_g",
          sodium: "sodium_mg",
        })
      ) {
        const raw = input[ui];
        const n = raw === null || raw === undefined || raw === ""
          ? null
          : Number(raw);
        if (n !== null && (!Number.isFinite(n) || n < 0)) {
          throw Error("INVALID_NUTRIENT");
        }
        nutrients[key] = n === null ? null : n * (labelMode ? grams / 100 : 1);
      }
      const body = remove ? old.body : {
        ...input,
        mealRecordId: mealId,
        revision,
        date,
        time,
        calories: nutrients.calories,
        protein: nutrients.protein_g,
        carbs: nutrients.carbs_g,
        fat: nutrients.fat_g,
        labelValues: labelMode
          ? {
            calories: input.calories,
            protein: input.protein,
            carbs: input.carbs,
            fat: input.fat,
          }
          : null,
        includedInTotals: input.userConfirmed === true,
        userConfirmed: input.userConfirmed === true,
        nutritionSource: labelMode
          ? "USER_LABEL_PER_100G"
          : "CONFIRMED_MANUAL_TOTALS",
      };
      const canonical = {
        subject_ref: identity.canonical,
        source: "web-confirmed",
        record_id: mealId,
        domain: "nutrition",
        revision,
        recorded_at: at,
        updated_at: new Date().toISOString(),
        source_quality: "UNKNOWN",
        deleted: remove,
        payload: {
          meal_id: mealId,
          meal: input.mealType || old?.body.mealType || "午餐",
          meal_time: at,
          confirmed: input.userConfirmed === true,
          food_items: [{
            item_id: mealId,
            raw_name: String(input.foodName || old?.body.foodName || ""),
            portion_value: labelMode ? grams : null,
            portion_unit: labelMode ? "g" : null,
            preparation_method: "user_label_edible_as_served",
            source: input.userConfirmed === true
              ? "MANUAL_CONFIRMED"
              : "MANUAL",
            nutrients,
          }],
        },
      };
      await tx`insert into public.engine_meals values(${identity.canonical},${mealId},${revision},${date},${remove},${
        tx.json(body)
      },${tx.json(canonical)},now())
        on conflict(canonical_user_id,meal_id) do update set revision=excluded.revision,local_date=excluded.local_date,deleted=excluded.deleted,body=excluded.body,canonical_record=excluded.canonical_record,updated_at=now()`;
      const result = {
        record: { ...body, revision },
        recordId: mealId,
        status: "QUEUED",
      };
      await tx`insert into private.engine_mutation_receipts values(${identity.canonical},${requestId},${hash},${
        tx.json(result)
      })`;
      return result;
    });
  }
  async compute(user: string, day: string) {
    const begin = performance.now();
    const rows = await this
      .sql`select canonical_record from public.engine_meals where canonical_user_id=${user} and not deleted and local_date between ${day}::date-27 and ${day}::date limit 5001`;
    const health = await this
      .sql`select * from public.beta_health_records where canonical_user_id=${user} and operation='UPSERT' and invalidated_at is null
      and affected_local_dates && array(select generate_series(${day}::date-27,${day}::date,'1 day')::date) limit 5001`;
    const healthRecords = health.map((r: Json) => ({
      subject_ref: user,
      source: r.source_app,
      record_id: r.source_record_id,
      domain: r.domain,
      revision: Number(r.source_revision),
      recorded_at: r.canonical_record.recorded_at,
      updated_at: new Date(r.updated_at).toISOString(),
      value: r.canonical_record.value,
      unit: r.canonical_record.unit,
      started_at: r.canonical_record.started_at || null,
      ended_at: r.canonical_record.ended_at || null,
      source_quality: "UNKNOWN",
    }));
    if (rows.length + health.length > 5000) {
      throw Error("SCORE_INPUT_BOUND_EXCEEDED");
    }
    const result = await this.worker.execute({
      algorithm_id: "multi-domain-bundle",
      algorithm_version: "health-score-v1.0",
      domain: "multi_domain",
      subject_ref: user,
      period_start: day + "T00:00:00+08:00",
      period_end: day + "T23:59:59+08:00",
      timezone: "Asia/Taipei",
      canonical_inputs: {
        date: day,
        records: [
          ...rows.map((r: Json) => r.canonical_record),
          ...healthRecords,
        ],
        calculated_at: new Date().toISOString(),
      },
    });
    this.timings.push({
      date: day,
      records: rows.length + health.length,
      elapsed_ms: performance.now() - begin,
    });
    return result.normalized.bundle;
  }
  async drain(user: string) {
    const token = crypto.randomUUID();
    let processed = 0;
    for (let page = 0; page < 8; page++) {
      const jobs = await this
        .sql`select * from public.beta_claim_score_recompute(${token},${user},5)`;
      if (!jobs.length) break;
      for (const job of jobs) {
        const day = pgDay(job.score_date);
        try {
          const bundle = await this.compute(user, day);
          const admin = pgAdmin(this.sql, this.verify, async (tx, args) => {
            const valid =
              await tx`select generation from private.beta_score_recompute_queue where canonical_user_id=${user} and score_date=${day} and generation=${job.generation} and lease_token=${token} for update`;
            if (
              !valid.length ||
              Number(args.p_generation) !== Number(job.generation)
            ) throw Error("STALE_SCORE_INPUT");
            for (
              const [kind, output] of Object.entries(bundle.outputs) as [
                string,
                Json,
              ][]
            ) {
              await tx`insert into public.engine_output_history values(${user},${day},${kind},${output.engine_version},${output.input_fingerprint},${output.score},${output.score_status},${output.data_completeness},${output.confidence},${
                tx.json(output)
              },${output.calculated_at}) on conflict do nothing`;
              await tx`insert into public.engine_output_heads values(${user},${day},${kind},${output.engine_version},${output.input_fingerprint}) on conflict(canonical_user_id,calculation_date,output_kind,engine_version) do update set input_fingerprint=excluded.input_fingerprint`;
            }
          });
          // Frozen original eight-score computation remains unchanged, including missing training/nutrition.
          await recomputeBetaScore(admin, user, day);
          processed++;
        } catch (error) {
          try {
            await this
              .sql`select public.beta_fail_score_recompute(${user},${day},${job.generation},${token},'ENGINE_LOCAL_FAILURE',true)`;
          } catch { /* another generation owns this work */ }
          throw error;
        }
      }
    }
    return processed;
  }
  async snapshot(identity: Json, input: Json = {}) {
    const range = localReadRange(input);
    const pending = await manualPrivilegedRead(this.sql,identity,tx=>tx`select score_date from private.beta_score_recompute_queue where canonical_user_id=${identity.canonical} and status<>'COMPLETE' and score_date between ${range.start}::date and ${range.end}::date`);
    const staleDates = new Set(pending.map((r: Json) => pgDay(r.score_date)));
    const [meals, history, heads] = await Promise.all([
      this.read(identity, "engine_meals", range),
      this.read(identity, "engine_output_history", range),
      this.read(identity, "engine_output_heads", range),
    ]);
    const keys = new Set(
      heads.map((r: Json) =>
        [
          r.calculation_date,
          r.output_kind,
          r.engine_version,
          r.input_fingerprint,
        ].join("|")
      ),
    );
    return {
      meals: meals.filter((r: Json) => !r.deleted).map((r: Json) => ({
        ...r.body,
        revision: Number(r.revision),
      })),
      outputs: history.filter((r: Json) =>
        keys.has(
          [
            r.calculation_date,
            r.output_kind,
            r.engine_version,
            r.input_fingerprint,
          ].join("|"),
        )
      ).map((r: Json) =>
        staleDates.has(pgDay(r.calculation_date))
          ? {
            ...r.payload,
            persisted_score_status: r.payload.score_status,
            score_status: "STALE",
            stale_reason: "INPUT_REVISION_PENDING",
          }
          : r.payload
      ),
      experimental: true,
      validation: "UNVALIDATED",
    };
  }
  async legacyTimeline(identity: Json, input: Json = {}) {
    const range = localReadRange(input);
    // Privileged repository access is always scoped by verified canonical identity.
    const rows = await manualPrivilegedRead(this.sql,identity,tx=>tx`select * from public.beta_health_scores where canonical_user_id=${identity.canonical} and score_date between ${range.start}::date and ${range.end}::date order by score_date`);
    const names: Json = {
      sleep: "sleepSystemScore",
      activity: "activityScore",
      training: "trainingScore",
      nutrition: "nutritionScore",
      body_composition: "bodyCompositionScore",
      recovery: "recoveryScore",
      fatigue: "fatigueIndex",
      health_overall: "healthScore",
    };
    const days: Json = {};
    for (const row of rows) {
      const date = pgDay(row.score_date), entry = days[date] ??= { date };
      if (names[row.score_type]) entry[names[row.score_type]] = row.score;
      if (row.score_type === "health_overall") {
        entry.algorithmVersion = row.algorithm_version;
        entry.scoreMetadata = {
          completeness: row.completeness,
          confidence: row.confidence,
        };
        entry.healthStatus = row.status;
      }
    }
    return Object.values(days);
  }
  async handle(request: Request) {
    // Bound admission as well as SQL execution; client abort does not release this slot.
    if (this.activeRequests >= 8) return Response.json({ ok: false, error: "DB_BUSY_RETRYABLE", retryable: true }, {
      status: 503, headers: { "cache-control": "no-store", "retry-after": "1" },
    });
    this.activeRequests++;
    try {
      if (request.method !== "POST") {
        return Response.json({ ok: false, error: "METHOD_NOT_ALLOWED" }, {
          status: 405,
        });
      }
      const text = await request.text();
      if (text.length > 1048576) throw Error("BODY_TOO_LARGE");
      const { action, payload = {} } = JSON.parse(text),
        identity = await this.identity(request);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw Error("INVALID_PAYLOAD");
      rejectClientIdentity(payload);
      let data: any;
      if (["getExerciseDatabase", "getWorkoutRecords", "manageExercise", "addWorkoutRecord", "updateWorkoutSet", "deleteWorkoutSet", "getTrainingWriteStatus"].includes(action)) {
        if (Deno.env.get("HEALTH_EXERCISE_MANAGEMENT_LOCAL") !== "1") throw Error("EXERCISE_MANAGEMENT_DISABLED");
        if (action === "getExerciseDatabase") data = await this.manualTraining.catalog(identity);
        else if (action === "getWorkoutRecords") data = await this.manualTraining.workouts(identity, payload);
        else if (action === "getTrainingWriteStatus") data = await this.manualTraining.status(identity, payload);
        else data = await this.manualTraining.write(identity, action, payload);
      } else if (action === "getBodyRecords") {
        data = await this.manualBody.read(identity, payload);
      } else if (["addBodyRecord", "upsertBodyRecord", "deleteBodyRecord"].includes(action)) {
        data = await this.manualBody.write(identity, payload, action === "deleteBodyRecord");
      } else if (action === "getBodyWriteStatus") {
        data = await this.manualBody.status(identity, payload);
      } else if (action === "upsertMealRecord" || action === "deleteMealRecord") {
        data = await this.mutate(
          identity,
          payload,
          action === "deleteMealRecord",
        );
        try {
          await this.drain(identity.canonical);
          data.analysisStatus = "COMPUTED";
        } catch {
          // SQL transaction/receipt already committed. Analysis failure must not hide a saved record.
          data = { ...data, status: "SAVED", analysisStatus: "ANALYSIS_PENDING" };
        }
      } else if (action === "getCurrentUser") {
        data = {
          user: {
            userId: identity.canonical,
            name: "Local synthetic " + (identity.kind==='web'?'Web session':identity.auth.slice(-1)),
          },
        };
      } else if (action === "localEngineSnapshot") {
        data = await this.snapshot(identity, payload);
      } else if (action === "getNutritionRecords") {
        data = (await this.snapshot(identity, payload)).meals;
      } else if (
        action === "getDashboardData" || action === "getTodaySummary"
      ) {
        const requestedDay = payload.date === undefined ? today() : dateOnly(payload.date);
        const timeline = await this.legacyTimeline(identity, { date: requestedDay });
        data = {
          user: { userId: identity.canonical },
          today: timeline.find((r: any) => r.date === requestedDay) ?? null,
          experimental: true,
        };
      } else if (action === "getHealthTimeline") {
        data = { timeline: await this.legacyTimeline(identity, payload) };
      } else if (
        action === "refreshDerivedData" || action === "refreshDailyNutrition"
      ) {
        if (payload.recordType === "workout") {
          data = { status: "SAVED", analysisStatus: "ANALYSIS_PENDING", analysisReason: "MANUAL_WORKOUT_ADAPTER_NOT_CONNECTED", analysisJobScheduled: false };
        } else if (payload.recordType === "body") {
          data = { status: "SAVED", ...manualBodyAnalysis };
        } else {
          await this.drain(identity.canonical);
          data = await this.snapshot(identity, payload);
        }
      } else if (action === "getMealWriteStatus") {
        data = await this.mealWriteStatus(identity,payload);
      } else throw Error("LOCAL_ACTION_NOT_IMPLEMENTED");
      return Response.json({ ok: true, data }, {
        headers: { "cache-control": "no-store" },
      });
    } catch (error) {
      const sqlCode = String((error as Json)?.code || "");
      const message = error instanceof Error ? error.message : "";
      const retryable = message === "AUTH_SERVICE_UNAVAILABLE" || ["55P03", "57014", "25P03", "25P04", "08000", "08003", "08006", "57P01", "57P03", "53300", "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "ECONNREFUSED", "ECONNRESET"].includes(sqlCode);
      const code = message === "AUTH_SERVICE_UNAVAILABLE" ? message : ["23503", "23001"].includes(sqlCode) ? "EXERCISE_REFERENCED" : retryable ? "DB_TIMEOUT_RETRYABLE" : /^[A-Z_]+$/.test(message)
        ? message
        : "ENGINE_REQUEST_FAILED";
      return Response.json({ ok: false, error: code, retryable }, {
        status: retryable ? 503 : /IDENTITY|SESSION|AUTH|TOKEN/.test(code)
          ? 401
          : 400,
        headers: { "cache-control": "no-store" },
      });
    } finally { this.activeRequests--; }
  }
  async mealWriteStatus(identity:Json,payload:Json) {
    const receipt=await manualPrivilegedRead(this.sql,identity,tx=>tx`select response from private.engine_mutation_receipts where canonical_user_id=${identity.canonical} and request_id=${String(payload.clientRequestId)}`);
    return {exists:receipt.length===1,...receipt[0]?.response};
  }
}
