/* Existing Web App extension: inert unless explicit loopback-only configuration is supplied. */
const localBodyRecords=new Map(),localMealRecords=new Map(),localPendingBodyWrites=new Map();
const localWorkoutRecords=new Map(),localPendingTrainingWrites=new Map();
let localSessionEpoch=0,localOutputRequest=0;
let localCatalogReadSequence=0;
const localSectionReads=new Map();
function cacheLocalRevision(cache,id,record){
  if(!id||!record||!Number.isSafeInteger(Number(record.revision)))return;
  const previous=cache.get(id),revision=Number(record.revision);
  if(previous&&(Number(previous.revision)>revision||(previous.deleted&&Number(previous.revision)>=revision)))return;
  cache.set(id,record);
}
function localManualTotal(records,key){
  return !records.length||records.some(record=>record[key]===null||record[key]===undefined||record[key]===''||!Number.isFinite(Number(record[key])))?null:records.reduce((total,record)=>total+Number(record[key]),0);
}
function localSectionReadGuard(section,start,end){
  const user=currentUser,epoch=localSessionEpoch,serial=(localSectionReads.get(section)||0)+1;
  localSectionReads.set(section,serial);
  return ()=>currentUser===user&&localSessionEpoch===epoch&&localSectionReads.get(section)===serial&&sectionWindows[section].start===start&&sectionWindows[section].end===end;
}
function clearLocalManualState(){localSessionEpoch++;localOutputRequest++;localCatalogReadSequence++;localBodyRecords.clear();localMealRecords.clear();localPendingBodyWrites.clear();localWorkoutRecords.clear();localPendingTrainingWrites.clear();localTrainingDraftLock(false);if(typeof exerciseDatabase!=='undefined')exerciseDatabase=[];if(typeof workoutSession!=='undefined')workoutSession=null;document.getElementById('exercise-management')?.remove();const overview=document.getElementById('training-overview'),draft=document.getElementById('workout-session'),list=document.getElementById('exercise-session-list');if(overview?.style)overview.style.display='block';draft?.classList?.remove('active');list?.replaceChildren?.();}
function localManualBodyNotice(){
  if(!LOCAL_ENGINE_ENABLED)return;
  const note=document.getElementById('body-current-note');
  if(note&&(appState.body||[]).some(r=>r.analysisStatus==='ANALYSIS_PENDING')){
    note.dataset.analysisStatus='ANALYSIS_PENDING';note.textContent+=' · 僅儲存 SQL 紀錄，分析尚未啟用（沒有排程工作）';
  }else if(note)delete note.dataset.analysisStatus;
}
async function localEngineRequest(action,payload={}){
  if(!LOCAL_ENGINE_ENABLED)throw Error('LOCAL_ENGINE_DISABLED');
  if(action==='logout'){clearLocalManualState();await fetch('/local-logout',{method:'POST'});return {};}
  const epoch=localSessionEpoch;
  const catalogSequence=action==='getExerciseDatabase'?++localCatalogReadSequence:0;
  if(action==='manageExercise')localCatalogReadSequence++;
  const bodyMutation=['addBodyRecord','upsertBodyRecord','deleteBodyRecord'].includes(action);
  const trainingMutation=['manageExercise','addWorkoutRecord','updateWorkoutSet','deleteWorkoutSet'].includes(action);
  let pendingKey;
  let trainingKey;
  if(trainingMutation){
    if(action==='addWorkoutRecord'&&workoutSession?.sqlEnvelope)payload=workoutSession.sqlEnvelope;
    const keyInput=action==='addWorkoutRecord'?{date:payload.date,startTime:payload.startTime,exercises:payload.exercises}:payload;
    trainingKey=action+'|'+JSON.stringify(keyInput);
    let pending=localPendingTrainingWrites.get(trainingKey);
    if(!pending){const previous=localWorkoutRecords.get(payload.recordId)||(appState.workouts||[]).find(r=>r.recordId===payload.recordId);pending=structuredClone({...payload,revision:payload.revision??previous?.revision,clientRequestId:payload.clientRequestId||crypto.randomUUID()});localPendingTrainingWrites.set(trainingKey,pending);}
    payload=pending;
    if(action==='addWorkoutRecord'&&workoutSession){workoutSession.sqlEnvelope=pending;localTrainingDraftLock(true);}
  }
  if(bodyMutation){
    pendingKey=action+'|'+JSON.stringify(payload);
    let pending=localPendingBodyWrites.get(pendingKey);
    if(!pending){const previous=localBodyRecords.get(payload.recordId);pending={...payload,revision:payload.revision??previous?.revision,clientRequestId:payload.clientRequestId||crypto.randomUUID()};localPendingBodyWrites.set(pendingKey,pending);}
    payload=pending;
  }
  if(['upsertMealRecord','deleteMealRecord'].includes(action)){
    const id=payload.mealRecordId;const previous=localMealRecords.get(id)||(appState.nutrition||[]).find(m=>m.mealRecordId===id)||(appState.mealsToday||[]).find(m=>m.mealRecordId===id);
    payload={...payload,revision:payload.revision??previous?.revision,clientRequestId:payload.clientRequestId||crypto.randomUUID()};
    if(action==='upsertMealRecord')payload={...payload,labelMode:document.getElementById('meal-label-mode').checked,weightGrams:document.getElementById('meal-weight-grams').value,referenceSource:document.getElementById('meal-reference-source').value};
  }
  let body;
  try{
    const response=await fetch('/v1/engine/web',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,payload}),signal:AbortSignal.timeout(30000)});
    try{body=await response.json();}catch{const error=Error('MALFORMED_RESPONSE');error.code='MALFORMED_RESPONSE';throw error;}
  }catch(error){
    if(error.name==='TimeoutError'||error.name==='AbortError')error.code='REQUEST_TIMEOUT';
    if((bodyMutation||trainingMutation)&&epoch===localSessionEpoch){
      try{const status=await localEngineRequest(trainingMutation?'getTrainingWriteStatus':'getBodyWriteStatus',{clientRequestId:payload.clientRequestId});if(status.exists)body={ok:true,data:{...status,recovered:true}};}catch{ /* keep the original stable envelope for an explicit retry */ }
    }
    if(!body)throw error;
  }
  if(epoch!==localSessionEpoch){const error=Error('IDENTITY_CHANGED');error.code='IDENTITY_CHANGED';throw error;}
  if(catalogSequence&&catalogSequence!==localCatalogReadSequence){const error=Error('STALE_CATALOG_RESPONSE');error.code='STALE_CATALOG_RESPONSE';throw error;}
  if(!body.ok){if(pendingKey&&!body.retryable)localPendingBodyWrites.delete(pendingKey);if(trainingKey&&!body.retryable){localPendingTrainingWrites.delete(trainingKey);if(action==='addWorkoutRecord')localTrainingDraftLock(false);}const error=Error(body.error);error.code=body.error;error.retryable=body.retryable===true;throw error;}
  if(trainingMutation){localPendingTrainingWrites.delete(trainingKey);if(action==='addWorkoutRecord')localTrainingDraftLock(false);if(body.data.record)cacheLocalRevision(localWorkoutRecords,body.data.recordId,{...body.data.record,deleted:body.data.deleted===true});for(const record of body.data.records||[])cacheLocalRevision(localWorkoutRecords,record.recordId,record);}
  if(action==='getWorkoutRecords')for(const record of body.data.records||[])cacheLocalRevision(localWorkoutRecords,record.recordId,record);
  if(bodyMutation){localPendingBodyWrites.delete(pendingKey);cacheLocalRevision(localBodyRecords,body.data.recordId,{...body.data.record,deleted:body.data.deleted===true});}
  if(['upsertMealRecord','deleteMealRecord'].includes(action)&&body.data.record)cacheLocalRevision(localMealRecords,body.data.recordId||body.data.record.mealRecordId,{...body.data.record,deleted:action==='deleteMealRecord'});
  if(action==='getBodyRecords')for(const record of body.data)cacheLocalRevision(localBodyRecords,record.recordId,record);
  if(action==='getNutritionRecords')for(const record of body.data)cacheLocalRevision(localMealRecords,record.mealRecordId,record);
  if(['upsertMealRecord','deleteMealRecord','refreshDailyNutrition'].includes(action)||(action==='refreshDerivedData'&&payload.recordType!=='body'))queueMicrotask(refreshLocalEngineOutputs);
  return body.data;
}
function showLocalEngineLogin(){
  let overlay=document.getElementById('local-engine-login');if(!overlay){overlay=document.createElement('div');overlay.id='local-engine-login';overlay.style.cssText='position:fixed;inset:0;z-index:220;background:white;color:#111;display:grid;place-content:center;gap:15px';
    overlay.innerHTML='<h1>健康陪跑 · 本機驗收</h1><p>僅合成帳號；不是 Google/OAuth 登入。</p><button id="local-login-a">登入測試 A</button><button id="local-login-b">登入測試 B</button><button id="local-login-web_a">登入 Web-session 測試 A</button><button id="local-login-web_b">登入 Web-session 測試 B</button><p id="local-login-error"></p>';document.body.appendChild(overlay);
    for(const account of ['A','B','WEB_A','WEB_B']){const button=document.getElementById('local-login-'+account.toLowerCase());if(account.startsWith('WEB_')&&window.HEALTH_ENGINE_LOCAL_CONFIG?.webSession!==true){button.hidden=true;continue;}button.onclick=async()=>{try{const response=await fetch('/local-login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:account.replace('WEB_',''),...(account.startsWith('WEB_')?{kind:'web'}:{})})});if(!response.ok)throw Error('LOCAL_TEST_LOGIN_REJECTED');if(await initializeLocalEngineSession())await boot();}catch(error){document.getElementById('local-login-error').textContent=error.message;}};}
  }overlay.style.display='grid';
}
async function initializeLocalEngineSession(){
  clearLocalManualState();
  clearPersonalState();
  document.getElementById('local-engine-output')?.remove();
  document.getElementById('health-connector-panel').style.display='none';
  document.getElementById('technical-api-status').previousElementSibling.textContent='Local PostgreSQL / Deno';
  document.getElementById('chatgpt-meal-box').style.display='none';
  try{const result=await localEngineRequest('getCurrentUser');applyAuthenticatedUser(result);sessionToken='LOCAL_HTTP_ONLY_COOKIE';document.getElementById('local-engine-login')?.remove();if(typeof LOCAL_EXERCISE_ENABLED!=='undefined'&&LOCAL_EXERCISE_ENABLED)setupLocalExerciseManagement();await refreshLocalEngineOutputs();return true;}
  catch{showLocalEngineLogin();return false;}
}
function setupLocalMealFields(record){
  if(!LOCAL_ENGINE_ENABLED)return;
  document.getElementById('chatgpt-meal-box').style.display='none';
  if(!document.getElementById('meal-label-mode')){
    const field=document.createElement('fieldset');field.innerHTML='<legend>本機 experimental：確認標示與份量</legend><label><input id="meal-label-mode" type="checkbox"> 下方營養值為每 100 g 標示（不是此餐總量）</label><label for="meal-weight-grams">實際可食重量 g</label><input id="meal-weight-grams" type="number" min="0" class="form-input"><label for="meal-reference-source">標示來源／版本</label><input id="meal-reference-source" class="form-input"><p>請使用已含烹調油的最終食品標示；系統不會額外加油。照片辨識未實作。</p>';
    document.getElementById('meal-form').prepend(field);
  }
  document.getElementById('meal-label-mode').checked=Boolean(record?.labelMode);
  document.getElementById('meal-weight-grams').value=record?.weightGrams||'';
  document.getElementById('meal-reference-source').value=record?.referenceSource||'';
  if(record?.labelValues)for(const key of ['calories','protein','carbs','fat'])document.getElementById('meal-'+key).value=record.labelValues[key]??'';
}
async function refreshLocalEngineOutputs(){
  if(!LOCAL_ENGINE_ENABLED||!currentUser)return;
  const requestedUser=currentUser;
  const requestNumber=++localOutputRequest;
  const windowRange=typeof sectionWindows!=='undefined'?sectionWindows.nutrition:null;
  const bounds=windowRange?{startDate:windowRange.start,endDate:windowRange.end}:{};
  let panel=document.getElementById('local-engine-output');if(!panel){panel=document.createElement('section');panel.id='local-engine-output';panel.className='card';document.getElementById('meal-list').before(panel);}
  panel.dataset.state='loading';
  try{
    const snapshot=await localEngineRequest('localEngineSnapshot',bounds);
    if(currentUser!==requestedUser)return;
    if(requestNumber!==localOutputRequest)return;
    if(windowRange&&(sectionWindows.nutrition.start!==bounds.startDate||sectionWindows.nutrition.end!==bounds.endDate))return;
    for(const record of snapshot.meals)cacheLocalRevision(localMealRecords,record.mealRecordId,record);
    const currentDay=getLocalDateString();
    appState.nutrition=snapshot.meals;
    if(!windowRange||(bounds.startDate<=currentDay&&currentDay<=bounds.endDate))appState.mealsToday=snapshot.meals.filter(m=>m.date===currentDay);
    renderNutrition();
    panel.replaceChildren();const title=document.createElement('h3');title.textContent='Experimental / UNVALIDATED · 非臨床驗證';panel.append(title);
    for(const result of snapshot.outputs.filter(r=>r.calculation_date===getLocalDateString())){
      const row=document.createElement('p');row.dataset.domain=result.domain;row.dataset.score=result.score===null?'null':String(result.score);row.dataset.status=result.score_status;row.dataset.version=result.engine_version;
      row.textContent=localEngineOutputText(result);panel.append(row);
    }panel.dataset.state='ready';
  }catch(error){if(currentUser!==requestedUser)return;if(requestNumber!==localOutputRequest)return;panel.textContent='Engine 載入失敗：'+error.message;panel.dataset.state='error';const retry=document.createElement('button');retry.textContent='重試 Engine';retry.onclick=refreshLocalEngineOutputs;panel.append(retry);}
}
function localEngineOutputText(result){
  return `${result.domain}: ${result.score===null?'— 資料不足':result.score} · ${result.score_status} · 完整度 ${Math.round(result.data_completeness*100)}% · ${result.engine_version}`;
}

// Management is inside the original training page; no second dashboard or catalog.
function setupLocalExerciseManagement(){
  if(!LOCAL_EXERCISE_ENABLED)return;
  document.getElementById('exercise-management')?.remove();
  const panel=document.createElement('section');panel.id='exercise-management';panel.className='card card-pad';
  panel.innerHTML='<button id="manage-exercises" type="button" class="secondary-button">管理我的動作</button><div id="exercise-manager" hidden><p>改名／個人別名不改歷史名稱與訓練量。封存可恢復；歷史紀錄仍可編修。SQL 手動訓練尚未接入分數分析。</p><p id="exercise-manager-status" role="status"></p><div id="exercise-manager-list"></div><button id="exercise-manager-retry" type="button">重新載入</button></div>';
  document.getElementById('training-overview').append(panel);
  const load=async()=>{
    const epoch=localSessionEpoch,status=document.getElementById('exercise-manager-status');status.textContent='載入中…';
    try{const entries=await apiService.getExerciseDatabase();if(epoch!==localSessionEpoch)return;exerciseDatabase=entries;renderLocalExerciseManager(entries);await buildExerciseSelect();status.textContent='SQL 已讀回';}
    catch(error){if(epoch===localSessionEpoch&&error.code!=='STALE_CATALOG_RESPONSE')status.textContent='讀取失敗：'+error.message;}
  };
  document.getElementById('manage-exercises').onclick=()=>{document.getElementById('exercise-manager').hidden=false;void load();};
  document.getElementById('exercise-manager-retry').onclick=load;
}
function renderLocalExerciseManager(entries){
  const list=document.getElementById('exercise-manager-list');list.replaceChildren();
  for(const exercise of entries){
    const row=document.createElement('article');row.dataset.exerciseId=exercise.exerciseId;row.style.marginBottom='16px';
    const label=document.createElement('label');label.textContent=(exercise.custom?'本人自訂動作':'共享動作的個人別名')+(exercise.archived?' · 已封存':'');
    const input=document.createElement('input');input.className='form-input exercise-manage-name';input.value=exercise.exerciseName;input.maxLength=80;input.setAttribute('aria-label','動作名稱');label.append(input);row.append(label);
    const status=document.createElement('p');status.className='exercise-manage-result';status.setAttribute('role','status');
    for(const [operation,title] of [['rename','儲存名稱'],[exercise.archived?'restore':'archive',exercise.archived?'恢復動作':'封存／從我的清單隱藏'],...(exercise.custom?[['delete','永久刪除（僅無引用）']]:[])]){
      const button=document.createElement('button');button.type='button';button.className='secondary-button';button.dataset.operation=operation;button.textContent=title;
      button.onclick=async()=>{
        const epoch=localSessionEpoch;
        if(button.disabled)return;
        if(operation==='delete'&&!confirm('永久刪除此自訂動作？只有沒有任何歷史引用的項目才能刪除；無法復原。'))return;
        const buttons=[...list.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);status.textContent='儲存中…';
        try{await localEngineRequest('manageExercise',{exerciseId:exercise.exerciseId,revision:exercise.revision,operation,...(operation==='rename'?{name:input.value}:{})});
          const entries=await apiService.getExerciseDatabase();if(epoch!==localSessionEpoch)return;exerciseDatabase=entries;renderLocalExerciseManager(exerciseDatabase);await buildExerciseSelect();if(epoch===localSessionEpoch)document.getElementById('exercise-manager-status').textContent='SQL 已儲存並讀回';}
        catch(error){if(epoch===localSessionEpoch&&error.code!=='STALE_CATALOG_RESPONSE')status.textContent=error.code==='EXERCISE_REFERENCED'?'有歷史引用，不能永久刪除；可以封存。':'未完成：'+error.message;}
        finally{buttons.forEach(b=>b.disabled=false);}
      };row.append(button);
    }row.append(status);list.append(row);
  }
}
function localTrainingDraftLock(locked){
  if(typeof workoutSession!=='undefined'&&workoutSession){workoutSession.sqlLocked=locked;if(!locked)delete workoutSession.sqlEnvelope;}
  document.querySelectorAll('#workout-session .complete-set,#workout-session .remove-draft-set,#add-exercise,#workout-session .exercise-weight,#workout-session .exercise-reps,#workout-date,#back-training,#start-workout').forEach(control=>control.disabled=locked);
}
function localTrainingDailyRows(records){
  const days=new Map(),sessions=new Map();
  for(const row of [...records].sort((a,b)=>a.date.localeCompare(b.date))){if(!row.date)continue;const day=days.get(row.date)||{date:row.date,trainingSets:0,trainingVolume:0,trainingDuration:0};day.trainingSets+=row.totalSets??1;day.trainingVolume+=row.totalVolume??0;days.set(row.date,day);const key=row.sessionId||row.recordId;const previous=sessions.get(key);sessions.set(key,{date:previous?.date||row.date,duration:Math.max(previous?.duration||0,row.durationMinutes||0)});}
  // A split session counts once, attributed to its earliest retained date in this range.
  for(const session of sessions.values())days.get(session.date).trainingDuration+=session.duration;
  return [...days.values()];
}
