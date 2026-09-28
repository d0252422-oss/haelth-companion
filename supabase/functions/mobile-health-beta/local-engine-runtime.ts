// Shared SQL semantics. Local and hosted constructors have separate configuration boundaries.
import postgres from "npm:postgres@3.4.8";
import { CANONICAL_ENGINE_INPUT_LIMIT, PortableEngineRuntime } from "./engine-portable.ts";
import { authenticateNativeUser, resolveNativeIdentity } from "./index.ts";
import { NormalizedHealthRow, normalizeScoreHealthRows, recomputeBetaScore, selectScoreSourceRowsForDate } from "./score-bridge.ts";
import { ManualBodyLocalStore, localReadRange, manualDate, rejectClientIdentity } from "./manual-body-local.ts";
import {manualBodyEngineRecords} from './manual-body-engine.ts';
import { ManualTrainingLocalStore } from "./manual-training-local.ts";
import {resolveVerifiedManualWebIdentity,prepareManualRead,prepareManualWrite,manualPrivilegedRead} from './manual-web-identity.ts';
import {readManualRequest} from './manual-request-body.ts';
import {readPublishedDaily,readPublishedDailySnapshot,projectPublishedDaily} from './manual-daily-read.ts';
import {ManualObservationsLocalStore} from './manual-observations-local.ts';
import {observationEngineProjection,projectManualObservationDay} from './manual-observation-projection.ts';
import {readUserEntitlement} from './entitlement.ts';

