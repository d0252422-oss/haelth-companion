import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {BETA_PROJECT_REF,MIGRATION_NAME,MIGRATION_SHA256,MIGRATION_VERSION,verifyCoreReleaseMigration} from '../scripts/verify-core-release-migration.mjs';
import {assertCanonicalRelativePath,verifyCoreReleaseArtifact} from '../scripts/verify-core-release-artifact.mjs';

const migrations=[{version:'20260920223000',name:'manual_exercise_body_parts'}];
const base={projectRef:BETA_PROJECT_REF,migrations};

test('core release migration verifier binds exact Beta target, version-preserving source identity and bytes',async()=>{
  const result=await verifyCoreReleaseMigration({targetProjectRef:BETA_PROJECT_REF,inventory:base});
  assert.equal(result.remoteMutations,0);assert.equal(result.migration.sourceVersion,MIGRATION_VERSION);assert.equal(result.migration.remoteHistoryVersion,MIGRATION_VERSION);assert.equal(result.migration.name,MIGRATION_NAME);assert.equal(result.migration.sha256,MIGRATION_SHA256);
  assert.equal(result.versionPreservingCliContract.projectRef,BETA_PROJECT_REF);assert.equal(result.versionPreservingCliContract.expectedOnlyPendingMigration,MIGRATION_VERSION);
  assert.equal(result.versionPreservingCliContract.authenticationMode,'EXISTING_SUPABASE_DB_PASSWORD_ENV');assert.equal(result.versionPreservingCliContract.temporaryLoginRoleForbidden,true);assert.equal(result.versionPreservingCliContract.passwordOnCommandLineForbidden,true);
  assert.ok(result.versionPreservingCliContract.dryRunArgs.includes('--dry-run'));assert.ok(result.versionPreservingCliContract.applyArgs.includes('--skip-vault'));
  for(const args of [result.versionPreservingCliContract.dryRunArgs,result.versionPreservingCliContract.applyArgs]){const index=args.indexOf('--workdir');assert.ok(index>=0);assert.equal(args[index+1],result.versionPreservingCliContract.workdir);}
});

test('core release migration verifier rejects production, duplicate or already-applied history',async()=>{
  await assert.rejects(()=>verifyCoreReleaseMigration({targetProjectRef:'vptqedxdxfoohbqctujf',inventory:base}),/TARGET_MUST_BE_EXACT_BETA/);
  await assert.rejects(()=>verifyCoreReleaseMigration({targetProjectRef:BETA_PROJECT_REF,inventory:{...base,migrations:[...migrations,...migrations]}}),/DUPLICATE_REMOTE_MIGRATION_VERSION/);
  await assert.rejects(()=>verifyCoreReleaseMigration({targetProjectRef:BETA_PROJECT_REF,inventory:{...base,migrations:[...migrations,{version:MIGRATION_VERSION,name:MIGRATION_NAME}]}}),/CANDIDATE_MIGRATION_ALREADY_PRESENT/);
  await assert.rejects(()=>verifyCoreReleaseMigration({targetProjectRef:BETA_PROJECT_REF,inventory:{...base,migrations:[...migrations,{version:'20260927140524',name:MIGRATION_NAME}]}}),/CANDIDATE_MIGRATION_ALREADY_PRESENT/);
});

test('pre/post inventory verifies additive shape and row-count preservation',async()=>{
  const pre={...base,table:{workoutSetCount:45,hasSetOrder:false,indexDefinition:null,constraintDefinition:null}};
  const before=await verifyCoreReleaseMigration({targetProjectRef:BETA_PROJECT_REF,inventory:pre,phase:'pre'});assert.equal(before.baselineCount,45);
  const post={projectRef:BETA_PROJECT_REF,migrations:[...migrations,{version:MIGRATION_VERSION,name:MIGRATION_NAME}],table:{workoutSetCount:45,hasSetOrder:true,dataType:'integer',isNullable:'YES',indexDefinition:'CREATE UNIQUE INDEX manual_workout_set_order_unique ON public.manual_workout_sets USING btree (canonical_user_id, session_id, set_order) WHERE ((NOT deleted) AND (set_order IS NOT NULL))',constraintDefinition:'CHECK ((set_order > 0))'}};
  const after=await verifyCoreReleaseMigration({targetProjectRef:BETA_PROJECT_REF,inventory:post,phase:'post',baselineInventory:base,baselineCount:45});assert.equal(after.status,'POSTCONDITIONS_VERIFIED_READ_ONLY');
  assert.equal(after.candidateHistory.exactRows.length,1);
  await assert.rejects(()=>verifyCoreReleaseMigration({targetProjectRef:BETA_PROJECT_REF,inventory:{...post,table:{...post.table,workoutSetCount:46}},phase:'post',baselineInventory:base,baselineCount:45}),/WORKOUT_SET_COUNT_CHANGED/);
  const providerAssigned={...post,migrations:[...migrations,{version:'20260927140524',name:MIGRATION_NAME}]};
  await assert.rejects(()=>verifyCoreReleaseMigration({targetProjectRef:BETA_PROJECT_REF,inventory:providerAssigned,phase:'post',baselineInventory:base,baselineCount:45}),/VERSION_PRESERVING_HISTORY_ROW_REQUIRED/);
  const wrongName={...post,migrations:[...migrations,{version:MIGRATION_VERSION,name:'wrong_name'}]};
  await assert.rejects(()=>verifyCoreReleaseMigration({targetProjectRef:BETA_PROJECT_REF,inventory:wrongName,phase:'post',baselineInventory:base,baselineCount:45}),/VERSION_PRESERVING_HISTORY_ROW_REQUIRED/);
  const extra={...post,migrations:[...post.migrations,{version:'20260927150000',name:'unexpected'}]};
  await assert.rejects(()=>verifyCoreReleaseMigration({targetProjectRef:BETA_PROJECT_REF,inventory:extra,phase:'post',baselineInventory:base,baselineCount:45}),/EXACTLY_ONE_MIGRATION_HISTORY_ROW_REQUIRED/);
});

