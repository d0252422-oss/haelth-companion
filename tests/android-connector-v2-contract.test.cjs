'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const read = (path) => fs.readFileSync(path, 'utf8');
const main = read('android-helper/app/src/main/java/app/healthcompanion/sync/MainActivity.kt');
const ingestion = read('android-helper/app/src/main/java/app/healthcompanion/sync/IngestionClient.kt');
const planner = read('android-helper/app/src/main/java/app/healthcompanion/sync/BatchPlanner.kt');
const identity = read('android-helper/app/src/main/java/app/healthcompanion/sync/IdentityBootstrap.kt');
const nativeAuth = read('android-helper/app/src/main/java/app/healthcompanion/sync/NativeGoogleAuth.kt');
const secureStorage = read('android-helper/app/src/main/java/app/healthcompanion/sync/SecureSupabaseAuthStorage.kt');
const manifest = read('android-helper/app/src/main/AndroidManifest.xml');

test('normal Android UX uses native Google auth and never requests a connection code', () => {
  assert.match(main, /使用 Google 帳號登入/u);
  assert.match(main, /NativeGoogleAuth/u);
  assert.doesNotMatch(main, /IdentityBootstrap|EditText|consumeManualClaim|一次性連接碼|setupIntent/u);
  assert.match(nativeAuth, /GetGoogleIdOption/u);
  assert.match(nativeAuth, /signInWith\(IDToken\)/u);
  assert.match(nativeAuth, /\/v1\/mobile\/native-auth\/link/u);
  assert.match(nativeAuth, /refreshCurrentSession/u);
  assert.match(secureStorage, /AndroidKeyStore/u);
  assert.match(secureStorage, /AES\/GCM\/NoPadding/u);
  assert.match(identity, /\/v1\/mobile\/install-claims\/exchange/u);
});

test('upload uses deterministic record and UTF-8 byte bounds', () => {
  assert.match(planner, /MAX_RECORDS_PER_BATCH = 100/u);
  assert.match(planner, /MAX_APPROX_SERIALIZED_BYTES_PER_BATCH = 256 \* 1024/u);
  assert.match(planner, /sortedWith/u);
  assert.match(planner, /OversizedHealthRecord/u);
  assert.match(ingestion, /SyncCheckpoint/u);
  assert.match(ingestion, /status == 413 -> RetryAction\.OVERSIZE_FAIL/u);
  assert.match(ingestion, /MAX_ATTEMPTS = 3/u);
});

test('legacy claim stays isolated while native session credentials never appear in UI or logs', () => {
  assert.match(identity, /\/v1\/mobile\/sessions\/refresh/u);
  assert.match(identity, /\/v1\/mobile\/sessions\/current/u);
  assert.doesNotMatch(`${main}\n${nativeAuth}\n${secureStorage}\n${identity}\n${ingestion}`, /Log\.|println\(|printStackTrace|service[_-]?role/iu);
});
