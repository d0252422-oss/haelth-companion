// Shared SQL semantics. Local and hosted constructors have separate configuration boundaries.
import postgres from "npm:postgres@3.4.8";
import { PortableEngineRuntime } from "./engine-portable.ts";
import { authenticateNativeUser, resolveNativeIdentity } from "./index.ts";
import { recomputeBetaScore } from "./score-bridge.ts";
import { ManualBodyLocalStore, localReadRange, manualDate, rejectClientIdentity, manualBodyUnavailableAnalysis } from "./manual-body-local.ts";
import {manualBodyEngineRecords} from './manual-body-engine.ts';
import { ManualTrainingLocalStore } from "./manual-training-local.ts";
import {resolveVerifiedManualWebIdentity,prepareManualRead,prepareManualWrite,manualPrivilegedRead} from './manual-web-identity.ts';
import {readManualRequest} from './manual-request-body.ts';
import {readPublishedDaily,readPublishedDailySnapshot,projectPublishedDaily} from './manual-daily-read.ts';
import {ManualObservationsLocalStore} from './manual-observations-local.ts';
import {observationEngineProjection,projectManualObservationDay} from './manual-observation-projection.ts';
import {readUserEntitlement} from './entitlement.ts';

type Json = Record<string, any>;
// Presentation completeness is not confirmation, a new engine rule, or a
// historical data rewrite. Preserve every known/null nutrient and provenance.
export function manualMealPresentation(body:Json):Json {
  const complete=body.userConfirmed===true&&['calories','protein','carbs','fat'].every(key=>typeof body[key]==='number'&&Number.isFinite(body[key])&&body[key]>=0);
  return {...body,includedInTotals:complete,nutritionCompleteness:body.userConfirmed!==true?'UNCONFIRMED':complete?'COMPLETE':'INCOMPLETE'};
}
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
  manualObservations: ManualObservationsLocalStore;
  private hosted: boolean;
  private exerciseEnabled: boolean;
  constructor(config: Json, verify: (token: string) => Promise<Json>, private verifyWeb?: (token:string)=>Promise<{subject:string,email:string}>, mode?: {kind:'hosted';sql:any;release:'A'|'AB'}) {
    this.hosted=mode?.kind==='hosted';
    this.exerciseEnabled=mode ? mode.release==='AB' : Deno.env.get('HEALTH_EXERCISE_MANAGEMENT_LOCAL')==='1';
    if (!mode && (
      Deno.env.get("HEALTH_ENGINE_LOCAL_ONLY") !== "1" ||
      !(config.host === "127.0.0.1" || (config.host === "host.docker.internal" && Deno.env.get("HEALTH_MANUAL_EDGE_REHEARSAL") === "1" && !Deno.env.get("DENO_DEPLOYMENT_ID"))) ||
      !/^health_engine_[a-f0-9]{32}$/.test(config.database)
    )) throw Error("UNSAFE_DATABASE_TARGET");
    if(mode&&(!mode.sql||!verifyWeb||!['A','AB'].includes(mode.release)))throw Error('INVALID_HOSTED_RUNTIME');
    this.sql = mode?.sql ?? postgres({
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
    this.manualObservations = new ManualObservationsLocalStore(this.sql);
  }
  async start() {
    await this.worker.start();
  }
  async close() {
    await this.worker.close();
    await this.sql.end();
  }
  async identity(request: Request) {
    if(this.hosted&&request.headers.get('x-health-session-kind')!=='web')throw Error('INVALID_WEB_SESSION');
    if(request.headers.get('x-health-session-kind')==='web') {
      if(!this.verifyWeb||(!this.hosted&&Deno.env.get('HEALTH_MANUAL_WEB_SESSION_LOCAL')!=='1'))throw Error('WEB_SESSION_ADAPTER_DISABLED');
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
    return await this.sql.begin(async (tx: any) => {
      await prepareManualRead(tx,identity);
      return await this.readRows(tx,identity,table,range);
    });
  }
  private async readRows(tx:any,identity:Json,table:string,range:ReturnType<typeof localReadRange>){
    if (
      !["engine_meals", "engine_output_history", "engine_output_heads"]
        .includes(table)
    ) throw Error("INVALID_TABLE");
      const dateColumn = table === "engine_meals"
        ? "local_date"
        : "calculation_date";
      const rows = await tx.unsafe(
        `select * from public.${table} where canonical_user_id=$1 and ${dateColumn} between $2::date and $3::date limit 5001`,
        [identity.canonical, range.start, range.end],
      );
      if (rows.length > 5000) throw Error("READ_BOUND_EXCEEDED");
      return rows;
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
        return { ...receipt[0].response,record:manualMealPresentation(receipt[0].response.record),replayed: true };
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
      const body = manualMealPresentation(remove ? old.body : {
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
      });
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
    const {rows,health,body,observations}=await this.sql.begin('isolation level repeatable read read only',async(tx:any)=>{
      const rows=await tx`select canonical_record from public.engine_meals where canonical_user_id=${user} and not deleted and local_date between ${day}::date-27 and ${day}::date limit 5001`;
      const health=await tx`select * from public.beta_health_records where canonical_user_id=${user} and operation='UPSERT' and invalidated_at is null
      and affected_local_dates && array(select generate_series(${day}::date-27,${day}::date,'1 day')::date) limit 5001`;
      const body=await tx`select * from public.engine_manual_body_records where canonical_user_id=${user} and not deleted and local_date between ${day}::date-27 and ${day}::date limit 29`;
      if(body.length>28)throw Error('SCORE_INPUT_BOUND_EXCEEDED');
      const observations=await tx`select * from public.engine_manual_observations where canonical_user_id=${user} and not deleted
        and (local_date between ${day}::date-27 and ${day}::date or (domain='sleep' and local_date between ${day}::date-28 and ${day}::date+1)) limit 5001`;
      if(observations.length>5000)throw Error('SCORE_INPUT_BOUND_EXCEEDED');
      return {rows,health,body,observations};
    });
    const bodyRecords=manualBodyEngineRecords(body,user);
    const windowStart=new Date(Date.parse(day)-27*86400000).toISOString().slice(0,10);
    const manualDays=[...new Set<string>(observations.map((r:Json)=>pgDay(r.local_date)))].filter(date=>date>=windowStart&&date<=day).map(date=>({date,...observationEngineProjection(observations,health,user,date)}));
    const observationRecords=manualDays.flatMap(p=>p.records);
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
      payload: {manual_reconciliation:{policy:'manual-source-exclusion-v1',excluded_local_dates:manualDays.filter(p=>r.affected_local_dates.map(pgDay).includes(p.date)&&p.blockedDomains.some(d=>d===r.domain||d==='sleep'&&r.domain==='sleep_stage')).map(p=>p.date).sort()}},
    }));
    if (rows.length + health.length + bodyRecords.length + observationRecords.length > 5000) {
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
          ...bodyRecords,
          ...observationRecords,
        ],
        calculated_at: new Date().toISOString(),
      },
    });
    this.timings.push({
      date: day,
      records: rows.length + healthRecords.length + bodyRecords.length + observationRecords.length,
      elapsed_ms: performance.now() - begin,
    });
    return result.normalized.bundle;
  }
  // Shared by the authenticated scheduled worker and manual request drain. The
  // caller must own this exact lease; compute happens outside the publication lock.
  async processClaimedJob(job: Json, token: string) {
          const user = String(job.canonical_user_id), day = pgDay(job.score_date);
          if (!/^[0-9a-f-]{36}$/i.test(user) || !/^[0-9a-f-]{36}$/i.test(token)) throw Error('INVALID_SCORE_SCOPE');
          const bundle = await this.compute(user, day);
          const admin = pgAdmin(this.sql, this.verify, async (tx, args) => {
            const valid =
              await tx`select generation from private.beta_score_recompute_queue where canonical_user_id=${user} and score_date=${day} and generation=${job.generation} and lease_token=${token} and status='PROCESSING' and lease_expires_at>now() for update`;
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
            await tx`update private.beta_score_recompute_queue set engine_published_generation=${job.generation} where canonical_user_id=${user} and score_date=${day}`;
          });
          // Frozen original eight-score computation remains unchanged, including missing training/nutrition.
          const result = await recomputeBetaScore(admin, user, day,(rows,dates)=>this.frozenManualRows(rows,user,dates));
          if(result.status==='NOT_DIRTY'){
            const [current]=await this.sql`select generation,status,engine_published_generation from private.beta_score_recompute_queue where canonical_user_id=${user} and score_date=${day}`;
            if(current?.status==='COMPLETE'&&BigInt(current.generation)>=BigInt(job.generation)&&String(current.engine_published_generation)===String(current.generation))return {status:'SUPERSEDED',local_date:day};
          }
          if (!['PERSISTED','REPLAYED'].includes(String(result.status))) throw Error('STALE_SCORE_INPUT');
          return result;
  }
  // Canonical input projection only: the frozen formulas and weights stay intact.
  // A manual daily total never enters the native source-selection competition.
  async frozenManualRows(nativeRows:any[], user:string, dates:string[]):Promise<any[]> {
    const ordered=[...dates].sort(),start=ordered[0],end=ordered.at(-1)!;
    const observations=await this.sql`select * from public.engine_manual_observations where canonical_user_id=${user} and not deleted
      and (local_date between ${start}::date and ${end}::date or (domain='sleep' and local_date between ${start}::date-1 and ${end}::date+1)) limit 5001`;
    if(observations.length>5000)throw Error('SCORE_INPUT_BOUND_EXCEEDED');
    const blocked=new Map<string,Set<string>>(),added:any[]=[];
    for(const date of ordered){
      const projection=projectManualObservationDay(observations,nativeRows,date);
      const manual=observations.filter((r:Json)=>pgDay(r.local_date)===date);
      const block=(domain:string)=>{const set=blocked.get(date)||new Set<string>();set.add(domain);if(domain==='sleep')set.add('sleep_stage');blocked.set(date,set);};
      const add=async(domain:string,value:number,records:Json[])=>{
        const hash=await digest([...records].sort((a,b)=>String(a.body.recordId).localeCompare(String(b.body.recordId))).map(r=>r.body)),stamp=records.map(r=>new Date(r.updated_at).toISOString()).sort().at(-1)!;
        added.push({id:`manual:${domain}:${date}`,domain,source_app:'MANUAL_WEB',source_record_id:`manual:${domain}:${date}`,
          source_revision:Math.max(...records.map(r=>Number(r.revision))),source_updated_at:stamp,source_content_hash:hash,updated_at:stamp,
          affected_local_dates:[date],canonical_record:{value,recorded_at:date+'T00:00:00+08:00',provenance:'manual',date_anchor_only:true}});
      };
      for(const [domain,metric]of[['sleep',projection.sleep],['steps',projection.steps]] as const){
        if(metric.status==='SOURCE_CONFLICT'||metric.status.includes('CONFLICT')||metric.status==='OVERLAP_UNRESOLVED')block(domain);
        else if(metric.status==='AVAILABLE'&&metric.value!==null)await add(domain,metric.value,manual.filter((r:Json)=>r.domain===domain));
      }
    }
    // Remove only conflicting dates, not another valid day's native contribution.
    // Manual body retains its existing portable Body Engine adapter; it is not
    // introduced into the frozen 28-prior-day source-selection contract here.
    const projected=await Promise.all(nativeRows.map(async row=>{
      const retained=row.affected_local_dates.filter((date:string)=>!blocked.get(date)?.has(row.domain));
      if(retained.length===row.affected_local_dates.length)return row;
      return {...row,affected_local_dates:retained,source_content_hash:await digest({policy:'manual-source-exclusion-v1',original_hash:row.source_content_hash,original_dates:[...row.affected_local_dates].sort(),retained_dates:[...retained].sort()})};
    }));
    return [...projected.filter(row=>row.affected_local_dates.length),...added];
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
          const result=await this.processClaimedJob(job, token);
          if(result.status!=='SUPERSEDED')processed++;
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
  scheduleDrain(user: string) {
    // The raw mutation and its idempotency receipt are already durable before
    // this is called. Keep recomputation off the user-visible commit response,
    // while asking Supabase Edge Runtime to keep the bounded task alive.
    const waitUntil = (globalThis as any).EdgeRuntime?.waitUntil;
    if (typeof waitUntil === "function") waitUntil(this.drain(user).catch(() => undefined));
  }
  async snapshot(identity: Json, input: Json = {}) {
    const range = localReadRange(input);
    // One bounded REPEATABLE READ snapshot: queue, inputs and output head/history
    // cannot come from different committed revisions. Native reads still switch to RLS.
    const {pending,meals,history,heads}=await manualPrivilegedRead(this.sql,identity,async(tx:any)=>{
      const pending=await tx`select score_date,status,generation,engine_published_generation from private.beta_score_recompute_queue where canonical_user_id=${identity.canonical} and score_date between ${range.start}::date and ${range.end}::date`;
      await prepareManualRead(tx,identity);
      const meals=await this.readRows(tx,identity,'engine_meals',range);
      const history=await this.readRows(tx,identity,'engine_output_history',range);
      const heads=await this.readRows(tx,identity,'engine_output_heads',range);
      return {pending,meals,history,heads};
    },true);
    const publishedDates = new Set(pending.filter((r:Json)=>r.status==='COMPLETE'&&Number(r.engine_published_generation)>0&&String(r.engine_published_generation)===String(r.generation)).map((r: Json) => pgDay(r.score_date)));
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
        ...manualMealPresentation(r.body),
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
        !publishedDates.has(pgDay(r.calculation_date))
          ? {
            ...r.payload,
            persisted_score_status: r.payload.score_status,
            score_status: "STALE",
            stale_reason: "PUBLICATION_GENERATION_NOT_VERIFIED",
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
    const {rows,bodies,workouts,daily}=await manualPrivilegedRead(this.sql,identity,async(tx:any)=>{
      const rows=await tx`select s.*,q.status as queue_status,q.generation,q.engine_published_generation from public.beta_health_scores s left join private.beta_score_recompute_queue q using(canonical_user_id,score_date) where s.canonical_user_id=${identity.canonical} and s.score_date between ${range.start}::date and ${range.end}::date order by s.score_date`;
      const daily=await readPublishedDailySnapshot(tx,identity,input);
      const bodies=await tx`select body from public.engine_manual_body_records where canonical_user_id=${identity.canonical} and not deleted and local_date between ${range.start}::date and ${range.end}::date limit 367`;
      const workouts=this.exerciseEnabled?await tx`select body from public.manual_workout_sets where canonical_user_id=${identity.canonical} and not deleted and local_date between ${range.start}::date and ${range.end}::date limit 5001`:[];
      if(bodies.length>366||workouts.length>5000)throw Error('READ_BOUND_EXCEEDED');
      return {rows,bodies,workouts,daily};
    },true);
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
      const current=row.queue_status==='COMPLETE'&&Number(row.engine_published_generation)>0&&String(row.engine_published_generation)===String(row.generation);
      if (names[row.score_type]) entry[names[row.score_type]] = current?row.score:null;
      if (row.score_type === "health_overall") {
        entry.algorithmVersion = row.algorithm_version;
        entry.scoreMetadata = {
          completeness: current?row.completeness:null,
          confidence: current?row.confidence:null,
        };
        entry.healthStatus = current?row.status:'STALE';
      }
    }
    for(const {body}of bodies){const entry=days[body.date]??={date:body.date};entry.weight=body.weight;entry.bodyFatPercentage=body.bodyFat;entry.bodySource='MANUAL_WEB';}
    const grouped=new Map<string,Json[]>();for(const {body}of workouts)grouped.set(body.date,[...(grouped.get(body.date)||[]),body]);
    for(const [date,records]of grouped){const entry=days[date]??={date};entry.trainingSets=records.length;entry.trainingVolume=records.reduce((n,r)=>n+r.totalVolume,0);entry.trainingSessions=new Set(records.map(r=>r.sessionId)).size;}
    for(const domain of ['sleep','activity'] as const){for(const row of projectPublishedDaily(daily,domain)){
      const entry=days[row.date]??={date:row.date};
      if(domain==='sleep'){entry.sleepHours=row.totalSleepMinutes===null?null:row.totalSleepMinutes/60;entry.sleepScore=row.sleepScore;}
      else {entry.steps=row.coverage?.steps==='PARTIAL_DAY'?null:row.steps;entry.caloriesBurned=row.coverage?.totalEnergy==='PARTIAL_DAY'?null:row.totalCalories;entry.activityCoverage=row.coverage||null;}
    }}
    return Object.values(days).sort((a:any,b:any)=>a.date.localeCompare(b.date));
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
      const { action, payload = {} } = await readManualRequest(request),
        identity = await this.identity(request);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw Error("INVALID_PAYLOAD");
      rejectClientIdentity(payload);
      const dispatch=async()=>{
      const access=this.hosted?await readUserEntitlement(this.sql):{status:'LOCAL_SYNTHETIC',plan:null,isAllowed:true,reason:'ACCESS_GRANTED',expiresAt:null,graceUntil:null,capabilities:{can_view_dashboard:true,can_add_health_data:true,can_use_nutrition:true,can_use_training:true,can_use_analysis:true}};
      const accessBootstrap=new Set(['getAccessState','getCurrentUser','getManualProviderIdentity']);
      if(!accessBootstrap.has(action)&&!access.isAllowed)throw Error(access.reason);
      let data: any;
      if(action==='getAccessState')data=access;
      else if (["getExerciseDatabase", "getExerciseBodyParts", "getWorkoutRecords", "manageExercise", "addWorkoutRecord", "updateWorkoutSet", "deleteWorkoutSet", "getTrainingWriteStatus"].includes(action)) {
        if (!this.exerciseEnabled) throw Error("EXERCISE_MANAGEMENT_DISABLED");
        if (action === "getExerciseDatabase") data = await this.manualTraining.catalog(identity);
        else if (action === "getExerciseBodyParts") data = await this.manualTraining.bodyParts(identity);
        else if (action === "getWorkoutRecords") data = await this.manualTraining.workouts(identity, payload);
        else if (action === "getTrainingWriteStatus") data = await this.manualTraining.status(identity, payload);
        else data = await this.manualTraining.write(identity, action, payload);
      } else if (action === "getBodyRecords") {
        data = await this.manualBody.read(identity, payload);
      } else if (action === 'getManualObservations') {
        data = await this.manualObservations.read(identity,payload);
      } else if (action === 'getManualObservationDaily') {
        data = await this.manualObservations.daily(identity,payload);
      } else if (action === 'getObservationWriteStatus') {
        data = await this.manualObservations.status(identity,payload);
      } else if (action === 'upsertManualObservation' || action === 'deleteManualObservation') {
        data = await this.manualObservations.write(identity,payload,action==='deleteManualObservation');
        this.scheduleDrain(identity.canonical);
      } else if (["addBodyRecord", "upsertBodyRecord", "deleteBodyRecord"].includes(action)) {
        data = await this.manualBody.write(identity, payload, action === "deleteBodyRecord");
        this.scheduleDrain(identity.canonical);
      } else if (action === "getBodyWriteStatus") {
        data = await this.manualBody.status(identity, payload);
      } else if (action === "upsertMealRecord" || action === "deleteMealRecord") {
        data = await this.mutate(
          identity,
          payload,
          action === "deleteMealRecord",
        );
        this.scheduleDrain(identity.canonical);
        data = { ...data, status: "SAVED", analysisStatus: "ANALYSIS_PENDING" };
      } else if (action === "getManualProviderIdentity") {
        data={canonicalUserId:identity.canonical,provider:'postgresql-manual-v1',release:this.exerciseEnabled?'AB':'A',schemaVersion:'manual-sql-v1',access};
      } else if (action === "getCurrentUser") {
        data = {
          user: {
            userId: identity.canonical,
            ...(!this.hosted?{name:"Local synthetic " + (identity.kind==='web'?'Web session':identity.auth.slice(-1))}:{}),
          },access,
        };
      } else if (action === 'getUserProfile') {
        data=await manualPrivilegedRead(this.sql,identity,async(tx:any)=>{
          const [row]=await tx`select id,status from public.users where id=${identity.canonical}`;
          if(!row)throw Error('IDENTITY_NOT_FOUND');
          return {userId:row.id,status:row.status,profileDetails:null,profileDetailsStatus:'NOT_CONFIGURED'};
        });
      } else if (action === "localEngineSnapshot") {
        // An explicit consistency snapshot is allowed to wait for pending
        // recomputation; mutation responses themselves remain commit-fast.
        await this.drain(identity.canonical);
        data = await this.snapshot(identity, payload);
      } else if (action === "getNutritionRecords") {
        data = (await this.snapshot(identity, payload)).meals;
      } else if (action === "getSleepRecords" || action === "getActivityRecords") {
        data = await readPublishedDaily(this.sql, identity, action === 'getSleepRecords' ? 'sleep' : 'activity', payload);
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
          if(!this.exerciseEnabled)throw Error('EXERCISE_MANAGEMENT_DISABLED');
          data = { status: "SAVED", analysisStatus: "ANALYSIS_PENDING", analysisReason: "MANUAL_WORKOUT_ADAPTER_NOT_CONNECTED", analysisJobScheduled: false };
        } else if (payload.recordType === "body") {
          await this.drain(identity.canonical);
          data = {status:'SAVED',...await this.manualBody.analysis(identity,manualDate(payload.date??today()))};
        } else {
          if(payload.recordType&&!['nutrition','meal','sleep','steps','total_energy'].includes(payload.recordType))throw Error('MANUAL_ACTION_NOT_SUPPORTED');
          await this.drain(identity.canonical);
          data = await this.snapshot(identity, payload);
        }
      } else if (action === "getMealWriteStatus") {
        data = await this.mealWriteStatus(identity,payload);
      } else throw Error("LOCAL_ACTION_NOT_IMPLEMENTED");
      return Response.json({ ok: true, data }, {
        headers: { "cache-control": "no-store" },
      });
      };
      return this.sql.withWeb?await this.sql.withWeb(identity,dispatch):await dispatch();
    } catch (error) {
      const sqlCode = String((error as Json)?.code || "");
      const message = error instanceof Error ? error.message : "";
      const transactionConflict = ["40001", "40P01"].includes(sqlCode);
      const retryable = transactionConflict || message === "AUTH_SERVICE_UNAVAILABLE" || ["55P03", "57014", "25P03", "25P04", "08000", "08003", "08006", "57P01", "57P03", "53300", "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "ECONNREFUSED", "ECONNRESET"].includes(sqlCode);
      const code = transactionConflict ? "DB_CONFLICT_RETRYABLE" : message === "AUTH_SERVICE_UNAVAILABLE" ? message : ["23503", "23001"].includes(sqlCode) ? "EXERCISE_REFERENCED" : retryable ? "DB_TIMEOUT_RETRYABLE" : /^[A-Z_]+$/.test(message)
        ? message
        : "ENGINE_REQUEST_FAILED";
      return Response.json({ ok: false, error: code, retryable }, {
        status: retryable ? 503 : /^ACCESS_/.test(code) ? 403 : /IDENTITY|SESSION|AUTH|TOKEN/.test(code)
          ? 401
          : 400,
        headers: { "cache-control": "no-store" },
      });
    } finally { this.activeRequests--; }
  }
  async mealWriteStatus(identity:Json,payload:Json) {
    const receipt=await manualPrivilegedRead(this.sql,identity,tx=>tx`select response from private.engine_mutation_receipts where canonical_user_id=${identity.canonical} and request_id=${String(payload.clientRequestId)}`);
    return receipt.length?{exists:true,...receipt[0].response,record:manualMealPresentation(receipt[0].response.record)}:{exists:false};
  }
}
