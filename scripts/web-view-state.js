// UI state only. All data continues through the existing provider and verified session.
const WORKOUT_DRAFT_SCHEMA='v1',WORKOUT_DRAFT_TTL=12*60*60*1000;
function workoutDraftStorageKey(){if(!currentUser?.userId)return null;try{return `healthCompanionWorkoutDraft:${WORKOUT_DRAFT_SCHEMA}:${dashboardProviderNamespace()}:${currentUser.userId}`;}catch{return null;}}
function discardStoredWorkoutDraft(key=workoutDraftStorageKey()){try{if(key)sessionStorage.removeItem(key);}catch{/* Storage is optional; the in-memory draft remains authoritative. */}}
function clearWorkoutDraft(){discardStoredWorkoutDraft();}
function persistWorkoutDraft(){const key=workoutDraftStorageKey();if(!key||!workoutSession)return;const exercises=(Array.isArray(workoutSession.exercises)?workoutSession.exercises:[]).slice(0,50).map(exercise=>({exerciseId:String(exercise.exerciseId||''),exerciseName:String(exercise.exerciseName||''),muscleGroup:String(exercise.muscleGroup||''),bodyPartId:String(exercise.bodyPartId||''),bodyPartName:String(exercise.bodyPartName||''),sets:(Array.isArray(exercise.sets)?exercise.sets:[]).slice(0,200).map(set=>({setNumber:Number(set.setNumber),weight:Number(set.weight),reps:Number(set.reps),volume:Number(set.volume)}))}));if(exercises.reduce((total,item)=>total+item.sets.length,0)>200)return;const now=Date.now(),value={schema:WORKOUT_DRAFT_SCHEMA,userId:currentUser.userId,provider:dashboardProviderNamespace(),savedAt:now,expiresAt:now+WORKOUT_DRAFT_TTL,date:document.getElementById('workout-date')?.value||getLocalDateString(),draft:{startTime:workoutSession.startTime,exercises,sqlLocked:workoutSession.sqlLocked===true,sqlEnvelope:workoutSession.sqlEnvelope||null}};const encoded=JSON.stringify(value);try{if(encoded.length<=100000)sessionStorage.setItem(key,encoded);}catch{/* Quota/privacy-disabled WebViews must not break the active workout. */}}
async function restoreWorkoutDraft(){const key=workoutDraftStorageKey();if(!key)return false;let saved;try{saved=JSON.parse(sessionStorage.getItem(key)||'null');}catch{discardStoredWorkoutDraft(key);return false;}const requestId=saved?.draft?.sqlEnvelope?.clientRequestId,startTime=Date.parse(saved?.draft?.startTime||''),locked=saved?.draft?.sqlLocked===true;const valid=saved?.schema===WORKOUT_DRAFT_SCHEMA&&saved.userId===currentUser?.userId&&saved.provider===dashboardProviderNamespace()&&Number(saved.savedAt)>0&&Date.now()<=Number(saved.expiresAt)&&Number.isFinite(startTime)&&startTime<=Date.now()&&(!locked||/^[0-9a-f-]{36}$/i.test(String(requestId||'')))&&Array.isArray(saved.draft?.exercises)&&saved.draft.exercises.length<=50&&saved.draft.exercises.reduce((n,item)=>n+(Array.isArray(item.sets)?item.sets.length:201),0)<=200;if(!valid){discardStoredWorkoutDraft(key);return false;}for(const exercise of saved.draft.exercises){if(!exercise.exerciseId||!Array.isArray(exercise.sets)||exercise.sets.some(set=>!validWorkoutSet(Number(set.weight),Number(set.reps)))){discardStoredWorkoutDraft(key);return false;}}
  if(saved.draft.sqlEnvelope?.clientRequestId){try{const status=await apiService.getTrainingWriteStatus(saved.draft.sqlEnvelope.clientRequestId);if(status?.exists){discardStoredWorkoutDraft(key);toast('先前的訓練已確認儲存。');refreshInBackground('workout-draft-reconciled',()=>refreshAfterRecordMutation('training'));return false;}}catch{/* Keep the exact envelope locked until the user retries. */}}
  workoutSession={startTime:saved.draft.startTime,exercises:saved.draft.exercises,sqlLocked:saved.draft.sqlLocked===true,sqlEnvelope:saved.draft.sqlEnvelope||undefined};await buildExerciseSelect();document.getElementById('workout-date').value=/^\d{4}-\d{2}-\d{2}$/.test(saved.date)?saved.date:getLocalDateString();document.getElementById('workout-date').max=getLocalDateString();document.getElementById('exercise-session-list').replaceChildren();for(const exercise of workoutSession.exercises)createExerciseBlock(exercise);if(!workoutSession.exercises.length)document.getElementById('exercise-session-list').innerHTML='<div class="empty-state" id="workout-empty-state">請先選擇動作，再按「新增動作」。</div>';localTrainingDraftLock(workoutSession.sqlLocked);setTrainingView('overview');return true;
}
function setTrainingView(next) {
  if (!['overview','workout_session','loading','empty','error'].includes(next)) throw Error('INVALID_TRAINING_VIEW');
  if (next === 'workout_session' && !workoutSession) next = 'overview';
  setTrainingView.current = next;
  const screen = document.getElementById('training-screen');
  const overview = document.getElementById('training-overview');
  const session = document.getElementById('workout-session');
  screen.dataset.trainingView = next;
  overview.hidden = next === 'workout_session';
  overview.style.display = overview.hidden ? 'none' : 'block';
  session.hidden = next !== 'workout_session';
  session.classList[next === 'workout_session' ? 'add' : 'remove']('active');
  const notice = document.getElementById('training-draft-notice');
  if (notice) notice.hidden = !workoutSession || next === 'workout_session';
}

