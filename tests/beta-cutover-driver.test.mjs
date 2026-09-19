import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {validatePlan,runDriver,assertDDirectory} from '../scripts/beta-cutover-driver.mjs';
import {buildPlan} from '../scripts/beta-cutover-package.mjs';import {audit} from '../scripts/audit-beta-preparation.mjs';
import {preparePackage} from '../scripts/beta-cutover-package.mjs';
import {createE2ePlan,validateE2ePlan,assertCleanupReceipt} from '../scripts/beta-remote-e2e-plan.mjs';
const ref='dsdfacbjaicdcwayhhil',plan=()=>buildPlan(ref,audit(),'f'.repeat(40));
test('only exact Beta identity and fresh reviewed migration order are accepted',()=>{
 assert.equal(validatePlan(plan()).projectRef,ref);
 for(const mutate of [p=>p.target={...p.target,projectRef:'vptqedxdxfoohbqctujf'},p=>p.target={...p.target,region:'wrong'},p=>p.migrations.reverse(),p=>p.migration_mode='incremental',p=>p.roles.push('postgres'),p=>p.remote_mutations=1,p=>p.commands.edge_deploy.push('--prune'),p=>p.rollback.data_policy='DELETE_ALL']){const p=structuredClone(plan());mutate(p);assert.throws(()=>validatePlan(p));}
});
test('D evidence containment and unknown target fail before command execution',async()=>{
 assert.throws(()=>assertDDirectory('C:/Users'),/OUTSIDE/);assert.throws(()=>assertDDirectory('relative'),/ABSOLUTE/);
 await assert.rejects(runDriver({projectRef:'constructor'}),/TARGET_DENIED/);
 await assert.rejects(runDriver({projectRef:ref,mode:'upgrade'}),/MODE_DENIED/);
});
test('static E2E covers seven domains and rejects policy/invariant drift',()=>{
 const p=createE2ePlan(ref);assert.equal(validateE2ePlan(p).domain_count,7);
 for(const key of ['domains','invariants','isolation','browser','reads','cleanup','maxRawRows','maxMutations']){const changed=structuredClone(p);changed[key]=null;assert.throws(()=>validateE2ePlan(changed));}
 assert.throws(()=>createE2ePlan('constructor'));
});
test('cleanup requires acknowledged same-run account/project/id/revision; timeout never means safe delete',()=>{
 const p=createE2ePlan(ref),receipt={projectRef:ref,runId:p.runId,account:'A',recordId:'synthetic-record',status:'ACKNOWLEDGED',revision:2,requestId:p.runId.slice(11)};
 const request={plan:p,receipt,account:'A',recordId:'synthetic-record',revision:2};assert.equal(assertCleanupReceipt(request),true);
 for(const [key,value]of Object.entries({projectRef:'other',runId:'other',account:'B',recordId:'other',status:'TIMEOUT',revision:1,requestId:'unknown'}))assert.throws(()=>assertCleanupReceipt({...request,receipt:{...receipt,[key]:value}}));
});
test('driver source has no network, shell-eval, credential lookup or remote process executor',()=>{
 const src=fs.readFileSync(new URL('../scripts/beta-cutover-driver.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(src,/\bfetch\s*\(|https\.request|process\.env|shell\s*:\s*true|\beval\s*\(/);
 assert.match(src,/execFileSync\('git',\['rev-parse','HEAD'\]/);
});
test('actual package dryrun/resume revalidates bytes; remote modes and concurrent lock fail closed',async()=>{
 const root=fs.mkdtempSync('D:/Dev/Evidence/cutover-driver-test-'),pkg=path.join(root,'package'),output=path.join(root,'checkpoints');
 await preparePackage({output:pkg,projectRef:ref});
 const input={projectRef:ref,packageDirectory:pkg,output};
 assert.equal((await runDriver(input)).status,'PASS_OFFLINE_VALIDATION');
 await assert.rejects(runDriver(input),/RESUME_REQUIRED/);
 assert.equal((await runDriver({...input,resume:true})).checks.length,4);
 assert.equal((await runDriver({...input,resume:true,mode:'full'})).status,'BLOCKED_CURRENT_RUN_REMOTE_MUTATION_FORBIDDEN');
 let state=JSON.parse(fs.readFileSync(path.join(output,'checkpoint.json')));assert.equal(state.stages.length,3);
 assert.equal(state.stages.at(-1).remote_mutations,0);
 fs.writeFileSync(path.join(output,'driver.lock'),'owned test lock');await assert.rejects(runDriver({...input,resume:true}),/EEXIST/);
 fs.unlinkSync(path.join(output,'driver.lock')); // exact owned test lock, no user data
 fs.appendFileSync(path.join(pkg,'manual-sql-config.PROPOSED.js'),'// tamper test');
 await assert.rejects(runDriver({...input,resume:true}),/WEB_OVERLAY_CHANGED/);
 state=JSON.parse(fs.readFileSync(path.join(output,'checkpoint.json')));assert.equal(state.stages.at(-1).status,'FAIL_OFFLINE_VALIDATION');assert.equal(state.stages.at(-1).checks.length,2);
});
test('master runbooks retain target, six setting names and explicit live limitations',()=>{
 const read=name=>fs.readFileSync(new URL('../docs/'+name,import.meta.url),'utf8');
 const master=read('BETA_CUTOVER_MASTER_RUNBOOK.md');for(const setting of audit().settings)assert.ok(master.includes(setting));
 for(const text of [ref,'vptqedxdxfoohbqctujf','health_manual_api','health_native_ingest','health_recompute_worker','not implemented live executors','NOT release approval'])assert.ok(master.includes(text),text);
 assert.match(read('BETA_ROLLBACK_MASTER.md'),/CODE\/CONFIG ONLY/);assert.match(read('BETA_ROLLBACK_MASTER.md'),/PARTIAL_NOT_REHEARSED/);
 for(const name of ['ANDROID_REAL_DEVICE_GATE.md','IOS_SHORTCUT_BUILD_SPEC.md','IOS_SHORTCUT_OWNER_CHECKLIST.md','BETA_AB_AUTH_RUNBOOK.md'])assert.ok(read(name).length>200);
});
test('Android metadata additions never claim per-request evidence or collect raw logcat',()=>{
 const source=fs.readFileSync(new URL('../scripts/android-real-device-gate.ps1',import.meta.url),'utf8');
 assert.match(source,/observability_gaps=.*PER_HTTP_START_END_DURATION/);assert.match(source,/ro\.product\.model/);assert.match(source,/ro\.build\.version\.sdk/);
 assert.doesNotMatch(source,/Invoke-BoundedAdb[^\n]*['"](?:logcat|bugreport)['"]/);
});
