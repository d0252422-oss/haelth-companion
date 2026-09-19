import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {acceptanceGates,postSqlFirstDecision,vendorResponseDecision,enqueuePostSqlFirst} from '../scripts/beta-next-gate.mjs';
import {validateConfigWiring,settingNames} from '../scripts/beta-config-wiring.mjs';
import {buildPlan} from '../scripts/beta-cutover-package.mjs';import {audit} from '../scripts/audit-beta-preparation.mjs';
import {compileScenarios,validateScenarios} from '../scripts/beta-e2e-scenarios.mjs';
const projectRef='dsdfacbjaicdcwayhhil';
const accepted=()=>({schema:'beta-remote-acceptance-v1',execution:'ACTUAL_REMOTE',accepted:true,projectRef,sourceRevision:'a'.repeat(40),gates:Object.fromEntries(acceptanceGates.map(n=>[n,{status:'PASS',evidence:{path:'fixture'}}]))});
test('local/dryrun/partial/vendor-wait results never activate workout optimization',()=>{
 assert.equal(postSqlFirstDecision(null).status,'DEFERRED_UNTIL_SQL_FIRST');
 for(const execution of ['STATIC_ONLY','ACTUAL_LOCAL','DRY_RUN'])assert.ok(postSqlFirstDecision({...accepted(),execution}).blockers.length);
 for(const name of acceptanceGates){const r=accepted();r.gates[name].status='PASS_LOCAL';assert.ok(postSqlFirstDecision(r).blockers.length);}
 assert.ok(postSqlFirstDecision({...accepted(),projectRef:'vptqedxdxfoohbqctujf'}).blockers.length);
 assert.equal(postSqlFirstDecision(accepted()).status,'READY_TO_MEASURE'); // synthetic decision fixture, not remote PASS
});
test('work queue verifies evidence hashes and is idempotent; no task on missing PASS',()=>{
 const root=fs.mkdtempSync('D:/Dev/Evidence/post-sql-trigger-test-'),file=path.join(root,'acceptance.json'),evidence=path.join(root,'fixture.txt');
 fs.writeFileSync(evidence,'SYNTHETIC UNIT TEST ONLY - not real acceptance');const hash=createHash('sha256').update(fs.readFileSync(evidence)).digest('hex');
 const r=accepted();for(const n of acceptanceGates)r.gates[n].evidence={path:evidence,sha256:hash};fs.writeFileSync(file,JSON.stringify(r));
 const output=path.join(root,'queue');assert.equal(enqueuePostSqlFirst({reportFile:file,output}).queue,'ENQUEUED');assert.equal(enqueuePostSqlFirst({reportFile:file,output}).queue,'ALREADY_ENQUEUED');
 fs.appendFileSync(evidence,'tamper');assert.throws(()=>enqueuePostSqlFirst({reportFile:file,output}),/EVIDENCE_HASH_MISMATCH/);
 r.gates.BETA_SQL_FIRST_CUTOVER.status='NOT_RUN';fs.writeFileSync(file,JSON.stringify(r));const blocked=path.join(root,'blocked');assert.equal(enqueuePostSqlFirst({reportFile:file,output:blocked}).status,'DEFERRED_UNTIL_SQL_FIRST');assert.equal(fs.existsSync(path.join(blocked,'post-sql-first-task.json')),false);
});
test('vendor routing never upgrades, assumes equivalence or switches provider',()=>{
 assert.equal(vendorResponseDecision().no_new_vendor_evidence,true);
 const input={sourceUrl:'https://supabase.com/dashboard/support',evidence:'official-reply-reference'};
 assert.equal(vendorResponseDecision({...input,kind:'UPGRADE_PATH',targetServerVersionNum:170011}).remote_authorized,false);
 assert.throws(()=>vendorResponseDecision({...input,kind:'UPGRADE_PATH',targetServerVersionNum:170006}));
 assert.equal(vendorResponseDecision({...input,kind:'BACKPORT_MAPPING'}).model,'GPT-6');
 assert.equal(vendorResponseDecision({...input,kind:'NEITHER_AVAILABLE'}).provider_switch_authorized,false);
 assert.throws(()=>vendorResponseDecision({...input,sourceUrl:'https://supabase.com.attacker.invalid',kind:'BACKPORT_MAPPING'}));
});
test('all 11 package names match actual Edge source; runtime/admin/test identities remain separate',()=>{
 const plan=buildPlan(projectRef,audit(),'a'.repeat(40));assert.equal(validateConfigWiring(plan).count,11);
 assert.equal(settingNames.length,11);plan.settings_names[0]='HEALTH_MANUAL_ENABLED_TYPO';assert.throws(()=>validateConfigWiring(plan));
});
test('seven-domain scenarios compile exact receipt dependencies and bounded same-run deletes',()=>{
 const b=compileScenarios(projectRef,'2026-09-12'),r=validateScenarios(b);assert.equal(r.status,'PASS_SCENARIO_COMPILATION_ONLY');assert.ok(r.planned_mutation_attempts<=80);
 assert.equal(b.steps.find(s=>s.id==='steps.update').payload.value,8000);assert.equal(b.steps.find(s=>s.id==='total_energy.update').payload.value,2200);
 assert.ok(b.steps.find(s=>s.id==='exercise.referenced_delete_denied'));assert.ok(b.steps.find(s=>s.id==='exercise.safe_delete'));
 assert.throws(()=>compileScenarios(projectRef,'2026-02-30'));assert.throws(()=>compileScenarios('constructor','2026-09-12'));
 const p=structuredClone(b);p.steps.find(s=>s.id==='body.delete').requiresOwnershipReceipt=false;assert.throws(()=>validateScenarios(p));
 const q=structuredClone(b);q.steps.find(s=>s.id==='body.update').payload.recordId.$receipt='unknown';assert.throws(()=>validateScenarios(q));
});
