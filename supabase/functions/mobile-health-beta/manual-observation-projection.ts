// Read-side projection of explicit manual observations. Not a score formula.
// The value is self-reported; neither confidence nor missing timing is invented.
type Json = Record<string, any>;
export type ObservationDomain = 'sleep' | 'steps' | 'total_energy';
const dayString = (v: any) => v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
const emptyMetric = (unit: string) => ({value: null as number | null, unit, status: 'MISSING', coverage: null as string | null, recordIds: [] as string[], cutoffTime: null as string | null});
function bodyOf(row: Json): Json { return row.body ?? row; }
export function timedSleepOverlaps(a: Json, b: Json) {
  return a.startedAt && a.endedAt && b.startedAt && b.endedAt
    ? Date.parse(a.startedAt) < Date.parse(b.endedAt) && Date.parse(b.startedAt) < Date.parse(a.endedAt) : false;
}
function liveRows(rows: Json[], day: string, domain: ObservationDomain) {
  return rows.filter(row => !row.deleted && dayString(row.local_date ?? bodyOf(row).date) === day && (row.domain ?? bodyOf(row).domain) === domain).map(bodyOf);
}
function hasAutomatic(rows: Json[], day: string, domain: ObservationDomain) {
  const names = domain === 'sleep' ? ['sleep', 'sleep_stage'] : domain === 'total_energy' ? ['total_energy', 'energy'] : ['steps'];
  return rows.some(row => names.includes(row.domain) && row.operation !== 'DELETE' && !row.invalidated_at && !row.deleted
    && (Array.isArray(row.affected_local_dates) ? row.affected_local_dates.map(dayString).includes(day) : dayString(row.local_date ?? row.date) === day));
}

// A durable queue invalidation exists for every observation mutation. The
// existing frozen sleep score consumes the reported duration even when timing is
// absent or differs from time-in-bed; exact timing is only required by the
// portable interval projection below. Keep write/read status aligned with the
// analysis that is actually published instead of claiming every queue row is a
// domain-specific analysis job.
export function observationAnalysisPlan(body: Json) {
  if (body.domain === 'total_energy') return {analysisStatus: 'ANALYSIS_NOT_ENABLED', analysisReason: 'TOTAL_ENERGY_SCORE_NOT_DEFINED', analysisJobScheduled: false};
  if (body.coverage === 'PARTIAL_DAY') return {analysisStatus: 'ANALYSIS_NOT_ENABLED', analysisReason: 'PARTIAL_DAY_NOT_FULL_DAY_SCORE', analysisJobScheduled: false};
  return {analysisStatus: 'ANALYSIS_PENDING', analysisReason: 'DURABLE_QUEUE_PENDING', analysisJobScheduled: true};
}

export function projectManualObservationDay(rows: Json[], automaticRows: Json[], day: string) {
  const sleep = emptyMetric('minute'), steps = emptyMetric('count'), totalEnergy = emptyMetric('kcal');
  const flags: string[] = [];
  for (const [domain, target] of [['sleep', sleep], ['steps', steps], ['total_energy', totalEnergy]] as const) {
    const selected = liveRows(rows, day, domain);
    if (!selected.length) continue;
    target.recordIds = selected.map(row => String(row.recordId));
    target.coverage = domain === 'sleep' ? 'SESSION' : selected[0].coverage;
    target.cutoffTime = domain === 'sleep' ? null : selected[0].cutoffTime ?? null;
    if (selected.some(row => typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value < 0)) {
      target.status = 'INVALID_STORED_INPUT';
    } else if (hasAutomatic(automaticRows, day, domain)) {
      target.status = 'SOURCE_CONFLICT';
    } else if (domain !== 'sleep') {
      // Natural-key uniqueness is also enforced in SQL. Never sum duplicate daily totals.
      if (selected.length !== 1) target.status = 'DAILY_TOTAL_CONFLICT';
      else { target.value = selected[0].value; target.status = target.coverage === 'PARTIAL_DAY' ? 'PARTIAL_DAY' : 'AVAILABLE'; }
    } else if (selected.some(row => rows.some(other => !other.deleted && (other.domain ?? bodyOf(other).domain) === 'sleep'
      && bodyOf(other).recordId !== row.recordId && timedSleepOverlaps(row, bodyOf(other))))) {
      // A <=24h session can overlap a session on the neighboring wake-date.
      // Callers load that bounded context, but emit only the requested dates.
      target.status = 'OVERLAP_CONFLICT';
    } else if (selected.length === 1) {
      target.value = selected[0].value;
      target.status = 'AVAILABLE';
    } else if (selected.some(row => !row.startedAt || !row.endedAt)) {
      target.status = 'OVERLAP_UNRESOLVED';
    } else {
      const timed = [...selected].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
      const overlap = timed.some((row, index) => index > 0 && Date.parse(row.startedAt) < Date.parse(timed[index - 1].endedAt));
      if (overlap) target.status = 'OVERLAP_CONFLICT';
      else { target.value = selected.reduce((sum, row) => sum + row.value, 0); target.status = 'AVAILABLE'; }
    }
    if (!['AVAILABLE', 'MISSING', 'PARTIAL_DAY'].includes(target.status)) flags.push(`${target.status}:${domain}`);
  }
  // Analysis is domain- and publication-specific. Do not attach one aggregate
  // state to this mixed-domain raw projection; callers use
  // observationPublishedAnalysis for the selected record/domain instead.
  return {date: day, timezone: 'Asia/Taipei', source: 'manual', sourceChannel: 'MANUAL_WEB', sourceQuality: 'UNKNOWN',
    sleep, steps, totalEnergy, flags};
}

