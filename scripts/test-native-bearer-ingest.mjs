// Isolated PostgreSQL + Deno handler test. Never reads remote credentials.
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createLocalPostgres } from './local-engine-postgres.mjs';

const out = process.env.NATIVE_AUTH_EVIDENCE_DIR || 'D:/Dev/Evidence/native-bearer-ingest-20260928';
if (!path.resolve(out).toLowerCase().startsWith('d:\\dev\\evidence\\')) throw Error('EVIDENCE_ROOT_REQUIRED');
await mkdir(out, { recursive: true });
const pg = await createLocalPostgres({ port: 57484 });
try {
  await pg.admin.unsafe('alter role health_native_ingest login');
  const config = path.join(out, 'synthetic-local-db.json');
  await writeFile(config, JSON.stringify(pg.config));
  await writeFile(path.join(out, 'postgres-migrations.json'), JSON.stringify(pg.evidence.migrations, null, 2));
  const started = new Date().toISOString();
  const run = spawnSync('deno', [
    'run', '--allow-env', '--allow-read', '--allow-write', '--allow-net',
    '--config', 'config/engine-local.deno.json',
    'scripts/test-native-bearer-ingest.ts', config,
    path.join(out, 'result.json'),
  ], { encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  await writeFile(path.join(out, 'stdout.log'), run.stdout || '');
  await writeFile(path.join(out, 'stderr.log'), run.stderr || '');
  await writeFile(path.join(out, 'command.json'), JSON.stringify({
    command: 'node scripts/test-native-bearer-ingest.mjs',
    started, ended: new Date().toISOString(), exit_code: run.status,
    error: run.error?.message ?? null,
  }, null, 2));
  process.stdout.write(run.stdout || '');
  process.stderr.write(run.stderr || '');
  process.exitCode = run.status ?? 1;
} finally {
  await pg.close();
}
