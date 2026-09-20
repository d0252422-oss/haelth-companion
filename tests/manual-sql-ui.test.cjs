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
  vm.runInContext(fs.readFileSync('scripts/web-view-state.js','utf8'), ctx);
  ctx.activeScreen='dashboard-screen'; ctx.globalDateRange={preset:'7d'};
  return ctx;
}

test('ordinary workout draft survives navigation without a blank training screen',()=>{
 const ctx=harness(()=>{});ctx.workoutSession={startTime:'retained',exercises:[{exerciseId:'one',sets:[{weight:0,reps:10}]}]};const original=ctx.workoutSession;
 ctx.updatePageHeader=()=>{};ctx.window={scrollTo(){}};ctx.ensureScreenData=()=>Promise.resolve();ctx.handleScreenError=()=>{};
 vm.runInContext(html.split(/\r?\n/).find(line=>line.includes('function navigate(')),ctx);
 ctx.setTrainingView('workout_session');ctx.navigate('settings-screen');ctx.navigate('training-screen');
 assert.equal(ctx.workoutSession,original);assert.equal(ctx.document.getElementById('training-screen').dataset.trainingView,'overview');assert.equal(ctx.document.getElementById('training-overview').hidden,false);assert.equal(ctx.document.getElementById('workout-session').hidden,true);assert.equal(ctx.document.getElementById('training-draft-notice').hidden,false);
 ctx.setTrainingView('workout_session');assert.equal(ctx.workoutSession,original);assert.equal(ctx.document.getElementById('workout-session').hidden,false);
});
test('ordinary draft start asks before replacement and missing draft never selects an empty session',()=>{
 const ctx=harness(()=>{}),original={exercises:[]};ctx.workoutSession=original;let asked=0;ctx.document.getElementById('training-draft-dialog').showModal=()=>asked++;
 ctx.requestWorkoutStart();assert.equal(asked,1);assert.equal(ctx.workoutSession,original);
 ctx.workoutSession=null;ctx.setTrainingView('workout_session');assert.equal(ctx.document.getElementById('training-screen').dataset.trainingView,'overview');
 assert.throws(()=>ctx.setTrainingView('NONE_VISIBLE'),/INVALID_TRAINING_VIEW/);
});

test('in-flight workout save cannot be discarded or replaced by another start',()=>{
 const ctx=harness(()=>{}),draft={saving:true,exercises:[{sets:[{weight:0,reps:1}]}]};ctx.workoutSession=draft;ctx.toast=()=>{};
 ctx.requestWorkoutStart();assert.equal(ctx.workoutSession,draft);
 const listener=html.split(/\r?\n/).find(line=>line.includes('getElementById("finish-workout").onclick='));
 assert.ok(listener.indexOf('workoutSession.saving=true')<listener.indexOf('await '));
 assert.match(listener,/if\(workoutSession!==savingDraft\|\|currentUser!==savingUser\)return/);
});

test('manual date load rejects deletion while stale binding/error is present',async()=>{
 const ctx=harness(()=>{});vm.runInContext(fs.readFileSync('scripts/manual-observation-web.js','utf8'),ctx);
 ctx.document.getElementById('observation-status').setAttribute=()=>{};ctx.document.getElementById('observation-domain').value='steps';ctx.document.getElementById('observation-date').value='2026-09-12';
 vm.runInContext("observationEditor={user:currentUser,epoch:localSessionEpoch,record:{recordId:'old',date:'2026-09-11'},loadedDate:'2026-09-11'}",ctx);
 let calls=0;ctx.localEngineRequest=()=>{calls++;throw Error('must not write');};
 await ctx.saveObservation(true);assert.equal(calls,0);assert.match(ctx.document.getElementById('observation-status').textContent,/日期/);
 ctx.localEngineRequest=()=>Promise.reject(Error('SQL unavailable'));ctx.readableError=e=>e.message;
 await ctx.loadObservationDate();assert.equal(ctx.document.getElementById('observation-save').disabled,true);assert.equal(ctx.document.getElementById('observation-delete').disabled,true);
});
test('draft set validation matches SQL finite nonnegative load and positive integer reps',()=>{
 const ctx=harness(()=>{});for(const pair of [[0,1],[0,10],[12.5,3],[1000,10000]])assert.equal(ctx.validWorkoutSet(...pair),true);
 for(const pair of [[-1,10],[20,1.5],[20,0],[20,NaN],[Infinity,3],[null,3],['',3],[1001,3],[20,10001]])assert.equal(ctx.validWorkoutSet(...pair),false);
});
test('nutrition fields accept decimal macros and unknown calories remain optional',()=>{
 for(const id of ['meal-calories','meal-protein','meal-carbs','meal-fat']){const input=html.match(new RegExp('<input id="'+id+'"[^>]+>'))[0];assert.match(input,/step="any"/);assert.doesNotMatch(input,/required/);}
});

