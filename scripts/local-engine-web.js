/* Existing Web App extension: inert unless explicit loopback-only configuration is supplied. */
async function localEngineRequest(action,payload={}){
  if(!LOCAL_ENGINE_ENABLED)throw Error('LOCAL_ENGINE_DISABLED');
  if(action==='logout'){await fetch('/local-logout',{method:'POST'});return {};}
  if(['upsertMealRecord','deleteMealRecord'].includes(action)){
    const id=payload.mealRecordId;const previous=(appState.mealsToday||[]).find(m=>m.mealRecordId===id);
    payload={...payload,revision:previous?.revision,clientRequestId:payload.clientRequestId||crypto.randomUUID()};
    if(action==='upsertMealRecord')payload={...payload,labelMode:document.getElementById('meal-label-mode').checked,weightGrams:document.getElementById('meal-weight-grams').value,referenceSource:document.getElementById('meal-reference-source').value};
  }
  let body;
  try{
    const response=await fetch('/v1/engine/web',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,payload}),signal:AbortSignal.timeout(30000)});
    try{body=await response.json();}catch{const error=Error('MALFORMED_RESPONSE');error.code='MALFORMED_RESPONSE';throw error;}
  }catch(error){if(error.name==='TimeoutError'||error.name==='AbortError')error.code='REQUEST_TIMEOUT';throw error;}
  if(!body.ok){const error=Error(body.error);error.code=body.error;throw error;}
  if(['upsertMealRecord','deleteMealRecord','refreshDerivedData','refreshDailyNutrition'].includes(action))queueMicrotask(refreshLocalEngineOutputs);
  return body.data;
}
function showLocalEngineLogin(){
  let overlay=document.getElementById('local-engine-login');if(!overlay){overlay=document.createElement('div');overlay.id='local-engine-login';overlay.style.cssText='position:fixed;inset:0;z-index:220;background:white;color:#111;display:grid;place-content:center;gap:15px';
    overlay.innerHTML='<h1>健康陪跑 · 本機驗收</h1><p>僅合成帳號；不是 Google/OAuth 登入。</p><button id="local-login-a">登入測試 A</button><button id="local-login-b">登入測試 B</button><p id="local-login-error"></p>';document.body.appendChild(overlay);
    for(const account of ['A','B'])document.getElementById('local-login-'+account.toLowerCase()).onclick=async()=>{try{await fetch('/local-login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account})});if(await initializeLocalEngineSession())await boot();}catch(error){document.getElementById('local-login-error').textContent=error.message;}};
  }overlay.style.display='grid';
}
async function initializeLocalEngineSession(){
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
  let panel=document.getElementById('local-engine-output');if(!panel){panel=document.createElement('section');panel.id='local-engine-output';panel.className='card';document.getElementById('meal-list').before(panel);}
  panel.dataset.state='loading';
  try{
    const snapshot=await localEngineRequest('localEngineSnapshot');
    if(currentUser!==requestedUser)return;
    appState.mealsToday=snapshot.meals;appState.nutrition=snapshot.meals;renderNutrition();
    panel.replaceChildren();const title=document.createElement('h3');title.textContent='Experimental / UNVALIDATED · 非臨床驗證';panel.append(title);
    for(const result of snapshot.outputs.filter(r=>r.calculation_date===getLocalDateString())){
      const row=document.createElement('p');row.dataset.domain=result.domain;row.dataset.score=result.score===null?'null':String(result.score);row.dataset.status=result.score_status;row.dataset.version=result.engine_version;
      row.textContent=localEngineOutputText(result);panel.append(row);
    }panel.dataset.state='ready';
  }catch(error){if(currentUser!==requestedUser)return;panel.textContent='Engine 載入失敗：'+error.message;panel.dataset.state='error';const retry=document.createElement('button');retry.textContent='重試 Engine';retry.onclick=refreshLocalEngineOutputs;panel.append(retry);}
}
function localEngineOutputText(result){
  return `${result.domain}: ${result.score===null?'— 資料不足':result.score} · ${result.score_status} · 完整度 ${Math.round(result.data_completeness*100)}% · ${result.engine_version}`;
}
