// Fresh dedicated PG integration; real signed local authority/handler/SQL, not Edge/OAuth.
import assert from 'node:assert/strict';
import postgres from 'npm:postgres@3.4.8';
import {LocalEngineRuntime} from '../supabase/functions/mobile-health-beta/local-engine-runtime.ts';
import {createSyntheticAuthority} from './local-engine-auth.ts';
const [file,output]=Deno.args,config=JSON.parse(await Deno.readTextFile(file));
if(config.host!=='127.0.0.1'||config.port!==57485||!/^health_engine_[a-f0-9]{32}$/.test(config.database))throw Error('UNSAFE_TEST_TARGET');
const authority=await createSyntheticAuthority(),runtime=new LocalEngineRuntime(config,authority.verify),admin=postgres({...config,username:'engine_owner',max:2});await runtime.start();
const token=await authority.issue('A'),tokenB=await authority.issue('B');
const request=(token:string,action:string,payload:any={})=>new Request('http://127.0.0.1/v1/engine/web',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({action,payload})});
const A=await runtime.identity(request(token,'getBodyRecords')),B=await runtime.identity(request(tokenB,'getBodyRecords'));
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift=(n:number)=>new Date(Date.parse(day)+n*86400000).toISOString().slice(0,10);
const api=async(action:string,payload:any={},as=token)=>{const r=await runtime.handle(request(as,action,payload));return{status:r.status,...await r.json()};};
const good=async(action:string,payload:any={},as=token)=>{const r=await api(action,payload,as);assert.equal(r.ok,true,JSON.stringify(r));return r.data;};
const report:any={started_at:new Date().toISOString(),runtime:'DENO_ACTUAL_HANDLER_NATIVE_PG_NOT_EDGE',server:(await admin`select version(),current_database()`)[0],gates:[],performance:[]};
async function gate(name:string,fn:()=>Promise<void>){const start=new Date().toISOString();try{await fn();report.gates.push({name,status:'PASS',started_at:start,ended_at:new Date().toISOString()});}catch(error){report.gates.push({name,status:'FAIL',started_at:start,ended_at:new Date().toISOString(),error:(error as Error).stack});}}
const head=async()=> (await runtime.snapshot(A,{date:day})).outputs.find((r:any)=>r.domain==='body');
let todayRecord:any;
try{
 await gate('manual_body_raw_to_existing_derived_score_readback',async()=>{
  for(let i=-7;i<=0;i++)await runtime.manualBody.write(A,{date:shift(i),weight:80,bodyFat:20,clientRequestId:crypto.randomUUID()});
  const queued=await runtime.manualBody.analysis(A,day);assert.equal(queued.analysisJobScheduled,true);
  await runtime.drain(A.canonical);todayRecord=(await good('getBodyRecords',{date:day}))[0];
  const expected=(globalThis as any).HEALTH_SCORE_V1_RUNTIME.calculateBodyCompositionScore({weight:80,weightBaseline:80,fatMass:16,fatMassBaseline:16,baselineSampleCount:7});
  assert.equal(todayRecord.bodyScore,expected.score);assert.equal(todayRecord.bodyMetrics.weight_7d_count,7);assert.equal(todayRecord.bodyMetrics.weight_baseline_count,7);assert.equal(todayRecord.fatMass,16);assert.equal(todayRecord.analysisJobScheduled,false);assert.equal(todayRecord.analysisStatus,'COMPUTED');assert.equal((await head()).score,expected.score);
  assert.equal((await good('getBodyRecords',{date:day},tokenB)).length,0);
  assert.equal((await admin`select count(*)::int as n from public.beta_health_records`)[0].n,0,'manual not fabricated mobile ingestion');
  const frozen=await admin`select score from public.beta_health_scores where canonical_user_id=${A.canonical} and score_type='body_composition'`;
  assert.ok(frozen.every(r=>r.score===null),'existing mobile score bridge semantics unchanged');
 });
 await gate('manual_body_replay_old_new_dates_28d_bound_and_newer_revision',async()=>{
  const input={date:shift(-40),weight:78,clientRequestId:crypto.randomUUID()},old=await runtime.manualBody.write(A,input);
  const queue=()=>admin`select score_date::text,generation::text from private.beta_score_recompute_queue where canonical_user_id=${A.canonical} order by score_date`;
  const before=await queue();assert.equal((await runtime.manualBody.write(A,input)).replayed,true);assert.deepEqual(await queue(),before);
  const moved=await runtime.manualBody.write(A,{recordId:old.recordId,revision:1,date:shift(-39),weight:79,clientRequestId:crypto.randomUUID()});
  const after=await queue(),prior=new Map(before.map(r=>[r.score_date,r.generation]));
  const changed=after.filter(r=>prior.get(r.score_date)!==r.generation).map(r=>r.score_date);
  assert.equal(changed.length,29);assert.equal(changed[0],shift(-40));assert.equal(changed.at(-1),shift(-12));
  const attempts=await Promise.all([80,81].map(weight=>api('upsertBodyRecord',{recordId:moved.recordId,revision:2,date:shift(-39),weight,clientRequestId:crypto.randomUUID()})));
  assert.equal(attempts.filter(r=>r.ok).length,1);assert.equal(attempts.find(r=>!r.ok).error,'STALE_REVISION');
  report.body_date_invalidation={changed_dates:changed,rolling_bound:28,original_and_new:true,replay_invalidations:0};
 });
 await gate('body_stale_job_cannot_publish_then_retry_and_delete_reconciliation',async()=>{
  const original=runtime.compute.bind(runtime);let inject=true;
  await runtime.manualBody.write(A,{recordId:todayRecord.recordId,revision:1,date:day,weight:81,bodyFat:20,clientRequestId:crypto.randomUUID()});
  const previous=(await head()).input_fingerprint;
  runtime.compute=async(user:string,date:string)=>{const result=await original(user,date);if(date===day&&inject){inject=false;await runtime.manualBody.write(A,{recordId:todayRecord.recordId,revision:2,date:day,weight:82,bodyFat:20,clientRequestId:crypto.randomUUID()});}return result;};
  try{await assert.rejects(()=>runtime.drain(A.canonical));assert.equal((await head()).input_fingerprint,previous);assert.equal((await head()).score_status,'STALE');}
  finally{runtime.compute=original;}
  await runtime.drain(A.canonical);assert.equal((await head()).metrics.daily.weight,82);assert.notEqual((await head()).input_fingerprint,previous);
  const records=await good('getBodyRecords',{startDate:shift(-60),endDate:day});
  for(const r of records)await runtime.manualBody.write(A,{recordId:r.recordId,revision:r.revision,clientRequestId:crypto.randomUUID()},true);
  await runtime.drain(A.canonical);await runtime.drain(A.canonical);
  assert.equal((await good('getBodyRecords',{})).length,0);assert.equal((await head()).score,null);assert.equal((await head()).score_status,'INSUFFICIENT_DATA');
  assert.equal((await admin`select count(*)::int as n from public.engine_manual_body_records where not deleted`)[0].n,0);
  assert.ok((await admin`select count(*)::int as n from public.engine_manual_body_records where deleted`)[0].n>=9);
 });
 await gate('custom_create_duplicate_name_stable_id_category_history_and_tenant_security',async()=>{
  const input={operation:'create',name:'SYNTHETIC <b>same</b>',muscleGroup:'腿',clientRequestId:crypto.randomUUID()};
  const one=await good('manageExercise',input),replay=await good('manageExercise',input),two=await good('manageExercise',{...input,clientRequestId:crypto.randomUUID()});
  assert.equal(replay.exerciseId,one.exerciseId);assert.equal(replay.replayed,true);assert.notEqual(one.exerciseId,two.exerciseId);
  assert.equal((await good('getExerciseDatabase',{},tokenB)).some((r:any)=>r.exerciseId===one.exerciseId),false);
  const workout=await good('addWorkoutRecord',{date:day,startTime:day+'T00:00:00Z',endTime:day+'T00:20:00Z',clientRequestId:crypto.randomUUID(),exercises:[{exerciseId:one.exerciseId,sets:[{weight:10,reps:5}]}]});
  await good('manageExercise',{operation:'classify',exerciseId:one.exerciseId,revision:1,muscleGroup:'全身',clientRequestId:crypto.randomUUID()});
  await good('manageExercise',{operation:'rename',exerciseId:one.exerciseId,revision:2,name:'SYNTHETIC renamed',clientRequestId:crypto.randomUUID()});
  const history=(await good('getWorkoutRecords',{date:day})).records.find((r:any)=>r.recordId===workout.records[0].recordId);
  assert.equal(history.exerciseName,input.name);assert.equal(history.muscleGroup,'腿');assert.equal(history.totalVolume,50);
  assert.equal((await api('manageExercise',{operation:'delete',exerciseId:one.exerciseId,revision:3,clientRequestId:crypto.randomUUID()})).error,'EXERCISE_REFERENCED');
  assert.equal((await api('manageExercise',{operation:'rename',exerciseId:one.exerciseId,revision:3,name:'forged',clientRequestId:crypto.randomUUID()},tokenB)).ok,false);
  assert.equal((await api('manageExercise',{...input,user_id:B.canonical,clientRequestId:crypto.randomUUID()})).error,'CLIENT_IDENTITY_FORBIDDEN');
  await good('manageExercise',{operation:'delete',exerciseId:two.exerciseId,revision:1,clientRequestId:crypto.randomUUID()});
  const before=(await good('getExerciseDatabase')).length;for(const value of ['', 'x'.repeat(41),'a\u202eb'])assert.equal((await api('manageExercise',{...input,muscleGroup:value,clientRequestId:crypto.randomUUID()})).ok,false);assert.equal((await good('getExerciseDatabase')).length,before);
 });
 await gate('post_commit_analysis_failure_keeps_saved_receipt_visible',async()=>{
  const original=runtime.manualBody.analysis.bind(runtime.manualBody),input={date:day,weight:83,clientRequestId:crypto.randomUUID()};
  runtime.manualBody.analysis=()=>Promise.reject(Object.assign(Error('synthetic post-commit analysis timeout'),{code:'57014'}));
  try{
   const saved=await good('upsertBodyRecord',input);assert.equal(saved.status,'SAVED');assert.equal(saved.analysisStatus,'ANALYSIS_UNAVAILABLE');assert.equal(saved.analysisJobScheduled,null);
   const status=await good('getBodyWriteStatus',{clientRequestId:input.clientRequestId});assert.equal(status.exists,true);assert.equal(status.analysisStatus,'ANALYSIS_UNAVAILABLE');
   assert.equal((await admin`select count(*)::int as n from engine_manual_body_records where canonical_user_id=${A.canonical} and not deleted and local_date=${day}`)[0].n,1);
   assert.equal((await good('upsertBodyRecord',input)).replayed,true);
  }finally{runtime.manualBody.analysis=original;}
  const record=(await good('getBodyRecords',{date:day}))[0];await good('deleteBodyRecord',{recordId:record.recordId,revision:record.revision,clientRequestId:crypto.randomUUID()});
  report.analysis_fault={injection:'POST_COMMIT_ANALYSIS_QUERY_REJECTION_ONLY',actual_saved_sql_and_receipts:true,persistence_mocked:false,authorization_mocked:false};
 });
 await gate('local_query_measurement_bounded_provider_queries',async()=>{
  const queries={body:'select body,revision from public.engine_manual_body_records where canonical_user_id=$1 and not deleted and local_date between $2::date-29 and $2::date order by local_date,record_id limit 367',
   timeline:'select * from public.beta_health_scores where canonical_user_id=$1 and score_date between $2::date-29 and $2::date order by score_date',
   nutrition:'select * from public.engine_meals where canonical_user_id=$1 and local_date between $2::date-29 and $2::date limit 5001',
   training:'select body,revision from public.manual_workout_sets where canonical_user_id=$1 and not deleted and local_date between $2::date-29 and $2::date order by local_date,record_id limit 5001',
   scores:'select * from public.engine_output_heads where canonical_user_id=$1 and calculation_date between $2::date-29 and $2::date limit 5001',
   catalog:'select c.*,p.alias,p.archived,p.revision from public.manual_exercise_catalog c left join public.manual_exercise_preferences p on p.exercise_id=c.exercise_id and p.canonical_user_id=$1 where c.owner_user_id is null or c.owner_user_id=$1 order by c.exercise_id limit 1001'};
  for(const [name,query] of Object.entries(queries)){const plan=await admin.unsafe('explain (analyze,buffers,format json) '+query,name==='catalog'?[A.canonical]:[A.canonical,day]);report.performance.push({name,query,plan:plan[0]['QUERY PLAN']});}
  report.performance_limits={classification:'LOCAL_MEASUREMENT_NOT_PRODUCTION_SLA',users:2,body_rows:(await admin`select count(*)::int as n from engine_manual_body_records`)[0].n,workout_rows:(await admin`select count(*)::int as n from manual_workout_sets`)[0].n,indices_added:0,reason:'Small synthetic workload; no evidence of a missing index requiring migration',recompute:runtime.timings};
 });
}finally{await runtime.close();await admin.end();report.ended_at=new Date().toISOString();report.status=report.gates.every((g:any)=>g.status==='PASS')?'PASS':'FAIL';await Deno.writeTextFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,gates:report.gates,report:output}));if(report.status!=='PASS')Deno.exitCode=1;}