test('actual meal submit preserves blank kcal as null, explicit zero and decimal macros',async()=>{
 const ctx=harness(()=>{});let submit,payload;ctx.document.getElementById('meal-form').addEventListener=(type,fn)=>submit=fn;
 Object.assign(ctx,{performance:{now:()=>1},mealAnalysis:null,num:value=>value===''?null:Number(value),mutationRequestId:()=>randomUUID(),setMealSaveState(){},recordMutationMetric(){},completeMealSave(){},toast(){},readableError:e=>e.message,isWriteStatusUnknownError:()=>false,classifyRequestError:()=>'',apiService:{upsertMealRecord:async p=>{payload=p;return{};}}});
 vm.runInContext(html.split(/\r?\n/).find(line=>line.includes('getElementById("meal-form").addEventListener("submit"')),ctx);
 for(const [input,expected] of [['',null],['0',0],['12',12]]){
  ctx.document.getElementById('meal-calories').value=input;ctx.document.getElementById('meal-protein').value='12.5';
  await submit({preventDefault(){},currentTarget:ctx.document.getElementById('meal-form')});
  assert.equal(payload.calories,expected);assert.equal(payload.protein,12.5);assert.equal(payload.carbs,null);
 }
});

test('sleep reload uses exact stable record ID and newer revision; missing row cannot become create',async()=>{
 const ctx=harness(()=>{});vm.runInContext(fs.readFileSync('scripts/manual-observation-web.js','utf8'),ctx);ctx.readableError=e=>e.message;
 ctx.document.getElementById('observation-status').setAttribute=()=>{};ctx.document.getElementById('observation-domain').value='sleep';ctx.document.getElementById('observation-date').value='2026-09-13';
 vm.runInContext("observationEditor={user:currentUser,epoch:localSessionEpoch,record:{recordId:'sleep-2',date:'2026-09-13',revision:1},loadedDate:'2026-09-13'}",ctx);
 let calls=0;ctx.localEngineRequest=async()=>{calls++;return[{recordId:'sleep-1',date:'2026-09-13',revision:4,value:30},{recordId:'sleep-2',date:'2026-09-13',revision:2,value:420,coverage:'SESSION'}];};
 await ctx.loadObservationDate(true);assert.equal(calls,1);assert.equal(ctx.document.getElementById('observation-value').value,420);assert.equal(vm.runInContext('observationEditor.record.revision',ctx),2);
 ctx.localEngineRequest=async()=>[];await ctx.loadObservationDate(true);assert.equal(ctx.document.getElementById('observation-save').disabled,true);assert.equal(ctx.document.getElementById('observation-delete').disabled,true);assert.match(ctx.document.getElementById('observation-status').textContent,/清單/);
});
test('manual sleep times auto-calculate cross-date duration and validate wake-date semantics',()=>{
 const ctx=harness(()=>{});vm.runInContext(fs.readFileSync('scripts/manual-observation-web.js','utf8'),ctx);ctx.document.getElementById('observation-status').setAttribute=()=>{};
 ctx.document.getElementById('observation-domain').value='sleep';ctx.document.getElementById('observation-date').value='2026-09-20';
 ctx.document.getElementById('observation-start').value='2026-09-19T23:30';ctx.document.getElementById('observation-end').value='2026-09-20T07:10';
 assert.equal(ctx.syncSleepDuration(true),true);assert.equal(ctx.document.getElementById('observation-value').value,'460');assert.match(ctx.document.getElementById('observation-status').textContent,/7 小時 40 分鐘/);
 ctx.document.getElementById('observation-end').value='2026-09-21T07:10';assert.equal(ctx.syncSleepDuration(false),false);assert.equal(ctx.document.getElementById('observation-value').value,'');
});
test('Quick Add presents eight compact items in canonical mobile order and routes observation buttons separately',()=>{
 const block=html.match(/<div class="quick-options">([\s\S]*?)<\/div>\s*<\/section>/)[1];
 const titles=[...block.matchAll(/<b[^>]*>([^<]+)<\/b>/g)].map(match=>match[1]);
 assert.deepEqual(titles,['新增體重','新增體脂','新增訓練','新增飲食','新增睡眠','新增步數','新增總消耗','新增身體狀態']);
 for(const icon of ['moon','footprints','flame'])assert.match(block,new RegExp(`data-lucide="${icon}"`));
 assert.match(html,/\.quick-options\{[^}]*repeat\(2,minmax\(0,1fr\)\)/);assert.match(html,/\.quick-option\{[^}]*min-height:64px/);assert.match(html,/@media\(max-width:430px\)\{\.quick-option\{[^}]*min-height:52px/);
 assert.match(html,/querySelectorAll\("\.quick-option\[data-action\]"\)/);
 assert.match(html,/<section id="quick-sheet" data-ui-version="quick-add-v2">/);
 assert.match(html,/const SHEET_HISTORY_KEY="healthCompanionSheet"/);
 assert.match(html,/addEventListener\("popstate",\(\)=>\{const backdrop=document\.getElementById\("sheet-backdrop"\);if\(backdrop\.classList\.contains\("show"\)\)closeSheet\(\{fromHistory:true\}\);\}\)/);
});
test('records preference keys isolate provider and user without changing date range',()=>{
 const ctx=harness(()=>{}),saved=new Map();let provider='local-A';ctx.dashboardProviderNamespace=()=>provider;ctx.localStorage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};ctx.navigate=screen=>ctx.screen=screen;
 const range=ctx.globalDateRange;ctx.selectRecordsView('training');assert.equal(ctx.selectedRecordsView(),'training');assert.equal(ctx.screen,'training-screen');assert.equal(ctx.globalDateRange,range);
 ctx.currentUser={userId:'B'};assert.equal(ctx.selectedRecordsView(),'nutrition');ctx.currentUser={userId:'synthetic-A'};provider='beta-B';assert.equal(ctx.selectedRecordsView(),'nutrition');
});
test('metric-aware body drill-down and training overview do not erase drafts',()=>{
 const ctx=harness(()=>{});let renders=0;ctx.navigate=screen=>ctx.screen=screen;ctx.renderBody=()=>renders++;
 ctx.openDashboardCard({dataset:{target:'body-screen',metric:'bodyFat'}});assert.equal(ctx.document.getElementById('body-metric-select').value,'bodyFat');assert.equal(ctx.screen,'body-screen');assert.equal(renders,1);
 const draft={sqlLocked:true};ctx.workoutSession=draft;ctx.openDashboardCard({dataset:{target:'training-screen'}});assert.equal(ctx.workoutSession,draft);assert.equal(ctx.document.getElementById('training-overview').hidden,false);
});
test('weight hydration rejects older dates/accounts and exposes persistent retry',async()=>{
 const ctx=harness(()=>{}),pending=[];ctx.apiService={getBodyRecords:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))};ctx.setValue=(id,v)=>ctx.document.getElementById(id).textContent=v;ctx.recordDateLabel=x=>x;ctx.readableError=e=>e.message;
 vm.runInContext(html.split(/\r?\n/).find(line=>line.includes('async function loadWeightFormDate(')),ctx);
 ctx.document.getElementById('weight-date').value='2026-09-12';const old=ctx.loadWeightFormDate('2026-09-12');assert.equal(ctx.document.getElementById('weight-input').disabled,true);
 ctx.document.getElementById('weight-date').value='2026-09-13';const fresh=ctx.loadWeightFormDate('2026-09-13');pending[1].resolve([{recordId:'new',date:'2026-09-13',weight:70,bodyFat:0}]);await fresh;pending[0].resolve([{recordId:'old',date:'2026-09-12',weight:90}]);await old;
 assert.equal(ctx.document.getElementById('weight-record-id').value,'new');assert.equal(ctx.document.getElementById('fat-input').value,0);assert.equal(ctx.loadWeightFormDate.binding.date,'2026-09-13');
 const failure=ctx.loadWeightFormDate('2026-09-13');pending[2].reject(Error('SQL unavailable'));await failure;assert.equal(ctx.document.getElementById('weight-save').disabled,true);assert.equal(ctx.document.getElementById('weight-load-retry').hidden,false);assert.equal(ctx.loadWeightFormDate.binding,null);
 const switched=ctx.loadWeightFormDate('2026-09-13');ctx.currentUser={userId:'B'};pending[3].resolve([{recordId:'secret-A',date:'2026-09-13',weight:80}]);await switched;assert.notEqual(ctx.document.getElementById('weight-record-id').value,'secret-A');
});