function beginWorkoutDraft() {
  clearWorkoutDraft();
  if(typeof setWorkoutSaveState==='function')setWorkoutSaveState(document.getElementById('finish-workout'),'IDLE',{session:null});
  workoutSession = {startTime:new Date().toISOString(), exercises:[]};
  const input = document.getElementById('workout-date');
  input.value = getLocalDateString(); input.max = getLocalDateString();
  document.getElementById('exercise-session-list').innerHTML = '<div class="empty-state" id="workout-empty-state">請先選擇動作，再按「新增動作」。</div>';
  setTrainingView('workout_session');
  persistWorkoutDraft();
  if (!exerciseDatabase.length) void buildExerciseSelect().catch(error => toast(readableError(error)));
}

function requestWorkoutStart() {
  if (workoutSession?.saving) return toast('訓練正在儲存，請稍候。');
  if (workoutSession?.sqlLocked) return toast('上一筆 SQL 寫入尚待確認，請先重試完成訓練。');
  if (workoutSession) return document.getElementById('training-draft-dialog').showModal();
  beginWorkoutDraft();
}

function validWorkoutSet(weight, reps) {
  return typeof weight === 'number' && Number.isFinite(weight) && weight >= 0 && weight <= 1000
    && typeof reps === 'number' && Number.isSafeInteger(reps) && reps >= 1 && reps <= 10000;
}

