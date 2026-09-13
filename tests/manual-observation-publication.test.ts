// Real dedicated PostgreSQL + actual runtime/SQL/ES256 authorization. Not Edge,
// browser, device evidence, or real Google OAuth. No DB/service is started here.
import assert from 'node:assert/strict';
import postgres from 'npm:postgres@3.4.8';
import {generateKeyPair, jwtVerify, SignJWT} from 'npm:jose@6.1.3';
import {LocalEngineRuntime, pgAdmin} from '../supabase/functions/mobile-health-beta/local-engine-runtime.ts';
import {recomputeBetaScore} from '../supabase/functions/mobile-health-beta/score-bridge.ts';

type Json = Record<string, any>;
const config = JSON.parse(await Deno.readTextFile(Deno.env.get('LOCAL_ENGINE_TEST_CONFIG')!));
if (config.host !== '127.0.0.1' || config.port !== 57484 || !/^health_engine_[a-f0-9]{32}$/.test(config.database)) {
  throw Error('UNSAFE_TEST_DATABASE');
}
const day = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const prior = new Date(Date.parse(day)-86400000).toISOString().slice(0,10);
const pgDay = (value: any) => value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);
function scoreRow(rows: Json[], type: string, date = day): Json {
  const row = rows.find(r => r.score_type === type && pgDay(r.score_date) === date);
  assert.ok(row, `Published ${type} row must exist for requested synthetic date`);
  return row;
}
const observation = (domain: string, value: number, extra: Json = {}) => ({
  clientRequestId:crypto.randomUUID(), domain, date:day, value,
  coverage:domain === 'sleep' ? 'SESSION' : 'FULL_DAY', ...extra,
});

async function setup(name: string) {
  const auth = crypto.randomUUID(), canonical = crypto.randomUUID();
  const {privateKey, publicKey} = await generateKeyPair('ES256');
  const issuer = 'http://127.0.0.1/manual-observation-publication-test', audience = 'isolated-synthetic-pg-test';
  const verify = async (token: string) => {
    const {payload} = await jwtVerify(token, publicKey, {issuer,audience,algorithms:['ES256']});
    if (payload.sub !== auth || !payload.jti) throw Error('INVALID_TOKEN');
    return {id:auth,email:auth+'@example.invalid',app_metadata:{provider:'google'},identities:[{provider:'google',identity_data:{sub:auth}}]};
  };
  const token = await new SignJWT({}).setProtectedHeader({alg:'ES256'}).setSubject(auth)
    .setIssuer(issuer).setAudience(audience).setJti(crypto.randomUUID()).setIssuedAt().setExpirationTime('15m').sign(privateKey);
  const runtime = new LocalEngineRuntime(config, verify);
  const owner = postgres({...config,username:'engine_owner',max:2});
  const legacy = postgres({...config,max:1});
  const events: Json[] = [];
  const event = (type: string, details: Json = {}) => events.push({sequence:events.length+1,type,at:new Date().toISOString(),...details});
  const request = (action: string, payload: Json = {}, signed = true) => new Request('http://127.0.0.1/manual-observation-publication', {
    method:'POST',headers:{'content-type':'application/json',...(signed ? {authorization:'Bearer '+token} : {})},
    body:JSON.stringify({action,payload}),
  });
  try {
    await runtime.start();
    // Per-test synthetic identity; never reuse existing fixture/user data.
    await owner`insert into auth.users values(${auth},${auth+'@example.invalid'},now())`;
    await owner`insert into auth.identities values(${crypto.randomUUID()},${auth},'google')`;
    await owner`insert into public.users(id,external_subject_hash,timezone) values(${canonical},${canonical.replaceAll('-','').repeat(2)},'Asia/Taipei')`;
    await owner`insert into private.beta_native_auth_identities(auth_user_id,canonical_user_id,provider) values(${auth},${canonical},'google')`;
    const identity = await runtime.identity(request('getManualProviderIdentity'));
    assert.equal(identity.canonical, canonical);
    assert.notEqual(identity.auth, identity.canonical);
    const anonymous = await runtime.handle(request('getManualObservations',{date:day},false));
    assert.notEqual(anonymous.status,200);
    event('VERIFIED_SYNTHETIC_AUTH_SUBJECT_MAPPED_TO_DISTINCT_CANONICAL_USER');
    const api = async (action: string, payload: Json = {}) => {
      const response = await runtime.handle(request(action,payload));
      const result = await response.json();
      assert.equal(response.status,200,JSON.stringify({action,status:response.status,error:result.error}));
      assert.equal(result.ok,true,JSON.stringify({action,error:result.error}));
      assert.equal(response.headers.get('cache-control'),'no-store');
      return result.data;
    };
    const state = async () => ({
      queue:await owner`select score_date::text,status,generation::text,engine_required,engine_published_generation::text,lease_token from private.beta_score_recompute_queue where canonical_user_id=${canonical} order by score_date`,
      heads:await owner`select * from public.engine_output_heads where canonical_user_id=${canonical} order by calculation_date,output_kind`,
      history:await owner`select * from public.engine_output_history where canonical_user_id=${canonical} order by calculation_date,output_kind,input_fingerprint`,
      scores:await owner`select * from public.beta_health_scores where canonical_user_id=${canonical} order by score_date,score_type`,
    });
    const claim = async () => {
      const lease = crypto.randomUUID();
      const jobs = await legacy`select * from public.beta_claim_score_recompute(${lease},${canonical},5)`;
      event('CLAIM_COMMIT_BARRIER',{jobs:jobs.length});
      return {lease,jobs};
    };
    const current = async () => {
      const value = await state();
      assert.ok(value.queue.length > 0);
      assert.ok(value.queue.every((q: Json) => q.status === 'COMPLETE' && BigInt(q.generation) > 0n && q.generation === q.engine_published_generation));
      assert.ok(value.queue.every((q: Json) => q.score_date >= prior && q.score_date <= day),'bounded fixture dates, not full-history recompute');
      return value;
    };
    const close = async () => {
      console.log(JSON.stringify({test:name,classification:'NATIVE_POSTGRES_ACTUAL_RUNTIME_SYNTHETIC_SIGNED_AUTH',transaction_events:events}));
      await runtime.close(); await owner.end(); await legacy.end();
    };
    return {runtime,owner,legacy,identity,api,state,current,claim,event,close,admin:pgAdmin(legacy,verify)};
  } catch (error) {
    await runtime.close(); await owner.end(); await legacy.end(); throw error;
  }
}

