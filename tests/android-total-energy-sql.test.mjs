import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// In-memory synthetic schema only. Never connects to Beta or production.
const db = new PGlite();
const migration = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const user = '11111111-1111-4111-8111-111111111111';
const hash = (char) => char.repeat(64);

try {
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(await migration('20260827010000_beta_minimum_canonical_schema.sql'));
  await db.exec(await migration('20260827023849_health_source_record_reconciliation.sql'));
  await db.exec(`create table private.beta_score_recompute_queue (
    canonical_user_id uuid not null, score_date date not null,
    generation bigint not null default 1, status text not null default 'DIRTY',
    attempt_count integer not null default 0, next_attempt_at timestamptz,
    lease_token uuid, lease_expires_at timestamptz, last_error_code text,
    completed_at timestamptz, dirtied_at timestamptz default now(),
    updated_at timestamptz default now(),
    primary key(canonical_user_id, score_date)
  );`);
  await db.exec(await migration('20260928130000_android_total_energy_canonical.sql'));
  await db.exec(`create trigger beta_health_records_enqueue_score
    after insert or update of source_revision, source_content_hash, operation, invalidated_at
    on public.beta_health_records for each row
    execute function private.beta_enqueue_score_recompute();`);
  await db.query('insert into public.users(id,external_subject_hash) values($1,$2)', [user, hash('f')]);

  const reconcile = async (domain, revision, contentHash) => {
    const result = await db.query(`select private.reconcile_health_source_record(
      $1::uuid, 'android', $2, 'com.example.wearable', 'hc-record-1',
      $3::bigint, '2026-09-28T02:00:00Z'::timestamptz, $4, 'UPSERT',
      array['2026-09-27','2026-09-28']::date[]) as action`,
    [user, domain, revision, contentHash]);
    return result.rows[0].action;
  };
  assert.equal(await reconcile('total_energy', 1, hash('a')), 'CREATED');
  assert.equal(await reconcile('total_energy', 1, hash('a')), 'REPLAYED');
  assert.equal(await reconcile('total_energy', 2, hash('b')), 'UPDATED');
  const events = await db.query(`select action,requires_derived_recompute from private.health_source_reconciliation_events
    where canonical_user_id=$1 and source_state_id in
      (select id from private.health_source_record_state where domain='total_energy')
    order by source_revision`, [user]);
  assert.deepEqual(events.rows.map((row) => [row.action, row.requires_derived_recompute]),
    [['CREATED', false], ['REPLAYED', false], ['UPDATED', false]]);
  assert.equal(await reconcile('steps', 1, hash('c')), 'CREATED');
  assert.equal(await reconcile('steps', 2, hash('d')), 'UPDATED');
  const stepUpdate = await db.query(`select requires_derived_recompute from private.health_source_reconciliation_events
    where canonical_user_id=$1 and action='UPDATED' and source_state_id in
      (select id from private.health_source_record_state where domain='steps')`, [user]);
  assert.equal(stepUpdate.rows[0].requires_derived_recompute, true);

  const insertRecord = async (domain, id, value, unit) => db.query(`insert into public.beta_health_records(
    canonical_user_id,platform,domain,source_app,source_record_id,source_revision,
    source_content_hash,idempotency_key,operation,canonical_record,affected_local_dates)
    values($1::uuid,'android',$2::text,'com.example.wearable',$3::text,1,$4::text,$5::text,'UPSERT',
      jsonb_build_object('domain',$2::text,'value',$6::numeric,'unit',$7::text,
        'started_at','2026-09-27T15:30:00Z','ended_at','2026-09-27T16:30:00Z'),
      array['2026-09-27','2026-09-28']::date[])`,
  [user, domain, id, hash('a'), hash('b'), value, unit]);
  await insertRecord('total_energy', 'total-source-1', 90.5, 'kcal');
  await insertRecord('total_energy', 'total-source-2', 90.5, 'kcal');
  assert.equal((await db.query('select count(*)::int as n from public.beta_health_records where domain=$1', ['total_energy'])).rows[0].n, 2);
  assert.equal((await db.query('select count(*)::int as n from private.beta_score_recompute_queue')).rows[0].n, 0);
  await insertRecord('steps', 'steps-source-1', 1000, 'count');
  assert.equal((await db.query('select count(*)::int as n from private.beta_score_recompute_queue')).rows[0].n, 2);
  await db.exec(`create trigger engine_health_rolling_dirty after insert or update of source_revision,source_content_hash,operation,invalidated_at
    on public.beta_health_records for each row execute function private.engine_enqueue_health_rolling();`);
  await insertRecord('total_energy', 'total-source-3', 45, 'kcal');
  assert.equal((await db.query('select count(*)::int as n from private.beta_score_recompute_queue')).rows[0].n, 2);
  console.log('Android Total Energy SQL compatibility: PASS (synthetic PGlite)');
} finally {
  await db.close();
}
