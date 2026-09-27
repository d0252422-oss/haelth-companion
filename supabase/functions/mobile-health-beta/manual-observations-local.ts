// Canonical manual observations: same identity, transaction, queue and SQL provider.
// No native ingestion impersonation, score fabrication, alternate storage or dual write.
import {localReadRange, localToday, manualDate, rejectClientIdentity} from './manual-body-local.ts';
import {manualPrivilegedRead, prepareManualRead, prepareManualWrite} from './manual-web-identity.ts';
import {observationAnalysisPlan, observationReadState, observationPublishedAnalysis, projectManualObservationDay, timedSleepOverlaps} from './manual-observation-projection.ts';
type Json = Record<string, any>;
const domains = ['sleep', 'steps', 'total_energy'];
const maximumValues: Record<string, number> = {sleep: 1440, steps: 200000, total_energy: 30000};
const own = (o: Json, key: string) => Object.prototype.hasOwnProperty.call(o, key);
const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const sha = async (input: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input))))).map(b => b.toString(16).padStart(2, '0')).join('');
const dayString = (v: any) => v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
export const storedObservationLocalDate = (value: unknown) => manualDate(dayString(value));
const timeInTaipei = (value: string) => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(value));
function note(value: unknown, bound: number) {
  if (value === null) return null;
  if (typeof value !== 'string' || [...value].length > bound || [...value].some(c => {const n = c.codePointAt(0)!; return n === 127 || n < 32 && n !== 9 && n !== 10 && n !== 13;})) throw Error('INVALID_OBSERVATION_NOTE');
  return value.trim().normalize('NFC');
}
function instant(value: unknown) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw Error('INVALID_OBSERVATION_TIME');
  manualDate(value.slice(0, 10));
  const n = Date.parse(value);
  if (!Number.isFinite(n)) throw Error('INVALID_OBSERVATION_TIME');
  return new Date(n).toISOString();
}
export function normalizeManualObservation(input: Json, previous?: Json, today = localToday()) {
  rejectClientIdentity(input);
  const allowed = ['clientRequestId', 'recordId', 'revision', 'domain', 'date', 'timezone', 'value', 'coverage', 'cutoffTime', 'startedAt', 'endedAt', 'note', 'sourceNote'];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw Error('UNKNOWN_OBSERVATION_FIELD');
  const pick = (key: string, fallback: any = null) => own(input, key) ? input[key] : previous?.[key] ?? fallback;
  const domain = pick('domain');
  if (!domains.includes(domain) || previous && domain !== previous.domain) throw Error('INVALID_OBSERVATION_DOMAIN');
  const date = manualDate(pick('date'));
  if (date > today) throw Error('FUTURE_OBSERVATION_UNSUPPORTED');
  const timezone = pick('timezone', 'Asia/Taipei');
  if (timezone !== 'Asia/Taipei') throw Error('OBSERVATION_TIMEZONE_UNSUPPORTED');
  const value = pick('value');
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximumValues[domain] || domain === 'steps' && !Number.isSafeInteger(value)) throw Error('INVALID_OBSERVATION_VALUE');
  const coverage = pick('coverage', domain === 'sleep' ? 'SESSION' : null);
  if (domain === 'sleep' ? coverage !== 'SESSION' : !['PARTIAL_DAY', 'FULL_DAY'].includes(coverage)) throw Error('INVALID_OBSERVATION_COVERAGE');
  const cutoffTime = pick('cutoffTime');
  if (cutoffTime !== null && (typeof cutoffTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(cutoffTime))) throw Error('INVALID_OBSERVATION_CUTOFF');
  if (coverage === 'PARTIAL_DAY' && cutoffTime === null || domain === 'sleep' && cutoffTime !== null) throw Error('INVALID_OBSERVATION_CUTOFF');
  const startedAt = instant(pick('startedAt')), endedAt = instant(pick('endedAt'));
  if ((startedAt === null) !== (endedAt === null) || domain !== 'sleep' && startedAt !== null) throw Error('INVALID_OBSERVATION_TIME');
  if (startedAt && endedAt) {
    const span = (Date.parse(endedAt) - Date.parse(startedAt)) / 60000;
    if (span <= 0 || span > 1440 || value > span || timeInTaipei(endedAt) !== date) throw Error('INVALID_SLEEP_INTERVAL');
  }
  return {domain, date, timezone, value, unit: domain === 'sleep' ? 'minute' : domain === 'steps' ? 'count' : 'kcal', coverage,
    cutoffTime, startedAt, endedAt, note: note(pick('note'), 1000), sourceNote: note(pick('sourceNote'), 280),
    source: 'manual', sourceChannel: 'MANUAL_WEB', sourceQuality: 'UNKNOWN',
    inputSemantics: domain === 'sleep' ? 'SELF_REPORTED_SLEEP_DURATION' : domain === 'steps' ? 'DAILY_CUMULATIVE_STEPS' : 'DAILY_TOTAL_ENERGY_EXPENDITURE'};
}