Deno.test('actual PG observation: full-day steps publish current frozen/portable scores and exact API read-back',async()=>{
  const c = await setup('steps-publication');
  try {
    const input = observation('steps',8000), saved = await c.api('upsertManualObservation',input);
    assert.equal(saved.record.value,8000);
    const rows = await c.api('getManualObservations',{date:day,domain:'steps'});
    assert.equal(rows.length,1); assert.equal(rows[0].recordId,saved.recordId);
    assert.equal(rows[0].source,'manual'); assert.equal(rows[0].sourceQuality,'UNKNOWN');
    assert.equal(rows[0].analysisStatus,'COMPUTED'); assert.equal(rows[0].analysisJobScheduled,false);
    const published = await c.current();
    assert.equal(published.queue.length,1); assert.equal(published.heads.length,7); assert.equal(published.scores.length,8);
    const frozen = scoreRow(published.scores,'activity');
    assert.ok(frozen.score !== null); assert.equal(frozen.algorithm_version,'health-score-v1.0');
    const expected = await c.runtime.compute(c.identity.canonical,day);
    assert.equal(expected.daily.metrics.steps,8000);
    const snapshot = await c.api('localEngineSnapshot',{date:day});
    const activity = snapshot.outputs.find((r:Json)=>r.domain==='activity');
    assert.equal(activity.input_fingerprint,expected.outputs.activity.input_fingerprint);
    assert.equal(activity.metrics.daily.steps,8000); assert.notEqual(activity.score_status,'STALE');
    const dashboard = await c.api('getDashboardData',{date:day});
    assert.equal(dashboard.today.steps,8000);
    await c.api('upsertManualObservation',input);
    assert.deepEqual(await c.state(),published,'request replay cannot create a new publication/generation');
    c.event('HTTP_WRITE_SQL_READ_AND_CURRENT_PUBLICATION_AGREE',{raw_rows:rows.length,queue_dates:published.queue.length});
  } finally {await c.close();}
});

