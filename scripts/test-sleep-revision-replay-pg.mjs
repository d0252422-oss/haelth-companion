// Synthetic-only test of the existing Beta ingestion migrations against a new,
// dedicated loopback PostgreSQL 17.11 compatibility cluster. Never use a
// hosted project, an existing user database, or real Health Connect payloads.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import postgres from 'postgres';

assert.equal(process.env.LOCAL_ENGINE_PG_MAJOR, '17', 'REVIEWED_PG17_TRACK_REQUIRED');
assert.match(process.env.LOCAL_ENGINE_PG_BIN ?? '', /health-sleep-pg17-20261003[\\/]extracted[\\/]pgsql[\\/]bin$/i);
const host = '127.0.0.1';
const port = 57485;
const database = 'health_sleep_replay_20261003';
const sql = postgres({ host, port, database, username: 'postgres', max: 1, connect_timeout: 5 });
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const origin = 'com.example.synthetic-fit';
const parentId = 'synthetic-session-1003';
const stageId = `${parentId}:stage-1`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const revisionMs = (time) => BigInt(Date.parse(time));
const stageRevision = (time, extraMicroseconds = 0n) => 2n * (revisionMs(time) * 1000n + extraMicroseconds) + 1n;
const rollback = Symbol('ROLLBACK_SYNTHETIC_TEST');
let checks = 0;

