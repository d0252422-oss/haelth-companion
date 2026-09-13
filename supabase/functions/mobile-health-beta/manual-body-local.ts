// Local opt-in adapter; not mobile ingestion and not a second identity system.
type Json = Record<string, any>;
import {prepareManualRead,prepareManualWrite,manualPrivilegedRead} from './manual-web-identity.ts';
// Mutation receipt is immutable. Current analysis is resolved from queue + output
// heads on read; the JSON saved with an observation is not a live job status.
export const manualBodyAnalysis = { analysisStatus: "ANALYSIS_PENDING", analysisReason: "RECOMPUTE_QUEUED", analysisJobScheduled: true };
export const manualBodyUnavailableAnalysis = {analysisStatus:'ANALYSIS_UNAVAILABLE',analysisReason:'ANALYSIS_STATUS_READ_FAILED',analysisJobScheduled:null,bodyScore:null};
export const localToday = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
export function manualDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error("INVALID_DATE");
  const time = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw Error("INVALID_DATE");
  return value;
}
export function localReadRange(input: Json = {}) {
  const end = manualDate(input.endDate ?? input.date ?? localToday());
  const start = manualDate(input.startDate ?? input.date ?? new Date(Date.parse(end) - 27 * 86400000).toISOString().slice(0, 10));
  if (end > localToday() || start > end || Date.parse(end) - Date.parse(start) > 365 * 86400000) throw Error("INVALID_DATE_RANGE");
  return { start, end };
}
export function rejectClientIdentity(input: Json) {
  for (const field of ["user_id", "userId", "canonical_user_id", "canonicalUserId", "owner_id", "subject_ref", "auth_user_id"]) {
    if (field in input) throw Error("CLIENT_IDENTITY_FORBIDDEN");
  }
}
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const sha = async (input: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(input))))).map(b => b.toString(16).padStart(2, "0")).join("");

