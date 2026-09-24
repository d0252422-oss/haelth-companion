import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base='http://127.0.0.1:57841';
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function login(account){const r=await fetch(base+'/local-login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
async function call(cookie,action,payload={}){const r=await fetch(base+'/v1/engine/web',{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify({action,payload})});return {status:r.status,...await r.json()};}

test('existing Deno route -> verified identity -> portable TypeScript -> PostgreSQL CRUD/replay/isolation',async()=>{
 const a=await login('B'),b=await login('A');
 const previous=await call(a,'localEngineSnapshot');
 for(const meal of previous.data.meals.filter(m=>m.foodName==='SYNTHETIC label arithmetic fixture')){
   const cleared=await call(a,'deleteMealRecord',{mealRecordId:meal.mealRecordId,revision:meal.revision,clientRequestId:randomUUID()});assert.equal(cleared.ok,true,JSON.stringify(cleared));
 }
 assert.equal((await call(null,'getCurrentUser')).ok,false);
 assert.equal((await call('engine_session=invalid.jwt.signature','getCurrentUser')).ok,false);
 assert.equal((await call(await login('MISSING'),'getCurrentUser')).ok,false);
 const identity=await call(a,'getCurrentUser');assert.equal(identity.data.user.userId,'20000000-0000-4000-8000-000000000002');
 const payload={clientRequestId:randomUUID(),date:day,time:'12:00',mealType:'午餐',foodName:'SYNTHETIC label arithmetic fixture',userConfirmed:true,labelMode:true,weightGrams:150,referenceSource:'SYNTHETIC arithmetic v1; no real food claim',calories:200,protein:10,carbs:20,fat:5};
 const created=await call(a,'upsertMealRecord',payload);assert.equal(created.ok,true,JSON.stringify(created));assert.equal(created.data.record.calories,300);assert.equal(created.data.analysisStatus,'ANALYSIS_PENDING');
 const id=created.data.recordId;
 const replay=await call(a,'upsertMealRecord',payload);assert.equal(replay.data.replayed,true);
 assert.equal((await call(a,'getMealWriteStatus',{clientRequestId:payload.clientRequestId})).data.exists,true);
 assert.equal((await call(b,'getMealWriteStatus',{clientRequestId:payload.clientRequestId})).data.exists,false);
 const dashboard=await call(a,'getDashboardData'),today=dashboard.data.today;
 assert.ok(today,JSON.stringify(dashboard));
 const analysisPending=today.healthStaleReason==='RECOMPUTE_PENDING',analysisReady=today.algorithmVersion==='health-score-v1.0';
 assert.ok(analysisPending||analysisReady,JSON.stringify(today));
 if(analysisPending)assert.equal(today.nutritionScore??null,null);
 const first=await call(a,'localEngineSnapshot');assert.equal(first.data.meals.filter(m=>m.mealRecordId===id).length,1);
 assert.ok(first.data.outputs.find(o=>o.domain==='nutrition'&&o.score!==null));
 assert.equal((await call(b,'localEngineSnapshot')).data.meals.some(m=>m.mealRecordId===id),false);
 assert.equal((await call(b,'deleteMealRecord',{mealRecordId:id,revision:1,clientRequestId:randomUUID()})).ok,false);
 assert.equal((await call(a,'upsertMealRecord',{...payload,user_id:'20000000-0000-4000-8000-000000000002',clientRequestId:randomUUID()})).ok,false);
 const updated=await call(a,'upsertMealRecord',{...payload,mealRecordId:id,revision:1,weightGrams:200,clientRequestId:randomUUID()});assert.equal(updated.ok,true,JSON.stringify(updated));assert.equal(updated.data.record.calories,400);
 assert.equal((await call(a,'upsertMealRecord',{...payload,mealRecordId:id,revision:1,clientRequestId:randomUUID()})).error,'STALE_REVISION');
 const removed=await call(a,'deleteMealRecord',{mealRecordId:id,revision:2,clientRequestId:randomUUID()});assert.equal(removed.ok,true,JSON.stringify(removed));
 const last=await call(a,'localEngineSnapshot');assert.equal(last.data.meals.some(m=>m.mealRecordId===id),false);
 assert.ok(last.data.outputs.find(o=>o.domain==='nutrition'&&o.score===null&&o.score_status==='INSUFFICIENT_DATA'));
 await fetch(base+'/local-logout',{method:'POST',headers:{cookie:a}});assert.equal((await call(a,'getCurrentUser')).ok,false);
});
