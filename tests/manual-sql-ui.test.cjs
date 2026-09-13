// Unit-only adapter contracts. These fetch stubs are not Browser/HTTP/PG evidence.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const source = fs.readFileSync('scripts/local-engine-web.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
test('provider observation reports actual last response and clears on account reset',async()=>{
 const ctx=harness(async()=>({json:async()=>({ok:true,data:[]})}));
 await ctx.localEngineRequest('getBodyRecords');assert.match(ctx.document.getElementById('technical-provider-updated').textContent,/最近請求成功.*getBodyRecords/);
 ctx.observeManualProvider('upsertBodyRecord',false);assert.match(ctx.document.getElementById('technical-provider-updated').textContent,/最近請求失敗（沒有切换資料來源）/);
 ctx.clearLocalManualState();assert.equal(ctx.document.getElementById('technical-provider-updated').textContent,'尚無本帳號成功 SQL 讀寫證據');
});
function harness(fetch) {
  const elements = new Map();
  const ctx = vm.createContext({
    LOCAL_ENGINE_ENABLED: true, currentUser: { userId: 'synthetic-A' },
    appState: { body: [], mealsToday: [], nutrition: [], workouts: [] }, workoutSession:null, exerciseDatabase:[],
    AbortSignal, structuredClone, crypto: { randomUUID }, fetch, Map, Set, Date, Promise,
    queueMicrotask() {}, getLocalDateString: () => '2026-09-13',
    document: { querySelectorAll(){return [];}, getElementById(id) { if (!elements.has(id)) elements.set(id, { value: '', checked: false, dataset: {}, textContent: '', remove(){}, replaceChildren(){}, style:{}, classList: { add() {}, remove() {} } }); return elements.get(id); } },
  });
  vm.runInContext(source, ctx);
  return ctx;
}

