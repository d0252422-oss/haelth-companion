'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { ConnectorStatusRegistry } = require('../scripts/connector-status-contract.cjs');

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';

test('connector status is user scoped and browser-unknown permissions remain explicit', () => {
  const registry = new ConnectorStatusRegistry();
  registry.report({ canonical_user_id: userA, platform: 'android', connector_type: 'android_helper', connector_version: '0.1.0-beta.1', last_attempt_at: '2026-08-29T01:00:00Z', last_success_at: null, last_result: 'PERMISSION_REQUIRED', available_domains: [], permission_state_if_known: 'REQUESTED' }, userA);
  registry.report({ canonical_user_id: userB, platform: 'ios', connector_type: 'ios_shortcut', connector_version: '0.1.0-beta.1', last_attempt_at: null, last_success_at: null, last_result: 'UNKNOWN', available_domains: [], permission_state_if_known: 'UNKNOWN' }, userB);
  assert.equal(registry.forUser(userA).length, 1);
  assert.equal(registry.forUser(userA)[0].platform, 'android');
  assert.throws(() => registry.report({ canonical_user_id: userB }, userA), /CROSS_USER_STATUS/u);
});

test('Web tester UI has manual selection, config-driven links, and no fake href', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /data-connector-platform="ANDROID"/u);
  assert.match(html, /data-connector-platform="IOS"/u);
  assert.match(html, /ANDROID_BETA_APK_URL:""/u);
  assert.match(html, /ANDROID_BETA_APK_VERSION:"0\.1\.0-beta\.4-debug"/u);
  assert.match(html, /ANDROID_BETA_APK_SHA256:"61ff81ea12e4d62fbb4f86ac74c0f15b5c0ea7412e9dd4cbcc86bea91eafd67b"/u);
  assert.match(html, /IOS_SHORTCUT_SHARE_URL:""/u);
  assert.match(html, /window\.HEALTH_CONNECTOR_CONFIG/u);
  assert.doesNotMatch(html, /id="android-claim-code"/u);
  assert.match(html, /BETA_INGESTION_BASE_URL:"https:\/\/uavimjgccigpbwqmfkhh\.supabase\.co\/functions\/v1\/mobile-health-beta"/u);
  assert.match(html, /APP 使用 Google 帳號登入/u);
  assert.doesNotMatch(html, /href="[^"]*(?:\.apk|icloud\.com\/shortcuts)/iu);
});

test('Android beta project is read-only Health Connect and development-only', () => {
  const manifest = fs.readFileSync('android-helper/app/src/main/AndroidManifest.xml', 'utf8');
  const build = fs.readFileSync('android-helper/app/build.gradle.kts', 'utf8');
  const workflow = fs.readFileSync('.github/workflows/android-beta-apk.yml', 'utf8');
  assert.match(manifest, /READ_STEPS/u);
  assert.match(manifest, /READ_HEART_RATE/u);
  assert.match(manifest, /READ_SLEEP/u);
  assert.doesNotMatch(manifest, /WRITE_[A-Z_]+/u);
  assert.match(build, /minSdk = 28/u);
  assert.match(build, /connect-client:1\.1\.0/u);
  assert.match(build, /https:\/\/beta\.invalid/u);
  assert.match(workflow, /assembleDebug/u);
  assert.match(workflow, /actions\/upload-artifact@v4/u);
  assert.doesNotMatch(workflow, /(?:\bdeploy\b|\bplay\b|\bproduction\b|signingConfig|app-store|testflight)/iu);
});

test('Shortcut setup manifest is read-only, bounded, and staging-only', () => {
  const manifest = JSON.parse(fs.readFileSync('config/ios-shortcut-tester.manifest.json', 'utf8'));
  assert.equal(manifest.environment, 'beta');
  assert.equal(manifest.max_records_per_batch, 250);
  assert.equal(manifest.share_url, '');
  assert.ok(manifest.read_only_domains.includes('steps'));
  assert.ok(manifest.read_only_domains.includes('sleep'));
});
