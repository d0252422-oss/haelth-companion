// Unit/transport contracts, NOT PostgreSQL/actual Edge/OAuth acceptance.
import assert from 'node:assert/strict';
import application,{registerLocalEngineHandler,dispatchLocalEngine,authenticateNativeUser,resolveNativeIdentity} from '../supabase/functions/mobile-health-beta/index.ts';
import {validateLocalManualConfig,localManualEnvironmentFingerprint} from '../supabase/functions/mobile-health-beta/local-manual-bootstrap.ts';
import {boundedSdkFetch,AUTH_HTTP_TIMEOUT_MS} from '../supabase/functions/mobile-health-beta/bounded-auth-fetch.ts';
import {exerciseName} from '../supabase/functions/mobile-health-beta/manual-training-local.ts';
import {LocalEngineRuntime,manualMealPresentation} from '../supabase/functions/mobile-health-beta/local-engine-runtime.ts';
const config={host:'127.0.0.1',port:57483,database:'health_engine_'+'a'.repeat(32),username:'service_role'};
const environment:Record<string,string>={HEALTH_ENGINE_LOCAL_ONLY:'1',HEALTH_MANUAL_EDGE_REHEARSAL:'1',SUPABASE_URL:'http://127.0.0.1:54321'};
Deno.test('meal completeness is based on explicit four main nutrients, not confirmation alone',()=>{
  for(const nutrients of [{calories:null,protein:null,carbs:null,fat:null},{calories:0,protein:12.5,carbs:null,fat:null}]){
    const input={...nutrients,userConfirmed:true,includedInTotals:true},out=manualMealPresentation(input);
    assert.equal(out.includedInTotals,false);assert.equal(out.nutritionCompleteness,'INCOMPLETE');
    for(const key of ['calories','protein','carbs','fat'])assert.equal(out[key],(nutrients as any)[key]);
    assert.equal(input.includedInTotals,true,'read normalization does not mutate stored historical object');
  }
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