test('late catalog response cannot downgrade a newer revision or revive archived selection',async()=>{
  const replies=[];const ctx=harness(()=>new Promise(resolve=>replies.push(resolve)));
  const old=ctx.localEngineRequest('getExerciseDatabase');const rejected=assert.rejects(()=>old,e=>e.code==='STALE_CATALOG_RESPONSE');
  const newer=ctx.localEngineRequest('getExerciseDatabase');replies[1]({json:async()=>({ok:true,data:[{exerciseId:'A',revision:2,archived:true}]})});
  assert.equal((await newer)[0].archived,true);replies[0]({json:async()=>({ok:true,data:[{exerciseId:'A',revision:1,archived:false}]})});await rejected;
});
test('training uncertain response retains a deep immutable envelope while draft edits are locked',async()=>{
  const requests=[];let writes=0;
  const ctx=harness(async(_url,init)=>{const request=JSON.parse(init.body);requests.push(request);if(request.action==='getTrainingWriteStatus')return{json:async()=>({ok:true,data:{exists:false}})};if(++writes===1)throw Error('transport lost');return{json:async()=>({ok:true,data:{records:[]}})};});
  const exercises=[{exerciseId:'A',sets:[{weight:0,reps:10}]}];ctx.workoutSession={exercises};
  const payload={date:'2026-09-13',startTime:'2026-09-13T00:00:00Z',endTime:'2026-09-13T00:20:00Z',exercises};
  await assert.rejects(()=>ctx.localEngineRequest('addWorkoutRecord',payload));assert.equal(ctx.workoutSession.sqlLocked,true);
  exercises[0].sets[0].weight=999; // Simulate a stale draft reference, even though real controls are locked.
  await ctx.localEngineRequest('addWorkoutRecord',{...payload,endTime:'2026-09-13T00:30:00Z'});
  const submitted=requests.filter(r=>r.action==='addWorkoutRecord');assert.deepEqual(submitted[0],submitted[1]);assert.equal(submitted[1].payload.exercises[0].sets[0].weight,0);assert.equal(ctx.workoutSession.sqlLocked,false);
});
test('account reset discards catalog, draft and hidden training-overview state',()=>{
  const ctx=harness(()=>{}),controls=Array.from({length:6},()=>({disabled:false}));ctx.document.querySelectorAll=()=>controls;
  ctx.workoutSession={exercises:[{exerciseId:'A'}]};ctx.localTrainingDraftLock(true);assert.ok(controls.every(c=>c.disabled));ctx.exerciseDatabase=[{exerciseId:'A'}];ctx.document.getElementById('training-overview').style.display='none';ctx.clearLocalManualState();
  assert.equal(ctx.workoutSession,null);assert.equal(ctx.exerciseDatabase.length,0);assert.equal(ctx.document.getElementById('training-overview').style.display,'block');
  assert.ok(controls.every(c=>c.disabled===false));
});
test('actual start/back handlers cannot replace an unresolved SQL workout draft',()=>{
  const ctx=harness(()=>{}),messages=[];ctx.toast=message=>messages.push(message);ctx.workoutSession={sqlLocked:true,sqlEnvelope:{request:'same-envelope'},exercises:[]};
  const original=ctx.workoutSession;
  for(const id of ['start-workout','back-training']){
    vm.runInContext(html.split(/\r?\n/).find(line=>line.includes(`document.getElementById("${id}").onclick=`)),ctx);
    ctx.document.getElementById(id).onclick();assert.equal(ctx.workoutSession,original);
  }
  assert.equal(messages.length,2);assert.equal(ctx.workoutSession.sqlEnvelope.request,'same-envelope');
});
test('actual navigation restores the same unresolved training draft and retry controls',()=>{
  const ctx=harness(()=>{}),states=new Map();ctx.workoutSession={sqlLocked:true,sqlEnvelope:{request:'retained'}};const original=ctx.workoutSession;
  for(const id of ['training-screen','workout-session','settings-screen']){const state=new Set();states.set(id,state);ctx.document.getElementById(id).classList={add:x=>state.add(x),remove:x=>state.delete(x)};}
  ctx.document.querySelectorAll=selector=>selector==='.screen'?[...states.keys()].map(id=>ctx.document.getElementById(id)):[];
  ctx.updatePageHeader=()=>{};ctx.window={scrollTo(){}};ctx.ensureScreenData=()=>Promise.resolve();ctx.handleScreenError=()=>{};
  vm.runInContext(html.split(/\r?\n/).find(line=>line.includes('function navigate(')),ctx);
  ctx.navigate('settings-screen');assert.equal(states.get('workout-session').has('active'),false);
  ctx.navigate('training-screen');assert.equal(states.get('workout-session').has('active'),true);assert.equal(ctx.workoutSession,original);
  assert.equal(ctx.document.getElementById('training-overview').style.display,'none');
});
test('split-session local daily totals count duration once, preserve zero and stable ID grouping',()=>{
  const ctx=harness(()=>{}),rows=ctx.localTrainingDailyRows([{date:'2026-09-13',sessionId:'s',totalSets:1,totalVolume:0,durationMinutes:20},{date:'2026-09-12',sessionId:'s',totalSets:1,totalVolume:10,durationMinutes:20}]);
  assert.deepEqual(plain(rows),[{date:'2026-09-12',trainingSets:1,trainingVolume:10,trainingDuration:20},{date:'2026-09-13',trainingSets:1,trainingVolume:0,trainingDuration:0}]);
});
test('dashboard cache isolates actual provider, canonical user and dedicated database namespace',()=>{
  const ctx=harness(()=>{});ctx.location={origin:'http://127.0.0.1:57841'};ctx.window={HEALTH_ENGINE_LOCAL_CONFIG:{databaseNamespace:'db-A'}};ctx.DASHBOARD_CACHE_SCHEMA='test';ctx.CONFIG={API_BASE_URL:'https://example.invalid'};
  for(const name of ['dashboardProviderNamespace','dashboardCacheKey'])vm.runInContext(html.split(/\r?\n/).find(line=>line.includes('function '+name+'(')),ctx);
  const original=ctx.dashboardCacheKey('a','b');ctx.window.HEALTH_ENGINE_LOCAL_CONFIG.databaseNamespace='db-B';assert.notEqual(ctx.dashboardCacheKey('a','b'),original);ctx.window.HEALTH_ENGINE_LOCAL_CONFIG.databaseNamespace='db-A';ctx.currentUser={userId:'B'};assert.notEqual(ctx.dashboardCacheKey('a','b'),original);ctx.LOCAL_ENGINE_ENABLED=false;assert.notEqual(ctx.dashboardCacheKey('a','b'),original);
});