Deno.test('actual PG observation: stale generation, wrong lease and expired lease cannot publish',async()=>{
  const c = await setup('observation-stale-lease');
  try {
    // Verify identity before direct store writes; bypass only automatic drain to
    // establish a real committed claim barrier, not auth or persistence.
    const saved = await c.runtime.manualObservations.write(c.identity,observation('steps',6000));
    const old = await c.claim(); assert.equal(old.jobs.length,1);
    assert.equal(await c.runtime.drain(c.identity.canonical),0);
    await c.runtime.manualObservations.write(c.identity,observation('steps',8000,{recordId:saved.recordId,revision:1}));
    const before = await c.state();
    await assert.rejects(()=>c.runtime.processClaimedJob(old.jobs[0],old.lease),/STALE_SCORE_INPUT/);
    assert.deepEqual(await c.state(),before); assert.equal(before.heads.length,0);
    const active = await c.claim(); assert.equal(active.jobs.length,1);
    await assert.rejects(()=>c.runtime.processClaimedJob(active.jobs[0],crypto.randomUUID()),/STALE_SCORE_INPUT/);
    await c.owner`update private.beta_score_recompute_queue set lease_expires_at=now()-interval '1 second' where canonical_user_id=${c.identity.canonical}`;
    await assert.rejects(()=>c.runtime.processClaimedJob(active.jobs[0],active.lease),/STALE_SCORE_INPUT/);
    assert.equal((await c.state()).heads.length,0);
    assert.equal(await c.runtime.drain(c.identity.canonical),1);
    await c.current();
    const result = await c.runtime.compute(c.identity.canonical,day);
    assert.equal(result.daily.metrics.steps,8000);
    c.event('STALE_WRONG_AND_EXPIRED_LEASE_REJECTED_NEWEST_INPUT_PUBLISHED');
  } finally {await c.close();}
});

Deno.test('actual PG observation: tombstone clears scores and receipt replay cannot resurrect deleted input',async()=>{
  const c = await setup('observation-delete-nonresurrection');
  try {
    const create = observation('steps',8000), saved = await c.api('upsertManualObservation',create);
    const before = await c.current();
    assert.ok(scoreRow(before.scores,'activity').score !== null);
    await c.api('deleteManualObservation',{clientRequestId:crypto.randomUUID(),recordId:saved.recordId,revision:1});
    const after = await c.current();
    assert.equal((await c.api('getManualObservations',{date:day})).length,0);
    assert.equal(scoreRow(after.scores,'activity').score,null);
    const expected = await c.runtime.compute(c.identity.canonical,day);
    assert.equal(expected.daily.metrics.steps,null); assert.equal(expected.outputs.activity.score,null);
    const snap = await c.api('localEngineSnapshot',{date:day});
    const activity = snap.outputs.find((r:Json)=>r.domain==='activity');
    assert.equal(activity.score,null); assert.equal(activity.metrics.daily.steps,null); assert.notEqual(activity.score_status,'STALE');
    const [raw] = await c.owner`select revision::text,deleted,body from public.engine_manual_observations where canonical_user_id=${c.identity.canonical} and record_id=${saved.recordId}`;
    assert.equal(raw.deleted,true); assert.equal(raw.revision,'2'); assert.equal(raw.body.source,'manual');
    await c.api('upsertManualObservation',create);
    assert.equal((await c.api('getManualObservations',{date:day})).length,0);
    assert.deepEqual(await c.state(),after);
    assert.equal(await c.runtime.drain(c.identity.canonical),0);
    c.event('TOMBSTONE_AND_PUBLISHED_NULL_SURVIVE_OLD_CREATE_RECEIPT_REPLAY');
  } finally {await c.close();}
});

