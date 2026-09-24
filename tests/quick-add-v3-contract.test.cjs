const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const observations = fs.readFileSync(path.join(root, 'scripts', 'manual-observation-web.js'), 'utf8');
const bodyStore = fs.readFileSync(path.join(root, 'supabase', 'functions', 'mobile-health-beta', 'manual-body-local.ts'), 'utf8');
const build = require(path.join(root, 'scripts', 'build-version.js'));
const liveAcceptance = fs.readFileSync(path.join(root, 'scripts', 'quick-add-live-acceptance.mjs'), 'utf8');

const quick = html.match(/<section id="quick-sheet"[\s\S]*?<\/section>/)?.[0] || '';
const labels = [...quick.matchAll(/<b(?: [^>]*)?>([^<]+)<\/b>/g)].map(match => match[1].trim());
assert.match(quick, /data-ui-version="quick-add-v3"/);
assert.deepEqual(labels, ['新增體重 / 體脂', '新增訓練', '新增飲食', '新增睡眠', '新增步數 / 總消耗', '新增身體狀態']);
assert.equal((quick.match(/class="quick-option"/g) || []).length, 6);
assert.doesNotMatch(quick, />新增體脂</);
assert.doesNotMatch(quick, />新增步數</);
assert.doesNotMatch(quick, />新增總消耗</);

assert.match(html, /id="weight-input"[^>]*(?!required)/);
assert.match(html, /weight===null&&bodyFat===null/);
assert.match(bodyStore, /if \(weight === null && bodyFat === null\) throw Error\("BODY_METRIC_REQUIRED"\)/);
assert.match(observations, /Promise\.allSettled\(attempts\.map/);
assert.match(observations, /已成功項目不會重送/);
assert.match(observations, /coverage:'FULL_DAY'/);

assert.equal(build.shouldRecover('old', 'new', ''), true);
assert.equal(build.shouldRecover('old', 'new', 'new'), false);
assert.equal(build.shouldRecover('new', 'new', ''), false);
const recovered = new URL(build.recoveryUrl('https://liff.line.me/id?range=30d&source=line', 'new-build'));
assert.equal(recovered.searchParams.get('range'), '30d');
assert.equal(recovered.searchParams.get('source'), 'line');
assert.equal(recovered.searchParams.get('v'), 'new-build');
assert.match(html, /數據載入中，請稍候…/);
assert.match(html, /數據更新中，請稍候…/);
assert.match(html, /資料暫時無法更新/);
assert.match(liveAcceptance, /WEB_EXPECTED_BUILD_ID/);
assert.match(liveAcceptance, /LIVE_DEPLOYED_BUILD_MISMATCH/);
assert.match(liveAcceptance, /LIFF_LOADED_BUILD_MISMATCH/);
assert.match(liveAcceptance, /observeWebAcceptance/);
assert.match(liveAcceptance, /AUTH_BOUNDARY_NOT_VISIBLE/);

console.log('Quick Add V3 contract tests: PASS');
