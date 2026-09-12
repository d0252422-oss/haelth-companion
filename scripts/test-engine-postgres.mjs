// Embedded PostgreSQL: synthetic local validation; never contacts Supabase.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite();
let passed = 0;
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.users(id uuid PRIMARY KEY);
    INSERT INTO users VALUES ('00000000-0000-0000-0000-000000000001'),
    ('00000000-0000-0000-0000-000000000002');`);
  await db.exec(await fs.readFile(new URL(
    '../supabase/migrations/20260912032458_multi_domain_engine_versioned_outputs.sql', import.meta.url), 'utf8'));
  passed++;
  const user = '00000000-0000-0000-0000-000000000001';
  const hash = 'a'.repeat(64);
  await db.query(`INSERT INTO engine_output_history VALUES ($1,'2026-09-12','activity',
    'activity-score-v1.0',$2,0,'PARTIAL_DATA',0.5,'LOW','{}',now())`, [user, hash]);
  await db.query(`INSERT INTO engine_output_heads VALUES ($1,'2026-09-12','activity',
    'activity-score-v1.0',$2)`, [user, hash]);
  assert.equal((await db.query('SELECT score FROM engine_output_history')).rows[0].score, '0');
  passed++;
  await db.exec('SET ROLE authenticated');
  assert.equal((await db.query('SELECT * FROM engine_output_history')).rows.length, 0);
  assert.equal((await db.query('SELECT * FROM engine_output_heads')).rows.length, 0);
  await assert.rejects(db.query(`INSERT INTO engine_output_heads VALUES ($1,'2026-09-13',
    'activity','activity-score-v1.0',$2)`, [user, hash]));
  await db.exec('RESET ROLE');
  passed++;
  await assert.rejects(db.query(`INSERT INTO engine_output_history VALUES ($1,'2026-09-13',
    'activity','activity-score-v1.0',$2,1,'VALID',100,'LOW','{}',now())`, [user, hash]));
  await assert.rejects(db.query(`INSERT INTO engine_output_history VALUES ($1,'2026-09-13',
    'activity','activity-score-v1.0',$2,1,'INSUFFICIENT_DATA',0,'LOW','{}',now())`, [user, hash]));
  await assert.rejects(db.query(`INSERT INTO engine_output_heads VALUES
    ('00000000-0000-0000-0000-000000000002','2026-09-12','activity','activity-score-v1.0',$1)`, [hash]));
  passed++;
  await db.exec(`SET ROLE service_role`);
  await assert.rejects(db.query(`UPDATE engine_output_history SET score=10`));
  await db.exec('RESET ROLE');
  passed++;
  await db.exec('BEGIN');
  await db.query(`INSERT INTO engine_output_history VALUES ($1,'2026-09-13','activity',
    'activity-score-v1.0',$2,null,'INSUFFICIENT_DATA',0,'UNKNOWN','{}',now())`, [user, hash]);
  await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM engine_output_history')).rows[0].n, 1);
  passed++;
  // Enough synthetic heads for the optimizer to choose between a scan and owner/version index.
  await db.query(`INSERT INTO engine_output_history
    SELECT $1, d::date, 'activity', 'activity-score-v1.0', $2, 50,'VALID',1,'MEDIUM','{}',now()
    FROM generate_series('2020-01-01'::date,'2025-12-31'::date,'1 day') d`, [user, hash]);
  await db.exec(`INSERT INTO engine_output_heads SELECT canonical_user_id,calculation_date,
    output_kind,engine_version,input_fingerprint FROM engine_output_history ON CONFLICT DO NOTHING;
    ANALYZE engine_output_heads; ANALYZE engine_output_history;`);
  const plans = {};
  for (const days of [1,7,28]) {
    const { rows } = await db.query(`EXPLAIN (FORMAT JSON) SELECT h.payload FROM engine_output_heads c
      JOIN engine_output_history h USING(canonical_user_id,calculation_date,output_kind,engine_version,input_fingerprint)
      WHERE c.canonical_user_id=$1 AND c.output_kind='activity' AND c.engine_version='activity-score-v1.0'
      AND c.calculation_date BETWEEN '2025-12-01'::date AND '2025-12-01'::date + $2::int`, [user,days-1]);
    plans[days] = rows[0]['QUERY PLAN'];
    assert.match(JSON.stringify(plans[days]), /Index/);
    passed++;
  }
  console.log(JSON.stringify({status:'TEST_FIXTURE_PASS',checks_passed:passed,
    environment:'PGlite embedded PostgreSQL, in-memory synthetic data',plans}, null, 2));
} finally { await db.close(); }