test('blank/future/invalid date invalidates previous body record and prevents deletion',async()=>{
 const ctx=harness(()=>{});let deletes=0,reads=0;ctx.apiService={getBodyRecords:async()=>{reads++;return [{recordId:'previous-record',date:'2026-09-12',weight:70}];},deleteBodyRecord:async()=>deletes++};ctx.setValue=(id,v)=>ctx.document.getElementById(id).textContent=v;ctx.recordDateLabel=x=>x;ctx.readableError=e=>e.message;ctx.toast=()=>{};ctx.confirm=()=>true;ctx.setSubmitting=(button,on)=>button.disabled=on;ctx.closeSheet=()=>{};ctx.refreshInBackground=()=>{};
 vm.runInContext(html.split(/\r?\n/).find(line=>line.includes('async function loadWeightFormDate(')),ctx);
 vm.runInContext(html.split(/\r?\n/).find(line=>line.includes('weight-delete").onclick=')),ctx);
 for(const date of ['', '2026-09-14', '2026-02-30', 'invalid']){
  ctx.document.getElementById('weight-date').value='2026-09-12';await ctx.loadWeightFormDate('2026-09-12');
  assert.equal(ctx.document.getElementById('weight-delete').disabled,false);
  ctx.document.getElementById('weight-date').value=date;await ctx.loadWeightFormDate(date);await ctx.document.getElementById('weight-delete').onclick();
  assert.equal(ctx.loadWeightFormDate.binding,null);assert.equal(ctx.document.getElementById('weight-record-id').value,'');assert.equal(ctx.document.getElementById('weight-delete').disabled,true);assert.equal(deletes,0);
 }
 assert.equal(reads,4);
 ctx.document.getElementById('weight-date').value='2026-09-12';await ctx.loadWeightFormDate('2026-09-12');ctx.currentUser={userId:'other'};await ctx.document.getElementById('weight-delete').onclick();assert.equal(deletes,0);
});

