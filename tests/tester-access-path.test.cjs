'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { connectorOptions } = require('../scripts/health-connector-contract.cjs');
const { idempotencyKey, validateRecord } = require('../scripts/mobile-health-helper-contract.cjs');
const { PLATFORM, connectorPresentation, detectPlatform, normalizeTesterAccessConfig } = require('../scripts/tester-access-contract.cjs');

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';

function androidRecord(overrides = {}) {
  const record = {
    schema_version: 'hdl-v2.health-ingestion.v1', canonical_user_id: userA, platform: 'android',
    domain: 'steps', source_app: 'com.mi.health', source_record_id: 'hc-steps-1',
    recorded_at: '2026-08-29T01:00:00Z', started_at: '2026-08-29T00:00:00Z', ended_at: '2026-08-29T01:00:00Z',
    timezone: 'Asia/Taipei', local_date: '2026-08-29', value: 1234, unit: 'count', ...overrides,
  };
  return { ...record, idempotency_key: idempotencyKey(record) };
}

test('platform routing recommends APK for Android, Shortcut for iOS, and manual selection otherwise', () => {
  assert.equal(detectPlatform('Mozilla/5.0 (Linux; Android 15)', 'Linux armv8l'), PLATFORM.ANDROID);
  assert.equal(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone'), PLATFORM.IOS);
  assert.equal(detectPlatform('Mozilla/5.0 (Windows NT 10.0)', 'Win32'), PLATFORM.OTHER);
  assert.equal(connectorOptions('android')[0].connector, 'android_helper');
  assert.equal(connectorOptions('ios')[0].connector, 'ios_shortcut');
});

test('missing or insecure distribution URLs never produce fake links', () => {
  const empty = normalizeTesterAccessConfig({ ANDROID_BETA_APK_URL: '', IOS_SHORTCUT_SHARE_URL: 'http://unsafe.example/shortcut' });
  assert.equal(empty.androidApkUrl, null);
  assert.equal(empty.iosShortcutUrl, null);
  assert.equal(connectorPresentation(PLATFORM.ANDROID, {}).ready, false);
  assert.equal(connectorPresentation(PLATFORM.IOS, {}).ready, false);
});

test('configured HTTPS tester links are environment-driven and status is bounded', () => {
  const input = { ANDROID_BETA_APK_URL: 'https://beta.example/app.apk', IOS_SHORTCUT_SHARE_URL: 'https://www.icloud.com/shortcuts/example' };
  assert.equal(connectorPresentation(PLATFORM.ANDROID, input, { connection_status: 'SYNCED' }).status, 'SYNCED');
  assert.equal(connectorPresentation(PLATFORM.IOS, input, { connection_status: 'GRANTED' }).status, 'UNKNOWN');
});

test('Android HDL v2 record validates, replays deterministically, and cannot cross users', () => {
  const first = androidRecord();
  assert.deepEqual(validateRecord(first, userA), first);
  assert.equal(idempotencyKey(first), idempotencyKey({ ...first }));
  const crossUser = androidRecord({ canonical_user_id: userB });
  assert.throws(() => validateRecord(crossUser, userA), /CROSS_USER_UPLOAD/u);
});

test('all beta Health Connect domains remain read-only canonical inputs', () => {
  for (const [domain, unit] of [['heart_rate', 'bpm'], ['resting_heart_rate', 'bpm'], ['sleep', 'minute'], ['sleep_stage', 'minute'], ['weight', 'kg'], ['workout', 'minute'], ['hrv', 'ms'], ['spo2', 'percent']]) {
    assert.doesNotThrow(() => validateRecord(androidRecord({ domain, unit }), userA));
  }
});

test('distribution config and Shortcut manifest contain no credential or fabricated URL', () => {
  const config = fs.readFileSync('config/tester-access.environments.json', 'utf8');
  const shortcut = fs.readFileSync('config/ios-shortcut-tester.manifest.json', 'utf8');
  assert.doesNotMatch(`${config}\n${shortcut}`, /(?:access_token|refresh_token|service_role|client_secret|password)/iu);
  assert.equal(JSON.parse(shortcut).share_url, '');
  const beta = JSON.parse(config).beta;
  assert.match(beta.ANDROID_BETA_APK_URL, /^https:\/\/github\.com\/d0252422-oss\/haelth-companion\/releases\/download\/android-beta-v0\.1\.0-beta\.7\//u);
  assert.equal(beta.ANDROID_BETA_APK_VERSION, '0.1.0-beta.7-debug');
  assert.equal(beta.ANDROID_BETA_APK_SIZE_BYTES, 23604165);
  assert.match(beta.ANDROID_BETA_APK_SHA256, /^[0-9a-f]{64}$/u);
});

test('prepared Beta claim persistence is environment-scoped and keeps credentials hashed', () => {
  const migration = fs.readFileSync('supabase/migrations/20260829045359_add_beta_manual_claim_binding.sql', 'utf8');
  assert.match(migration, /environment text not null default 'beta'/u);
  assert.match(migration, /check \(environment = 'beta'\)/u);
  assert.match(migration, /ONE_TIME_CODE/u);
  assert.doesNotMatch(migration, /(?:access_token|refresh_token|claim)\s+text/iu);
});
