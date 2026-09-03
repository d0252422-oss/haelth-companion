'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const read = (path) => fs.readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20260903021109_durable_beta_score_processor.sql');
const edge = read('supabase/functions/mobile-health-beta/index.ts');
const bridge = read('supabase/functions/mobile-health-beta/score-bridge.ts');
const web = read('beta-tester-site/index.html');

test('ingestion dirty state is durable and processor is independent of request lifetime', () => {
  assert.match(migration, /status = 'DIRTY'.*attempt_count = 0.*next_attempt_at = now\(\)/su);
  assert.match(migration, /cron\.schedule\([\s\S]*health-companion-beta-score-processor[\s\S]*internal\/score-recompute\/drain/u);
  assert.match(migration, /vault\.decrypted_secrets/u);
  assert.match(edge, /POST" && path === "\/internal\/score-recompute\/drain/u);
  assert.match(edge, /x-score-worker-secret/u);
  assert.match(edge, /beta_authorize_score_worker/u);
  assert.match(migration, /from vault\.decrypted_secrets/u);
  assert.match(migration, /revoke all on function public\.beta_authorize_score_worker\(text\) from public, anon, authenticated/u);
});

test('claiming is bounded, locked, leased, and supports multiple dirty dates', () => {
  assert.match(migration, /for update skip locked/u);
  assert.match(migration, /limit least\(greatest\(p_limit, 1\), 5\)/u);
  assert.match(migration, /status = 'PROCESSING'.*lease_token = p_worker_token.*interval '2 minutes'/su);
  assert.match(edge, /Math\.min\(Math\.max\(Number\(body\.limit\), 1\), 5\)/u);
  assert.match(edge, /for \(const row of claimed as Json\[\]\)/u);
});

test('successful recompute completes idempotently without changing score formula', () => {
  const storage = read('supabase/migrations/20260829091747_beta_score_bridge_storage.sql');
  assert.match(edge, /await recomputeBetaScore\(admin, String\(row\.canonical_user_id\), String\(row\.score_date\)\)/u);
  assert.match(storage, /status = 'COMPLETE'/u);
  assert.match(storage, /where public\.beta_health_scores\.input_fingerprint is distinct from excluded\.input_fingerprint/u);
  assert.match(bridge, /health-score-v1\.0/u);
  assert.doesNotMatch(migration, /weight|threshold|normalization/iu);
});

test('real Beta input volume fits a larger but still hard-bounded reader', () => {
  assert.match(bridge, /const MAX_SCORE_INPUT_ROWS = 20_000/u);
  assert.match(bridge, /const SCORE_INPUT_PAGE_SIZE = 1000/u);
  assert.match(bridge, /start < MAX_SCORE_INPUT_ROWS/u);
  assert.match(bridge, /throw new Error\("SCORE_INPUT_BOUND_EXCEEDED"\)/u);
  const retry = read('supabase/migrations/20260903062110_retry_beta_score_input_bound_after_capacity_fix.sql');
  assert.match(retry, /where status = 'FAILED' and last_error_code = 'SCORE_INPUT_BOUND_EXCEEDED'/u);
  assert.doesNotMatch(retry, /beta_health_scores|canonical_record|health-score-v1\.0/iu);
});

test('failed work remains retryable with bounded backoff and a terminal state', () => {
  assert.match(edge, /beta_fail_score_recompute/u);
  assert.match(migration, /q\.attempt_count < 5 then 'DIRTY' else 'FAILED'/u);
  assert.match(migration, /make_interval\(secs => least\(300,/u);
  assert.match(migration, /WORKER_LEASE_EXPIRED/u);
  assert.match(migration, /q\.attempt_count < 5/u);
  assert.match(migration, /check \(attempt_count between 0 and 5\)/u);
});

test('lease and generation prevent stale or cross-worker failure mutation', () => {
  assert.match(migration, /q\.canonical_user_id = p_canonical_user_id and q\.score_date = p_score_date/u);
  assert.match(migration, /q\.generation = p_generation and q\.status = 'PROCESSING'/u);
  assert.match(migration, /q\.lease_token = p_worker_token/u);
  assert.match(migration, /STALE_SCORE_LEASE/u);
});

test('freshness RPCs are user scoped, service-role only, and production isolated', () => {
  assert.match(migration, /where r\.canonical_user_id = p_canonical_user_id/u);
  assert.match(migration, /where q\.canonical_user_id = p_canonical_user_id/u);
  assert.match(migration, /revoke all on function public\.beta_get_health_freshness.*anon, authenticated/u);
  assert.match(migration, /grant execute on function public\.beta_get_health_freshness.*service_role/u);
  assert.match(migration, /uavimjgccigpbwqmfkhh/u);
  assert.doesNotMatch(migration + edge + web, /vptqedxdxfoohbqctujf/u);
});

test('Web reads raw sleep freshness and exposes stale-score state', () => {
  assert.match(edge, /GET" && path === "\/v1\/health\/latest/u);
  assert.match(edge, /beta_get_health_freshness/u);
  assert.match(bridge, /latest_sleep_date/u);
  assert.match(bridge, /score_freshness: pending > 0 \? "UPDATING"/u);
  assert.match(web, /\/v1\/health\/latest/u);
  assert.match(web, /健康資料已更新，分析更新中/u);
  assert.match(web, /睡眠最新日期/u);
});

test('date handling preserves canonical local dates including Asia Taipei boundaries', () => {
  assert.match(migration, /cross join lateral unnest\(r\.affected_local_dates\) d\(local_date\)/u);
  assert.match(migration, /max\(local_date\)/u);
  assert.doesNotMatch(migration, /at time zone|date_trunc/iu);
  assert.match(bridge, /affected_local_dates\.includes\(localDate\)/u);
});

test('score GET is read-only and reports queued analysis rather than relying on request survival', () => {
  const scoreGet = edge.slice(edge.indexOf('async function getScores('), edge.indexOf('async function getLatestHealth('));
  assert.doesNotMatch(scoreGet, /processScoreQueue|recomputeBetaScore/u);
  assert.match(scoreGet, /readBetaScores/u);
  assert.match(scoreGet, /score_freshness === "UPDATING" \? "QUEUED"/u);
});