Deno.test('actual PG observation: duration-only sleep feeds existing duration score without fabricated portable interval',async()=>{
  const c = await setup('sleep-duration-and-timed');
  try {
    const saved = await c.api('upsertManualObservation',observation('sleep',420));
    const before = await c.current(), frozen = scoreRow(before.scores,'sleep');
    assert.ok(frozen.score !== null);
    const [raw] = await c.api('getManualObservations',{date:day,domain:'sleep'});
    assert.equal(raw.startedAt,null); assert.equal(raw.endedAt,null); assert.equal(raw.value,420);
    assert.equal(raw.analysisStatus,'COMPUTED'); assert.equal(raw.analysisJobScheduled,false);
    const duration = await c.runtime.compute(c.identity.canonical,day);
    assert.equal(duration.daily.metrics.sleep_minutes,null); assert.equal(duration.daily.metrics.bedtime_minute,null);
    assert.equal(duration.outputs.sleep.score,null);
    const sleepRead = await c.api('getSleepRecords',{date:day});
    assert.equal(sleepRead[0].totalSleepMinutes,420);
    await c.api('upsertManualObservation',observation('sleep',420,{recordId:saved.recordId,revision:1,startedAt:prior+'T23:00:00+08:00',endedAt:day+'T06:00:00+08:00'}));
    const after = await c.current(), timed = await c.runtime.compute(c.identity.canonical,day);
    assert.equal(timed.daily.metrics.sleep_minutes,420); assert.equal(timed.daily.metrics.bedtime_minute,23*60);
    assert.ok(timed.outputs.sleep.score !== null);
    assert.equal(scoreRow(after.scores,'sleep').score,frozen.score,'same raw duration does not silently change frozen formula');
    const [native] = await c.owner`select count(*)::int as n from public.beta_health_records where canonical_user_id=${c.identity.canonical}`;
    assert.equal(native.n,0,'manual input never impersonates native ingestion');
    c.event('DURATION_SCORE_AND_EXACT_INTERVAL_ADAPTER_SEPARATELY_VERIFIED');
  } finally {await c.close();}
});

