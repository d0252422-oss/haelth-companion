// Unit/transport contracts, NOT PostgreSQL/actual Edge/OAuth acceptance.
import assert from 'node:assert/strict';
import application,{registerLocalEngineHandler,dispatchLocalEngine,authenticateNativeUser,resolveNativeIdentity} from '../supabase/functions/mobile-health-beta/index.ts';
import {validateLocalManualConfig,localManualEnvironmentFingerprint} from '../supabase/functions/mobile-health-beta/local-manual-bootstrap.ts';
import {boundedSdkFetch,AUTH_HTTP_TIMEOUT_MS} from '../supabase/functions/mobile-health-beta/bounded-auth-fetch.ts';
import {exerciseName} from '../supabase/functions/mobile-health-beta/manual-training-local.ts';
import {healthTimelineNeedsScoreDrain,LocalEngineRuntime,manualMealPresentation,mergeHealthQueueState,normalizeManualMealType,preservedManualMealExclusion,resolveManualMealLabelValues,resolveManualMealNutrients} from '../supabase/functions/mobile-health-beta/local-engine-runtime.ts';
import {groupScoreRowsByDate,normalizePointMeasurementInterval,normalizeScoreHealthRows,selectScoreSourceGroups,selectScoreSourceRows,selectScoreSourceRowsForDate} from '../supabase/functions/mobile-health-beta/score-bridge.ts';
const config={host:'127.0.0.1',port:57483,database:'health_engine_'+'a'.repeat(32),username:'service_role'};
const environment:Record<string,string>={HEALTH_ENGINE_LOCAL_ONLY:'1',HEALTH_MANUAL_EDGE_REHEARSAL:'1',SUPABASE_URL:'http://127.0.0.1:54321'};
Deno.test('Postgres date[] driver values normalize before score selection and conflict masking',()=>{
  const rows=normalizeScoreHealthRows([{domain:'steps',affected_local_dates:[new Date('2026-09-19T00:00:00.000Z')]}]);
  assert.deepEqual(rows[0].affected_local_dates,['2026-09-19']);
  assert.equal(rows[0].affected_local_dates.includes('2026-09-19'),true);
  const blocked=new Map([['2026-09-19',new Set(['steps'])]]);
  assert.deepEqual(rows[0].affected_local_dates.filter(date=>!blocked.get(date)?.has(rows[0].domain)),[]);
  assert.throws(()=>normalizeScoreHealthRows([{domain:'steps',affected_local_dates:['not-a-date']}]),/INVALID_AFFECTED_LOCAL_DATE/);
  assert.throws(()=>normalizeScoreHealthRows([{domain:'steps',affected_local_dates:['2026-09-19T00:00:00Z']}]),/INVALID_AFFECTED_LOCAL_DATE/);
});

Deno.test('legacy zero-length point measurements use recorded_at without weakening interval domains',()=>{
  const stamp='2026-09-19T15:30:00.000Z';
  const [weight]=normalizeScoreHealthRows([{domain:'weight',affected_local_dates:['2026-09-19'],canonical_record:{recorded_at:stamp,started_at:stamp,ended_at:stamp,value:87.8,unit:'kg'}}]);
  assert.equal((weight.canonical_record as any).started_at,null);
  assert.equal((weight.canonical_record as any).ended_at,null);
  const sleep={recorded_at:stamp,started_at:stamp,ended_at:stamp};
  assert.equal(normalizePointMeasurementInterval('sleep',sleep),sleep);
  const reversed={recorded_at:stamp,started_at:stamp,ended_at:'2026-09-19T15:29:59.000Z'};
  assert.equal(normalizePointMeasurementInterval('weight',reversed),reversed);
});

Deno.test('current day source selection is not displaced by a denser historical source',()=>{
  const date='2026-09-19',prior='2026-09-18',base={domain:'steps',canonical_record:{value:1000},updated_at:'2026-09-19T01:00:00Z'};
  const rows=normalizeScoreHealthRows([
    ...Array.from({length:10},(_,index)=>({...base,id:`old-${index}`,source_app:'xiaomi',affected_local_dates:[prior]})),
    {...base,id:'today',source_app:'google-fit',affected_local_dates:[date],updated_at:'2026-09-19T02:00:00Z'},
  ]);
  const selected=selectScoreSourceRowsForDate(rows,date);
  assert.deepEqual(selected.filter(row=>row.affected_local_dates.includes(date)).map(row=>row.id),['today']);
  assert.equal(selected.filter(row=>row.affected_local_dates.includes(prior)).length,10);
});

