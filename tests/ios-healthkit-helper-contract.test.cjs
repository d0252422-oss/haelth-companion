'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  InstallClaimRegistry,
  canonicalNumber,
  classifyHTTPStatus,
  idempotencyKey,
  reconcileUploadBatch,
  sha256,
  validateRecord,
} = require('../scripts/mobile-health-helper-contract.cjs');

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';

function keys() {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicDer = pair.publicKey.export({ type: 'spki', format: 'der' });
  return { ...pair, fingerprint: sha256(publicDer) };
}

function validRecord(overrides = {}) {
  const record = {
    canonical_user_id: userA,
    platform: 'ios',
    domain: 'heart_rate',
    source_app: 'com.apple.health',
    source_record_id: 'record-1',
    source_updated_at: null,
    recorded_at: '2026-08-27T01:00:00.000Z',
    started_at: '2026-08-27T01:00:00.000Z',
    ended_at: '2026-08-27T01:00:01.000Z',
    timezone: 'Asia/Taipei',
    local_date: '2026-08-27',
    value: 67,
    unit: 'bpm',
    stage: null,
    schema_version: 'hdl-v2.health-ingestion.v1',
    ...overrides,
  };
  record.idempotency_key = idempotencyKey(record);
  return record;
}

test('valid short-lived install claim exchanges once and binds canonical user', () => {
  const key = keys();
  const registry = new InstallClaimRegistry();
  const claim = registry.issue({ canonicalUserId: userA, installationKeyFingerprint: key.fingerprint, now: 1_000 });
  const signature = crypto.sign('sha256', Buffer.from(claim), key.privateKey);
  const session = registry.exchange({ claim, publicKeyPem: key.publicKey, signature, now: 2_000 });
  assert.equal(session.canonicalUserId, userA);
  assert.equal(registry.authorizeUpload({ sessionId: session.sessionId, accessToken: session.accessToken, canonicalUserId: userA }), true);
  assert.throws(() => registry.exchange({ claim, publicKeyPem: key.publicKey, signature, now: 2_001 }), /REPLAYED_CLAIM/);
});

test('expired install claim is rejected', () => {
  const key = keys();
  const registry = new InstallClaimRegistry();
  const claim = registry.issue({ canonicalUserId: userA, installationKeyFingerprint: key.fingerprint, now: 0, ttlSeconds: 1 });
  const signature = crypto.sign('sha256', Buffer.from(claim), key.privateKey);
  assert.throws(() => registry.exchange({ claim, publicKeyPem: key.publicKey, signature, now: 1_001 }), /EXPIRED_CLAIM/);
});

test('beta one-time code binds on first signed exchange and rejects wrong environment', () => {
  const key = keys();
  const registry = new InstallClaimRegistry();
  const claim = registry.issue({ canonicalUserId: userA, platform: 'android', environment: 'beta' });
  const session = registry.exchange({ claim, publicKeyPem: key.publicKey, signature: crypto.sign('sha256', Buffer.from(claim), key.privateKey) });
  assert.equal(registry.authorizeUpload({ sessionId: session.sessionId, accessToken: session.accessToken, canonicalUserId: userA, environment: 'beta' }), true);
  assert.throws(() => registry.authorizeUpload({ sessionId: session.sessionId, accessToken: session.accessToken, canonicalUserId: userA, environment: 'production' }), /WRONG_ENVIRONMENT/);
  assert.throws(() => registry.exchange({ claim, publicKeyPem: key.publicKey, signature: crypto.sign('sha256', Buffer.from(claim), key.privateKey) }), /REPLAYED_CLAIM/);
  assert.throws(() => registry.issue({ canonicalUserId: userA, platform: 'android', environment: 'production' }), /INVALID_BINDING/);
});

test('wrong installation key and invalid signature are rejected', () => {
  const expected = keys();
  const attacker = keys();
  const registry = new InstallClaimRegistry();
  const claim = registry.issue({ canonicalUserId: userA, installationKeyFingerprint: expected.fingerprint });
  assert.throws(() => registry.exchange({
    claim,
    publicKeyPem: attacker.publicKey,
    signature: crypto.sign('sha256', Buffer.from(claim), attacker.privateKey),
  }), /WRONG_INSTALLATION_KEY/);
  assert.throws(() => registry.exchange({
    claim,
    publicKeyPem: expected.publicKey,
    signature: crypto.sign('sha256', Buffer.from('different'), expected.privateKey),
  }), /INVALID_SIGNATURE/);
});

