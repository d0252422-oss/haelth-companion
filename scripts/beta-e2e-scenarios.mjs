// Reusable scenario compiler, not a remote executor. Payload references are resolved
// by a future normal-session adapter; never substitute arbitrary client user IDs.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createE2ePlan,validateE2ePlan} from './beta-remote-e2e-plan.mjs';
export function compileScenarios(projectRef,date){
 const plan=createE2ePlan(projectRef);validateE2ePlan(plan);
 assert.match(date,/^\d{4}-\d{2}-\d{2}$/);assert.equal(new Date(date+'T00:00:00Z').toISOString().slice(0,10),date);
 const steps=[];
 const add=(domain,phase,action,payload,assertions,extra={})=>{
  const step={id:`${domain}.${phase}`,account:'A',domain,phase,action,payload,assertions,...extra};steps.push(step);return step;
 };
 const ref=(step,field)=>({$receipt:step,field});
 for(const domain of ['body','nutrition','sleep','steps','total_energy']){
  const observation=['sleep','steps','total_energy'].includes(domain);
  const write=domain==='body'?'upsertBodyRecord':domain==='nutrition'?'upsertMealRecord':'upsertManualObservation';
  const read=domain==='body'?'getBodyRecords':domain==='nutrition'?'getNutritionRecords':'getManualObservations';
  const del=domain==='body'?'deleteBodyRecord':domain==='nutrition'?'deleteMealRecord':'deleteManualObservation';
  const status=domain==='body'?'getBodyWriteStatus':domain==='nutrition'?'getMealWriteStatus':'getObservationWriteStatus';
  const payload=domain==='body'?{date,weight:70.5,bodyFat:null}:domain==='nutrition'?{date,time:'12:00',foodName:'SYNTHETIC '+plan.runId,userConfirmed:true,calories:210.5,protein:10.25,carbs:null,fat:5.5}:{date,domain,timezone:'Asia/Taipei',value:domain==='steps'?6000:domain==='sleep'?420:2000,coverage:domain==='sleep'?'SESSION':'FULL_DAY',cutoffTime:null,startedAt:null,endedAt:null,note:plan.runId,sourceNote:null};
  const create=add(domain,'create',write,{...payload,clientRequestId:randomUUID()},['acknowledged_server_id','positive_revision','persist_before_ui']);
  add(domain,'replay',write,structuredClone(create.payload),['same_record_id','no_duplicate','receipt_replayed']);
  add(domain,'status',status,{clientRequestId:create.payload.clientRequestId},['exists_true','same_record_id']);
  const readPayload={date,...(observation?{domain}:{})};
  add(domain,'read',read,readPayload,['exact_created_id_present','expected_values']);
  add(domain,'other_user_read',read,readPayload,['created_id_absent'],{account:'B'});
  const idKey=domain==='nutrition'?'mealRecordId':'recordId';
  const update=add(domain,'update',write,{...payload,[idKey]:ref(create.id,'recordId'),revision:ref(create.id,'record.revision'),clientRequestId:randomUUID(),...(domain==='body'?{weight:71.25}:domain==='nutrition'?{protein:11.75}:domain==='steps'?{value:8000}:domain==='sleep'?{value:450}:{value:2200})},['same_record_id','revision_increases','replacement_not_addition']);
  add(domain,'read_after_update',read,readPayload,['updated_values','no_duplicate','null_stays_null']);
  if(observation)add(domain,'daily_projection','getManualObservationDaily',{date},[domain==='steps'?'steps.value_equals_8000':domain==='total_energy'?'totalEnergy.value_equals_2200':'duration_only_no_invented_stages']);
  add(domain,'cross_user_delete',del,{[idKey]:ref(create.id,'recordId'),revision:ref(update.id,'record.revision'),clientRequestId:randomUUID()},['exact_tenant_denial_not_5xx'],{account:'B',mustNotChangeRecord:true});
  add(domain,'delete',del,{[idKey]:ref(create.id,'recordId'),revision:ref(update.id,'record.revision'),clientRequestId:randomUUID()},['same_run_owned_id','acknowledged_delete'],{requiresOwnershipReceipt:true});
  add(domain,'read_after_delete',read,readPayload,['created_id_absent']);
 }
 const ex=add('exercise','create','manageExercise',{operation:'create',name:'SYNTHETIC '+plan.runId,muscleGroup:'腿',clientRequestId:randomUUID()},['acknowledged_server_id','positive_revision']);
 add('exercise','replay','manageExercise',structuredClone(ex.payload),['same_record_id','receipt_replayed']);
 add('exercise','read','getExerciseDatabase',{},['created_exercise_present']);
 let previous=ex;
 for(const operation of ['rename','archive','restore'])previous=add('exercise',operation,'manageExercise',{operation,exerciseId:ref(ex.id,'exerciseId'),revision:ref(previous.id,'revision'),clientRequestId:randomUUID(),...(operation==='rename'?{name:'SYNTHETIC renamed '+plan.runId}:{})},['stable_id','revision_increases',operation+'_readback_required']);
 const training=add('training','create','addWorkoutRecord',{date,startTime:date+'T01:00:00Z',endTime:date+'T01:20:00Z',clientRequestId:randomUUID(),exercises:[{exerciseId:ref(ex.id,'exerciseId'),sets:[{weight:10,reps:5}]}]},['exactly_one_set','acknowledged_server_id']);
 add('training','replay','addWorkoutRecord',structuredClone(training.payload),['same_record_id','receipt_replayed','no_duplicate']);
 add('training','read','getWorkoutRecords',{date},['created_set_present','volume_50']);
 add('training','other_user_read','getWorkoutRecords',{date},['created_id_absent'],{account:'B'});
 const update=add('training','update','updateWorkoutSet',{date,recordId:ref(training.id,'records.0.recordId'),revision:ref(training.id,'records.0.revision'),exerciseId:ref(ex.id,'exerciseId'),weight:12.5,reps:6,clientRequestId:randomUUID()},['stable_exercise_id','history_preserved','volume_75','revision_increases']);
 add('training','read_after_update','getWorkoutRecords',{date},['updated_values','single_set']);
 add('exercise','referenced_delete_denied','manageExercise',{operation:'delete',exerciseId:ref(ex.id,'exerciseId'),revision:ref(previous.id,'revision'),clientRequestId:randomUUID()},['EXERCISE_REFERENCED'],{requiresOwnershipReceipt:true});
 add('training','delete','deleteWorkoutSet',{recordId:ref(training.id,'records.0.recordId'),revision:ref(update.id,'record.revision'),clientRequestId:randomUUID()},['same_run_owned_id','acknowledged_delete'],{requiresOwnershipReceipt:true});
 add('training','read_after_delete','getWorkoutRecords',{date},['created_id_absent']);
 // Soft-deleted training history still references this exercise: do NOT force-delete it.
 add('exercise','preserve_history','getExerciseDatabase',{},['referenced_exercise_retained']);
 const unused=add('exercise','unused_create','manageExercise',{operation:'create',name:'SYNTHETIC unused '+plan.runId,muscleGroup:'腿',clientRequestId:randomUUID()},['acknowledged_server_id']);
 add('exercise','safe_delete','manageExercise',{operation:'delete',exerciseId:ref(unused.id,'exerciseId'),revision:ref(unused.id,'revision'),clientRequestId:randomUUID()},['acknowledged_delete','only_unreferenced_owned_exercise'],{requiresOwnershipReceipt:true});
 return {schema:'beta-e2e-scenarios-v1',plan,steps,execution:'NOT_RUN',remote_mutations:0,
  preconditions:['two dedicated normal sessions','empty synthetic test dates verified before writes','accepted PG/migration/runtime/rollback gates','exact target per request'],
  timeout_policy:'STOP_WRITES_QUERY_SAME_REQUEST_STATUS; never regenerate request ID or clean an uncertain record',
  remaining_acceptance:['A/B symmetric row-isolation','anonymous and forged denial with exact auth errors','profile/dashboard/timeline/score contracts','actual browser reload/new-context/cache isolation'],
  preservation:'Referenced exercise retained as same-run synthetic history; report its ID, never destructive cleanup.'};
}
export function validateScenarios(bundle){
 validateE2ePlan(bundle.plan);assert.equal(bundle.schema,'beta-e2e-scenarios-v1');assert.equal(bundle.execution,'NOT_RUN');assert.equal(bundle.remote_mutations,0);
 const seen=new Set();let writes=0;
 for(const step of bundle.steps){
  assert.ok(!seen.has(step.id));assert.ok(['A','B'].includes(step.account));
  const check=value=>{if(value&&typeof value==='object'){if(value.$receipt)assert.ok(seen.has(value.$receipt),'FORWARD_OR_UNKNOWN_RECEIPT');else for(const v of Object.values(value))check(v);}};check(step.payload);
  if(step.payload.clientRequestId){writes++;assert.match(step.payload.clientRequestId,/^[a-f0-9-]{36}$/);}
  if(step.phase==='replay')assert.deepEqual(step.payload,bundle.steps.find(s=>s.id===step.domain+'.create').payload);
  if(/^(deleteBodyRecord|deleteMealRecord|deleteManualObservation|deleteWorkoutSet)$/.test(step.action)&&step.account==='A')assert.equal(step.requiresOwnershipReceipt,true);
  seen.add(step.id);
 }
 assert.ok(writes<=bundle.plan.maxMutations);assert.equal(new Set(bundle.steps.map(s=>s.domain)).size,7);
 return {status:'PASS_SCENARIO_COMPILATION_ONLY',steps:bundle.steps.length,planned_mutation_attempts:writes,remote_acceptance:'NOT_RUN',browser_acceptance:'NOT_RUN'};
}
