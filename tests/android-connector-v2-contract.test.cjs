'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const read = (path) => fs.readFileSync(path, 'utf8');
const main = read('android-helper/app/src/main/java/app/healthcompanion/sync/MainActivity.kt');
const ingestion = read('android-helper/app/src/main/java/app/healthcompanion/sync/IngestionClient.kt');
const planner = read('android-helper/app/src/main/java/app/healthcompanion/sync/BatchPlanner.kt');
const identity = read('android-helper/app/src/main/java/app/healthcompanion/sync/IdentityBootstrap.kt');
const manifest = read('android-helper/app/src/main/AndroidManifest.xml');

test('normal Android UX has browser login and no manual claim input', () => {
  assert.match(main, /text = "登入"/u);
  assert.match(main, /identity\.setupIntent\(\)/u);
  assert.doesNotMatch(main, /EditText|consumeManualClaim|一次性連接碼/u);
  assert.match(identity, /connector_setup/u);
  assert.match(identity, /installation_key_fingerprint/u);
  assert.match(manifest, /healthcompanion-beta/u);
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

test('session refresh and logout never expose credentials in UI or logs', () => {
  assert.match(identity, /\/v1\/mobile\/sessions\/refresh/u);
  assert.match(identity, /\/v1\/mobile\/sessions\/current/u);
  assert.doesNotMatch(`${main}\n${identity}\n${ingestion}`, /Log\.|println\(|printStackTrace|service[_-]?role/iu);
});