Deno.test('actual PG observation: cross-wake-date sleep overlap invalidates both days and tombstone restores prior publication',async()=>{
  const c = await setup('cross-wake-date-sleep-overlap');
  try {
    const firstInput = observation('sleep',90,{date:prior,startedAt:prior+'T22:00:00+08:00',endedAt:prior+'T23:30:00+08:00'});
    const first = await c.api('upsertManualObservation',firstInput);
    const baseline = await c.current(), firstScore = scoreRow(baseline.scores,'sleep',prior).score;
    assert.ok(firstScore !== null);
    const baselineQueue = baseline.queue.find((q:Json)=>q.score_date===prior)!;
    assert.equal((await c.runtime.compute(c.identity.canonical,prior)).daily.metrics.sleep_minutes,90);
    const overlappingInput = observation('sleep',480,{startedAt:prior+'T23:00:00+08:00',endedAt:day+'T07:00:00+08:00'});
    // Verified identity + real committed SQL/trigger path, with drain deliberately
    // deferred so the earlier wake-date invalidation is observable, not inferred.
    const overlapping = await c.runtime.manualObservations.write(c.identity,overlappingInput);
    const dirty = await c.state(), priorQueue = dirty.queue.find((q:Json)=>q.score_date===prior)!;
    assert.equal(priorQueue.status,'DIRTY','later wake-date overlap must invalidate already-published prior date');
    assert.ok(BigInt(priorQueue.generation)>BigInt(baselineQueue.generation));
    assert.deepEqual(dirty.queue.map((q:Json)=>q.score_date),[prior,day],'only bounded actual fixture dates are queued');
    c.event('LATER_WAKE_DATE_OVERLAP_COMMITTED_PRIOR_PUBLICATION_INVALIDATED',{queue_dates:dirty.queue.length});
    const assertConflictRead = async(date:string,expectedId:string,expectedValue:number) => {
      const raw = await c.api('getManualObservations',{date,domain:'sleep'});
      assert.equal(raw.length,1,'neighbor detection must not leak neighboring dates into one-day raw read');
      assert.equal(raw[0].recordId,expectedId); assert.equal(raw[0].value,expectedValue);
      assert.equal(raw[0].reconciliationStatus,'OVERLAP_CONFLICT');
      assert.ok(raw[0].reconciliationFlags.includes('OVERLAP_CONFLICT:sleep'));
      assert.equal(raw[0].analysisStatus,'INSUFFICIENT_DATA'); assert.equal(raw[0].score,null);
      const detail = await c.api('getSleepRecords',{date});
      assert.equal(detail.length,1); assert.equal(detail[0].date,date); assert.equal(detail[0].totalSleepMinutes,null);
      const daily = await c.api('getManualObservationDaily',{date});
      assert.equal(daily.length,1); assert.equal(daily[0].date,date); assert.equal(daily[0].sleep.status,'OVERLAP_CONFLICT');
    };
    await assertConflictRead(prior,first.recordId,90);
    await assertConflictRead(day,overlapping.recordId,480);
    await c.runtime.drain(c.identity.canonical);
    const conflicted = await c.current();
    for (const date of [prior,day]) {
      assert.equal(scoreRow(conflicted.scores,'sleep',date).score,null);
      assert.equal((await c.runtime.compute(c.identity.canonical,date)).daily.metrics.sleep_minutes,null);
      const snapshot = await c.api('localEngineSnapshot',{date});
      const published = snapshot.outputs.find((r:Json)=>r.domain==='sleep');
      assert.ok(published); assert.equal(published.metrics.daily.sleep_minutes,null); assert.notEqual(published.score_status,'STALE');
    }
    const deletion = {clientRequestId:crypto.randomUUID(),recordId:overlapping.recordId,revision:1};
    await c.api('deleteManualObservation',deletion);
    const recovered = await c.current();
    assert.equal(scoreRow(recovered.scores,'sleep',prior).score,firstScore);
    assert.equal(scoreRow(recovered.scores,'sleep',day).score,null);
    assert.equal((await c.runtime.compute(c.identity.canonical,prior)).daily.metrics.sleep_minutes,90);
    const restoredRaw = await c.api('getManualObservations',{date:prior,domain:'sleep'});
    assert.equal(restoredRaw.length,1); assert.equal(restoredRaw[0].recordId,first.recordId); assert.equal(restoredRaw[0].revision,1);
    assert.equal(restoredRaw[0].reconciliationStatus,'AVAILABLE');
    assert.equal((await c.api('getSleepRecords',{date:prior}))[0].totalSleepMinutes,90);
    assert.equal((await c.api('getManualObservations',{date:day,domain:'sleep'})).length,0);
    await c.api('upsertManualObservation',overlappingInput);
    await c.api('deleteManualObservation',deletion);
    assert.equal((await c.api('getManualObservations',{date:day,domain:'sleep'})).length,0);
    assert.deepEqual(await c.state(),recovered,'receipt replay cannot restore deleted conflicting sleep or republish scores');
    const [tombstone] = await c.owner`select deleted,revision::text from public.engine_manual_observations where canonical_user_id=${c.identity.canonical} and record_id=${overlapping.recordId}`;
    assert.equal(tombstone.deleted,true); assert.equal(tombstone.revision,'2');
    // Control: end == next start is adjacent, not overlapping. It must remain
    // accepted and retain each wake-date value without invented allocation.
    await c.api('upsertManualObservation',observation('sleep',450,{startedAt:prior+'T23:30:00+08:00',endedAt:day+'T07:00:00+08:00'}));
    const adjacent = await c.current();
    assert.equal(scoreRow(adjacent.scores,'sleep',prior).score,firstScore);
    for (const [date,value] of [[prior,90],[day,450]] as const) {
      const raw = await c.api('getManualObservations',{date,domain:'sleep'});
      assert.equal(raw.length,1); assert.equal(raw[0].reconciliationStatus,'AVAILABLE'); assert.equal(raw[0].value,value);
      assert.equal((await c.runtime.compute(c.identity.canonical,date)).daily.metrics.sleep_minutes,value);
      assert.equal((await c.api('getSleepRecords',{date}))[0].totalSleepMinutes,value);
    }
    c.event('CROSS_WAKE_DATE_CONFLICT_NULL_PUBLICATION_DELETE_RECOVERY_REPLAY_AND_ADJACENCY_VERIFIED');
  } finally {await c.close();}
});

