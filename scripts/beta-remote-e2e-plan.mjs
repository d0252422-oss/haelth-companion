// Executable static contract / evidence validator. Never contacts a hosted API.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {targets} from './beta-cutover-preflight.mjs';
export function createE2ePlan(projectRef){
 assert.ok(targets[projectRef],'TARGET_DENIED');
 const domains={body:['upsertBodyRecord','getBodyRecords','upsertBodyRecord','deleteBodyRecord','getBodyWriteStatus'],nutrition:['upsertMealRecord','getNutritionRecords','upsertMealRecord','deleteMealRecord','getMealWriteStatus'],training:['addWorkoutRecord','getWorkoutRecords','updateWorkoutSet','deleteWorkoutSet','getTrainingWriteStatus'],sleep:['upsertManualObservation','getManualObservations','upsertManualObservation','deleteManualObservation','getObservationWriteStatus'],steps:['upsertManualObservation','getManualObservations','upsertManualObservation','deleteManualObservation','getObservationWriteStatus'],total_energy:['upsertManualObservation','getManualObservations','upsertManualObservation','deleteManualObservation','getObservationWriteStatus'],exercise:['manageExercise','getExerciseDatabase','manageExercise','manageExercise','getTrainingWriteStatus']};
 return {schema:'beta-remote-e2e-plan-v1',projectRef,runId:'beta-smoke-'+randomUUID(),mode:'STATIC_ONLY',maxRawRows:24,maxMutations:80,
  domains:Object.entries(domains).map(([domain,actions])=>({domain,actions,checks:domain==='exercise'?['create','rename','archive','restore','safe_delete','stable_id','history_preserved']:['create','read','update','delete','revision','read_after_write','same_request_id_replay']})),
  invariants:{steps:'6000 -> 8000 = 8000, not 14000',total_energy:'update replaces total, no BMR/active/workout double count',nutrition:'decimal macros; unknown stays null',sleep:'duration-only; cross-midnight; overlap',training:'nonnegative load, integer reps; draft preserved'},
  reads:['getUserProfile','getDashboardData','getHealthTimeline','localEngineSnapshot'],
  isolation:['A reads A','B reads B','A cannot read B','A cannot modify B','B cannot read A','anonymous denied','forged identity denied'],
  browser:['reload persistence','new-context persistence','logout/login','account cache isolation','environment cache isolation','SQL provider status'],
  cleanup:'Only acknowledged exact IDs owned by this run/account. Unknown timeout: receipt reconciliation before cleanup. Never date-range or bulk deletion.',
  write_activation:'NOT_IMPLEMENTED_BY_STATIC_DRIVER; requires separately reviewed real-session adapter',remote_mutations:0};
}
export function validateE2ePlan(plan){
 assert.ok(targets[plan.projectRef],'TARGET_DENIED');assert.equal(plan.mode,'STATIC_ONLY');assert.equal(plan.remote_mutations,0);
 assert.match(plan.runId,/^beta-smoke-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
 const expected=createE2ePlan(plan.projectRef);
 for(const key of ['domains','invariants','reads','isolation','browser','cleanup','maxRawRows','maxMutations','write_activation'])assert.deepEqual(plan[key],expected[key],key+'_DRIFT');
 return {status:'PASS_STATIC_PLAN',domain_count:plan.domains.length,remote_acceptance:'NOT_RUN',remote_mutations:0};
}
export function assertCleanupReceipt({plan,receipt,account,recordId,revision}){
 validateE2ePlan(plan);
 assert.ok(['A','B'].includes(account));assert.ok(typeof recordId==='string'&&recordId.length>0);
 assert.equal(receipt?.projectRef,plan.projectRef);assert.equal(receipt?.runId,plan.runId);assert.equal(receipt?.account,account);assert.equal(receipt?.recordId,recordId);
 assert.equal(receipt?.status,'ACKNOWLEDGED');assert.equal(receipt?.revision,revision);assert.ok(Number.isInteger(revision)&&revision>0);
 assert.match(receipt?.requestId||'',/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
 return true; // Input checks only; server receipt authenticity must be independently verified.
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length!==4||args[0]!=='--target'||args[2]!=='--output')throw Error('USAGE --target REF --output NEW_D_FILE');
 const output=args[3],parent=fs.realpathSync(path.dirname(output)),root=fs.realpathSync('D:/Dev/Evidence'),relative=path.relative(root,parent);
 if(!path.isAbsolute(output)||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('D_EVIDENCE_REQUIRED');
 const plan=createE2ePlan(args[1]),validation=validateE2ePlan(plan);fs.writeFileSync(output,JSON.stringify({plan,validation},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(validation));
}
