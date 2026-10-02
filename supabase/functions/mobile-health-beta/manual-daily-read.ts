// Project only verified, published daily metrics into the existing Web read contract.
// No new aggregation, score mapping, source fallback or target assumptions.
import { localReadRange, rejectClientIdentity } from './manual-body-local.ts';
import { manualPrivilegedRead, prepareManualRead } from './manual-web-identity.ts';
import {projectManualObservationDay} from './manual-observation-projection.ts';
import {projectCompleteTotalEnergyDays} from './total-energy-daily.ts';
type Json = Record<string, any>;
const TOTAL_ENERGY_READ_LIMIT = 100_000;
const pgDay = (v: any) => v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
// Only these native domains participate in manual-source conflict detection or
// pending-day visibility. Published output payloads remain authoritative. For
// metrics with an unambiguous canonical aggregation, the bounded query also
// carries a source-selected daily value so a failed derived publication cannot
// hide data already durably ingested.
export const PUBLISHED_DAILY_AUTOMATIC_DOMAINS = Object.freeze([
  'sleep','sleep_stage','steps','energy','total_energy','heart_rate','resting_heart_rate','hrv','weight','spo2',
]);
const automaticDailyDomainSet = new Set(PUBLISHED_DAILY_AUTOMATIC_DOMAINS);
export const relevantPublishedDailyAutomaticRows = (rows:Json[]) => rows.filter(row=>automaticDailyDomainSet.has(String(row.domain)));
export function collapseRelevantPublishedDailyAutomaticRows(rows:Json[]):Json[] {
  const datesByDomain=new Map<string,Set<string>>();
  for(const row of relevantPublishedDailyAutomaticRows(rows||[])){
    const domain=String(row.domain),dates=datesByDomain.get(domain)||new Set<string>();
    for(const rawDate of row.affected_local_dates||[]){const date=pgDay(rawDate);if(/^\d{4}-\d{2}-\d{2}$/.test(date))dates.add(date);}
    datesByDomain.set(domain,dates);
  }
  return [...datesByDomain].sort(([a],[b])=>a.localeCompare(b)).map(([domain,dates])=>({domain,affected_local_dates:[...dates].sort()}));
}
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
    const automatic=await tx`with source_day as (
        select r.domain,affected.local_date,r.source_app,count(*)::integer as record_count,
          max(coalesce(r.source_updated_at,r.updated_at)) as newest_at,
          case
            when r.domain='steps' then sum(case when r.canonical_record->>'unit'='count'
              and jsonb_typeof(r.canonical_record->'value')='number'
              and (r.canonical_record->>'value')::double precision between 0 and 10000000
              then (r.canonical_record->>'value')::double precision else null end)
            when r.domain='resting_heart_rate' then avg(case when r.canonical_record->>'unit'='bpm'
              and jsonb_typeof(r.canonical_record->'value')='number'
              and (r.canonical_record->>'value')::double precision between 20 and 300
              then (r.canonical_record->>'value')::double precision else null end)
            when r.domain='hrv' then avg(case when r.canonical_record->>'unit'='ms'
              and jsonb_typeof(r.canonical_record->'value')='number'
              and (r.canonical_record->>'value')::double precision between 0 and 100000
              then (r.canonical_record->>'value')::double precision else null end)
            when r.domain='weight' then avg(case when r.canonical_record->>'unit'='kg'
              and jsonb_typeof(r.canonical_record->'value')='number'
              and (r.canonical_record->>'value')::double precision between 0 and 2000
              then (r.canonical_record->>'value')::double precision else null end)
            when r.domain='spo2' then avg(case when r.canonical_record->>'unit'='percent'
              and jsonb_typeof(r.canonical_record->'value')='number'
              and (r.canonical_record->>'value')::double precision between 0 and 100
              then (r.canonical_record->>'value')::double precision else null end)
            else null
          end as daily_value,
          case when r.domain='sleep' then range_agg(case
            when r.canonical_record->>'unit'='minute'
              and jsonb_typeof(r.canonical_record->'started_at')='string'
              and jsonb_typeof(r.canonical_record->'ended_at')='string'
              and (r.canonical_record->>'ended_at')::timestamptz>(r.canonical_record->>'started_at')::timestamptz
              and (r.canonical_record->>'ended_at')::timestamptz<=(r.canonical_record->>'started_at')::timestamptz+interval '24 hours'
            then tstzrange((r.canonical_record->>'started_at')::timestamptz,(r.canonical_record->>'ended_at')::timestamptz,'[)') end)
            else null::tstzmultirange end as interval_ranges
        from public.beta_health_records r cross join lateral unnest(r.affected_local_dates) as affected(local_date)
        where r.canonical_user_id=${identity.canonical}
        and r.domain in ('sleep','sleep_stage','steps','energy','total_energy','heart_rate','resting_heart_rate','hrv','weight','spo2')
        and r.operation='UPSERT' and r.invalidated_at is null
        and r.affected_local_dates && array(select generate_series(${range.start}::date,${range.end}::date,'1 day')::date)
        and affected.local_date between ${range.start}::date and ${range.end}::date
        group by r.domain,affected.local_date,r.source_app
      ), ranked as (
        select *,row_number() over(partition by domain,local_date
          order by record_count desc,newest_at desc,coalesce(source_app,'') asc) as source_rank
        from source_day
      )
      select domain,array[local_date]::date[] as affected_local_dates,local_date::text as local_date,
        source_app,record_count,newest_at as source_updated_at,
        case when domain='sleep' then (select sum(extract(epoch from upper(span)-lower(span))/60)
          from unnest(interval_ranges) span) else daily_value end as daily_value
      from ranked where source_rank=1 order by domain,local_date
      limit ${PUBLISHED_DAILY_AUTOMATIC_DOMAINS.length*366+1}`;
    // Keep interval values server-side and user-scoped. This bounded snapshot is
    // reconciled separately from score publication; raw source totals are never
    // summed across Fitbit/Google Fit or promoted from a partial day.
    const energy=await tx`select r.platform,r.source_app,r.source_record_id,r.source_revision,
        r.source_updated_at,r.updated_at,r.affected_local_dates,
        r.canonical_record->>'started_at' as started_at,
        r.canonical_record->>'ended_at' as ended_at,
        r.canonical_record->>'value' as value,
        r.canonical_record->>'unit' as unit
      from public.beta_health_records r
      where r.canonical_user_id=${identity.canonical} and r.domain='total_energy'
        and r.operation='UPSERT' and r.invalidated_at is null
        and r.affected_local_dates && array(select generate_series(${range.start}::date,${range.end}::date,'1 day')::date)
      order by r.updated_at,r.id limit ${TOTAL_ENERGY_READ_LIMIT+1}`;
    await prepareManualRead(tx, identity);
    const manual=await tx`select * from public.engine_manual_observations where canonical_user_id=${identity.canonical} and not deleted
      and (local_date between ${range.start}::date and ${range.end}::date or (domain='sleep' and local_date between ${range.start}::date-1 and ${range.end}::date+1)) limit 5001`;
    if(manual.length>5000||automatic.length>PUBLISHED_DAILY_AUTOMATIC_DOMAINS.length*366)throw Error('READ_BOUND_EXCEEDED');
    const rows = await tx`select p.output_kind,h.calculation_date,h.payload from public.engine_output_heads p join public.engine_output_history h
      using(canonical_user_id,calculation_date,output_kind,engine_version,input_fingerprint)
      where p.canonical_user_id=${identity.canonical} and p.calculation_date between ${range.start}::date and ${range.end}::date
      and p.output_kind in ('sleep','activity') and p.engine_version=p.output_kind||'-score-v1.0' order by p.calculation_date limit 733`;
    if (rows.length > 732) throw Error('READ_BOUND_EXCEEDED');
    return {queue,automatic,energy:energy.length>TOTAL_ENERGY_READ_LIMIT?[]:energy,
      energyReadTruncated:energy.length>TOTAL_ENERGY_READ_LIMIT,manual,rows,range};
}