function detailReadState(screen, state, message = '') {
  const target = document.getElementById(screen);
  if (!target) return;
  target.dataset.readState = state;
  let notice = document.getElementById(screen + '-read-state');
  if (!notice) { notice = document.createElement('div'); notice.id = screen + '-read-state'; target.prepend(notice); }
  notice.className = state === 'error' || state === 'stale' ? 'error-state' : 'record-date-note';
  notice.setAttribute('role', state === 'error' ? 'alert' : 'status');
  notice.replaceChildren();
  const labels = {loading:'數據載入中，請稍候…',updating:'數據更新中，請稍候…',empty:'目前尚無資料。',success:'所選期間資料已更新。',stale:'顯示上次資料；本次更新未完成。',error:'資料暫時無法更新。'};
  const text = document.createElement('p'); text.textContent = (labels[state] || '') + (message ? ' ' + message : ''); notice.append(text);
  if (state === 'error' || state === 'stale') {
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'secondary-button'; retry.textContent = '重新整理';
    retry.onclick = () => (screen === 'metric-detail-screen'
      ? loadRange(globalDateRange,{force:true})
      : screen === 'report-screen'
        ? loadReportScreen()
        : ensureScreenData(screen,{force:true})).catch(handleScreenError); notice.append(retry);
  }
  // A failed first read must not leave an infinite skeleton under the inline error.
  if (state === 'error') target.querySelectorAll('.skeleton').forEach(node => {node.className='chart-empty';node.textContent='資料尚未載入';});
}

async function loadReportScreen() {
  detailReadState('report-screen','loading');
  try {
    const rendered=await renderReport();
    if(rendered===true)detailReadState('report-screen','success');
    return rendered;
  } catch(error) {
    detailReadState('report-screen','error',readableError(error));
    throw error;
  }
}

function quickAddCapabilities({sql=manualSqlEnabled(),training=!sql||Boolean(LOCAL_EXERCISE_ENABLED)}={}) {
  return Object.freeze({
    weight:true,
    workout:training,
    meal:true,
    sleep:sql,
    activitypair:sql,
    checkin:!sql,
  });
}

function syncQuickAddCapabilities() {
  const capabilities=quickAddCapabilities();
  let unavailable=0;
  document.querySelectorAll('[data-quick-capability]').forEach(button=>{
    const available=capabilities[button.dataset.quickCapability]===true,label=button.querySelector('b')?.textContent?.trim()||'快速新增';
    button.disabled=!available;
    button.dataset.availability=available?'available':'unavailable';
    button.setAttribute('aria-disabled',String(!available));
    button.setAttribute('aria-label',available?label:`${label}（目前資料模式尚未啟用）`);
    button.title=available?'':'目前資料模式尚未啟用';
    if(!available)unavailable+=1;
  });
  const startWorkout=document.getElementById('start-workout');
  if(startWorkout){startWorkout.disabled=!capabilities.workout;startWorkout.title=capabilities.workout?'':'目前資料模式尚未啟用訓練寫入';}
  const subtitle=document.querySelector('#quick-sheet .sheet-sub');
  if(subtitle)subtitle.textContent=unavailable?'可用項目可直接新增；灰色項目尚未在目前資料模式開放。':'補上一筆紀錄，讓健康趨勢更完整。';
  return capabilities;
}

function recordsPreferenceKey() { return `healthRecordsView:v1:${dashboardProviderNamespace()}:${currentUser?.userId || 'anonymous'}`; }
function recordsViewFromUrl() { const value=new URLSearchParams(location.search).get('type'); return ['nutrition','training'].includes(value)?value:null; }
function selectedRecordsView() { const urlView=recordsViewFromUrl();if(urlView)return urlView;try { return localStorage.getItem(recordsPreferenceKey()) === 'training' ? 'training' : 'nutrition'; } catch { return 'nutrition'; } }
function selectRecordsView(view) {
  if (!['nutrition','training'].includes(view)) throw Error('INVALID_RECORD_VIEW');
  try { localStorage.setItem(recordsPreferenceKey(),view); } catch { /* Optional preference, never a persistence fallback. */ }
  const url=new URL(location.href);url.searchParams.set('type',view);history.replaceState({...history.state,healthScreen:view+'-screen'},'',url);
  navigate(view + '-screen');
  requestAnimationFrame(()=>document.querySelector(`#${view}-screen [data-record-view]`)?.focus());
}
function syncRecordsControls() {
  document.querySelectorAll('[data-record-view]').forEach(select => {select.value=activeScreen==='training-screen'?'training':'nutrition';});
  document.querySelectorAll('[data-record-range]').forEach(select => {select.value=globalDateRange.preset;});
}
function focusScreenDestination(screen) {
  const target=document.getElementById(screen),focusTarget=target&&document.getElementById('page-header-title');
  if(!focusTarget)return;
  if(!focusTarget.hasAttribute('tabindex'))focusTarget.setAttribute('tabindex','-1');
  focusTarget.focus({preventScroll:true});
}

