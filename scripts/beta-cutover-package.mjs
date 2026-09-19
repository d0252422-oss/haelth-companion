// One-command OFFLINE preparation. No fetch, credentials, SQL execution or deploy.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {audit} from './audit-beta-preparation.mjs';
import {targets,probeTarget,requiredGates,freshMigrationOrder,migrationOrder,evaluateCutover} from './beta-cutover-preflight.mjs';
import {verifyArtifact,sha256} from './verify-beta-review-artifact.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function buildPlan(projectRef,inventory,sourceRevision){
 const selected=targets[projectRef];if(!selected)throw Error('UNAPPROVED_BETA_TARGET');
 const fresh=projectRef===probeTarget.projectRef,order=fresh?freshMigrationOrder:migrationOrder;
 const migrations=order.map(version=>{const rows=inventory.all_migrations.filter(m=>m.version===version);if(rows.length!==1)throw Error('MIGRATION_NOT_UNIQUE:'+version);return {...rows[0],rehearsal:'NOT_ATTESTED',destructive:'REQUIRES_STATEMENT_REVIEW'};});
 const expected=freshMigrationOrder.join(',');
 if(inventory.all_migrations.map(m=>m.version).join(',')!==expected)throw Error('MIGRATION_INVENTORY_DRIFT_REVIEW_REQUIRED');
 return {schema:'beta-cutover-offline-package-v1',status:'PREPARED_DRY_RUN_ONLY',source_revision:sourceRevision,target:selected,migration_mode:fresh?'fresh':'incremental',migrations,
  roles:['health_manual_api','health_native_ingest','health_recompute_worker'],
  privilege_source:['20260916144345','20260916215632'],
  settings_names:[...inventory.settings,'HEALTH_BACKGROUND_SQL_ENABLED','HEALTH_NATIVE_DATABASE_URL','HEALTH_RECOMPUTE_DATABASE_URL','HEALTH_RECOMPUTE_TRIGGER_SECRET','BETA_WEB_AUTH_VERIFY_URL'],
  ordered_stages:['fresh target/PG/cost/recovery evidence','fresh zero-schema rehearsal and statement review','runtime roles/grants and secure settings','missing migrations only','Edge deploy and auth/data smoke','verified frontend overlay and Beta-only publication','dedicated A/B CRUD/isolation/persistence','same-run bounded cleanup'],
  commands:{
   edge_deploy:['supabase','functions','deploy','mobile-health-beta','--project-ref',projectRef,'--workdir','<verified-candidate-root>','--import-map','supabase/functions/mobile-health-beta/deno.json','--no-verify-jwt'],
   settings:['supabase','secrets','set','--project-ref',projectRef,'--env-file','<private-reviewed-settings-file-outside-package>'],
   edge_rollback:fresh?null:['supabase','functions','deploy','mobile-health-beta','--project-ref',projectRef,'--workdir','<verified-previous-artifact-root>','--import-map','supabase/functions/mobile-health-beta/deno.json','--no-verify-jwt'],
   migration_executor:'Official apply_migration per reviewed missing version/hash; NOT db push of this full source directory',
   frontend_executor:'Dedicated Beta repository only: reviewed additive commit and authorized normal push; no shell/eval command generated',
  },
  command_limits:['Commands are argument templates, NOT executed by this program.','verify_jwt=false preserves the reviewed custom session handler; auth smoke remains mandatory.','Secrets file is neither read nor copied by preparation.'],
  rollback:{mode:fresh?'FIRST_DEPLOY_NO_PREVIOUS_NEW_EDGE':'EXACT_OLD_EDGE_SOURCE_REDEPLOY',old_beta_preserved:true,frontend_source:'53736e644aaa79163d521daa44c7e87c82ad3126',edge_source:'a69cb3322f0cfc09a9d2c720e85aff92ec84bcfb',frontend_gate:'SOURCE_ONLY_LIVE_RECOVERY_NOT_VERIFIED',data_policy:'CODE_CONFIG_ONLY_NO_SQL_REWIND_OR_ROW_DELETE',first_deploy_failure:'Keep Web unchanged and provider OFF; preserve new DB. Never deploy old-target config into new project.'},
  remote_e2e:{status:'PREPARED_NOT_EXECUTED',read_smoke_module:'scripts/beta-remote-read-smoke.mjs',live_write_adapter:'NOT_BOUND_TO_REAL_SESSIONS_OR_REHEARSED_REMOTE_SCHEMA',max_raw_rows:24,max_mutations:80,accounts:'DEDICATED_NORMAL_A_B_SESSIONS_NO_TOKEN_EXPORT',run_id:'beta-smoke-<UUID>',domains:['body','nutrition','training','sleep','steps','total_energy','exercise'],checks:['CRUD','read_after_write','idempotency','steps6000to8000','no_energy_double_count','null_decimal_nutrition','A_B_isolation','anonymous_forged_denied','reload_new_context','cache_environment_isolation'],cleanup:'Only exact IDs in same-run ownership manifest; preserve uncertain/unacknowledged records',legacy_script:'verify-beta-score-live.ps1 is NOT this manual CRUD runner; never invoke as a substitute'},
  post_cutover:{task:'WORKOUT_SAVE_LATENCY_POST_SQL_FIRST',activation:'ACCEPTED_ACTUAL_REMOTE_SQL_FIRST_PASS_ONLY',driver:'scripts/beta-next-gate.mjs',command:['node','scripts/beta-next-gate.mjs','--acceptance','<reviewed-D-remote-acceptance.json>','--output','<new-D-evidence-task-directory>'],vendor_response_rule:'scripts/beta-next-gate.mjs#vendorResponseDecision',current_status:'DEFERRED_UNTIL_SQL_FIRST'},
  connector_activation:'DEFERRED; Android/iOS remain separately pinned to old Beta',
  remaining_gates:['PG_SECURITY_PLATFORM_GATE','FRESH_PROJECT_MIGRATION_REHEARSAL','DESTRUCTIVE_STATEMENT_REVIEW','ACTUAL_CLI_EDGE','DEDICATED_RUNTIME_CREDENTIALS','FRONTEND_LIVE_ROLLBACK','REMOTE_MANUAL_E2E_AND_REAL_AB_AUTH'],
  remote_mutations:0};
}

