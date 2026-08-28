'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');
const test = require('node:test');
const { AppsScriptRuntimeAdapter, compareResults } = require('../scripts/algorithm-runtime-adapter.cjs');
const { AsyncAlgorithmRuntimeRouter, PersistentPythonRuntimeAdapter } = require('../scripts/persistent-algorithm-runtime.cjs');

const fixtures = JSON.parse(fs.readFileSync('fixtures/algorithm-golden/health-score-v1.0.json', 'utf8')).fixtures;

function requestFor(fixture, overrides = {}) {
  return {
    algorithm_id: fixture.algorithm_id, algorithm_version: fixture.algorithm_version,
    domain: fixture.domain, subject_ref: 'persistent-test-user',
    period_start: fixture.input_window.start, period_end: fixture.input_window.end,
    timezone: fixture.timezone, canonical_inputs: fixture.canonical_inputs,
    traceability_refs: [], request_id: `request-${fixture.fixture_id}`, ...overrides,
  };
}

function fake(mode, options = {}) {
  return new PersistentPythonRuntimeAdapter({
    executable: process.execPath,
    args: [path.resolve('tests/fixtures/fake-algorithm-worker.cjs'), mode],
    startupTimeoutMs: 500, requestTimeoutMs: 100, ...options,
  });
}

test('persistent runtime starts once, serves all 28 fixtures, and shuts down cleanly', async () => {
  const candidate = new PersistentPythonRuntimeAdapter();
  const current = new AppsScriptRuntimeAdapter();
  try {
    const handshake = await candidate.start();
    const pid = candidate.pid;
    assert.equal(candidate.health, 'HEALTHY');
    assert.equal(handshake.algorithm_version, 'health-score-v1.0');
    for (const fixture of fixtures) {
      const request = requestFor(fixture);
      const comparison = compareResults(current.execute(request).normalized, (await candidate.execute(request)).normalized);
      assert.equal(comparison.parity_result, 'MATCH', fixture.fixture_id);
      assert.equal(candidate.pid, pid);
    }
  } finally { await candidate.close(); }
  assert.equal(candidate.health, 'UNAVAILABLE');
});

test('shadow integration preserves current raw response and makes zero writes', async () => {
  const candidate = new PersistentPythonRuntimeAdapter();
  const current = new AppsScriptRuntimeAdapter();
  let writes = 0;
  try {
    await candidate.start();
    const request = requestFor(fixtures[0]);
    const result = await new AsyncAlgorithmRuntimeRouter({ current, candidate }).execute(request, 'SHADOW');
    assert.deepEqual(result.userResult, current.execute(request).raw);
    assert.equal(result.shadowComparison.parity_result, 'MATCH');
    assert.equal(candidate.computeOnly, true);
    assert.equal(writes, 0);
  } finally { await candidate.close(); }
});

test('persistent runtime is stateless across users and deterministic repeats', async () => {
  const candidate = new PersistentPythonRuntimeAdapter();
  try {
    await candidate.start();
    const fixture = fixtures[0];
    const userA = requestFor(fixture, { subject_ref: 'user-a', request_id: 'a-1' });
    const userB = requestFor(fixtures[1], { subject_ref: 'user-b', request_id: 'b-1' });
    const firstA = (await candidate.execute(userA)).normalized;
    const resultB = (await candidate.execute(userB)).normalized;
    const secondA = (await candidate.execute({ ...userA, request_id: 'a-2' })).normalized;
    assert.deepEqual(secondA, firstA);
    assert.notEqual(resultB.traceability.input_fingerprint, firstA.traceability.input_fingerprint);
    assert.doesNotMatch(JSON.stringify(firstA), /user-b/u);
  } finally { await candidate.close(); }
});

test('request identity does not alter scoring result or fingerprint', async () => {
  const candidate = new PersistentPythonRuntimeAdapter();
  try {
    await candidate.start();
    const first = (await candidate.execute(requestFor(fixtures[0], { request_id: 'identity-one' }))).normalized;
    const second = (await candidate.execute(requestFor(fixtures[0], { request_id: 'identity-two' }))).normalized;
    assert.deepEqual(second, first);
  } finally { await candidate.close(); }
});

test('bounded concurrent calls remain correctly correlated on the single-thread worker', async () => {
  const candidate = new PersistentPythonRuntimeAdapter();
  const current = new AppsScriptRuntimeAdapter();
  try {
    await candidate.start();
    const requests = fixtures.slice(0, 10).map((fixture, index) => requestFor(fixture, { request_id: `concurrent-${index}`, subject_ref: `user-${index}` }));
    const results = await Promise.all(requests.map((request) => candidate.execute(request)));
    results.forEach((result, index) => assert.equal(compareResults(current.execute(requests[index]).normalized, result.normalized).parity_result, 'MATCH'));
  } finally { await candidate.close(); }
});

test('candidate not running fails closed while SHADOW still returns current', async () => {
  const candidate = new PersistentPythonRuntimeAdapter();
  const request = requestFor(fixtures[0]);
  await assert.rejects(candidate.execute(request), /CANDIDATE_NOT_RUNNING/u);
  const result = await new AsyncAlgorithmRuntimeRouter({ candidate }).execute(request, 'SHADOW');
  assert.equal(result.telemetry.fallback_used, true);
  assert.equal(result.telemetry.error_class, 'CANDIDATE_NOT_RUNNING');
  assert.ok(result.userResult);
});

