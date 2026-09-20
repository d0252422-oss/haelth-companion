// The original quick-add and detail screens use the same SQL/auth provider.
let observationEditor=null,observationReadSerial=0,activityPairEditor=null,activityPairReadSerial=0;
const observationLabels={sleep:'睡眠',steps:'步數',total_energy:'總消耗熱量'};
const observationLimits={sleep:1440,steps:200000,total_energy:30000};
function resetManualObservationState(){observationEditor=null;activityPairEditor=null;observationReadSerial++;activityPairReadSerial++;for(const id of ['sleep-manual-records','activity-manual-records'])document.getElementById(id)?.replaceChildren?.();}
function observationStatus(text,error=false){const el=document.getElementById('observation-status');el.textContent=text;el.setAttribute('role',error?'alert':'status');}
function observationControls(locked){document.querySelectorAll('#observation-form input,#observation-form select,#observation-form textarea').forEach(el=>el.disabled=locked);}
function observationCoverage(){const sleep=document.getElementById('observation-domain').value==='sleep',partial=document.getElementById('observation-coverage').value==='PARTIAL_DAY';document.getElementById('observation-cutoff').required=!sleep&&partial;document.getElementById('observation-cutoff-group').hidden=sleep||!partial;}
function sleepIntervalMinutes(start,end){if(!start||!end)return null;const first=Date.parse(start+':00+08:00'),last=Date.parse(end+':00+08:00');return Number.isFinite(first)&&Number.isFinite(last)?Math.round((last-first)/60000):NaN;}
function syncSleepDuration(announce=false){
 const domain=document.getElementById('observation-domain').value,start=document.getElementById('observation-start'),end=document.getElementById('observation-end'),value=document.getElementById('observation-value');
 start.setCustomValidity?.('');end.setCustomValidity?.('');if(domain!=='sleep')return true;
 if(!start.value&&!end.value){if(announce)observationStatus('可直接填睡眠分鐘數；若填完整時段，系統會自動計算。');return true;}
 if(!start.value||!end.value){const missing=start.value?end:start;missing.setCustomValidity?.('請同時填寫入睡與起床時間。');value.value='';if(announce)observationStatus('請同時填寫入睡與起床時間。',true);return false;}
 const minutes=sleepIntervalMinutes(start.value,end.value),wakeDate=end.value.slice(0,10),date=document.getElementById('observation-date').value;
 if(!Number.isFinite(minutes)||minutes<=0||minutes>observationLimits.sleep||wakeDate!==date){end.setCustomValidity?.('起床時間須晚於入睡時間、不超過 24 小時，且起床日須等於睡眠日期。');value.value='';if(announce)observationStatus('睡眠時段須大於 0、最多 24 小時，並以起床日記錄。',true);return false;}
 value.value=String(minutes);if(announce)observationStatus(`已自動計算 ${Math.floor(minutes/60)} 小時 ${minutes%60} 分鐘；來源會標記為手動。`);return true;
}
async function openObservationEditor(domain,record=null){
 if(!manualSqlEnabled())return toast('手動睡眠／活動僅在 SQL 模式提供；未切換其他資料來源。');
 if(observationEditor?.pending){openSheet('observation-form');observationStatus('上一筆寫入狀態尚待確認，請重試同一筆要求。',true);return;}
 if(!Object.hasOwn(observationLabels,domain))throw Error('INVALID_OBSERVATION_DOMAIN');
 const form=document.getElementById('observation-form');form.reset();observationControls(false);
 observationEditor={user:currentUser,epoch:localSessionEpoch,record,serial:++observationReadSerial,pending:null,loadedDate:record?.date||getLocalDateString(),loading:false};
 document.getElementById('observation-domain').value=domain;document.getElementById('observation-date').value=record?.date||getLocalDateString();document.getElementById('observation-date').max=getLocalDateString();
 document.getElementById('observation-title').textContent=(record?'編輯':'新增')+observationLabels[domain];
 document.getElementById('observation-date-label').textContent=domain==='sleep'?'睡眠日期（以起床日記錄；Asia/Taipei）':'日期（Asia/Taipei）';
 document.getElementById('observation-value-label').textContent=domain==='sleep'?'睡眠總時長（分鐘；完整時段會自動計算）':domain==='steps'?'當日總步數（不是增量）':'每日總消耗（kcal；不是飲食或運動熱量增量）';
 const value=document.getElementById('observation-value');value.value=record?.value??'';value.step=domain==='steps'?'1':'any';value.max=String(observationLimits[domain]);
 document.getElementById('observation-coverage-group').hidden=domain==='sleep';document.getElementById('observation-time-group').hidden=domain!=='sleep';
 document.getElementById('observation-coverage').value=record?.coverage||'FULL_DAY';document.getElementById('observation-cutoff').value=record?.cutoffTime||'';
 for(const [id,key]of[['observation-note','note'],['observation-source-note','sourceNote']])document.getElementById(id).value=record?.[key]||'';
 const localInstant=iso=>iso?new Date(Date.parse(iso)+8*3600000).toISOString().slice(0,16):'';
 document.getElementById('observation-start').value=localInstant(record?.startedAt);document.getElementById('observation-end').value=localInstant(record?.endedAt);syncSleepDuration(false);
 document.getElementById('observation-delete').hidden=!record;document.getElementById('observation-delete').disabled=!record;document.getElementById('observation-save').disabled=false;observationCoverage();openSheet('observation-form');
 observationStatus(domain==='sleep'?'可填入睡／起床時段自動計算；只有時長也可保存，不推算睡眠階段或效率。':'手動資料為每日總值；同日自動來源有衝突時不相加、不猜最大值。');
 if(domain!=='sleep'&&!record)await loadObservationDate();
}
async function loadObservationDate(reload=false){
 const state=observationEditor,domain=document.getElementById('observation-domain').value,date=document.getElementById('observation-date').value;
 if(!state||state.pending)return;
 if(domain==='sleep'&&(!reload||!state.record)){state.loadedDate=date;document.getElementById('observation-delete').disabled=!state.record||state.record.date!==date;return;}
 const serial=++observationReadSerial;state.loadedDate=null;state.loading=true;observationControls(true);document.getElementById('observation-date').disabled=false;document.getElementById('observation-save').disabled=true;document.getElementById('observation-delete').disabled=true;observationStatus('正在載入此日期的累積值…');
 try{const rows=await localEngineRequest('getManualObservations',{domain,date:domain==='sleep'?state.record.date:date});if(observationEditor!==state||currentUser!==state.user||localSessionEpoch!==state.epoch||serial!==observationReadSerial)return;
  const record=domain==='sleep'?rows.find(row=>row.recordId===state.record.recordId):rows.find(row=>row.date===date);
  if(domain==='sleep'&&!record)throw Error('此筆睡眠已刪除或移至其他日期；請回紀錄清單重新開啟，不會自動另建一筆。');
  state.record=record||null;
  if(domain==='sleep')for(const [id,key]of[['observation-start','startedAt'],['observation-end','endedAt']])document.getElementById(id).value=record[key]?new Date(Date.parse(record[key])+8*3600000).toISOString().slice(0,16):'';
  document.getElementById('observation-value').value=state.record?.value??'';document.getElementById('observation-coverage').value=state.record?.coverage||'FULL_DAY';document.getElementById('observation-cutoff').value=state.record?.cutoffTime||'';document.getElementById('observation-source-note').value=state.record?.sourceNote||'';document.getElementById('observation-note').value=state.record?.note||'';document.getElementById('observation-delete').hidden=!state.record;
  state.loadedDate=date;state.loading=false;observationControls(false);observationCoverage();syncSleepDuration(false);document.getElementById('observation-save').disabled=false;document.getElementById('observation-delete').disabled=!state.record||state.record.date!==date;observationStatus(state.record?(domain==='sleep'?'已重新載入同一筆睡眠的最新版本。':'已載入；修改會覆寫當日總值，不與舊值相加。'):'此日尚無手動紀錄。');
 }catch(error){if(observationEditor===state&&serial===observationReadSerial){state.loading=false;observationControls(false);document.getElementById('observation-save').disabled=true;document.getElementById('observation-delete').disabled=true;observationStatus(readableError(error)+'；請按「重新載入」。',true);}}
}
function observationPayload(){
 const domain=document.getElementById('observation-domain').value;
 if(!syncSleepDuration(false))throw Error('請修正睡眠時段；入睡與起床時間必須成對填寫。');
 const valueText=document.getElementById('observation-value').value,value=valueText===''?null:Number(valueText);
 if(value===null||!Number.isFinite(value)||value<0||value>observationLimits[domain]||domain==='steps'&&!Number.isSafeInteger(value))throw Error(domain==='steps'?'步數須為 0–200000 的整數。':domain==='total_energy'?'每日總消耗須為 0–30000 kcal。':'睡眠時長須為 0–1440 分鐘。');
 const start=document.getElementById('observation-start').value,end=document.getElementById('observation-end').value;
 const record=observationEditor.record;
 return {clientRequestId:crypto.randomUUID(),...(record?{recordId:record.recordId,revision:record.revision}:{}),domain,date:document.getElementById('observation-date').value,timezone:'Asia/Taipei',value,
 coverage:domain==='sleep'?'SESSION':document.getElementById('observation-coverage').value,cutoffTime:domain==='sleep'||document.getElementById('observation-coverage').value==='FULL_DAY'?null:document.getElementById('observation-cutoff').value||null,
 startedAt:domain==='sleep'&&start?start+':00+08:00':null,endedAt:domain==='sleep'&&end?end+':00+08:00':null,note:document.getElementById('observation-note').value||null,sourceNote:document.getElementById('observation-source-note').value||null};
}
async function saveObservation(remove=false){
 const state=observationEditor,button=document.getElementById('observation-save');if(!state||state.saving||state.user!==currentUser||state.epoch!==localSessionEpoch)return;
 const domain=document.getElementById('observation-domain').value,date=document.getElementById('observation-date').value;
 if(!state.pending&&(state.loading||state.loadedDate!==date||remove&&(!state.record||state.record.date!==date)||domain!=='sleep'&&state.record&&state.record.date!==date)){observationStatus('日期資料尚未正確載入，請重新載入後再操作。',true);return;}
 if(remove&&!state.pending&&!window.confirm('刪除此筆手動紀錄？將保留刪除標記，不會刪除自動來源。'))return;
 try{if(!state.pending)state.pending={action:remove?'deleteManualObservation':'upsertManualObservation',payload:remove?{recordId:state.record.recordId,revision:state.record.revision,clientRequestId:crypto.randomUUID()}:observationPayload()};
  state.saving=true;observationControls(true);button.disabled=true;document.getElementById('observation-delete').disabled=true;observationStatus('正在儲存至 SQL…');
  const result=await localEngineRequest(state.pending.action,state.pending.payload);if(observationEditor!==state||state.user!==currentUser||state.epoch!==localSessionEpoch)return;
   state.pending=null;observationEditor=null;closeSheet();toast('已保存至 SQL；相關畫面與分析更新中。');clearDashboardCache();sectionLoadKeys.clear();
   const section=result.record.domain==='sleep'?'sleep':'activity',range={...sectionWindows[section]},refresh=async()=>{await refreshSectionRange(section,range.start,range.end);clearDashboardCache();};
   if(typeof refreshInBackground==='function')refreshInBackground('manual-observation-'+result.record.domain,refresh);else void refresh().catch(error=>console.warn('manual observation background refresh failed',error));
 }catch(error){if(observationEditor===state&&state.user===currentUser){if(error.code&&error.retryable===false){state.pending=null;observationControls(false);}observationStatus(readableError(error)+(state.pending?'；結果待確認，重試會使用同一要求。':''),true);}}
 finally{state.saving=false;if(observationEditor===state&&state.user===currentUser&&state.epoch===localSessionEpoch){const ready=!!state.pending||!state.loading&&state.loadedDate===document.getElementById('observation-date').value;button.disabled=!ready;document.getElementById('observation-delete').disabled=!ready||!state.record||!!state.pending;}}
}
function activityPairStatus(text,error=false){const el=document.getElementById('activity-pair-status');el.textContent=text;el.setAttribute('role',error?'alert':'status');}
function activityPairControls(locked){for(const id of ['activity-pair-date','activity-pair-steps','activity-pair-energy'])document.getElementById(id).disabled=locked;document.getElementById('activity-pair-save').disabled=locked;}
function activityPairRecord(domain){return activityPairEditor?.records?.get(domain)||null;}
async function openActivityPairEditor(){
 if(!manualSqlEnabled())return toast('手動步數／總消耗僅在 SQL 模式提供；未切換其他資料來源。');
 const date=getLocalDateString();activityPairEditor={user:currentUser,epoch:localSessionEpoch,date,records:new Map(),pending:new Map(),completed:new Set(),loading:false,saving:false};
 document.getElementById('activity-pair-form').reset();document.getElementById('activity-pair-date').value=date;document.getElementById('activity-pair-date').max=date;openSheet('activity-pair-form');
 await loadActivityPairDate();
}
async function loadActivityPairDate(){
 const state=activityPairEditor,date=document.getElementById('activity-pair-date').value;if(!state||state.saving)return;
 const serial=++activityPairReadSerial;state.loading=true;activityPairControls(true);document.getElementById('activity-pair-date').disabled=false;activityPairStatus('數據載入中，請稍候…');
 try{const rows=await localEngineRequest('getManualObservations',{date});if(activityPairEditor!==state||currentUser!==state.user||localSessionEpoch!==state.epoch||serial!==activityPairReadSerial)return;
  state.date=date;state.records=new Map(rows.filter(row=>row.date===date&&['steps','total_energy'].includes(row.domain)).map(row=>[row.domain,row]));state.pending.clear();state.completed.clear();
  document.getElementById('activity-pair-steps').value=activityPairRecord('steps')?.value??'';document.getElementById('activity-pair-energy').value=activityPairRecord('total_energy')?.value??'';
  activityPairStatus(state.records.size?'已載入既有手動總值；儲存會覆寫同日數值，不會相加。':'此日尚無手動步數或總消耗；至少填寫一項。');
 }catch(error){if(activityPairEditor===state&&serial===activityPairReadSerial)activityPairStatus(readableError(error)+'；請重新選擇日期後重試。',true);}
 finally{if(activityPairEditor===state&&serial===activityPairReadSerial){state.loading=false;activityPairControls(false);}}
}
function activityPairPayload(domain,value){
 const record=activityPairRecord(domain);return {clientRequestId:crypto.randomUUID(),...(record?{recordId:record.recordId,revision:record.revision}:{}),domain,date:document.getElementById('activity-pair-date').value,timezone:'Asia/Taipei',value,coverage:'FULL_DAY',cutoffTime:null,startedAt:null,endedAt:null,note:null,sourceNote:null};
}
async function saveActivityPair(){
 const state=activityPairEditor;if(!state||state.loading||state.saving||state.user!==currentUser||state.epoch!==localSessionEpoch)return;
 const date=document.getElementById('activity-pair-date').value,stepsText=document.getElementById('activity-pair-steps').value.trim(),energyText=document.getElementById('activity-pair-energy').value.trim();
 if(state.date!==date)return activityPairStatus('日期資料尚未載入完成，請重新選擇日期。',true);
 if(!state.pending.size){
  if(!stepsText&&!energyText)return activityPairStatus('請至少填寫每日步數或每日總消耗其中一項。',true);
  if(stepsText){const value=Number(stepsText);if(!Number.isSafeInteger(value)||value<0||value>observationLimits.steps)return activityPairStatus('步數須為 0–200000 的整數。',true);state.pending.set('steps',activityPairPayload('steps',value));}
  if(energyText){const value=Number(energyText);if(!Number.isFinite(value)||value<0||value>observationLimits.total_energy)return activityPairStatus('每日總消耗須為 0–30000 kcal。',true);state.pending.set('total_energy',activityPairPayload('total_energy',value));}
 }
 state.saving=true;activityPairControls(true);activityPairStatus('正在儲存至 SQL…');
 const attempts=[...state.pending.entries()],results=await Promise.allSettled(attempts.map(([,payload])=>localEngineRequest('upsertManualObservation',payload)));
 results.forEach((result,index)=>{const domain=attempts[index][0];if(result.status==='fulfilled'){state.pending.delete(domain);state.completed.add(domain);state.records.set(domain,result.value.record);}});
 state.saving=false;
 if(activityPairEditor!==state||state.user!==currentUser||state.epoch!==localSessionEpoch)return;
 if(state.pending.size){activityPairControls(false);const done=[...state.completed].map(domain=>observationLabels[domain]).join('、'),failed=[...state.pending].map(domain=>observationLabels[domain]).join('、');activityPairStatus(`${done?done+'已確認儲存；':''}${failed}尚未完成。請重試，已成功項目不會重送。`,true);return;}
 activityPairEditor=null;closeSheet();toast('步數／總消耗已保存至 SQL；相關畫面與分析更新中。');clearDashboardCache();sectionLoadKeys.clear();if(typeof setDashboardDataState==='function')setDashboardDataState('updating');
 const range={...sectionWindows.activity},refresh=async()=>{await refreshSectionRange('activity',range.start,range.end);clearDashboardCache();if(typeof setDashboardDataState==='function')setDashboardDataState('ready');};
 if(typeof refreshInBackground==='function')refreshInBackground('manual-observation-activity-pair',refresh);else void refresh().catch(error=>console.warn('manual activity pair background refresh failed',error));
}
async function refreshManualObservationList(section,start,end){
 if(!manualSqlEnabled())return;const user=currentUser,epoch=localSessionEpoch;
 const rows=await localEngineRequest('getManualObservations',{startDate:start,endDate:end,...(section==='sleep'?{domain:'sleep'}:{})});
 if(currentUser!==user||localSessionEpoch!==epoch||sectionWindows[section].start!==start||sectionWindows[section].end!==end)return;
 const selected=rows.filter(row=>section==='sleep'?row.domain==='sleep':row.domain!=='sleep').map(row=>{const cached=localObservationRecords.get(row.recordId);return cached&&cached.revision>row.revision?cached:row;}).filter(row=>!row.deleted),node=document.getElementById(section+'-manual-records');node.replaceChildren();
 const title=document.createElement('h3');title.textContent='手動'+(section==='sleep'?'睡眠':'活動')+'紀錄（所選期間）';node.append(title);
 if(!selected.length){const empty=document.createElement('p');empty.textContent='此期間尚無手動紀錄。';node.append(empty);}
 for(const row of [...selected].sort((a,b)=>b.date.localeCompare(a.date))){const card=document.createElement('article');card.className='card card-pad';card.dataset.observationId=row.recordId;
 const text=document.createElement('p');text.textContent=`${row.date} · ${observationLabels[row.domain]} ${row.value} ${row.unit} · ${row.coverage==='PARTIAL_DAY'?'部分日／截至 '+row.cutoffTime:row.coverage==='FULL_DAY'?'全日累積':'單次睡眠'} · 來源：手動`;
 const status=document.createElement('p');status.className='record-date-note';status.textContent=!['AVAILABLE','PARTIAL_DAY'].includes(row.reconciliationStatus)?`紀錄已保存；${row.reconciliationStatus}（有衝突，不合併加總）。`:row.analysisStatus==='COMPUTED'?`紀錄已保存；既有 ${row.algorithmVersion} 分數 ${row.score}（自行回報資料）。`:row.analysisStatus==='INSUFFICIENT_DATA'?'紀錄已保存；分析資料不足。':row.analysisJobScheduled?'紀錄已保存；有可追蹤的待重算工作。':row.analysisStatus==='ANALYSIS_NOT_ENABLED'?'紀錄已保存；此項分析尚未啟用。':'紀錄已保存；分析狀態暫時無法確認。';
 const edit=document.createElement('button');edit.type='button';edit.className='secondary-button';edit.textContent='編輯／刪除';edit.onclick=()=>openObservationEditor(row.domain,row);card.append(text,status,edit);node.append(card);}
}
function initializeManualObservations(){
 document.querySelectorAll('[data-observation-add]').forEach(button=>button.onclick=()=>openObservationEditor(button.dataset.observationAdd));
 document.getElementById('activity-pair-form').onsubmit=event=>{event.preventDefault();void saveActivityPair();};document.getElementById('activity-pair-date').onchange=()=>void loadActivityPairDate();
 document.getElementById('observation-form').onsubmit=event=>{event.preventDefault();void saveObservation();};document.getElementById('observation-delete').onclick=()=>saveObservation(true);
 document.getElementById('observation-date').onchange=()=>{syncSleepDuration(true);void loadObservationDate();};document.getElementById('observation-reload').onclick=()=>loadObservationDate(true);document.getElementById('observation-coverage').onchange=observationCoverage;
 for(const id of ['observation-start','observation-end'])document.getElementById(id).oninput=()=>syncSleepDuration(true);
}