test('late body save/delete invalidates same-account cache without touching another editor or account',async()=>{
 for(const operation of ['save','delete'])for(const outcome of ['resolve','reject','account-switch','epoch-switch']){
  const ctx=harness(()=>{});let finish,closed=0,toasts=0,cacheClears=0,submit;
  const request=()=>new Promise((resolve,reject)=>{finish=()=>outcome==='reject'?reject(Error('old request failed')):resolve({});});
  ctx.apiService={deleteBodyRecord:request,upsertBodyRecord:request};
  ctx.sectionLoadKeys=new Map([['body','cached-range']]);ctx.clearDashboardCache=()=>cacheClears++;
  ctx.num=value=>value===''?null:Number(value);
  ctx.document.getElementById('weight-form').addEventListener=(event,handler)=>submit=handler;
  ctx.loadWeightFormDate={binding:{user:ctx.currentUser,date:'2026-09-12',recordId:'old'}};
  ctx.openSheet=()=>{};ctx.openSheet.serial=1;ctx.toast=()=>toasts++;ctx.confirm=()=>true;ctx.setSubmitting=(button,on)=>button.disabled=on;ctx.closeSheet=()=>closed++;ctx.refreshInBackground=()=>{};ctx.readableError=e=>e.message;
  ctx.document.getElementById('weight-date').value='2026-09-12';ctx.document.getElementById('weight-record-id').value='old';
  vm.runInContext(html.split(/\r?\n/).find(line=>line.includes(operation==='delete'?'weight-delete").onclick=':'weight-form").addEventListener("submit"')),ctx);
  const pending=operation==='delete'?ctx.document.getElementById('weight-delete').onclick():submit({preventDefault(){}});
  ctx.openSheet.serial=2;ctx.loadWeightFormDate.binding=null;ctx.document.getElementById('weight-date').disabled=false;ctx.document.getElementById('weight-save').disabled=true;
  if(outcome==='account-switch')ctx.currentUser={userId:'B'};
  if(outcome==='epoch-switch')vm.runInContext('localSessionEpoch++',ctx);
  finish();await pending;assert.equal(closed,0);assert.equal(toasts,0);assert.equal(ctx.document.getElementById('weight-save').disabled,true);assert.equal(ctx.document.getElementById('weight-date').disabled,false);
  assert.equal(cacheClears,outcome==='resolve'?1:0,`${operation}/${outcome}`);
  assert.equal(ctx.sectionLoadKeys.has('body'),outcome!=='resolve',`${operation}/${outcome}`);
 }
});

