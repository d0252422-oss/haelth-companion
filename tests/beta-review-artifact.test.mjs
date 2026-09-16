import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {verifyArtifact,sha256} from '../scripts/verify-beta-review-artifact.mjs';
const base='D:/Dev/Caches/temp';
async function fixture(files) {
  await fs.mkdir(base,{recursive:true});
  const root=await fs.mkdtemp(path.join(base,'health-review-artifact-'));
  await fs.writeFile(path.join(root,'safe.txt'),'synthetic');
  await fs.writeFile(path.join(root,'artifact-manifest.json'),JSON.stringify({source_revision:'d7a00d527d7486ccbfadfaec5225b3fa604600db',files:files??[{path:'safe.txt',bytes:9,sha256:sha256('synthetic')}]}));
  return root; // Retain tiny synthetic fixtures; no broad cleanup.
}
test('valid artifact integrity is not deployment approval',async()=>{const r=await verifyArtifact(await fixture());assert.equal(r.status,'PASS_INTEGRITY_ONLY');assert.equal(r.deploy_ready,false);});
test('tampered artifact is rejected',async()=>{const root=await fixture();await fs.writeFile(path.join(root,'safe.txt'),'modified');await assert.rejects(verifyArtifact(root),/HASH_MISMATCH/);});
test('traversal and absolute paths rejected before read',async()=>{for(const name of ['../outside','D:/outside','/outside','a\\outside'])await assert.rejects(verifyArtifact(await fixture([{path:name}])) ,/UNSAFE_OR_DUPLICATE_PATH/);});
test('duplicate manifest paths rejected',async()=>{const file={path:'safe.txt',bytes:9,sha256:sha256('synthetic')};await assert.rejects(verifyArtifact(await fixture([file,file])),/UNSAFE_OR_DUPLICATE_PATH/);});
test('credential proposal matches runtime roles and secret names without approval',async()=>{
  const text=await fs.readFile('docs/BETA_REMOTE_CREDENTIAL_REQUIREMENTS.md','utf8');
  for(const value of ['health_manual_api','health_native_ingest','health_recompute_worker','HEALTH_MANUAL_DATABASE_URL','HEALTH_NATIVE_DATABASE_URL','HEALTH_RECOMPUTE_DATABASE_URL','SUPERUSER=NO','BYPASSRLS=NO','uavimjgccigpbwqmfkhh','PENDING_CREDENTIAL'])assert.ok(text.includes(value),value);
  assert.doesNotMatch(text,/postgres(?:ql)?:\/\/[^\s]+:[^\s]+@/);
});
test('OAuth runbook stays bounded and does not claim actual login',async()=>{
  const text=await fs.readFile('docs/BETA_AB_OAUTH_OWNER_RUNBOOK.md','utf8');
  assert.equal([...text.matchAll(/^\d\. /gm)].length,4);
  assert.ok(text.includes('ACTUAL_LOGIN=NOT_RUN'));assert.ok(text.includes('Never paste passwords'));
});
