// Conditional local work queue. No scheduler, network, credentials or deploy executor.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {targets} from './beta-cutover-preflight.mjs';
import {assertDDirectory} from './beta-cutover-driver.mjs';
export const acceptanceGates=['BETA_SQL_FIRST_CUTOVER','PG_SECURITY_PLATFORM_GATE','BETA_MIGRATION','BETA_EDGE_DEPLOY','REMOTE_CRUD','REMOTE_USER_ISOLATION'];
export function postSqlFirstDecision(report){
 const blocked=acceptanceGates.filter(name=>report?.gates?.[name]?.status!=='PASS'||!report.gates[name].evidence);
 if(!targets[report?.projectRef]||report?.schema!=='beta-remote-acceptance-v1'||report?.execution!=='ACTUAL_REMOTE'||report?.accepted!==true||!/^([a-f0-9]{40})$/.test(report?.sourceRevision||''))blocked.push('ACCEPTED_REMOTE_EVIDENCE_REQUIRED');
 return {task_id:'WORKOUT_SAVE_LATENCY_POST_SQL_FIRST',status:blocked.length?'DEFERRED_UNTIL_SQL_FIRST':'READY_TO_MEASURE',blockers:blocked,
  blocks_cutover:false,measurements:['CLICK_TO_REQUEST_START','REQUEST_START_TO_DB_COMMIT','DB_COMMIT_TO_API_RESPONSE','API_RESPONSE_TO_UI_READY','BACKGROUND_RECOMPUTE_DURATION','TRAINING_RANGE_REFRESH_DURATION'],
  statistics:['median','p95','worst_observed','sample_count'],optimization:'ONLY_IF_MEASURED_ISSUE',remote_mutations:0};
}
export function vendorResponseDecision(response){
 if(!response)return {status:'WAITING_VENDOR_RESPONSE',no_new_vendor_evidence:true,next:'NONE',model:'GPT-5.6'};
 // A routing hint is not approval or proof of security equivalence.
 const url=new URL(response.sourceUrl);assert.equal(url.protocol,'https:');assert.ok(['supabase.com','api.supabase.com'].includes(url.hostname));
 assert.ok(typeof response.evidence==='string'&&response.evidence.length>0);
 if(response.kind==='UPGRADE_PATH'){
  assert.ok(Number.isInteger(response.targetServerVersionNum)&&response.targetServerVersionNum>=170011&&response.targetServerVersionNum<180000);
  return {status:'REVIEW_PATH_AND_REVALIDATE_ALL_PRECONDITIONS',next:'CUTOVER_PREFLIGHT',model:'GPT-5.6',remote_authorized:false};
 }
 if(response.kind==='BACKPORT_MAPPING')return {status:'SECURITY_EQUIVALENCE_REVIEW_REQUIRED',next:'OFFICIAL_EVIDENCE_ADJUDICATION',model:'GPT-6',remote_authorized:false};
 assert.equal(response.kind,'NEITHER_AVAILABLE');
 return {status:'SUPABASE_PLATFORM_LIMITATION',next:'ALTERNATE_PROVIDER_DECISION_PACKAGE_ONLY',model:'GPT-5.6',provider_switch_authorized:false};
}
export function enqueuePostSqlFirst({reportFile,output}){
 assert.ok(path.isAbsolute(reportFile));assertDDirectory(path.dirname(reportFile));
 assert.ok(!fs.lstatSync(reportFile).isSymbolicLink()&&fs.statSync(reportFile).size<262144);
 const bytes=fs.readFileSync(reportFile),report=JSON.parse(bytes),decision=postSqlFirstDecision(report);
 const out=assertDDirectory(output,{create:true}),queue=path.join(out,'post-sql-first-task.json');
 // Failed/missing prerequisites never write an ACTIVE task, even when a prior queue exists.
 if(decision.blockers.length)return decision;
 for(const name of acceptanceGates){
  const evidence=report.gates[name].evidence;
  assert.ok(path.isAbsolute(evidence.path));assertDDirectory(path.dirname(evidence.path));
  assert.ok(!fs.lstatSync(evidence.path).isSymbolicLink());
  assert.match(evidence.sha256,/^[a-f0-9]{64}$/);
  assert.equal(createHash('sha256').update(fs.readFileSync(evidence.path)).digest('hex'),evidence.sha256,'EVIDENCE_HASH_MISMATCH');
 }
 const task={...decision,acceptance_sha256:createHash('sha256').update(bytes).digest('hex'),projectRef:report.projectRef,sourceRevision:report.sourceRevision,
  evidence_semantics:'Final acceptance must be reviewed; file hashes alone do not establish real remote PASS.'};
 if(fs.existsSync(queue)){assert.deepEqual(JSON.parse(fs.readFileSync(queue)),task,'EXISTING_TASK_BINDING_DIFFERS');return {...task,queue:'ALREADY_ENQUEUED'};}
 fs.writeFileSync(queue,JSON.stringify(task,null,2)+'\n',{flag:'wx'});return {...task,queue:'ENQUEUED'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const a=process.argv.slice(2);assert.ok(a.length===4&&a[0]==='--acceptance'&&a[2]==='--output');
 const result=enqueuePostSqlFirst({reportFile:a[1],output:a[3]});console.log(JSON.stringify(result,null,2));process.exitCode=result.status==='DEFERRED_UNTIL_SQL_FIRST'?2:0;
}
