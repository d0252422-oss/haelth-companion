// Hosted shared factory + real isolated PostgreSQL; synthetic verified-session authority.
// NOT Supavisor/CLI Edge/Google OAuth acceptance. No test transport in deployable modules.
import assert from 'node:assert/strict';
import postgres from 'npm:postgres@3.4.8';
import {createHostedManualRuntime,scopedManualSql} from '../supabase/functions/mobile-health-beta/hosted-manual-bootstrap.ts';
import {createSyntheticAuthority} from './local-engine-auth.ts';
import subjects from '../fixtures/engine-local-identities.json' with {type:'json'};
const config=JSON.parse(await Deno.readTextFile(Deno.args[0])),output=Deno.args[1];
if(config.host!=='127.0.0.1'||config.port!==57485||!/^health_engine_[a-f0-9]{32}$/.test(config.database)||Deno.env.get('DENO_DEPLOYMENT_ID'))throw Error('UNSAFE_TEST_TARGET');
const admin=postgres({...config,username:'engine_owner',max:1}),report:any={started_at:new Date().toISOString(),classification:'HOSTED_FACTORY_DIRECT_PG17_SYNTHETIC_SIGNED_AUTH_NOT_POOL_OR_EDGE',gates:[]};
const sha=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(v=>v.toString(16).padStart(2,'0')).join('');
const authority=await createSyntheticAuthority(),a=await authority.issue('A'),b=await authority.issue('B'),expired=await authority.issue('A',true);
let runtime:any;
const day='2026-09-12';
async function api(token:string,action:string,payload:any={},kind='web'){
 const response=await runtime.handle(new Request('http://127.0.0.1/v1/engine/web',{method:'POST',headers:{authorization:'Bearer '+token,'x-health-session-kind':kind,'content-type':'application/json'},body:JSON.stringify({action,payload})}));
 return{http_status:response.status,...await response.json()};
}
async function good(token:string,action:string,payload:any={}){const r=await api(token,action,payload);assert.equal(r.ok,true,JSON.stringify(r));return r.data;}
async function gate(name:string,work:()=>Promise<void>){const started=new Date().toISOString();try{await work();report.gates.push({name,status:'PASS',started_at:started,ended_at:new Date().toISOString()});}catch(e){report.gates.push({name,status:'FAIL',started_at:started,ended_at:new Date().toISOString(),error:String(e),stack:(e as Error).stack});}}
try{
 report.database=(await admin`select version(),current_database(),inet_server_addr()::text`)[0];
 await admin.unsafe('create role health_manual_api login noinherit nosuperuser nobypassrls;grant service_role to health_manual_api with inherit false,set true');
 for(const name of ['A','B'] as const)await admin`insert into private.beta_web_identity_aliases(web_subject_hash,verified_email_hash,canonical_user_id) values(${await sha('web-session-'+subjects[name].auth)},${await sha(name.toLowerCase()+'@example.invalid')},${subjects[name].canonical})`;
 const aliasesBefore=await admin`select * from private.beta_web_identity_aliases order by web_subject_hash`;
 const raw=postgres({...config,username:'health_manual_api',max:2,prepare:false,connect_timeout:5});
 const verify=async(token:string)=>{const user=await authority.verify(token);return {subject:'web-session-'+user.id,email:user.email};};
 runtime=await createHostedManualRuntime(raw,'A',verify);
 await gate('A_schema_independence_and_privileged_role_boundary',async()=>{
  for(const name of ['manual_exercise_catalog','manual_exercise_preferences','manual_workout_sets'])assert.equal((await admin`select to_regclass(${'public.'+name}) as object`)[0].object,null);
  assert.equal((await admin`select to_regclass('private.manual_training_mutation_receipts') as object`)[0].object,null);
  report.roles=await admin`select rolname,rolsuper,rolbypassrls,rolinherit from pg_roles where rolname in ('health_manual_api','service_role','authenticated','anon') order by rolname`;
  report.membership=await admin`select roleid::regrole::text,member::regrole::text,inherit_option,set_option from pg_auth_members where member='health_manual_api'::regrole`;
  const used=await runtime.sql`select session_user::text as login,current_user::text as effective,current_setting('lock_timeout') as lock,current_setting('health.engine.experimental') as experimental`;
  assert.equal(used[0].login,'health_manual_api');assert.equal(used[0].effective,'service_role');assert.equal(used[0].lock,'2s');report.transaction_role=used[0];
  const reset=await raw`select current_user::text as effective,current_setting('health.engine.experimental',true) as experimental`;assert.equal(reset[0].effective,'health_manual_api');assert.notEqual(reset[0].experimental,'on');
  const wrong=postgres({...config,username:'service_role',max:1});try{await assert.rejects(()=>scopedManualSql(wrong).unsafe('select 1'),/MANUAL_DATABASE_ROLE_REJECTED/);}finally{await wrong.end();}
  for(const action of ['getExerciseDatabase','getWorkoutRecords','manageExercise','addWorkoutRecord','updateWorkoutSet','deleteWorkoutSet','getTrainingWriteStatus'])assert.equal((await api(a,action)).error,'EXERCISE_MANAGEMENT_DISABLED');
  assert.equal((await api(a,'refreshDerivedData',{recordType:'workout'})).error,'EXERCISE_MANAGEMENT_DISABLED');
 });
 await gate('hosted_web_only_auth_canonical_and_tenant_isolation',async()=>{
  const id=await good(a,'getManualProviderIdentity');assert.equal(id.canonicalUserId,subjects.A.canonical);assert.notEqual(id.canonicalUserId,subjects.A.auth);assert.equal(id.release,'A');
  for(const token of ['', 'invalid',expired,await authority.issue('MISSING')])assert.equal((await api(token,'getBodyRecords')).ok,false);
  assert.equal((await api(a,'getBodyRecords',{},'native')).ok,false);
  assert.equal((await api(a,'getBodyRecords',{user_id:subjects.B.canonical})).error,'CLIENT_IDENTITY_FORBIDDEN');
  await admin`update private.beta_web_identity_aliases set verified_email_hash=${await sha('mismatch@example.invalid')} where canonical_user_id=${subjects.A.canonical}`;
  try{assert.equal((await api(a,'getBodyRecords')).error,'WEB_IDENTITY_CONFLICT');}finally{await admin`update private.beta_web_identity_aliases set verified_email_hash=${await sha('a@example.invalid')} where canonical_user_id=${subjects.A.canonical}`;}
  const token=await authority.issue('A');await authority.revoke(token);assert.equal((await api(token,'getBodyRecords')).ok,false);
 });
 await gate('NOINHERIT_login_with_inheritable_membership_is_rejected',async()=>{
  await admin.unsafe('grant service_role to health_manual_api with inherit true,set true');
  try{
   const state=(await admin`select rolinherit,pg_has_role('health_manual_api','service_role','USAGE') as effective_inherit from pg_roles where rolname='health_manual_api'`)[0];
   report.membership_negative=state;assert.equal(state.rolinherit,false);assert.equal(state.effective_inherit,true);
   await assert.rejects(()=>scopedManualSql(raw).unsafe('select 1'),/MANUAL_DATABASE_ROLE_REJECTED/);
  }finally{await admin.unsafe('grant service_role to health_manual_api with inherit false,set true');}
 });
 await gate('hosted_A_body_meal_SQL_receipts_revisions_recompute_delete',async()=>{
  const bodyInput={date:day,weight:80,bodyFat:0,clientRequestId:crypto.randomUUID()},body=await good(a,'upsertBodyRecord',bodyInput);
  assert.equal(body.analysisJobScheduled,false);assert.equal((await good(a,'upsertBodyRecord',bodyInput)).replayed,true);
  assert.equal((await good(a,'getBodyWriteStatus',{clientRequestId:bodyInput.clientRequestId})).exists,true);
  const read=await good(a,'getBodyRecords',{date:day});assert.equal(read[0].bodyFat,0);assert.equal((await good(b,'getBodyRecords',{date:day})).length,0);
  assert.equal((await api(a,'upsertBodyRecord',{...bodyInput,weight:81})).error,'REQUEST_ID_CONFLICT');
  const updated=await good(a,'upsertBodyRecord',{recordId:body.recordId,revision:body.record.revision,date:day,weight:81,clientRequestId:crypto.randomUUID()});
  assert.equal((await api(a,'upsertBodyRecord',{recordId:body.recordId,revision:body.record.revision,date:day,weight:99,clientRequestId:crypto.randomUUID()})).error,'STALE_REVISION');
  const mealInput={mealRecordId:'',date:day,time:'12:00',mealType:'lunch',foodName:'SYNTHETIC declared label',weightGrams:200,labelMode:true,userConfirmed:true,referenceSource:'SYNTHETIC user label per100g',calories:100,protein:10,carbs:10,fat:2,clientRequestId:crypto.randomUUID()};
  const meal=await good(a,'upsertMealRecord',mealInput);assert.equal(meal.analysisStatus,'COMPUTED');assert.equal((await good(a,'upsertMealRecord',mealInput)).replayed,true);
  assert.equal((await good(a,'getMealWriteStatus',{clientRequestId:mealInput.clientRequestId})).exists,true);
  let meals=await good(a,'getNutritionRecords',{date:day});assert.equal(meals[0].calories,200);assert.equal((await good(b,'getNutritionRecords',{date:day})).length,0);
  const changed=await good(a,'upsertMealRecord',{...mealInput,mealRecordId:meal.recordId,revision:meal.record.revision,weightGrams:300,clientRequestId:crypto.randomUUID()});meals=await good(a,'getNutritionRecords',{date:day});assert.equal(meals[0].calories,300);
  await good(a,'deleteMealRecord',{mealRecordId:meal.recordId,revision:changed.record.revision,clientRequestId:crypto.randomUUID()});
  await good(a,'deleteBodyRecord',{recordId:body.recordId,revision:updated.record.revision,clientRequestId:crypto.randomUUID()});
  assert.equal((await good(a,'getNutritionRecords',{date:day})).length,0);assert.equal((await good(a,'getBodyRecords',{date:day})).length,0);
  const snapshot=await good(a,'localEngineSnapshot',{date:day});assert.equal(snapshot.meals.length,0);assert.ok(snapshot.outputs.every((r:any)=>r.score===null));
  report.deleted_snapshot_status=snapshot.outputs.map((r:any)=>({domain:r.domain,score:r.score,status:r.score_status}));
 });
 await gate('hosted_role_lock_timeout_retry_and_transaction_failure',async()=>{
  let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(r=>entered=r),done=new Promise<void>(r=>release=r);
  const holding=admin.begin(async (tx:any)=>{await tx`select pg_advisory_xact_lock(hashtextextended(${subjects.A.canonical},0))`;entered();await done;});
  const input={date:'2026-09-11',weight:82,clientRequestId:crypto.randomUUID()};await ready;
  try{const start=performance.now(),r=await api(a,'upsertBodyRecord',input);report.lock_duration_ms=performance.now()-start;assert.equal(r.error,'DB_TIMEOUT_RETRYABLE');assert.equal(r.http_status,503);assert.ok(report.lock_duration_ms<6000);}finally{release();await holding;}
  assert.equal((await good(a,'getBodyWriteStatus',{clientRequestId:input.clientRequestId})).exists,false);await good(a,'upsertBodyRecord',input);
  const pending=crypto.randomUUID();await assert.rejects(()=>runtime.sql.begin(async(tx:any)=>{await tx`insert into private.engine_mutation_receipts(canonical_user_id,request_id,input_hash,response) values(${subjects.A.canonical},${pending},'synthetic',${tx.json({probe:true})})`;throw Error('SYNTHETIC_ROLLBACK');}),/SYNTHETIC_ROLLBACK/);
  assert.equal((await admin`select * from private.engine_mutation_receipts where request_id=${pending}`).length,0);
 });
 await gate('snapshot_real_read_write_barrier_never_mixes_input_and_score_revisions',async()=>{
  const date='2026-09-10',input={date,time:'12:00',mealType:'lunch',foodName:'SYNTHETIC snapshot barrier',weightGrams:100,labelMode:true,userConfirmed:true,referenceSource:'SYNTHETIC label per100g',calories:100,protein:10,carbs:10,fat:2,clientRequestId:crypto.randomUUID()};
  const saved=await good(a,'upsertMealRecord',input),identity=await runtime.identity(new Request('http://127.0.0.1/v1/engine/web',{headers:{authorization:'Bearer '+a,'x-health-session-kind':'web'}}));
  const before=await good(a,'localEngineSnapshot',{date});assert.ok(before.outputs.length);assert.ok(before.outputs.every((r:any)=>r.score_status!=='STALE'));
  let ready!:()=>void,release!:()=>void,armed=true;
  const entered=new Promise<void>(r=>ready=r),released=new Promise<void>(r=>release=r),original=runtime.sql,events:any[]=[];
  const bounded=<T>(p:Promise<T>)=>{let timer:ReturnType<typeof setTimeout>|undefined;return Promise.race([p,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('SNAPSHOT_TEST_BARRIER_TIMEOUT')),5000);})]).finally(()=>clearTimeout(timer));};
  runtime.sql=new Proxy(original,{get(target,key){
   if(key!=='begin')return Reflect.get(target,key);
   return (...args:any[])=>{const work=args.pop();return target.begin(...args,async(tx:any)=>{
    const observed=new Proxy(tx,{apply(call,_this,queryArgs:any[]){
     const result=call(...queryArgs),text=Array.isArray(queryArgs[0])?queryArgs[0].join(' '):'';
     if(armed&&text.includes('select score_date from private.beta_score_recompute_queue')){
      armed=false;return Promise.resolve(result).then(async rows=>{
       const metadata=(await tx`select pg_backend_pid() as pid,current_setting('transaction_isolation') as isolation,pg_current_snapshot()::text as snapshot`)[0];
       events.push({event:'REAL_QUEUE_READ_COMPLETE_BEFORE_CONCURRENT_WRITE',...metadata});ready();await bounded(released);return rows;
      });
     }return result;
    }});return await work(observed);
   });};
  }});
  let pending:Promise<any>|undefined;
  try{
   const reading=Promise.resolve(runtime.snapshot(identity,{date}));pending=reading;void reading.catch(()=>{});await bounded(entered);
   await runtime.mutate(identity,{...input,mealRecordId:saved.recordId,revision:saved.record.revision,weightGrams:300,clientRequestId:crypto.randomUUID()});
   events.push({event:'REAL_MUTATION_COMMITTED_WITH_DIRTY_QUEUE'});release();const snapshot=await pending;
   report.snapshot_barrier={events,returned_revision:snapshot.meals[0]?.revision,expected_old_revision:saved.record.revision};
   assert.equal(snapshot.meals[0].revision,saved.record.revision,'one snapshot must not attach an old valid score to a new meal revision');
   assert.deepEqual(snapshot.outputs,before.outputs);
   runtime.sql=original;
   const fresh=await good(a,'localEngineSnapshot',{date});assert.equal(fresh.meals[0].revision,saved.record.revision+1);assert.ok(fresh.outputs.length&&fresh.outputs.every((r:any)=>r.score_status==='STALE'));
  }finally{release();await Promise.allSettled(pending?[pending]:[]);runtime.sql=original;}
 });
 assert.deepEqual(await admin`select * from private.beta_web_identity_aliases order by web_subject_hash`,aliasesBefore);
}catch(e){report.gates.push({name:'bootstrap',status:'FAIL',error:String(e),stack:(e as Error).stack});}
finally{await runtime?.close();await admin.end();report.ended_at=new Date().toISOString();report.status=report.gates.some((g:any)=>g.status==='FAIL')?'FAIL':'PASS';await Deno.writeTextFile(output,JSON.stringify(report,null,2));}
console.log(JSON.stringify({status:report.status,gates:report.gates,output}));if(report.status!=='PASS')Deno.exit(1);
