// Offline, explicit allowlist only. Produces a conditional artifact, never publishes.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw Error('EXPLICIT_NEW_ARTIFACT_DIRECTORY_REQUIRED');
await mkdir(output, { recursive: false }); // Existing artifacts must never be overwritten.
const files = ['index.html', 'scripts/local-engine-web.js'];
const manifest = {
  created_at: new Date().toISOString(),
  source_revision: execFileSync('git', ['--no-optional-locks', 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  status: 'PREPARED_CONDITIONAL_NOT_ENABLED', files: [],
  candidate_entry: 'health-companion-beta/manual-preview/index.html (PROPOSED_NEW_PATH_NOT_DEPLOYED)',
  backend: { project_name: 'health-companion-beta', project_ref: 'uavimjgccigpbwqmfkhh', function: 'mobile-health-beta', runtime: 'Supabase Edge Runtime', actual_edge_execution: 'NOT_VERIFIED' },
  flags: { manual_sql: 'OFF', exercise_management: 'OFF', existing_provider: 'UNCHANGED_APPS_SCRIPT' },
  exclusions: ['.env', 'tokens', 'local issuer', 'fixtures', 'database', 'source maps', 'Android', 'private evidence'],
  activation_conditions: ['actual CLI Edge execution with PostgreSQL', 'verified existing Web session to canonical identity, no JWT substitution', 'authorized Beta migration/config/deployment scope', 'real OAuth user-scoped acceptance'],
  remote_operations: 0,
};
for (const name of files) {
  const bytes = await readFile(name), source = bytes.toString('utf8');
  if (name.endsWith('.js')) new vm.Script(source, { filename: name });
  else for (const [, script] of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script, { filename: name });
  await mkdir(path.dirname(path.join(output, name)), { recursive: true });
  await copyFile(name, path.join(output, name));
  manifest.files.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(path.join(output, 'artifact-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ status: manifest.status, output, files: manifest.files.length, remote_operations: 0 }));
