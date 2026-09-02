'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const read = (path) => fs.readFileSync(path, 'utf8');
const fixtures = JSON.parse(read('fixtures/algorithm-golden/health-score-v1.0.json')).fixtures;
const context = { console: { log() {}, warn() {}, error() {} } };
vm.createContext(context);
vm.runInContext(read('fixtures/algorithm-golden/apps-script-health-score-v1.0.snapshot.js'), context);
const runtime = context.HEALTH_SCORE_V1_RUNTIME;
const functions = {
  sleep: 'calculateSleepScore', activity: 'calculateActivityScore', training: 'calculateTrainingScore',
  nutrition: 'calculateNutritionScore', body_composition: 'calculateBodyCompositionScore',
  recovery: 'calculateRecoveryScore', fatigue: 'calculateFatigueIndex', health_overall: 'calculateHealthScore',
};

test('Beta runtime reuses the frozen Apps Script formulas for all 28 golden fixtures', () => {
  assert.equal(runtime.algorithmVersion, 'health-score-v1.0');
  for (const fixture of fixtures) {
    const result = runtime[functions[fixture.domain]](fixture.canonical_inputs);
    const reasonCodes = result.dependencyAdjustment && result.dependencyAdjustment !== 'NONE'
      ? [result.dependencyAdjustment] : [];
    assert.deepEqual({
      expected_score: result.score,
      expected_completeness: result.completeness,
      expected_confidence: result.confidence,
      expected_missing_inputs: [...(result.missingData || [])].sort(),
      expected_reason_codes: reasonCodes,
      algorithm_version: runtime.algorithmVersion,
    }, fixture.expected, fixture.fixture_id);
  }
});

test('score storage is default-deny, version-frozen, and fingerprint-idempotent', () => {
  const sql = read('supabase/migrations/20260829091747_beta_score_bridge_storage.sql');
  assert.match(sql, /algorithm_version text not null check \(algorithm_version = 'health-score-v1\.0'\)/u);
  assert.match(sql, /unique \(canonical_user_id, score_date, score_type, algorithm_version\)/u);
  assert.match(sql, /where public\.beta_health_scores\.input_fingerprint is distinct from excluded\.input_fingerprint/u);
  assert.match(sql, /alter table public\.beta_health_scores enable row level security/u);
  assert.match(sql, /revoke all on table public\.beta_health_scores from public, anon, authenticated/u);
  assert.match(sql, /generation = p_generation/u);
});

test('ingestion queues scores and authenticated score reads perform bounded recompute', () => {
  const edge = read('supabase/functions/mobile-health-beta/index.ts');
  const androidIngest = edge.slice(edge.indexOf('async function ingest('), edge.indexOf('async function reportStatus('));
  const bridge = read('supabase/functions/mobile-health-beta/score-bridge.ts');
  const dirtyDates = read('supabase/migrations/20260829135430_beta_score_dirty_old_dates.sql');
  assert.match(edge, /beta_ingest_health_mutation_batch/u);
  assert.match(edge, /beta_list_dirty_score_dates/u);
  assert.match(edge, /recomputeDates\(admin, userId, new Set\(dirtyDates\)\)/u);
  assert.doesNotMatch(androidIngest, /recomputeDates|recomputeBetaScore/u);
  assert.match(edge, /dates\.size > 31/u);
  assert.match(edge, /const subject = await verifyWebSession\(bearer\(request\)\)/u);
  assert.match(edge, /uuidFromHash\(await sha256\(subject\)\)/u);
  assert.match(bridge, /\.eq\("operation", "UPSERT"\)\.is\("invalidated_at", null\)/u);
  assert.match(bridge, /SCORE_INPUT_BOUND_EXCEEDED/u);
  assert.match(dirtyDates, /affected_dates := affected_dates \|\| old\.affected_local_dates/u);
  assert.match(dirtyDates, /select distinct unnest\(affected_dates\)/u);
  assert.doesNotMatch(bridge, /service_role|SUPABASE_SERVICE_ROLE_KEY/u);
});

test('assembler preserves missing data and does not invent training or nutrition evidence', () => {
  const bridge = read('supabase/functions/mobile-health-beta/score-bridge.ts');
  assert.match(bridge, /calculateTrainingScore\(\{\}\)/u);
  assert.match(bridge, /calculateNutritionScore\(\{\}\)/u);
  assert.match(bridge, /sleepMinutes === null \? null/u);
  assert.doesNotMatch(bridge, /caloriesBurned:\s*0|trainingLoad:\s*0|nutritionScore:\s*0/u);
});