try {
  const [version] = await sql`select current_setting('server_version_num')::int as n,
    current_database() as database, inet_server_addr()::text as addr, inet_server_port() as port`;
  assert.ok(version.n >= 170011 && version.n < 180000);
  assert.equal(version.database, database);
  assert.match(version.addr, /^127\.0\.0\.1(?:\/32)?$/);
  assert.equal(version.port, port);
  checks++;

  const [grant] = await sql`select has_function_privilege('authenticated',
    'public.beta_ingest_health_mutation(uuid,text,text,text,text,bigint,timestamptz,text,text,text,jsonb,date[])',
    'EXECUTE') as authenticated_can_ingest`;
  assert.equal(grant.authenticated_can_ingest, false);
  checks++;

  await assert.rejects(sql.begin(async (tx) => {
    await tx`set local role authenticated`;
    await tx`select public.beta_ingest_health_mutation(${owner}::uuid,'android','sleep',${origin},
      'unauthorized-synthetic-record',1,'2026-10-03T00:00:00Z',${'a'.repeat(64)},'UPSERT',
      ${'b'.repeat(64)},${tx.json({ domain: 'sleep' })}::jsonb,array['2026-10-03']::date[])`;
  }), /permission denied/i);
  checks++;

  try {
    await sql.begin(async (tx) => {
      await tx`insert into public.users(id,external_subject_hash) values
        (${owner}::uuid,${'a'.repeat(64)}),(${other}::uuid,${'b'.repeat(64)})`;
      const mutation = async ({ domain, id, revision, updatedAt, record, dates, source = origin, user = owner }) => {
        const contentHash = hash(JSON.stringify(record));
        const idempotency = hash(`${user}|android|${domain}|${source}|${id}`);
        const [result] = await tx`select public.beta_ingest_health_mutation(
          ${user}::uuid,'android',${domain},${source},${id},${revision.toString()}::bigint,
          ${updatedAt}::timestamptz,${contentHash},'UPSERT',${idempotency},
          ${tx.json(record)}::jsonb,${tx.array(dates)}::date[]) as action`;
        return result.action;
      };
      const stageOld = {
        domain: 'sleep_stage', source_record_id: stageId, started_at: '2026-10-02T14:30:00Z',
        ended_at: '2026-10-02T15:30:00Z', local_date: '2026-10-02',
        value: 60, unit: 'minute', stage: 'LIGHT',
      };
      const stageNew = { ...stageOld, local_date: '2026-10-03' };
      const stageTime = '2026-10-03T00:00:00Z';
      const oldStage = { domain: 'sleep_stage', id: stageId, revision: revisionMs(stageTime),
        updatedAt: stageTime, record: stageOld, dates: ['2026-10-02'] };
      const migratedStage = { ...oldStage, revision: stageRevision(stageTime),
        record: stageNew, dates: ['2026-10-03'] };

      // Existing beta.25 child arrives before its parent. Raw child is safe;
      // neither SQL nor the Web may invent a complete parent from fragments.
      assert.equal(await mutation(oldStage), 'CREATED');
      let [state] = await tx`select count(*) filter(where domain='sleep')::int as parents,
        count(*) filter(where domain='sleep_stage')::int as stages
        from public.beta_health_records where canonical_user_id=${owner}::uuid`;
      assert.deepEqual([state.parents, state.stages], [0, 1]);
      checks++;
      const [orphanDaily] = await tx`select sum((canonical_record->>'value')::numeric) as minutes
        from public.beta_health_records where canonical_user_id=${owner}::uuid
        and domain='sleep' and affected_local_dates @> array['2026-10-03']::date[]`;
      assert.equal(orphanDaily.minutes, null);
      checks++;

      assert.equal(await mutation(migratedStage), 'UPDATED');
      let [child] = await tx`select source_revision::text as revision,affected_local_dates::text as dates,
        canonical_record->>'local_date' as local_date from public.beta_health_records
        where canonical_user_id=${owner}::uuid and domain='sleep_stage' and source_record_id=${stageId}`;
      assert.equal(child.revision, migratedStage.revision.toString());
      assert.equal(child.local_date, '2026-10-03');
      assert.equal(child.dates, '{2026-10-03}');
      checks++;

      assert.equal(await mutation(oldStage), 'STALE_REJECTED');
      assert.equal(await mutation(migratedStage), 'REPLAYED');
      assert.equal(await mutation({ ...migratedStage, record: { ...stageNew, stage: 'REM' } }), 'CONFLICT_REJECTED');
      [child] = await tx`select source_revision::text as revision,canonical_record->>'stage' as stage
        from public.beta_health_records where canonical_user_id=${owner}::uuid and domain='sleep_stage'`;
      assert.equal(child.revision, migratedStage.revision.toString());
      assert.equal(child.stage, 'LIGHT');
      checks += 3;

      const parentTime = '2026-10-03T00:00:00Z';
      const parentRecord = {
        domain: 'sleep', source_record_id: parentId, started_at: '2026-10-02T14:00:00Z',
        ended_at: '2026-10-02T19:00:00Z', local_date: '2026-10-03', value: 300, unit: 'minute',
      };
      const parent = { domain: 'sleep', id: parentId, revision: revisionMs(parentTime),
        updatedAt: parentTime, record: parentRecord, dates: ['2026-10-03'] };
      assert.equal(await mutation(parent), 'CREATED');
      assert.equal(await mutation(parent), 'REPLAYED');
      [state] = await tx`select count(*) filter(where domain='sleep')::int as parents,
        count(*) filter(where domain='sleep_stage')::int as stages
        from public.beta_health_records where canonical_user_id=${owner}::uuid`;
      assert.deepEqual([state.parents, state.stages], [1, 1]);
      checks++;

      const stageLater = { ...migratedStage, revision: stageRevision(stageTime, 1n),
        updatedAt: '2026-10-03T00:00:00.000001Z',
        record: { ...stageNew, ended_at: '2026-10-02T15:40:00Z', value: 70 } };
      assert.ok(stageLater.revision > migratedStage.revision);
      assert.equal(await mutation(stageLater), 'UPDATED');
      const parentLater = { ...parent, revision: revisionMs('2026-10-03T00:00:01Z'),
        updatedAt: '2026-10-03T00:00:01Z',
        record: { ...parentRecord, ended_at: '2026-10-02T19:10:00Z', value: 310 } };
      assert.equal(await mutation(parentLater), 'UPDATED');
      checks += 2;

      // Raw parent intervals, not child stage minutes, define daily sleep.
      const [daily] = await tx`select sum(extract(epoch from upper(span)-lower(span))/60)::int as minutes
        from (select range_agg(tstzrange((canonical_record->>'started_at')::timestamptz,
          (canonical_record->>'ended_at')::timestamptz,'[)')) as ranges
          from public.beta_health_records where canonical_user_id=${owner}::uuid
          and domain='sleep' and affected_local_dates @> array['2026-10-03']::date[]) selected,
          lateral unnest(selected.ranges) span`;
      assert.equal(daily.minutes, 310);
      checks++;

      const [isolated] = await tx`select count(*)::int as n from public.beta_health_records
        where canonical_user_id=${other}::uuid`;
      assert.equal(isolated.n, 0);
      const [identity] = await tx`select count(*)::int as n,
        count(distinct (domain,source_app,source_record_id))::int as distinct_sources
        from public.beta_health_records where canonical_user_id=${owner}::uuid`;
      assert.equal(identity.n, identity.distinct_sources);
      assert.equal(identity.n, 2);
      checks++;

      throw rollback; // Keep the cluster and raw logs; never retain test health rows.
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  const [afterRollback] = await sql`select count(*)::int as n from public.beta_health_records`;
  assert.equal(afterRollback.n, 0);
  checks++;
  console.log(JSON.stringify({ status: 'PASS', checks, database, server: 'PostgreSQL 17.11',
    source: 'repository migration functions, synthetic records only', persisted_rows_after_rollback: afterRollback.n }));
} finally {
  await sql.end();
}