Deno.test('actual PG observation: native two-day interval retains D1 while manual D2 conflict masks only D2',async()=>{
  const c = await setup('cross-day-native-conflict');
  try {
    const sourceId = crypto.randomUUID(), hash = sourceId.replaceAll('-','').repeat(2);
    const canonical = {domain:'steps',recorded_at:day+'T01:00:00+08:00',started_at:prior+'T23:00:00+08:00',ended_at:day+'T01:00:00+08:00',value:1200,unit:'count'};
    await c.owner`insert into public.beta_health_records(canonical_user_id,platform,domain,source_app,source_record_id,source_revision,source_content_hash,idempotency_key,operation,canonical_record,affected_local_dates)
      values(${c.identity.canonical},'android','steps','SYNTHETIC native interval fixture NOT DEVICE EVIDENCE',${sourceId},1,${hash},${hash},'UPSERT',${c.owner.json(canonical)},array[${prior}::date,${day}::date])`;
    await c.runtime.drain(c.identity.canonical);
    const beforeD1 = await c.runtime.compute(c.identity.canonical,prior), beforeD2 = await c.runtime.compute(c.identity.canonical,day);
    assert.equal(beforeD1.daily.metrics.steps,600); assert.equal(beforeD2.daily.metrics.steps,600);
    assert.ok(beforeD1.daily.flags.includes('ESTIMATED_INTERVAL_PRORATION:steps'));
    const frozenD1 = scoreRow((await c.state()).scores,'activity',prior);
    await c.api('upsertManualObservation',observation('steps',8000));
    const after = await c.current(), afterD1 = await c.runtime.compute(c.identity.canonical,prior), afterD2 = await c.runtime.compute(c.identity.canonical,day);
    assert.equal(afterD1.daily.metrics.steps,600); assert.deepEqual(afterD1.daily.flags,beforeD1.daily.flags);
    assert.equal(afterD2.daily.metrics.steps,null); assert.ok(afterD2.daily.flags.includes('SOURCE_CONFLICT:steps'));
    assert.equal(afterD2.derived.steps_7d_count,1); assert.equal(afterD2.derived.steps_7d_avg,600);
    assert.notEqual(afterD2.daily.input_fingerprint,beforeD2.daily.input_fingerprint);
    assert.deepEqual(afterD2.daily.evidence_ids,beforeD2.daily.evidence_ids);
    assert.equal(scoreRow(after.scores,'activity').score,null);
    assert.equal(scoreRow(after.scores,'activity',prior).score,frozenD1.score);
    const [raw] = await c.api('getManualObservations',{date:day,domain:'steps'});
    assert.equal(raw.value,8000); assert.equal(raw.reconciliationStatus,'SOURCE_CONFLICT'); assert.equal(raw.analysisStatus,'INSUFFICIENT_DATA');
    const [stored] = await c.owner`select canonical_record,source_content_hash from public.beta_health_records where canonical_user_id=${c.identity.canonical} and source_record_id=${sourceId}`;
    assert.deepEqual(stored.canonical_record,canonical); assert.equal(stored.source_content_hash,hash);
    c.event('MASK_IS_RUNTIME_PROJECTION_NATIVE_VALUE_INTERVAL_HASH_UNCHANGED',{queue_dates:after.queue.length});
  } finally {await c.close();}
});

Deno.test('actual PG observation: partial steps and total expenditure stay raw values, not full-day dashboard counts or scores',async()=>{
  const c = await setup('partial-observations-no-full-day-promotion');
  try {
    await c.api('upsertManualObservation',observation('steps',6000,{coverage:'PARTIAL_DAY',cutoffTime:'12:00'}));
    await c.api('upsertManualObservation',observation('total_energy',1800,{coverage:'PARTIAL_DAY',cutoffTime:'12:00'}));
    await c.current();
    const rows = await c.api('getManualObservations',{date:day});
    assert.equal(rows.find((r:Json)=>r.domain==='steps').value,6000);
    assert.equal(rows.find((r:Json)=>r.domain==='total_energy').value,1800);
    assert.ok(rows.every((r:Json)=>r.analysisStatus==='ANALYSIS_NOT_ENABLED'&&!r.analysisJobScheduled));
    const activityRead = (await c.api('getActivityRecords',{date:day}))[0];
    assert.equal(activityRead.steps,6000); assert.equal(activityRead.totalCalories,1800);
    assert.equal(activityRead.coverage.steps,'PARTIAL_DAY'); assert.equal(activityRead.coverage.totalEnergy,'PARTIAL_DAY');
    assert.equal(activityRead.activeCalories,null);
    const dashboard = (await c.api('getDashboardData',{date:day})).today;
    assert.equal(dashboard.steps,null); assert.equal(dashboard.caloriesBurned,null);
    const bundle = await c.runtime.compute(c.identity.canonical,day);
    assert.equal(bundle.daily.metrics.steps,null); assert.equal(bundle.daily.metrics.calories_burned,null);
    assert.equal(bundle.outputs.activity.score,null);
    const frozen = scoreRow((await c.current()).scores,'activity');
    assert.equal(frozen.score,null);
    c.event('PARTIAL_COVERAGE_NOT_PROMOTED_AND_TOTAL_ENERGY_NOT_GENERIC_OR_ACTIVE_CALORIES');
  } finally {await c.close();}
});

