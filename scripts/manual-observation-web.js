// The original quick-add and detail screens use the same SQL/auth provider.
let observationEditor=null,observationReadSerial=0;
const observationLabels={sleep:'睡眠',steps:'步數',total_energy:'總消耗熱量'};
function resetManualObservationState(){observationEditor=null;observationReadSerial++;for(const id of ['sleep-manual-records','activity-manual-records'])document.getElementById(id)?.replaceChildren?.();}
function observationStatus(text,error=false){const el=document.getElementById('observation-status');el.textContent=text;el.setAttribute('role',error?'alert':'status');}
function observationControls(locked){document.querySelectorAll('#observation-form input,#observation-form select,#observation-form textarea').forEach(el=>el.disabled=locked);}
function observationCoverage(){const sleep=document.getElementById('observation-domain').value==='sleep',partial=document.getElementById('observation-coverage').value==='PARTIAL_DAY';document.getElementById('observation-cutoff').required=!sleep&&partial;document.getElementById('observation-cutoff-group').hidden=sleep||!partial;}
async function openObservationEditor(domain,record=null){
 if(!manualSqlEnabled())return toast('手動睡眠／活動僅在 SQL 模式提供；未切換其他資料來源。');
 if(observationEditor?.pending){openSheet('observation-form');observationStatus('上一筆寫入狀態尚待確認，請重試同一筆要求。',true);return;}
 if(!Object.hasOwn(observationLabels,domain))throw Error('INVALID_OBSERVATION_DOMAIN');
 const form=document.getElementById('observation-form');form.reset();observationControls(false);
 observationEditor={user:currentUser,epoch:localSessionEpoch,record,serial:++observationReadSerial,pending:null,loadedDate:record?.date||getLocalDateString(),loading:false};
 document.getElementById('observation-domain').value=domain;document.getElementById('observation-date').value=record?.date||getLocalDateString();document.getElementById('observation-date').max=getLocalDateString();
 document.getElementById('observation-title').textContent=(record?'編輯':'新增')+observationLabels[domain];
 document.getElementById('observation-value-label').textContent=domain==='sleep'?'睡眠時長（分鐘）':domain==='steps'?'當日累積步數（不是增量）':'當日總消耗（kcal，不含再次加計 BMR／運動）';
 const value=document.getElementById('observation-value');value.value=record?.value??'';value.step=domain==='steps'?'1':'any';value.max=domain==='sleep'?'1440':'';
 document.getElementById('observation-coverage-group').hidden=domain==='sleep';document.getElementById('observation-time-group').hidden=domain!=='sleep';
 document.getElementById('observation-coverage').value=record?.coverage||'FULL_DAY';document.getElementById('observation-cutoff').value=record?.cutoffTime||'';
 for(const [id,key]of[['observation-note','note'],['observation-source-note','sourceNote']])document.getElementById(id).value=record?.[key]||'';
 const localInstant=iso=>iso?new Date(Date.parse(iso)+8*3600000).toISOString().slice(0,16):'';
 document.getElementById('observation-start').value=localInstant(record?.startedAt);document.getElementById('observation-end').value=localInstant(record?.endedAt);
 document.getElementById('observation-delete').hidden=!record;document.getElementById('observation-delete').disabled=!record;document.getElementById('observation-save').disabled=false;observationCoverage();openSheet('observation-form');
 observationStatus(domain==='sleep'?'只有時長也可保存；不推算入睡時間、睡眠階段或效率。':'手動資料為自行回報；同日自動來源有衝突時不相加、不猜最大值。');
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
  state.loadedDate=date;state.loading=false;observationControls(false);observationCoverage();document.getElementById('observation-save').disabled=false;document.getElementById('observation-delete').disabled=!state.record||state.record.date!==date;observationStatus(state.record?(domain==='sleep'?'已重新載入同一筆睡眠的最新版本。':'已載入；修改會覆寫當日累積值，不與舊值相加。'):'此日尚無手動紀錄。');
 }catch(error){if(observationEditor===state&&serial===observationReadSerial){state.loading=false;observationControls(false);document.getElementById('observation-save').disabled=true;document.getElementById('observation-delete').disabled=true;observationStatus(readableError(error)+'；請按「重新載入」。',true);}}
}
function observationPayload(){
 const valueText=document.getElementById('observation-value').value,domain=document.getElementById('observation-domain').value,value=valueText===''?null:Number(valueText);
 if(value===null||!Number.isFinite(value)||value<0||domain==='steps'&&!Number.isSafeInteger(value))throw Error('請輸入有效數值；空白不等於 0。');
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
  state.pending=null;observationEditor=null;closeSheet();toast('紀錄已保存至 SQL；分析狀態請見紀錄。');clearDashboardCache();sectionLoadKeys.clear();
  const section=result.record.domain==='sleep'?'sleep':'activity',range=sectionWindows[section];await refreshSectionRange(section,range.start,range.end);
 }catch(error){if(observationEditor===state&&state.user===currentUser){if(error.code&&error.retryable===false){state.pending=null;observationControls(false);}observationStatus(readableError(error)+(state.pending?'；結果待確認，重試會使用同一要求。':''),true);}}
 finally{state.saving=false;if(observationEditor===state&&state.user===currentUser&&state.epoch===localSessionEpoch){const ready=!!state.pending||!state.loading&&state.loadedDate===document.getElementById('observation-date').value;button.disabled=!ready;document.getElementById('observation-delete').disabled=!ready||!state.record||!!state.pending;}}
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
 document.getElementById('observation-form').onsubmit=event=>{event.preventDefault();void saveObservation();};document.getElementById('observation-delete').onclick=()=>saveObservation(true);
 document.getElementById('observation-date').onchange=()=>loadObservationDate();document.getElementById('observation-reload').onclick=()=>loadObservationDate(true);document.getElementById('observation-coverage').onchange=observationCoverage;
}