test('revoked session and cross-user upload are rejected', () => {
  const key = keys();
  const registry = new InstallClaimRegistry();
  const claim = registry.issue({ canonicalUserId: userA, installationKeyFingerprint: key.fingerprint });
  const session = registry.exchange({ claim, publicKeyPem: key.publicKey, signature: crypto.sign('sha256', Buffer.from(claim), key.privateKey) });
  assert.throws(() => registry.authorizeUpload({ sessionId: session.sessionId, accessToken: session.accessToken, canonicalUserId: userB }), /CROSS_USER_UPLOAD/);
  registry.revoke(session.sessionId);
  assert.throws(() => registry.authorizeUpload({ sessionId: session.sessionId, accessToken: session.accessToken, canonicalUserId: userA }), /REVOKED_SESSION/);
});

test('steps, heart-rate, and sleep records retain one canonical HDL v2 contract', () => {
  for (const [domain, unit, value] of [['steps', 'count', 321], ['heart_rate', 'bpm', 67], ['sleep', 'minute', 45]]) {
    const record = validRecord({ domain, unit, value, stage: domain === 'sleep' ? 'asleep_deep' : null });
    assert.equal(validateRecord(record, userA).domain, domain);
  }
});

test('idempotency is stable across duplicate batches and changes on source update', () => {
  const first = validRecord();
  const replay = validRecord();
  const updated = validRecord({ value: 68 });
  assert.equal(first.idempotency_key, replay.idempotency_key);
  assert.notEqual(first.idempotency_key, updated.idempotency_key);
});

test('out-of-order timestamps remain deterministic', () => {
  const earlier = validRecord({ recorded_at: '2026-08-27T00:00:00.000Z' });
  const later = validRecord({ recorded_at: '2026-08-27T02:00:00.000Z' });
  assert.equal(idempotencyKey(earlier), earlier.idempotency_key);
  assert.equal(idempotencyKey(later), later.idempotency_key);
});

test('checkpoint advances only when every record is accepted or deduplicated', () => {
  const first = validRecord();
  const second = validRecord({ source_record_id: 'record-2' });
  const complete = reconcileUploadBatch([first, second], {
    accepted_idempotency_keys: [first.idempotency_key],
    duplicate_idempotency_keys: [second.idempotency_key],
    rejected: [],
  }, 'anchor-old', 'anchor-new');
  assert.equal(complete.checkpoint, 'anchor-new');
  assert.deepEqual(complete.pending, []);

  const partial = reconcileUploadBatch([first, second], {
    accepted_idempotency_keys: [first.idempotency_key], duplicate_idempotency_keys: [], rejected: [],
  }, 'anchor-old', 'anchor-new');
  assert.equal(partial.checkpoint, 'anchor-old');
  assert.deepEqual(partial.pending.map((record) => record.source_record_id), ['record-2']);
});

test('API status classification retries only temporary failures', () => {
  assert.deepEqual(classifyHTTPStatus(200), { kind: 'SUCCESS', retry: false });
  assert.deepEqual(classifyHTTPStatus(401), { kind: 'UNAUTHORIZED', retry: false });
  assert.deepEqual(classifyHTTPStatus(429, 60), { kind: 'RATE_LIMITED', retry: true, retryAfter: 60 });
  assert.deepEqual(classifyHTTPStatus(503), { kind: 'SERVER_TEMPORARY', retry: true });
  assert.deepEqual(classifyHTTPStatus(400), { kind: 'CLIENT_ERROR', retry: false });
});

test('malformed payload and cross-user record fail closed', () => {
  assert.throws(() => validateRecord(validRecord({ canonical_user_id: userB }), userA), /CROSS_USER_UPLOAD/);
  assert.throws(() => validateRecord(validRecord({ local_date: '27-08-2026' }), userA), /MALFORMED_LOCAL_DATE/);
  assert.throws(() => canonicalNumber(Number.NaN), /MALFORMED_VALUE/);
});

