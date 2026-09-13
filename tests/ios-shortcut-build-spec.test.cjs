'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readManifest, validateManifest, buildSpec, matchesWindow, planBatches } = require('../scripts/ios-shortcut-build-spec.cjs');
const end = '2026-09-14T04:00:00.000Z';
const spec = () => buildSpec(end);
const windowFor = domain => spec().windows.find(window => window.domain === domain);

test('manifest preserves existing authentication and explicitly remains offline preparation', () => {
  const manifest = readManifest();
  assert.equal(validateManifest(manifest), manifest);
  assert.equal(manifest.share_url, '');
  assert.equal(manifest.build_spec.status, 'OFFLINE_SPEC_ONLY_NOT_IMPORTABLE_SHORTCUT');
  assert.notEqual(manifest.runtime_status, 'READY_BETA_HTTPS');
  assert.equal(spec().network_operations, 0);
  assert.equal(spec().device_execution, 'NOT_RUN');
});

test('one frozen clock creates exactly five elapsed-time windows with fixed units', () => {
  assert.deepEqual(spec().windows.map(({ domain, sync_window_start, sync_window_end, unit }) => [domain, sync_window_start, sync_window_end, unit]), [
    ['steps', '2026-09-13T04:00:00.000Z', end, 'count'],
    ['heart_rate', '2026-09-13T04:00:00.000Z', end, 'bpm'],
    ['sleep', '2026-09-07T04:00:00.000Z', end, 'minute'],
    ['weight', '2026-08-15T04:00:00.000Z', end, 'kg'],
    ['workout', '2026-09-07T04:00:00.000Z', end, 'minute'],
  ]);
});

test('Taipei midnight and DST transition use elapsed UTC duration, not server local days', () => {
  for (const at of ['2026-09-13T16:00:00.000Z', '2026-03-08T10:00:00.000Z', '2026-11-01T10:00:00.000Z']) {
    const windows = buildSpec(at).windows;
    for (const window of windows) assert.equal(Date.parse(window.sync_window_end) - Date.parse(window.sync_window_start), window.lookback_seconds * 1000);
  }
});

test('ambiguous local dates and normalized invalid calendar dates are rejected', () => {
  for (const at of ['2026-09-14', '2026-09-14T12:00:00', '2026-02-30T04:00:00.000Z', 'invalid']) assert.throws(() => buildSpec(at), /UTC/u);
});

test('point selection includes start but excludes end and retains observed zero', () => {
  const window = windowFor('steps');
  const record = { domain: 'steps', unit: 'count', value: 0, recorded_at: window.sync_window_start };
  assert.equal(matchesWindow(record, window), true);
  assert.equal(record.value, 0);
  assert.equal(matchesWindow({ ...record, recorded_at: end }, window), false);
  assert.equal(matchesWindow({ ...record, recorded_at: '2026-09-13T03:59:59.999Z' }, window), false);
});

test('sleep and workout overlap preserves original intervals without clipping or allocating minutes', () => {
  for (const domain of ['sleep', 'workout']) {
    const window = windowFor(domain);
    const record = { domain, unit: 'minute', started_at: '2026-09-07T03:00:00.000Z', ended_at: '2026-09-07T05:00:00.000Z', value: 120 };
    const before = JSON.stringify(record);
    assert.equal(matchesWindow(record, window), true);
    assert.equal(JSON.stringify(record), before);
    assert.equal(matchesWindow({ ...record, ended_at: window.sync_window_start }, window), false);
    assert.equal(matchesWindow({ ...record, started_at: end, ended_at: '2026-09-14T05:00:00.000Z' }, window), false);
  }
});

test('window order, interval order, wrong domain and wrong units fail closed', () => {
  const window = windowFor('sleep');
  const record = { domain: 'sleep', unit: 'minute', started_at: window.sync_window_start, ended_at: end };
  assert.throws(() => matchesWindow(record, { ...window, sync_window_start: end }), /BAD_WINDOW_ORDER/u);
  assert.throws(() => matchesWindow({ ...record, ended_at: record.started_at }, window), /BAD_RECORD_INTERVAL/u);
  assert.throws(() => matchesWindow({ ...record, unit: 'hour' }, window), /MISMATCH/u);
  assert.throws(() => matchesWindow({ ...record, domain: 'weight' }, window), /MISMATCH/u);
});

test('501 synthetic keys partition into stable 250, 250, 1 membership and exact replays', () => {
  const keys = Array.from({ length: 501 }, (_, index) => `synthetic-${String(index).padStart(4, '0')}`);
  const original = [...keys];
  const plan = planBatches(keys);
  assert.deepEqual(plan.map(batch => batch.record_keys.length), [250, 250, 1]);
  assert.deepEqual(planBatches([...keys].reverse()), plan);
  assert.equal(JSON.stringify(planBatches(keys)), JSON.stringify(plan));
  assert.deepEqual(keys, original);
  assert.equal(new Set(plan.map(batch => batch.membership_sha256)).size, 3);
});

test('empty samples produce no fake record and duplicate/missing identities are rejected', () => {
  assert.deepEqual(planBatches([]), []);
  assert.throws(() => planBatches(['synthetic-a', 'synthetic-a']), /DUPLICATE_RECORD_KEY/u);
  assert.throws(() => planBatches(['']), /INVALID_RECORD_KEYS/u);
  assert.throws(() => planBatches([null]), /INVALID_RECORD_KEYS/u);
});

test('unreviewed domain, window, session or endpoint contract drift is rejected', () => {
  for (const modify of [
    manifest => { manifest.build_spec.selected_domains[0].lookback_seconds = 3600; },
    manifest => { manifest.build_spec.selected_domains.push({ domain: 'hrv' }); },
    manifest => { manifest.authentication = 'body-user-id'; },
    manifest => { manifest.ingestion_auth_headers = ['Authorization: Bearer secret']; },
    manifest => { manifest.ingestion_base_url = 'https://user:password@example.invalid/functions/v1/mobile-health-beta'; },
    manifest => { manifest.build_spec.device_execution = 'PASS'; },
  ]) {
    const manifest = readManifest();
    modify(manifest);
    assert.throws(() => validateManifest(manifest));
  }
});

test('offline tool has no network/device/process launch or credential environment access', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'ios-shortcut-build-spec.cjs'), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|https?\.request|child_process|Deno\.Command|process\.env|\badb\b/u);
  assert.deepEqual([...source.matchAll(/require\('([^']+)'\)/gu)].map(match => match[1]).sort(), ['node:crypto', 'node:fs', 'node:path']);
  assert.ok(spec().remaining_gates.includes('BOUNDED_POST_DEVICE_VALIDATION'));
  assert.equal(spec().retry.auth_failure, 'STOP_NO_AUTOMATIC_REAUTH_OR_ALTERNATE_USER');
});
