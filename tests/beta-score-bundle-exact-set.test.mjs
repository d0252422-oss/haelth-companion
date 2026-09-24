// Isolated PostgreSQL only. Verifies a duplicate/missing score type cannot
// partially persist or mark its queue COMPLETE, then proves the exact set works.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalPostgres, subjects} from '../scripts/local-engine-postgres.mjs';

const scoreTypes = [
  'sleep', 'activity', 'training', 'nutrition', 'body_composition',
  'recovery', 'fatigue', 'health_overall',
];
const resultFor = score_type => ({
  score_type,
  score: 75,
  completeness: 1,
  confidence: 'HIGH',
  status: 'READY',
  missing_components: [],
  algorithm_version: 'health-score-v1.0',
  safe_output: {},
});

test('actual PG rejects duplicate/missing score type atomically and accepts exact v1 set', async () => {
  const pg = await createLocalPostgres({port:57484, release:'AB'});
  try {
    const user = subjects.A.canonical;
    const date = '2026-09-20';
    const fingerprint = 'a'.repeat(64);
    await pg.admin`insert into private.beta_score_recompute_queue(canonical_user_id,score_date)
      values(${user},${date}::date)`;

    const [functionSecurity] = await pg.admin`select p.prosecdef,p.proconfig,
      has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
      has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
      has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute,
      has_function_privilege('health_manual_api',p.oid,'EXECUTE') as manual_execute,
      has_function_privilege('health_recompute_worker',p.oid,'EXECUTE') as worker_execute
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='beta_persist_score_bundle'`;
    assert.equal(functionSecurity.prosecdef, false);
    assert.ok(functionSecurity.proconfig.includes('search_path=""'));
    assert.deepEqual({
      anon:functionSecurity.anon_execute,
      authenticated:functionSecurity.authenticated_execute,
      serviceRole:functionSecurity.service_role_execute,
      manual:functionSecurity.manual_execute,
      worker:functionSecurity.worker_execute,
    }, {anon:false, authenticated:false, serviceRole:true, manual:true, worker:true});

    const invalid = scoreTypes.map(resultFor);
    invalid[2] = resultFor('sleep');
    await assert.rejects(
      pg.admin`select public.beta_persist_score_bundle(
        ${user},${date}::date,1,${fingerprint},now(),now(),${pg.admin.json(invalid)}
      )`,
      /INVALID_SCORE_BUNDLE_EXACT_SET/,
    );
    const [afterReject] = await pg.admin`select
      (select count(*)::int from public.beta_health_scores where canonical_user_id=${user} and score_date=${date}::date) as score_count,
      (select status from private.beta_score_recompute_queue where canonical_user_id=${user} and score_date=${date}::date) as queue_status`;
    assert.deepEqual(afterReject, {score_count:0, queue_status:'DIRTY'});

    const lateInvalid = scoreTypes.map(resultFor);
    lateInvalid.at(-1).confidence = 'INVALID';
    await assert.rejects(
      pg.admin`select public.beta_persist_score_bundle(
        ${user},${date}::date,1,${fingerprint},now(),now(),${pg.admin.json(lateInvalid)}
      )`,
      /INVALID_SCORE_RESULT/,
    );
    const [afterLateReject] = await pg.admin`select
      (select count(*)::int from public.beta_health_scores where canonical_user_id=${user} and score_date=${date}::date) as score_count,
      (select status from private.beta_score_recompute_queue where canonical_user_id=${user} and score_date=${date}::date) as queue_status`;
    assert.deepEqual(afterLateReject, {score_count:0, queue_status:'DIRTY'});

    const [persisted] = await pg.admin`select public.beta_persist_score_bundle(
      ${user},${date}::date,1,${fingerprint},now(),now(),${pg.admin.json(scoreTypes.map(resultFor))}
    ) as result`;
    assert.equal(persisted.result, 'PERSISTED');
    const [afterPersist] = await pg.admin`select
      count(*)::int as score_count,
      count(distinct score_type)::int as distinct_score_types
      from public.beta_health_scores where canonical_user_id=${user} and score_date=${date}::date`;
    assert.deepEqual(afterPersist, {score_count:8, distinct_score_types:8});
    const [queue] = await pg.admin`select status from private.beta_score_recompute_queue
      where canonical_user_id=${user} and score_date=${date}::date`;
    assert.equal(queue.status, 'COMPLETE');
  } finally {
    await pg.close();
  }
});
