'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const {
  AlgorithmRuntimeRouter, AppsScriptRuntimeAdapter, PythonRuntimeAdapter,
  compareResults, selectRuntime,
} = require('../scripts/algorithm-runtime-adapter.cjs');

const fixtures = JSON.parse(fs.readFileSync('fixtures/algorithm-golden/health-score-v1.0.json', 'utf8')).fixtures;

function requestFor(fixture = fixtures[0]) {
  return {
    algorithm_id: fixture.algorithm_id,
    algorithm_version: fixture.algorithm_version,
    domain: fixture.domain,
    subject_ref: 'local-test-subject',
    period_start: fixture.input_window.start,
    period_end: fixture.input_window.end,
    timezone: fixture.timezone,
    canonical_inputs: fixture.canonical_inputs,
    missing_input_metadata: {},
    traceability_refs: ['record-b', 'record-a'],
    trace_id: 'trace-safe-001',
  };
}

test('runtime selection is fail-closed to CURRENT', () => {
  assert.equal(selectRuntime('CURRENT'), 'CURRENT');
  assert.equal(selectRuntime('shadow'), 'SHADOW');
  assert.equal(selectRuntime('candidate'), 'CANDIDATE');
  assert.equal(selectRuntime('invalid'), 'CURRENT');
  assert.equal(selectRuntime(null), 'CURRENT');
});

test('CURRENT preserves the exact Apps Script response and has no candidate call', () => {
  let candidateCalls = 0;
  const candidate = { name: 'TEST', execute() { candidateCalls += 1; throw new Error('must not run'); } };
  const current = new AppsScriptRuntimeAdapter();
  const request = requestFor();
  const direct = current.execute(request);
  const routed = new AlgorithmRuntimeRouter({ current, candidate }).execute(request, 'CURRENT');
  assert.deepEqual(routed.userResult, direct.raw);
  assert.deepEqual(routed.normalizedResult, direct.normalized);
  assert.equal(candidateCalls, 0);
  assert.equal(routed.telemetry.runtime_selected, 'CURRENT');
});

test('SHADOW returns current result, compares candidate, and performs no write', () => {
  let candidateCalls = 0;
  let writes = 0;
  const current = new AppsScriptRuntimeAdapter();
  const candidate = { name: 'TEST_CANDIDATE', computeOnly: true, execute(request) { candidateCalls += 1; return current.execute(request); } };
  const request = requestFor();
  const direct = current.execute(request);
  const routed = new AlgorithmRuntimeRouter({ current, candidate, telemetry() {} }).execute(request, 'SHADOW');
  assert.deepEqual(routed.userResult, direct.raw);
  assert.equal(routed.shadowComparison.parity_result, 'MATCH');
  assert.equal(candidateCalls, 1);
  assert.equal(writes, 0);
  assert.equal(candidate.computeOnly, true);
});

test('candidate failure in SHADOW is sanitized and does not fail user result', () => {
  const current = new AppsScriptRuntimeAdapter();
  const candidate = { name: 'BROKEN', execute() { throw new Error('secret raw health payload'); } };
  const request = requestFor();
  const result = new AlgorithmRuntimeRouter({ current, candidate }).execute(request, 'SHADOW');
  assert.deepEqual(result.userResult, current.execute(request).raw);
  assert.equal(result.telemetry.fallback_used, true);
  assert.equal(result.telemetry.error_class, 'RUNTIME_FAILURE');
  assert.doesNotMatch(JSON.stringify(result.telemetry), /secret|health payload/u);
});

test('current runtime failure remains a request failure', () => {
  const current = { execute() { throw new Error('CURRENT_FAILED'); } };
  assert.throws(() => new AlgorithmRuntimeRouter({ current }).execute(requestFor(), 'SHADOW'), /CURRENT_FAILED/u);
});

