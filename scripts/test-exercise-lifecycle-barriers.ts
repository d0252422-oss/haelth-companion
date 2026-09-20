// Two independent real PG connections; test barriers hold actual transactions before COMMIT.
// No mock repository, no sleeps to choose the winner. pg_blocking_pids proves the blocked order.
import assert from 'node:assert/strict';
import postgres from 'npm:postgres@3.4.8';
import {LocalEngineRuntime} from '../supabase/functions/mobile-health-beta/local-engine-runtime.ts';
import {ManualTrainingLocalStore} from '../supabase/functions/mobile-health-beta/manual-training-local.ts';
import {createSyntheticAuthority} from './local-engine-auth.ts';
import subjects from '../fixtures/engine-local-identities.json' with {type:'json'};
const config=JSON.parse(await Deno.readTextFile(Deno.args[0])),output=Deno.args[1];
if(Deno.env.get('HEALTH_ENGINE_LOCAL_ONLY')!=='1'||config.host!=='127.0.0.1'||!/^health_engine_[a-f0-9]{32}$/.test(config.database)||![57483,57484,57485].includes(config.port))throw Error('UNSAFE_TEST_TARGET');
Deno.env.set('HEALTH_EXERCISE_MANAGEMENT_LOCAL','1');
const admin=postgres({...config,username:'engine_owner',max:1});
const authority=await createSyntheticAuthority(),token=await authority.issue('A'),tokenB=await authority.issue('B');
const A=subjects.A.canonical,B=subjects.B.canonical,day='2026-09-12';
const report:any={started_at:new Date().toISOString(),database:(await admin`select version(),current_database(),inet_server_addr()::text`)[0],barrier_method:'Promises + independent pg_backend_pid + pg_blocking_pids before first COMMIT, not sleep ordering',gates:[]};
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return{promise,resolve};}
async function bounded<T>(p:Promise<T>,label:string,ms=5000){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([p,new Promise<never>((_,reject)=>timer=setTimeout(()=>reject(Error(label)),ms))]);}finally{clearTimeout(timer);}}
async function actor(isolation:string,events:any[],label:string,hold=false){
 const connection=postgres({...config,max:1,connection:{lock_timeout:4000,statement_timeout:8000,transaction_timeout:12000}});
 const ready=deferred(),release=deferred();let pid=0,arm=hold;const runtime=new LocalEngineRuntime(config,authority.verify);
 const wrapped={begin:async(callback:any)=>{try{return await connection.begin(async (tx:any)=>{
   await tx.unsafe('set transaction isolation level '+isolation);
   pid=Number((await tx`select pg_backend_pid() as pid`)[0].pid);events.push({event:'TX_BEGIN',actor:label,pid,isolation,at:performance.now()});
   const result=await callback(tx);if(arm){arm=false;events.push({event:'MUTATION_READY_BEFORE_COMMIT',actor:label,pid,at:performance.now()});ready.resolve();await bounded(release.promise,'TEST_BARRIER_NOT_RELEASED');}
   return result;
 });}catch(error){events.push({event:'TX_ERROR',actor:label,pid,sqlstate:(error as any).code??null,message:(error as Error).message,at:performance.now()});throw error;}}};
 runtime.manualTraining=new ManualTrainingLocalStore(wrapped);
 return {runtime,ready,release,get pid(){return pid;},async close(){release.resolve();await runtime.close();await connection.end();}};
}
async function api(actor:any,action:string,payload:any={},useB=false){
 const response=await actor.runtime.handle(new Request('http://127.0.0.1/v1/engine/web',{method:'POST',headers:{authorization:'Bearer '+(useB?tokenB:token),'content-type':'application/json'},body:JSON.stringify({action,payload})}));
 return{http_status:response.status,...await response.json()};
}
const create=(exerciseId:string)=>({date:day,startTime:day+'T01:00:00Z',endTime:day+'T01:20:00Z',clientRequestId:crypto.randomUUID(),exercises:[{exerciseId,sets:[{weight:0,reps:10}]}]});
for(const isolation of ['read committed','repeatable read','serializable'])for(const order of ['archive_reference','reference_archive','reference_delete','delete_reference','rename_reference','reference_rename']){
 const events:any[]=[],shared=order.includes('archive'),id=(shared?'global:barrier-':'barrier-')+crypto.randomUUID(),name=order+'_'+isolation.replaceAll(' ','_'),started=new Date().toISOString();
 let one:any,two:any,first:Promise<any>|undefined,second:Promise<any>|undefined;
 try{
   await admin`insert into public.manual_exercise_catalog values(${id},${shared?null:A},${'SYNTHETIC barrier '+id},${shared?'LEGS':'腿'})`;await admin`insert into public.manual_exercise_preferences(canonical_user_id,exercise_id) values(${A},${id}),(${shared?B:A},${id}) on conflict do nothing`;
   one=await actor(isolation,events,'first',true);two=await actor(isolation,events,'second');
   const renaming=order.includes('rename');
   const renamed='SYNTHETIC new '+id,reference=create(id),management={exerciseId:id,operation:renaming?'rename':shared?'archive':'delete',...(renaming?{name:renamed}:{}),revision:0,clientRequestId:crypto.randomUUID()},refFirst=order.startsWith('reference');
   const firstAction=refFirst?'addWorkoutRecord':'manageExercise',secondAction=refFirst?'manageExercise':'addWorkoutRecord';
   const firstPayload=refFirst?reference:management,secondPayload=refFirst?management:reference;
   first=api(one,firstAction,firstPayload).then(r=>{events.push({event:'FIRST_COMMITTED_RESPONSE',ok:r.ok,at:performance.now()});return r;});
   await bounded(one.ready.promise,'FIRST_MUTATION_NOT_READY');second=api(two,secondAction,secondPayload);
   const until=performance.now()+2500;let blocked=false;
   while(performance.now()<until){if(two.pid){const rows=await admin`select ${one.pid}::int=any(pg_blocking_pids(${two.pid}::int)) as blocked`;if(rows[0].blocked){blocked=true;events.push({event:'DB_PROVED_SECOND_BLOCKED_BY_FIRST',first_pid:one.pid,second_pid:two.pid,at:performance.now()});break;}}await new Promise(r=>setTimeout(r,5));}
   assert.equal(blocked,true);assert.notEqual(one.pid,two.pid);one.release.resolve();
   const firstResult=await first;assert.equal(firstResult.ok,true,JSON.stringify(firstResult));let secondResult=await second;
   if(events.some(e=>e.actor==='second'&&['40001','40P01'].includes(e.sqlstate))){
     assert.equal(secondResult.http_status,503,'serialization/deadlock must be retryable at actual API boundary');assert.equal(secondResult.retryable,true);
     events.push({event:'RETRY_NEW_TRANSACTION_SAME_REQUEST',at:performance.now()});secondResult=await api(two,secondAction,secondPayload);
   }
   if(order==='reference_archive'||renaming)assert.equal(secondResult.ok,true,JSON.stringify(secondResult));
   else{assert.equal(secondResult.ok,false);assert.equal(secondResult.error,order==='reference_delete'?'EXERCISE_REFERENCED':order==='delete_reference'?'EXERCISE_NOT_FOUND':'EXERCISE_ARCHIVED');}
   const rows=await admin`select body,deleted from public.manual_workout_sets where canonical_user_id=${A} and exercise_id=${id}`;
   assert.equal(rows.length,refFirst||renaming?1:0);assert.equal((await admin`select s.record_id from public.manual_workout_sets s left join public.manual_exercise_preferences p using(canonical_user_id,exercise_id) where p.exercise_id is null`).length,0);
   if(renaming){assert.equal(rows[0].body.exerciseId,id);assert.equal(rows[0].body.exerciseName,refFirst?'SYNTHETIC barrier '+id:renamed);assert.equal(rows[0].body.totalVolume,0);}
   const receipt=await api(two,'getTrainingWriteStatus',{clientRequestId:secondPayload.clientRequestId});assert.equal(receipt.data.exists,order==='reference_archive'||renaming);
   const replay=await api(two,firstAction,firstPayload);assert.equal(replay.ok,true);assert.equal(replay.data.replayed,true);
   if(shared){
     const anew=await api(two,'addWorkoutRecord',create(id));assert.equal(anew.error,'EXERCISE_ARCHIVED');
     const bcat=await two.runtime.manualTraining.catalog({kind:'native',auth:subjects.B.auth,canonical:B});assert.equal(bcat.find((c:any)=>c.exerciseId===id).archived,false);
     if(refFirst){const body=rows[0].body;const edit=await api(two,'updateWorkoutSet',{recordId:body.recordId,date:day,weight:5,reps:12,revision:1,clientRequestId:crypto.randomUUID()});assert.equal(edit.ok,true);assert.equal(edit.data.record.exerciseId,id);assert.equal(edit.data.record.exerciseName,body.exerciseName);}
   }
   report.gates.push({name,status:'PASS',started_at:started,ended_at:new Date().toISOString(),events,first_api:{ok:firstResult.ok,status:firstResult.http_status},second_api:{ok:secondResult.ok,status:secondResult.http_status,error:secondResult.error},history_rows:rows.length});
 }catch(error){report.gates.push({name,status:'FAIL',started_at:started,ended_at:new Date().toISOString(),error:(error as Error).stack,events});}
 finally{one?.release.resolve();await Promise.allSettled([first,second].filter(Boolean) as Promise<any>[]);await one?.close();await two?.close();}
}
await admin.end();report.ended_at=new Date().toISOString();report.status=report.gates.every((g:any)=>g.status==='PASS')?'PASS':'FAIL';
await Deno.writeTextFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,gates:report.gates.map((g:any)=>({name:g.name,status:g.status,error:g.error?.split('\n')[0]})),report:output}));if(report.status!=='PASS')Deno.exitCode=1;
