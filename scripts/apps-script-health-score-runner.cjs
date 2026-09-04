'use strict';

const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(
  'fixtures/algorithm-golden/apps-script-health-score-v1.0.snapshot.js',
  'utf8',
);
const context = { console: { log() {}, warn() {}, error() {} } };
vm.createContext(context);
vm.runInContext(source, context);

const FUNCTIONS = {
  sleep: 'calculateSleepScore', activity: 'calculateActivityScore', training: 'calculateTrainingScore',
  nutrition: 'calculateNutritionScore', body_composition: 'calculateBodyCompositionScore',
  recovery: 'calculateRecoveryScore', fatigue: 'calculateFatigueIndex', health_overall: 'calculateHealthScore',
};

function runFixture(fixture) {
  const result = runDomain(fixture.domain, fixture.canonical_inputs);
  const reason = result.dependencyAdjustment && result.dependencyAdjustment !== 'NONE'
    ? [result.dependencyAdjustment] : [];
  return {
    expected_score: result.score,
    expected_completeness: result.completeness,
    expected_confidence: result.confidence,
    expected_missing_inputs: [...(result.missingData || [])].sort(),
    expected_reason_codes: reason,
    algorithm_version: context.HEALTH_SCORING_CONFIG.algorithmVersion,
  };
}

function runDomain(domain, canonicalInputs) {
  const functionName = FUNCTIONS[domain];
  if (!functionName || typeof context[functionName] !== 'function') throw new Error(`UNSUPPORTED_DOMAIN:${domain}`);
  return context[functionName](canonicalInputs);
}

function main(argv) {
  const path = argv[0];
  const document = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (argv.includes('--bless')) {
    document.fixtures = document.fixtures.map((fixture) => ({ ...fixture, expected: runFixture(fixture) }));
    fs.writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(document.fixtures.map((fixture) => ({ fixture_id: fixture.fixture_id, result: runFixture(fixture) })), null, 2)}\n`);
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { runDomain, runFixture };