// Pure presentation of the same captured generation/raw/head snapshot. Both
// Dashboard domains must use this object, not open another SQL transaction.
export function projectPublishedDaily(snapshot:Json,domain:'sleep'|'activity') {
    const {queue,manual}=snapshot,automatic=collapseRelevantPublishedDailyAutomaticRows(snapshot.automatic||[]);
    const rows=snapshot.rows.filter((row:Json)=>row.output_kind===domain);
    const publication = new Map<string,Json>(queue.map((q: Json):[string,Json] => [pgDay(q.score_date), q]));
    const result=rows.map((row: Json) => {
      const date = pgDay(row.calculation_date), q = publication.get(date) as Json | undefined, out = row.payload;
      const publishedGeneration=String(q?.engine_published_generation??'0');
      const current = q?.status === 'COMPLETE' && /^\d+$/.test(publishedGeneration) && BigInt(publishedGeneration) > 0n && publishedGeneration === String(q.generation)
        && !['STALE', 'ERROR'].includes(out.score_status);
      const metric = (key: string) => current && typeof out.metrics?.daily?.[key] === 'number' && Number.isFinite(out.metrics.daily[key]) ? out.metrics.daily[key] : null;
      const staleReason=current?null:!q?'PUBLICATION_GENERATION_NOT_VERIFIED':q.status==='FAILED'?'RECOMPUTE_FAILED':q.status!=='COMPLETE'?'RECOMPUTE_PENDING':publishedGeneration!==String(q.generation)?'PUBLICATION_GENERATION_NOT_VERIFIED':'PUBLISHED_OUTPUT_NOT_CURRENT';
      const publishedSource='SQL_PUBLISHED_DAILY_METRICS';
      const sleepMinutes=domain==='sleep'?metric('sleep_minutes'):null;
      const steps=domain==='activity'?metric('steps'):null;
      const activeMinutes=domain==='activity'?metric('active_minutes'):null;
      // The Web contract labels this field as resting heart rate. Do not fall
      // back to a daily average: that would silently change the metric's
      // meaning while keeping the same label.
      const heartRate=domain==='activity'?metric('resting_hr'):null;
      const hrv=domain==='activity'?metric('hrv'):null;
      const weight=domain==='activity'?metric('weight'):null;
      const bodyFatPercentage=domain==='activity'?metric('body_fat'):null;
      const spo2=domain==='activity'?metric('spo2'):null;
      return {
        date, dataStatus: current ? 'CURRENT' : 'STALE', staleReason,
        source: publishedSource, engineVersion: out.engine_version,
        calculatedAt: out.calculated_at, inputFingerprint: out.input_fingerprint,
        ...(domain === 'sleep'
          // Legacy UI sleepScore is not the experimental/frozen sleepSystemScore.
          ? {totalSleepMinutes:sleepMinutes,sleepScore:null,sleepSource:sleepMinutes===null?null:publishedSource}
          // Generic canonical energy does not specify active vs total calories.
          : {steps,activeMinutes,activeCalories:null,totalCalories:null,heartRate,hrv,weight,bodyFatPercentage,spo2,
            stepsSource:steps===null?null:publishedSource,
            activeMinutesSource:activeMinutes===null?null:publishedSource,
            totalEnergySource:null,
            heartRateSource:heartRate===null?null:publishedSource,
            hrvSource:hrv===null?null:publishedSource,
            weightSource:weight===null?null:publishedSource,
            bodyFatPercentageSource:bodyFatPercentage===null?null:publishedSource,
            spo2Source:spo2===null?null:publishedSource}),
      };
    });
    const currentPublicationDates=new Set<string>(result.filter((row:Json)=>row.dataStatus==='CURRENT'&&row.source==='SQL_PUBLISHED_DAILY_METRICS').map((row:Json)=>row.date));
    const days=new Map<string,Json>(result.map((r:Json)=>[r.date,r]));
    // A durable queue row can outlive the live source row (for example, a
    // create immediately followed by delete before the first publication).
    // Preserve that date/status even with no output head; otherwise the UI
    // would incorrectly settle to EMPTY/READY while recomputation failed or is
    // still pending. This placeholder never fabricates a numeric metric.
    for(const [date,q] of publication){
      if(snapshot.range&&(date<snapshot.range.start||date>snapshot.range.end)||days.has(date))continue;
      const staleReason=q.status==='FAILED'?'RECOMPUTE_FAILED':q.status!=='COMPLETE'?'RECOMPUTE_PENDING':String(q.engine_published_generation)!==String(q.generation)||String(q.engine_published_generation)==='0'?'PUBLICATION_GENERATION_NOT_VERIFIED':'PUBLISHED_OUTPUT_NOT_CURRENT';
      days.set(date,{date,dataStatus:'STALE',source:'SQL_RECOMPUTE_QUEUE_PENDING_PUBLICATION',staleReason,engineVersion:null,calculatedAt:null,inputFingerprint:null,
        ...(domain==='sleep'?{totalSleepMinutes:null,sleepScore:null,sleepSource:null}:{steps:null,activeMinutes:null,activeCalories:null,totalCalories:null,heartRate:null,hrv:null,weight:null,bodyFatPercentage:null,spo2:null,stepsSource:null,activeMinutesSource:null,totalEnergySource:null,heartRateSource:null,hrvSource:null,weightSource:null,bodyFatPercentageSource:null,spo2Source:null})});
    }
    // A raw automatic record can be committed before its derived daily output is
    // published. Keep that canonical local date visible as a null/stale gap so
    // the Web chart does not silently drop a real day (or invent a zero). The
    // published output and manual reconciliation below remain authoritative for
    // values; this is deliberately not a second aggregation path.
    const automaticDomains=domain==='sleep'?new Set(['sleep','sleep_stage']):new Set(['steps','energy','total_energy','heart_rate','resting_heart_rate','hrv','weight','spo2']);
    for(const row of automatic){
      if(!automaticDomains.has(String(row.domain)))continue;
      for(const rawDate of row.affected_local_dates||[]){
        const date=pgDay(rawDate);
        if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||snapshot.range&&(date<snapshot.range.start||date>snapshot.range.end)||days.has(date))continue;
        const q=publication.get(date) as Json|undefined,staleReason=!q?'PUBLICATION_NOT_AVAILABLE':q.status==='FAILED'?'RECOMPUTE_FAILED':q.status!=='COMPLETE'?'RECOMPUTE_PENDING':String(q.engine_published_generation)!==String(q.generation)||String(q.engine_published_generation)==='0'?'PUBLICATION_GENERATION_NOT_VERIFIED':'PUBLISHED_OUTPUT_NOT_CURRENT';
        days.set(date,{date,dataStatus:'STALE',source:'SQL_CANONICAL_INPUT_PENDING_PUBLICATION',staleReason,engineVersion:null,calculatedAt:null,inputFingerprint:null,
          ...(domain==='sleep'?{totalSleepMinutes:null,sleepScore:null,sleepSource:null}:{steps:null,activeMinutes:null,activeCalories:null,totalCalories:null,heartRate:null,hrv:null,weight:null,bodyFatPercentage:null,spo2:null,stepsSource:null,activeMinutesSource:null,totalEnergySource:null,heartRateSource:null,hrvSource:null,weightSource:null,bodyFatPercentageSource:null,spo2Source:null})});
      }
    }
    // The score publisher and the user-facing daily read have different
    // availability requirements. A failed/pending score recompute must remain
    // visible as analysis state, but must not erase an already committed daily
    // metric. `automatic` contains exactly one source per domain/date,
    // selected with the same record-count/newest tie-break used by the score
    // bridge, so this never adds Fitbit/Google/Xiaomi/Health Connect together.
    for(const row of relevantPublishedDailyAutomaticRows(snapshot.automatic||[])){
      const rawDomain=String(row.domain),fallback=domain==='sleep'
        ?rawDomain==='sleep'?{field:'totalSleepMinutes',sourceField:'sleepSource'}:null
        :({steps:{field:'steps',sourceField:'stepsSource'},resting_heart_rate:{field:'heartRate',sourceField:'heartRateSource'},hrv:{field:'hrv',sourceField:'hrvSource'},weight:{field:'weight',sourceField:'weightSource'},spo2:{field:'spo2',sourceField:'spo2Source'}} as Json)[rawDomain]??null;
      if(!fallback)continue;
      const date=pgDay(row.local_date??row.affected_local_dates?.[0]),rawValue=row.daily_value;
      const value=rawValue===null||rawValue===undefined||rawValue===''?null:Number(rawValue);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||value===null||!Number.isFinite(value)||value<0||snapshot.range&&(date<snapshot.range.start||date>snapshot.range.end))continue;
      const entry=days.get(date);
      // This guard must not depend on mutable `entry.source`: SpO2 can safely
      // augment a current activity publication, but doing so changes the entry
      // source and must never unlock raw fallbacks for published score metrics.
      const currentPublished=currentPublicationDates.has(date);
      if(!entry||entry[fallback.field]!==null&&entry[fallback.field]!==undefined||rawDomain!=='spo2'&&currentPublished)continue;
      entry.analysisDataStatus??=entry.dataStatus;
      entry.analysisStaleReason??=entry.staleReason??null;
      entry[fallback.field]=value;
      entry[fallback.sourceField]='WEARABLE_SYNC';
      entry.source='SQL_CANONICAL_AUTOMATIC_FALLBACK';
      entry[`${fallback.field}AutomaticSourceApp`]=String(row.source_app||'');
      entry[`${fallback.field}SourceUpdatedAt`]=row.source_updated_at??null;
      entry.dataStatus='CURRENT';
      entry.staleReason=null;
    }
    if(domain==='activity'&&!snapshot.energyReadTruncated&&snapshot.range){
      for(const [date,total] of projectCompleteTotalEnergyDays(snapshot.energy||[],snapshot.range,snapshot.asOfMs??Date.now())){
        const entry=days.get(date)||{date,dataStatus:'STALE',staleReason:'PUBLICATION_NOT_AVAILABLE',
          source:'SQL_CANONICAL_INPUT_PENDING_PUBLICATION',steps:null,totalCalories:null};
        if(entry.totalCalories!==null&&entry.totalCalories!==undefined)continue;
        entry.analysisDataStatus??=entry.dataStatus;
        entry.analysisStaleReason??=entry.staleReason??null;
        entry.totalCalories=total.value;
        entry.totalEnergySource='WEARABLE_SYNC';
        entry.totalEnergyAutomaticSourceApp=total.sourceApp;
        entry.totalEnergyAllocation=total.allocation;
        entry.coverage={...entry.coverage,totalEnergy:'FULL_DAY'};
        entry.source='SQL_CANONICAL_AUTOMATIC_FALLBACK';
        entry.dataStatus='CURRENT';
        entry.staleReason=null;
        days.set(date,entry);
      }
    }
    for(const date of [...new Set<string>(manual.map((r:Json)=>pgDay(r.local_date)))]){
      if(snapshot.range&&(date<snapshot.range.start||date>snapshot.range.end))continue;
      const projection=projectManualObservationDay(manual,automatic,date);
      // Reconciliation and presentation have different responsibilities. The
      // former must keep a same-day manual/native conflict out of derived
      // analysis, while the latter must not make a durable self-reported value
      // disappear merely because native data arrived later. Re-run the same
      // strict manual validation without native rows for the displayed value;
      // this neither sums sources nor changes the score-input conflict policy.
      const displayProjection=projectManualObservationDay(manual,[],date);
      const relevant=domain==='sleep'?displayProjection.sleep.recordIds.length:displayProjection.steps.recordIds.length+displayProjection.totalEnergy.recordIds.length;
      if(!relevant)continue;
      const q=publication.get(date) as Json|undefined;
      // A manual value is immediately current, but a queued/failed derived
      // recomputation remains a separate stale analysis fact even when no
      // published output head exists yet.
      const unpublishedAnalysis=!q?{dataStatus:'CURRENT',staleReason:null}
        :q.status==='FAILED'?{dataStatus:'STALE',staleReason:'RECOMPUTE_FAILED'}
        :q.status!=='COMPLETE'?{dataStatus:'STALE',staleReason:'RECOMPUTE_PENDING'}
        :String(q.engine_published_generation)==='0'||String(q.engine_published_generation)!==String(q.generation)
          ?{dataStatus:'STALE',staleReason:'PUBLICATION_GENERATION_NOT_VERIFIED'}
          :{dataStatus:'STALE',staleReason:'PUBLISHED_OUTPUT_NOT_CURRENT'};
      const entry=days.get(date)||{date,...unpublishedAnalysis,...(domain==='sleep'?{totalSleepMinutes:null,sleepScore:null,sleepSource:null}:{steps:null,activeMinutes:null,activeCalories:null,totalCalories:null,heartRate:null,hrv:null,weight:null,bodyFatPercentage:null,spo2:null,stepsSource:null,activeMinutesSource:null,totalEnergySource:null,heartRateSource:null,hrvSource:null,weightSource:null,bodyFatPercentageSource:null,spo2Source:null})};
      entry.source='SQL_CANONICAL_MANUAL_AND_PUBLISHED';entry.manualProvenance='SELF_REPORTED_UNKNOWN_QUALITY';entry.reconciliationFlags=[...new Set([...projection.flags,...displayProjection.flags])];
      // Raw values do not depend on a score being available. Never double count
      // manual/native sources or relabel total expenditure as active calories.
      // The manual value is the explicit display preference; reconciliation
      // flags continue to disclose that derived analysis excluded the conflict.
      if(domain==='sleep'){entry.totalSleepMinutes=displayProjection.sleep.value;entry.sleepSource='SELF_REPORTED_UNKNOWN_QUALITY';}
      else {if(displayProjection.steps.recordIds.length){entry.steps=displayProjection.steps.value;entry.stepsSource='SELF_REPORTED_UNKNOWN_QUALITY';}if(displayProjection.totalEnergy.recordIds.length){entry.totalCalories=displayProjection.totalEnergy.value;entry.totalEnergySource='SELF_REPORTED_UNKNOWN_QUALITY';}}
      entry.analysisDataStatus??=entry.dataStatus;entry.analysisStaleReason??=entry.staleReason??null;entry.dataStatus='CURRENT';entry.staleReason=null;entry.coverage={sleep:displayProjection.sleep.coverage,steps:displayProjection.steps.coverage,totalEnergy:displayProjection.totalEnergy.recordIds.length?displayProjection.totalEnergy.coverage:entry.coverage?.totalEnergy??displayProjection.totalEnergy.coverage};
      days.set(date,entry);
    }
    return [...days.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
