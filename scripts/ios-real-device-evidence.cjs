'use strict';

const fs = require('node:fs');

const REQUIRED_TEST_IDS = Array.from({ length: 13 }, (_, index) =>
  `IOS-RD-${String.fromCharCode(65 + index)}`,
);
const REQUIRED_DOMAINS = ['steps', 'heart_rate', 'sleep'];
const REQUIRED_CASE_FIELDS = [
  'test_id',
  'preconditions',
  'device_state',
  'input_summary',
  'action',
  'expected_result',
  'pass_criteria',
  'fail_criteria',
  'evidence_required',
  'evidence_refs',
];
const SENSITIVE_KEY = /(?:^|_)(?:access_token|refresh_token|token|secret|password|credential|email|install_claim|authorization_code|raw_payload|health_value)(?:_|$)/iu;

function fail(code, detail = '') {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  throw error;
}

function assertNoSensitiveKeys(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) fail('SENSITIVE_EVIDENCE_KEY', `${path}.${key}`);
    assertNoSensitiveKeys(nested, `${path}.${key}`);
  }
}

function validateEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    fail('MALFORMED_EVIDENCE');
  }
  assertNoSensitiveKeys(evidence);
  if (evidence.schema_version !== 'IOS_REAL_DEVICE_EVIDENCE_V1') fail('SCHEMA_VERSION_MISMATCH');
  if (evidence.template_only !== false) fail('TEMPLATE_IS_NOT_REAL_EVIDENCE');
  if (evidence.evidence_origin !== 'REAL_PHYSICAL_IPHONE') fail('REAL_DEVICE_EVIDENCE_REQUIRED');
  if (evidence.simulator !== false || evidence.synthetic !== false) fail('SIMULATOR_OR_SYNTHETIC_REJECTED');
  if (evidence.production_writes !== 0) fail('PRODUCTION_WRITE_EVIDENCE_REJECTED');
  if (evidence.user_typed_input_count !== 0) fail('ZERO_INPUT_REQUIREMENT_FAILED');
  if (!evidence.device || evidence.device.kind !== 'PHYSICAL_IPHONE') fail('PHYSICAL_IPHONE_REQUIRED');
  if (!evidence.app || typeof evidence.app.commit !== 'string' || !/^[0-9a-f]{7,40}$/u.test(evidence.app.commit)) {
    fail('APP_COMMIT_REQUIRED');
  }
  for (const domain of REQUIRED_DOMAINS) {
    if (!Number.isInteger(evidence.domain_record_counts?.[domain]) || evidence.domain_record_counts[domain] < 1) {
      fail('REAL_DOMAIN_RECORD_REQUIRED', domain);
    }
  }
  if (!Array.isArray(evidence.test_cases)) fail('TEST_CASES_REQUIRED');
  const byID = new Map();
  for (const testCase of evidence.test_cases) {
    if (!testCase || typeof testCase !== 'object') fail('MALFORMED_TEST_CASE');
    if (byID.has(testCase.test_id)) fail('DUPLICATE_TEST_ID', testCase.test_id);
    byID.set(testCase.test_id, testCase);
  }
  for (const testID of REQUIRED_TEST_IDS) {
    const testCase = byID.get(testID);
    if (!testCase) fail('MISSING_TEST_CASE', testID);
    for (const field of REQUIRED_CASE_FIELDS) {
      const value = testCase[field];
      if (Array.isArray(value) ? value.length === 0 : typeof value !== 'string' || value.trim() === '') {
        fail('INCOMPLETE_TEST_CASE', `${testID}.${field}`);
      }
    }
    if (testCase.status !== 'PASS') fail('TEST_CASE_NOT_PASS', testID);
    if (!testCase.started_at || !testCase.completed_at) fail('TEST_TIMESTAMPS_REQUIRED', testID);
  }
  if (byID.size !== REQUIRED_TEST_IDS.length) fail('UNEXPECTED_TEST_CASE_COUNT');

  return {
    status: 'PASS',
    schema_version: evidence.schema_version,
    evidence_origin: evidence.evidence_origin,
    app_commit: evidence.app.commit,
    tests_total: REQUIRED_TEST_IDS.length,
    tests_passed: REQUIRED_TEST_IDS.length,
    tests_failed: 0,
    tests_hung: 0,
    domain_record_counts: evidence.domain_record_counts,
    production_writes: 0,
    ready_for_real_device_gate_result: true,
  };
}

function createTemplate() {
  const blankCase = (testID) => ({
    test_id: testID,
    status: 'NOT_RUN',
    started_at: '',
    completed_at: '',
    preconditions: '',
    device_state: '',
    input_summary: '',
    action: '',
    expected_result: '',
    pass_criteria: '',
    fail_criteria: '',
    evidence_required: '',
    evidence_refs: [],
    runtime: {
      canonical_user_hash: '',
      session_hash: '',
      sample_type: '',
      source_app: '',
      source_record_hash: '',
      sync_operation: '',
      canonical_record_hash: '',
      dedupe_result: '',
      stale_update_decision: '',
      background_task_state: '',
      callback_state: '',
      retry_state: '',
      http_status: null,
      ingestion_result: '',
    },
  });
  return {
    schema_version: 'IOS_REAL_DEVICE_EVIDENCE_V1',
    template_only: true,
    evidence_origin: 'REAL_PHYSICAL_IPHONE',
    simulator: false,
    synthetic: false,
    production_writes: 0,
    user_typed_input_count: 0,
    device: { kind: 'PHYSICAL_IPHONE', ios_version: '' },
    app: { commit: '', bundle_id: '' },
    domain_record_counts: { steps: 0, heart_rate: 0, sleep: 0 },
    test_cases: REQUIRED_TEST_IDS.map(blankCase),
  };
}

function main(argv) {
  if (argv[0] === '--template') {
    process.stdout.write(`${JSON.stringify(createTemplate(), null, 2)}\n`);
    return;
  }
  if (argv.length !== 1) {
    process.stderr.write('Usage: node scripts/ios-real-device-evidence.cjs <evidence.json>\n');
    process.stderr.write('       node scripts/ios-real-device-evidence.cjs --template\n');
    process.exitCode = 2;
    return;
  }
  try {
    const evidence = JSON.parse(fs.readFileSync(argv[0], 'utf8'));
    process.stdout.write(`${JSON.stringify(validateEvidence(evidence), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`EVIDENCE_VALIDATION=FAIL ${error.code || 'INVALID_JSON_OR_FILE'}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { REQUIRED_TEST_IDS, createTemplate, validateEvidence };