test('daily SQL read validates shape, preserves measured zero and marks unavailable projections',async()=>{
 const row={date:'2026-09-13',dataStatus:'CURRENT',steps:0,activeMinutes:null,activeCalories:null,totalCalories:null};
 const ctx=harness(async()=>({ok:true,json:async()=>({ok:true,data:[row]})}));
 assert.equal((await ctx.localEngineRequest('getActivityRecords'))[0].steps,0);
 assert.equal(ctx.manualSourceStatus().database,'CONNECTED');assert.equal(ctx.manualSourceStatus().dataPresent,'PRESENT');
 ctx.renderDailySqlReadNotice('activity',[row]);assert.match(ctx.document.getElementById('activity-active-note').textContent,/尚無活動熱量/);
 ctx.recordManualSourceEvidence('getActivityRecords',{ok:true,received:true,data:[{...row,steps:null,dataStatus:'STALE'}]});assert.equal(ctx.manualSourceStatus().dataPresent,'ABSENT');
 ctx.renderDailySqlReadNotice('activity',[{...row,dataStatus:'STALE'}]);assert.match(ctx.document.getElementById('activity-steps-note').textContent,/結果待更新/);
 assert.throws(()=>ctx.assertManualResponseShape('getActivityRecords',[{...row,steps:'0'}]),e=>e.code==='MALFORMED_RESPONSE');
 const sleep={date:row.date,dataStatus:'CURRENT',totalSleepMinutes:480,sleepScore:null};
 ctx.renderDailySqlReadNotice('sleep',[sleep]);assert.match(ctx.document.getElementById('sleep-score-note').textContent,/不替換為實驗分數/);
});

test('daily detail reads reject late account and range responses before touching UI state',async()=>{
 const pending=[],ctx=harness(()=>{});ctx.sectionWindows={sleep:{start:'a',end:'b'},activity:{start:'a',end:'b'}};
 ctx.apiService={getSleepRecords:()=>new Promise(r=>pending.push(r)),getActivityRecords:()=>new Promise(r=>pending.push(r))};
 ctx.renderSleep=()=>{};ctx.renderActivity=()=>{};ctx.refreshManualObservationList=()=>Promise.resolve();
 const refresh=html.match(/    async function refreshSectionRange[^\n]+/)[0];vm.runInContext(refresh,ctx);
 const old=ctx.refreshSectionRange('sleep','a','b');ctx.currentUser={userId:'synthetic-B'};pending.shift()([{date:'secret-A'}]);await old;assert.equal(ctx.appState.sleep,undefined);
 const range=ctx.refreshSectionRange('activity','a','b');ctx.sectionWindows.activity={start:'c',end:'d'};pending.shift()([{date:'old-range'}]);await range;assert.equal(ctx.appState.activity,undefined);
});

