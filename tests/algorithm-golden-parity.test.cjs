'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { runFixture } = require('../scripts/apps-script-health-score-runner.cjs');

const document = JSON.parse(fs.readFileSync('fixtures/algorithm-golden/health-score-v1.0.json', 'utf8'));

test('golden fixture contract is language-neutral and versioned', () => {
  assert.equal(document.schema_version, 'HEALTH_ALGORITHM_GOLDEN_V1');
  assert.equal(document.tolerance_policy, 'EXACT_JSON_NUMBER_MATCH_AFTER_CONTRACT_ROUNDING');
  assert.equal(document.fixtures.length, 28);
});

test('tracked Apps Script scoring snapshot is sanitized and provenance-pinned', () => {
  const snapshot = fs.readFileSync('fixtures/algorithm-golden/apps-script-health-score-v1.0.snapshot.js', 'utf8');
  assert.match(snapshot, /Full canonical source SHA-256: [0-9a-f]{64}/u);
  assert.doesNotMatch(snapshot, /@gmail\.com|OPENAI_API_KEY|UrlFetchApp|PropertiesService/u);
});

for (const fixture of document.fixtures) {
  test(`Apps Script canonical runtime matches ${fixture.fixture_id}`, () => {
    const first = runFixture(fixture);
    assert.deepEqual(first, fixture.expected);
    assert.deepEqual(runFixture(fixture), first);
    assert.equal(fixture.algorithm_version, 'health-score-v1.0');
    assert.match(fixture.input_window.start, /Z$/u);
    assert.match(fixture.input_window.end, /Z$/u);
  });
}