test('release packager declares hash-manifested rollback, reviewed executor and explicit authorization boundary',async()=>{
  const source=await readFile(new URL('../scripts/prepare-core-release-candidate.mjs',import.meta.url),'utf8');
  for(const required of ['config/engine-local.deno.lock','fixtures/algorithm-golden/apps-script-health-score-v1.0.snapshot.js','remote-function-manifest.json','live-rollback-manifest.json','verify-core-release-migration.mjs','verify-core-release-artifact.mjs','migration-workdir','REVIEWED_SUPABASE_CLI_VERSION','REVIEWED_SUPABASE_CLI_EXECUTABLE','REVIEWED_SUPABASE_CLI_SHA256','130378d4714e89b346d679245e4f560261a8b16ab31914176d81637a74b3f05a','ba16389dc163f112dd4ff17949607869fd04b26d685d159a2c75086813014803','allowedRemoteMutations:[]','separateExplicitApprovalRequired','EXISTING_SUPABASE_DB_PASSWORD_ENV','temporaryLoginRoleForbidden:true','passwordOnCommandLineForbidden:true','preserveExistingConfigurationAndSecrets','verifyJwt:false,importMap:true','ROLLBACK_ENTRYPOINT_MISMATCH','ROLLBACK_IMPORT_MAP_MISMATCH'])assert.ok(source.includes(required),`missing release contract: ${required}`);
  assert.match(source,/WORKTREE_MUST_BE_CLEAN/u);assert.match(source,/verifyImportClosure/u);assert.match(source,/verifyDenoBundle/u);assert.match(source,/PASS_CACHED_FROZEN/u);assert.doesNotMatch(source,/copyFile/u);
});

test('release artifact paths reject traversal, absolute and non-canonical input',()=>{
  assert.equal(assertCanonicalRelativePath('rollback/web-v06/index.html'),'rollback/web-v06/index.html');
  for(const unsafe of ['../secret','rollback/../secret','/absolute','C:/absolute','rollback\\secret'])assert.throws(()=>assertCanonicalRelativePath(unsafe));
});

test('artifact verifier accepts exact bytes and rejects mutation or extra files',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'core-release-artifact-'));
  try{
    const relative='candidate/build.json',bytes=Buffer.from('{"buildId":"fixture"}\n'),hash=createHash('sha256').update(bytes).digest('hex');
    await mkdir(path.join(directory,'candidate'),{recursive:true});await writeFile(path.join(directory,relative),bytes);
    const manifest={schema:'fixture',buildId:'fixture',candidateCommit:'abc123',files:[{path:relative,bytes:bytes.length,sha256:hash}]};
    const manifestBytes=Buffer.from(JSON.stringify(manifest)+'\n'),manifestHash=createHash('sha256').update(manifestBytes).digest('hex');
    await writeFile(path.join(directory,'release-manifest.json'),manifestBytes);
    await writeFile(path.join(directory,'artifact-result.json'),JSON.stringify({buildId:'fixture',commit:'abc123',manifestSha256:manifestHash})+'\n');
    assert.equal((await verifyCoreReleaseArtifact(directory,manifestHash)).status,'PASS');
    await writeFile(path.join(directory,relative),'tampered');
    await assert.rejects(()=>verifyCoreReleaseArtifact(directory,manifestHash),/ARTIFACT_BYTE_LENGTH_MISMATCH/);
    await writeFile(path.join(directory,relative),bytes);await writeFile(path.join(directory,'unexpected.txt'),'extra');
    await assert.rejects(()=>verifyCoreReleaseArtifact(directory,manifestHash),/ARTIFACT_FILE_SET_MISMATCH/);
    const forgedManifest={...manifest,files:[{...manifest.files[0],bytes:7,sha256:'0'.repeat(64)}]},forgedBytes=Buffer.from(JSON.stringify(forgedManifest)+'\n');
    await writeFile(path.join(directory,'release-manifest.json'),forgedBytes);await writeFile(path.join(directory,'artifact-result.json'),JSON.stringify({buildId:'fixture',commit:'abc123',manifestSha256:createHash('sha256').update(forgedBytes).digest('hex')})+'\n');
    await assert.rejects(()=>verifyCoreReleaseArtifact(directory,manifestHash),/EXTERNAL_RELEASE_MANIFEST_HASH_MISMATCH/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
