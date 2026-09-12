const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const modulePromise = import('../scripts/calculate-project-progress.mjs');
const script = path.resolve(__dirname, '../scripts/calculate-project-progress.mjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'health-progress-test-'));
  t.after(() => {
    const actual = fs.realpathSync(root), parent = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(actual), parent);
    assert.ok(path.basename(actual).startsWith('health-progress-test-'));
    fs.rmSync(actual, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(root, 'evidence.txt'), 'synthetic test result\n');
  const evidence = [{ path: 'evidence.txt', sha256: createHash('sha256').update('synthetic test result\n').digest('hex') }];
  const leaf = (id, weight, status = 'PASS') => ({ id, module: 'runtime', weight, status, acceptance: 'Named synthetic acceptance test passes', evidence: structuredClone(evidence), evidence_valid: true });
  const baseline = { baseline_version: 'test-v1', baseline_status: 'PROVISIONAL_KNOWN_SCOPE_ONLY', full_scope_confirmed: false, previous_progress: null, scope_description: 'Synthetic scope used only to test the calculator', leaves: [leaf('local', 25), leaf('remote', 75, 'BLOCKED')] };
  return { root, baseline, leaf };
}
test('unconfirmed full scope stays UNKNOWN; only valid local PASS contributes weight', async t => {
  const { root, baseline } = fixture(t), { calculateProjectProgress } = await modulePromise;
  const result = calculateProjectProgress(baseline, { root });
  assert.equal(result.check_passed, true); assert.equal(result.overall_project_progress, 'UNKNOWN');
  assert.equal(result.provisional_known_scope_percentage, 25); assert.equal(result.unverified_progress_weight, 75);
  assert.equal(result.previous_progress, 'NOT_AVAILABLE'); assert.equal(result.progress_change_pp, 'NOT_AVAILABLE');
  assert.deepEqual(result.module_progress.runtime, { earned_weight: 25, total_weight: 100, valid_pass_gates: 1, total_gates: 2, accepted_percentage: 25 });
});
test('FAIL/BLOCKED/UNKNOWN/IN_PROGRESS retain denominator and receive no weight', async t => {
  const { root, baseline, leaf } = fixture(t), { calculateProjectProgress } = await modulePromise;
  baseline.leaves = ['PASS', 'FAIL', 'BLOCKED', 'UNKNOWN', 'IN_PROGRESS'].map((status, i) => leaf('gate-' + i, 20, status));
  const result = calculateProjectProgress(baseline, { root }); assert.equal(result.accepted_weight, 20); assert.equal(result.total_weight, 100);
});
test('duplicate, nested, malformed and non-100 weights reject baseline', async t => {
  const { baseline } = fixture(t), { validateProgressBaseline } = await modulePromise;
  const invalids = [b => { b.leaves[1].id = 'local'; }, b => { b.leaves[0].children = []; }, b => { b.leaves[0].weight = 26; }, b => { b.leaves[0].weight = -1; }, b => { b.leaves[0].status = 'LOCAL_PASS'; }, b => { b.leaves[0].acceptance = ''; }, b => { delete b.previous_progress; }];
  for (const invalidate of invalids) { const copy = structuredClone(baseline); invalidate(copy); assert.ok(validateProgressBaseline(copy).length > 0); }
});
test('missing, tampered and unattested PASS evidence earns zero with diagnostic', async t => {
  const { root, baseline } = fixture(t), { calculateProjectProgress } = await modulePromise;
  for (const alter of [b => { b.leaves[0].evidence = []; }, b => { b.leaves[0].evidence[0].path = 'missing'; }, b => { b.leaves[0].evidence[0].sha256 = '0'.repeat(64); }, b => { b.leaves[0].evidence_valid = false; }]) {
    const copy = structuredClone(baseline); alter(copy); const result = calculateProjectProgress(copy, { root });
    assert.equal(result.check_passed, false); assert.equal(result.accepted_weight, 0); assert.ok(result.diagnostics.length > 0);
  }
});
test('any failing evidence in a PASS gate withdraws all of that gate credit', async t => {
  const { root, baseline } = fixture(t), { calculateProjectProgress } = await modulePromise;
  baseline.leaves[0].evidence.push({ path: 'unavailable.xml', sha256: 'a'.repeat(64) });
  const result = calculateProjectProgress(baseline, { root }); assert.equal(result.accepted_weight, 0); assert.equal(result.unverified_progress_weight, 100);
});
test('evidence outside baseline root cannot be read or credited', async t => {
  const { root, baseline } = fixture(t), { calculateProjectProgress } = await modulePromise;
  baseline.leaves[0].evidence[0].path = script;
  const result = calculateProjectProgress(baseline, { root }); assert.equal(result.accepted_weight, 0);
  assert.ok(result.diagnostics[0].reasons.some(reason => reason.startsWith('EVIDENCE_OUTSIDE_BASELINE_ROOT')));
});
test('incomplete progress cannot round to 100%; genuine complete confirmed scope may', async t => {
  const { root, baseline, leaf } = fixture(t), { calculateProjectProgress } = await modulePromise;
  baseline.full_scope_confirmed = true; baseline.baseline_status = 'CONFIRMED';
  baseline.leaves = [leaf('almost', 99.96), leaf('remaining', .04, 'UNKNOWN')];
  assert.equal(calculateProjectProgress(baseline, { root }).overall_project_progress, 99.9);
  baseline.leaves[1].status = 'PASS'; assert.equal(calculateProjectProgress(baseline, { root }).overall_project_progress, 100);
});
test('modules never double-count parents and progress deltas require same baseline version', async t => {
  const { root, baseline } = fixture(t), { calculateProjectProgress } = await modulePromise;
  baseline.leaves[1].module = 'release'; baseline.previous_progress = 20;
  assert.equal(calculateProjectProgress(baseline, { root }).progress_change_pp, 'NOT_AVAILABLE');
  baseline.previous_baseline_version = 'test-v1'; const result = calculateProjectProgress(baseline, { root });
  assert.equal(result.progress_change_pp, 5); assert.equal(result.module_progress.runtime.total_weight, 25); assert.equal(result.module_progress.release.earned_weight, 0);
});
test('CLI --check produces JSON without changing baseline or evidence and fails tamper', t => {
  const { root, baseline } = fixture(t), filename = path.join(root, 'project-progress.json');
  const original = JSON.stringify(baseline); fs.writeFileSync(filename, original);
  const passed = spawnSync(process.execPath, [script, '--check', filename], { encoding: 'utf8' });
  assert.equal(passed.status, 0, passed.stderr); assert.equal(JSON.parse(passed.stdout).accepted_weight, 25);
  assert.equal(fs.readFileSync(filename, 'utf8'), original); assert.equal(fs.readFileSync(path.join(root, 'evidence.txt'), 'utf8'), 'synthetic test result\n');
  fs.writeFileSync(path.join(root, 'evidence.txt'), 'tampered test result');
  const failed = spawnSync(process.execPath, [script, '--check', filename], { encoding: 'utf8' });
  assert.equal(failed.status, 1); assert.equal(JSON.parse(failed.stdout).accepted_weight, 0);
});
test('CLI malformed JSON and unsupported options fail closed with UNKNOWN', t => {
  const { root } = fixture(t), filename = path.join(root, 'broken.json'); fs.writeFileSync(filename, '{');
  for (const args of [[filename], ['--write', filename]]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).overall_project_progress, 'UNKNOWN');
  }
});
