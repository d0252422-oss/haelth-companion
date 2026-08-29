const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function line(pattern, label) {
  const match = html.match(pattern);
  assert.ok(match, `${label} must exist`);
  return match[0];
}

const warnings = [];
const context = {
  console: { warn: (...args) => warnings.push(args) },
  Set, Number, Math, Object, Array, String,
};
vm.createContext(context);
vm.runInContext([
  line(/function valid\([^\n]+/, 'valid'),
  line(/function num\([^\n]+/, 'num'),
  line(/const HEALTH_DOMAIN_LABELS=[^\n]+/, 'domain labels'),
  line(/const healthCompletenessWarnings=[^\n]+/, 'warning cache'),
  line(/function normalizeHealthCompleteness\([^\n]+/, 'completeness normalizer'),
  line(/function formatHealthCompleteness\([^\n]+/, 'completeness formatter'),
  line(/function normalizeHealthConfidence\([^\n]+/, 'confidence normalizer'),
  line(/function healthDomainMetadata\([^\n]+/, 'domain metadata'),
].join('\n'), context);

[
  [0, '0%'], [0.25, '25%'], [0.5, '50%'], [0.85, '85%'], [1, '100%'],
  [25, '25%'], [85, '85%'], [100, '100%'], [101, '100%'], [8500, '100%'],
  [-1, '0%'], ['85', '85%'], [null, '—'], [undefined, '—'], [NaN, '—'], [Infinity, '—'], [[], '—'], [{}, '—'],
].forEach(([input, expected]) => {
  context.completenessInput = input;
  assert.strictEqual(vm.runInContext('formatHealthCompleteness(completenessInput)', context), expected, `Unexpected completeness for ${String(input)}`);
});
assert.strictEqual(vm.runInContext('formatHealthCompleteness(1.3)', context), '1%');
assert.ok(warnings.length >= 3, 'Legacy, overflow, and negative values must produce telemetry warnings');

context.today = {
  sleepSystemScore: 91,
  recoveryScore: 73,
  fatigueIndex: 17,
  activityScore: 99,
  trainingScore: 49,
  nutritionScore: null,
  bodyCompositionScore: 98,
  dataCompleteness: 85,
  scoreConfidence: 'HIGH',
  scoreMissingData: {
    sleep: ['deep'], recovery: ['hrv'], fatigue: ['hrvSuppression'], activity: [], training: [],
    nutrition: ['calories'], bodyComposition: ['goalProgress'], health: ['nutrition'],
  },
};
const metadata = vm.runInContext('healthDomainMetadata(today)', context);
assert.deepStrictEqual(JSON.parse(JSON.stringify(metadata.missing)), ['nutrition']);
assert.ok(!metadata.missing.includes('sleep'));
assert.ok(!metadata.missing.includes('activity'));
assert.ok(!metadata.missing.includes('training'));
assert.ok(!metadata.missing.includes('health'));
assert.deepStrictEqual(JSON.parse(JSON.stringify(metadata.partial)), ['sleep', 'recovery', 'fatigue', 'bodyComposition']);
assert.strictEqual(vm.runInContext('normalizeHealthConfidence("HIGH",0.4,5)', context), 'LOW');
assert.strictEqual(vm.runInContext('normalizeHealthConfidence("HIGH",null,0)', context), '—');

assert.match(html, /sleep:"睡眠"/);
assert.match(html, /bodyComposition:"身體組成"/);
assert.match(html, /分數依據與健康資料覆蓋率/);
assert.match(html, /健康資料覆蓋率：/);
assert.doesNotMatch(html, /資料完整度：/);
assert.match(html, /domainMetadata\.partial\.length\?"所有領域皆可計分":"所有領域資料完整"/);
assert.doesNotMatch(html, /Object\.entries\(today\.scoreMissingData/);

context.today = {
  sleepSystemScore: 91, recoveryScore: 73, fatigueIndex: 0, activityScore: 99,
  trainingScore: [], nutritionScore: 80, bodyCompositionScore: 82,
};
const invalidArrayMetadata = vm.runInContext('healthDomainMetadata(today)', context);
assert.ok(invalidArrayMetadata.available.includes('fatigue'), 'A legitimate zero remains available');
assert.ok(invalidArrayMetadata.missing.includes('training'), 'An array is not a valid domain score');

context.today = {
  sleepSystemScore: null, recoveryScore: null, fatigueIndex: null, activityScore: null,
  trainingScore: null, nutritionScore: null, bodyCompositionScore: null,
  scoreAvailableDomains: [], scoreMissingDomains: [], scorePartialDomains: [],
};
const emptyMetadata = vm.runInContext('healthDomainMetadata(today)', context);
assert.deepStrictEqual(JSON.parse(JSON.stringify(emptyMetadata.available)), []);
assert.deepStrictEqual(JSON.parse(JSON.stringify(emptyMetadata.partial)), []);
assert.deepStrictEqual(JSON.parse(JSON.stringify(emptyMetadata.missing)), ['sleep', 'recovery', 'fatigue', 'activity', 'training', 'nutrition', 'bodyComposition']);

console.log('Health score completeness UI tests: PASS');
