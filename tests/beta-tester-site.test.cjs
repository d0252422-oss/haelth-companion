const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync('beta-tester-site/index.html', 'utf8');

test('beta tester entry is pinned to isolated Beta data target', () => {
  assert.match(html, /uavimjgccigpbwqmfkhh\.supabase\.co\/functions\/v1\/mobile-health-beta/u);
  assert.doesNotMatch(html, /vptqedxdxfoohbqctujf/u);
  assert.match(html, /此頁不提供 production 資料寫入功能/u);
});

test('tester entry exposes Android distribution and fail-closed iOS state', () => {
  assert.match(html, /0\.1\.0-beta\.9/u);
  assert.match(html, /releases\/download\/android-beta-v0\.1\.0-beta\.9\/health-sync-companion-beta-0\.1\.0-beta\.9-debug\.apk/u);
  assert.match(html, /6f2d6c1e86a2/u);
  assert.match(html, /背景安全續傳/u);
  assert.match(html, /等待 iPhone 分享捷徑連結/u);
  assert.doesNotMatch(html, /href=["'][^"']*icloud\.com\/shortcuts\//u);
});

test('tester entry documents native Android login and removes Android claim continuation', () => {
  assert.match(html, /APP 使用 Google 帳號登入/u);
  assert.doesNotMatch(html, /android-claim|continueAndroidSetup|connector_setup|installation_key_fingerprint/u);
  assert.doesNotMatch(html, /Android 一次性連接碼|APK 貼上代碼/u);
  assert.match(html, /\/v1\/scores\/daily/u);
  assert.match(html, /Authorization.*Bearer/u);
  assert.match(html, /sessionStorage\.setItem\("healthCompanionBetaSession"/u);
});

test('tester entry has no production mutation action or embedded private credential', () => {
  assert.doesNotMatch(html, /upsert|saveMeal|saveWorkout|service[_-]?role|client_secret|refresh_token|access_token/iu);
  assert.doesNotMatch(html, /sk_live_|sb_secret_|eyJ[a-zA-Z0-9_-]{20,}/u);
});

test('tester entry inline JavaScript parses successfully', () => {
  const source = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/u)?.[1];
  assert.ok(source);
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'beta-tester-site/index.html' }));
});