function restoreInitialViewRoute() {
  const params=new URLSearchParams(location.search),initialMetric=params.get('metric');
  if(initialMetric&&METRIC_DETAIL_REGISTRY[initialMetric]){
    activeMetricDetail=initialMetric;
    history.replaceState({...history.state,healthScreen:'metric-detail-screen',metric:initialMetric,metricEntry:'direct'},'',location.href);
    navigate('metric-detail-screen',{load:false});
    requestAnimationFrame(()=>document.getElementById('metric-detail-title')?.focus());
    return;
  }
  const recordsView=recordsViewFromUrl();
  if(recordsView){
    history.replaceState({...history.state,healthScreen:recordsView+'-screen'},'',location.href);
    navigate(recordsView+'-screen',{load:Boolean(currentUser&&sessionToken)});
    requestAnimationFrame(()=>document.querySelector(`#${recordsView}-screen [data-record-view]`)?.focus());
  }
}

function openDashboardCard(card) {
  const target=card.dataset.target;
  if(target==='metric-detail-screen'){
    const metric=card.dataset.metric;
    if(!METRIC_DETAIL_REGISTRY[metric])throw Error('UNKNOWN_METRIC_DETAIL');
    metricDetailOpener=card;
    activeMetricDetail=metric;
    // Anchor the current entry to the actual origin screen before adding the
    // detail entry. Earlier Records navigation may have replaced history state
    // even after the UI returned to Dashboard.
    history.replaceState({...history.state,healthScreen:activeScreen},'',location.href);
    const url=new URL(location.href);url.searchParams.set('metric',metric);
    history.pushState({...history.state,healthScreen:'metric-detail-screen',metric,metricEntry:'pushed'},'',url);
    navigate(target);
    requestAnimationFrame(()=>document.getElementById('metric-detail-title')?.focus());
    return;
  }
  if (target === 'body-screen') document.getElementById('body-metric-select').value=card.dataset.metric || 'weight';
  navigate(target);
  if (target === 'body-screen') renderBody();
  if (target === 'training-screen') setTrainingView('overview');
  if (target === 'health-score-screen') renderHealthScoreDetail(card.dataset.metric);
  requestAnimationFrame(()=>focusScreenDestination(target));
}
function renderHealthScoreDetail(metric) {
  const today=appState.dashboard?.today || {}, target=document.getElementById('health-score-detail-content');
  const rows=[['健康分數','healthScore'],['睡眠','sleepSystemScore'],['恢復','recoveryScore'],['疲勞','fatigueIndex'],['活動','activityScore'],['訓練','trainingScore'],['營養','nutritionScore']];
  target.replaceChildren();
  const note=document.createElement('p'); note.textContent=`演算法：${today.algorithmVersion || 'health-score-v1.0'}。未提供的分數以「資料不足／未提供」顯示，不視為健康差。`;target.append(note);
  for(const [label,key] of rows){const row=document.createElement('p');const value=num(today[key]);row.textContent=`${label}：${value===null?'資料不足／未提供':value}`;if(metric===key)row.setAttribute('aria-current','true');target.append(row);}
  const explanation=document.createElement('p');explanation.textContent=document.getElementById('score-explanation').textContent;target.append(explanation);
}