test('manual SQL local route remains default-off and does not replace Apps Script authentication', async () => {
  assert.match(html, /HEALTH_ENGINE_LOCAL_CONFIG\?\.enabled===true/);
  assert.match(html, /if\(LOCAL_ENGINE_ENABLED\)return localEngineRequest\(action,payload\)/);
  assert.match(html, /createSession\(response\.credential\)/);
  const ctx = harness(() => { throw Error('must not fetch'); });
  ctx.LOCAL_ENGINE_ENABLED = false;
  await assert.rejects(() => ctx.localEngineRequest('upsertBodyRecord', { date: '2026-09-13', weight: 70 }), /LOCAL_ENGINE_DISABLED/);
});

test('manual body retry after unresolved timeout keeps one request ID', async () => {
  const requests = [];
  let mutations = 0;
  const ctx = harness(async (_url, init) => {
    const request = JSON.parse(init.body); requests.push(request);
    if (request.action === 'getBodyWriteStatus') return { ok: true, json: async () => ({ ok: true, data: { exists: false } }) };
    if (++mutations === 1) { const error = Error('synthetic timeout'); error.name = 'TimeoutError'; throw error; }
    return { ok: true, json: async () => ({ ok: true, data: { status: 'SAVED', record: { ...request.payload, recordId: randomUUID(), revision: 1, source: 'MANUAL_WEB', analysisStatus: 'ANALYSIS_PENDING' } } }) };
  });
  const input = { date: '2026-09-13', weight: 70, bodyFat: null, source: 'manual' };
  await assert.rejects(() => ctx.localEngineRequest('upsertBodyRecord', input), error => error.code === 'REQUEST_TIMEOUT');
  await ctx.localEngineRequest('upsertBodyRecord', input);
  const writes = requests.filter(r => r.action === 'upsertBodyRecord');
  assert.equal(writes.length, 2);
  assert.ok(requests.some(r => r.action === 'getBodyWriteStatus'));
  assert.match(writes[0].payload.clientRequestId, /^[0-9a-f-]{36}$/);
  assert.equal(writes[1].payload.clientRequestId, writes[0].payload.clientRequestId);
  assert.deepEqual(plain(writes[1].payload), plain(writes[0].payload));
});

test('manual body adapter carries stored revision and preserves zero/null reads', async () => {
  const id = randomUUID(), requests = [], rows = [{ recordId: id, date: '2026-09-13', weight: 70, bodyFat: 0, revision: 4, source: 'MANUAL_WEB', analysisStatus: 'ANALYSIS_PENDING' }];
  const ctx = harness(async (_url, init) => {
    const request = JSON.parse(init.body); requests.push(request);
    return { ok: true, json: async () => ({ ok: true, data: request.action === 'getBodyRecords' ? rows : { status: 'SAVED', record: { ...rows[0], revision: 5 } } }) };
  });
  const result = await ctx.localEngineRequest('getBodyRecords', { startDate: '2026-09-13', endDate: '2026-09-13' });
  ctx.appState.body = result;
  assert.equal(result[0].bodyFat, 0);
  await ctx.localEngineRequest('upsertBodyRecord', { recordId: id, date: '2026-09-13', weight: 71, bodyFat: null });
  const mutation = requests.find(r => r.action === 'upsertBodyRecord');
  assert.equal(mutation.payload.revision, 4);
  assert.equal(mutation.payload.bodyFat, null);
});

test('local display still distinguishes zero/null and 0.85 completeness', () => {
  const ctx = harness(async () => { throw Error('not used'); });
  const common = { domain: 'nutrition', score_status: 'VALID', data_completeness: 0.85, engine_version: 'display-only' };
  assert.match(ctx.localEngineOutputText({ ...common, score: 0 }), /nutrition: 0 .*85%/);
  assert.doesNotMatch(ctx.localEngineOutputText({ ...common, score: 0 }), /8500%/);
  assert.match(ctx.localEngineOutputText({ ...common, score: null }), /— 資料不足/);
});

test('local body lost response resolves through receipt, without another write', async () => {
  const id = randomUUID(), calls = [];
  const ctx = harness(async (_url, init) => {
    const req = JSON.parse(init.body); calls.push(req.action);
    if (req.action === 'upsertBodyRecord') { const error = Error('lost response'); error.name = 'TimeoutError'; throw error; }
    assert.equal(req.action, 'getBodyWriteStatus');
    return { ok: true, json: async () => ({ ok: true, data: { exists: true, recordId: id, record: { recordId: id, date: '2026-09-13', weight: 70, bodyFat: null, revision: 1 }, status: 'SAVED' } }) };
  });
  const result = await ctx.localEngineRequest('upsertBodyRecord', { date: '2026-09-13', weight: 70 });
  assert.equal(result.recordId, id);
  assert.equal(result.recovered, true);
  assert.deepEqual(calls, ['upsertBodyRecord', 'getBodyWriteStatus']);
});