test('startup failure and wrong version become unavailable/incompatible', async () => {
  const missing = new PersistentPythonRuntimeAdapter({ executable: path.resolve('missing-python.exe'), startupTimeoutMs: 100 });
  await assert.rejects(missing.start(), /CANDIDATE_STARTUP_FAILURE/u);
  assert.equal(missing.health, 'UNAVAILABLE');
  const incompatible = fake('wrong-version');
  await assert.rejects(incompatible.start(), /CANDIDATE_WRONG_VERSION/u);
  assert.equal(incompatible.health, 'INCOMPATIBLE');
  await incompatible.close();
  const noReady = fake('no-ready', { startupTimeoutMs: 50 });
  await assert.rejects(noReady.start(), /CANDIDATE_STARTUP_TIMEOUT/u);
  await noReady.close();
});

test('worker rejects invalid JSON and oversized transport frames', async () => {
  const child = spawn(path.resolve('.venv', 'Scripts', 'python.exe'), [path.resolve('scripts/python-algorithm-worker.py')], {
    cwd: path.resolve('.'), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONPATH: path.resolve('.') },
  });
  child.stderr.resume();
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const queue = [];
  const waiters = [];
  lines.on('line', (line) => { const value = JSON.parse(line); const waiter = waiters.shift(); if (waiter) waiter(value); else queue.push(value); });
  const next = () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve) => waiters.push(resolve));
  assert.equal((await next()).type, 'ready');
  child.stdin.write('{invalid-json}\n');
  assert.equal((await next()).error_class, 'INVALID_JSON');
  child.stdin.write(`${'x'.repeat(1_048_577)}\n`);
  assert.equal((await next()).error_class, 'REQUEST_TOO_LARGE');
  child.stdin.end();
  await new Promise((resolve) => child.once('exit', resolve));
});

for (const [mode, expected] of [['hang', 'CANDIDATE_TIMEOUT'], ['invalid-json', 'CANDIDATE_INVALID_JSON'], ['partial', 'CANDIDATE_PARTIAL_OUTPUT'], ['crash', 'CANDIDATE_CRASH']]) {
  test(`${mode} candidate failure is classified and shadow-fallback is safe`, async () => {
    const candidate = fake(mode);
    try {
      await candidate.start();
      const result = await new AsyncAlgorithmRuntimeRouter({ candidate }).execute(requestFor(fixtures[0]), 'SHADOW');
      assert.equal(result.telemetry.fallback_used, true);
      assert.equal(result.telemetry.error_class, expected);
      assert.ok(result.userResult);
    } finally { await candidate.close(); }
  });
}

test('parity mismatch prevents candidate-primary promotion', async () => {
  const current = new AppsScriptRuntimeAdapter();
  const candidate = {
    health: 'HEALTHY', name: 'MISMATCH',
    async execute(request) { const value = current.execute(request).normalized; return { normalized: { ...value, score: value.score - 10 } }; },
  };
  const request = requestFor(fixtures[0]);
  const result = await new AsyncAlgorithmRuntimeRouter({ current, candidate, allowNonProductionCandidate: true }).execute(request, 'CANDIDATE');
  assert.equal(result.telemetry.fallback_used, true);
  assert.equal(result.telemetry.error_class, 'CANDIDATE_PARITY_MISMATCH');
  assert.deepEqual(result.userResult, current.execute(request).raw);
});

test('restart preserves deterministic output', async () => {
  const candidate = new PersistentPythonRuntimeAdapter();
  try {
    await candidate.start();
    const request = requestFor(fixtures[0]);
    const before = (await candidate.execute(request)).normalized;
    const firstPid = candidate.pid;
    await candidate.restart();
    assert.notEqual(candidate.pid, firstPid);
    const after = (await candidate.execute({ ...request, request_id: 'after-restart' })).normalized;
    assert.deepEqual(after, before);
  } finally { await candidate.close(); }
});

test('current runtime failure is never hidden by the candidate', async () => {
  const current = { execute() { throw new Error('CURRENT_RUNTIME_FAILURE'); } };
  const candidate = { health: 'HEALTHY', async execute() { throw new Error('irrelevant'); } };
  await assert.rejects(new AsyncAlgorithmRuntimeRouter({ current, candidate }).execute(requestFor(fixtures[0]), 'SHADOW'), /CURRENT_RUNTIME_FAILURE/u);
});

test('persistent telemetry is allowlisted and contains no canonical inputs', async () => {
  const candidate = new PersistentPythonRuntimeAdapter();
  const events = [];
  try {
    await candidate.start();
    const request = requestFor(fixtures[0]);
    request.canonical_inputs.sensitive_marker = 'never-log-this';
    await new AsyncAlgorithmRuntimeRouter({ candidate, telemetry(event) { events.push(event); } }).execute(request, 'SHADOW');
    assert.equal(events.length, 1);
    assert.deepEqual(Object.keys(events[0]).sort(), ['algorithm_id', 'algorithm_version', 'difference_class', 'duration_ms', 'error_class', 'fallback_used', 'request_id', 'runtime', 'runtime_health', 'shadow_duration_ms'].sort());
    assert.doesNotMatch(JSON.stringify(events), /never-log-this/u);
  } finally { await candidate.close(); }
});
