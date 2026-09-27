// Pure contract tests only. SQL/RLS/HTTP/Browser acceptance is a separate real-PG suite.
import {normalizeManualObservation, storedObservationLocalDate} from '../supabase/functions/mobile-health-beta/manual-observations-local.ts';
import {observationAnalysisPlan, observationEngineProjection, observationReadState, observationPublishedAnalysis, projectManualObservationDay} from '../supabase/functions/mobile-health-beta/manual-observation-projection.ts';
type Json = Record<string, any>;
function equal(actual: unknown, expected: unknown) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`); }
function throws(fn: () => unknown, code: string) { try { fn(); } catch (e) { if (e instanceof Error && e.message === code) return; throw e; } throw Error('Expected ' + code); }
const day = '2026-09-12', today = '2026-09-14';
const base = (domain = 'steps', value = 0): Json => ({domain, date: day, value, coverage: domain === 'sleep' ? 'SESSION' : 'FULL_DAY'});
const norm = (input: Json, previous?: Json) => normalizeManualObservation(input, previous, today);
const row = (input: Json, id = '00000000-0000-4000-8000-000000000001'): Json => ({domain: input.domain, local_date: input.date ?? day, revision: 1, deleted: false,
  body: {...norm(input), recordId: id, revision: 1, updatedAt: '2026-09-13T00:00:00Z'}});
const auto = (domain: string) => ({domain, affected_local_dates: [day], operation: 'UPSERT', invalidated_at: null});

Deno.test('write response separates durable invalidation from adapter-supported analysis',()=>{
 equal(observationAnalysisPlan(norm(base('steps',8000))),{analysisStatus:'ANALYSIS_PENDING',analysisReason:'DURABLE_QUEUE_PENDING',analysisJobScheduled:true});
 equal(observationAnalysisPlan(norm({...base('steps',6000),coverage:'PARTIAL_DAY',cutoffTime:'12:00'})),{analysisStatus:'ANALYSIS_NOT_ENABLED',analysisReason:'PARTIAL_DAY_NOT_FULL_DAY_SCORE',analysisJobScheduled:false});
 equal(observationAnalysisPlan(norm(base('total_energy',2200))),{analysisStatus:'ANALYSIS_NOT_ENABLED',analysisReason:'TOTAL_ENERGY_SCORE_NOT_DEFINED',analysisJobScheduled:false});
 equal(observationAnalysisPlan(norm(base('sleep',420))),{analysisStatus:'ANALYSIS_PENDING',analysisReason:'DURABLE_QUEUE_PENDING',analysisJobScheduled:true});
 equal(observationAnalysisPlan(norm({...base('sleep',420),startedAt:'2026-09-11T23:00:00+08:00',endedAt:'2026-09-12T06:00:00+08:00'})),{analysisStatus:'ANALYSIS_PENDING',analysisReason:'DURABLE_QUEUE_PENDING',analysisJobScheduled:true});
 equal(observationAnalysisPlan(norm({...base('sleep',360),startedAt:'2026-09-11T23:00:00+08:00',endedAt:'2026-09-12T06:00:00+08:00'})),{analysisStatus:'ANALYSIS_PENDING',analysisReason:'DURABLE_QUEUE_PENDING',analysisJobScheduled:true});
});

Deno.test('raw observation analysis requires an actual matching publication or queued work',()=>{
 const body=norm(base('steps',8000)),projection=projectManualObservationDay([row(base('steps',8000))],[],day);
 const queue={status:'COMPLETE',generation:'4',engine_published_generation:'4'},scores=[{score_type:'activity',score:'80',status:'PARTIAL_DATA',algorithm_version:'health-score-v1.0'}];
 equal(observationPublishedAnalysis(body,projection,undefined,scores).analysisStatus,'ANALYSIS_UNAVAILABLE');
 equal(observationPublishedAnalysis(body,projection,undefined,scores).analysisJobScheduled,false);
 equal(observationPublishedAnalysis(body,projection,{...queue,status:'DIRTY'},scores).analysisJobScheduled,true);
 equal(observationPublishedAnalysis(body,projection,{...queue,status:'FAILED'},scores).analysisStatus,'ERROR');
 equal(observationPublishedAnalysis(body,projection,{...queue,status:'FAILED'},scores).analysisReason,'RECOMPUTE_FAILED');
 equal(observationPublishedAnalysis(body,projection,{...queue,status:'FAILED'},scores).analysisJobScheduled,false);
 equal(observationPublishedAnalysis(body,projection,{...queue,engine_published_generation:'3'},scores).analysisStatus,'ANALYSIS_UNAVAILABLE');
 equal(observationPublishedAnalysis(body,projection,{...queue,engine_published_generation:'3'},scores).analysisJobScheduled,false);
 equal(observationPublishedAnalysis(body,projection,queue,[]).analysisJobScheduled,false);
 equal(observationPublishedAnalysis(body,projection,queue,scores).score,80);
 equal(observationPublishedAnalysis(body,projection,queue,scores).analysisJobScheduled,false);
 equal(observationPublishedAnalysis(body,projection,queue,[{...scores[0],score:null}]).analysisStatus,'INSUFFICIENT_DATA');
 equal(observationPublishedAnalysis({...body,coverage:'PARTIAL_DAY'},projection,queue,scores).analysisStatus,'ANALYSIS_NOT_ENABLED');
 equal(observationPublishedAnalysis({...body,domain:'total_energy'},projection,queue,scores).analysisStatus,'ANALYSIS_NOT_ENABLED');
 const conflict=projectManualObservationDay([row(base('steps',8000))],[auto('steps')],day);
 equal(observationPublishedAnalysis(body,conflict,queue,scores).score,null);
 equal(observationPublishedAnalysis(body,conflict,queue,scores).analysisReason,'SOURCE_CONFLICT');
});
Deno.test('stored relational observation date outranks stale duplicated body date',()=>{
 equal(storedObservationLocalDate('2026-09-19'),'2026-09-19');
 equal(storedObservationLocalDate(new Date('2026-09-19T00:00:00Z')),'2026-09-19');
 const source=Deno.readTextFileSync('supabase/functions/mobile-health-beta/manual-observations-local.ts');
 if(!/previousDate=old\?storedObservationLocalDate\(old\.local_date\):null,previousBody=old\?\{\.\.\.old\.body,date:previousDate\}:undefined/u.test(source))throw Error('stored local_date is not canonicalized before update/delete');
 if(!/invalidatedDates: string\[\] = \[\.\.\.new Set<string>\(\[previousDate, body\.date\]/u.test(source))throw Error('canonical previous date is missing from invalidation');
});

Deno.test('manual observation zero is valid; blank/null/NaN/Infinity are not zero', () => {
  equal(norm(base()).value, 0);
  equal(norm(base('total_energy')).value, 0);
  for (const value of ['', null, undefined, NaN, Infinity, -Infinity, -1, '0']) throws(() => norm({...base(), value}), 'INVALID_OBSERVATION_VALUE');
});
Deno.test('steps requires safe integer; total energy allows finite decimals', () => {
  throws(() => norm(base('steps', 12.5)), 'INVALID_OBSERVATION_VALUE');
  throws(() => norm(base('steps', Number.MAX_SAFE_INTEGER + 1)), 'INVALID_OBSERVATION_VALUE');
  throws(() => norm(base('steps', 200001)), 'INVALID_OBSERVATION_VALUE');
  equal(norm(base('total_energy', 1234.5)).value, 1234.5);
  equal(norm(base('total_energy', 1234.5)).inputSemantics, 'DAILY_TOTAL_ENERGY_EXPENDITURE');
  throws(() => norm(base('total_energy', 30000.1)), 'INVALID_OBSERVATION_VALUE');
});
Deno.test('omitted fields preserve prior observation; explicit null is distinct', () => {
  const old = norm({...base('steps', 6000), sourceNote: 'watch at cutoff', coverage: 'PARTIAL_DAY', cutoffTime: '12:30'});
  const changed = norm({value: 8000}, old);
  equal(changed.value, 8000); equal(changed.cutoffTime, '12:30'); equal(changed.sourceNote, 'watch at cutoff');
  throws(() => norm({value: null}, old), 'INVALID_OBSERVATION_VALUE');
  equal(norm({sourceNote: null}, old).sourceNote, null);
  equal(old.value, 6000);
});
Deno.test('partial-day requires explicit cutoff, while no cutoff is fabricated for full-day', () => {
  throws(() => norm({...base(), coverage: 'PARTIAL_DAY'}), 'INVALID_OBSERVATION_CUTOFF');
  throws(() => norm({...base(), cutoffTime: '24:00'}), 'INVALID_OBSERVATION_CUTOFF');
  equal(norm(base()).cutoffTime, null);
  equal(norm({...base(), coverage: 'PARTIAL_DAY', cutoffTime: '00:00'}).cutoffTime, '00:00');
});
Deno.test('manual observation cannot impersonate identity/platform/source or change its domain', () => {
  for (const key of ['user_id', 'canonicalUserId', 'auth_user_id']) throws(() => norm({...base(), [key]: 'forged'}), 'CLIENT_IDENTITY_FORBIDDEN');
  for (const key of ['source', 'platform', 'sourceQuality']) throws(() => norm({...base(), [key]: 'android'}), 'UNKNOWN_OBSERVATION_FIELD');
  throws(() => norm({domain: 'total_energy'}, norm(base())), 'INVALID_OBSERVATION_DOMAIN');
  equal(norm(base()).source, 'manual'); equal(norm(base()).sourceQuality, 'UNKNOWN');
});
Deno.test('manual dates and timezone are explicit and validated', () => {
  throws(() => norm({...base(), date: '2026-02-30'}), 'INVALID_DATE');
  throws(() => norm({...base(), date: '2026-09-15'}), 'FUTURE_OBSERVATION_UNSUPPORTED');
  throws(() => norm({...base(), timezone: 'America/New_York'}), 'OBSERVATION_TIMEZONE_UNSUPPORTED');
});
Deno.test('duration-only sleep preserves duration without fabricated timing or stages', () => {
  const sleep = norm(base('sleep', 420));
  equal(sleep.startedAt, null); equal(sleep.endedAt, null); equal(sleep.value, 420);
  equal('rem' in sleep || 'deep' in sleep || 'efficiency' in sleep, false);
  const projected = projectManualObservationDay([row(base('sleep', 420))], [], day);
  equal(projected.sleep.value, 420); equal(projected.sleep.status, 'AVAILABLE');
  equal(observationEngineProjection([row(base('sleep', 420))], [], 'user-a', day).records, []);
  equal('analysisJobScheduled' in projected, false); equal('analysisStatus' in projected, false);
});
Deno.test('timed sleep supports midnight and keeps the existing wake-date contract', () => {
  const input = {...base('sleep', 420), startedAt: '2026-09-11T23:00:00+08:00', endedAt: '2026-09-12T06:00:00+08:00'};
  equal(norm(input).endedAt, '2026-09-11T22:00:00.000Z');
  const projected = observationEngineProjection([row(input)], [], 'user-a', day);
  equal(projected.records.length, 1); equal(projected.records[0].source, 'MANUAL_WEB'); equal(projected.records[0].value, 420);
  throws(() => norm({...input, date: '2026-09-11'}), 'INVALID_SLEEP_INTERVAL');
  throws(() => norm({...input, value: 421}), 'INVALID_SLEEP_INTERVAL');
});
Deno.test('optional timing is a pair; shorter reported sleep is not rewritten as the entire interval', () => {
  throws(() => norm({...base('sleep', 30), startedAt: '2026-09-12T00:00:00Z'}), 'INVALID_OBSERVATION_TIME');
  const input = {...base('sleep', 360), startedAt: '2026-09-11T23:00:00+08:00', endedAt: '2026-09-12T06:00:00+08:00'};
  equal(norm(input).value, 360);
  equal(observationEngineProjection([row(input)], [], 'a', day).records, []);
  throws(() => norm({...base(), startedAt: '2026-09-12T00:00:00Z', endedAt: '2026-09-12T01:00:00Z'}), 'INVALID_OBSERVATION_TIME');
});
Deno.test('multiple disjoint sleep sessions sum reported duration; overlapping sessions conflict', () => {
  const night = row({...base('sleep', 420), startedAt: '2026-09-11T23:00:00+08:00', endedAt: '2026-09-12T06:00:00+08:00'});
  const nap = row({...base('sleep', 30), startedAt: '2026-09-12T14:00:00+08:00', endedAt: '2026-09-12T14:30:00+08:00'}, 'nap');
  equal(projectManualObservationDay([night, nap], [], day).sleep.value, 450);
  const overlap = row({...base('sleep', 30), startedAt: '2026-09-12T05:30:00+08:00', endedAt: '2026-09-12T06:00:00+08:00'}, 'overlap');
  const conflict = projectManualObservationDay([night, overlap], [], day);
  equal(conflict.sleep.value, null); equal(conflict.sleep.status, 'OVERLAP_CONFLICT');
});
Deno.test('timed sleep overlap across wake dates conflicts on both days; exact adjacency does not', () => {
  const next = '2026-09-13';
  const evening = row({...base('sleep', 90), startedAt: day+'T22:00:00+08:00', endedAt: day+'T23:30:00+08:00'}, 'evening');
  const night = row({...base('sleep', 480), date: next, startedAt: day+'T23:00:00+08:00', endedAt: next+'T07:00:00+08:00'}, 'night');
  for (const targetDay of [day, next]) {
    const projection = projectManualObservationDay([evening, night], [], targetDay);
    equal(projection.sleep.status, 'OVERLAP_CONFLICT'); equal(projection.sleep.value, null);
    equal(projection.flags, ['OVERLAP_CONFLICT:sleep']);
    const engine = observationEngineProjection([evening, night], [], 'user-a', targetDay);
    equal(engine.records, []); equal(engine.blockedDomains, ['sleep']);
  }
  const adjacent = row({...base('sleep', 450), date: next, startedAt: day+'T23:30:00+08:00', endedAt: next+'T07:00:00+08:00'}, 'adjacent');
  for (const [targetDay, expected] of [[day, 90], [next, 450]] as const) {
    const projection = projectManualObservationDay([evening, adjacent], [], targetDay);
    equal(projection.sleep.status, 'AVAILABLE'); equal(projection.sleep.value, expected); equal(projection.flags, []);
    equal(observationEngineProjection([evening, adjacent], [], 'user-a', targetDay).records.length, 1);
  }
  // A tombstone must remove its conflict without altering the surviving raw row.
  equal(projectManualObservationDay([evening, {...night, deleted:true}], [], day).sleep.value, 90);
  equal(evening.body.value, 90); equal(night.body.value, 480);
});
Deno.test('duration-only mixed with another session cannot assume absence of overlap', () => {
  const rows = [row(base('sleep', 420)), row(base('sleep', 30), 'nap')];
  equal(projectManualObservationDay(rows, [], day).sleep.status, 'OVERLAP_UNRESOLVED');
  equal(observationEngineProjection(rows, [], 'a', day).blockedDomains, ['sleep']);
});
Deno.test('manual/automatic conflicts never sum or select latest/max for sleep or steps', () => {
  for (const domain of ['sleep', 'steps']) {
    const r = row(base(domain, domain === 'sleep' ? 420 : 8000)), automatic = [auto(domain)];
    const projected = projectManualObservationDay([r], automatic, day);
    const metric = domain === 'sleep' ? projected.sleep : projected.steps;
    equal(metric.value, null); equal(metric.status, 'SOURCE_CONFLICT');
    equal(observationEngineProjection([r], automatic, 'a', day).blockedDomains, [domain]);
    equal(observationReadState(r.body, projected).reconciliationStatus, 'SOURCE_CONFLICT');
  }
});
Deno.test('automatic tombstone/other date does not create source conflict', () => {
  const r = row(base('steps', 8000));
  equal(projectManualObservationDay([r], [{...auto('steps'), operation: 'DELETE'}], day).steps.value, 8000);
  equal(projectManualObservationDay([r], [{...auto('steps'), affected_local_dates: ['2026-09-11']}], day).steps.value, 8000);
});
Deno.test('duplicate daily totals conflict; steps and total energy stay independent', () => {
  const steps = row(base('steps', 8000)), energy = row(base('total_energy', 2200), 'energy');
  let projected = projectManualObservationDay([steps, energy], [], day);
  equal(projected.steps.value, 8000); equal(projected.totalEnergy.value, 2200);
  projected = projectManualObservationDay([steps, energy, row(base('steps', 6000), 'duplicate')], [], day);
  equal(projected.steps.value, null); equal(projected.steps.status, 'DAILY_TOTAL_CONFLICT'); equal(projected.totalEnergy.value, 2200);
});
Deno.test('partial totals remain visible but are not promoted to full-day engine inputs', () => {
  const r = row({...base('steps', 6000), coverage: 'PARTIAL_DAY', cutoffTime: '14:00'});
  equal(projectManualObservationDay([r], [], day).steps.value, 6000);
  equal(projectManualObservationDay([r], [], day).steps.status, 'PARTIAL_DAY');
  equal(observationEngineProjection([r], [], 'a', day).records, []);
});
Deno.test('total expenditure is never generic energy, BMR, activity or nutrition intake', () => {
  const r = row(base('total_energy', 2200));
  equal(observationEngineProjection([r], [], 'a', day).records, []);
  const projected = projectManualObservationDay([r], [auto('energy')], day);
  equal(projected.totalEnergy.value, null); equal(projected.totalEnergy.status, 'SOURCE_CONFLICT');
});
Deno.test('deleted manual observations do not reappear in projection or engine input', () => {
  const r = {...row(base('steps', 8000)), deleted: true};
  equal(projectManualObservationDay([r], [], day).steps.status, 'MISSING');
  equal(observationEngineProjection([r], [], 'a', day).records, []);
});
Deno.test('notes are bounded plain data, not HTML interpreted by the projection', () => {
  equal(norm({...base(), note: '<img src=x onerror=alert(1)>'}).note, '<img src=x onerror=alert(1)>');
  throws(() => norm({...base(), note: '\u0000'}), 'INVALID_OBSERVATION_NOTE');
  throws(() => norm({...base(), sourceNote: 'x'.repeat(281)}), 'INVALID_OBSERVATION_NOTE');
});
