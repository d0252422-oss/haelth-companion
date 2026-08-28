'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const policy = JSON.parse(fs.readFileSync('config/algorithm-runtime.policy.json', 'utf8'));
const workflow = fs.readFileSync('.github/workflows/algorithm-runtime-gate.yml', 'utf8');

test('runtime freeze keeps Apps Script current and Python future candidate', () => {
  assert.equal(policy.algorithm.algorithm_version, 'health-score-v1.0');
  assert.equal(policy.algorithm.fixture_version, 'HEALTH_ALGORITHM_GOLDEN_V1');
  assert.equal(policy.algorithm.current_production_runtime, 'APPS_SCRIPT_JAVASCRIPT');
  assert.equal(policy.algorithm.future_candidate_canonical_engine, 'PYTHON_3_12_PERSISTENT');
  assert.equal(policy.algorithm.future_candidate_frozen, true);
  assert.equal(policy.transport.production, 'NOT_FROZEN');
});

test('routing freezes CURRENT default, SHADOW first, and no production activation', () => {
  assert.equal(policy.routing.default, 'CURRENT');
  assert.equal(policy.routing.invalid_config, 'CURRENT');
  assert.equal(policy.routing.first_deployment_state, 'SHADOW');
  assert.equal(policy.routing.production_candidate_activation, false);
  assert.equal(policy.promotion.exact_parity_required, true);
  assert.equal(policy.promotion.unexplained_divergence_allowed, 0);
  assert.equal(policy.promotion.candidate_writes_allowed, 0);
});

test('resource policy matches bounded persistent worker defaults', () => {
  assert.equal(policy.transport.max_request_bytes, 1_048_576);
  assert.equal(policy.transport.max_pending_requests, 64);
  assert.equal(policy.transport.request_timeout_ms, 3000);
  assert.equal(policy.transport.startup_timeout_ms, 5000);
  assert.equal(policy.concurrency.execution, 'SINGLE_THREADED');
  assert.equal(policy.concurrency.cross_user_state_allowed, false);
});

test('CI workflow is test-only and covers every algorithm gate', () => {
  for (const required of ['algorithm-golden-parity.test.cjs', 'algorithm-runtime-adapter.test.cjs', 'persistent-algorithm-runtime.test.cjs', 'algorithm-runtime-policy.test.cjs', 'test_algorithm_golden_parity.py', 'test_algorithm_runtime_transport.py']) {
    assert.match(workflow, new RegExp(required.replaceAll('.', '\\.'), 'u'));
  }
  assert.match(workflow, /permissions:\s*\n\s*contents: read/u);
  assert.doesNotMatch(workflow, /deploy|production|environment:|id-token:\s*write|packages:\s*write/u);
});