test('comparison classifies formula, null, rounding, and ordering differences', () => {
  const base = { value: 80, score: 80, completeness: 1, confidence: 'HIGH', missing_inputs: [], reason_codes: ['A', 'B'], algorithm_version: 'health-score-v1.0' };
  assert.equal(compareResults(base, { ...base }).difference_class, 'MATCH');
  assert.equal(compareResults(base, { ...base, score: 70 }).difference_class, 'FORMULA_DIVERGENCE');
  assert.equal(compareResults(base, { ...base, score: null }).difference_class, 'NULL_SEMANTICS');
  assert.equal(compareResults(base, { ...base, score: 80.05, value: 80.05 }).difference_class, 'ROUNDING_ONLY');
  assert.equal(compareResults(base, { ...base, reason_codes: ['B', 'A'] }).difference_class, 'ORDERING_ONLY');
});

test('production candidate activation is disabled and fails closed to current', () => {
  let candidateCalls = 0;
  const candidate = { name: 'TEST', execute() { candidateCalls += 1; return {}; } };
  const result = new AlgorithmRuntimeRouter({ candidate }).execute(requestFor(), 'CANDIDATE');
  assert.equal(result.telemetry.runtime_selected, 'CURRENT');
  assert.equal(candidateCalls, 0);
});

test('local candidate selection and rollback are configuration-only', () => {
  const current = new AppsScriptRuntimeAdapter();
  const candidate = { name: 'TEST', execute(request) { return current.execute(request); } };
  const router = new AlgorithmRuntimeRouter({ current, candidate, allowNonProductionCandidate: true });
  const request = requestFor();
  const before = router.execute(request, 'CURRENT').normalizedResult;
  const candidateResult = router.execute(request, 'CANDIDATE').normalizedResult;
  const after = router.execute(request, 'CURRENT').normalizedResult;
  assert.deepEqual(candidateResult, before);
  assert.deepEqual(after, before);
});

test('CURRENT to SHADOW to CURRENT rollback is deterministic', () => {
  const router = new AlgorithmRuntimeRouter();
  const request = requestFor(fixtures.find((fixture) => fixture.class === 'PARTIAL_INPUT'));
  const before = router.execute(request, 'CURRENT').normalizedResult;
  const shadow = router.execute(request, 'SHADOW');
  const after = router.execute(request, 'CURRENT').normalizedResult;
  assert.equal(shadow.shadowComparison.parity_result, 'MATCH');
  assert.deepEqual(after, before);
});

test('null/missing, real zero, partial, and deterministic repeat preserve semantics', () => {
  const router = new AlgorithmRuntimeRouter();
  for (const classification of ['ALL_MISSING', 'REAL_ZERO', 'PARTIAL_INPUT']) {
    const fixture = fixtures.find((item) => item.class === classification);
    assert.ok(fixture, `fixture ${classification}`);
    const request = requestFor(fixture);
    const first = router.execute(request, 'SHADOW');
    const second = router.execute(request, 'SHADOW');
    assert.deepEqual(first.normalizedResult, second.normalizedResult);
    assert.equal(first.shadowComparison.parity_result, 'MATCH');
  }
});

test('all 28 fixtures match through both runtime adapters', () => {
  const current = new AppsScriptRuntimeAdapter();
  const candidate = new PythonRuntimeAdapter();
  for (const fixture of fixtures) {
    const request = requestFor(fixture);
    const primary = current.execute(request).normalized;
    const shadow = candidate.execute(request).normalized;
    const comparison = compareResults(primary, shadow);
    assert.equal(comparison.parity_result, 'MATCH', `${fixture.fixture_id}: ${JSON.stringify(comparison)}`);
  }
});

test('telemetry is allowlisted and excludes canonical health inputs', () => {
  const events = [];
  const request = requestFor();
  request.canonical_inputs.secret_marker = 'must-not-log';
  new AlgorithmRuntimeRouter({ telemetry(event) { events.push(event); } }).execute(request, 'SHADOW');
  assert.equal(events.length, 1);
  assert.deepEqual(Object.keys(events[0]).sort(), ['algorithm_id', 'algorithm_version', 'difference_class', 'duration_ms', 'error_class', 'fallback_used', 'parity_result', 'runtime_selected', 'shadow_duration_ms', 'shadow_runtime', 'trace_id'].sort());
  assert.doesNotMatch(JSON.stringify(events), /must-not-log/u);
});