export class ManualObservationsLocalStore {
  constructor(private sql: any) {}
  private async rawAndAutomatic(tx: any, identity: Json, range: {start: string; end: string}) {
    // Automatic rows are used only for conflict detection; never leaked to the browser.
    const automatic = await tx`select domain,affected_local_dates,operation,invalidated_at from public.beta_health_records
      where canonical_user_id=${identity.canonical} and operation='UPSERT' and invalidated_at is null
      and domain in ('sleep','sleep_stage','steps','energy','total_energy')
      and affected_local_dates && array(select generate_series(${range.start}::date,${range.end}::date,'1 day')::date) limit 5001`;
    const queue=await tx`select score_date,status,generation,engine_published_generation from private.beta_score_recompute_queue where canonical_user_id=${identity.canonical} and score_date between ${range.start}::date and ${range.end}::date`;
    const scores=await tx`select score_date,score_type,score,status,algorithm_version from public.beta_health_scores where canonical_user_id=${identity.canonical} and score_date between ${range.start}::date and ${range.end}::date and score_type in ('sleep','activity')`;
    await prepareManualRead(tx, identity);
    const rows = await tx`select body,revision,local_date,domain,deleted from public.engine_manual_observations
      where canonical_user_id=${identity.canonical} and not deleted and
      (local_date between ${range.start}::date and ${range.end}::date or (domain='sleep' and local_date between ${range.start}::date-1 and ${range.end}::date+1))
      order by local_date,record_id limit 5001`;
    if (rows.length > 5000 || automatic.length > 5000) throw Error('READ_BOUND_EXCEEDED');
    return {rows, automatic, queue, scores};
  }
  async read(identity: Json, input: Json = {}) {
    rejectClientIdentity(input);
    if (input.domain !== undefined && !domains.includes(input.domain)) throw Error('INVALID_OBSERVATION_DOMAIN');
    const range = localReadRange(input);
    return await manualPrivilegedRead(this.sql, identity, async tx => {
      const {rows, automatic, queue, scores} = await this.rawAndAutomatic(tx, identity, range), projections = new Map<string, ReturnType<typeof projectManualObservationDay>>();
      for (const row of rows) { const date = dayString(row.local_date); if (!projections.has(date)) projections.set(date, projectManualObservationDay(rows, automatic, date)); }
      return rows.filter((r: Json) => dayString(r.local_date)>=range.start && dayString(r.local_date)<=range.end && (input.domain === undefined || r.domain === input.domain)).map((r: Json) => {
        const date=dayString(r.local_date),projection=projections.get(date)!,body={...r.body,date};
        return {...body,revision:Number(r.revision),...observationReadState(body,projection),
          ...observationPublishedAnalysis(body,projection,queue.find((q:Json)=>dayString(q.score_date)===date),scores.filter((q:Json)=>dayString(q.score_date)===date))};
      });
    }, true);
  }
  async daily(identity: Json, input: Json = {}) {
    rejectClientIdentity(input);
    const range = localReadRange(input);
    return await manualPrivilegedRead(this.sql, identity, async tx => {
      const {rows, automatic} = await this.rawAndAutomatic(tx, identity, range);
      return [...new Set(rows.map((r: Json) => dayString(r.local_date)))].filter(date=>String(date)>=range.start&&String(date)<=range.end).sort().map(date => projectManualObservationDay(rows, automatic, date as string));
    }, true);
  }
  async write(identity: Json, input: Json, remove = false) {
    rejectClientIdentity(input);
    if (!uuid(input.clientRequestId) || input.recordId !== undefined && !uuid(input.recordId)) throw Error('INVALID_MUTATION_ID');
    if (remove && !input.recordId) throw Error('OBSERVATION_NOT_FOUND');
    const inputHash = await sha({input, remove});
    return await this.sql.begin(async (tx: any) => {
      await prepareManualWrite(tx, identity);
      await tx`select pg_advisory_xact_lock(hashtextextended(${identity.canonical},0))`;
      const receipt = (await tx`select input_hash,response from private.engine_observation_receipts where canonical_user_id=${identity.canonical} and request_id=${input.clientRequestId}`)[0];
      if (receipt) { if (receipt.input_hash !== inputHash) throw Error('REQUEST_ID_CONFLICT'); return {...receipt.response, replayed: true}; }
      const id = input.recordId?.toLowerCase() ?? crypto.randomUUID();
      const old = (await tx`select * from public.engine_manual_observations where canonical_user_id=${identity.canonical} and record_id=${id} for update`)[0];
      if (input.recordId && !old) throw Error('OBSERVATION_NOT_FOUND');
      if (old?.deleted) throw Error('OBSERVATION_DELETED');
      if (old && (!Number.isSafeInteger(input.revision) || input.revision !== Number(old.revision)) || !old && input.revision !== undefined) throw Error('STALE_REVISION');
      const previousDate=old?storedObservationLocalDate(old.local_date):null,previousBody=old?{...old.body,date:previousDate}:undefined;
      const normalized = remove ? previousBody : normalizeManualObservation(input, previousBody);
      if (!remove && normalized.domain !== 'sleep') {
        const collision = await tx`select record_id from public.engine_manual_observations where canonical_user_id=${identity.canonical} and domain=${normalized.domain}
          and local_date=${normalized.date} and not deleted and record_id<>${id} limit 1`;
        if (collision.length) throw Error('OBSERVATION_DATE_CONFLICT');
      }
      const revision = old ? Number(old.revision) + 1 : 1, now = new Date().toISOString();
      const body = {...normalized, recordId: id, revision, createdAt: previousBody?.createdAt ?? now, updatedAt: now, deleted: remove};
      await tx`insert into public.engine_manual_observations(canonical_user_id,record_id,domain,local_date,timezone,source,revision,deleted,body)
        values(${identity.canonical},${id},${body.domain},${body.date},${body.timezone},'manual',${revision},${remove},${tx.json(body)})
        on conflict(canonical_user_id,record_id) do update set local_date=excluded.local_date,revision=excluded.revision,deleted=excluded.deleted,body=excluded.body,updated_at=now()`;
      const invalidatedDates: string[] = [...new Set<string>([previousDate, body.date].filter((date): date is string=>Boolean(date)))];
      if(body.domain==='sleep'&&(body.startedAt||previousBody?.startedAt)){
        const neighbors=await tx`select body,local_date from public.engine_manual_observations where canonical_user_id=${identity.canonical}
          and domain='sleep' and not deleted and record_id<>${id} and
          (local_date between ${body.date}::date-1 and ${body.date}::date+1 or local_date between ${previousDate??body.date}::date-1 and ${previousDate??body.date}::date+1) limit 5001`;
        if(neighbors.length>5000)throw Error('READ_BOUND_EXCEEDED');
        for(const neighbor of neighbors){const neighborDate=storedObservationLocalDate(neighbor.local_date),neighborBody={...neighbor.body,date:neighborDate};if(timedSleepOverlaps(body,neighborBody)||previousBody&&timedSleepOverlaps(previousBody,neighborBody)){
          if(!invalidatedDates.includes(neighborDate))invalidatedDates.push(neighborDate);
        }
        }
      }
      const result = {record: body, recordId: id, deleted: remove, status: 'SAVED', recomputeScheduled: true,
        invalidatedDates, ...observationAnalysisPlan(body)};
      await tx`insert into private.engine_observation_receipts(canonical_user_id,request_id,input_hash,response) values(${identity.canonical},${input.clientRequestId},${inputHash},${tx.json(result)})`;
      return result;
    });
  }
  async status(identity: Json, input: Json) {
    rejectClientIdentity(input);
    if (!uuid(input.clientRequestId)) throw Error('INVALID_MUTATION_ID');
    const rows = await manualPrivilegedRead(this.sql, identity, tx => tx`select response from private.engine_observation_receipts where canonical_user_id=${identity.canonical} and request_id=${input.clientRequestId}`);
    return rows.length ? {exists: true, ...rows[0].response} : {exists: false};
  }
}
