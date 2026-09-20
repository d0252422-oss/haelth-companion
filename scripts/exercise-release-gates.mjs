// Called only inside the owned native-PG + real browser runner. All rows are synthetic.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import postgres from 'postgres';
async function fkBarrier(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('FK_WRITER_BARRIER_TIMEOUT')),5000);})]);}finally{clearTimeout(timer);}}
export async function runExerciseReleaseGates(h){
  const {pg,subjects,gate,http,loginCookie,browserContext,until,record,evidence,day,shift,base,report,setPage}=h;
  const a=await loginCookie('A'),b=await loginCookie('B');
  const A=subjects.A.canonical,B=subjects.B.canonical;
  const invoke=async(cookie,action,payload)=>{const r=await http(cookie,action,payload);assert.equal(r.ok,true,JSON.stringify(r));return r.data;};
  const catalog=()=>invoke(a,'getExerciseDatabase',{});
  const manage=async(id,operation,extra={})=>{const row=(await catalog()).find(e=>e.exerciseId===id);return invoke(a,'manageExercise',{exerciseId:id,operation,revision:row.revision,clientRequestId:randomUUID(),...extra});};
  const session=(id,date=day)=>({date,startTime:day+'T01:00:00Z',endTime:day+'T01:20:00Z',clientRequestId:randomUUID(),exercises:[{exerciseId:id,sets:[{weight:0,reps:10},{weight:10,reps:5}]}]});
  await pg.admin`insert into public.manual_exercise_catalog values('custom-A',${A},'SYNTHETIC A 自訂','胸'),('unused-A',${A},'SYNTHETIC A 無引用','胸'),('custom-B',${B},'SYNTHETIC B 私有','背'),('race-A',${A},'SYNTHETIC 併發','腿')`;
  await gate('default_handler_cors_auth_and_mapping',async()=>{
    const pre=await fetch(base+'/v1/engine/web',{method:'OPTIONS',headers:{origin:base,'access-control-request-method':'POST','access-control-request-headers':'content-type,authorization'}});
    assert.equal(pre.status,204);assert.equal(pre.headers.get('access-control-allow-origin'),base);assert.equal(pre.headers.get('access-control-allow-methods'),'POST, OPTIONS');
    assert.equal((await fetch(base+'/v1/engine/web',{method:'OPTIONS',headers:{origin:'https://invalid.example'}})).status,403);
    assert.equal((await fetch(base+'/v1/engine/web',{method:'GET'})).status,405);
    const prefixed=await fetch(base+'/functions/v1/mobile-health-beta/v1/engine/web',{method:'POST',headers:{cookie:a,'content-type':'application/json',origin:base},body:JSON.stringify({action:'getExerciseDatabase',payload:{}})});
    assert.equal(prefixed.status,200);assert.equal(prefixed.headers.get('access-control-allow-origin'),base);assert.equal(prefixed.headers.get('cache-control'),'no-store');assert.equal((await prefixed.json()).ok,true);
    assert.equal((await http('', 'getExerciseDatabase')).ok,false);
    assert.equal((await http('engine_session=not-a-signed-token','getExerciseDatabase')).ok,false);
    assert.equal((await http(await loginCookie('A',{expired:true}),'getExerciseDatabase')).ok,false);
    assert.equal((await http(await loginCookie('MISSING'),'getExerciseDatabase')).ok,false);
    assert.equal((await http(a,'getWorkoutRecords',{canonical_user_id:B})).ok,false);
    await assert.rejects(()=>pg.admin`insert into private.beta_native_auth_identities(auth_user_id,canonical_user_id,provider) values(${subjects.A.auth},${B},'google')`,e=>e.code==='23505');
    const mapped=await pg.admin`select canonical_user_id from private.beta_native_auth_identities where auth_user_id=${subjects.A.auth}`;assert.equal(mapped[0].canonical_user_id,A);assert.notEqual(subjects.A.auth,A);
    const saved=await invoke(a,'upsertBodyRecord',{date:shift(-3),weight:80,clientRequestId:randomUUID()});assert.equal(saved.analysisStatus,'INSUFFICIENT_DATA');assert.equal(saved.analysisReason,'MISSING_BODY_BASELINE_OR_TARGET');assert.equal(saved.analysisJobScheduled,false);
    const read=await invoke(a,'getBodyRecords',{date:shift(-3)});assert.equal(read[0].analysisJobScheduled,false);
    report.new_auth_evidence={mapping_conflict:'DB unique constraint rejected conflicting A -> B mapping, original mapping unchanged',canonical_differs_from_auth:true,live_oauth:'NOT_RUN',middleware:'actual @supabase/server@1.4.1 auth:none + real synthetic signature verification, no mocked SQL'};
    record('Actual default handler preflight/methods/prefixed route and valid/invalid/expired/missing/conflicting identities');
  });
  await gate('exercise_sql_receipts_rls_history_and_validation',async()=>{
    const before=await pg.admin`select canonical_user_id,score_date,score_type,score,algorithm_version from public.beta_health_scores order by canonical_user_id,score_date,score_type`;
    const initial=await catalog();assert.equal(initial.some(e=>e.exerciseId==='custom-B'),false);
    const body=session('custom-A'),created=await invoke(a,'addWorkoutRecord',body);assert.equal(created.records.length,2);
    const replay=await invoke(a,'addWorkoutRecord',body);assert.equal(replay.replayed,true);assert.deepEqual(replay.records,created.records);
    assert.equal((await http(a,'addWorkoutRecord',{...body,exercises:[{exerciseId:'custom-A',sets:[{weight:22,reps:2}]}]})).error,'REQUEST_ID_CONFLICT');
    await manage('custom-A','rename',{name:'SYNTHETIC A 新名稱'});
    let row=(await catalog()).find(e=>e.exerciseId==='custom-A');assert.equal(row.exerciseName,'SYNTHETIC A 新名稱');
    assert.equal((await http(a,'manageExercise',{exerciseId:'custom-A',operation:'rename',name:'stale',revision:0,clientRequestId:randomUUID()})).error,'STALE_REVISION');
    const records=(await invoke(a,'getWorkoutRecords',{date:day})).records;assert.ok(records.every(r=>r.exerciseName==='SYNTHETIC A 自訂'));assert.equal(records.reduce((s,r)=>s+r.totalVolume,0),50);
    await manage('global:barbell-back-squat','rename',{name:'<img src=x onerror=alert(1)> 個人別名'});
    assert.equal((await invoke(b,'getExerciseDatabase',{})).find(e=>e.exerciseId==='global:barbell-back-squat').exerciseName,'槓鈴深蹲');
    await manage('custom-A','archive');assert.equal((await http(a,'addWorkoutRecord',session('custom-A'))).error,'EXERCISE_ARCHIVED');
    await assert.rejects(()=>pg.admin.begin(async tx=>{await tx.unsafe('set local role service_role');await tx`update public.manual_exercise_catalog set owner_user_id=${B} where exercise_id='custom-A'`;}),e=>e.code==='42501');
    await assert.rejects(()=>pg.admin.begin(async tx=>{await tx.unsafe('set local role service_role');await tx`insert into public.manual_workout_sets(canonical_user_id,record_id,exercise_id,session_id,local_date,revision,body) values(${A},${randomUUID()},'custom-A',${randomUUID()},${day},1,${tx.json({source:'MANUAL_WEB'})})`;}),/EXERCISE_ARCHIVED/);
    const old=records[0],updated=await invoke(a,'updateWorkoutSet',{recordId:old.recordId,revision:old.revision,date:shift(-1),exerciseId:'custom-A',weight:15,reps:2,clientRequestId:randomUUID()});
    assert.equal(updated.record.exerciseName,old.exerciseName);assert.equal(updated.record.exerciseId,old.exerciseId);assert.deepEqual(updated.invalidatedDates,[day,shift(-1)]);
    assert.equal((await invoke(a,'getWorkoutRecords',{date:day})).records.length,1);assert.equal((await invoke(a,'getWorkoutRecords',{date:shift(-1)})).records.length,1);
    const across=await invoke(a,'getWorkoutRecords',{startDate:shift(-1),endDate:day});assert.equal(across.sessionCount,1);assert.equal(across.durationMinutes,20);
    assert.equal((await http(a,'manageExercise',{exerciseId:'custom-A',operation:'delete',revision:(await catalog()).find(e=>e.exerciseId==='custom-A').revision,clientRequestId:randomUUID()})).error,'EXERCISE_REFERENCED');
    await manage('custom-A','restore');
    for(const name of ['', '   ', 'x'.repeat(81), 'unsafe\u202ename'])assert.equal((await http(a,'manageExercise',{exerciseId:'custom-A',operation:'rename',name,revision:(await catalog()).find(e=>e.exerciseId==='custom-A').revision,clientRequestId:randomUUID()})).error,'INVALID_EXERCISE_NAME');
    assert.equal((await http(a,'manageExercise',{exerciseId:'custom-B',operation:'delete',revision:0,clientRequestId:randomUUID()})).error,'EXERCISE_NOT_FOUND');
    const low=await pg.admin.begin(async tx=>{await tx.unsafe('set local role authenticated');await tx`select set_config('request.jwt.claim.sub',${subjects.B.auth},true)`;return {catalog:await tx`select exercise_id from public.manual_exercise_catalog`,rows:await tx`select record_id from public.manual_workout_sets`};});
    assert.equal(low.catalog.some(r=>r.exercise_id==='custom-A'),false);assert.equal(low.rows.length,0);
    for(const table of ['manual_exercise_catalog','manual_exercise_preferences','manual_workout_sets'])await assert.rejects(()=>pg.admin.begin(async tx=>{await tx.unsafe('set local role anon');await tx.unsafe('select * from public.'+table);}));
    await assert.rejects(()=>pg.admin.begin(async tx=>{await tx.unsafe('set local role authenticated');await tx`select set_config('request.jwt.claim.sub',${subjects.A.auth},true)`;await tx`update public.manual_exercise_catalog set exercise_name='forged' where exercise_id='custom-A'`;}));
    await assert.rejects(()=>pg.admin.begin(async tx=>{await tx.unsafe('set local role service_role');await tx`insert into public.manual_exercise_preferences(canonical_user_id,exercise_id) values(${A},'custom-B')`;}),/EXERCISE_OWNER_MISMATCH/);
    const after=await pg.admin`select canonical_user_id,score_date,score_type,score,algorithm_version from public.beta_health_scores order by canonical_user_id,score_date,score_type`;assert.deepEqual(after,before);
    report.exercise_security={read_role:'authenticated; NOSUPERUSER NOBYPASSRLS; not owner',write_role:'service_role BYPASSRLS with separately tested server canonical guard + FK owner trigger',raw_manual_workout_score_adapter:'NOT_CONNECTED_NO_JOB',template_store:'NOT_IMPLEMENTED_NO_EXISTING_REFERENCES'};
    record('Stable IDs, preserved snapshots, system personal alias, RLS/tenant guard, validation, replay and unchanged frozen scores');
  });
  await gate('exercise_concurrency_lock_rollback_and_delete',async()=>{
    const before=(await invoke(a,'getWorkoutRecords',{})).records.length;
    const bad=session('custom-A');bad.exercises[0].sets.push({weight:0,reps:-1});assert.equal((await http(a,'addWorkoutRecord',bad)).ok,false);assert.equal((await invoke(a,'getWorkoutRecords',{})).records.length,before);assert.equal((await invoke(a,'getTrainingWriteStatus',{clientRequestId:bad.clientRequestId})).exists,false);
    let release,signal;const held=new Promise(r=>signal=r),released=new Promise(r=>release=r);
    const holding=pg.admin.begin(async tx=>{await tx`select pg_advisory_xact_lock(hashtextextended(${A},0))`;signal();await released;});
    const payload={exerciseId:'race-A',operation:'rename',revision:0,name:'SYNTHETIC race renamed',clientRequestId:randomUUID()};let elapsed;
    try{await held;const start=performance.now(),response=await http(a,'manageExercise',payload);elapsed=performance.now()-start;assert.equal(response.error,'DB_TIMEOUT_RETRYABLE');assert.equal(response.http_status,503);assert.ok(elapsed<6000);}finally{release();await holding;}
    const results=await Promise.all([invoke(a,'manageExercise',payload),invoke(a,'manageExercise',payload)]);assert.ok(results.some(r=>r.replayed));assert.equal((await catalog()).find(e=>e.exerciseId==='race-A').revision,1);
    // Launch reference insertion and deletion concurrently through the actual API.
    // Either valid serialization is acceptable, but no successful write may dangle.
    const [reference,del]=await Promise.all([http(a,'addWorkoutRecord',session('race-A')),http(a,'manageExercise',{exerciseId:'race-A',operation:'delete',revision:1,clientRequestId:randomUUID()})]);
    assert.ok(reference.ok!==del.ok);if(reference.ok)assert.equal(del.error,'EXERCISE_REFERENCED');else assert.equal(reference.error,'EXERCISE_NOT_FOUND');
    assert.equal((await pg.admin`select s.record_id from public.manual_workout_sets s left join public.manual_exercise_catalog c using(exercise_id) where c.exercise_id is null`).length,0);
    // Independent direct SQL FK race: holding a committed-reference insertion's key
    // lock blocks delete; after commit delete fails, never cascades to history.
    await pg.admin`insert into public.manual_exercise_catalog values('fk-race',${A},'SYNTHETIC FK race','腿')`;
    await pg.admin`insert into public.manual_exercise_preferences(canonical_user_id,exercise_id) values(${A},'fk-race')`;
    let inserted,commit;const ready=new Promise(r=>inserted=r),finish=new Promise(r=>commit=r),rid=randomUUID();
    const sid=randomUUID(),validBody={source:'MANUAL_WEB',recordId:rid,sessionId:sid,exerciseId:'fk-race',exerciseName:'SYNTHETIC FK race',muscleGroup:'腿',date:day,weight:0,reps:1,totalSets:1,totalVolume:0,durationMinutes:1,revision:1};
    const major=Number((await pg.admin`show server_version_num`)[0].server_version_num)/10000|0;
    assert.ok([17,18].includes(major));
    const fkWriter=postgres({...pg.config,username:'engine_owner',max:1}),fkDeleter=postgres({...pg.config,username:'engine_owner',max:1});
    let writing,restricted;
    try{
    writing=fkWriter.begin(async tx=>{await tx.unsafe("set local idle_in_transaction_session_timeout='5s'");await tx`insert into public.manual_workout_sets(canonical_user_id,record_id,exercise_id,session_id,local_date,revision,body) values(${A},${rid},'fk-race',${sid},${day},1,${tx.json(validBody)})`;inserted();await finish;});
    writing.catch(()=>{}); // Result is still awaited below; avoid unhandled rejection during fault recovery.
    await fkBarrier(ready);
    const deleting=fkDeleter.begin(async tx=>{await tx.unsafe("set local lock_timeout='4s'");await tx`delete from public.manual_exercise_preferences where canonical_user_id=${A} and exercise_id='fk-race'`;}).then(()=>({deleted:true}),e=>({code:e.code}));
    // Version-specific upstream ri_ReportViolation: PG17 uses FK23503; PG18 distinguishes RESTRICT23001.
    // See postgres/postgres REL_17_STABLE and REL_18_STABLE src/backend/utils/adt/ri_triggers.c.
    commit();await writing;restricted=await deleting;assert.equal(restricted.code,major===17?'23503':'23001');
    }finally{commit();await Promise.allSettled([writing]);await Promise.all([fkWriter.end({timeout:2}),fkDeleter.end({timeout:2})]);}
    assert.equal((await pg.admin`select record_id from public.manual_workout_sets where record_id=${rid}`).length,1);
    report.restrict_sqlstate={server_major:major,actual:restricted.code,contract:'referenced preference cannot be deleted; existing history retained',upstream:'https://github.com/postgres/postgres/blob/REL_'+major+'_STABLE/src/backend/utils/adt/ri_triggers.c'};
    report.training_lock={database:pg.evidence.database,version:pg.evidence.binary_version,configured_lock_ms:2000,observed_http_ms:elapsed,scope:'LOCAL_OBSERVATION_NOT_ONLINE_SLA'};
    record('Atomic invalid session rollback, bounded lock retry, concurrent replay, API race and SQL FK reference/delete race');
  });
  await gate('browser_exercise_management_and_archived_history',async()=>{
    let {page:p,context}=await browserContext('A');setPage(p);
    const training=async()=>{await p.setViewportSize({width:1280,height:900});await p.locator('.side-btn[data-screen="training-screen"]').click();await p.locator('#manage-exercises').click();await p.locator('#exercise-manager-status').filter({hasText:'SQL 已讀回'}).waitFor();};
    await training();
    const item=id=>p.locator(`#exercise-manager-list article[data-exercise-id="${id}"]`);
    assert.equal(await item('custom-B').count(),0);assert.equal(await item('global:barbell-back-squat').locator('img').count(),0);
    let lost=false;
    await context.route(base+'/v1/engine/web',async route=>{const input=route.request().postDataJSON();if(!lost&&input.action==='manageExercise'&&input.payload.exerciseId==='custom-A'&&input.payload.operation==='rename'){lost=true;const response=await route.fetch();assert.equal((await response.json()).ok,true);await route.abort('failed');return;}await route.continue();});
    await item('custom-A').locator('.exercise-manage-name').fill('SYNTHETIC Browser 改名');await item('custom-A').locator('[data-operation="rename"]').click({clickCount:2});
    await until(async()=>(await catalog()).find(e=>e.exerciseId==='custom-A').exerciseName==='SYNTHETIC Browser 改名','browser-rename');
    await until(()=>report.http.some(r=>r.action==='getTrainingWriteStatus'&&r.response.data?.exists),'training-receipt-recovery');assert.equal(lost,true);
    await item('custom-A').locator('[data-operation="archive"]').click();await item('custom-A').locator('[data-operation="restore"]').waitFor();
    await p.locator('#start-workout').click();assert.equal(await p.locator('#exercise-select option[value="custom-A"]').count(),0);await p.locator('#back-training').click();
    const history=(await invoke(a,'getWorkoutRecords',{date:day})).records.find(r=>r.exerciseId==='custom-A');
    await p.locator(`.workout-edit-button[data-record-id="${history.recordId}"]`).click();assert.equal(await p.locator('#edit-workout-exercise').inputValue(),'custom-A');
    await p.locator('#edit-workout-weight').fill('0');await p.locator('#edit-workout-reps').fill('12');await p.locator('#edit-workout-save').click();await p.locator('#workout-edit-form').waitFor({state:'hidden'});
    await until(async()=>{const r=(await invoke(a,'getWorkoutRecords',{date:day})).records.find(r=>r.recordId===history.recordId);return r.weight===0&&r.reps===12&&r.exerciseName===history.exerciseName&&r.exerciseId===history.exerciseId;},'archived-history-edit');
    // Permanent deletion remains distinct and requires the exact native confirmation.
    const confirm=async(id,answer)=>{const received=new Promise(resolve=>p.once('dialog',resolve));const clicked=item(id).locator('[data-operation="delete"]').click();const dialog=await Promise.race([received,new Promise((_,reject)=>setTimeout(()=>reject(Error('EXPECTED_EXERCISE_CONFIRM_MISSING')),5000))]);assert.equal(dialog.message(),'永久刪除此自訂動作？只有沒有任何歷史引用的項目才能刪除；無法復原。');await dialog[answer]();await clicked;report.dialogs.push({kind:'exercise-permanent-delete',id,answer});};
    await confirm('custom-A','accept');await item('custom-A').locator('.exercise-manage-result').filter({hasText:'有歷史引用'}).waitFor();
    await confirm('unused-A','dismiss');assert.equal((await catalog()).some(e=>e.exerciseId==='unused-A'),true);
    await confirm('unused-A','accept');await until(async()=>!(await catalog()).some(e=>e.exerciseId==='unused-A'),'unused-delete');
    await item('custom-A').locator('[data-operation="restore"]').click();await item('custom-A').locator('[data-operation="archive"]').waitFor();
    await p.screenshot({path:path.join(evidence,'exercise-manager-history-preserved.png'),fullPage:true});
    ({page:p}=await browserContext('A'));setPage(p);await training();assert.equal(await item('custom-A').locator('.exercise-manage-name').inputValue(),'SYNTHETIC Browser 改名');assert.equal(await item('unused-A').count(),0);
    const keys=await p.evaluate(()=>{const before=dashboardCacheKey('2026-09-01','2026-09-02');const original=window.HEALTH_ENGINE_LOCAL_CONFIG.databaseNamespace;window.HEALTH_ENGINE_LOCAL_CONFIG.databaseNamespace='different-synthetic-db';const after=dashboardCacheKey('2026-09-01','2026-09-02');window.HEALTH_ENGINE_LOCAL_CONFIG.databaseNamespace=original;return {before,after};});assert.notEqual(keys.before,keys.after);
    ({page:p}=await browserContext('B'));setPage(p);await training();assert.equal(await item('custom-A').count(),0);assert.equal(await item('global:barbell-back-squat').locator('.exercise-manage-name').inputValue(),'槓鈴深蹲');
    record('Real browser rename/recovered lost response/archive/archived history edit/delete cancel+accept/restore/new context/B isolation; environment cache namespace differs');
  });
  await gate('browser_workout_create_zero_response_loss_and_delete',async()=>{
    const {page:p,context}=await browserContext('A');setPage(p);await p.setViewportSize({width:1280,height:900});
    const date=shift(-2);await h.customRange(p,date,date);await p.locator('.side-btn[data-screen="training-screen"]').click();await p.locator('#manage-exercises').click();await p.locator('#exercise-manager-status').filter({hasText:'SQL 已讀回'}).waitFor();
    await p.locator('#start-workout').click();await p.locator('#muscle-group-select').selectOption('LEGS');await p.locator('#exercise-select').selectOption('global:barbell-back-squat');await p.locator('#add-exercise').click();
    await p.locator('#workout-date').fill(date);await p.locator('.exercise-weight').fill('0');await p.locator('.exercise-reps').fill('10');await p.locator('.complete-set').click();let lost=false,receiptLost=false;const submissions=[];
    await context.route(base+'/v1/engine/web',async route=>{const input=route.request().postDataJSON();if(input.action==='addWorkoutRecord'){submissions.push(input);if(!lost){lost=true;const real=await route.fetch();assert.equal((await real.json()).ok,true);await route.abort('failed');return;}}if(lost&&!receiptLost&&input.action==='getTrainingWriteStatus'){receiptLost=true;await route.abort('failed');return;}await route.continue();});
    await p.locator('#finish-workout').click({clickCount:2});await until(async()=>receiptLost&&await p.locator('#finish-workout').isEnabled(),'unresolved-draft-retry');
    assert.equal(await p.locator('#back-training').isDisabled(),true);assert.equal(await p.locator('#workout-date').isDisabled(),true);
    await p.locator('.side-btn[data-screen="settings-screen"]').click();await p.locator('.side-btn[data-screen="training-screen"]').click();await p.locator('#finish-workout').waitFor({state:'visible'});
    await p.setViewportSize({width:390,height:844});await p.locator('#quick-open').click();await p.locator('.quick-option[data-action="workout"]').click();await p.locator('#finish-workout').waitFor({state:'visible'});
    assert.equal(await p.locator('.set-log').innerText().then(s=>s.includes('0 kg × 10')),true);
    await p.locator('#finish-workout').click();await p.locator('#training-overview').waitFor({state:'visible'});assert.equal(submissions.length,2);assert.deepEqual(submissions[0],submissions[1]);await p.setViewportSize({width:1280,height:900});
    const saved=await until(async()=>{const result=await invoke(a,'getWorkoutRecords',{date});return result.records.length?result:false;},'browser-workout-created');assert.equal(saved.records.length,1);assert.equal(saved.totalVolume,0);assert.equal(lost,true);
    await p.locator('#training-volume').filter({hasText:'0 kg'}).waitFor();
    const id=saved.records[0].recordId;await p.locator(`.workout-edit-button[data-record-id="${id}"]`).click();
    const dialog=new Promise(resolve=>p.once('dialog',resolve)),click=p.locator('#edit-workout-delete').click();const native=await dialog;assert.equal(native.message(),'確定刪除這一組訓練紀錄？此動作無法復原。');await native.accept();await click;await p.locator('#workout-edit-form').waitFor({state:'hidden'});
    await until(async()=>(await invoke(a,'getWorkoutRecords',{date})).records.length===0,'workout-set-tombstone');
    const retained=(await pg.admin`select deleted,body from public.manual_workout_sets where canonical_user_id=${A} and record_id=${id}`)[0];assert.equal(retained.deleted,true);assert.equal(retained.body.exerciseId,'global:barbell-back-squat');
    await p.reload();await p.locator('.side-btn[data-screen="training-screen"]').click();await p.locator('#training-volume').filter({hasText:'—'}).waitFor();
    record('Existing workout form creates SQL once despite double click/lost response; zero volume displayed, individual set deletion preserves catalog and tombstone');
  });
  await gate('verified_web_session_canonical_mapping_sql_and_browser',async()=>{
    const hash=s=>createHash('sha256').update(s).digest('hex'),webA=await loginCookie('A',{kind:'web'}),webB=await loginCookie('B',{kind:'web'});
    if(report.runtime_role==='health_manual_api_NO_MEMBERSHIP_NO_BYPASSRLS')await pg.admin`delete from private.beta_web_identity_aliases where web_subject_hash=${hash('web-session-'+subjects.A.auth)}`;
    assert.equal((await http(webA,'getBodyRecords',{date:day})).error,'WEB_IDENTITY_NOT_LINKED');
    const webOnly=randomUUID();await pg.admin`insert into public.users(id,external_subject_hash,timezone) values(${webOnly},${hash('WEB_ONLY_SYNTHETIC')},'Asia/Taipei')`;
    try{
    for(const [name,canonical]of [['A',A],['B',B],['MISSING',webOnly]])await pg.admin`insert into private.beta_web_identity_aliases(web_subject_hash,verified_email_hash,canonical_user_id) values(${hash('web-session-'+subjects[name].auth)},${hash(name.toLowerCase()+'@example.invalid')},${canonical}) on conflict do nothing`;
    const aliases=()=>pg.admin`select * from private.beta_web_identity_aliases order by web_subject_hash`,users=()=>pg.admin`select * from public.users order by id`;
    const beforeAliases=await aliases(),beforeUsers=await users();
    const only=await invoke(await loginCookie('MISSING',{kind:'web'}),'getCurrentUser',{});assert.equal(only.user.userId,webOnly);
    assert.equal((await pg.admin`select 1 from private.beta_native_auth_identities where canonical_user_id=${webOnly}`).length,0);
    assert.equal((await http(await loginCookie('A',{kind:'web',expired:true}),'getBodyRecords',{date:day})).error,'INVALID_WEB_SESSION');
    assert.equal((await http('engine_web_session=forged','getBodyRecords',{date:day})).error,'INVALID_WEB_SESSION');
    assert.equal((await http(webA,'getBodyRecords',{canonical_user_id:B,date:day})).error,'CLIENT_IDENTITY_FORBIDDEN');
    const input={date:shift(-4),weight:65,bodyFat:0,clientRequestId:randomUUID()},body=await invoke(webA,'upsertBodyRecord',input);assert.equal((await invoke(webA,'upsertBodyRecord',input)).replayed,true);
    assert.equal((await invoke(webB,'getBodyRecords',{date:shift(-4)})).length,0);assert.equal((await invoke(webB,'getBodyWriteStatus',{clientRequestId:input.clientRequestId})).exists,false);
    assert.equal((await invoke(webA,'getBodyRecords',{date:shift(-4)}))[0].recordId,body.recordId);
    assert.equal((await http(webB,'deleteBodyRecord',{recordId:body.recordId,revision:1,clientRequestId:randomUUID()})).ok,false);
    const mealInput={date:shift(-4),time:'12:00',foodName:'SYNTHETIC verified Web session meal',userConfirmed:true,calories:200,protein:10,carbs:20,fat:5,clientRequestId:randomUUID()};
    const meal=await invoke(webA,'upsertMealRecord',mealInput);assert.equal((await invoke(webB,'getNutritionRecords',{date:shift(-4)})).length,0);assert.equal((await invoke(webB,'getWorkoutRecords',{date:day})).records.length,0);assert.equal((await invoke(webB,'getExerciseDatabase',{})).some(r=>r.exerciseId==='custom-A'),false);
    assert.deepEqual(await aliases(),beforeAliases);assert.deepEqual(await users(),beforeUsers);
    // Synthetic fixture controls only: restore each original field in finally.
    try{await pg.admin`update private.beta_web_identity_aliases set verified_email_hash=${hash('mismatch@example.invalid')} where web_subject_hash=${hash('web-session-'+subjects.A.auth)}`;assert.equal((await http(webA,'getBodyRecords',{date:day})).error,'WEB_IDENTITY_CONFLICT');}
    finally{await pg.admin`update private.beta_web_identity_aliases set verified_email_hash=${hash('a@example.invalid')} where web_subject_hash=${hash('web-session-'+subjects.A.auth)}`;}
    try{await pg.admin`update public.users set status='REVOKED' where id=${A}`;assert.equal((await http(webA,'getBodyRecords',{date:day})).error,'WEB_IDENTITY_INACTIVE');}
    finally{await pg.admin`update public.users set status='ACTIVE' where id=${A}`;}
    const command=[process.env.DENO_EXECUTABLE||'deno','run','--cached-only','--frozen-lockfile','--node-modules-dir=none','--config','config/engine-local.deno.json','--allow-env','--allow-read','--allow-sys','--allow-net=127.0.0.1','scripts/check-manual-web-revocation.ts',path.join(evidence,'runtime-config.json')];
    const started=new Date().toISOString();let output='',exit=0;
    if(report.runtime_role==='health_manual_api_NO_MEMBERSHIP_NO_BYPASSRLS')command.push('--nonprivileged');
    try{output=execFileSync(command[0],command.slice(1),{cwd:process.cwd(),env:{...process.env,HEALTH_ENGINE_LOCAL_ONLY:'1'},windowsHide:true,encoding:'utf8',timeout:45000});}
    catch(error){exit=error.status??-1;output=String(error.stdout||'')+'\n'+String(error.stderr||'');}
    await writeFile(path.join(evidence,'web-revocation.stdout.log'),output);
    report.web_revocation_read_guard={command,cwd:process.cwd(),started_at:started,ended_at:new Date().toISOString(),exit_code:exit,report:'web-revocation.stdout.log'};
    assert.equal(exit,0,output);assert.equal(JSON.parse(output.trim()).checks.length,9);
    assert.deepEqual(await aliases(),beforeAliases);assert.deepEqual(await users(),beforeUsers);
    let {page:p}=await browserContext('WEB_A');setPage(p);await h.customRange(p,shift(-4),shift(-4));await h.bodyScreen(p);await p.locator('#body-current').filter({hasText:'65'}).waitFor();await h.weightEditor(p,shift(-4));await p.locator('#weight-input').fill('66');await p.locator('#weight-save').click();await p.locator('#weight-form').waitFor({state:'hidden'});
    ({page:p}=await browserContext('WEB_A'));setPage(p);await h.customRange(p,shift(-4),shift(-4));await h.bodyScreen(p);await p.locator('#body-current').filter({hasText:'66'}).waitFor();await p.locator('.mobile-nav-btn[data-screen="records-center"]').click();await p.locator(`[data-meal-record-id="${meal.recordId}"]`).waitFor();
    ({page:p}=await browserContext('WEB_B'));setPage(p);await h.customRange(p,shift(-4),shift(-4));await h.bodyScreen(p);assert.equal(await p.locator('#body-current').innerText(),'—');
    // Same browser context can recover from an expired opposite-provider cookie.
    await p.request.post(base+'/local-login',{data:{account:'A',expired:true}});
    await p.request.post(base+'/local-login',{data:{account:'B',kind:'web'}});
    let cookies=await p.context().cookies();assert.equal(cookies.some(c=>c.name==='engine_session'),false);assert.equal(cookies.some(c=>c.name==='engine_web_session'),true);
    let identityResponse=await p.request.post(base+'/v1/engine/web',{data:{action:'getCurrentUser',payload:{}}});assert.equal((await identityResponse.json()).data.user.userId,B);
    await p.request.post(base+'/local-login',{data:{account:'A'}});cookies=await p.context().cookies();assert.equal(cookies.some(c=>c.name==='engine_web_session'),false);
    identityResponse=await p.request.post(base+'/v1/engine/web',{data:{action:'getCurrentUser',payload:{}}});
    const nativeResult=await identityResponse.json();
    if(report.runtime_role==='health_manual_api_NO_MEMBERSHIP_NO_BYPASSRLS'){
      assert.equal(nativeResult.ok,false,'Web-only hosted adapter must reject native cookies');
      await p.request.post(base+'/local-login',{data:{account:'A',kind:'web'}});
      identityResponse=await p.request.post(base+'/v1/engine/web',{data:{action:'getCurrentUser',payload:{}}});assert.equal((await identityResponse.json()).data.user.userId,A);
    }else assert.equal(nativeResult.data.user.userId,A);
    const updated=(await invoke(webA,'getBodyRecords',{date:shift(-4)}))[0];await invoke(webA,'deleteBodyRecord',{recordId:updated.recordId,revision:updated.revision,clientRequestId:randomUUID()});await invoke(webA,'deleteMealRecord',{mealRecordId:meal.recordId,revision:1,clientRequestId:randomUUID()});
    report.web_session_authorization={status:'PASS_LOCAL_SYNTHETIC_VERIFIER',native_impersonation:false,role:report.runtime_role||'service_role BYPASSRLS, explicit verified canonical predicates and transaction recheck; NOT WEB_RLS_PASS',existing_aliases_users_timestamps_unchanged:true,missing_conflict_revoked_fail_closed:true,web_only_without_native_mapping:true,live_apps_script_verifier:'NOT_RUN',live_oauth:'NOT_RUN',identity_migration:'NONE'};
    record('Distinct verified Web sessions use read-only existing alias mapping, SQL CRUD/readback/new context/B isolation; no native JWT impersonation or account linking');
    }finally{
      // Restore the MISSING fixture's absent-alias state for later denial gates.
      // This alias was created above in this dedicated synthetic cluster only.
      await pg.admin`delete from private.beta_web_identity_aliases where canonical_user_id=${webOnly} and web_subject_hash=${hash('web-session-'+subjects.MISSING.auth)}`;
    }
  });
  await gate('browser_custom_exercise_create_category_duplicate_recovery',async()=>{
    const {context,page:p}=await browserContext('WEB_A');setPage(p);await p.setViewportSize({width:1280,height:900});await p.locator('.side-btn[data-screen="training-screen"]').click();await p.locator('#manage-exercises').click();
    await p.locator('#exercise-manager-status').filter({hasText:'SQL 已讀回'}).waitFor();
    const name='SYNTHETIC <b>duplicate</b>',created=[];let lost=false;
    await context.route(base+'/v1/engine/web',async route=>{
      const request=route.request().postDataJSON();if(!lost&&request.action==='manageExercise'&&request.payload.operation==='create'){lost=true;const actual=await route.fetch(),body=await actual.json();assert.equal(body.ok,true);created.push(body.data.exerciseId);await route.abort('failed');return;}await route.continue();
    });
    await p.locator('#exercise-create-name').fill(name);await p.locator('#exercise-create-category').fill('腿');await p.locator('#exercise-create-submit').click({clickCount:2});
    await until(async()=>created.length&&await p.locator(`article[data-exercise-id="${created[0]}"]`).count(),'custom-create-recovered');
    assert.equal((await catalog()).filter(r=>r.exerciseName===name).length,1);assert.equal(lost,true);
    const duplicate=await http(a,'manageExercise',{operation:'create',name:'  synthetic   <b>duplicate</b>  ',muscleGroup:'背',clientRequestId:randomUUID()});
    assert.equal(duplicate.error,'DUPLICATE_CUSTOM_EXERCISE_NAME');assert.equal((await catalog()).filter(r=>r.exerciseName===name).length,1);
    const entry=p.locator(`article[data-exercise-id="${created[0]}"]`);await entry.locator('.exercise-manage-category').fill('全身');await entry.locator('[data-operation="classify"]').click();
    await until(async()=>(await catalog()).find(r=>r.exerciseId===created[0]).muscleGroup==='全身','category-sql-readback');
    assert.equal(await p.locator('#exercise-manager-list b').count(),0,'names are literal text, not HTML');
    const {page:fresh}=await browserContext('WEB_A');setPage(fresh);await fresh.setViewportSize({width:1280,height:900});await fresh.locator('.side-btn[data-screen="training-screen"]').click();await fresh.locator('#manage-exercises').click();
    await fresh.locator(`article[data-exercise-id="${created[0]}"] .exercise-manage-category`).filter({visible:true}).waitFor();
    assert.equal(await fresh.locator(`article[data-exercise-id="${created[0]}"] .exercise-manage-category`).inputValue(),'全身');
    assert.match(await fresh.locator('#technical-provider-name').innerText(),/PostgreSQL/);assert.match(await fresh.locator('#technical-provider-updated').innerText(),/最近請求成功/);
    const {page:other}=await browserContext('WEB_B');setPage(other);await other.setViewportSize({width:1280,height:900});await other.locator('.side-btn[data-screen="training-screen"]').click();await other.locator('#manage-exercises').click();await other.locator('#exercise-manager-status').filter({hasText:'SQL 已讀回'}).waitFor();
    assert.equal(await other.locator(`article[data-exercise-id="${created[0]}"]`).count(),0);
    record('Original manager custom create lost-response/double-submit recovery, normalized same-owner duplicate rejection, category SQL read-back and fresh-context A/B isolation');
  });
}