type Json = Record<string, any>;
// Keep the hosted engine aligned with score-bridge.ts. The previous 5k cap
// rejected normal 28-day Health Connect histories (mostly interval steps),
// while the canonical bridge already pages and validates up to 20k rows.
export const SCORE_ENGINE_INPUT_LIMIT=CANONICAL_ENGINE_INPUT_LIMIT;
export function assertScoreEngineInputBound(...counts:number[]):number{
  if(counts.some(count=>!Number.isSafeInteger(count)||count<0)||counts.reduce((sum,count)=>sum+count,0)>SCORE_ENGINE_INPUT_LIMIT)throw Error('SCORE_INPUT_BOUND_EXCEEDED');
  return counts.reduce((sum,count)=>sum+count,0);
}
const manualMealTypes:Record<string,string>={
  '早餐':'早餐',BREAKFAST:'早餐','午餐':'午餐',LUNCH:'午餐','晚餐':'晚餐',DINNER:'晚餐',
  '點心':'點心','点心':'點心',SNACK:'點心','宵夜':'宵夜',LATE_NIGHT:'宵夜','LATE-NIGHT':'宵夜','LATE NIGHT':'宵夜',
};
export function normalizeManualMealType(value:unknown,strict=true):string {
  const raw=String(value??'').trim(),canonical=manualMealTypes[raw]??manualMealTypes[raw.toUpperCase()];
  if(canonical)return canonical;
  if(strict)throw Error('INVALID_MEAL_TYPE');
  return raw||'午餐';
}
// Presentation completeness is not confirmation, a new engine rule, or a
// historical data rewrite. Preserve every known/null nutrient and provenance.
export function manualMealPresentation(body:Json):Json {
  const complete=body.userConfirmed===true&&['calories','protein','carbs','fat'].every(key=>typeof body[key]==='number'&&Number.isFinite(body[key])&&body[key]>=0);
  const included=body.includedInTotals===false?false:complete;
  return {...body,mealType:normalizeManualMealType(body.mealType,false),includedInTotals:included,nutritionCompleteness:body.userConfirmed!==true?'UNCONFIRMED':complete?'COMPLETE':'INCOMPLETE'};
}
function normalizedPersistedMealTimestamp(value:unknown):string {
  if(typeof value!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}(?::?[0-9]{2})?)$/i.test(value.trim()))throw Error('INVALID_MEAL_RECORD');
  const normalized=value.trim().replace(/^([0-9]{4}-[0-9]{2}-[0-9]{2}) /,'$1T').replace(/([+-][0-9]{2})$/,'$1:00').replace(/([+-][0-9]{2})([0-9]{2})$/,'$1:$2'),instant=Date.parse(normalized);
  if(!Number.isFinite(instant))throw Error('INVALID_MEAL_RECORD');
  return normalized;
}
export function manualMealEngineRecords(rows:Json[]):Json[] {
  return rows.filter(row=>manualMealPresentation(row.body??{}).includedInTotals===true).map(row=>{
    const record=row.canonical_record;
    if(!record||typeof record!=='object'||record.domain!=='nutrition')throw Error('INVALID_MEAL_RECORD');
    if(!record.payload||typeof record.payload!=='object')throw Error('INVALID_MEAL_RECORD');
    return {...record,
      recorded_at:normalizedPersistedMealTimestamp(record.recorded_at),updated_at:normalizedPersistedMealTimestamp(record.updated_at),
      payload:{...record.payload,meal:normalizeManualMealType(record.payload.meal,false),meal_time:normalizedPersistedMealTimestamp(record.payload.meal_time)}};
  });
}
export function preservedManualMealExclusion(previous:Json={}):false|undefined {
  const presented=manualMealPresentation(previous);
  return presented.includedInTotals===false&&presented.nutritionCompleteness==='COMPLETE'?false:undefined;
}
const manualMealNutrientLimits:Json={calories:100000,protein:10000,carbs:10000,fat:10000,fiber:10000,sodium:10000000};
const manualMealNutrientFields:Record<string,string>={calories:'calories',protein:'protein_g',carbs:'carbs_g',fat:'fat_g',fiber:'fiber_g',sodium:'sodium_mg'};
export function resolveManualMealLabelValues(input:Json,previous:Json={},labelMode=false):Json|null {
  if(!labelMode)return null;
  const values:Json={};
  for(const ui of Object.keys(manualMealNutrientFields)){
    const candidate=Object.hasOwn(input,ui)?input[ui]:previous?.labelValues?.[ui];
    const raw=typeof candidate==='string'?candidate.trim():candidate;
    const value=raw===null||raw===undefined||raw===''?null:Number(raw);
    if(value!==null&&(!Number.isFinite(value)||value<0||value>manualMealNutrientLimits[ui]))throw Error('INVALID_NUTRIENT');
    values[ui]=value;
  }
  return values;
}
export function resolveManualMealNutrients(input:Json,previous:Json={},labelMode=false,grams=NaN):Json {
  const nutrients:Json={},labelValues=resolveManualMealLabelValues(input,previous,labelMode);
  for(const [ui,key] of Object.entries(manualMealNutrientFields)){
    // The normal edit UI intentionally exposes only kcal/P/C/F. Omitted
    // nutrient fields are PATCH semantics, while explicit null/blank clears.
    // Label-mode values are per-100g: omitted fields must be rescaled from the
    // stored label, never preserved as a stale total after portion changes.
    if(labelMode){
      const value=labelValues?.[ui]??null,final=value===null?null:value*grams/100;
      if(final!==null&&(!Number.isFinite(final)||final>manualMealNutrientLimits[ui]))throw Error('INVALID_NUTRIENT');
      nutrients[key]=final;
      continue;
    }
    if(!Object.hasOwn(input,ui)){
      nutrients[key]=typeof previous?.[ui]==='number'&&Number.isFinite(previous[ui])?previous[ui]:null;
      continue;
    }
    const raw=typeof input[ui]==='string'?input[ui].trim():input[ui];
    const n=raw===null||raw===undefined||raw===''?null:Number(raw);
    const final=n===null?null:n*(labelMode?grams/100:1);
    if(n!==null&&(!Number.isFinite(n)||n<0||n>manualMealNutrientLimits[ui]||(final!==null&&final>manualMealNutrientLimits[ui])))throw Error('INVALID_NUTRIENT');
    nutrients[key]=final;
  }
  return nutrients;
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

export function mergeHealthQueueState(days: Json, queueRows: Json[]) {
  for (const row of queueRows) {
    const date=pgDay(row.score_date),entry=days[date]??={date};
    const current=row.status==='COMPLETE'&&Number(row.engine_published_generation)>0&&String(row.engine_published_generation)===String(row.generation);
    if(current){
      if(!Object.hasOwn(entry,'healthStatus')){entry.healthStatus='STALE';entry.healthStaleReason='PUBLISHED_OUTPUT_NOT_CURRENT';}
      continue;
    }
    entry.healthStatus='STALE';
    entry.healthStaleReason=row.status==='FAILED'?'RECOMPUTE_FAILED':row.status!=='COMPLETE'?'RECOMPUTE_PENDING':'PUBLICATION_GENERATION_NOT_VERIFIED';
  }
  return days;
}

export function healthTimelineNeedsScoreDrain(rows: Json[]): boolean {
  return rows.some((row) => row?.healthStaleReason === "RECOMPUTE_PENDING");
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
  private scoreDrainTasks = new Map<string, Promise<void>>();
  private scoreDrainRerun = new Set<string>();
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
    const allowed=new Set(['clientRequestId','mealRecordId','revision','date','time','mealType','foodName','userConfirmed',
      'calories','protein','carbs','fat','fiber','sodium','labelMode','weightGrams','referenceSource']);
    if(Object.keys(input).some(key=>!allowed.has(key)))throw Error('INVALID_MEAL_FIELD');
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
      const time = String(input.time || old?.body.time || "12:00");
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Error("INVALID_TIME");
      const at = date + "T" + time + ":00+08:00";
      const labelMode = input.labelMode === true,
        grams = Number(input.weightGrams);
      const referenceSource=String(input.referenceSource??'').trim().normalize('NFC');
      if (
        labelMode &&
        (!Number.isFinite(grams) || grams <= 0 || grams > 10000 ||
          !referenceSource||[...referenceSource].length>280)
      ) throw Error("LABEL_PROVENANCE_REQUIRED");
      const nutrients=resolveManualMealNutrients(input,old?.body||{},labelMode,grams);
      const labelValues=resolveManualMealLabelValues(input,old?.body||{},labelMode);
      const mealType=normalizeManualMealType(input.mealType??old?.body.mealType??'午餐');
      const foodName=String(input.foodName??old?.body.foodName??'').trim().normalize('NFC').replace(/\s+/gu,' ');
      if(!remove&&(!foodName||[...foodName].length>200||/[\p{Cc}\p{Cf}]/u.test(foodName)))throw Error('INVALID_FOOD_NAME');
      const body = manualMealPresentation(remove ? old.body : {
        mealRecordId: mealId,
        revision,
        date,
        time,
        mealType,
        foodName,
        calories: nutrients.calories,
        protein: nutrients.protein_g,
        carbs: nutrients.carbs_g,
        fat: nutrients.fat_g,
        fiber: nutrients.fiber_g,
        sodium: nutrients.sodium_mg,
        labelMode,
        weightGrams:labelMode?grams:null,
        referenceSource:labelMode?referenceSource:null,
        labelValues,
        includedInTotals:preservedManualMealExclusion(old?.body||{}),
        userConfirmed: input.userConfirmed === true,
        nutritionSource: labelMode
          ? "USER_LABEL_PER_100G"
          : "CONFIRMED_MANUAL_TOTALS",
        dataSource:'MANUAL_WEB',
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
          meal: mealType,
          meal_time: at,
          confirmed: input.userConfirmed === true,
          food_items: [{
            item_id: mealId,
            raw_name: foodName,
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
        deleted: remove,
        operation: remove ? "DELETE" : "UPSERT",
      };
      await tx`insert into private.engine_mutation_receipts values(${identity.canonical},${requestId},${hash},${
        tx.json(result)
      })`;
      return result;
    });
  }
  private async computeClaimedJob(user: string, day: string) {
    const begin = performance.now();
    const {rows,health,body,observations}=await this.sql.begin('isolation level repeatable read read only',async(tx:any)=>{
      const rows=await tx`select body,canonical_record from public.engine_meals where canonical_user_id=${user} and not deleted and local_date between ${day}::date-27 and ${day}::date limit ${SCORE_ENGINE_INPUT_LIMIT+1}`;
      const health=await tx`select id,domain,source_app,source_record_id,source_revision,source_updated_at,source_content_hash,canonical_record,affected_local_dates,updated_at
      from public.beta_health_records where canonical_user_id=${user} and operation='UPSERT' and invalidated_at is null
      and domain in ('steps','sleep','sleep_stage','weight','hrv','resting_heart_rate')
      and affected_local_dates && array(select generate_series(${day}::date-28,${day}::date,'1 day')::date)
      order by updated_at,id limit ${SCORE_ENGINE_INPUT_LIMIT+1}`;
      const body=await tx`select * from public.engine_manual_body_records where canonical_user_id=${user} and not deleted and local_date between ${day}::date-27 and ${day}::date limit 29`;
      if(body.length>28)throw Error('SCORE_INPUT_BOUND_EXCEEDED');
      const observations=await tx`select * from public.engine_manual_observations where canonical_user_id=${user} and not deleted
        and (local_date between ${day}::date-27 and ${day}::date or (domain='sleep' and local_date between ${day}::date-28 and ${day}::date+1)) limit ${SCORE_ENGINE_INPUT_LIMIT+1}`;
      assertScoreEngineInputBound(rows.length,health.length,body.length,observations.length);
      return {rows,health,body,observations};
    });
    const normalizedHealth=normalizeScoreHealthRows(health as Array<Json & {
      affected_local_dates:Array<string|Date>;domain:string;source_app:string;source_updated_at?:string|null;updated_at:string;
    }>) as Array<Json & {affected_local_dates:string[];domain:string;source_app:string;source_updated_at?:string|null;updated_at:string}>;
    // Portable derived metrics use 28 days including the requested day. The
    // extra oldest date is loaded only so the frozen bridge can reuse its
    // existing 29-day input contract instead of issuing a second large query.
    const portableWindowStart=new Date(Date.parse(day)-27*86400000).toISOString().slice(0,10);
    const portableHealth=normalizedHealth.filter(row=>row.affected_local_dates.some(date=>date>=portableWindowStart&&date<=day));
    const selectedHealth=selectScoreSourceRowsForDate(portableHealth,day);
    const bodyRecords=manualBodyEngineRecords(body.map((row:Json)=>({...row,body:{...row.body,date:pgDay(row.local_date)}})),user);
    const windowStart=new Date(Date.parse(day)-27*86400000).toISOString().slice(0,10);
    const manualDays=[...new Set<string>(observations.map((r:Json)=>pgDay(r.local_date)))].filter(date=>date>=windowStart&&date<=day).map(date=>({date,...observationEngineProjection(observations,normalizedHealth,user,date)}));
    const observationRecords=manualDays.flatMap(p=>p.records);
    const mealRecords=manualMealEngineRecords(rows);
    // Align the portable daily publication with the frozen score bridge's
    // existing deterministic per-domain source selection. Additive Health
    // Connect domains (notably steps) must never be summed across mirrored
    // Xiaomi/Fit/bridge sources or discarded as ambiguous.
    const healthRecords = selectedHealth.map((r: Json) => ({
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
    assertScoreEngineInputBound(rows.length,health.length,bodyRecords.length,observationRecords.length);
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
          ...mealRecords,
          ...healthRecords,
          ...bodyRecords,
          ...observationRecords,
        ],
        calculated_at: new Date().toISOString(),
      },
    });
    this.timings.push({
      date: day,
      records: mealRecords.length + healthRecords.length + bodyRecords.length + observationRecords.length,
      elapsed_ms: performance.now() - begin,
    });
    return {bundle:result.normalized.bundle,nativeRows:normalizedHealth};
  }
  async compute(user: string, day: string) {
    return (await this.computeClaimedJob(user, day)).bundle;
  }
  // Shared by the authenticated scheduled worker and manual request drain. The
  // caller must own this exact lease; compute happens outside the publication lock.
  async processClaimedJob(job: Json, token: string) {
          const user = String(job.canonical_user_id), day = pgDay(job.score_date);
          if (!/^[0-9a-f-]{36}$/i.test(user) || !/^[0-9a-f-]{36}$/i.test(token)) throw Error('INVALID_SCORE_SCOPE');
          const {bundle,nativeRows} = await this.computeClaimedJob(user, day);
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
          const result = await recomputeBetaScore(
            admin,
            user,
            day,
            (rows,dates)=>this.frozenManualRows(rows,user,dates),
            {userId:user,startDate:new Date(Date.parse(day)-28*86400000).toISOString().slice(0,10),endDate:day,rows:nativeRows as NormalizedHealthRow[]},
          );
          if(result.status==='NOT_DIRTY'){
            const [current]=await this.sql`select generation,status,engine_published_generation from private.beta_score_recompute_queue where canonical_user_id=${user} and score_date=${day}`;
            if(current?.status==='COMPLETE'&&BigInt(current.generation)>=BigInt(job.generation)&&String(current.engine_published_generation)===String(current.generation))return {status:'SUPERSEDED',local_date:day};
          }
          if (!['PERSISTED','REPLAYED'].includes(String(result.status))) throw Error('STALE_SCORE_INPUT');
          return result;
  }
  // Canonical input projection only: the frozen formulas and weights stay intact.
  // A manual daily total never enters the native source-selection competition.
  async frozenManualRows(normalizedNativeRows:NormalizedHealthRow[], user:string, dates:string[]):Promise<NormalizedHealthRow[]> {
    const ordered=[...dates].sort(),start=ordered[0],end=ordered.at(-1)!;
    const observations=await this.sql`select * from public.engine_manual_observations where canonical_user_id=${user} and not deleted
      and (local_date between ${start}::date and ${end}::date or (domain='sleep' and local_date between ${start}::date-1 and ${end}::date+1)) limit 5001`;
    if(observations.length>5000)throw Error('SCORE_INPUT_BOUND_EXCEEDED');
    const blocked=new Map<string,Set<string>>(),added:any[]=[];
    for(const date of ordered){
      const projection=projectManualObservationDay(observations,normalizedNativeRows,date);
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
    const projected=await Promise.all(normalizedNativeRows.map(async row=>{
      const retained=row.affected_local_dates.filter((date:string)=>!blocked.get(date)?.has(row.domain));
      if(retained.length===row.affected_local_dates.length)return row;
      return {...row,affected_local_dates:retained,source_content_hash:await digest({policy:'manual-source-exclusion-v1',original_hash:row.source_content_hash,original_dates:[...row.affected_local_dates].sort(),retained_dates:[...retained].sort()})};
    }));
    return [...projected.filter(row=>row.affected_local_dates.length),...added];
  }
  async drain(user: string, maxPages = 8, pageSize = 5) {
    const token = crypto.randomUUID();
    let processed = 0;
    for (let page = 0; page < maxPages; page++) {
      const jobs = await this
        .sql`select * from public.beta_claim_score_recompute(${token},${user},${pageSize})`;
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
  scheduleDrain(user: string): boolean {
    // The raw mutation and its idempotency receipt are already durable before
    // this is called. Keep recomputation off the user-visible commit response,
    // while asking Supabase Edge Runtime to keep the bounded task alive.
    const waitUntil = (globalThis as any).EdgeRuntime?.waitUntil;
    if (typeof waitUntil !== "function") return false;
    if (this.scoreDrainTasks.has(user)) {
      // Coalesce a mutation that lands while the current generation is being
      // computed. The active lease will be rejected as stale and this latch
      // guarantees that the new generation receives a fresh bounded attempt.
      this.scoreDrainRerun.add(user);
      return false;
    }
    // Claim exactly one job per Edge task. Claiming siblings up front can
    // strand them in PROCESSING when the first job fails or exhausts CPU.
    const task: Promise<void> = this.drain(user, 1, 1)
      .then(() => undefined)
      .catch(() => { console.error("SCORE_BACKGROUND_RECOMPUTE_FAILED"); })
      .finally(() => {
        if (this.scoreDrainTasks.get(user) !== task) return;
        const rerun = this.scoreDrainRerun.delete(user);
        this.scoreDrainTasks.delete(user);
        if (rerun) this.scheduleDrain(user);
      });
    this.scoreDrainTasks.set(user, task);
    waitUntil(task);
    return true;
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
        date: pgDay(r.local_date),
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
  async nutritionRecords(identity: Json, input: Json = {}) {
    rejectClientIdentity(input);
    const range=localReadRange(input);
    const rows=await this.sql.begin(async(tx:any)=>{
      // Native reads retain authenticated/RLS semantics; hosted Web reads
      // validate the server-derived identity mapping exactly once here.
      await prepareManualRead(tx,identity);
      const meals=await tx`select body,revision,local_date::text as local_meal_date
        from public.engine_meals
        where canonical_user_id=${identity.canonical}
          and not deleted
          and local_date between ${range.start}::date and ${range.end}::date
        order by local_date asc,coalesce(body->>'time','') asc,meal_id asc
        limit 5001`;
      if(meals.length>5000)throw Error('READ_BOUND_EXCEEDED');
      return meals;
    });
    return rows.map((row:Json)=>({
      ...manualMealPresentation(row.body??{}),
      date:manualDate(String(row.local_meal_date)),
      revision:Number(row.revision),
    }));
  }
  async legacyTimeline(identity: Json, input: Json = {}) {
    const range = localReadRange(input);
    // Privileged repository access is always scoped by verified canonical identity.
    const {rows,queue,bodies,workouts,meals,daily}=await manualPrivilegedRead(this.sql,identity,async(tx:any)=>{
      const rows=await tx`select s.*,q.status as queue_status,q.generation,q.engine_published_generation from public.beta_health_scores s left join private.beta_score_recompute_queue q using(canonical_user_id,score_date) where s.canonical_user_id=${identity.canonical} and s.score_date between ${range.start}::date and ${range.end}::date order by s.score_date`;
      const queue=await tx`select score_date,status,generation,engine_published_generation from private.beta_score_recompute_queue where canonical_user_id=${identity.canonical} and score_date between ${range.start}::date and ${range.end}::date order by score_date`;
      const daily=await readPublishedDailySnapshot(tx,identity,input);
      const bodies=await tx`select body,local_date::text as local_record_date from public.engine_manual_body_records where canonical_user_id=${identity.canonical} and not deleted and local_date between ${range.start}::date and ${range.end}::date limit 367`;
      const workouts=this.exerciseEnabled?await tx`select body,record_id,exercise_id,session_id,local_date::text as local_training_date
        from public.manual_workout_sets where canonical_user_id=${identity.canonical} and not deleted and local_date between ${range.start}::date and ${range.end}::date limit 5001`:[];
      const meals=await tx`select body,revision,local_date::text as local_meal_date from public.engine_meals
        where canonical_user_id=${identity.canonical} and not deleted and local_date between ${range.start}::date and ${range.end}::date limit 5001`;
      if(bodies.length>366||workouts.length>5000||meals.length>5000)throw Error('READ_BOUND_EXCEEDED');
      return {rows,queue,bodies,workouts,meals,daily};
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
        entry.healthStaleReason = current?null:!row.queue_status?'PUBLICATION_GENERATION_NOT_VERIFIED':row.queue_status==='FAILED'?'RECOMPUTE_FAILED':row.queue_status!=='COMPLETE'?'RECOMPUTE_PENDING':Number(row.engine_published_generation)<=0||String(row.engine_published_generation)!==String(row.generation)?'PUBLICATION_GENERATION_NOT_VERIFIED':'PUBLISHED_OUTPUT_NOT_CURRENT';
      }
    }
    mergeHealthQueueState(days,queue);
    for(const {body,local_record_date}of bodies){const entry=days[local_record_date]??={date:local_record_date};entry.weight=body.weight;entry.bodyFatPercentage=body.bodyFat;entry.bodySource='MANUAL_WEB';if(typeof body.weight==='number')entry.weightSource='MANUAL_WEB';if(typeof body.bodyFat==='number')entry.bodyFatPercentageSource='MANUAL_WEB';}
    const grouped=new Map<string,Json[]>();for(const row of workouts){const body={...row.body,recordId:row.record_id,exerciseId:row.exercise_id,sessionId:row.session_id,date:row.local_training_date};grouped.set(body.date,[...(grouped.get(body.date)||[]),body]);}
    for(const [date,records]of grouped){const entry=days[date]??={date};entry.trainingSets=records.length;entry.trainingVolume=records.reduce((n,r)=>n+r.totalVolume,0);entry.trainingSessions=new Set(records.map(r=>r.sessionId)).size;}
    const mealsByDate=new Map<string,Json[]>();for(const row of meals){const meal={...manualMealPresentation(row.body),date:row.local_meal_date,revision:Number(row.revision)};mealsByDate.set(meal.date,[...(mealsByDate.get(meal.date)||[]),meal]);}
    for(const [date,records]of mealsByDate){const entry=days[date]??={date},included=records.filter(record=>record.includedInTotals===true);for(const [target,key]of [['caloriesIntake','calories'],['protein','protein'],['carbs','carbs'],['fat','fat']] as const){const values=included.map(r=>r[key]);entry[target]=values.length&&values.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0)?values.reduce((sum,value)=>sum+value,0):null;}entry.nutritionMealCount=records.length;entry.nutritionSource=included.length?'MANUAL_WEB_CONFIRMED':'MANUAL_WEB_NOT_INCLUDED';}
    for(const domain of ['sleep','activity'] as const){for(const row of projectPublishedDaily(daily,domain)){
      const entry=days[row.date]??={date:row.date};
      if(domain==='sleep'){entry.sleepHours=row.totalSleepMinutes===null?null:row.totalSleepMinutes/60;entry.sleepScore=row.sleepScore;entry.sleepSource=row.sleepSource??row.source;entry.sleepDataStatus=row.dataStatus;entry.sleepAnalysisDataStatus=row.analysisDataStatus??row.dataStatus;entry.sleepStaleReason=row.staleReason??null;entry.sleepAnalysisStaleReason=row.analysisStaleReason??row.staleReason??null;}
      else {entry.steps=row.coverage?.steps==='PARTIAL_DAY'?null:row.steps;entry.caloriesBurned=row.coverage?.totalEnergy==='PARTIAL_DAY'?null:row.totalCalories;entry.heartRate=row.heartRate;entry.hrv=row.hrv;entry.spo2=row.spo2;if(Number.isFinite(row.weight)&&!Number.isFinite(entry.weight)){entry.weight=row.weight;entry.weightSource=row.weightSource??row.source;}if(Number.isFinite(row.bodyFatPercentage)&&!Number.isFinite(entry.bodyFatPercentage)){entry.bodyFatPercentage=row.bodyFatPercentage;entry.bodyFatPercentageSource=row.bodyFatPercentageSource??row.source;}entry.stepsSource=row.stepsSource??(row.steps===null?null:row.source);entry.caloriesBurnedSource=row.totalEnergySource??(row.totalCalories===null?null:row.source);entry.heartRateSource=row.heartRateSource??(row.heartRate===null?null:row.source);entry.hrvSource=row.hrvSource??(row.hrv===null?null:row.source);entry.spo2Source=row.spo2Source??(row.spo2===null?null:row.source);entry.activityCoverage=row.coverage||null;entry.activitySource=entry.stepsSource??entry.caloriesBurnedSource??null;entry.cardioSource=entry.heartRateSource??entry.hrvSource??entry.spo2Source??null;entry.activityDataStatus=row.dataStatus;entry.activityAnalysisDataStatus=row.analysisDataStatus??row.dataStatus;entry.activityStaleReason=row.staleReason??null;entry.activityAnalysisStaleReason=row.analysisStaleReason??row.staleReason??null;}
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
      else if (["getExerciseDatabase", "getExerciseBodyParts", "getWorkoutRecords", "manageExercise", "addWorkoutRecord", "updateWorkoutSet", "updateWorkoutSets", "deleteWorkoutSet", "getTrainingWriteStatus"].includes(action)) {
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
        if(data.recomputeScheduled!==false)this.scheduleDrain(identity.canonical);
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
        data = await this.nutritionRecords(identity, payload);
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
        const timeline = await this.legacyTimeline(identity, payload);
        if (healthTimelineNeedsScoreDrain(timeline)) this.scheduleDrain(identity.canonical);
        data = { timeline };
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
      const failure = classifyManualRuntimeError(error);
      return Response.json({ ok: false, error: failure.code, retryable: failure.retryable }, {
        status: failure.status,
        headers: { "cache-control": "no-store" },
      });
    } finally { this.activeRequests--; }
  }
  async mealWriteStatus(identity:Json,payload:Json) {
    const requestId=String(payload.clientRequestId||'');
    if(!/^[0-9a-f-]{36}$/.test(requestId))throw Error('INVALID_MUTATION_ID');
    const receipt=await manualPrivilegedRead(this.sql,identity,tx=>tx`select response from private.engine_mutation_receipts where canonical_user_id=${identity.canonical} and request_id=${requestId}`);
    return receipt.length?{exists:true,...receipt[0].response,status:'SAVED',record:manualMealPresentation(receipt[0].response.record)}:{exists:false};
  }
}

export function classifyManualRuntimeError(error: unknown) {
  const sqlCode = String((error as Json)?.code || "");
  const message = error instanceof Error ? error.message : "";
  const transactionConflict = ["40001", "40P01"].includes(sqlCode);
  const schemaMismatch = ["42703", "42P01"].includes(sqlCode);
  const retryable = transactionConflict || message === "AUTH_SERVICE_UNAVAILABLE" || ["55P03", "57014", "25P03", "25P04", "08000", "08003", "08006", "57P01", "57P03", "53300", "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "ECONNREFUSED", "ECONNRESET"].includes(sqlCode);
  const code = schemaMismatch ? "MANUAL_SCHEMA_OUT_OF_DATE" : transactionConflict ? "DB_CONFLICT_RETRYABLE" : message === "AUTH_SERVICE_UNAVAILABLE" ? message : ["23503", "23001"].includes(sqlCode) ? "EXERCISE_REFERENCED" : retryable ? "DB_TIMEOUT_RETRYABLE" : /^[A-Z_]+$/.test(message)
    ? message
    : "ENGINE_REQUEST_FAILED";
  const status = schemaMismatch || retryable ? 503 : code === "ENGINE_REQUEST_FAILED" ? 500 : /^ACCESS_/.test(code) ? 403 : /IDENTITY|SESSION|AUTH|TOKEN/.test(code)
    ? 401
    : 400;
  return { code, retryable, status };
}