Deno.test('portable publication reuses deterministic one-source-per-domain selection',()=>{
  const base={affected_local_dates:['2026-09-19'],domain:'steps',canonical_record:{value:1000},updated_at:'2026-09-19T01:00:00Z'};
  const rows=normalizeScoreHealthRows([
    {...base,id:'a1',source_app:'xiaomi'},
    {...base,id:'a2',source_app:'xiaomi'},
    {...base,id:'b1',source_app:'google-fit',updated_at:'2026-09-19T02:00:00Z'},
    {...base,id:'weight',domain:'weight',source_app:'google-fit'},
  ]);
  const selected=selectScoreSourceRows(rows);
  assert.deepEqual(selected.filter(row=>row.domain==='steps').map(row=>row.id),['a1','a2']);
  assert.deepEqual(selected.filter(row=>row.domain==='weight').map(row=>row.id),['weight']);
});
Deno.test('source selection remains bounded for a full 20k-row wearable window',()=>{
  const rows=Array.from({length:20_000},(_,index)=>({
    id:`row-${index}`,domain:'steps',source_app:index<12_000?'xiaomi':'google-fit',
    affected_local_dates:['2026-09-25'],updated_at:'2026-09-25T09:00:00Z',
  }));
  const started=performance.now(),selected=selectScoreSourceRows(rows),elapsed=performance.now()-started;
  assert.equal(selected.length,12_000);
  assert.equal(selected[0].id,'row-0');
  assert.equal(selected.at(-1)?.id,'row-11999');
  assert.ok(elapsed<500,`20k source selection exceeded the bounded CPU budget: ${elapsed}ms`);
  assert.match(selectScoreSourceGroups.toString(),/existing\.push\(row\)/u);
  assert.doesNotMatch(selectScoreSourceGroups.toString(),/\.\.\.\(grouped\.get/u);
});
Deno.test('daily score grouping stays linear for a dense 20k-row date',()=>{
  const rows=Array.from({length:20_000},(_,index)=>({id:`row-${index}`,affected_local_dates:index%2?['2026-09-24','2026-09-25']:['2026-09-25']}));
  const started=performance.now(),days=groupScoreRowsByDate(rows),elapsed=performance.now()-started;
  assert.equal(days.get('2026-09-25')?.length,20_000);
  assert.equal(days.get('2026-09-24')?.length,10_000);
  assert.equal(days.get('2026-09-25')?.[0],rows[0]);
  assert.equal(days.get('2026-09-25')?.at(-1),rows.at(-1));
  assert.ok(elapsed<500,`20k daily grouping exceeded the bounded CPU budget: ${elapsed}ms`);
  assert.match(groupScoreRowsByDate.toString(),/existing\.push\(row\)/u);
});
Deno.test('timeline preserves queue failure and pending evidence before any score row exists',()=>{
  const failed:any={};mergeHealthQueueState(failed,[{score_date:'2026-09-19',status:'FAILED',generation:'2',engine_published_generation:'0'}]);
  assert.deepEqual(failed['2026-09-19'],{date:'2026-09-19',healthStatus:'STALE',healthStaleReason:'RECOMPUTE_FAILED'});
  const pending:any={};mergeHealthQueueState(pending,[{score_date:'2026-09-20',status:'DIRTY',generation:'3',engine_published_generation:'2'}]);
  assert.equal(pending['2026-09-20'].healthStaleReason,'RECOMPUTE_PENDING');
  const missing:any={};mergeHealthQueueState(missing,[{score_date:'2026-09-21',status:'COMPLETE',generation:'4',engine_published_generation:'4'}]);
  assert.equal(missing['2026-09-21'].healthStaleReason,'PUBLISHED_OUTPUT_NOT_CURRENT');
  assert.equal(healthTimelineNeedsScoreDrain(Object.values(pending)),true);
  assert.equal(healthTimelineNeedsScoreDrain(Object.values(failed)),false);
  assert.equal(healthTimelineNeedsScoreDrain(Object.values(missing)),false);
});
Deno.test('hosted score drain is bounded and de-duplicates one in-flight task per user',async()=>{
  const runtime=Object.create(LocalEngineRuntime.prototype) as any;
  runtime.scoreDrainTasks=new Map();
  runtime.scoreDrainRerun=new Set();
  const bounds:Array<[number,number]>=[],tasks:Promise<void>[]=[];
  let releaseFirst:()=>void=()=>{};
  runtime.drain=(_user:string,maxPages:number,pageSize:number)=>{bounds.push([maxPages,pageSize]);return bounds.length===1?new Promise<number>(resolve=>{releaseFirst=()=>resolve(0);}):Promise.resolve(0);};
  const previous=(globalThis as any).EdgeRuntime;
  (globalThis as any).EdgeRuntime={waitUntil(task:Promise<void>){tasks.push(task);}};
  try{
    assert.equal(runtime.scheduleDrain('11111111-1111-4111-8111-111111111111'),true);
    assert.equal(runtime.scheduleDrain('11111111-1111-4111-8111-111111111111'),false);
    assert.deepEqual(bounds,[[1,1]]);
    // A concurrent invalidation is coalesced and automatically receives a
    // fresh one-job attempt after the active drain settles.
    assert.equal(runtime.scheduleDrain('11111111-1111-4111-8111-111111111111'),false);
    releaseFirst();await tasks[0];
    assert.equal(tasks.length,2);
    await tasks[1];assert.deepEqual(bounds,[[1,1],[1,1]]);
  }finally{
    if(previous===undefined)delete (globalThis as any).EdgeRuntime;else (globalThis as any).EdgeRuntime=previous;
  }
});
Deno.test('meal completeness is based on explicit four main nutrients, not confirmation alone',()=>{
  for(const nutrients of [{calories:null,protein:null,carbs:null,fat:null},{calories:0,protein:12.5,carbs:null,fat:null}]){
    const input={...nutrients,userConfirmed:true,includedInTotals:true},out=manualMealPresentation(input);
    assert.equal(out.includedInTotals,false);assert.equal(out.nutritionCompleteness,'INCOMPLETE');
    for(const key of ['calories','protein','carbs','fat'])assert.equal(out[key],(nutrients as any)[key]);
    assert.equal(input.includedInTotals,true,'read normalization does not mutate stored historical object');
  }
});
Deno.test('an explicit includedInTotals false survives complete confirmed read presentation',()=>{
  const out=manualMealPresentation({userConfirmed:true,includedInTotals:false,calories:500,protein:20,carbs:50,fat:10});
  assert.equal(out.nutritionCompleteness,'COMPLETE');assert.equal(out.includedInTotals,false);
  assert.equal(preservedManualMealExclusion(out),false);
  assert.equal(preservedManualMealExclusion({userConfirmed:true,includedInTotals:false,calories:null,protein:20,carbs:50,fat:10}),undefined);
});
Deno.test('complete explicit zero/decimal meal is preserved; unconfirmed never earns complete totals',()=>{
  for(const values of [{calories:0,protein:0,carbs:0,fat:0},{calories:200,protein:12.5,carbs:20.25,fat:3.5}]){
    assert.equal(manualMealPresentation({...values,userConfirmed:true}).includedInTotals,true);
    assert.equal(manualMealPresentation({...values,userConfirmed:false}).nutritionCompleteness,'UNCONFIRMED');
  }
});
Deno.test('invalid historical nutrient types cannot be advertised as complete',()=>{
  for(const value of ['',null,undefined,NaN,Infinity,-1,'200'])assert.equal(manualMealPresentation({userConfirmed:true,calories:value,protein:1,carbs:1,fat:1}).includedInTotals,false);
});
Deno.test('meal PATCH preserves omitted fiber/sodium while explicit blank still clears',()=>{
  const previous={calories:500,protein:20,carbs:60,fat:15,fiber:8.5,sodium:420};
  const patched=resolveManualMealNutrients({calories:510,protein:21,carbs:61,fat:16},previous,false,NaN);
  assert.deepEqual(patched,{calories:510,protein_g:21,carbs_g:61,fat_g:16,fiber_g:8.5,sodium_mg:420});
  const cleared=resolveManualMealNutrients({fiber:'',sodium:null},previous,false,NaN);
  assert.equal(cleared.fiber_g,null);assert.equal(cleared.sodium_mg,null);
});
Deno.test('label-mode PATCH rescales hidden nutrients from per-100g provenance instead of retaining stale totals',()=>{
  const previous={calories:300,protein:15,carbs:30,fat:7.5,fiber:12.75,sodium:630,labelMode:true,weightGrams:150,
    labelValues:{calories:200,protein:10,carbs:20,fat:5,fiber:8.5,sodium:420}};
  const patched=resolveManualMealNutrients({calories:200,protein:10,carbs:20,fat:5},previous,true,200);
  assert.deepEqual(patched,{calories:400,protein_g:20,carbs_g:40,fat_g:10,fiber_g:17,sodium_mg:840});
  assert.deepEqual(resolveManualMealLabelValues({calories:200,protein:10,carbs:20,fat:5},previous,true),previous.labelValues);
});
Deno.test('legacy label records without hidden per-100g provenance fail closed to null after a portion change',()=>{
  const previous={calories:300,protein:15,carbs:30,fat:7.5,fiber:12.75,sodium:630,labelMode:true,weightGrams:150,
    labelValues:{calories:200,protein:10,carbs:20,fat:5}};
  const patched=resolveManualMealNutrients({calories:200,protein:10,carbs:20,fat:5},previous,true,200);
  assert.equal(patched.fiber_g,null);assert.equal(patched.sodium_mg,null);
});
Deno.test('meal type aliases converge to the canonical Chinese vocabulary and unknown writes fail closed',()=>{
  const aliases:Record<string,string>={BREAKFAST:'早餐',breakfast:'早餐','早餐':'早餐',LUNCH:'午餐',lunch:'午餐','午餐':'午餐',DINNER:'晚餐',dinner:'晚餐','晚餐':'晚餐',SNACK:'點心',snack:'點心','點心':'點心','点心':'點心',LATE_NIGHT:'宵夜','late-night':'宵夜','late night':'宵夜','宵夜':'宵夜'};
  for(const [input,expected] of Object.entries(aliases))assert.equal(normalizeManualMealType(input),expected);
  assert.throws(()=>normalizeManualMealType('BRUNCH'),/INVALID_MEAL_TYPE/);
  assert.equal(normalizeManualMealType('legacy-unknown',false),'legacy-unknown');
  assert.equal(manualMealPresentation({mealType:'lunch',userConfirmed:false}).mealType,'午餐');
});
Deno.test('nutrition records use one bounded meal-only read instead of the full engine snapshot',async()=>{
  const queries:string[]=[],rows:Array<{body:Record<string,unknown>;revision:string|number;local_meal_date:string}>=[
    {body:{mealRecordId:'meal-2',time:'18:30',mealType:'DINNER',foodName:'晚餐',userConfirmed:true,calories:600,protein:30,carbs:70,fat:20},revision:'2',local_meal_date:'2026-09-19'},
  ];
  const tx:any=async(strings:TemplateStringsArray,..._values:unknown[])=>{
    const query=Array.from(strings).join('?').replace(/\s+/gu,' ').trim();queries.push(query);
    return query.includes('from public.engine_meals')?rows:[];
  };
  tx.unsafe=async(query:string)=>{queries.push(query.replace(/\s+/gu,' ').trim());return[];};
  const sql={begin:async(...args:any[])=>await args.at(-1)(tx)};
  const runtime=Object.create(LocalEngineRuntime.prototype) as LocalEngineRuntime;
  (runtime as any).sql=sql;
  const result=await runtime.nutritionRecords({kind:'native',auth:'auth-a',canonical:'user-a'},{startDate:'2026-09-19',endDate:'2026-09-19'});
  assert.deepEqual(result,[{...rows[0].body,mealType:'晚餐',includedInTotals:true,nutritionCompleteness:'COMPLETE',date:'2026-09-19',revision:2}]);
  assert.equal(queries.filter(query=>query.includes('from public.engine_meals')).length,1);
  assert.equal(queries.some(query=>/engine_output_|beta_score_recompute_queue/u.test(query)),false);
  const mealQuery=queries.find(query=>query.includes('from public.engine_meals'))||'';
  assert.match(mealQuery,/canonical_user_id=.*not deleted.*local_date between.*order by local_date/u);
  assert.match(mealQuery,/limit 5001/u);
  assert.doesNotMatch(mealQuery,/select \*|canonical_record/u);
  await assert.rejects(()=>runtime.nutritionRecords({kind:'native',auth:'auth-a',canonical:'user-a'},{userId:'forged',date:'2026-09-19'}),/CLIENT_IDENTITY_FORBIDDEN/);
  rows.length=0;for(let index=0;index<5001;index++)rows.push({body:{},revision:1,local_meal_date:'2026-09-19'});
  await assert.rejects(()=>runtime.nutritionRecords({kind:'native',auth:'auth-a',canonical:'user-a'},{date:'2026-09-19'}),/READ_BOUND_EXCEEDED/);
});
Deno.test('local Edge target guard rejects remote/deployment/socket/credentials/non-dedicated targets',()=>{
  assert.deepEqual(validateLocalManualConfig(config,k=>environment[k]),config);
  for(const change of [{host:'remote.example'},{database:'postgres'},{port:5432},{username:'engine_owner'},{path:'/tmp/socket'},{password:'forbidden-local-config'}])assert.throws(()=>validateLocalManualConfig({...config,...change},k=>environment[k]));
  for(const change of [{SUPABASE_URL:'https://project.supabase.co'},{DENO_DEPLOYMENT_ID:'deployed'},{HEALTH_ENGINE_LOCAL_ONLY:'0'},{HEALTH_MANUAL_EDGE_REHEARSAL:'0'}]){const combined:Record<string,string|undefined>={...environment,...change};assert.throws(()=>validateLocalManualConfig(config,k=>combined[k]));}
  for(const url of ['http://127.0.0.1:54321/prefix','http://user@127.0.0.1:54321','http://127.0.0.1:54321/?key=x','http://127.0.0.1:54321/#fragment'])assert.throws(()=>validateLocalManualConfig(config,k=>k==='SUPABASE_URL'?url:environment[k]));
});
Deno.test('real Web verifier transport errors remain retryable through runtime and release admission',async()=>{
  const keys=['HEALTH_ENGINE_LOCAL_ONLY','HEALTH_MANUAL_WEB_SESSION_LOCAL','BETA_WEB_AUTH_VERIFY_URL'],saved=keys.map(k=>Deno.env.get(k)),originalFetch=globalThis.fetch;
  let runtime:LocalEngineRuntime|undefined;
  try{
    Deno.env.set(keys[0],'1');Deno.env.set(keys[1],'1');Deno.env.set(keys[2],'https://unit.invalid/verified-session');
    // The real verifier is imported after its immutable configuration is set.
    // Only transport is stubbed here; no OAuth or PostgreSQL acceptance is claimed.
    const {verifyWebIdentity}=await import('../supabase/functions/mobile-health-beta/index.ts?web-transport-unit');
    globalThis.fetch=()=>Promise.reject(new TypeError('synthetic transport unavailable'));
    runtime=new LocalEngineRuntime(config,()=>Promise.reject(Error('NATIVE_NOT_EXPECTED')),verifyWebIdentity);
    for(let n=0;n<10;n++){
      const response:Response=await runtime.handle(new Request('http://127.0.0.1/v1/engine/web',{method:'POST',headers:{authorization:'Bearer synthetic-unit','x-health-session-kind':'web','content-type':'application/json'},body:JSON.stringify({action:'getBodyRecords',payload:{}})}));
      assert.equal(response.status,503);assert.deepEqual(await response.json(),{ok:false,error:'AUTH_SERVICE_UNAVAILABLE',retryable:true});
    }
  }finally{globalThis.fetch=originalFetch;await runtime?.close();keys.forEach((k,i)=>saved[i]===undefined?Deno.env.delete(k):Deno.env.set(k,saved[i]!));}
});
Deno.test('runtime fingerprint differentiates DB, auth endpoint and SDK key environment without exposing values',async()=>{
  const base=await localManualEnvironmentFingerprint(config,k=>environment[k]);assert.match(base,/^[a-f0-9]{64}$/);
  assert.notEqual(base,await localManualEnvironmentFingerprint({...config,database:'health_engine_'+'b'.repeat(32)},k=>environment[k]));
  assert.notEqual(base,await localManualEnvironmentFingerprint(config,k=>({...environment,SUPABASE_SECRET_KEYS:'{"default":"synthetic-only"}'})[k]));
  assert.notEqual(base,await localManualEnvironmentFingerprint(config,k=>({...environment,SUPABASE_URL:'http://localhost:54321'})[k]));
});
Deno.test('registered local callback stops executing after flag OFF or deployment marker',async()=>{
  const keys=['HEALTH_ENGINE_LOCAL_ONLY','DENO_DEPLOYMENT_ID'],saved=keys.map(k=>Deno.env.get(k));
  try{Deno.env.set(keys[0],'1');Deno.env.delete(keys[1]);let called=0;registerLocalEngineHandler(async()=>{called++;return Response.json({ok:true});});
    const request=new Request('http://127.0.0.1/functions/v1/mobile-health-beta/v1/engine/web',{method:'POST'});
    assert.equal((await dispatchLocalEngine(request))?.status,200);assert.equal(called,1);
    Deno.env.set(keys[0],'0');assert.equal(await dispatchLocalEngine(request),null);assert.equal(called,1);
    Deno.env.set(keys[0],'1');Deno.env.set(keys[1],'present');assert.equal(await dispatchLocalEngine(request),null);assert.throws(()=>registerLocalEngineHandler(async()=>new Response()));
  }finally{keys.forEach((k,i)=>saved[i]===undefined?Deno.env.delete(k):Deno.env.set(k,saved[i]!));}
});
Deno.test('actual SDK wrapper requires configuration and preserves strict local CORS on errors',async()=>{
  const keys=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEYS','SUPABASE_SECRET_KEYS','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','HEALTH_ENGINE_LOCAL_ONLY','DENO_DEPLOYMENT_ID','HEALTH_MANUAL_LOCAL_ORIGIN'];const saved=keys.map(k=>Deno.env.get(k));
  try{keys.forEach(k=>Deno.env.delete(k));Deno.env.set('HEALTH_ENGINE_LOCAL_ONLY','1');
    assert.equal((await application.fetch(new Request('http://127.0.0.1/v1/engine/web',{method:'POST'}))).status,500);
    Deno.env.set('SUPABASE_URL','http://127.0.0.1:57841');Deno.env.set('SUPABASE_PUBLISHABLE_KEYS','{"default":"local-fixture"}');Deno.env.set('SUPABASE_SECRET_KEYS','{"default":"local-fixture"}');
    registerLocalEngineHandler(async()=>{throw Error('synthetic-internal-error');});
    const result=await application.fetch(new Request('http://127.0.0.1/v1/engine/web',{method:'POST',headers:{origin:'http://127.0.0.1:57841'}}));
    assert.equal(result.status,503);assert.equal(result.headers.get('access-control-allow-origin'),'http://127.0.0.1:57841');assert.equal((await result.json()).error,'LOCAL_MANUAL_CONFIGURATION_FAILED');
    const denied=await application.fetch(new Request('http://127.0.0.1/v1/engine/web',{method:'OPTIONS',headers:{origin:'https://invalid.example'}}));assert.equal(denied.status,403);assert.notEqual(denied.headers.get('access-control-allow-origin'),'*');
  }finally{keys.forEach((k,i)=>saved[i]===undefined?Deno.env.delete(k):Deno.env.set(k,saved[i]!));}
});
Deno.test('auth transport failure is distinguishable from invalid session; conflicting resolver fails closed',async()=>{
  const request=new Request('http://127.0.0.1',{headers:{authorization:'Bearer unit-only'}});
  await assert.rejects(()=>authenticateNativeUser(request,{auth:{getUser:async()=>({error:{status:0}})}}),/AUTH_SERVICE_UNAVAILABLE/);
  await assert.rejects(()=>authenticateNativeUser(request,{auth:{getUser:async()=>({error:{status:401}})}}),/INVALID_SUPABASE_SESSION/);
  await assert.rejects(()=>resolveNativeIdentity({rpc:async()=>({data:[{environment:'beta',provider:'google'},{environment:'beta',provider:'google'}]})},'test'),/CANONICAL_IDENTITY_CONFLICT/);
});
Deno.test('exercise names normalize but never accept control/bidi/blank/overlength inputs',()=>{
  assert.equal(exerciseName('  e\u0301 深蹲  '),'é 深蹲');assert.equal(exerciseName('<script>literal</script>'),'<script>literal</script>');
  for(const value of ['',null,7,' '.repeat(8),'x'.repeat(81),'a\nb','a\u202eb'])assert.throws(()=>exerciseName(value));
});
Deno.test('SDK auth fetch cancels headers AND response body at the same 10 second deadline',async()=>{
  const stop=new AbortController();
  const server=Deno.serve({hostname:'127.0.0.1',port:0,signal:stop.signal,onListen(){}},async request=>{
    if(new URL(request.url).searchParams.has('headers')){await new Promise<void>(resolve=>request.signal.addEventListener('abort',()=>resolve(),{once:true}));return new Response('cancelled');}
    return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"pending":'));}}),{headers:{'content-type':'application/json'}});
  });
  const origin=`http://127.0.0.1:${server.addr.port}`;const started=performance.now();
  try{await Promise.all([
    assert.rejects(()=>boundedSdkFetch(origin+'/auth/v1/user?headers=1')),
    assert.rejects(async()=>{const response=await boundedSdkFetch(origin+'/auth/v1/user?body=1');await response.json();})
  ]);const elapsed=performance.now()-started;assert.ok(elapsed>=AUTH_HTTP_TIMEOUT_MS-200&&elapsed<AUTH_HTTP_TIMEOUT_MS+3000);}
  finally{stop.abort();await server.finished;}
});
