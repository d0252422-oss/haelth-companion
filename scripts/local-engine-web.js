/* Existing Web App extension: inert unless explicit loopback-only configuration is supplied. */
const localBodyRecords=new Map(),localMealRecords=new Map(),localPendingBodyWrites=new Map();
let localSessionEpoch=0,localOutputRequest=0;
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
function clearLocalManualState(){localSessionEpoch++;localOutputRequest++;localBodyRecords.clear();localMealRecords.clear();localPendingBodyWrites.clear();}
function localManualBodyNotice(){
  if(!LOCAL_ENGINE_ENABLED)return;
  const note=document.getElementById('body-current-note');
  if(note&&(appState.body||[]).some(r=>r.analysisStatus==='ANALYSIS_PENDING')){
    note.dataset.analysisStatus='ANALYSIS_PENDING';note.textContent+=' · 已保存 SQL／分析待接通';
  }else if(note)delete note.dataset.analysisStatus;
}
async function localEngineRequest(action,payload={}){
  if(!LOCAL_ENGINE_ENABLED)throw Error('LOCAL_ENGINE_DISABLED');
  if(action==='logout'){clearLocalManualState();await fetch('/local-logout',{method:'POST'});return {};}
  const epoch=localSessionEpoch;
  const bodyMutation=['addBodyRecord','upsertBodyRecord','deleteBodyRecord'].includes(action);
  let pendingKey;
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
    if(bodyMutation&&epoch===localSessionEpoch){
      try{const status=await localEngineRequest('getBodyWriteStatus',{clientRequestId:payload.clientRequestId});if(status.exists)body={ok:true,data:{...status,recovered:true}};}catch{ /* keep the original stable envelope for an explicit retry */ }
    }
    if(!body)throw error;
  }
  if(epoch!==localSessionEpoch){const error=Error('IDENTITY_CHANGED');error.code='IDENTITY_CHANGED';throw error;}
  if(!body.ok){if(pendingKey&&!body.retryable)localPendingBodyWrites.delete(pendingKey);const error=Error(body.error);error.code=body.error;error.retryable=body.retryable===true;throw error;}
  if(bodyMutation){localPendingBodyWrites.delete(pendingKey);cacheLocalRevision(localBodyRecords,body.data.recordId,{...body.data.record,deleted:body.data.deleted===true});}
  if(['upsertMealRecord','deleteMealRecord'].includes(action)&&body.data.record)cacheLocalRevision(localMealRecords,body.data.recordId||body.data.record.mealRecordId,{...body.data.record,deleted:action==='deleteMealRecord'});
  if(action==='getBodyRecords')for(const record of body.data)cacheLocalRevision(localBodyRecords,record.recordId,record);
  if(action==='getNutritionRecords')for(const record of body.data)cacheLocalRevision(localMealRecords,record.mealRecordId,record);
  if(['upsertMealRecord','deleteMealRecord','refreshDailyNutrition'].includes(action)||(action==='refreshDerivedData'&&payload.recordType!=='body'))queueMicrotask(refreshLocalEngineOutputs);
  return body.data;
}
function showLocalEngineLogin(){
  let overlay=document.getElementById('local-engine-login');if(!overlay){overlay=document.createElement('div');overlay.id='local-engine-login';overlay.style.cssText='position:fixed;inset:0;z-index:220;background:white;color:#111;display:grid;place-content:center;gap:15px';
    overlay.innerHTML='<h1>健康陪跑 · 本機驗收</h1><p>僅合成帳號；不是 Google/OAuth 登入。</p><button id="local-login-a">登入測試 A</button><button id="local-login-b">登入測試 B</button><p id="local-login-error"></p>';document.body.appendChild(overlay);
    for(const account of ['A','B'])document.getElementById('local-login-'+account.toLowerCase()).onclick=async()=>{try{await fetch('/local-login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account})});if(await initializeLocalEngineSession())await boot();}catch(error){document.getElementById('local-login-error').textContent=error.message;}};
  }overlay.style.display='grid';
}
async function initializeLocalEngineSession(){
  clearLocalManualState();
  clearPersonalState();
  document.getElementById('local-engine-output')?.remove();
  document.getElementById('health-connector-panel').style.display='none';
  document.getElementById('technical-api-status').previousElementSibling.textContent='Local PostgreSQL / Deno';
  document.getElementById('chatgpt-meal-box').style.display='none';
  try{const result=await localEngineRequest('getCurrentUser');applyAuthenticatedUser(result);sessionToken='LOCAL_HTTP_ONLY_COOKIE';document.getElementById('local-engine-login')?.remove();await refreshLocalEngineOutputs();return true;}
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
