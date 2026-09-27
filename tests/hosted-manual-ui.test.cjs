// Transport unit tests only; stubs below are never counted as browser/SQL acceptance.
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('scripts/local-engine-web.js','utf8'),html=fs.readFileSync('index.html','utf8');
const project='a'.repeat(20),endpoint=`https://${project}.supabase.co/functions/v1/mobile-health-beta/v1/engine/web`;
function htmlAsyncFunction(name){const start=html.indexOf(`async function ${name}(`);assert.notEqual(start,-1,`missing ${name}`);const nextSync=html.indexOf('\n    function ',start+1),nextAsync=html.indexOf('\n    async function ',start+1),ends=[nextSync,nextAsync].filter(value=>value>=0);return html.slice(start,ends.length?Math.min(...ends):html.length).trim();}
function harness(fetch){
 const nodes=new Map();const ctx=vm.createContext({LOCAL_ENGINE_ENABLED:false,HOSTED_MANUAL_SQL_ENABLED:true,LOCAL_EXERCISE_ENABLED:false,
  window:{HEALTH_MANUAL_SQL_CONFIG:{enabled:true,release:'A',schemaVersion:'manual-sql-v1',projectRef:project,endpoint}},URL,fetch,AbortSignal,AbortController,structuredClone,crypto:require('node:crypto').webcrypto,
  sessionToken:'synthetic-unit-A',identityEpoch:0,currentUser:{userId:'legacy-A'},appState:{body:[],workouts:[],nutrition:[],mealsToday:[]},workoutSession:null,exerciseDatabase:[],
  document:{querySelectorAll(){return[]},getElementById(id){if(!nodes.has(id))nodes.set(id,{value:'',checked:false,style:{setProperty(){}},dataset:{},classList:{add(){},remove(){}},remove(){},replaceChildren(){}});return nodes.get(id)}},
  queueMicrotask(){},requestAnimationFrame(){},Date,Map,Set,Promise,performance,Blob,setTimeout,clearTimeout,CONFIG:{API_BASE_URL:'https://legacy.invalid',API_TIMEOUT:1000},isConfigured:()=>true,perfLog(){},unwrapApiResponse:x=>x.data,classifyRequestError:()=>'',isSessionError:()=>false,isAccessError:()=>false,handleAccessError:()=>false,setAuthenticatedAppVisibility(){}});
 vm.runInContext(source,ctx);ctx.identitySnapshot=()=>({epoch:ctx.identityEpoch,userId:String(ctx.currentUser?.userId||''),token:ctx.sessionToken});ctx.identitySnapshotCurrent=snapshot=>snapshot?.epoch===ctx.identityEpoch&&snapshot.userId===String(ctx.currentUser?.userId||'')&&snapshot.token===ctx.sessionToken;ctx.staleIdentityResponse=()=>Object.assign(Error('STALE_IDENTITY_RESPONSE'),{code:'STALE_IDENTITY_RESPONSE'});vm.runInContext(htmlAsyncFunction('sessionPost'),ctx);return ctx;
}
const identity={ok:true,data:{canonicalUserId:'10000000-0000-4000-8000-000000000001',provider:'postgresql-manual-v1',release:'A',schemaVersion:'manual-sql-v1'}};
const response=data=>({ok:true,status:200,headers:new Headers(),json:async()=>data,text:async()=>JSON.stringify(data)});