export function observationReadState(body: Json, projection: ReturnType<typeof projectManualObservationDay>) {
  const metric = body.domain === 'sleep' ? projection.sleep : body.domain === 'steps' ? projection.steps : projection.totalEnergy;
  return {reconciliationStatus: metric.status, reconciliationFlags: projection.flags.filter(flag => flag.endsWith(':' + body.domain)),
    ...observationAnalysisPlan(body)};
}

// Read actual publication/queue evidence independently of raw-record persistence.
export function observationPublishedAnalysis(body:Json,projection:ReturnType<typeof projectManualObservationDay>,queue:Json|undefined,scores:Json[]) {
  const metric=body.domain==='sleep'?projection.sleep:body.domain==='steps'?projection.steps:projection.totalEnergy;
  // Read state reflects actual queue evidence, not write-time eligibility.
  // Only DIRTY/PROCESSING proves a currently scheduled analysis job.
  const plan=observationAnalysisPlan(body),inactive={...plan,analysisJobScheduled:false,score:null};
  if(!plan.analysisJobScheduled)return inactive;
  if(metric.status!=='AVAILABLE')return {...inactive,analysisStatus:'INSUFFICIENT_DATA',analysisReason:metric.status};
  if(!queue)return {...inactive,analysisStatus:'ANALYSIS_UNAVAILABLE',analysisReason:'PUBLICATION_NOT_FOUND'};
  if(queue.status==='DIRTY'||queue.status==='PROCESSING')return {...inactive,analysisStatus:'ANALYSIS_PENDING',analysisReason:'DURABLE_QUEUE_PENDING',analysisJobScheduled:true};
  if(queue.status==='FAILED')return {...inactive,analysisStatus:'ERROR',analysisReason:'RECOMPUTE_FAILED',analysisJobScheduled:false};
  if(queue.status!=='COMPLETE'||Number(queue.engine_published_generation)<=0||String(queue.engine_published_generation)!==String(queue.generation))return {...inactive,analysisStatus:'ANALYSIS_UNAVAILABLE',analysisReason:'PUBLICATION_GENERATION_NOT_VERIFIED'};
  const result=scores.find(r=>r.score_type===(body.domain==='sleep'?'sleep':'activity'));
  if(!result)return {...inactive,analysisStatus:'ANALYSIS_UNAVAILABLE',analysisReason:'PUBLISHED_SCORE_NOT_FOUND'};
  return {...inactive,analysisStatus:result.score===null?'INSUFFICIENT_DATA':'COMPUTED',analysisReason:result.status,
    score:result.score===null?null:Number(result.score),algorithmVersion:result.algorithm_version};
}

// Only explicit, unambiguous FULL_DAY steps and exact timed sleep can enter this
// portable interval projection. The existing frozen daily score adapter can use
// reported sleep duration separately; total energy remains raw/displayable without
// fabricated intervals or generic-energy mapping.
// Caller MUST use blockedDomains to suppress conflicting same-day automatic inputs;
// merely appending the returned records would leave a misleading automatic score.
export function observationEngineProjection(rows: Json[], automaticRows: Json[], user: string, day: string) {
  const projection = projectManualObservationDay(rows, automaticRows, day), records: Json[] = [];
  const blockedDomains: string[] = [];
  for (const [domain, metric] of [['steps', projection.steps], ['sleep', projection.sleep]] as const) {
    if (['SOURCE_CONFLICT', 'OVERLAP_CONFLICT', 'OVERLAP_UNRESOLVED', 'DAILY_TOTAL_CONFLICT', 'INVALID_STORED_INPUT'].includes(metric.status)) {
      blockedDomains.push(domain); continue;
    }
    if (metric.status !== 'AVAILABLE') continue;
    for (const row of rows.filter(r => !r.deleted && (r.domain ?? bodyOf(r).domain) === domain && dayString(r.local_date ?? bodyOf(r).date) === day)) {
      const body = bodyOf(row);
      if (domain === 'sleep' && (!body.startedAt || !body.endedAt || Date.parse(body.endedAt) - Date.parse(body.startedAt) !== body.value * 60000)) continue;
      records.push({subject_ref: user, source: 'MANUAL_WEB', record_id: String(body.recordId), revision: Number(row.revision ?? body.revision),
        domain, value: body.value, unit: domain === 'sleep' ? 'minute' : 'count',
        // Date-only anchor is not a claimed measurement/cutoff timestamp.
        recorded_at: domain === 'sleep' ? body.endedAt : day + 'T00:00:00+08:00',
        updated_at: String(body.updatedAt ?? row.updated_at),
        started_at: domain === 'sleep' ? body.startedAt : null, ended_at: domain === 'sleep' ? body.endedAt : null,
        source_quality: 'UNKNOWN', payload: {input_semantics: body.inputSemantics, provenance: 'manual', timezone: body.timezone, coverage: body.coverage}});
    }
  }
  return {records, blockedDomains, projection};
}