export class ManualBodyLocalStore {
  constructor(private sql: any) {}
  async analysisRows(tx:any,user:string,start:string,end:string) {
    const queue=await tx`select score_date,status from private.beta_score_recompute_queue where canonical_user_id=${user} and score_date between ${start}::date and ${end}::date`;
    const outputs=await tx`select h.calculation_date,h.payload from public.engine_output_heads p join public.engine_output_history h using(canonical_user_id,calculation_date,output_kind,engine_version,input_fingerprint)
      where p.canonical_user_id=${user} and p.calculation_date between ${start}::date and ${end}::date and p.output_kind='body' and p.engine_version='body-score-v1.0'`;
    const date=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
    return (day:string)=>{
      const q=queue.find((r:Json)=>date(r.score_date)===day),out=outputs.find((r:Json)=>date(r.calculation_date)===day)?.payload;
      if(q&&q.status!=='COMPLETE')return {analysisStatus:q.status==='FAILED'?'ERROR':'ANALYSIS_PENDING',analysisReason:q.status==='FAILED'?'RECOMPUTE_FAILED':'RECOMPUTE_QUEUED',analysisJobScheduled:q.status!=='FAILED',bodyScore:null};
      if(!out)return {analysisStatus:'ANALYSIS_NOT_ENABLED',analysisReason:'NO_RECOMPUTE_EVIDENCE',analysisJobScheduled:false,bodyScore:null};
      return {analysisStatus:out.score_status==='INSUFFICIENT_DATA'?'INSUFFICIENT_DATA':'COMPUTED',analysisReason:out.score_status==='INSUFFICIENT_DATA'?'MISSING_BODY_BASELINE_OR_TARGET':'EXISTING_BODY_ENGINE',analysisJobScheduled:false,
        bodyScore:out.score,bodyScoreStatus:out.score_status,bodyEngineVersion:out.engine_version,bodyCompleteness:out.data_completeness,analysisValidation:'EXPERIMENTAL_UNVALIDATED',fatMass:out.metrics.daily.fat_mass,bodyMetrics:out.metrics.derived};
    };
  }
  async analysis(identity:Json,day:string){return await manualPrivilegedRead(this.sql,identity,async(tx:any)=>(await this.analysisRows(tx,identity.canonical,day,day))(day),true);}
  async read(identity: Json, input: Json = {}) {
    rejectClientIdentity(input);
    const { start, end } = localReadRange(input);
    return await manualPrivilegedRead(this.sql,identity,async (tx: any) => {
      const analysis=await this.analysisRows(tx,identity.canonical,start,end);
      await prepareManualRead(tx,identity);
      const rows = await tx`select body,revision from public.engine_manual_body_records
        where canonical_user_id=${identity.canonical} and not deleted and local_date between ${start}::date and ${end}::date order by local_date,record_id limit 367`;
      if (rows.length > 366) throw Error("READ_BOUND_EXCEEDED");
      return rows.map((r: Json) => ({ ...r.body, ...analysis(r.body.date), revision: Number(r.revision) }));
    },true);
  }
  async write(identity: Json, input: Json, remove = false) {
    rejectClientIdentity(input);
    if (!uuid(input.clientRequestId) || (input.recordId && !uuid(input.recordId))) throw Error("INVALID_MUTATION_ID");
    if (remove && !input.recordId) throw Error("BODY_RECORD_NOT_FOUND");
    // Hash the original request, not a server-generated record ID or normalized owner.
    const inputHash = await sha({ input, remove });
    return await this.sql.begin(async (tx: any) => {
      await prepareManualWrite(tx,identity);
      await tx`select pg_advisory_xact_lock(hashtextextended(${identity.canonical},0))`;
      const receipt = (await tx`select input_hash,response from private.engine_body_mutation_receipts where canonical_user_id=${identity.canonical} and request_id=${input.clientRequestId}`)[0];
      if (receipt) {
        if (receipt.input_hash !== inputHash) throw Error("REQUEST_ID_CONFLICT");
        return { ...receipt.response, replayed: true };
      }
      const id = input.recordId || crypto.randomUUID();
      const old = (await tx`select * from public.engine_manual_body_records where canonical_user_id=${identity.canonical} and record_id=${id} for update`)[0];
      if (input.recordId && !old) throw Error("BODY_RECORD_NOT_FOUND");
      if (old && old.deleted) throw Error("BODY_RECORD_DELETED");
      if (old && (!Number.isSafeInteger(input.revision) || input.revision !== Number(old.revision))) throw Error("STALE_REVISION");
      const date = remove ? old.body.date : manualDate(input.date);
      if (date > localToday()) throw Error("FUTURE_BODY_UNSUPPORTED");
      let weight = old?.body.weight, bodyFat = old?.body.bodyFat ?? null;
      if (!remove) {
        if ((typeof input.weight !== "number" && typeof input.weight !== "string") || String(input.weight).trim() === "") throw Error("INVALID_WEIGHT");
        weight = Number(input.weight);
        if (!Number.isFinite(weight) || weight < 20 || weight > 500) throw Error("INVALID_WEIGHT");
        bodyFat = input.bodyFat === null || input.bodyFat === undefined || (typeof input.bodyFat === "string" && input.bodyFat.trim() === "") ? null : Number(input.bodyFat);
        if (bodyFat !== null && ((typeof input.bodyFat !== "number" && typeof input.bodyFat !== "string") || !Number.isFinite(bodyFat) || bodyFat < 0 || bodyFat > 100)) throw Error("INVALID_BODY_FAT");
        const collision = await tx`select record_id from public.engine_manual_body_records where canonical_user_id=${identity.canonical} and local_date=${date} and not deleted and record_id<>${id}`;
        if (collision.length) throw Error("BODY_DATE_CONFLICT");
      }
      const revision = old ? Number(old.revision) + 1 : 1;
      const body = { recordId: id, date, weight, bodyFat, revision, source: "MANUAL_WEB", ...manualBodyAnalysis };
      await tx`insert into public.engine_manual_body_records(canonical_user_id,record_id,revision,local_date,deleted,body)
        values(${identity.canonical},${id},${revision},${date},${remove},${tx.json(body)})
        on conflict(canonical_user_id,record_id) do update set revision=excluded.revision,local_date=excluded.local_date,deleted=excluded.deleted,body=excluded.body,updated_at=now()`;
      const result = { record: body, recordId: id, deleted: remove, status: "SAVED", ...manualBodyAnalysis };
      await tx`insert into private.engine_body_mutation_receipts values(${identity.canonical},${input.clientRequestId},${inputHash},${tx.json(result)})`;
      return result;
    });
  }
  async status(identity: Json, input: Json) {
    rejectClientIdentity(input);
    if (!uuid(input.clientRequestId)) throw Error("INVALID_MUTATION_ID");
    const rows = await manualPrivilegedRead(this.sql,identity,tx=>tx`select response from private.engine_body_mutation_receipts where canonical_user_id=${identity.canonical} and request_id=${input.clientRequestId}`);
    if(!rows.length)return {exists:false};
    // The verified receipt was read successfully; optional analysis cannot erase
    // proof of a committed write. A new raw/analysis read may still fail closed.
    let state:Json;try{state=await this.analysis(identity,rows[0].response.record.date);}catch{state=manualBodyUnavailableAnalysis;}
    return {exists:true,...rows[0].response,...state,record:{...rows[0].response.record,...state}};
  }
}