test('daily stale or empty reads withdraw earlier snapshot analysis evidence',()=>{
 const ctx=harness(()=>{}),out={domain:'activity',calculation_date:'2026-09-13',score:80,score_status:'VALID'};
 ctx.recordManualSourceEvidence('localEngineSnapshot',{ok:true,received:true,data:{meals:[],outputs:[out]}});assert.equal(ctx.manualSourceStatus().domains.activity.analysis,'UPDATED');
 ctx.recordManualSourceEvidence('getActivityRecords',{ok:true,received:true,data:[{date:'2026-09-13',dataStatus:'STALE',steps:null,activeMinutes:null,activeCalories:null,totalCalories:null}]});assert.equal(ctx.manualSourceStatus().domains.activity.analysis,'STALE');
 ctx.recordManualSourceEvidence('getActivityRecords',{ok:true,received:true,data:[],payload:{date:'2026-09-12'}});assert.equal(ctx.manualSourceStatus().domains.activity.analysis,'UNKNOWN');assert.equal(ctx.manualSourceStatus().domains.activity.analysisDate,null);
});

test('hosted A and AB allow daily SQL read requests but never route unknown actions to legacy',async()=>{
 for(const release of ['A','AB']){
   const sent=[],ctx=harness(async(url,request)=>{sent.push({url,...request});return {ok:true};});
   ctx.LOCAL_ENGINE_ENABLED=false;ctx.HOSTED_MANUAL_SQL_ENABLED=true;ctx.sessionToken='synthetic-unit-only';ctx.URL=URL;
   ctx.window={HEALTH_MANUAL_SQL_CONFIG:{enabled:true,release,schemaVersion:'manual-sql-v1',projectRef:'aaaaaaaaaaaaaaaaaaaa',endpoint:'https://aaaaaaaaaaaaaaaaaaaa.supabase.co/functions/v1/mobile-health-beta/v1/engine/web'}};
   for(const action of ['getSleepRecords','getActivityRecords'])await ctx.hostedManualFetch(action,{date:'2026-09-13'});
   assert.equal(sent.length,2);for(const item of sent){assert.equal(item.credentials,'omit');assert.equal(item.headers['x-health-session-kind'],'web');}
   await assert.rejects(()=>ctx.hostedManualFetch('getWeeklyReport'),e=>e.code==='MANUAL_ACTION_NOT_SUPPORTED');assert.equal(sent.length,2);
 }
});

