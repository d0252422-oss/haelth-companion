// Focused offline contracts; these synthetic responses are not live Beta evidence.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const HealthCoreUX = require('../scripts/core-ux-contract.js');

const html = fs.readFileSync('index.html', 'utf8');
function singleLineFunction(name) {
  const line = html.split(/\r?\n/).find(value => value.startsWith(`    function ${name}(`));
  assert.ok(line, `missing ${name}`);
  return line;
}
function asyncFunction(name, nextName) {
  const start = html.indexOf(`    async function ${name}(`);
  const end = html.indexOf(`    async function ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `missing ${name} boundary`);
  return html.slice(start, end);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function harness() {
  const states = [], rendered = [], pending = [];
  const nodes = new Map();
  const ctx = vm.createContext({
    Promise, Object, Date, Map, Set, performance: {now: () => 0}, APP_STARTED_AT: 0,
    HealthCoreUX, console, sharedTrendVisible: false, selectedHealthDate: null,
    currentUser: {userId: 'A'}, sessionToken: 'token-A', identityEpoch: 0,
    dashboardRequestSequence: 0, timelineReadError: false,
    dashboardPayloadKeys: {dashboard: '', timeline: ''},
    globalDateRange: {preset: 'custom', startDate: '2026-09-22', endDate: '2026-09-28'},
    DATA_SECTIONS: [], sectionWindows: {}, sectionLoadKeys: new Set(),
    appState: {dashboard: null, healthTimeline: [], profile: null},
    document: {getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, {innerHTML: ''});
      return nodes.get(id);
    }},
    resolveDateRange: (_preset, value) => ({startDate: value.startDate, endDate: value.endDate}),
    identitySnapshot: () => ({userId: ctx.currentUser.userId, token: ctx.sessionToken, epoch: ctx.identityEpoch}),
    identitySnapshotCurrent: snapshot => snapshot.userId === ctx.currentUser.userId && snapshot.token === ctx.sessionToken && snapshot.epoch === ctx.identityEpoch,
    dashboardWindowKey: (start, end) => `${ctx.currentUser.userId}|${start}|${end}`,
    readDashboardCache: () => null, writeDashboardCache() {},
    clearMismatchedDashboardPayload() { return false; },
    dashboardReadPromises: () => pending.shift(),
    normalizeHealthTimeline: value => value.timeline,
    getLocalDateString: () => '2026-09-28',
    setValue() {}, updatePageHeader() {}, setConnectionState() {},
    setDashboardDataState: (state, message) => states.push({state, message}),
    renderDashboard: () => rendered.push({user: ctx.currentUser.userId, error: ctx.timelineReadError, today: ctx.appState.dashboard?.today, timeline: [...ctx.appState.healthTimeline]}),
    renderSharedHealthTrends() {}, perfLog() {},
    manualSqlEnabled: () => false, timelineNeedsScoreConvergence: () => false,
    showDashboardError() {}, convergeHealthScoreTimeline() {},
  });
  for (const name of ['dashboardHasCurrentRangeData', 'applyDashboardPayload', 'settledDashboardPayload', 'dashboardFailurePresentation']) {
    vm.runInContext(singleLineFunction(name), ctx);
  }
  vm.runInContext(asyncFunction('loadRange', 'refreshSectionRange'), ctx);
  return {ctx, states, rendered, pending};
}

for (const reason of ['HTTP_400', 'HTTP_401', 'TIMEOUT']) {
  test(`${reason}: timeline failure is not confirmed NO_DATA; recovery updates the same date`, async () => {
    const {ctx, states, rendered, pending} = harness();
    pending.push([Promise.resolve({today: {date: '2026-09-28', healthStatus: 'NO_DATA'}}), Promise.reject(Error(reason))]);
    await ctx.loadRange();
    assert.equal(ctx.timelineReadError, true);
    assert.equal(rendered.at(-1).error, true);
    assert.equal(states.at(-1).state, 'ready');
    assert.match(states.at(-1).message, /部分資料已載入/);
    assert.equal(HealthCoreUX.metricReadState('healthScore', [], 'error'), 'error');

    pending.push([Promise.resolve({today: {date: '2026-09-28', healthStatus: 'READY', healthScore: 74}}), Promise.resolve({timeline: [{date: '2026-09-28', healthStatus: 'READY', healthScore: 74}]})]);
    await ctx.loadRange(ctx.globalDateRange, {force: true});
    assert.equal(ctx.timelineReadError, false);
    assert.equal(ctx.appState.healthTimeline[0].healthScore, 74);
    assert.equal(rendered.at(-1).today.healthScore, 74);
  });
}

test('late prior-identity responses cannot replace the current user timeline', async () => {
  const {ctx, pending} = harness();
  const oldSummary = deferred(), oldTimeline = deferred();
  pending.push([oldSummary.promise, oldTimeline.promise]);
  const oldLoad = ctx.loadRange();
  ctx.identityEpoch += 1;
  ctx.currentUser = {userId: 'B'};
  ctx.sessionToken = 'token-B';
  pending.push([Promise.resolve({today: {date: '2026-09-28', healthScore: 82}}), Promise.resolve({timeline: [{date: '2026-09-28', healthScore: 82}]})]);
  await ctx.loadRange();
  oldSummary.resolve({today: {date: '2026-09-28', healthScore: 20}});
  oldTimeline.reject(Error('old HTTP_401'));
  await oldLoad;
  assert.equal(ctx.timelineReadError, false);
  assert.equal(ctx.appState.dashboard.today.healthScore, 82);
  assert.equal(ctx.appState.healthTimeline[0].healthScore, 82);
});

test('late response from a previous range cannot replace the selected range', async () => {
  const {ctx, pending} = harness();
  const oldSummary = deferred(), oldTimeline = deferred();
  pending.push([oldSummary.promise, oldTimeline.promise]);
  const oldLoad = ctx.loadRange();
  const nextRange = {preset: 'custom', startDate: '2026-08-30', endDate: '2026-09-28'};
  ctx.globalDateRange = nextRange;
  pending.push([Promise.resolve({today: {date: '2026-09-28', healthScore: 82}}), Promise.resolve({timeline: [{date: '2026-09-28', healthScore: 82}]})]);
  await ctx.loadRange(nextRange);
  oldSummary.resolve({today: {date: '2026-09-28', healthScore: 20}});
  oldTimeline.resolve({timeline: [{date: '2026-09-28', healthScore: 20}]});
  await oldLoad;
  assert.equal(ctx.appState.dashboard.today.healthScore, 82);
  assert.equal(ctx.appState.healthTimeline[0].healthScore, 82);
});

test('dashboard cache and request scope expire at the Asia/Taipei local-date boundary', () => {
  const storage = new Map();
  const ctx = vm.createContext({
    Date, JSON, Object, Number,
    currentUser: {userId: 'A'}, DASHBOARD_CACHE_SCHEMA: 'test',
    DASHBOARD_CACHE_TTL: 60000, DASHBOARD_CACHE_HARD_TTL: 120000,
    localStorage: {getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
    localToday: '2026-09-28', getLocalDateString() { return ctx.localToday; },
    dashboardProviderNamespace: () => 'hosted-beta', perfLog() {},
  });
  for (const name of ['dashboardCacheKey', 'readDashboardCache', 'writeDashboardCache', 'dashboardWindowKey']) {
    vm.runInContext(singleLineFunction(name), ctx);
  }
  const before = ctx.dashboardWindowKey('2026-09-22', '2026-09-28');
  ctx.writeDashboardCache('2026-09-22', '2026-09-28', {dashboard: {today: {date: '2026-09-28'}}});
  assert.ok(ctx.readDashboardCache('2026-09-22', '2026-09-28'));
  ctx.localToday = '2026-09-29';
  assert.notEqual(ctx.dashboardWindowKey('2026-09-22', '2026-09-28'), before);
  assert.equal(ctx.readDashboardCache('2026-09-22', '2026-09-28'), null);
});
