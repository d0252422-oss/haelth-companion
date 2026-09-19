// Vendor-wait driver: resumable OFFLINE validation only. Remote modes fail closed.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {targets,freshMigrationOrder,migrationOrder,evaluateCutover} from './beta-cutover-preflight.mjs';
import {validateConfigWiring} from './beta-config-wiring.mjs';
import {verifyArtifact} from './verify-beta-review-artifact.mjs';
import {createE2ePlan,validateE2ePlan} from './beta-remote-e2e-plan.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const digest=b=>createHash('sha256').update(b).digest('hex');
export const modes=['preflight','dryrun','migrate','deploy-edge','deploy-web','e2e','rollback','full'];
export function assertDDirectory(value,{create=false}={}){
 if(!value||!path.isAbsolute(value))throw Error('ABSOLUTE_D_EVIDENCE_DIRECTORY_REQUIRED');
 const root=fs.realpathSync('D:/Dev/Evidence');
 const actual=fs.realpathSync(fs.existsSync(value)?value:path.dirname(value));
 const relative=path.relative(root,actual);
 if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('OUTSIDE_D_EVIDENCE');
 if(create&&!fs.existsSync(value))fs.mkdirSync(value);
 if(!fs.statSync(value).isDirectory())throw Error('DIRECTORY_REQUIRED');
 return fs.realpathSync(value);
}
export function validatePlan(plan){
 const target=targets[plan.target?.projectRef];
 if(!target||plan.target.projectRef===target.productionRef)throw Error('TARGET_DENIED');
 for(const [key,value]of Object.entries(target))if(plan.target[key]!==value)throw Error('TARGET_IDENTITY_MISMATCH');
 const order=plan.migration_mode==='fresh'?freshMigrationOrder:migrationOrder;
 if(plan.target.projectRef==='dsdfacbjaicdcwayhhil'&&plan.migration_mode!=='fresh')throw Error('FRESH_PROBE_REQUIRED');
 if(!['fresh','incremental'].includes(plan.migration_mode)||plan.migrations?.map(x=>x.version).join(',')!==order.join(','))throw Error('MIGRATION_ORDER_DRIFT');
 if(plan.remote_mutations!==0||plan.schema!=='beta-cutover-offline-package-v1')throw Error('OFFLINE_PLAN_REQUIRED');
 if(plan.rollback?.data_policy!=='CODE_CONFIG_ONLY_NO_SQL_REWIND_OR_ROW_DELETE')throw Error('DATA_ROLLBACK_DENIED');
 if(plan.roles?.join(',')!=='health_manual_api,health_native_ingest,health_recompute_worker')throw Error('ROLE_CONTRACT_DRIFT');
 if(plan.commands?.edge_deploy?.includes('--prune'))throw Error('DESTRUCTIVE_COMMAND_DENIED');
 // Never execute arbitrary commands or settings supplied in this JSON.
 return target;
}
export async function runDriver({mode='dryrun',projectRef,packageDirectory,output,resume=false,attestationFile}){
 if(!modes.includes(mode))throw Error('MODE_DENIED');
 if(!targets[projectRef])throw Error('TARGET_DENIED');
 const pkg=assertDDirectory(packageDirectory),out=assertDDirectory(output,{create:true});
 if(pkg===out)throw Error('SEPARATE_CHECKPOINT_DIRECTORY_REQUIRED');
 const lock=path.join(out,'driver.lock'),fd=fs.openSync(lock,'wx');
 try{
  const bytes=fs.readFileSync(path.join(pkg,'cutover-plan.json')),plan=JSON.parse(bytes),planHash=digest(bytes);
  validatePlan(plan);if(plan.target.projectRef!==projectRef)throw Error('EXPLICIT_TARGET_MISMATCH');
  const head=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
  if(plan.source_revision!==head)throw Error('PACKAGE_SOURCE_HEAD_CHANGED');
  const checkpointPath=path.join(out,'checkpoint.json');
  if(fs.existsSync(checkpointPath)&&!resume)throw Error('RESUME_REQUIRED');
  if(resume&&!fs.existsSync(checkpointPath))throw Error('RESUME_CHECKPOINT_MISSING');
  const state=resume?JSON.parse(fs.readFileSync(checkpointPath)): {schema:'cutover-checkpoint-v1',projectRef,sourceRevision:head,planHash,stages:[]};
  if(state.projectRef!==projectRef||state.sourceRevision!==head||state.planHash!==planHash)throw Error('RESUME_BINDING_MISMATCH');
  const persist=()=>{const temp=path.join(out,'checkpoint.'+process.pid+'.tmp');fs.writeFileSync(temp,JSON.stringify(state,null,2)+'\n',{flag:'wx'});fs.renameSync(temp,checkpointPath);};
  state.stages.push({sequence:state.stages.length+1,mode,at:new Date().toISOString(),status:'RUNNING_OFFLINE',checks:[]});persist();
  const active=state.stages.at(-1);
  // Reverify bytes each invocation, even when a previous checkpoint says PASS.
  const checks=active.checks;
  try{
  const integrity=await verifyArtifact(path.join(pkg,'candidate'));checks.push({name:'candidate_integrity',status:'PASS',files:integrity.files});
  persist();
  for(const migration of plan.migrations){
   const candidates=fs.readdirSync(path.join(repo,'supabase/migrations')).filter(f=>f.startsWith(migration.version+'_')&&f.endsWith('.sql'));
   if(candidates.length!==1||digest(fs.readFileSync(path.join(repo,'supabase/migrations',candidates[0])))!==migration.sha256)throw Error('MIGRATION_BYTES_CHANGED:'+migration.version);
  }
  checks.push({name:'migration_inventory',status:'PASS',count:plan.migrations.length,statement_safety:'NOT_PROVEN_BY_HASH'});
  persist();
  const overlay=fs.readFileSync(path.join(pkg,'manual-sql-config.PROPOSED.js'));
  if(digest(overlay)!==plan.overlay?.sha256||plan.overlay.applied!==false)throw Error('WEB_OVERLAY_CHANGED');
  const expected='globalThis.HEALTH_MANUAL_SQL_CONFIG=Object.freeze('+JSON.stringify({enabled:true,release:'AB',schemaVersion:'manual-sql-v1',projectRef,endpoint:`https://${projectRef}.supabase.co/functions/v1/mobile-health-beta/v1/engine/web`})+');\n';
  if(overlay.toString()!==expected)throw Error('WEB_TARGET_OR_PROVIDER_DRIFT');
  checks.push({name:'web_overlay',status:'PASS_UNAPPLIED'});
  persist();
  validateE2ePlan(createE2ePlan(projectRef));checks.push({name:'synthetic_plan',status:'PASS_STATIC'});
  persist();
  validateConfigWiring(plan);checks.push({name:'config_secret_names',status:'PASS_SOURCE_WIRING_ONLY'});persist();
  // Default template is intentionally NOT_ATTESTED. Never infer gate PASS from package integrity.
  let attestation=JSON.parse(fs.readFileSync(path.join(pkg,'attestation.TEMPLATE.json')));
  if(attestationFile){assertDDirectory(path.dirname(attestationFile));if(!path.isAbsolute(attestationFile)||fs.lstatSync(attestationFile).isSymbolicLink()||fs.statSync(attestationFile).size>262144)throw Error('NON_SECRET_D_ATTESTATION_REQUIRED');attestation=JSON.parse(fs.readFileSync(attestationFile));}
  const decision=evaluateCutover(attestation);
  if(attestation.target?.projectRef!==projectRef||attestation.sourceRevision!==head)decision.blockers.push('ATTESTATION_PACKAGE_BINDING_MISMATCH');
  if(JSON.stringify(attestation.migrations?.map(({version,sha256})=>({version,sha256})))!==JSON.stringify(plan.migrations.map(({version,sha256})=>({version,sha256}))))decision.blockers.push('ATTESTATION_MIGRATION_HASH_MISMATCH');
  if(decision.blockers.length)decision.status='STOP_REMOTE_MUTATION';
  const mutatingMode=!['preflight','dryrun'].includes(mode);
  const status=mode==='dryrun'?'PASS_OFFLINE_VALIDATION':decision.blockers.length?'BLOCKED_PRECONDITIONS':mutatingMode?'BLOCKED_CURRENT_RUN_REMOTE_MUTATION_FORBIDDEN':'PASS_OFFLINE_PRECONDITIONS_NOT_REMOTE_APPROVAL';
  const result={mode,status,precheck:decision,projectRef,sourceRevision:head,checks,
   pg_requirement:'PostgreSQL 17.x plus explicit risk-based Internal Beta acceptance; production remains separately blocked',pg_gate:'RISK_BASED_INTERNAL_BETA',paid_operations:'DENIED',destructive_operations:'DENIED',
   rollback:{edge:'PRIOR_EXACT_SOURCE_ACCEPTED_NOT_REEXPORTED',web:plan.rollback.frontend_gate,data:plan.rollback.data_policy},
   deployment_ready:false,remote_mutations:0,limitations:['No live executor activated in vendor-wait phase.','Migration rehearsal, actual grants, private settings validity and live Web recovery are not established by offline inspection.']};
  Object.assign(active,result);persist();
  return result;
  }catch(error){active.status='FAIL_OFFLINE_VALIDATION';active.error='ARTIFACT_OR_CONTRACT_VALIDATION_FAILED';persist();throw error;}
 }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i++){const key=args[i];if(key==='--resume'){options.resume=true;continue;}if(!['--mode','--projectRef','--packageDirectory','--output','--attestationFile'].includes(key)||!args[i+1]||args[i+1].startsWith('--'))throw Error('INVALID_ARGUMENT');options[key.slice(2)]=args[++i];}
 const result=await runDriver(options);console.log(JSON.stringify(result,null,2));process.exitCode=result.status.startsWith('BLOCKED')?2:0;
 }catch(error){console.error(error.message);process.exitCode=1;}
}
