// Project only verified, published daily metrics into the existing Web read contract.
// No new aggregation, score mapping, source fallback or target assumptions.
import { localReadRange, rejectClientIdentity } from './manual-body-local.ts';
import { manualPrivilegedRead, prepareManualRead } from './manual-web-identity.ts';
import {projectManualObservationDay} from './manual-observation-projection.ts';
type Json = Record<string, any>;
const pgDay = (v: any) => v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
export async function readPublishedDaily(sql: any, identity: Json, domain: 'sleep' | 'activity', input: Json = {}) {
  return await manualPrivilegedRead(sql,identity,async(tx:any)=>projectPublishedDaily(await readPublishedDailySnapshot(tx,identity,input),domain),true);
}

// Caller owns one repeatable-read transaction. Read all privileged facts first,
// then restrict native reads to authenticated RLS; never restore/elevate that role.
export async function readPublishedDailySnapshot(tx:any,identity:Json,input:Json={}) {
  rejectClientIdentity(input);
  const range = localReadRange(input);
    const queue = await tx`select score_date,status,generation,engine_published_generation from private.beta_score_recompute_queue
      where canonical_user_id=${identity.canonical} and score_date between ${range.start}::date and ${range.end}::date`;
    const automatic=await tx`select domain,affected_local_dates from public.beta_health_records where canonical_user_id=${identity.canonical} and operation='UPSERT' and invalidated_at is null and affected_local_dates && array(select generate_series(${range.start}::date,${range.end}::date,'1 day')::date) limit 5001`;
    await prepareManualRead(tx, identity);
    const manual=await tx`select * from public.engine_manual_observations where canonical_user_id=${identity.canonical} and not deleted
      and (local_date between ${range.start}::date and ${range.end}::date or (domain='sleep' and local_date between ${range.start}::date-1 and ${range.end}::date+1)) limit 5001`;
    if(manual.length>5000||automatic.length>5000)throw Error('READ_BOUND_EXCEEDED');
    const rows = await tx`select p.output_kind,h.calculation_date,h.payload from public.engine_output_heads p join public.engine_output_history h
      using(canonical_user_id,calculation_date,output_kind,engine_version,input_fingerprint)
      where p.canonical_user_id=${identity.canonical} and p.calculation_date between ${range.start}::date and ${range.end}::date
      and p.output_kind in ('sleep','activity') and p.engine_version=p.output_kind||'-score-v1.0' order by p.calculation_date limit 733`;
    if (rows.length > 732) throw Error('READ_BOUND_EXCEEDED');
    return {queue,automatic,manual,rows,range};
}

// Pure presentation of the same captured generation/raw/head snapshot. Both
// Dashboard domains must use this object, not open another SQL transaction.
export function projectPublishedDaily(snapshot:Json,domain:'sleep'|'activity') {
    const {queue,automatic,manual}=snapshot;
    const rows=snapshot.rows.filter((row:Json)=>row.output_kind===domain);
    const publication = new Map(queue.map((q: Json) => [pgDay(q.score_date), q]));
    const result=rows.map((row: Json) => {
      const date = pgDay(row.calculation_date), q = publication.get(date) as Json | undefined, out = row.payload;
      const current = q?.status === 'COMPLETE' && BigInt(q.engine_published_generation) > 0n && String(q.engine_published_generation) === String(q.generation)
        && !['STALE', 'ERROR'].includes(out.score_status);
      const metric = (key: string) => current && typeof out.metrics?.daily?.[key] === 'number' && Number.isFinite(out.metrics.daily[key]) ? out.metrics.daily[key] : null;
      return {
        date, dataStatus: current ? 'CURRENT' : 'STALE',
        source: 'SQL_PUBLISHED_DAILY_METRICS', engineVersion: out.engine_version,
        calculatedAt: out.calculated_at, inputFingerprint: out.input_fingerprint,
        ...(domain === 'sleep'
          // Legacy UI sleepScore is not the experimental/frozen sleepSystemScore.
          ? {totalSleepMinutes: metric('sleep_minutes'), sleepScore: null}
          // Generic canonical energy does not specify active vs total calories.
          : {steps: metric('steps'), activeMinutes: metric('active_minutes'), activeCalories: null, totalCalories: null}),
      };
    });
    const days=new Map<string,Json>(result.map((r:Json)=>[r.date,r]));
    for(const date of [...new Set<string>(manual.map((r:Json)=>pgDay(r.local_date)))]){
      if(snapshot.range&&(date<snapshot.range.start||date>snapshot.range.end))continue;
      const projection=projectManualObservationDay(manual,automatic,date),relevant=domain==='sleep'?projection.sleep.recordIds.length:projection.steps.recordIds.length+projection.totalEnergy.recordIds.length;
      if(!relevant)continue;
      const entry=days.get(date)||{date,dataStatus:'CURRENT',...(domain==='sleep'?{totalSleepMinutes:null,sleepScore:null}:{steps:null,activeMinutes:null,activeCalories:null,totalCalories:null})};
      entry.source='SQL_CANONICAL_MANUAL_AND_PUBLISHED';entry.manualProvenance='SELF_REPORTED_UNKNOWN_QUALITY';entry.reconciliationFlags=projection.flags;
      // Raw values do not depend on a score being available. Never double count
      // manual/native sources or relabel total expenditure as active calories.
      if(domain==='sleep')entry.totalSleepMinutes=projection.sleep.value;
      else {if(projection.steps.recordIds.length)entry.steps=projection.steps.value;if(projection.totalEnergy.recordIds.length)entry.totalCalories=projection.totalEnergy.value;}
      entry.analysisDataStatus=entry.dataStatus;entry.dataStatus='CURRENT';entry.coverage={sleep:projection.sleep.coverage,steps:projection.steps.coverage,totalEnergy:projection.totalEnergy.coverage};
      days.set(date,entry);
    }
    return [...days.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
