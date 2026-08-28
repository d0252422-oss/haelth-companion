'use strict';

const fs = require('node:fs');

const IOS_CASES = [
  'IOS-RD-01', 'IOS-RD-02', 'IOS-RD-03', 'IOS-RD-04', 'IOS-RD-05',
  'IOS-RD-06', 'IOS-RD-07', 'IOS-RD-08', 'IOS-RD-09', 'IOS-RD-10',
  'IOS-RD-11', 'IOS-RD-12', 'IOS-RD-13',
];
const ANDROID_CASES = ['ANDROID-RD-01', 'ANDROID-RD-02', 'ANDROID-RD-03', 'ANDROID-RD-04', 'ANDROID-RD-05'];
const CORE_IOS = new Set(['IOS-RD-01', 'IOS-RD-02', 'IOS-RD-04', 'IOS-RD-06', 'IOS-RD-07', 'IOS-RD-11', 'IOS-RD-12']);
const STATUS = new Set(['PASS', 'FAIL', 'UNKNOWN', 'BLOCKED_REAL_DEVICE', 'PARTIAL']);
const SENSITIVE = /(?:^|_)(?:access_token|refresh_token|password|secret|credential|authorization|raw_payload|email)(?:_|$)/iu;

function fail(code, detail = '') { const error = new Error(detail ? `${code}: ${detail}` : code); error.code = code; throw error; }
function noSecrets(value, path = '$') {
  if (Array.isArray(value)) return value.forEach((item, index) => noSecrets(item, `${path}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE.test(key)) fail('SENSITIVE_EVIDENCE_KEY', `${path}.${key}`);
    noSecrets(nested, `${path}.${key}`);
  }
}

function caseTemplate(testId) {
  return {
    test_id: testId, status: 'BLOCKED_REAL_DEVICE', readable: 'UNKNOWN',
    value_structure: '', unit: '', start_time: '', end_time: '', source_app: '',
    device_metadata: '', native_identifier_available: 'UNKNOWN', shortcut_runtime_result: 'UNKNOWN',
    api_post_result: 'UNKNOWN', canonical_mapping: 'UNKNOWN', evidence_refs: [], notes: '',
  };
}

function createTemplate() {
  return {
    schema_version: 'DUAL_PLATFORM_REAL_DEVICE_EVIDENCE_V1', template_only: true,
    synthetic: false, production_writes: 0,
    ios: { device: { model_redacted: '', ios_version: '' }, setup_steps: null, repeat_steps: null, setup_time: null, failure_points: [], cases: IOS_CASES.map(caseTemplate), delete_semantics: 'UNKNOWN' },
    android: { device: { android_version: '', health_connect_version: '' }, export_frequency: '', cloud_provider: '', setup_steps: null, repeat_steps: null, failure_points: [], cases: ANDROID_CASES.map(caseTemplate), exports: [] },
  };
}

function validateEvidence(evidence) {
  noSecrets(evidence);
  if (evidence?.schema_version !== 'DUAL_PLATFORM_REAL_DEVICE_EVIDENCE_V1') fail('BAD_SCHEMA');
  if (evidence.template_only !== false) fail('TEMPLATE_NOT_EVIDENCE');
  if (evidence.synthetic !== false || evidence.production_writes !== 0) fail('UNSAFE_EVIDENCE');
  const allCases = [...(evidence.ios?.cases || []), ...(evidence.android?.cases || [])];
  const expected = [...IOS_CASES, ...ANDROID_CASES];
  const byId = new Map(allCases.map((item) => [item.test_id, item]));
  for (const id of expected) {
    const item = byId.get(id);
    if (!item) fail('MISSING_CASE', id);
    if (!STATUS.has(item.status)) fail('BAD_STATUS', id);
    if (item.status === 'PASS' && (!Array.isArray(item.evidence_refs) || item.evidence_refs.length === 0)) fail('PASS_WITHOUT_EVIDENCE', id);
  }
  const iosPass = [...CORE_IOS].every((id) => byId.get(id).status === 'PASS')
    && ['YES', 'NO'].includes(byId.get('IOS-RD-10').native_identifier_available)
    && evidence.ios.delete_semantics !== 'FAIL';
  const androidPass = ANDROID_CASES.slice(0, 3).every((id) => byId.get(id).status === 'PASS')
    && Array.isArray(evidence.android.exports) && evidence.android.exports.length >= 2;
  return { ios_gate: iosPass ? 'PASS' : 'BLOCKED', android_export_gate: androidPass ? 'PASS' : 'BLOCKED', cases_total: expected.length, cases_passed: allCases.filter((item) => item.status === 'PASS').length };
}

function main(argv) {
  if (argv[0] === '--template') return process.stdout.write(`${JSON.stringify(createTemplate(), null, 2)}\n`);
  if (argv.length !== 1) fail('USAGE');
  process.stdout.write(`${JSON.stringify(validateEvidence(JSON.parse(fs.readFileSync(argv[0], 'utf8'))), null, 2)}\n`);
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { process.stderr.write(`EVIDENCE_VALIDATION=FAIL ${error.code || 'INVALID'}\n`); process.exitCode = 1; } }

module.exports = { ANDROID_CASES, IOS_CASES, createTemplate, validateEvidence };
