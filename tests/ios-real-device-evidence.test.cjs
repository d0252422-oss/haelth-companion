'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REQUIRED_TEST_IDS,
  createTemplate,
  validateEvidence,
} = require('../scripts/ios-real-device-evidence.cjs');

function completedEvidence() {
  const evidence = createTemplate();
  evidence.template_only = false;
  evidence.app = { commit: 'de5bd0b', bundle_id: 'tw.lifehelper.healthsync' };
  evidence.device.ios_version = '17.test-fixture';
  evidence.domain_record_counts = { steps: 1, heart_rate: 1, sleep: 1 };
  evidence.test_cases = REQUIRED_TEST_IDS.map((testID) => ({
    ...evidence.test_cases.find((item) => item.test_id === testID),
    status: 'PASS',
    started_at: '2026-08-28T00:00:00Z',
    completed_at: '2026-08-28T00:00:01Z',
    preconditions: 'fixture precondition',
    device_state: 'fixture device state',
    input_summary: 'fixture input without health values',
    action: 'fixture action',
    expected_result: 'fixture expected result',
    pass_criteria: 'fixture pass criteria',
    fail_criteria: 'fixture fail criteria',
    evidence_required: 'fixture evidence requirement',
    evidence_refs: ['fixture-ref'],
  }));
  return evidence;
}

test('template is explicitly not valid real-device PASS evidence', () => {
  assert.throws(() => validateEvidence(createTemplate()), /TEMPLATE_IS_NOT_REAL_EVIDENCE/u);
});

test('complete physical-device evidence contract passes structural validation', () => {
  const summary = validateEvidence(completedEvidence());
  assert.equal(summary.status, 'PASS');
  assert.equal(summary.tests_total, 13);
  assert.equal(summary.tests_failed, 0);
});

test('simulator, synthetic, and missing-domain evidence fail closed', () => {
  const simulator = completedEvidence();
  simulator.simulator = true;
  assert.throws(() => validateEvidence(simulator), /SIMULATOR_OR_SYNTHETIC_REJECTED/u);

  const synthetic = completedEvidence();
  synthetic.synthetic = true;
  assert.throws(() => validateEvidence(synthetic), /SIMULATOR_OR_SYNTHETIC_REJECTED/u);

  const missingDomain = completedEvidence();
  missingDomain.domain_record_counts.sleep = 0;
  assert.throws(() => validateEvidence(missingDomain), /REAL_DOMAIN_RECORD_REQUIRED/u);
});

test('missing tests, failed cases, typed input, and production writes fail closed', () => {
  const missing = completedEvidence();
  missing.test_cases.pop();
  assert.throws(() => validateEvidence(missing), /MISSING_TEST_CASE/u);

  const failed = completedEvidence();
  failed.test_cases[0].status = 'FAIL';
  assert.throws(() => validateEvidence(failed), /TEST_CASE_NOT_PASS/u);

  const typed = completedEvidence();
  typed.user_typed_input_count = 1;
  assert.throws(() => validateEvidence(typed), /ZERO_INPUT_REQUIREMENT_FAILED/u);

  const production = completedEvidence();
  production.production_writes = 1;
  assert.throws(() => validateEvidence(production), /PRODUCTION_WRITE_EVIDENCE_REJECTED/u);
});

test('sensitive evidence keys are rejected without inspecting their values', () => {
  const evidence = completedEvidence();
  evidence.test_cases[0].runtime.access_token = null;
  assert.throws(() => validateEvidence(evidence), /SENSITIVE_EVIDENCE_KEY/u);
});
