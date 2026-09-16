// Offline integrity check only. Never deploys, authenticates or grants readiness.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verifyArtifact(root) {
  root = path.resolve(root);
  const manifestBytes = await fs.readFile(path.join(root, 'artifact-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  if (!/^[a-f0-9]{40}$/.test(manifest.source_revision) || !Array.isArray(manifest.files) || !manifest.files.length) throw Error('INVALID_MANIFEST');
  const seen = new Set();
  for (const file of manifest.files) {
    if (typeof file.path !== 'string' || file.path.includes('\\') || path.posix.isAbsolute(file.path) || file.path.split('/').some(p => !p || p === '.' || p === '..') || /^[A-Za-z]:/.test(file.path) || seen.has(file.path)) throw Error('UNSAFE_OR_DUPLICATE_PATH');
    seen.add(file.path);
    const target = path.resolve(root, file.path);
    const physical = await fs.realpath(target);
    const relative = path.relative(await fs.realpath(root), physical);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw Error('OUTSIDE_ARTIFACT_ROOT');
    const bytes = await fs.readFile(target);
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw Error('ARTIFACT_HASH_MISMATCH:' + file.path);
  }
  return {status:'PASS_INTEGRITY_ONLY', source_revision:manifest.source_revision, files:seen.size, manifest_sha256:sha256(manifestBytes), deploy_ready:false, remote_mutations:0};
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2] || !path.isAbsolute(process.argv[2])) throw Error('EXPLICIT_ARTIFACT_ROOT_REQUIRED');
  console.log(JSON.stringify(await verifyArtifact(process.argv[2])));
}
