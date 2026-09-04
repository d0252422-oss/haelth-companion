'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createTemplate, validateEvidence } = require('../scripts/dual-platform-real-device-evidence.cjs');

test('blank template cannot become real-device PASS evidence', () => {
  assert.throws(() => validateEvidence(createTemplate()), /TEMPLATE_NOT_EVIDENCE/u);
});

test('unknown and blocked real-device cases remain blocked, not synthetic PASS', () => {
  const evidence = createTemplate(); evidence.template_only = false;
  const result = validateEvidence(evidence);
  assert.equal(result.ios_gate, 'BLOCKED'); assert.equal(result.android_export_gate, 'BLOCKED');
});

test('PASS without an evidence reference fails closed', () => {
  const evidence = createTemplate(); evidence.template_only = false; evidence.ios.cases[0].status = 'PASS';
  assert.throws(() => validateEvidence(evidence), /PASS_WITHOUT_EVIDENCE/u);
});

test('sensitive keys are rejected without reading their values', () => {
  const evidence = createTemplate(); evidence.template_only = false; evidence.access_token = 'redacted';
  assert.throws(() => validateEvidence(evidence), /SENSITIVE_EVIDENCE_KEY/u);
});