test('late body reads cannot populate a switched-account cache', async () => {
  let resolveRead;
  const ctx = harness(() => new Promise(resolve => { resolveRead = resolve; }));
  const read = ctx.localEngineRequest('getBodyRecords', { date: '2026-09-13' });
  ctx.clearLocalManualState(); ctx.currentUser = { userId: 'synthetic-B' };
  resolveRead({ ok: true, json: async () => ({ ok: true, data: [{ recordId: randomUUID(), revision: 9, weight: 70 }] }) });
  await assert.rejects(() => read, error => error.code === 'IDENTITY_CHANGED');
  assert.equal(vm.runInContext('localBodyRecords.size', ctx), 0);
});

test('retryable SQL timeout retains the exact manual body envelope for retry', async () => {
  const requests = [];
  const ctx = harness(async (_url, init) => {
    const request = JSON.parse(init.body); requests.push(request);
    return { ok: requests.length > 1, json: async () => requests.length === 1
      ? { ok: false, error: 'DB_TIMEOUT_RETRYABLE', retryable: true }
      : { ok: true, data: { status: 'SAVED', record: { ...request.payload, recordId: randomUUID(), revision: 1 } } } };
  });
  const input = { date: '2026-09-13', weight: 70, bodyFat: null };
  await assert.rejects(() => ctx.localEngineRequest('upsertBodyRecord', input), error => error.code === 'DB_TIMEOUT_RETRYABLE' && error.retryable === true);
  await ctx.localEngineRequest('upsertBodyRecord', input);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].payload, requests[0].payload);
});

for (const section of ['body', 'nutrition']) test(`late ${section} range R1 response cannot overwrite completed R2`, async () => {
  const ctx = harness(async () => { throw Error('API layer is explicitly unit-stubbed'); });
  const pending = [], renders = [];
  ctx.sectionWindows = { [section]: { start: '2026-08-01', end: '2026-08-01' } };
  ctx.apiService = { [section === 'body' ? 'getBodyRecords' : 'getNutritionRecords']: () => new Promise(resolve => pending.push(resolve)) };
  ctx.renderBody = () => renders.push('body'); ctx.renderNutrition = () => renders.push('nutrition');
  const actualFunction = html.split('\n').find(line => line.includes('async function refreshSectionRange('));
  assert.ok(actualFunction, 'Exercise actual existing Web refreshSectionRange implementation');
  vm.runInContext(actualFunction, ctx);
  const oldRead = ctx.refreshSectionRange(section, '2026-08-01', '2026-08-01');
  ctx.sectionWindows[section] = { start: '2026-08-02', end: '2026-08-02' };
  const newRead = ctx.refreshSectionRange(section, '2026-08-02', '2026-08-02');
  const newRows = [{ date: '2026-08-02', recordId: 'new-range', mealRecordId: 'new-range' }];
  pending[1](newRows); await newRead;
  pending[0]([{ date: '2026-08-01', recordId: 'old-range', mealRecordId: 'old-range' }]); await oldRead;
  assert.deepEqual(plain(ctx.appState[section]), newRows);
  assert.deepEqual(renders, [section]);
  if (section === 'nutrition') assert.deepEqual(plain(ctx.appState.mealsToday), [], 'historical range cannot replace today semantics');
});