function initializeViewContracts() {
  // Deferred features remain visibly unavailable in SQL-first, not legacy writes.
  const legacyReport=renderReport,legacyCheckin=openCheckinEditor;
  syncQuickAddCapabilities();
  renderReport=async function(){
    if(!manualSqlEnabled())return legacyReport();
    detailReadState('report-screen','empty','週報尚未啟用；請使用總覽與紀錄查看已保存的 SQL 資料。');
    ['report-score','report-weight','report-training','report-sleep'].forEach(id=>setValue(id,'—'));
    setValue('report-period','週報尚未啟用');setValue('report-coach-copy','未產生週報分析。');
    ['report-weight-chart','report-training-chart'].forEach(id=>{const el=document.getElementById(id);if(el)el.replaceChildren();});
  };
  openCheckinEditor=async function(date){
    if(!manualSqlEnabled())return legacyCheckin(date);
    resetCheckinForm(date);openSheet('checkin-form');
    setValue('checkin-date-note','身體狀態紀錄尚未啟用；本模式不會寫入舊資料來源。');
    document.getElementById('checkin-form').querySelectorAll('input,textarea,button').forEach(el=>{el.disabled=true;});
  };
  setTrainingView('overview');
  const dialog=document.getElementById('training-draft-dialog');
  document.getElementById('resume-workout').onclick=()=>setTrainingView('workout_session');
  document.getElementById('draft-continue').onclick=()=>{dialog.close();setTrainingView('workout_session');};
  document.getElementById('draft-cancel').onclick=()=>dialog.close();
  document.getElementById('draft-discard').onclick=()=>{if(workoutSession?.sqlLocked||workoutSession?.saving)return; if(!window.confirm('確定捨棄尚未儲存的訓練草稿並開始新訓練？'))return;clearWorkoutDraft();dialog.close();beginWorkoutDraft();};
  document.getElementById('weight-load-retry').onclick=()=>loadWeightFormDate(document.getElementById('weight-date').value);
  for(const section of ['nutrition','training']) {
    const bar=document.createElement('div');bar.className='records-toolbar';
    bar.innerHTML=`<label>紀錄類型<select class="select-input" data-record-view aria-label="紀錄類型"><option value="nutrition">飲食紀錄</option><option value="training">訓練紀錄</option></select></label><label>日期範圍<select class="select-input" data-record-range aria-label="紀錄日期範圍"><option value="7d">近7天</option><option value="30d">近30天</option><option value="90d">近90天</option><option value="custom">自訂</option></select></label>`;
    document.getElementById(section==='training'?'training-overview':'nutrition-screen').prepend(bar);
    bar.querySelector('[data-record-view]').onchange=event=>selectRecordsView(event.target.value);
    bar.querySelector('[data-record-range]').onchange=event=>event.target.value==='custom'?openDateRangeDialog():applyGlobalDateRange({preset:event.target.value,startDate:'',endDate:''});
  }
  document.querySelectorAll('.kpi-card[data-target],.score-domain[data-target]').forEach(card=>{
    card.setAttribute('role','button');card.tabIndex=0;card.setAttribute('aria-label',`${card.querySelector('span')?.textContent || '健康分數'}詳細資料`);
    card.onclick=()=>openDashboardCard(card);
    card.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openDashboardCard(card);}};
  });
  document.getElementById('metric-detail-back').onclick=()=>{
    if(history.state?.healthScreen==='metric-detail-screen'&&history.state?.metricEntry==='pushed')history.back();
    else {const url=new URL(location.href);url.searchParams.delete('metric');history.replaceState({...history.state,healthScreen:'dashboard-screen'},'',url);navigate('dashboard-screen');requestAnimationFrame(()=>metricDetailOpener?.isConnected?metricDetailOpener.focus():focusScreenDestination('dashboard-screen'));}
  };
  document.querySelectorAll('[data-metric-range]').forEach(button=>button.onclick=()=>applyGlobalDateRange({preset:button.dataset.metricRange,startDate:'',endDate:''}));
  syncRecordsControls();
}
