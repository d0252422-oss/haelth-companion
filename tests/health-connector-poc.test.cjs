'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ConnectorRecordReconciler, connectorOptions, derivedSourceId, selectSource, validateEnvelope } = require('../scripts/health-connector-contract.cjs');
const http = require('node:http');
const { createHealthConnectorRuntime } = require('../scripts/health-connector-runtime.cjs');

const user = '11111111-1111-4111-8111-111111111111';
function record(domain, value, unit, extra = {}) { return { domain, value, unit, recorded_at: '2026-08-28T01:00:00Z', timezone: 'Asia/Taipei', local_date: '2026-08-28', source_app: 'Apple Health', ...extra }; }
function envelope(records) { return { schema_version: 'hdl-v2.connector-ingestion.v1', canonical_user_id: user, provider: 'apple_health', connector_type: 'ios_shortcut', sync_window_start: '2026-08-27T00:00:00Z', sync_window_end: '2026-08-28T00:00:00Z', records }; }

test('Shortcut contract accepts deterministic fixtures for the six required domains', () => {
  const records = [record('steps', 100, 'count'), record('heart_rate', 65, 'bpm'), record('sleep', 420, 'minute'), record('sleep_stage', 90, 'minute', { stage: 'deep' }), record('weight', 70, 'kg'), record('workout', 30, 'minute')];
  const result = validateEnvelope(envelope(records), user);
  assert.equal(result.records.length, 6);
  assert.ok(result.records.every((item) => item.source_record_id_kind === 'DERIVED_FINGERPRINT'));
});

test('native identity remains explicitly native and derived identity is stable', () => {
  const native = validateEnvelope(envelope([record('steps', 1, 'count', { native_record_id: 'native-1' })]), user).records[0];
  assert.equal(native.source_record_id_kind, 'NATIVE');
  assert.equal(native.source_record_id, 'native-1');
  assert.equal(derivedSourceId({ a: 1, b: 2 }), derivedSourceId({ b: 2, a: 1 }));
  const original = validateEnvelope(envelope([record('steps', 1, 'count')]), user).records[0];
  const corrected = validateEnvelope(envelope([record('steps', 2, 'count')]), user).records[0];
  assert.equal(original.source_record_id, corrected.source_record_id);
  assert.notEqual(original.source_fingerprint, corrected.source_fingerprint);
});

test('bad auth, schema and unit fail closed', () => {
  assert.throws(() => validateEnvelope(envelope([]), 'other'), /BAD_AUTH/u);
  assert.throws(() => validateEnvelope({ ...envelope([]), schema_version: 'bad' }, user), /BAD_SCHEMA/u);
  assert.throws(() => validateEnvelope(envelope([record('steps', 1, 'bpm')]), user), /INVALID_UNIT/u);
});

test('source selection is per-record evidence, not a global vendor preference', () => {
  const selected = selectSource([
    { source_fingerprint: 'b', native_provenance: false, data_resolution: 60, recorded_at: '2026-08-28T02:00:00Z', duplicate_risk: 0 },
    { source_fingerprint: 'a', native_provenance: true, data_resolution: 1, recorded_at: '2026-08-28T01:00:00Z', duplicate_risk: 0 },
  ]);
  assert.equal(selected.source_fingerprint, 'a');
  assert.equal(connectorOptions('android')[0].connector, 'android_helper');
  assert.equal(connectorOptions('android')[1].status, 'FALLBACK_DIAGNOSTIC');
});

test('connector reconciliation distinguishes create, replay, update, stale and conflict', () => {
  const reconciler = new ConnectorRecordReconciler();
  const base = { canonical_user_id: user, connector_type: 'ios_shortcut', domain: 'steps', source_record_id: 'r1', source_fingerprint: 'a'.repeat(64), source_revision: 1 };
  assert.equal(reconciler.apply(base), 'CREATE');
  assert.equal(reconciler.apply(base), 'REPLAY');
  assert.equal(reconciler.apply({ ...base, source_fingerprint: 'b'.repeat(64) }), 'CONFLICT');
  assert.equal(reconciler.apply({ ...base, source_revision: 2, source_fingerprint: 'b'.repeat(64) }), 'UPDATE');
  assert.equal(reconciler.apply(base), 'STALE_UPDATE');
});

test('offline export inspector reports structure without extracting files', () => {
  const temporary = path.join(os.tmpdir(), `health-connect-${process.pid}-${Date.now()}`);
  const fixture = `${temporary}.zip`;
  execFileSync('python', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],"w"); z.writestr("metadata.json","{\\"schema\\":1}"); z.writestr("records.bin",b"\\x00\\xff"); z.close()', fixture]);
  const output = execFileSync('python', [path.join(__dirname, '..', 'scripts', 'inspect-health-connect-export.py'), fixture], { encoding: 'utf8' });
  const result = JSON.parse(output);
  assert.equal(result.archive_entries.length, 2);
  assert.match(result.sha256, /^[0-9a-f]{64}$/u);
  assert.ok(result.detected_formats.includes('json_candidate'));
  require('node:fs').unlinkSync(fixture);
});

test('Shortcut HTTP POC authenticates user and returns create/replay decisions', async (t) => {
  const runtime = createHealthConnectorRuntime({ authenticateRequest: async (request) => {
    if (request.headers.authorization !== 'Bearer local-test-session') throw Object.assign(new Error('AUTH_REQUIRED'), { code: 'AUTH_REQUIRED', status: 401 });
    return user;
  } });
  const server = http.createServer(runtime.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const body = envelope([record('steps', 100, 'count')]);
  const first = await fetch(`${origin}/v1/connectors/ios-shortcut/ingest`, { method: 'POST', headers: { authorization: 'Bearer local-test-session', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const replay = await fetch(`${origin}/v1/connectors/ios-shortcut/ingest`, { method: 'POST', headers: { authorization: 'Bearer local-test-session', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const updateBody = envelope([record('steps', 101, 'count', { source_revision: 2 })]);
  const update = await fetch(`${origin}/v1/connectors/ios-shortcut/ingest`, { method: 'POST', headers: { authorization: 'Bearer local-test-session', 'content-type': 'application/json' }, body: JSON.stringify(updateBody) });
  const stale = await fetch(`${origin}/v1/connectors/ios-shortcut/ingest`, { method: 'POST', headers: { authorization: 'Bearer local-test-session', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const denied = await fetch(`${origin}/v1/connectors/ios-shortcut/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await first.json()).results[0].decision, 'CREATE');
  assert.equal((await replay.json()).results[0].decision, 'REPLAY');
  assert.equal((await update.json()).results[0].decision, 'UPDATE');
  assert.equal((await stale.json()).results[0].decision, 'STALE_UPDATE');
  assert.equal(denied.status, 401);
});