Deno.test('actual PG observation: publication failure rolls back outputs and marker while preserving raw data and receipt',async()=>{
  const c = await setup('observation-publication-atomicity');
  try {
    const input = observation('steps',8000);
    const saved = await c.runtime.manualObservations.write(c.identity,input);
    const claimed = await c.claim(); assert.equal(claimed.jobs.length,1);
    await assert.rejects(()=>recomputeBetaScore(c.admin,c.identity.canonical,day),/ENGINE_PUBLICATION_REQUIRED/);
    const before = await c.state();
    const original = c.runtime.sql.begin.bind(c.runtime.sql);
    c.runtime.sql.begin = (options:any,callback?:any) => {
      const work = callback ?? options;
      const invoke = async(tx:any) => work(new Proxy(tx,{get(target,key) {
        if (key === 'unsafe') return async(text:string,args:any[]) => {
          if (text.includes('public.beta_persist_score_bundle')) throw Error('SYNTHETIC_OBSERVATION_AFTER_MARKER_FAILURE');
          return target.unsafe(text,args);
        };
        return Reflect.get(target,key);
      }}));
      return callback ? original(options,invoke) : original(invoke);
    };
    try {await assert.rejects(()=>c.runtime.processClaimedJob(claimed.jobs[0],claimed.lease),/SYNTHETIC_OBSERVATION_AFTER_MARKER_FAILURE/);}
    finally {c.runtime.sql.begin = original;}
    assert.deepEqual(await c.state(),before);
    assert.equal(before.queue[0].engine_published_generation,'0');
    const [raw] = await c.api('getManualObservations',{date:day,domain:'steps'});
    assert.equal(raw.recordId,saved.recordId); assert.equal(raw.value,8000);
    assert.equal((await c.api('getObservationWriteStatus',{clientRequestId:input.clientRequestId})).exists,true);
    await c.runtime.processClaimedJob(claimed.jobs[0],claimed.lease);
    await c.current();
    c.event('AFTER_MARKER_FAILURE_ROLLBACK_THEN_SAME_LEASE_RECOVERY');
  } finally {await c.close();}
});

Deno.test('actual PG observation: moving an input invalidates only old/new bounded days and deletion leaves no current score',async()=>{
  const c = await setup('observation-moved-date');
  try {
    const saved = await c.api('upsertManualObservation',observation('steps',6000,{date:prior}));
    await c.current();
    const moved = await c.runtime.manualObservations.write(c.identity,observation('steps',8000,{recordId:saved.recordId,revision:1}));
    assert.deepEqual([...moved.invalidatedDates].sort(),[prior,day]);
    const dirty = await c.state();
    assert.deepEqual(dirty.queue.map((q:Json)=>q.score_date),[prior,day]);
    assert.ok(dirty.queue.every((q:Json)=>q.status==='DIRTY'&&q.engine_required));
    assert.equal(await c.runtime.drain(c.identity.canonical),2);
    assert.equal((await c.runtime.compute(c.identity.canonical,prior)).daily.metrics.steps,null);
    assert.equal((await c.runtime.compute(c.identity.canonical,day)).daily.metrics.steps,8000);
    await c.api('deleteManualObservation',{clientRequestId:crypto.randomUUID(),recordId:saved.recordId,revision:2});
    const after = await c.current();
    assert.ok(after.scores.filter((r:Json)=>r.score_type==='activity').every((r:Json)=>r.score===null));
    c.event('OLD_NEW_DATE_AND_TOMBSTONE_BOUNDED_RECONCILIATION',{queue_dates:after.queue.length});
  } finally {await c.close();}
});

