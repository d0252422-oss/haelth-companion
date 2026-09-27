// Offline integrity verifier for a packaged core release candidate. It reads
// only the supplied artifact directory and never connects to remote services.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const normalize=value=>value.replaceAll('\\','/');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

export function assertCanonicalRelativePath(value){
  assert.equal(typeof value,'string','ARTIFACT_PATH_STRING_REQUIRED');
  assert.ok(value.length>0&&!path.isAbsolute(value),'ARTIFACT_PATH_MUST_BE_RELATIVE');
  assert.equal(value,normalize(value),'ARTIFACT_PATH_MUST_USE_FORWARD_SLASH');
  assert.equal(path.posix.normalize(value),value,'ARTIFACT_PATH_NOT_CANONICAL');
  assert.ok(value!=='.'&&!value.startsWith('../')&&!value.includes('/../'),'ARTIFACT_PATH_TRAVERSAL_FORBIDDEN');
  return value;
}

async function listFiles(directory,prefix=''){
  const result=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const relative=prefix?path.join(prefix,entry.name):entry.name;
    if(entry.isSymbolicLink())throw Error(`SYMLINK_FORBIDDEN: ${normalize(relative)}`);
    if(entry.isDirectory())result.push(...await listFiles(path.join(directory,entry.name),relative));
    else if(entry.isFile())result.push(normalize(relative));
  }
  return result.sort();
}

export async function verifyCoreReleaseArtifact(artifactDirectory,expectedManifestSha256){
  assert.ok(path.isAbsolute(artifactDirectory),'ABSOLUTE_ARTIFACT_DIRECTORY_REQUIRED');
  assert.match(expectedManifestSha256,/^[a-f0-9]{64}$/u,'EXTERNALLY_APPROVED_MANIFEST_SHA256_REQUIRED');
  assert.ok((await stat(artifactDirectory)).isDirectory(),'ARTIFACT_DIRECTORY_REQUIRED');
  const manifestBytes=await readFile(path.join(artifactDirectory,'release-manifest.json'));
  const resultBytes=await readFile(path.join(artifactDirectory,'artifact-result.json'));
  const manifest=JSON.parse(manifestBytes),result=JSON.parse(resultBytes);
  assert.equal(sha256(manifestBytes),expectedManifestSha256,'EXTERNAL_RELEASE_MANIFEST_HASH_MISMATCH');
  assert.equal(result.manifestSha256,expectedManifestSha256,'RELEASE_RESULT_MANIFEST_HASH_MISMATCH');
  assert.equal(result.commit,manifest.candidateCommit,'CANDIDATE_COMMIT_MISMATCH');
  assert.equal(result.buildId,manifest.buildId,'BUILD_ID_MISMATCH');
  assert.ok(Array.isArray(manifest.files)&&manifest.files.length>0,'MANIFEST_FILES_REQUIRED');
  const expected=new Set(['artifact-result.json','release-manifest.json']);
  for(const row of manifest.files){
    assertCanonicalRelativePath(row.path);
    assert.match(row.path,/^(?:candidate|migration-workdir|release-evidence|rollback)\//u,'UNEXPECTED_MANIFEST_PATH');
    assert.equal(expected.has(row.path),false,`DUPLICATE_MANIFEST_PATH: ${row.path}`);
    expected.add(row.path);
    const absolute=path.resolve(artifactDirectory,row.path);
    assert.ok(normalize(absolute).startsWith(normalize(path.resolve(artifactDirectory))+'/'),'MANIFEST_PATH_ESCAPES_ARTIFACT');
    const bytes=await readFile(absolute);
    assert.equal(bytes.length,row.bytes,`ARTIFACT_BYTE_LENGTH_MISMATCH: ${row.path}`);
    assert.equal(sha256(bytes),row.sha256,`ARTIFACT_SHA256_MISMATCH: ${row.path}`);
  }
  assert.deepEqual(await listFiles(artifactDirectory),[...expected].sort(),'ARTIFACT_FILE_SET_MISMATCH');
  return {status:'PASS',artifactDirectory,buildId:manifest.buildId,commit:manifest.candidateCommit,files:manifest.files.length,manifestSha256:result.manifestSha256,remoteMutations:0};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const artifactDirectory=process.argv[2],expectedManifestSha256=process.argv[3];
  assert.ok(artifactDirectory&&expectedManifestSha256,'USAGE: node scripts/verify-core-release-artifact.mjs <absolute-artifact-directory> <externally-approved-manifest-sha256>');
  console.log(JSON.stringify(await verifyCoreReleaseArtifact(path.resolve(artifactDirectory),expectedManifestSha256),null,2));
}
