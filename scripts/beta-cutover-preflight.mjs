// Offline decision gate only. Does not execute SQL, fetch, deploy, or read credentials.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
export const target={projectRef:'uavimjgccigpbwqmfkhh',projectName:'health-companion-beta',organization:'pcfenospezigjlgwcbtg',region:'ap-southeast-1',databaseHost:'db.uavimjgccigpbwqmfkhh.supabase.co',poolHost:'aws-0-ap-southeast-1.pooler.supabase.com',function:'mobile-health-beta',frontend:'https://d0252422-oss.github.io/health-companion-beta/',productionRef:'vptqedxdxfoohbqctujf'};
// Allowlisting is not deployment approval; both targets still need fresh gates.
export const probeTarget={...target,projectRef:'dsdfacbjaicdcwayhhil',projectName:'health-companion-beta-v2',databaseHost:'db.dsdfacbjaicdcwayhhil.supabase.co'};
export const targets=Object.freeze(Object.assign(Object.create(null),{[target.projectRef]:target,[probeTarget.projectRef]:probeTarget}));
export const requiredGates=['ACTIVE_GIT_WRITE_SAFETY','AI_POOL_V2_SECURITY_GATE','ACTUAL_CLI_EDGE','ACTUAL_EDGE_RUNTIME','EDGE_SQL_INTEGRATION','POSTGRESQL_MIGRATION_REHEARSAL','RLS','AUTH_SESSION_MAPPING','USER_ISOLATION','MANUAL_BODY_SQL_E2E','MANUAL_NUTRITION_SQL_E2E','MANUAL_TRAINING_SQL_E2E','MANUAL_SLEEP_SQL_E2E','MANUAL_STEPS_SQL_E2E','MANUAL_TOTAL_ENERGY_SQL_E2E','EXERCISE_MANAGEMENT','SQL_READ_AFTER_WRITE','IDEMPOTENCY','UPDATE_DELETE','CACHE_ISOLATION','WEB_BROWSER_E2E','HEALTH_SCORE_REGRESSION','FRONTEND_BUILD','CRITICAL_REGRESSION'];
requiredGates.push('INTERNAL_BETA_SECURITY_GATE','EDGE_ROLLBACK_READY');
requiredGates.push('NON_PRIVILEGED_ADAPTER','POOL_CONTEXT_ISOLATION','NO_DESTRUCTIVE_OPERATION','PRODUCTION_TARGET_DIFFERENT');
export const migrationOrder=['20260912032458','20260912041126','20260912182042','20260913041844','20260913164024','20260913164026','20260913180000','20260913190152','20260916144345','20260916215632','20260920193000','20260920204500','20260920211500','20260920213000','20260920214500'];
export const freshMigrationOrder=['20260827010000','20260827015836','20260827023849','20260829045359','20260829082547','20260829083522','20260829090000','20260829090500','20260829091747','20260829135430','20260830141842','20260831000913','20260902150738','20260903021109','20260903062110','20260903130618',...migrationOrder];
export function evaluateCutover(input,now=Date.now()){
 const blockers=[];
 const selected=targets[input.target?.projectRef];
 if(!selected)blockers.push('TARGET_NOT_ALLOWLISTED');
 for(const [key,value]of Object.entries(selected||target))if(input.target?.[key]!==value)blockers.push('TARGET_MISMATCH:'+key);
 if(!Number.isSafeInteger(input.platform?.serverVersionNum)||input.platform.serverVersionNum<170000||input.platform.serverVersionNum>=180000)blockers.push('PG17_MAJOR_NOT_ACCEPTED');
 const checked=Date.parse(input.target?.verifiedAt);if(!Number.isFinite(checked)||checked>now||now-checked>86400000)blockers.push('TARGET_ATTESTATION_STALE');
 for(const name of requiredGates){const g=input.gates?.[name];const accepted=g?.status==='PASS'||name==='AI_POOL_V2_SECURITY_GATE'&&g?.status==='PASS_WITH_NON_BLOCKING_FINDINGS'||name==='INTERNAL_BETA_SECURITY_GATE'&&g?.status==='CONDITIONAL_PASS';if(!accepted||!g?.evidence)blockers.push('GATE_NOT_ACCEPTED:'+name);}
 const risk=input.internalBetaRisk;
 if(!risk||risk.directDbUserAccess!==false||risk.frontendHighPrivilegeSecret!==false||risk.arbitrarySqlExposure!==false||risk.tls!==true||risk.confirmedReachableCritical!==false||risk.rollback!==true)blockers.push('INTERNAL_BETA_SECURITY_RISK_NOT_ACCEPTED');
 const role=input.runtimeRole;
 if(!role||role.name!=='health_manual_api'||role.effectiveRole!=='health_manual_api'||['superuser','createdb','createrole','bypassrls'].some(k=>role[k]!==false)||role.canSetElevatedRole!==false)blockers.push('RUNTIME_ROLE_NOT_LEAST_PRIVILEGE');
 for(const name of ['tlsVerified','rollbackVerified','fullSiteContract','realTestIdentity'])if(input[name]!==true)blockers.push('PREREQUISITE:'+name);
 if(input.paidCostRequired!==false)blockers.push('NO_COST_NOT_CONFIRMED');
 const fresh=selected===probeTarget,order=fresh?freshMigrationOrder:migrationOrder;
 if(fresh&&(input.migrationMode!=='fresh'||input.gates?.FRESH_PROJECT_MIGRATION_REHEARSAL?.status!=='PASS'||!input.gates?.FRESH_PROJECT_MIGRATION_REHEARSAL?.evidence))blockers.push('FRESH_PROJECT_REHEARSAL_REQUIRED');
 if(!Array.isArray(input.migrations)||input.migrations.length!==order.length||input.migrations.some((m,i)=>m.version!==order[i]||!/^[a-f0-9]{64}$/.test(m.sha256)||m.destructive!==false||m.rehearsal!=='PASS'||input.authorization?.migrationHashes?.[m.version]!==m.sha256))blockers.push('MIGRATION_PLAN_UNVERIFIED');
 const auth=input.authorization;
 if(!selected||auth?.projectRef!==selected.projectRef||auth?.explicitOwnerApproval!==true||auth?.sourceRevision!==input.sourceRevision||!/^([a-f0-9]{40})$/.test(input.sourceRevision||''))blockers.push('PENDING_EXPLICIT_BETA_AUTHORIZATION');
 const approval=Date.parse(auth?.approvedAt);if(!Number.isFinite(approval)||approval>now||now-approval>86400000)blockers.push('AUTHORIZATION_STALE');
 const ops=['roles','settings','migrations','edge','frontend','syntheticCreate','syntheticCleanup'];
 if(ops.some(op=>auth?.operations?.[op]!==true))blockers.push('AUTHORIZATION_SCOPE_INCOMPLETE');
 return {status:blockers.length?'STOP_REMOTE_MUTATION':'PRECONDITIONS_ATTESTED_REVALIDATE_BEFORE_MUTATION',blockers,remoteMutations:0,limitations:['Offline attestations are not authentication, SQL rehearsal, deployment or remote E2E evidence.','No executor is included. A second fresh target/evidence/approval check is mandatory at the actual mutation boundary.']};
}
export function assertSyntheticScope(plan,request){
 if(!targets[plan.projectRef]||!/^beta-smoke-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(plan.runId||''))throw Error('SYNTHETIC_TARGET_OR_RUN');
 if(!Array.isArray(plan.accounts)||plan.accounts.length!==2||new Set(plan.accounts).size!==2||plan.accounts.some(a=>typeof a!=='string'||!a))throw Error('DEDICATED_A_B_REQUIRED');
 if(!Number.isSafeInteger(plan.maxRawRows)||plan.maxRawRows<1||plan.maxRawRows>24||!Number.isSafeInteger(request.rawRows)||request.rawRows<0||request.rawRows>plan.maxRawRows)throw Error('ROW_BUDGET');
 if(!Number.isSafeInteger(request.mutationCount)||request.mutationCount<0||request.mutationCount>80)throw Error('REQUEST_BUDGET');
 if(!plan.accounts.includes(request.account))throw Error('ACCOUNT_OUT_OF_SCOPE');
 if(!Array.isArray(plan.records)||!request.recordId||!plan.records.some(r=>r.id===request.recordId&&r.account===request.account&&r.runId===plan.runId))throw Error('RECORD_NOT_OWNED_BY_RUN');
 return true;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const file=process.argv[2];if(!file||!path.isAbsolute(file))throw Error('ABSOLUTE_NON_SECRET_ATTESTATION_FILE_REQUIRED');
 const result=evaluateCutover(JSON.parse(fs.readFileSync(file,'utf8')));console.log(JSON.stringify(result,null,2));process.exitCode=result.blockers.length?2:0;
}