test('normal UI has zero typed-input controls and no embedded reusable credential', () => {
  const root = path.resolve(__dirname, '..', 'ios-helper');
  const files = fs.readdirSync(path.join(root, 'App')).concat(fs.readdirSync(path.join(root, 'Features', 'HealthSync')));
  const source = files.filter((name) => name.endsWith('.swift')).map((name) => {
    const directory = fs.existsSync(path.join(root, 'App', name)) ? path.join(root, 'App') : path.join(root, 'Features', 'HealthSync');
    return fs.readFileSync(path.join(directory, name), 'utf8');
  }).join('\n');
  assert.doesNotMatch(source, /\b(TextField|SecureField)\s*\(/u);
  assert.doesNotMatch(source, /Bearer\s+[A-Za-z0-9._-]{20,}/u);
});

test('claim is accepted only in HTTPS universal-link fragment, never query', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'ios-helper', 'Identity', 'InstallClaimHandler.swift'), 'utf8');
  assert.match(source, /url\.scheme == "https"/u);
  assert.match(source, /queryCredentialRejected/u);
  assert.match(source, /components\?\.fragment/u);
});

test('private mobile credential tables deny anonymous/authenticated access', () => {
  const migration = fs.readFileSync(path.resolve(__dirname, '..', 'supabase', 'migrations', '20260827015836_mobile_health_helper_bootstrap.sql'), 'utf8');
  assert.match(migration, /revoke all on table private\.mobile_install_claims from public, anon, authenticated;/iu);
  assert.match(migration, /revoke all on table private\.mobile_app_sessions from public, anon, authenticated;/iu);
  assert.doesNotMatch(migration, /access_token\s+text|refresh_token\s+text|claim\s+text/iu);
  assert.match(migration, /access_token_digest/iu);
  assert.match(migration, /claim_digest/iu);
});

test('Swift 6 helpers do not share mutable formatter or coder instances', () => {
  const root = path.resolve(__dirname, '..', 'ios-helper');
  const idempotency = fs.readFileSync(path.join(root, 'Models', 'IdempotencyKey.swift'), 'utf8');
  const tokenStore = fs.readFileSync(path.join(root, 'Storage', 'SecureTokenStore.swift'), 'utf8');
  const source = `${idempotency}\n${tokenStore}`;

  assert.doesNotMatch(source, /static\s+let\s+canonical\s*:\s*(?:ISO8601DateFormatter|JSONEncoder|JSONDecoder)/u);
  assert.match(idempotency, /static\s+var\s+canonical\s*:\s*ISO8601DateFormatter/u);
  assert.match(tokenStore, /static\s+var\s+canonical\s*:\s*JSONEncoder/u);
  assert.match(tokenStore, /static\s+var\s+canonical\s*:\s*JSONDecoder/u);
});

test('background callbacks use isolated one-shot lifecycle ownership', () => {
  const root = path.resolve(__dirname, '..', 'ios-helper');
  const background = fs.readFileSync(path.join(root, 'Features', 'HealthSync', 'BackgroundHealthSync.swift'), 'utf8');
  const lifecycle = fs.readFileSync(path.join(root, 'Features', 'HealthSync', 'BackgroundTaskLifecycle.swift'), 'utf8');
  const observer = fs.readFileSync(path.join(root, 'Features', 'HealthSync', 'HealthKitObserverCallbackBridge.swift'), 'utf8');
  const source = `${background}\n${lifecycle}\n${observer}`;

  assert.match(background, /@MainActor\s+final class BackgroundHealthSync/u);
  assert.doesNotMatch(background, /processing\.setTaskCompleted[\s\S]*Task\s*\{/u);
  assert.match(lifecycle, /@MainActor\s+final class BackgroundTaskLifecycle/u);
  assert.match(lifecycle, /guard !didComplete, self\.operation == nil else \{ return false \}/u);
  assert.match(lifecycle, /guard !didComplete else \{ return \}/u);
  assert.match(lifecycle, /operation\?\.cancel\(\)/u);
  assert.match(background, /using: DispatchQueue\.main/u);
  assert.match(background, /MainActor\.assumeIsolated/u);
  assert.match(observer, /struct HealthKitObserverCallbackBridge: Sendable/u);
  assert.match(observer, /defer \{ completion\(\) \}/u);
  assert.match(observer, /continuation\.yield\(\(\)\)/u);
  assert.doesNotMatch(source, /nonisolated\(unsafe\)|unsafeBitCast|@unchecked Sendable/u);
});