test('SQL source status does not infer DB/data/analysis from a successful identity response',async()=>{
 const ctx=harness(async()=>({ok:true,json:async()=>({ok:true,data:{user:{userId:'synthetic-A'}}})}));
 await ctx.localEngineRequest('getCurrentUser');const s=plain(ctx.manualSourceStatus());assert.equal(s.api,'CONNECTED');assert.equal(s.database,'UNKNOWN');assert.equal(s.dataPresent,'UNKNOWN');assert.equal(s.dataUpdatedAt,null);assert.equal(s.analysisUpdatedAt,null);
 assert.equal(ctx.document.getElementById('settings-status-dot').className,'status-dot notConfigured');
});
test('empty SQL SELECT proves database connectivity but not data presence or a calculated score',async()=>{
 const ctx=harness(async()=>({ok:true,json:async()=>({ok:true,data:[]})}));await ctx.localEngineRequest('getBodyRecords');const s=ctx.manualSourceStatus();assert.equal(s.database,'CONNECTED');assert.equal(s.dataPresent,'ABSENT');assert.ok(s.dataUpdatedAt);assert.equal(s.domains.body.analysis,'INSUFFICIENT_DATA');assert.equal(s.analysisUpdatedAt,null);
 assert.match(ctx.document.getElementById('data-last-updated').textContent,/最近 SQL 讀寫確認/);
});
test('committed mutation is not optimistic presence; explicit zero score is not missing',()=>{
 const ctx=harness(()=>{});ctx.recordManualSourceEvidence('upsertBodyRecord',{received:true,ok:true,data:{status:'SAVED',recordId:'id',bodyScore:0,analysisStatus:'COMPUTED'}});const s=ctx.manualSourceStatus();assert.equal(s.database,'CONNECTED');assert.equal(s.dataPresent,'UNKNOWN');assert.equal(s.domains.body.analysis,'UPDATED');assert.ok(s.analysisUpdatedAt);
 assert.equal(ctx.manualAnalysisState({score_status:'VALID',score:null}),'UNKNOWN');assert.equal(ctx.manualAnalysisState({score_status:'VALID',score:0}),'UPDATED');
});
test('SQL error after HTTP response keeps API/DB distinct and cache is not fresh evidence',async()=>{
 const ctx=harness(async()=>({ok:false,json:async()=>({ok:false,error:'DB_TIMEOUT_RETRYABLE',retryable:true})}));await assert.rejects(()=>ctx.localEngineRequest('getBodyRecords'),e=>e.code==='DB_TIMEOUT_RETRYABLE');const s=ctx.manualSourceStatus();assert.equal(s.api,'CONNECTED');assert.equal(s.database,'UNAVAILABLE');assert.equal(s.dataUpdatedAt,null);assert.equal(ctx.document.getElementById('settings-status-dot').className,'status-dot error');
});
test('no scheduled job does not become permanent analysis-in-progress',()=>{
 const ctx=harness(()=>{});assert.equal(ctx.manualAnalysisState({analysisStatus:'ANALYSIS_PENDING'}),'UNKNOWN');assert.equal(ctx.manualAnalysisState({analysisStatus:'ANALYSIS_PENDING',analysisJobScheduled:false}),'NOT_ENABLED');assert.equal(ctx.manualAnalysisState({analysisStatus:'ANALYSIS_PENDING',analysisJobScheduled:true}),'UPDATING');
});
test('analysis snapshot uses latest domain date and does not flatten insufficient/stale to green',()=>{
 const ctx=harness(()=>{});ctx.recordManualSourceEvidence('localEngineSnapshot',{received:true,ok:true,data:{meals:[],outputs:[{domain:'body',calculation_date:'2026-09-14',score:null,score_status:'INSUFFICIENT_DATA'},{domain:'body',calculation_date:'2026-09-13',score:90,score_status:'VALID'},{domain:'nutrition',calculation_date:'2026-09-14',score:60,score_status:'STALE'}]}});const s=ctx.manualSourceStatus();assert.equal(s.domains.body.analysis,'INSUFFICIENT_DATA');assert.equal(s.domains.nutrition.analysis,'STALE');assert.equal(ctx.document.getElementById('data-analysis-state').dataset.state,'STALE');assert.equal(s.analysisUpdatedAt,null);
});
test('account reset removes all SQL source timestamps and presence',()=>{
 const ctx=harness(()=>{});ctx.recordManualSourceEvidence('getBodyRecords',{received:true,ok:true,data:[{recordId:'id',revision:1,date:'2026-09-13',weight:70,bodyScore:0,analysisStatus:'COMPUTED'}]});assert.equal(ctx.manualSourceStatus().dataPresent,'PRESENT');ctx.clearLocalManualState();const s=ctx.manualSourceStatus();assert.equal(s.database,'UNKNOWN');assert.equal(s.dataPresent,'UNKNOWN');assert.equal(s.dataUpdatedAt,null);assert.equal(s.analysisUpdatedAt,null);
});
test('HTTP failure cannot claim a successful SQL envelope',async()=>{
 const ctx=harness(async()=>({ok:false,json:async()=>({ok:true,data:[]})}));await assert.rejects(()=>ctx.localEngineRequest('getBodyRecords'),e=>e.code==='HTTP_RESPONSE_CONTRACT_MISMATCH');assert.notEqual(ctx.manualSourceStatus().database,'CONNECTED');
});
test('malformed response and late same-action read cannot invent fresh source evidence',async()=>{
 const broken=harness(async()=>({ok:true,json:async()=>null}));await assert.rejects(()=>broken.localEngineRequest('getBodyRecords'),e=>e.code==='MALFORMED_RESPONSE');assert.equal(broken.manualSourceStatus().database,'UNKNOWN');
 const replies=[],ctx=harness(()=>new Promise(r=>replies.push(r)));const old=ctx.localEngineRequest('getBodyRecords'),fresh=ctx.localEngineRequest('getBodyRecords');replies[1]({ok:true,json:async()=>({ok:true,data:[]})});await fresh;replies[0]({ok:true,json:async()=>({ok:true,data:[{recordId:'old',revision:1,weight:80,date:'2026-09-12'}]})});await old;assert.equal(ctx.manualSourceStatus().dataPresent,'ABSENT');
});
test('source analysis uses actual PARTIAL_DATA enum and requires a finite numeric score',()=>{
 const ctx=harness(()=>{});assert.equal(ctx.manualAnalysisState({score_status:'PARTIAL_DATA',score:0}),'UPDATED');
 for(const value of [undefined,null,'90',NaN,Infinity]){assert.equal(ctx.manualAnalysisState({analysisStatus:'COMPUTED',bodyScore:value}),'UNKNOWN');assert.equal(ctx.manualAnalysisState({score_status:'VALID',score:value}),'UNKNOWN');}
 assert.equal(ctx.manualAnalysisState({analysisStatus:'COMPUTED'}),'UNKNOWN');
});
test('cross-action late snapshot cannot overwrite a newer body observation; empty range clears old analysis',()=>{
 const ctx=harness(()=>{}),snapshot={meals:[],outputs:[{domain:'body',calculation_date:'2026-09-12',score:90,score_status:'VALID'}]};
 ctx.recordManualSourceEvidence('localEngineSnapshot',{received:true,ok:true,data:snapshot,sequence:1});
 ctx.recordManualSourceEvidence('getBodyRecords',{received:true,ok:true,data:[{recordId:'id',revision:2,date:'2026-09-13',analysisStatus:'INSUFFICIENT_DATA'}],sequence:3});
 ctx.recordManualSourceEvidence('refreshDailyNutrition',{received:true,ok:true,data:snapshot,sequence:2});
 assert.equal(ctx.manualSourceStatus().domains.body.analysis,'INSUFFICIENT_DATA');assert.equal(ctx.manualSourceStatus().domains.body.analysisDate,'2026-09-13');
 ctx.recordManualSourceEvidence('localEngineSnapshot',{received:true,ok:true,data:{meals:[],outputs:[]},payload:{startDate:'2026-08-01',endDate:'2026-08-02'},sequence:4});
 assert.equal(ctx.manualSourceStatus().domains.body.analysis,'UNKNOWN');assert.equal(ctx.manualSourceStatus().domains.body.analysisDate,null);assert.equal(ctx.manualSourceStatus().analysisUpdatedAt,null);
 assert.equal(ctx.manualSourceStatus().domains.body.present,undefined,'old range presence is not evidence for new range');assert.equal(ctx.manualSourceStatus().dataPresent,'ABSENT');
});
test('malformed SQL arrays never earn DB/data/analysis evidence before cache/render',async()=>{
 for(const [action,data]of [['getBodyRecords',[null]],['getBodyRecords',[{}]],['localEngineSnapshot',{meals:[],outputs:[null]}]]){
  const ctx=harness(async()=>({ok:true,json:async()=>({ok:true,data})}));await assert.rejects(()=>ctx.localEngineRequest(action),e=>e.code==='MALFORMED_RESPONSE');const s=ctx.manualSourceStatus();assert.equal(s.database,'UNKNOWN');assert.equal(s.dataPresent,'UNKNOWN');assert.equal(s.analysisUpdatedAt,null);
 }
});

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

test('incomplete confirmed meal cannot disappear from daily completeness and inflate known subtotal',()=>{
 const ctx=harness(()=>{});vm.runInContext(html.split('\n').find(line=>line.includes('function dailyNutritionRows(')),ctx);
 const rows=[{date:'2026-09-13',userConfirmed:true,includedInTotals:true,nutritionCompleteness:'COMPLETE',calories:200,protein:20,carbs:20,fat:5},{date:'2026-09-13',userConfirmed:true,includedInTotals:false,nutritionCompleteness:'INCOMPLETE',calories:null,protein:null,carbs:null,fat:null}];
 const totals=ctx.dailyNutritionRows(rows)[0];for(const key of ['calories','protein','carbs','fat'])assert.equal(totals[key],null);
 assert.equal(ctx.localManualTotal([rows[0]],'calories'),200);
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
