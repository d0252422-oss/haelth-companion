// Isolated PostgreSQL-compatible migration rehearsal. No remote connection.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';

const migration = await readFile(new URL('../supabase/migrations/20260928110000_manual_total_energy_score_queue_scope.sql', import.meta.url), 'utf8');

test('total-energy writes remain durable without invalidating an unchanged score input', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema private;
      create table private.beta_score_recompute_queue (
        canonical_user_id text not null, score_date date not null,
        engine_required boolean not null, generation integer not null default 1,
        status text not null default 'DIRTY', attempt_count integer not null default 0,
        next_attempt_at timestamptz, lease_token text, lease_expires_at timestamptz,
        completed_at timestamptz, last_error_code text, updated_at timestamptz,
        primary key (canonical_user_id, score_date)
      );
      create table public.engine_manual_observations (
        canonical_user_id text not null, record_id text not null,
        local_date date not null, domain text not null, revision integer not null,
        deleted boolean not null default false, body jsonb not null,
        primary key (canonical_user_id, record_id)
      );
      create role test_worker nologin;
      create function private.engine_enqueue_observation() returns trigger
        language plpgsql security invoker as $$ begin return new; end $$;
      revoke all on function private.engine_enqueue_observation() from public;
      grant execute on function private.engine_enqueue_observation() to test_worker;
    `);
    await db.exec(migration);
    await db.exec(`create trigger engine_manual_observation_dirty after insert or update of revision
      on public.engine_manual_observations for each row execute function private.engine_enqueue_observation()`);
    const {rows: [{day}]} = await db.query("select (now() at time zone 'Asia/Taipei')::date::text as day");
    const insert = (id, domain) => db.query(`insert into public.engine_manual_observations
      (canonical_user_id,record_id,local_date,domain,revision,body)
      values ('user-a',$1,$2::date,$3,1,$4::jsonb)`, [id, day, domain, JSON.stringify({date: day, domain})]);
    const generation = async () => (await db.query(`select generation from private.beta_score_recompute_queue
      where canonical_user_id='user-a' and score_date=$1::date`, [day])).rows[0]?.generation ?? null;

    await insert('energy-1', 'total_energy');
    assert.equal(await generation(), null, 'first energy record must not queue health-score work');
    await db.query("update public.engine_manual_observations set revision=2 where canonical_user_id='user-a' and record_id='energy-1'");
    assert.equal(await generation(), null, 'an energy revision must not queue work');

    await insert('steps-1', 'steps');
    assert.equal(await generation(), 1, 'score-affecting steps still queue work');
    await db.query("update public.engine_manual_observations set revision=3, deleted=true where canonical_user_id='user-a' and record_id='energy-1'");
    assert.equal(await generation(), 1, 'an energy tombstone must not advance the generation');
    await db.query("update public.engine_manual_observations set revision=2 where canonical_user_id='user-a' and record_id='steps-1'");
    assert.equal(await generation(), 2, 'a steps revision must still invalidate the score');

    const {rows: [{count}]} = await db.query("select count(*)::integer as count from public.engine_manual_observations where canonical_user_id='user-a'");
    assert.equal(count, 2, 'raw records are preserved');
    const {rows: [{prosecdef}]} = await db.query("select prosecdef from pg_proc where proname='engine_enqueue_observation'");
    assert.equal(prosecdef, false, 'the delegated trigger stays security invoker');
    const {rows: [{allowed}]} = await db.query("select has_function_privilege('test_worker', 'private.engine_enqueue_observation()', 'EXECUTE') as allowed");
    assert.equal(allowed, true, 'existing function grants survive replacement');
  } finally {
    await db.close();
  }
});