Deno.test('actual PG observation: coherent timeline snapshot cannot mix old frozen score with newly deleted raw value',async()=>{
  const c = await setup('observation-coherent-timeline-barrier');
  const writer = new LocalEngineRuntime(config,c.runtime.verify);
  let release!: () => void, observed!: () => void;
  const released = new Promise<void>(resolve=>release=resolve);
  const reached = new Promise<void>(resolve=>observed=resolve);
  const bounded = async<T>(work:Promise<T>,label:string) => {
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),8000);})]);}
    finally {clearTimeout(timer);}
  };
  const original = c.runtime.sql.begin.bind(c.runtime.sql);
  let reading:Promise<any>|undefined, intercepted = false;
  try {
    await writer.start();
    const saved = await c.api('upsertManualObservation',observation('steps',8000));
    const published = await c.current(), oldActivity = scoreRow(published.scores,'activity').score;
    assert.ok(oldActivity !== null);
    const baseline = (await c.api('getDashboardData',{date:day})).today;
    assert.equal(baseline.steps,8000); assert.equal(baseline.activityScore,oldActivity);
    // Execute the real tagged SELECT, then hold its transaction before returning
    // those real rows. No result is manufactured, no DB/auth path is replaced.
    c.runtime.sql.begin = (options:any,callback?:any) => {
      const work = callback ?? options;
      const invoke = async(tx:any) => work(new Proxy(tx,{apply(target,thisArg,args) {
        const query = Reflect.apply(target,thisArg,args);
        const template = Array.isArray(args[0]) ? args[0].join(' ? ') : '';
        if (!intercepted && template.includes('from public.beta_health_scores s') && template.includes('queue_status')) {
          intercepted = true;
          return (async()=>{
            const realRows = await query;
            c.event('FROZEN_SELECT_REAL_ROWS_READ_TRANSACTION_HELD'); observed();
            await bounded(released,'TIMELINE_SELECT_BARRIER_RELEASE_TIMEOUT');
            return realRows;
          })();
        }
        return query;
      }}));
      return callback ? original(options,invoke) : original(invoke);
    };
    reading = c.api('getDashboardData',{date:day});
    reading.catch(()=>{});
    await bounded(Promise.race([reached,reading.then(()=>{throw Error('TIMELINE_SELECT_BARRIER_NOT_REACHED');})]),'TIMELINE_SELECT_BARRIER_TIMEOUT');
    // Independent PostgreSQL connection pool/runtime commits a real tombstone.
    // Deliberately do not drain: generation N+1 must be DIRTY, not published.
    await writer.manualObservations.write(c.identity,{clientRequestId:crypto.randomUUID(),recordId:saved.recordId,revision:1},true);
    const concurrent = await c.state();
    assert.equal(concurrent.queue[0].status,'DIRTY');
    assert.ok(BigInt(concurrent.queue[0].generation)>BigInt(concurrent.queue[0].engine_published_generation));
    const [raw] = await c.owner`select deleted,revision::text from public.engine_manual_observations where canonical_user_id=${c.identity.canonical} and record_id=${saved.recordId}`;
    assert.equal(raw.deleted,true); assert.equal(raw.revision,'2');
    c.event('INDEPENDENT_TOMBSTONE_COMMITTED_WHILE_TIMELINE_READ_HELD');
    release();
    const result = (await bounded(reading,'TIMELINE_READ_COMPLETION_TIMEOUT')).today;
    assert.ok(result);
    const oldConsistent = result.steps === baseline.steps && result.activityScore === baseline.activityScore && result.healthScore === baseline.healthScore;
    const newExplicitlyStale = result.steps === null && result.activityScore === null && result.healthScore === null && result.healthStatus === 'STALE';
    assert.ok(oldConsistent || newExplicitlyStale,'timeline mixed an old published score with newer deleted raw data; return one coherent snapshot or generation-fenced STALE/null');
    c.event('TIMELINE_SNAPSHOT_COHERENT',{old_snapshot:oldConsistent,generation_fenced_stale:newExplicitlyStale});
  } finally {
    release(); c.runtime.sql.begin = original;
    if(reading)await reading.catch(()=>{});
    await writer.close(); await c.close();
  }
});
