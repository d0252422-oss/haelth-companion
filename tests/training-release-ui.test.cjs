'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const build = JSON.parse(fs.readFileSync('build.json', 'utf8'));

function between(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return html.slice(start, end);
}

test('training finish releases the UI only after durable write and never waits for optional analysis', () => {
  const handler = between('document.getElementById("finish-workout").onclick=', 'document.querySelectorAll("[data-mode]")');
  const write = handler.indexOf('await apiService.addWorkoutRecord');
  const clearDraft = handler.indexOf('clearWorkoutDraft()');
  const background = handler.indexOf('refreshInBackground("workout-create"');
  assert.ok(write >= 0 && clearDraft > write && background > clearDraft);
  assert.match(handler, /result\?\.analysisJobScheduled===false/);
  assert.match(handler, /if\(result\?\.analysisJobScheduled!==false\)\{[\s\S]*?await apiService\.refreshDerivedData/);
  assert.match(handler, /草稿已保留/);
});

test('schema mismatch and generic internal failures are translated for users', () => {
  const readable = between('function readableError(', '\n    function dashboardCacheKey');
  assert.match(readable, /MANUAL_SCHEMA_OUT_OF_DATE/);
  assert.match(readable, /系統版本更新尚未完成，資料尚未儲存/);
  assert.match(readable, /ENGINE_REQUEST_FAILED/);
});

test('candidate build id is consistent across manifest, html and cache-busted assets', () => {
  assert.equal(build.buildId, '20260927-core-release-candidate-01');
  assert.match(html, new RegExp(`health-companion-build" content="${build.buildId}`));
  for (const asset of ['build-version.js', 'manual-sql-config.js', 'core-ux-contract.js', 'local-engine-web.js', 'web-view-state.js', 'manual-observation-web.js']) {
    assert.match(html, new RegExp(`${asset.replace('.', '\\.') }\\?v=${build.buildId}`));
  }
});