test('actual nutrition render and daily rows distinguish all missing, explicit zero, and partial totals', () => {
  const ctx = harness(async () => { throw Error('not used'); });
  ctx.sectionWindows = { nutrition: { start: '2026-09-13', end: '2026-09-13' } };
  ctx.setValue = (id, value) => { ctx.document.getElementById(id).textContent = value; };
  ctx.document.querySelector = selector => ctx.document.getElementById(selector);
  ctx.fillDailyGaps = rows => rows; ctx.renderTrendChart = () => {}; ctx.trendSummaryHtml = () => '';
  ctx.escapeHtml = value => String(value); ctx.valid = value => value !== null && value !== undefined;
  for (const name of ['dailyNutritionRows', 'renderNutrition']) {
    const actual = html.split('\n').find(line => line.includes(`function ${name}(`));
    assert.ok(actual); vm.runInContext(actual, ctx);
  }
  for (const [values, expectedText, expectedTotal] of [[[null, null, null], '—', null], [[0, 0, 0], '0 kcal', 0], [[200, null, 100], '—', null]]) {
    const meals = values.map((calories, i) => ({ mealRecordId: `synthetic-${i}`, date: '2026-09-13', calories, protein: calories, carbs: calories, fat: calories, includedInTotals: true }));
    ctx.appState.mealsToday = meals; ctx.appState.nutrition = meals;
    ctx.renderNutrition();
    assert.equal(ctx.document.getElementById('nutrition-calories').textContent, expectedText);
    assert.equal(ctx.dailyNutritionRows(meals)[0].calories, expectedTotal);
    assert.equal(ctx.localManualTotal(meals, 'calories'), expectedTotal);
  }
});

for (const kind of ['body', 'meal']) {
  const readAction = kind === 'body' ? 'getBodyRecords' : 'getNutritionRecords';
  const upsertAction = kind === 'body' ? 'upsertBodyRecord' : 'upsertMealRecord';
  const deleteAction = kind === 'body' ? 'deleteBodyRecord' : 'deleteMealRecord';
  const idKey = kind === 'body' ? 'recordId' : 'mealRecordId';
  const mapName = kind === 'body' ? 'localBodyRecords' : 'localMealRecords';
  test(`actual ${kind} adapter reversed reads cannot downgrade mutation revision cache`, async () => {
    const id = randomUUID(), pending = [], requests = [];
    const ctx = harness(async (_url, init) => {
      const request = JSON.parse(init.body); requests.push(request);
      if (request.action === readAction) return await new Promise(resolve => pending.push(resolve));
      return { ok: true, json: async () => ({ ok: true, data: { record: { [idKey]: id, revision: 3 }, recordId: id, status: 'SAVED' } }) };
    });
    const oldRead = ctx.localEngineRequest(readAction, { date: '2026-09-13' });
    const newRead = ctx.localEngineRequest(readAction, { date: '2026-09-13' });
    const response = revision => ({ ok: true, json: async () => ({ ok: true, data: [{ [idKey]: id, revision, date: '2026-09-13', weight: 70 }] }) });
    pending[1](response(2)); await newRead;
    pending[0](response(1)); await oldRead;
    assert.equal(vm.runInContext(`${mapName}.get(${JSON.stringify(id)}).revision`, ctx), 2);
    await ctx.localEngineRequest(upsertAction, { [idKey]: id, date: '2026-09-13', weight: 71 });
    assert.equal(requests.find(request => request.action === upsertAction).payload.revision, 2);
  });

  test(`actual ${kind} adapter successful deletion blocks an older read from reviving cache`, async () => {
    const id = randomUUID(); let reads = 0, resolveLate;
    const record = { [idKey]: id, date: '2026-09-13', weight: 70, revision: 2 };
    const ctx = harness(async (_url, init) => {
      const request = JSON.parse(init.body);
      if (request.action === readAction) {
        if (++reads === 2) return await new Promise(resolve => { resolveLate = resolve; });
        return { ok: true, json: async () => ({ ok: true, data: [record] }) };
      }
      assert.equal(request.action, deleteAction);
      // Actual meal deletion has no deleted:true field; only body does.
      return { ok: true, json: async () => ({ ok: true, data: { record: { ...record, revision: 3 }, recordId: id, status: kind === 'body' ? 'SAVED' : 'QUEUED', ...(kind === 'body' ? { deleted: true } : {}) } }) };
    });
    await ctx.localEngineRequest(readAction, { date: '2026-09-13' });
    const late = ctx.localEngineRequest(readAction, { date: '2026-09-13' });
    await ctx.localEngineRequest(deleteAction, { [idKey]: id });
    resolveLate({ ok: true, json: async () => ({ ok: true, data: [record] }) }); await late;
    const cached = plain(vm.runInContext(`${mapName}.get(${JSON.stringify(id)})`, ctx));
    assert.equal(cached.deleted, true); assert.equal(cached.revision, 3);
    ctx.clearLocalManualState();
    assert.equal(vm.runInContext(`${mapName}.size`, ctx), 0, 'Identity reset must clear account-scoped tombstone cache');
  });
}
