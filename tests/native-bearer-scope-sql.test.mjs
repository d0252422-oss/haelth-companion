import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Disposable synthetic database. This test never reaches Beta or production.
const db = new PGlite();
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const authA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const authB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const digest = (letter) => letter.repeat(64);

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create role health_native_ingest;
    create schema auth; create schema private;
    create table auth.users(id uuid primary key);
    create table public.users(id uuid primary key, status text not null);
    create table private.beta_native_auth_identities(
      auth_user_id uuid, canonical_user_id uuid, provider text, environment text
    );
    create table private.mobile_app_sessions(canonical_user_id uuid, platform text);
    create table private.beta_shortcut_sessions(canonical_user_id uuid);
  `);
  await db.query('insert into auth.users(id) values($1),($2)', [authA, authB]);
  await db.query("insert into public.users(id,status) values($1,'ACTIVE'),($2,'ACTIVE')", [userA, userB]);
  await db.query(`insert into private.beta_native_auth_identities values
    ($1,$2,'google','beta'),($3,$4,'google','beta')`, [authA, userA, authB, userB]);
  const sql = await readFile(new URL('../supabase/migrations/20260928050251_native_bearer_ingest_scope.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql, /alter\s+table\s+public\.beta_health_records/i, 'health-record RLS must remain unchanged');
  await db.exec(sql);

  const privilege = await db.query(`select
    has_function_privilege('service_role','public.beta_issue_native_ingest_scope(uuid,text)','EXECUTE') as service,
    has_function_privilege('authenticated','public.beta_issue_native_ingest_scope(uuid,text)','EXECUTE') as client,
    has_function_privilege('health_native_ingest','private.consume_native_ingest_scope()','EXECUTE') as delegate`);
  assert.deepEqual(privilege.rows[0], { service: true, client: false, delegate: true });

  const issued = await db.query('select public.beta_issue_native_ingest_scope($1,$2) as owner', [authA, digest('a')]);
  assert.equal(issued.rows[0].owner, userA);
  await db.exec(`select set_config('health.worker.kind','native',false);
    select set_config('health.worker.digest','${digest('a')}',false);`);
  const owner = await db.query('select private.delegated_worker_user() as owner, private.delegated_worker_platform() as platform');
  assert.deepEqual(owner.rows[0], { owner: userA, platform: 'android' });
  assert.equal((await db.query('select private.consume_native_ingest_scope() as ok')).rows[0].ok, true);
  assert.equal((await db.query('select private.consume_native_ingest_scope() as ok')).rows[0].ok, false);
  assert.equal((await db.query('select private.delegated_worker_user() as owner')).rows[0].owner, null);

  await db.query('select public.beta_issue_native_ingest_scope($1,$2)', [authB, digest('b')]);
  await db.exec(`select set_config('health.worker.digest','${digest('b')}',false);`);
  assert.equal((await db.query('select private.delegated_worker_user() as owner')).rows[0].owner, userB);
  await db.query('update private.beta_native_ingest_scopes set expires_at=now()-interval \'1 second\' where capability_digest=$1', [digest('b')]);
  assert.equal((await db.query('select private.delegated_worker_user() as owner')).rows[0].owner, null);
  assert.equal((await db.query('select private.consume_native_ingest_scope() as ok')).rows[0].ok, false);
  console.log('Native bearer scope SQL isolation: PASS (synthetic PGlite)');
} finally {
  await db.close();
}