test('SQL-first AB never sends any current data-write action to Sheets, including failures',async()=>{
 // Discover the frontend write inventory so newly added writes are not silently omitted.
 const actions=[...new Set([...html.matchAll(/(?:sessionPost|apiPost)\(['"]([^'"]+)['"]/g)].map(m=>m[1]))]
  .filter(a=>/^(add|upsert|delete|update|manage|save|confirm|reject|create|refresh)/.test(a));
 assert.ok(actions.includes('addWorkoutRecord'));assert.ok(actions.includes('upsertBodyRecord'));
 for(const failure of ['SQL_ERROR','NETWORK_TIMEOUT'])for(const action of actions){
  const calls=[],ctx=harness(async(url,init)=>{
   calls.push(url);const req=JSON.parse(init.body);
   if(req.action==='getManualProviderIdentity')return response({...identity,data:{...identity.data,release:'AB'}});
   if(failure==='NETWORK_TIMEOUT')throw Object.assign(Error('synthetic timeout'),{name:'TimeoutError'});
   return response({ok:false,error:'DB_UNAVAILABLE',retryable:false});
  });
  ctx.window.HEALTH_MANUAL_SQL_CONFIG.release='AB';
  await assert.rejects(()=>ctx.sessionPost(action,{clientRequestId:require('node:crypto').randomUUID()}));
  assert.ok(calls.every(url=>url===endpoint),action+' '+failure+' must not fall back');
 }
});

test('hosted first login retains Google entry; only isolated local mode shows synthetic accounts',()=>{
 for(const local of [false,true]){
  const ctx=harness(()=>{throw Error('LOGIN_MUST_NOT_FETCH_DATA')});let synthetic=0,googleRendered=0;
  ctx.LOCAL_ENGINE_ENABLED=local;ctx.sessionToken='';ctx.currentUser=null;ctx.liffReady=false;
  ctx.pendingLineLinkCode='';ctx.googleButtonRendered=false;ctx.showLocalEngineLogin=()=>{synthetic++};
  ctx.google=ctx.window.google={accounts:{id:{renderButton(){googleRendered++}}}};
  vm.runInContext(html.split(/\r?\n/).find(l=>l.includes('function showLogin(){')),ctx);ctx.showLogin();
  assert.equal(synthetic,local?1:0,'hosted login must never show synthetic A/B selector');
  assert.equal(googleRendered,local?0:1,'hosted login keeps the existing Google renderer');
 }
});
test('hosted data and canonical current-user read use SQL; logout remains explicit auth authority',async()=>{
 const calls=[],ctx=harness(async(url,init)=>{const request=JSON.parse(init.body);calls.push({url,init,request});return response(request.action==='getManualProviderIdentity'?identity:{ok:true,data:[]});});
 assert.equal((await ctx.sessionPost('getBodyRecords')).length,0);
 assert.equal(calls.length,2);assert.ok(calls.every(c=>c.url===endpoint&&c.init.credentials==='omit'&&c.init.headers.authorization==='Bearer synthetic-unit-A'&&c.init.headers['x-health-session-kind']==='web'));
 assert.ok(calls.every(c=>!('sessionToken'in c.request)&&!('user_id'in c.request.payload)));
 await ctx.sessionPost('getCurrentUser');assert.equal(calls.at(-1).url,endpoint);
 await ctx.sessionPost('logout');assert.equal(calls.at(-1).url,'https://legacy.invalid');
});
test('hosted durable mutations do not queue a redundant full engine snapshot',async()=>{
 const calls=[],ctx=harness(async(url,init)=>{const request=JSON.parse(init.body);calls.push(request.action);if(request.action==='getManualProviderIdentity')return response(identity);return response({ok:true,data:{status:'SAVED',recordId:'body-1',deleted:false,record:{recordId:'body-1',date:'2026-09-19',weight:70,bodyFat:null,revision:1}}});});
 let queued=0;ctx.queueMicrotask=()=>{queued++};
 const saved=await ctx.sessionPost('upsertBodyRecord',{date:'2026-09-19',weight:70});
 assert.equal(saved.recordId,'body-1');
 assert.equal(queued,0,'hosted readback must stay domain-scoped instead of scheduling localEngineSnapshot');
 assert.equal(calls.includes('localEngineSnapshot'),false);
});
test('hosted unsupported or disabled data never silently falls back to Sheets',async()=>{
 const calls=[],ctx=harness(async(url,init)=>{calls.push({url,action:JSON.parse(init.body).action});return response(identity);});
 for(const action of ['getExerciseDatabase','addWorkoutRecord'])await assert.rejects(()=>ctx.sessionPost(action),e=>e.code==='EXERCISE_MANAGEMENT_DISABLED');
 await assert.rejects(()=>ctx.sessionPost('upsertHealthCheckin'),e=>e.code==='MANUAL_ACTION_NOT_SUPPORTED');
 assert.deepEqual(calls.map(c=>c.action),['getManualProviderIdentity']);assert.ok(calls.every(c=>c.url===endpoint));
});

test('hosted keeps the actual existing LINE identity actions on the legacy auth provider',async()=>{
 const calls=[],ctx=harness(async(url,init)=>{calls.push({url,action:JSON.parse(init.body).action});return response({ok:true,data:{}});});
 for(const action of ['completeLineGoogleLink','linkLineIdentity'])await ctx.sessionPost(action,{});
 assert.deepEqual(calls,[{url:'https://legacy.invalid',action:'completeLineGoogleLink'},{url:'https://legacy.invalid',action:'linkLineIdentity'}]);
});
test('hosted endpoint/project/config and local synthetic marker fail closed',async()=>{
 let calls=0;const ctx=harness(()=>{calls++;throw Error('unexpected')});
 ctx.window.HEALTH_MANUAL_SQL_CONFIG.endpoint='http://127.0.0.1:57841/v1/engine/web';await assert.rejects(()=>ctx.sessionPost('getBodyRecords'),/MANUAL_PROVIDER_NOT_CONFIGURED/);assert.equal(calls,0);
 ctx.window.HEALTH_MANUAL_SQL_CONFIG.endpoint=endpoint;ctx.sessionToken='LOCAL_HTTP_ONLY_COOKIE';await assert.rejects(()=>ctx.sessionPost('getBodyRecords'),/INVALID_WEB_SESSION/);assert.equal(calls,0);
});
test('parallel initial reads share one identity probe and account/provider change clears caches',async()=>{
 const calls=[],ctx=harness(async(url,init)=>{const action=JSON.parse(init.body).action;calls.push(action);return response(action==='getManualProviderIdentity'?identity:{ok:true,data:[]});});
 await Promise.all([ctx.sessionPost('getBodyRecords'),ctx.sessionPost('getBodyRecords')]);assert.equal(calls.filter(x=>x==='getManualProviderIdentity').length,1);
 const a=ctx.hostedManualNamespace();ctx.clearLocalManualState();ctx.sessionToken='synthetic-unit-B';assert.notEqual(ctx.hostedManualNamespace(),a);
 await ctx.sessionPost('getBodyRecords');assert.equal(calls.filter(x=>x==='getManualProviderIdentity').length,2);
 ctx.window.HEALTH_MANUAL_SQL_CONFIG.release='AB';await assert.rejects(()=>ctx.sessionPost('getBodyRecords'),/MANUAL_PROVIDER_NOT_CONFIGURED/);
});
test('SQL error/lost response preserves bounded recovery and never invokes legacy data',async()=>{
 let writes=0;const calls=[],ctx=harness(async(url,init)=>{const req=JSON.parse(init.body);calls.push({url,req});if(req.action==='getManualProviderIdentity')return response(identity);if(req.action==='getBodyWriteStatus')return response({ok:true,data:{exists:true,status:'SAVED',recordId:'saved',deleted:false,record:{recordId:'saved',date:'2026-09-12',weight:80,bodyFat:null,revision:1}}});if(++writes===1)throw Error('response lost');return response({ok:false,error:'DB_CONFLICT_RETRYABLE',retryable:true});});
 const saved=await ctx.sessionPost('upsertBodyRecord',{date:'2026-09-12',weight:80});assert.equal(saved.recovered,true);assert.equal(writes,1);assert.ok(calls.every(c=>c.url===endpoint));
});
