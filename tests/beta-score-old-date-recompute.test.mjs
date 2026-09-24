// Isolated PostgreSQL only. Proves a native record date move dirties both the
// prior and current local dates after the additive durable-queue forward fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {createLocalPostgres, subjects} from '../scripts/local-engine-postgres.mjs';

test('actual PG native D1 to D2 update invalidates both local dates exactly once', async () => {
  const pg = await createLocalPostgres({port:57485,release:'AB'});
  try {
    const user = subjects.A.canonical;
    const d1 = '2026-09-18', d2 = '2026-09-19', sourceId = `score-date-move-${randomUUID()}`;
    const hash = value => createHash('sha256').update(value).digest('hex');
    await pg.admin`insert into public.beta_health_records(
      canonical_user_id,platform,domain,source_app,source_record_id,source_revision,
      source_content_hash,idempotency_key,operation,canonical_record,affected_local_dates
    ) values(
      ${user},'android','steps','SYNTHETIC local PG date-move fixture',${sourceId},1,
      ${hash('revision-1')},${hash('request-1')},'UPSERT',
      ${pg.admin.json({domain:'steps',value:6000,unit:'count',recorded_at:`${d1}T08:00:00+08:00`})},array[${d1}::date]
    )`;
    const [initial] = await pg.admin`select generation,status from private.beta_score_recompute_queue where canonical_user_id=${user} and score_date=${d1}::date`;
    assert.equal(String(initial.generation),'1'); assert.equal(initial.status,'DIRTY');
    await pg.admin`update private.beta_score_recompute_queue set status='COMPLETE',completed_at=now(),attempt_count=3,lease_token=${randomUUID()},lease_expires_at=now()+interval '1 hour' where canonical_user_id=${user} and score_date=${d1}::date`;

    await pg.admin`update public.beta_health_records set
      source_revision=2,source_content_hash=${hash('revision-2')},
      canonical_record=${pg.admin.json({domain:'steps',value:8000,unit:'count',recorded_at:`${d2}T08:00:00+08:00`})},
      affected_local_dates=array[${d2}::date],updated_at=now()
      where canonical_user_id=${user} and source_record_id=${sourceId}`;

    const rows = await pg.admin`select score_date::text,generation,status,attempt_count,lease_token,lease_expires_at,completed_at,last_error_code
      from private.beta_score_recompute_queue where canonical_user_id=${user} and score_date in (${d1}::date,${d2}::date) order by score_date`;
    assert.deepEqual(rows.map(row => ({date:row.score_date,generation:String(row.generation),status:row.status})),[
      {date:d1,generation:'2',status:'DIRTY'},
      {date:d2,generation:'1',status:'DIRTY'},
    ]);
    assert.ok(rows.every(row => row.attempt_count===0 && row.lease_token===null && row.lease_expires_at===null && row.completed_at===null && row.last_error_code===null));
  } finally {
    await pg.close();
  }
});
