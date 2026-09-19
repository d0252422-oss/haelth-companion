/* Shared manual SQL UI; local synthetic and hosted verified-session transports stay separate. */
function hostedManualEnabled(){return typeof HOSTED_MANUAL_SQL_ENABLED!=='undefined'&&HOSTED_MANUAL_SQL_ENABLED;}
function manualSqlEnabled(){return LOCAL_ENGINE_ENABLED||hostedManualEnabled();}
let hostedManualBinding=null,hostedManualConfigFingerprint=null,hostedIdentityPending=null;
const hostedManualActions=new Set(['getAccessState','getCurrentUser','getUserProfile','getManualProviderIdentity','getManualObservations','getManualObservationDaily','upsertManualObservation','deleteManualObservation','getObservationWriteStatus','getBodyRecords','addBodyRecord','upsertBodyRecord','deleteBodyRecord','getBodyWriteStatus','getNutritionRecords','getSleepRecords','getActivityRecords','upsertMealRecord','deleteMealRecord','getMealWriteStatus','localEngineSnapshot','getDashboardData','getTodaySummary','getHealthTimeline','refreshDailyNutrition','refreshDerivedData','getExerciseDatabase','getWorkoutRecords','manageExercise','addWorkoutRecord','updateWorkoutSet','deleteWorkoutSet','getTrainingWriteStatus']);
const hostedTrainingActions=new Set(['getExerciseDatabase','getWorkoutRecords','manageExercise','addWorkoutRecord','updateWorkoutSet','deleteWorkoutSet','getTrainingWriteStatus']);
function hostedManualConfig(){
  const raw=window.HEALTH_MANUAL_SQL_CONFIG||{};
  const fail=()=>{const e=Error('MANUAL_PROVIDER_NOT_CONFIGURED');e.code=e.message;throw e;};
  if(!hostedManualEnabled()||raw.enabled!==true||!['A','AB'].includes(raw.release)||raw.schemaVersion!=='manual-sql-v1'||!/^[a-z]{20}$/.test(raw.projectRef||''))fail();
  let endpoint;try{endpoint=new URL(raw.endpoint);}catch{fail();}
  if(endpoint.protocol!=='https:'||endpoint.hostname!==raw.projectRef+'.supabase.co'||endpoint.pathname!=='/functions/v1/mobile-health-beta/v1/engine/web'||endpoint.port||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)fail();
  const config={endpoint:endpoint.href,release:raw.release,schemaVersion:raw.schemaVersion},fingerprint=JSON.stringify(config);
  if(hostedManualConfigFingerprint&&hostedManualConfigFingerprint!==fingerprint){clearLocalManualState();fail();}
  hostedManualConfigFingerprint=fingerprint;return config;
}
function hostedManualNamespace(){const c=hostedManualConfig();return `hosted-sql:${c.endpoint}:${c.release}:${c.schemaVersion}:${hostedManualBinding?.canonical||'unverified'}`;}
async function hostedManualFetch(action,payload={}){
  const config=hostedManualConfig();
  if(!hostedManualActions.has(action))throw Object.assign(Error('MANUAL_ACTION_NOT_SUPPORTED'),{code:'MANUAL_ACTION_NOT_SUPPORTED'});
  if(config.release==='A'&&(hostedTrainingActions.has(action)||(action==='refreshDerivedData'&&payload.recordType==='workout')))throw Object.assign(Error('EXERCISE_MANAGEMENT_DISABLED'),{code:'EXERCISE_MANAGEMENT_DISABLED'});
  if(!sessionToken||sessionToken==='LOCAL_HTTP_ONLY_COOKIE')throw Object.assign(Error('INVALID_WEB_SESSION'),{code:'INVALID_WEB_SESSION'});
  return fetch(config.endpoint,{method:'POST',credentials:'omit',headers:{'content-type':'application/json','authorization':'Bearer '+sessionToken,'x-health-session-kind':'web'},body:JSON.stringify({action,payload}),signal:AbortSignal.timeout(30000)});
}
async function ensureHostedManualIdentity(){
  const config=hostedManualConfig(),token=sessionToken;
  if(hostedManualBinding?.token===token)return;
  if(hostedManualBinding)clearLocalManualState();
  if(hostedIdentityPending?.token===token&&hostedIdentityPending.epoch===localSessionEpoch)return hostedIdentityPending.promise;
  const epoch=localSessionEpoch;
  const pending={token,epoch,promise:null};
  pending.promise=(async()=>{
  const response=await hostedManualFetch('getManualProviderIdentity'),body=await response.json();
  if(epoch!==localSessionEpoch||token!==sessionToken)throw Error('IDENTITY_CHANGED');
  if(!body.ok)throw Object.assign(Error(body.error||'INVALID_WEB_SESSION'),{code:body.error||'INVALID_WEB_SESSION'});
  if(!/^[a-f0-9-]{36}$/.test(body.data?.canonicalUserId||'')||body.data.provider!=='postgresql-manual-v1'||body.data.release!==config.release||body.data.schemaVersion!==config.schemaVersion)throw Error('MANUAL_PROVIDER_CONTRACT_MISMATCH');
  hostedManualBinding={token,canonical:body.data.canonicalUserId,access:body.data.access};
  document.getElementById('health-connector-panel')?.style?.setProperty('display','none');
  document.getElementById('chatgpt-meal-box')?.style?.setProperty('display','none');
  if(config.release==='AB')setupLocalExerciseManagement();
  })().finally(()=>{if(hostedIdentityPending===pending)hostedIdentityPending=null;});
  hostedIdentityPending=pending;return pending.promise;
}
function manualSqlFetch(action,payload){return hostedManualEnabled()?hostedManualFetch(action,payload):fetch('/v1/engine/web',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,payload}),signal:AbortSignal.timeout(30000)});}
const localBodyRecords=new Map(),localMealRecords=new Map(),localPendingBodyWrites=new Map();
const localWorkoutRecords=new Map(),localPendingTrainingWrites=new Map();
const localObservationRecords=new Map(),localPendingObservationWrites=new Map();
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
  return !records.length||records.some(record=>record.nutritionCompleteness==='INCOMPLETE'||record[key]===null||record[key]===undefined||record[key]===''||!Number.isFinite(Number(record[key])))?null:records.reduce((total,record)=>total+Number(record[key]),0);
}
function localSectionReadGuard(section,start,end){
  const user=currentUser,epoch=localSessionEpoch,serial=(localSectionReads.get(section)||0)+1;
  localSectionReads.set(section,serial);
  return ()=>currentUser===user&&localSessionEpoch===epoch&&localSectionReads.get(section)===serial&&sectionWindows[section].start===start&&sectionWindows[section].end===end;
}
function renderDailySqlReadNotice(section,rows){
  if(!manualSqlEnabled())return;
  const latest=rows.at(-1),notice=section==='sleep'?'sleep-last-note':'activity-steps-note';
  if(latest?.dataStatus==='STALE')document.getElementById(notice).textContent=`${latest.date} 結果待更新；未顯示過期數值`;
  if(section==='sleep')document.getElementById('sleep-score-note').textContent='SQL 原始睡眠分數尚未接通（不替換為實驗分數）';
  else {document.getElementById('activity-active-note').textContent='SQL 尚無活動熱量的對應來源';document.getElementById('activity-total-note').textContent=latest?.source==='SQL_CANONICAL_MANUAL_AND_PUBLISHED'?'手動總消耗（自行回報）；不再加計 BMR／運動。':'SQL 尚無此熱量類型的對應來源';}
  if(latest?.source==='SQL_CANONICAL_MANUAL_AND_PUBLISHED')document.getElementById(notice).textContent=`${latest.date} · 手動自行回報${latest.reconciliationFlags?.length?' · 來源／時段衝突，未合併加總':''}${Object.values(latest.coverage||{}).includes('PARTIAL_DAY')?' · 部分日累積':''}`;
}
function clearLocalManualState(){manualProviderObservation=null;manualSourceEvidence=null;renderManualProviderStatus();hostedManualBinding=null;hostedIdentityPending=null;localSessionEpoch++;localOutputRequest++;localCatalogReadSequence++;localBodyRecords.clear();localMealRecords.clear();localPendingBodyWrites.clear();localObservationRecords.clear();localPendingObservationWrites.clear();if(typeof resetManualObservationState==='function')resetManualObservationState();localWorkoutRecords.clear();localPendingTrainingWrites.clear();localTrainingDraftLock(false);if(typeof exerciseDatabase!=='undefined')exerciseDatabase=[];if(typeof workoutSession!=='undefined')workoutSession=null;document.getElementById('exercise-management')?.remove();const overview=document.getElementById('training-overview'),draft=document.getElementById('workout-session'),list=document.getElementById('exercise-session-list');if(overview?.style)overview.style.display='block';draft?.classList?.remove('active');list?.replaceChildren?.();if(typeof setTrainingView==='function')setTrainingView('overview');if(typeof loadWeightFormDate==='function')loadWeightFormDate.binding=null;}
let manualProviderObservation=null;
let manualSourceEvidence=null;
let manualSourceSerial=0;
const manualSourceSequences=new Map();
// Observed contract evidence, never a claim inferred from an HTTP200 alone.
function manualSourceStatus(){return manualSourceEvidence||{api:'UNKNOWN',database:'UNKNOWN',dataPresent:'UNKNOWN',dataUpdatedAt:null,analysisUpdatedAt:null,domains:{}};}
function manualAnalysisState(row){
  const s=row?.score_status||row?.analysisStatus;
  if(s==='ANALYSIS_PENDING')return row.analysisJobScheduled===true?'UPDATING':row.analysisJobScheduled===false?'NOT_ENABLED':'UNKNOWN';
  if(s==='COMPUTED'&&typeof row.bodyScore==='number'&&Number.isFinite(row.bodyScore))return 'UPDATED';
  if(s==='COMPUTED'&&row.algorithmVersion==='health-score-v1.0'&&typeof row.score==='number'&&Number.isFinite(row.score))return 'UPDATED';
  if(['VALID','PARTIAL_DATA'].includes(s)&&typeof row.score==='number'&&Number.isFinite(row.score))return 'UPDATED';
  return ({INSUFFICIENT_DATA:'INSUFFICIENT_DATA',STALE:'STALE',ERROR:'FAILED',ANALYSIS_UNAVAILABLE:'UNKNOWN',ANALYSIS_NOT_ENABLED:'NOT_ENABLED'})[s]||'UNKNOWN';
}
function assertManualResponseShape(action,data){
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),rows=(v,id)=>Array.isArray(v)&&v.every(r=>object(r)&&typeof r[id]==='string'&&r[id].length>0&&Number.isSafeInteger(Number(r.revision)));
  let valid=true;
  if(action==='getBodyRecords'||action==='getManualObservations')valid=rows(data,'recordId');
  if(action==='getNutritionRecords')valid=rows(data,'mealRecordId');
  if(action==='getWorkoutRecords')valid=object(data)&&rows(data.records,'recordId');
  if(action==='getExerciseDatabase')valid=rows(data,'exerciseId');
  if(['getSleepRecords','getActivityRecords'].includes(action)){
    const keys=action==='getSleepRecords'?['totalSleepMinutes','sleepScore']:['steps','activeMinutes','activeCalories','totalCalories'];
    valid=Array.isArray(data)&&data.every(r=>object(r)&&/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&['CURRENT','STALE'].includes(r.dataStatus)&&keys.every(k=>r[k]===null||r.dataStatus==='CURRENT'&&typeof r[k]==='number'&&Number.isFinite(r[k])));
  }
  if(action==='getHealthTimeline')valid=object(data)&&Array.isArray(data.timeline)&&data.timeline.every(object);
  if(action==='localEngineSnapshot'||action==='refreshDailyNutrition'||action==='refreshDerivedData'&&data?.outputs!==undefined){
    valid=object(data)&&rows(data.meals,'mealRecordId')&&Array.isArray(data.outputs)&&data.outputs.every(r=>object(r)&&typeof r.domain==='string'&&typeof r.score_status==='string'&&typeof r.calculation_date==='string'&&(r.score===null||typeof r.score==='number'&&Number.isFinite(r.score)));
  }
  if(!valid)throw Object.assign(Error('MALFORMED_RESPONSE'),{code:'MALFORMED_RESPONSE'});
}
function recordManualSourceEvidence(action,{received=false,ok=false,data,error,payload={},sequence=++manualSourceSerial}={}){
  if(ok)assertManualResponseShape(action,data);
  const s=manualSourceEvidence??={api:'UNKNOWN',database:'UNKNOWN',dataPresent:'UNKNOWN',dataUpdatedAt:null,analysisUpdatedAt:null,domains:{}};
  const at=new Date().toISOString();s.api=received?'CONNECTED':'UNAVAILABLE';
  if(!ok){s.database=/^DB_|DATABASE|SQL_/.test(error||'')?'UNAVAILABLE':'UNKNOWN';renderManualProviderStatus();return;}
  const scope={start:payload.startDate||payload.date||null,end:payload.endDate||payload.date||null};
  const updateDomain=(name,fields)=>{const old=s.domains[name]||{};if((old.sequence||0)>sequence)return;const retained={...old};if(JSON.stringify(old.scope)!==JSON.stringify(scope))delete retained.present;s.domains[name]={...retained,...fields,scope,sequence};if(fields.analysis==='UPDATED')s.analysisUpdatedAt=at;};
  let rows=null,domain=null;
  if(action==='getBodyRecords'&&Array.isArray(data)){rows=data;domain='body';}
  if(action==='getManualObservations'&&Array.isArray(data)){rows=data;domain=payload.domain||'manual_observations';}
  if(action==='getNutritionRecords'&&Array.isArray(data)){rows=data;domain='nutrition';}
  if(action==='getWorkoutRecords'&&Array.isArray(data?.records)){rows=data.records;domain='training';}
  if(action==='getExerciseDatabase'&&Array.isArray(data)){rows=data;domain='exercise';}
  if(action==='getSleepRecords'&&Array.isArray(data)){rows=data;domain='sleep';}
  if(action==='getActivityRecords'&&Array.isArray(data)){rows=data;domain='activity';}
  if(action==='getHealthTimeline'&&Array.isArray(data?.timeline)){rows=data.timeline;domain='timeline';}
  if(['getDashboardData','getTodaySummary'].includes(action)&&data?.user&&Object.hasOwn(data,'today')){rows=data.today?[data.today]:[];domain='dashboard';}
  const snapshot=Array.isArray(data?.meals)&&Array.isArray(data?.outputs)&&['localEngineSnapshot','refreshDailyNutrition','refreshDerivedData'].includes(action);
  if(snapshot){rows=data.meals;domain='nutrition';const latest={};for(const out of data.outputs){if(!latest[out.domain]||out.calculation_date>=latest[out.domain].calculation_date)latest[out.domain]=out;}for(const name of new Set([...Object.keys(s.domains).filter(n=>!['training','exercise','timeline','dashboard'].includes(n)),...Object.keys(latest)])){const out=latest[name];updateDomain(name,{analysis:out?manualAnalysisState(out):'UNKNOWN',analysisDate:out?.calculation_date||null});}}
  const mutation=['upsertManualObservation','deleteManualObservation','addBodyRecord','upsertBodyRecord','deleteBodyRecord','upsertMealRecord','deleteMealRecord','addWorkoutRecord','updateWorkoutSet','deleteWorkoutSet','manageExercise'].includes(action);
  const receipt=['getObservationWriteStatus','getBodyWriteStatus','getMealWriteStatus','getTrainingWriteStatus'].includes(action)&&data?.exists===true;
  const committed=(mutation||receipt)&&data?.status==='SAVED'&&(typeof data.recordId==='string'||typeof data.exerciseId==='string'||Array.isArray(data.records));
  if(rows!==null){s.database='CONNECTED';s.dataUpdatedAt=at;updateDomain(domain,{present:rows.length>0});}
  if(['getSleepRecords','getActivityRecords'].includes(action)&&rows){
    const metrics=action==='getSleepRecords'?['totalSleepMinutes']:['steps','activeMinutes'];
    const latest=rows.at(-1);
    updateDomain(domain,{present:rows.some(r=>metrics.some(k=>typeof r[k]==='number'&&Number.isFinite(r[k]))),analysis:latest?.dataStatus==='STALE'?'STALE':'UNKNOWN',analysisDate:latest?.date||null});
  }
  if(committed){s.database='CONNECTED';s.dataUpdatedAt=at;/* presence is verified by a subsequent SELECT, not optimistic mutation UI */}
  if(action==='getBodyRecords'&&rows){const latest=[...rows].sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];updateDomain('body',{analysis:latest?manualAnalysisState(latest):'INSUFFICIENT_DATA',analysisDate:latest?.date||null});}
  if(action==='getManualObservations'&&rows){for(const name of payload.domain?[payload.domain]:['sleep','steps','total_energy']){const latest=rows.filter(r=>r.domain===name).sort((a,b)=>b.date.localeCompare(a.date))[0];updateDomain('manual_'+name,{present:!!latest,analysis:latest?manualAnalysisState(latest):'INSUFFICIENT_DATA',analysisDate:latest?.date||null});}}
  if((['addBodyRecord','upsertBodyRecord','deleteBodyRecord','getBodyWriteStatus'].includes(action)||action==='refreshDerivedData'&&payload.recordType==='body')&&data?.analysisStatus)updateDomain('body',{analysis:manualAnalysisState(data),analysisDate:data.record?.date||payload.date||null});
  if(['getWorkoutRecords','addWorkoutRecord','updateWorkoutSet','deleteWorkoutSet'].includes(action)||action==='refreshDerivedData'&&payload.recordType==='workout')updateDomain('training',{analysis:'NOT_ENABLED',analysisDate:null});
  if(!Object.values(s.domains).some(d=>d.analysis==='UPDATED'))s.analysisUpdatedAt=null;
  const present=Object.values(s.domains).filter(d=>Object.hasOwn(d,'present')).map(d=>d.present);s.dataPresent=present.some(Boolean)?'PRESENT':present.length?'ABSENT':'UNKNOWN';
  renderManualProviderStatus();
}
function renderManualProviderStatus(){
  if(typeof document==='undefined')return; // Transport-only hosts/tests have no UI surface.
  const node=document.getElementById('technical-provider-updated');
  if(node)node.textContent=!manualProviderObservation?'尚無本帳號成功 SQL 讀寫證據':`${manualProviderObservation.ok?'最近請求成功':'最近請求失敗（沒有切换資料來源）'} · ${manualProviderObservation.at} · ${manualProviderObservation.action}${manualProviderObservation.analysis?' · '+manualProviderObservation.analysis:''}`;
  const sql=manualSqlEnabled(),s=manualSourceStatus(),put=(id,text,state)=>{const el=document.getElementById(id);if(el){el.textContent=text;if(el.dataset)el.dataset.state=state||'UNKNOWN';}};
  put('data-connection-state',!sql?'既有資料服務（未切換）':s.api==='CONNECTED'?(s.database==='CONNECTED'?'已連線（最近 SQL 請求已驗證）':'API 已回應；資料庫尚未確認'):'尚未確認連線',s.api);
  put('data-storage-provider',sql?(hostedManualEnabled()?'雲端資料庫':'本機測試資料庫'):'既有資料服務',sql?'SQL_CONFIGURED':'LEGACY_CONFIGURED');
  put('data-last-updated',s.dataUpdatedAt?`最近 SQL 讀寫確認：${s.dataUpdatedAt}`:'尚無 SQL 讀寫確認時間',s.dataUpdatedAt?'OBSERVED':'UNKNOWN');
  put('data-presence',s.dataPresent==='PRESENT'?'本次查詢有資料':s.dataPresent==='ABSENT'?'本次查詢沒有資料':'尚未查詢資料',s.dataPresent);
  const names={body:'身體',nutrition:'飲食',training:'訓練',sleep:'睡眠',activity:'活動',cardio:'心肺',recovery:'恢復',overall:'整體'},labels={UPDATED:'已更新（experimental）',UPDATING:'有待處理工作',INSUFFICIENT_DATA:'資料不足',NOT_ENABLED:'分析尚未啟用',FAILED:'失敗',STALE:'結果待更新',UNKNOWN:'尚未確認'};
  const analyses=Object.entries(s.domains).filter(([,d])=>d.analysis),states=analyses.map(([,d])=>d.analysis);
  const analysisState=['FAILED','STALE','UPDATING','UNKNOWN','NOT_ENABLED','INSUFFICIENT_DATA','UPDATED'].find(v=>states.includes(v))||'UNKNOWN';
  put('data-analysis-state',analyses.length?analyses.map(([d,v])=>`${names[d]||d}：${labels[v.analysis]||labels.UNKNOWN}${v.analysisDate?'（'+v.analysisDate+'）':''}`).join('；'):'尚未確認分析狀態',analysisState);
  put('technical-database-status',`Database = ${s.database}`,s.database);
  put('technical-source-status',`API_CONNECTED=${s.api}; DATABASE_CONNECTED=${s.database}; DATA_PRESENT=${s.dataPresent}; DATA_UPDATED=${s.dataUpdatedAt?'OBSERVED':'UNKNOWN'}; ANALYSIS_UPDATED=${analysisState}; algorithm=health-score-v1.0`,analysisState);
  if(sql)for(const id of ['sync-dot','settings-status-dot']){const el=document.getElementById(id);if(el)el.className='status-dot '+(s.database==='CONNECTED'?'connected':s.database==='UNAVAILABLE'||s.api==='UNAVAILABLE'?'error':'notConfigured');}
}
function observeManualProvider(action,ok,analysis){manualProviderObservation={action,ok,analysis,at:new Date().toISOString()};renderManualProviderStatus();}
function localManualBodyNotice(){
  if(!manualSqlEnabled())return;
  const note=document.getElementById('body-current-note');
  const row=[...(appState.body||[])].sort((a,b)=>b.date.localeCompare(a.date))[0];
  if(note&&row){
    note.dataset.analysisStatus=row.analysisStatus;
    const label=row.analysisStatus==='COMPUTED'?`Experimental 身體分數 ${row.bodyScore??'—'}（未經真實有效性驗證）`:row.analysisStatus==='INSUFFICIENT_DATA'?'紀錄已保存；身體分析資料不足':row.analysisStatus==='ANALYSIS_UNAVAILABLE'?'紀錄已保存；暫時無法查詢分析狀態':row.analysisStatus==='ERROR'?'紀錄已保存；分析失敗，可重新整理重試':row.analysisJobScheduled?'紀錄已保存；有待處理的重算工作':'紀錄已保存；此項分析尚未啟用';
    note.textContent+=' · '+label;
  }else if(note)delete note.dataset.analysisStatus;
}
async function localEngineRequest(action,payload={}){
  if(!manualSqlEnabled())throw Error('LOCAL_ENGINE_DISABLED');
  if(hostedManualEnabled())await ensureHostedManualIdentity();
  if(action==='logout'&&!hostedManualEnabled()){clearLocalManualState();await fetch('/local-logout',{method:'POST'});return {};}
  const epoch=localSessionEpoch;
  const sourceSequence=++manualSourceSerial;manualSourceSequences.set(action,sourceSequence);
  const sourceCurrent=()=>epoch===localSessionEpoch&&manualSourceSequences.get(action)===sourceSequence;
  const invalidateSourceRead=['addBodyRecord','upsertBodyRecord','deleteBodyRecord'].includes(action)?'getBodyRecords':['upsertMealRecord','deleteMealRecord'].includes(action)?'getNutritionRecords':['addWorkoutRecord','updateWorkoutSet','deleteWorkoutSet'].includes(action)?'getWorkoutRecords':null;
  if(invalidateSourceRead)manualSourceSequences.set(invalidateSourceRead,++manualSourceSerial);
  const catalogSequence=action==='getExerciseDatabase'?++localCatalogReadSequence:0;
  if(action==='manageExercise')localCatalogReadSequence++;
  const observationMutation=['upsertManualObservation','deleteManualObservation'].includes(action);
  const bodyMutation=['addBodyRecord','upsertBodyRecord','deleteBodyRecord'].includes(action);
  const trainingMutation=['manageExercise','addWorkoutRecord','updateWorkoutSet','deleteWorkoutSet'].includes(action);
  let observationKey;
  if(observationMutation){observationKey=action+'|'+JSON.stringify(payload);let pending=localPendingObservationWrites.get(observationKey);if(!pending){const old=localObservationRecords.get(payload.recordId);pending=structuredClone({...payload,revision:payload.revision??old?.revision,clientRequestId:payload.clientRequestId||crypto.randomUUID()});localPendingObservationWrites.set(observationKey,pending);}payload=pending;manualSourceSequences.set('getManualObservations',++manualSourceSerial);}
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
  let body,received=false;
  try{
    const response=await manualSqlFetch(action,payload);
    received=true;
    try{body=await response.json();}catch{const error=Error('MALFORMED_RESPONSE');error.code='MALFORMED_RESPONSE';throw error;}
    if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.ok!=='boolean')throw Object.assign(Error('MALFORMED_RESPONSE'),{code:'MALFORMED_RESPONSE'});
    if(response.ok===false&&body?.ok===true)body={ok:false,error:'HTTP_RESPONSE_CONTRACT_MISMATCH'};
    if(body.ok)try{assertManualResponseShape(action,body.data);}catch(error){body=undefined;throw error;}
  }catch(error){
    if(error.name==='TimeoutError'||error.name==='AbortError')error.code='REQUEST_TIMEOUT';
    if((bodyMutation||trainingMutation||observationMutation)&&epoch===localSessionEpoch){
      try{const status=await localEngineRequest(observationMutation?'getObservationWriteStatus':trainingMutation?'getTrainingWriteStatus':'getBodyWriteStatus',{clientRequestId:payload.clientRequestId});if(status.exists)body={ok:true,data:{...status,recovered:true}};}catch{ /* keep the original stable envelope for an explicit retry */ }
    }
    if(!body||typeof body.ok!=='boolean'){if(sourceCurrent()){recordManualSourceEvidence(action,{received,error:error.code});observeManualProvider(action,false);}throw error;}
  }
  if(epoch!==localSessionEpoch){const error=Error('IDENTITY_CHANGED');error.code='IDENTITY_CHANGED';throw error;}
  if(catalogSequence&&catalogSequence!==localCatalogReadSequence){const error=Error('STALE_CATALOG_RESPONSE');error.code='STALE_CATALOG_RESPONSE';throw error;}
  if(!body.ok){if(sourceCurrent()){recordManualSourceEvidence(action,{received,error:body.error});observeManualProvider(action,false);}if(observationKey&&!body.retryable)localPendingObservationWrites.delete(observationKey);if(pendingKey&&!body.retryable)localPendingBodyWrites.delete(pendingKey);if(trainingKey&&!body.retryable){localPendingTrainingWrites.delete(trainingKey);if(action==='addWorkoutRecord')localTrainingDraftLock(false);}const error=Error(body.error);error.code=body.error;error.retryable=body.retryable===true;throw error;}
  if(sourceCurrent())recordManualSourceEvidence(action,{received:true,ok:true,data:body.data,payload,sequence:sourceSequence});
  observeManualProvider(action,true,body.data?.analysisStatus);
  if(observationMutation){localPendingObservationWrites.delete(observationKey);if(body.data.record)cacheLocalRevision(localObservationRecords,body.data.recordId,{...body.data.record,deleted:body.data.deleted===true});}
  if(action==='getManualObservations')for(const record of body.data)cacheLocalRevision(localObservationRecords,record.recordId,record);
  if(trainingMutation){localPendingTrainingWrites.delete(trainingKey);if(action==='addWorkoutRecord')localTrainingDraftLock(false);if(body.data.record)cacheLocalRevision(localWorkoutRecords,body.data.recordId,{...body.data.record,deleted:body.data.deleted===true});for(const record of body.data.records||[])cacheLocalRevision(localWorkoutRecords,record.recordId,record);}
  if(action==='getWorkoutRecords')for(const record of body.data.records||[])cacheLocalRevision(localWorkoutRecords,record.recordId,record);
  if(bodyMutation){localPendingBodyWrites.delete(pendingKey);cacheLocalRevision(localBodyRecords,body.data.recordId,{...body.data.record,deleted:body.data.deleted===true});}
  if(['upsertMealRecord','deleteMealRecord'].includes(action)&&body.data.record)cacheLocalRevision(localMealRecords,body.data.recordId||body.data.record.mealRecordId,{...body.data.record,deleted:action==='deleteMealRecord'});
  if(action==='getBodyRecords')for(const record of body.data)cacheLocalRevision(localBodyRecords,record.recordId,record);
  if(action==='getNutritionRecords')for(const record of body.data)cacheLocalRevision(localMealRecords,record.mealRecordId,record);
  if(bodyMutation||['upsertMealRecord','deleteMealRecord','refreshDailyNutrition','refreshDerivedData'].includes(action))queueMicrotask(refreshLocalEngineOutputs);
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
  if(!manualSqlEnabled())return;
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
  if(!manualSqlEnabled()||!currentUser)return;
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
  panel.innerHTML='<button id="manage-exercises" type="button" class="secondary-button">管理我的動作</button><div id="exercise-manager" hidden><p>改名／個人別名不改歷史名稱與訓練量。封存可恢復；歷史紀錄仍可編修。SQL 手動訓練紀錄已保存；此項分數分析尚未啟用。</p><form id="exercise-create-form"><label>新自訂動作名稱<input id="exercise-create-name" class="form-input" maxlength="80" required></label><label>訓練部位／分類<input id="exercise-create-category" class="form-input" maxlength="40" required></label><button id="exercise-create-submit" type="submit">建立自訂動作</button></form><p id="exercise-manager-status" role="status"></p><div id="exercise-manager-list"></div><button id="exercise-manager-retry" type="button">重新載入</button></div>';
  document.getElementById('training-overview').append(panel);
  const load=async()=>{
    const epoch=localSessionEpoch,status=document.getElementById('exercise-manager-status');status.textContent='載入中…';
    try{const entries=await apiService.getExerciseDatabase();if(epoch!==localSessionEpoch)return;exerciseDatabase=entries;renderLocalExerciseManager(entries);await buildExerciseSelect();status.textContent='SQL 已讀回';}
    catch(error){if(epoch===localSessionEpoch&&error.code!=='STALE_CATALOG_RESPONSE')status.textContent='讀取失敗：'+error.message;}
  };
  document.getElementById('manage-exercises').onclick=()=>{document.getElementById('exercise-manager').hidden=false;void load();};
  document.getElementById('exercise-manager-retry').onclick=load;
  document.getElementById('exercise-create-form').onsubmit=async event=>{
    event.preventDefault();const button=document.getElementById('exercise-create-submit');if(button.disabled)return;
    const epoch=localSessionEpoch,status=document.getElementById('exercise-manager-status'),controls=[...document.querySelectorAll('#exercise-create-form input,#exercise-create-form button')];
    const payload={operation:'create',name:document.getElementById('exercise-create-name').value,muscleGroup:document.getElementById('exercise-create-category').value};
    controls.forEach(c=>c.disabled=true);status.textContent='儲存中…';
    try{await localEngineRequest('manageExercise',payload);if(epoch!==localSessionEpoch)return;document.getElementById('exercise-create-form').reset();await load();}
    catch(error){if(epoch===localSessionEpoch)status.textContent='未完成：'+error.message;}
    finally{controls.forEach(c=>c.disabled=false);}
  };
}
function renderLocalExerciseManager(entries){
  const list=document.getElementById('exercise-manager-list');list.replaceChildren();
  for(const exercise of entries){
    const row=document.createElement('article');row.dataset.exerciseId=exercise.exerciseId;row.style.marginBottom='16px';
    const label=document.createElement('label');label.textContent=(exercise.custom?'本人自訂動作':'共享動作的個人別名')+(exercise.archived?' · 已封存':'');
    const input=document.createElement('input');input.className='form-input exercise-manage-name';input.value=exercise.exerciseName;input.maxLength=80;input.setAttribute('aria-label','動作名稱');label.append(input);row.append(label);
    const category=document.createElement('input');category.className='form-input exercise-manage-category';category.value=exercise.muscleGroup;category.maxLength=40;category.setAttribute('aria-label','訓練部位／分類');category.disabled=!exercise.custom;row.append(category);
    const status=document.createElement('p');status.className='exercise-manage-result';status.setAttribute('role','status');
    for(const [operation,title] of [['rename','儲存名稱'],...(exercise.custom?[['classify','儲存分類']]:[]),[exercise.archived?'restore':'archive',exercise.archived?'恢復動作':'封存／從我的清單隱藏'],...(exercise.custom?[['delete','永久刪除（僅無引用）']]:[])]){
      const button=document.createElement('button');button.type='button';button.className='secondary-button';button.dataset.operation=operation;button.textContent=title;
      button.onclick=async()=>{
        const epoch=localSessionEpoch;
        if(button.disabled)return;
        if(operation==='delete'&&!confirm('永久刪除此自訂動作？只有沒有任何歷史引用的項目才能刪除；無法復原。'))return;
        const buttons=[...list.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);status.textContent='儲存中…';
        try{await localEngineRequest('manageExercise',{exerciseId:exercise.exerciseId,revision:exercise.revision,operation,...(operation==='rename'?{name:input.value}:operation==='classify'?{muscleGroup:category.value}:{})});
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