export async function preparePackage({output,projectRef}){
 if(typeof output!=='string'||!path.isAbsolute(output))throw Error('ABSOLUTE_D_EVIDENCE_OUTPUT_REQUIRED');
 const evidenceRoot=await fs.realpath('D:/Dev/Evidence');
 const parent=await fs.realpath(path.dirname(output));
 const relative=path.relative(evidenceRoot,parent);
 if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('OUTPUT_OUTSIDE_D_EVIDENCE');
 const inventory=audit(),revision=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
 const plan=buildPlan(projectRef,inventory,revision);
 await fs.mkdir(output,{recursive:false});
 const candidate=path.join(output,'candidate');
 execFileSync(process.execPath,[path.join(repo,'scripts/prepare-manual-beta-package.mjs'),candidate,'--release=AB'],{cwd:repo,stdio:'pipe'});
 const integrity=await verifyArtifact(candidate);
 // Artifact remains OFF. The target-specific overlay is separate for review.
 const overlay={enabled:true,release:'AB',schemaVersion:'manual-sql-v1',projectRef,endpoint:`https://${projectRef}.supabase.co/functions/v1/mobile-health-beta/v1/engine/web`};
 const overlayBytes=Buffer.from('globalThis.HEALTH_MANUAL_SQL_CONFIG=Object.freeze('+JSON.stringify(overlay)+');\n');
 await fs.writeFile(path.join(output,'manual-sql-config.PROPOSED.js'),overlayBytes,{flag:'wx'});
 plan.overlay={file:'manual-sql-config.PROPOSED.js',sha256:sha256(overlayBytes),applied:false,requires_rehashed_frontend_artifact:true};
 plan.candidate=integrity;
 const attestation={sourceRevision:revision,target:{...plan.target,verifiedAt:null},platform:{serverVersionNum:170006,source:'Prior observed build, NOT fresh mutation-boundary evidence'},migrationMode:plan.migration_mode,gates:Object.fromEntries([...requiredGates,'FRESH_PROJECT_MIGRATION_REHEARSAL'].map(n=>[n,{status:'NOT_ATTESTED',evidence:null}])),migrations:plan.migrations.map(m=>({version:m.version,sha256:m.sha256,destructive:null,rehearsal:'NOT_ATTESTED'})),authorization:{projectRef,sourceRevision:revision,explicitOwnerApproval:false,operations:{}},note:'Template only. Existing conditional chat authorization is not revoked; execution evidence/operation binding is still required.'};
 const decision=evaluateCutover(attestation);
 for(const [name,value]of Object.entries({'cutover-plan.json':plan,'attestation.TEMPLATE.json':attestation,'dry-run.json':decision}))await fs.writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
 return {status:plan.status,output,source_revision:revision,migrations:plan.migrations.length,candidate_files:integrity.files,decision:decision.status,blocking_gates:decision.blockers,remote_mutations:0};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length!==4||args[0]!=='--output'||args[2]!=='--target')throw Error('USAGE: --output D:/Dev/Evidence/<new-directory> --target <allowlisted-ref>; offline only, no execute mode');
 console.log(JSON.stringify(await preparePackage({output:args[1],projectRef:args[3]}),null,2));
}
