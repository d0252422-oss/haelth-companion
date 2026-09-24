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
  const pg = await createLocalPostgres({port:57485, release:'AB'});
  try {
    const user = subjects.A.canonical;
    const date = '2026-09-20';
    const fingerprint = 'a'.repeat(64);
    await pg.admin`insert into private.beta_score_recompute_queue(canonical_user_id,score_date)
      values(${user},${date}::date)`;

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
