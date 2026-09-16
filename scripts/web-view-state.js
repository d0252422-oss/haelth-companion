// UI state only. All data continues through the existing provider and verified session.
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
  workoutSession = {startTime:new Date().toISOString(), exercises:[]};
  const input = document.getElementById('workout-date');
  input.value = getLocalDateString(); input.max = getLocalDateString();
  document.getElementById('exercise-session-list').innerHTML = '<div class="empty-state" id="workout-empty-state">請先選擇動作，再按「新增動作」。</div>';
  setTrainingView('workout_session');
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
  const labels = {loading:'正在載入所選期間；下方若有舊資料，尚未更新。',empty:'所選期間尚無紀錄。',success:'所選期間資料已更新。',stale:'顯示上次資料；本次更新未完成。',error:'資料載入失敗。'};
  const text = document.createElement('p'); text.textContent = (labels[state] || '') + (message ? ' ' + message : ''); notice.append(text);
  if (state === 'error' || state === 'stale') {
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'secondary-button'; retry.textContent = '重試載入';
    retry.onclick = () => ensureScreenData(screen,{force:true}).catch(handleScreenError); notice.append(retry);
  }
  // A failed first read must not leave an infinite skeleton under the inline error.
  if (state === 'error') target.querySelectorAll('.skeleton').forEach(node => {node.className='chart-empty';node.textContent='資料尚未載入';});
}

function recordsPreferenceKey() { return `healthRecordsView:v1:${dashboardProviderNamespace()}:${currentUser?.userId || 'anonymous'}`; }
function selectedRecordsView() { try { return localStorage.getItem(recordsPreferenceKey()) === 'training' ? 'training' : 'nutrition'; } catch { return 'nutrition'; } }
function selectRecordsView(view) {
  if (!['nutrition','training'].includes(view)) throw Error('INVALID_RECORD_VIEW');
  try { localStorage.setItem(recordsPreferenceKey(),view); } catch { /* Optional preference, never a persistence fallback. */ }
  navigate(view + '-screen');
}
function syncRecordsControls() {
  document.querySelectorAll('[data-record-view]').forEach(select => {select.value=activeScreen==='training-screen'?'training':'nutrition';});
  document.querySelectorAll('[data-record-range]').forEach(select => {select.value=globalDateRange.preset;});
}

function openDashboardCard(card) {
  const target=card.dataset.target;
  if (target === 'body-screen') document.getElementById('body-metric-select').value=card.dataset.metric || 'weight';
  navigate(target);
  if (target === 'body-screen') renderBody();
  if (target === 'training-screen') setTrainingView('overview');
  if (target === 'health-score-screen') renderHealthScoreDetail(card.dataset.metric);
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
  document.getElementById('draft-discard').onclick=()=>{if(workoutSession?.sqlLocked||workoutSession?.saving)return; if(!window.confirm('確定捨棄尚未儲存的訓練草稿並開始新訓練？'))return;dialog.close();beginWorkoutDraft();};
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
  syncRecordsControls();
}
