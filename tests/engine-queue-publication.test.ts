// Actual dedicated PG transactions + real worker cores. Not CLI Edge or cron/OAuth.
import assert from 'node:assert/strict';
import postgres from 'npm:postgres@3.4.8';
import {LocalEngineRuntime,pgAdmin} from '../supabase/functions/mobile-health-beta/local-engine-runtime.ts';
import {recomputeBetaScore} from '../supabase/functions/mobile-health-beta/score-bridge.ts';
import {createSyntheticAuthority} from '../scripts/local-engine-auth.ts';
const config=JSON.parse(await Deno.readTextFile(Deno.env.get('LOCAL_ENGINE_TEST_CONFIG')!));
if(config.host!=='127.0.0.1'||config.port!==57484||!/^health_engine_[a-f0-9]{32}$/.test(config.database))throw Error('UNSAFE_TEST_DATABASE');
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const prior=new Date(Date.parse(day)-86400000).toISOString().slice(0,10);
async function setup(){
 const authority=await createSyntheticAuthority(),runtime=new LocalEngineRuntime(config,authority.verify),owner=postgres({...config,username:'engine_owner',max:2}),legacy=postgres({...config,max:1});
 await runtime.start();
 // New synthetic scope for each test, existing identity model, no existing-user mutation.
 const auth=crypto.randomUUID(),canonical=crypto.randomUUID();
 await owner`insert into auth.users values(${auth},${auth+'@example.invalid'},now())`;
 await owner`insert into auth.identities values(${crypto.randomUUID()},${auth},'google')`;
 await owner`insert into public.users(id,external_subject_hash,timezone) values(${canonical},${canonical.replaceAll('-','').repeat(2)},'Asia/Taipei')`;
 await owner`insert into private.beta_native_auth_identities(auth_user_id,canonical_user_id,provider) values(${auth},${canonical},'google')`;
 const identity={kind:'native',auth,canonical},events:any[]=[];
 const event=(name:string,data:any={})=>events.push({sequence:events.length+1,name,at:new Date().toISOString(),...data});
 const state=async()=>({queue:await owner`select score_date::text,status,generation::text,engine_required,engine_published_generation::text,lease_token from private.beta_score_recompute_queue where canonical_user_id=${canonical} order by score_date`,
   heads:await owner`select * from public.engine_output_heads where canonical_user_id=${canonical} order by calculation_date,output_kind`,
   history:await owner`select * from public.engine_output_history where canonical_user_id=${canonical} order by calculation_date,output_kind,input_fingerprint`,
   scores:await owner`select * from public.beta_health_scores where canonical_user_id=${canonical} order by score_date,score_type`});
 const claim=async()=>{const token=crypto.randomUUID();const jobs=await legacy`select * from public.beta_claim_score_recompute(${token},${canonical},5)`;event('CLAIM_TRANSACTION_COMMITTED',{jobs:jobs.length});return{token,jobs};};
 const admin=pgAdmin(legacy,authority.verify);
 const close=async()=>{console.log(JSON.stringify({transaction_events:events}));await runtime.close();await owner.end();await legacy.end();};
 return {runtime,owner,legacy,identity,event,state,claim,admin,close};
}
function meal(extra:any={}){return{clientRequestId:crypto.randomUUID(),date:day,time:'12:00',mealType:'lunch',foodName:'SYNTHETIC reported totals',userConfirmed:true,calories:600,protein:20,carbs:60,fat:10,...extra};}
for(const kind of ['body','meal'])Deno.test(`actual PG ${kind}: legacy-first initial/revision rejected atomically; unified same-lease recovery and portable-first`,async()=>{
 const c=await setup();try{
  let saved:any;
  for(const revision of [1,2]){
   saved=kind==='body'?await c.runtime.manualBody.write(c.identity,{clientRequestId:crypto.randomUUID(),date:day,weight:70+revision,bodyFat:20,...(saved?{recordId:saved.recordId,revision:revision-1}:{})}):await c.runtime.mutate(c.identity,meal({calories:600+revision*100,...(saved?{mealRecordId:saved.recordId,revision:revision-1}:{})}));
   c.event('MANUAL_WRITE_COMMITTED',{kind,revision});const {token,jobs}=await c.claim();assert.equal(jobs.length,1);
   assert.equal(await c.runtime.drain(c.identity.canonical),0,'committed claim is explicit ordering barrier');
   const before=await c.state();await assert.rejects(()=>recomputeBetaScore(c.admin,c.identity.canonical,day),/ENGINE_PUBLICATION_REQUIRED/);
   assert.deepEqual(await c.state(),before,'failed legacy finalize rolls back all eight scores, queue and heads');c.event('LEGACY_FINALIZE_REJECTED_WITHOUT_PARTIAL_STATE',{revision});
   const result=await c.runtime.processClaimedJob(jobs[0],token);assert.equal(result.status,revision===1?'PERSISTED':'REPLAYED');
   const after=await c.state();assert.equal(after.queue[0].status,'COMPLETE');assert.equal(after.queue[0].generation,after.queue[0].engine_published_generation);assert.equal(after.heads.length,7);assert.equal(after.scores.length,8);
   const snapshot=await c.runtime.snapshot(c.identity,{date:day}),expected=await c.runtime.compute(c.identity.canonical,day);
   const out=snapshot.outputs.find((r:any)=>r.domain===(kind==='meal'?'nutrition':'body'));assert.equal(out.input_fingerprint,expected.outputs[kind==='meal'?'nutrition':'body'].input_fingerprint);assert.notEqual(out.score_status,'STALE');
   if(kind==='body')assert.equal((await c.runtime.manualBody.read(c.identity,{date:day}))[0].fatMass,(70+revision)*20/100);
   c.event('UNIFIED_PUBLICATION_COMMITTED',{revision,status:result.status});
  }
  // Opposite order: no legacy work remains after the actual portable drain.
  if(kind==='body')await c.runtime.manualBody.write(c.identity,{clientRequestId:crypto.randomUUID(),recordId:saved.recordId,revision:2,date:day,weight:73});
  else await c.runtime.mutate(c.identity,meal({mealRecordId:saved.recordId,revision:2,calories:900}));
  assert.equal(await c.runtime.drain(c.identity.canonical),1);assert.equal((await c.claim()).jobs.length,0);c.event('PORTABLE_FIRST_NO_LEGACY_CLAIM');
 }finally{await c.close();}
});
Deno.test('actual PG claimed generation/lease cannot publish after revision or expiry',async()=>{
 const c=await setup();try{
  const saved=await c.runtime.manualBody.write(c.identity,{clientRequestId:crypto.randomUUID(),date:day,weight:70});const old=await c.claim();
  await c.runtime.manualBody.write(c.identity,{clientRequestId:crypto.randomUUID(),recordId:saved.recordId,revision:1,date:day,weight:71});
  await assert.rejects(()=>c.runtime.processClaimedJob(old.jobs[0],old.token),/STALE_SCORE_INPUT/);assert.equal((await c.state()).heads.length,0);
  const current=await c.claim();
  await assert.rejects(()=>c.runtime.processClaimedJob(current.jobs[0],crypto.randomUUID()),/STALE_SCORE_INPUT/);
  await assert.rejects(()=>c.runtime.processClaimedJob({...current.jobs[0],canonical_user_id:crypto.randomUUID()},current.token),/STALE_SCORE_INPUT/);
  await c.owner`update private.beta_score_recompute_queue set lease_expires_at=now()-interval '1 second' where canonical_user_id=${c.identity.canonical}`;
  await assert.rejects(()=>c.runtime.processClaimedJob(current.jobs[0],current.token),/STALE_SCORE_INPUT/);assert.equal((await c.state()).heads.length,0);
  assert.equal(await c.runtime.drain(c.identity.canonical),1);c.event('EXPIRED_LEASE_RECLAIM_RECOVERS_NEWEST_REVISION');
 }finally{await c.close();}
});
Deno.test('actual PG publication marker, portable heads, frozen rows and acknowledgement roll back together',async()=>{
 const c=await setup();try{
  await c.runtime.mutate(c.identity,meal());const claimed=await c.claim();
  // Fail a real SQL statement after the callback has written heads + generation marker.
  const original=c.runtime.sql.begin.bind(c.runtime.sql);
  c.runtime.sql.begin=(options:any,callback?:any)=>{const work=callback??options;const invoke=async(tx:any)=>{const wrapped=new Proxy(tx,{get(target,key){if(key==='unsafe')return async(text:string,args:any[])=>{if(text.includes('public.beta_persist_score_bundle'))throw Error('SYNTHETIC_AFTER_MARKER_FAILURE');return target.unsafe(text,args);};return Reflect.get(target,key);}});return work(wrapped);};return callback?original(options,invoke):original(invoke);};
  const before=await c.state();try{await assert.rejects(()=>c.runtime.processClaimedJob(claimed.jobs[0],claimed.token),/SYNTHETIC_AFTER_MARKER_FAILURE/);}finally{c.runtime.sql.begin=original;}
  assert.deepEqual(await c.state(),before);assert.equal((await c.state()).queue[0].engine_published_generation,'0');
  await c.runtime.processClaimedJob(claimed.jobs[0],claimed.token);assert.equal((await c.state()).queue[0].status,'COMPLETE');c.event('AFTER_MARKER_FAILURE_ROLLED_BACK_THEN_SAME_LEASE_RETRIED');
 }finally{await c.close();}
});
for(const kind of ['body','meal'])Deno.test(`actual PG ${kind}: moved date and tombstone require both dates; old marker-zero COMPLETE is never current`,async()=>{
 const c=await setup();try{
  const saved=kind==='body'?await c.runtime.manualBody.write(c.identity,{clientRequestId:crypto.randomUUID(),date:prior,weight:70}):await c.runtime.mutate(c.identity,meal({date:prior}));await c.runtime.drain(c.identity.canonical);
  // Simulate retained pre-migration COMPLETE rows using the new column's default0;
  // no status change, trigger disabling or destructive fixture operation.
  await c.owner`update private.beta_score_recompute_queue set engine_published_generation=0,engine_required=false where canonical_user_id=${c.identity.canonical}`;
  const old=await c.runtime.snapshot(c.identity,{date:prior});assert.ok(old.outputs.every((r:any)=>r.score_status==='STALE'));
  if(kind==='body'){const r=(await c.runtime.manualBody.read(c.identity,{date:prior}))[0];assert.equal(r.analysisStatus,'ANALYSIS_UNAVAILABLE');assert.equal(r.analysisJobScheduled,false);assert.equal(r.bodyMetrics,undefined);}
  const moved=kind==='body'?await c.runtime.manualBody.write(c.identity,{clientRequestId:crypto.randomUUID(),recordId:saved.recordId,revision:1,date:day,weight:71}):await c.runtime.mutate(c.identity,meal({mealRecordId:saved.recordId,revision:1,date:day}));
  assert.equal((await c.state()).queue.length,2);assert.ok((await c.state()).queue.every((q:any)=>q.engine_required));await c.runtime.drain(c.identity.canonical);
  if(kind==='body')await c.runtime.manualBody.write(c.identity,{clientRequestId:crypto.randomUUID(),recordId:saved.recordId,revision:2},true);
  else await c.runtime.mutate(c.identity,{clientRequestId:crypto.randomUUID(),mealRecordId:saved.recordId,revision:moved.record.revision},true);
  const claimed=await c.claim();await assert.rejects(()=>recomputeBetaScore(c.admin,c.identity.canonical,day),/ENGINE_PUBLICATION_REQUIRED/);
  for(const job of claimed.jobs)await c.runtime.processClaimedJob(job,claimed.token);
  const snap=await c.runtime.snapshot(c.identity,{date:day});assert.ok(snap.outputs.every((r:any)=>r.score===null));assert.equal(snap.meals.length,0);
  c.event('OLD_AND_NEW_DATES_RECONCILED_TOMBSTONE_NOT_REVIVED',{kind});
 }finally{await c.close();}
});
