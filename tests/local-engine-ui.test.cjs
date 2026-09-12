const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('scripts/local-engine-web.js','utf8');
const ctx=vm.createContext({});vm.runInContext(source,ctx);
test('local experimental formatter preserves zero and null; completeness 0.85 is 85%',()=>{
 const base={domain:'nutrition',score_status:'PARTIAL_DATA',data_completeness:0.85,engine_version:'nutrition-score-v1.0'};
 assert.match(ctx.localEngineOutputText({...base,score:0}),/nutrition: 0 .*85%/);
 assert.doesNotMatch(ctx.localEngineOutputText({...base,score:0}),/8500%|資料不足/);
 assert.match(ctx.localEngineOutputText({...base,score:null}),/— 資料不足/);
 assert.match(ctx.localEngineOutputText({...base,score:17,score_status:'STALE'}),/STALE/);
});
test('local Web is opt-in, does not label photo interface as successful recognition',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/window\.HEALTH_ENGINE_LOCAL_CONFIG\?\.enabled===true/);
 assert.match(source,/照片辨識未實作/);
 assert.match(source,/if\(currentUser!==requestedUser\)return/);
 assert.match(source,/panel\.dataset\.state='error'/);
 assert.match(source,/重試 Engine/);
});
test('unit-only transport failures retain existing write-reconciliation classification',async()=>{
 const local=vm.createContext({LOCAL_ENGINE_ENABLED:true,AbortSignal,fetch:async()=>{const e=Error('test timeout');e.name='TimeoutError';throw e;}});
 vm.runInContext(source,local);
 await assert.rejects(()=>local.localEngineRequest('getCurrentUser'),e=>e.code==='REQUEST_TIMEOUT');
 local.fetch=async()=>({json:async()=>{throw Error('invalid JSON');}});
 await assert.rejects(()=>local.localEngineRequest('getCurrentUser'),e=>e.code==='MALFORMED_RESPONSE');
});
