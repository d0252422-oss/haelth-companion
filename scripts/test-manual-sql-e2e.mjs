// Existing Web + actual local signed auth + native PostgreSQL acceptance, never a mock API/engine/DB.
// Root must explicitly finish implementation before invoking this runner.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import net from 'node:net';
import { createLocalPostgres, subjects } from './local-engine-postgres.mjs';

assert.equal(process.argv[2], '--implementation-ready', 'Explicit root implementation-ready invocation required');
assert.ok(process.env.DENO_DIR && path.isAbsolute(process.env.DENO_DIR) && path.resolve(process.env.DENO_DIR).toLowerCase().startsWith('d:\\'), 'Explicit dedicated D DENO_DIR required; no shared cache fallback');
const base = 'http://127.0.0.1:57841';
const phase = process.env.MANUAL_SQL_EVIDENCE_DIR || 'D:/MigrationReports/dual-project/20260912-2035/git-manual-sql-20260913-020110';
const runId = randomUUID(), evidence = path.join(phase, 'manual-sql-e2e-' + runId);
const privateTraceRoot = process.env.MANUAL_SQL_PRIVATE_TRACE_DIR;
assert.ok(privateTraceRoot && path.isAbsolute(privateTraceRoot), 'Explicit private trace retention root required');
assert.ok(path.isAbsolute(phase) && path.resolve(phase).toLowerCase().startsWith('d:\\migrationreports\\'), 'External D evidence only');
const modulePath = process.env.ENGINE_PLAYWRIGHT_MODULE || 'C:/Users/D0252/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const browserPath = process.env.ENGINE_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { chromium } = await import(pathToFileURL(modulePath).href);
const requireInstalled = createRequire(modulePath), JSZip = requireInstalled('jszip');
await mkdir(evidence, { recursive: true });
const privateDir = path.join(privateTraceRoot, runId); await mkdir(privateDir, { recursive: true });
const redact = value => String(value).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_SYNTHETIC_SESSION]');
const hash = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = n => new Date(Date.parse(day) + n * 86400000).toISOString().slice(0, 10);
const gitRead = args => execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'diff.autoRefreshIndex=false', ...args], { encoding: 'utf8', timeout: 15000 }).trim();
const report = { source_revision: gitRead(['rev-parse', 'HEAD']), working_tree: gitRead(['status', '--short']), command: 'node scripts/test-manual-sql-e2e.mjs --implementation-ready', started_at: now(), runtime_classification: 'LOCAL_DENO_NATIVE_POSTGRES_SYNTHETIC_SIGNED_AUTH_NOT_EDGE_OR_GOOGLE_OAUTH', synthetic_only: true, mocks: { api: false, engine: false, persistence: false, authorization: false }, source_hashes: {}, steps: [], http: [], console: [], page_errors: [], blocked_external_requests: [], dialogs: [], errors: [], tools: { node: process.version, playwright: requireInstalled('playwright/package.json').version, browser_executable: browserPath, deno_cache: process.env.DENO_DIR }, gates: [] };
for (const file of ['index.html', 'scripts/local-engine-web.js', 'scripts/local-engine-server.ts', 'scripts/local-engine-auth.ts', 'fixtures/engine-local-identities.json', 'supabase/functions/mobile-health-beta/index.ts', 'supabase/functions/mobile-health-beta/local-engine-runtime.ts', 'supabase/functions/mobile-health-beta/manual-body-local.ts', 'supabase/functions/mobile-health-beta/engine-portable.ts', 'scripts/test-manual-sql-e2e.mjs', 'config/engine-local.deno.json', 'config/engine-local.deno.lock', 'package-lock.json']) report.source_hashes[file] = hash(await readFile(file));
for (const file of (await readdir('supabase/migrations')).filter(name => name.endsWith('.sql')).sort()) report.source_hashes['supabase/migrations/' + file] = hash(await readFile('supabase/migrations/' + file));
const record = (step, detail = {}) => { report.steps.push({ step, at: now(), ...detail }); console.log('PASS ' + step); };
async function gate(name, fn) {
  const started = now();
  try { await fn(); report.gates.push({ name, status: 'PASS', started_at: started, ended_at: now() }); }
  catch (error) { report.gates.push({ name, status: 'FAIL', started_at: started, ended_at: now(), error: redact(error.stack || error.message) }); report.errors.push(name); console.error('FAIL ' + name + ': ' + error.message); if (page && !page.isClosed()) await page.screenshot({ path: path.join(evidence, name + '-failure.png'), fullPage: true }).catch(() => {}); }
}
async function portFree(port) { await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', () => reject(Error('PORT_ALREADY_IN_USE_' + port))); probe.listen(port, '127.0.0.1', () => probe.close(resolve)); }); }
async function until(fn, description, timeout = 20000) { const deadline = Date.now() + timeout; let value; while (Date.now() < deadline) { value = await fn(); if (value) return value; await sleep(100); } throw Error('BOUNDED_WAIT_FAILED_' + description); }
let pg, child, browser, page, context;
const contexts = [], responsePromises = new Set(); let stdout = '', stderr = '';
const http = async (cookie, action, payload = {}) => {
  const start = now(), response = await fetch(base + '/v1/engine/web', { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ action, payload }), signal: AbortSignal.timeout(30000) });
  const body = await response.json(); report.http.push({ transport: 'DIRECT_HTTP_TEST', action, payload, http_status: response.status, response: body, started_at: start, ended_at: now() }); return { http_status: response.status, ...body };
};
async function loginCookie(account, extra = {}) { const res = await fetch(base + '/local-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account, ...extra }), signal: AbortSignal.timeout(10000) }); assert.equal(res.status, 200); return res.headers.get('set-cookie').split(';')[0]; }
async function bodyRows() { return await pg.admin`select canonical_user_id,record_id,revision,local_date,deleted,body from public.engine_manual_body_records order by local_date,record_id`; }
async function meals() { return await pg.admin`select canonical_user_id,meal_id,revision,deleted,local_date,body from public.engine_meals order by meal_id`; }
async function nutritionHead(date, user = subjects.A.canonical) {
  return (await pg.admin`select h.output_kind,h.engine_version,h.score,h.score_status,h.payload,h.input_fingerprint from public.engine_output_heads p join public.engine_output_history h using(canonical_user_id,calculation_date,output_kind,engine_version,input_fingerprint) where h.canonical_user_id=${user} and h.calculation_date=${date} and h.output_kind='nutrition'`)[0];
}
async function browserContext(account) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, timezoneId: 'Asia/Taipei', locale: 'zh-TW' });
  const entry = { context: ctx, name: account + '-' + contexts.length }; contexts.push(entry);
  await ctx.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === base || ['data:', 'blob:'].includes(url.protocol)) return route.continue(); report.blocked_external_requests.push(url.origin + url.pathname); return route.abort('blockedbyclient'); });
  await ctx.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const p = await ctx.newPage(); p.setDefaultTimeout(12000);
  p.on('console', msg => report.console.push({ context: entry.name, type: msg.type(), text: redact(msg.text()), at: now() }));
  p.on('pageerror', error => report.page_errors.push({ context: entry.name, error: redact(error.stack || error.message) }));
  p.on('response', response => {
    if (new URL(response.url()).pathname !== '/v1/engine/web') return;
    const pending = (async () => { let body; try { body = await response.json(); } catch { body = { unparsed: true }; } const req = response.request(); report.http.push({ transport: 'BROWSER_ACTUAL_HTTP', context: entry.name, action: req.postDataJSON()?.action, payload: req.postDataJSON()?.payload, http_status: response.status(), response: body, at: now(), timing: req.timing() }); })();
    responsePromises.add(pending); pending.finally(() => responsePromises.delete(pending));
  });
  await p.goto(base); await p.locator('#local-login-' + account.toLowerCase()).click(); await p.locator('#local-engine-login').waitFor({ state: 'detached' });
  return { context: ctx, page: p };
}
async function bodyScreen(p) {
  const read = p.waitForResponse(res => res.url().endsWith('/v1/engine/web') && res.request().postDataJSON()?.action === 'getBodyRecords');
  await p.locator('.mobile-nav-btn[data-screen="body-screen"]').click();
  assert.equal((await (await read).json()).ok, true);
}
async function weightEditor(p, date = day) {
  await p.locator('#quick-open').click(); await p.locator('.quick-option[data-action="weight"]').click(); await p.locator('#weight-form').waitFor({ state: 'visible' });
  if (date !== day) { await p.locator('#weight-date').fill(date); await p.locator('#weight-date').dispatchEvent('change'); }
  await p.waitForFunction(() => !document.getElementById('weight-date-note').textContent.includes('載入紀錄中'));
}
async function expectedDialog(p, kind, action, expectedId) {
  const idField = kind === 'body' ? '#weight-record-id' : '#meal-record-id', button = kind === 'body' ? '#weight-delete' : '#meal-delete';
  assert.equal(await p.locator(idField).inputValue(), expectedId);
  const expected = kind === 'body' ? '確定刪除此筆身體紀錄？此動作無法復原。' : '確定刪除此筆餐點？此動作無法復原。';
  const observed = new Promise(resolve => p.once('dialog', resolve));
  const click = p.locator(button).click({ timeout: 12000 });
  const dialog = await Promise.race([observed, sleep(5000).then(() => { throw Error('EXPECTED_NATIVE_CONFIRM_MISSING'); })]);
  assert.equal(dialog.type(), 'confirm'); assert.equal(dialog.message(), expected);
  report.dialogs.push({ kind, action, message: expected, record_id: expectedId, listener: 'once before click', at: now() }); await dialog[action](); await click;
}
async function customRange(p, start, end) { await p.locator('#global-range').selectOption('custom'); await p.locator('#global-start-date').fill(start); await p.locator('#global-end-date').fill(end); await p.locator('#date-range-form button[type="submit"]').click(); await p.locator('#date-range-backdrop').waitFor({ state: 'hidden' }); }
try {
  await portFree(57841); await portFree(57483);
  console.log('START dedicated PostgreSQL initialization ' + now());
  pg = await createLocalPostgres({ port: 57483 }); report.database = pg.evidence;
  console.log('READY dedicated PostgreSQL ' + now());
  assert.equal(pg.config.host, '127.0.0.1'); assert.match(pg.config.database, /^health_engine_[a-f0-9]{32}$/);
  const config = path.join(evidence, 'runtime-config.json'); await writeFile(config, JSON.stringify(pg.config));
  const childEnv = { ...process.env, HEALTH_ENGINE_LOCAL_ONLY: '1' }; delete childEnv.ALGORITHM_PYTHON;
  const denoExecutable = process.env.DENO_EXECUTABLE || 'deno';
  const runtimeArgs = ['run', '--cached-only', '--frozen-lockfile', '--node-modules-dir=none', '--config', 'config/engine-local.deno.json', '--allow-env', '--allow-read', '--allow-sys', '--allow-net=127.0.0.1', 'scripts/local-engine-server.ts', config];
  report.tools.deno = execFileSync(denoExecutable, ['--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true, env: childEnv }).trim();
  report.runtime_command = [denoExecutable, ...runtimeArgs];
  child = spawn(denoExecutable, runtimeArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: childEnv });
  child.stdout.on('data', data => { stdout += redact(data); }); child.stderr.on('data', data => { stderr += redact(data); });
  await until(async () => { if (child.exitCode !== null) throw Error('LOCAL_HOST_EXIT_' + child.exitCode); try { return (await fetch(base + '/local-health', { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } }, 'host-health', 15000);
  browser = await chromium.launch({ executablePath: browserPath, headless: true }); report.tools.browser = browser.version();

  await gate('browser_body_crud', async () => {
    ({ context, page } = await browserContext('A')); await bodyScreen(page); await weightEditor(page);
    let responseLossInjected = false;
    await context.route(base + '/v1/engine/web', async route => {
      const input = route.request().postDataJSON();
      if (!responseLossInjected && input?.action === 'upsertBodyRecord') {
        responseLossInjected = true;
        const actual = await route.fetch(), committed = await actual.json();
        assert.equal(committed.ok, true); assert.equal(committed.data.status, 'SAVED');
        report.body_response_loss = { scope: 'TRANSPORT_ONLY_FAULT_INJECTION', actual_backend_called: true, persistence_mocked: false, actual_http_status: actual.status(), request_id: input.payload.clientRequestId, record_id: committed.data.recordId, injected_at: now() };
        await route.abort('failed'); return;
      }
      await route.continue();
    });
    await page.locator('#weight-input').fill('72.4'); await page.locator('#fat-input').fill(''); await page.locator('#weight-save').click({ clickCount: 2 }); await page.locator('#weight-form').waitFor({ state: 'hidden' });
    const created = await until(async () => (await bodyRows()).find(r => r.canonical_user_id === subjects.A.canonical && !r.deleted), 'body-create');
    const id = created.record_id; assert.equal(created.body.weight, 72.4); assert.equal(created.body.bodyFat, null); assert.equal(created.body.source, 'MANUAL_WEB'); assert.equal(created.body.analysisStatus, 'ANALYSIS_PENDING'); assert.equal((await bodyRows()).length, 1);
    assert.equal(responseLossInjected, true);
    await until(async () => report.http.some(r => r.transport === 'BROWSER_ACTUAL_HTTP' && r.action === 'getBodyWriteStatus' && r.response.data?.exists === true), 'real-receipt-response-loss-recovery');
    await page.waitForFunction(() => document.getElementById('body-current').textContent.includes('72.4'));
    await page.waitForFunction(() => document.getElementById('body-current-note').dataset.analysisStatus === 'ANALYSIS_PENDING');
    await page.screenshot({ path: path.join(evidence, 'body-created.png'), fullPage: true }); record('Body actual UI create persists once with null bodyFat and honest analysis pending; lost real response recovered automatically by stored receipt', { row: created });
    await weightEditor(page); assert.equal(await page.locator('#weight-record-id').inputValue(), id); await page.locator('#weight-input').fill('73.1'); await page.locator('#fat-input').fill('0'); await page.locator('#weight-save').click(); await page.locator('#weight-form').waitFor({ state: 'hidden' });
    await until(async () => { const row = (await bodyRows())[0]; return Number(row.revision) === 2 && row.body.weight === 73.1 && row.body.bodyFat === 0; }, 'body-update'); record('Body UI update preserves record ID and zero bodyFat');
    ({ context, page } = await browserContext('A')); await bodyScreen(page); await page.waitForFunction(() => document.getElementById('body-current').textContent.includes('73.1')); await weightEditor(page); assert.equal(await page.locator('#weight-record-id').inputValue(), id); assert.equal(await page.locator('#fat-input').inputValue(), '0'); record('New browser context/login re-reads body from SQL, not same-context cache');
    const before = await bodyRows(); await expectedDialog(page, 'body', 'dismiss', id); assert.deepEqual(await bodyRows(), before); assert.equal(await page.locator('#weight-form').isVisible(), true); record('Body delete cancel retains exact SQL row');
    await expectedDialog(page, 'body', 'accept', id); await page.locator('#weight-form').waitFor({ state: 'hidden' }); await until(async () => (await bodyRows())[0].deleted, 'body-tombstone'); await page.reload(); await bodyScreen(page); await page.waitForFunction(() => document.getElementById('body-current').textContent === '—'); record('Body confirmed delete persists tombstone and reload does not resurrect');
    ({ context, page } = await browserContext('B')); await bodyScreen(page); assert.equal(await page.locator('#body-current').innerText(), '—'); await weightEditor(page); assert.equal(await page.locator('#weight-record-id').inputValue(), ''); record('B browser sees no A body data');
    const mobile = await pg.admin`select count(*)::int as count from public.beta_health_records`; assert.equal(mobile[0].count, 0); report.body_mobile_records_written = 0;
  });

  await gate('http_body_security_and_transaction', async () => {
    const a = await loginCookie('A'), b = await loginCookie('B'), date = shift(-8);
    for (const cookie of [null, 'engine_session=broken.jwt.signature', await loginCookie('MISSING')]) assert.equal((await http(cookie, 'getBodyRecords', { startDate: date, endDate: day })).ok, false);
    const expired = await loginCookie('A', { expired: true }); assert.equal((await http(expired, 'getBodyRecords', { startDate: date, endDate: day })).ok, false, 'HTTP expired token must be rejected; issuer must explicitly support local expiry fixture');
    const identity = await http(a, 'getCurrentUser'); assert.equal(identity.data.user.userId, subjects.A.canonical); assert.notEqual(subjects.A.auth, subjects.A.canonical);
    for (const weight of [null, '', 'abc', 0, -1, 19.9, 500.1]) assert.equal((await http(a, 'upsertBodyRecord', { date, weight, clientRequestId: randomUUID() })).ok, false);
    assert.equal((await http(a, 'upsertBodyRecord', { date, clientRequestId: randomUUID() })).ok, false);
    for (const payload of [{ date: '2026-02-30', weight: 70 }, { date: shift(1), weight: 70 }, { date, weight: 70, bodyFat: -1 }, { date, weight: 70, bodyFat: 101 }]) assert.equal((await http(a, 'upsertBodyRecord', { ...payload, clientRequestId: randomUUID() })).ok, false);
    for (const owner of ['user_id', 'userId', 'canonical_user_id', 'canonicalUserId', 'owner_id', 'subject_ref', 'auth_user_id']) assert.equal((await http(a, 'upsertBodyRecord', { date, weight: 70, clientRequestId: randomUUID(), [owner]: subjects.B.canonical })).ok, false);
    const payload = { date, weight: 70, bodyFat: null, clientRequestId: randomUUID() };
    const concurrent = await Promise.all(Array.from({ length: 4 }, () => http(a, 'upsertBodyRecord', payload)));
    assert.ok(concurrent.every(r => r.ok === true), JSON.stringify(concurrent));
    assert.equal(new Set(concurrent.map(r => r.data.record.recordId)).size, 1, 'concurrent same-request writes must preserve one record ID');
    const created = concurrent[0]; assert.equal(created.data.status, 'SAVED');
    const id = created.data.record.recordId, replay = await http(a, 'upsertBodyRecord', payload); assert.equal(replay.ok, true); assert.equal(replay.data.record.recordId, id);
    assert.equal((await http(a, 'upsertBodyRecord', { ...payload, weight: 71 })).ok, false);
    const receipt = await http(a, 'getBodyWriteStatus', { clientRequestId: payload.clientRequestId }); assert.equal(receipt.data.exists, true); assert.equal((await http(b, 'getBodyWriteStatus', { clientRequestId: payload.clientRequestId })).data.exists, false);
    assert.equal((await http(b, 'getBodyRecords', { startDate: date, endDate: date })).data.length, 0);
    assert.equal((await http(b, 'deleteBodyRecord', { recordId: id, revision: 1, clientRequestId: randomUUID() })).ok, false);
    const update = await http(a, 'upsertBodyRecord', { recordId: id, revision: 1, date, weight: 71, bodyFat: 0, clientRequestId: randomUUID() }); assert.equal(update.ok, true); assert.equal(update.data.record.bodyFat, 0);
    assert.equal((await http(a, 'upsertBodyRecord', { recordId: id, revision: 1, date, weight: 72, clientRequestId: randomUUID() })).ok, false);
    const duplicate = await http(a, 'addBodyRecord', { date, weight: 73, clientRequestId: randomUUID() }); assert.equal(duplicate.ok, false, 'another live ID for same user/day must fail');
    for (const [offset, weight] of [[-11, 20], [-12, 500]]) assert.equal((await http(a, 'addBodyRecord', { date: shift(offset), weight, clientRequestId: randomUUID() })).ok, true, 'UI weight boundary must be accepted');
    assert.equal((await http(a, 'upsertBodyRecord', { recordId: id, revision: 2, date: shift(-11), weight: 71, clientRequestId: randomUUID() })).ok, false, 'date collision must not overwrite another live record');
    const movedDate = shift(-7), moved = await http(a, 'upsertBodyRecord', { recordId: id, revision: 2, date: movedDate, weight: 71, bodyFat: 0, clientRequestId: randomUUID() }); assert.equal(moved.ok, true);
    assert.equal((await http(a, 'getBodyRecords', { startDate: date, endDate: date })).data.length, 0);
    assert.equal((await http(a, 'getBodyRecords', { startDate: movedDate, endDate: movedDate })).data[0].recordId, id);
    assert.equal((await http(a, 'getBodyRecords', { startDate: shift(-400), endDate: day })).ok, false);
    assert.equal((await http(a, 'getBodyRecords', { startDate: day, endDate: shift(-1) })).ok, false);
    const roles = await pg.admin`select rolname,rolsuper,rolbypassrls from pg_roles where rolname in ('anon','authenticated','service_role')`;
    assert.equal(roles.find(r => r.rolname === 'authenticated').rolbypassrls, false);
    assert.equal(roles.find(r => r.rolname === 'authenticated').rolsuper, false);
    assert.equal(roles.find(r => r.rolname === 'anon').rolbypassrls, false);
    const own = await pg.admin.begin(async tx => { await tx.unsafe('set local role authenticated'); await tx`select set_config('request.jwt.claim.sub',${subjects.A.auth},true)`; return await tx`select record_id from public.engine_manual_body_records where canonical_user_id=${subjects.A.canonical} and record_id=${id}`; }); assert.equal(own.length, 1);
    const visible = await pg.admin.begin(async tx => { await tx.unsafe('set local role authenticated'); await tx`select set_config('request.jwt.claim.sub',${subjects.B.auth},true)`; return await tx`select * from public.engine_manual_body_records where canonical_user_id=${subjects.A.canonical}`; }); assert.equal(visible.length, 0);
    await assert.rejects(() => pg.admin.begin(async tx => { await tx.unsafe('set local role anon'); await tx`select * from public.engine_manual_body_records`; }));
    await assert.rejects(() => pg.admin.begin(async tx => { await tx.unsafe('set local role authenticated'); await tx`select set_config('request.jwt.claim.sub',${subjects.A.auth},true)`; await tx`update public.engine_manual_body_records set deleted=true where canonical_user_id=${subjects.A.canonical} and record_id=${id}`; }));
    const failureId = randomUUID(); assert.match(failureId, /^[a-f0-9-]{36}$/);
    await pg.admin.unsafe(`create function private.manual_test_receipt_failure() returns trigger language plpgsql as $$ begin if new.request_id='${failureId}'::uuid then raise exception 'SYNTHETIC_RECEIPT_WRITE_FAILURE'; end if; return new; end $$; create trigger manual_test_receipt_failure before insert on private.engine_body_mutation_receipts for each row execute function private.manual_test_receipt_failure();`);
    const beforeFailure = await bodyRows(); assert.equal((await http(a, 'upsertBodyRecord', { date: shift(-9), weight: 80, clientRequestId: failureId })).ok, false); assert.deepEqual(await bodyRows(), beforeFailure); assert.equal((await http(a, 'getBodyWriteStatus', { clientRequestId: failureId })).data.exists, false);
    const removed = await http(a, 'deleteBodyRecord', { recordId: id, revision: 3, clientRequestId: randomUUID() }); assert.equal(removed.ok, true);
    await http(a, 'upsertBodyRecord', payload); assert.equal((await http(a, 'getBodyRecords', { startDate: movedDate, endDate: movedDate })).data.length, 0);
    assert.equal((await http(a, 'upsertBodyRecord', { recordId: id, revision: 4, date: movedDate, weight: 75, clientRequestId: randomUUID() })).ok, false);
    report.rls = { roles, B_cannot_read_A: true, anonymous_denied: true, execution_path: 'authenticated low-privilege reads + separately exercised service-role server tenant guard' }; record('HTTP body auth, replay, stale, ownership, bounds, tombstone and real transaction rollback');
  });

  await gate('http_body_bounded_lock_retry', async () => {
    const a = await loginCookie('A'), payload = { date: shift(-15), weight: 70, clientRequestId: randomUUID() };
    const before = await bodyRows();
    let signalLocked, releaseLock;
    const locked = new Promise(resolve => { signalLocked = resolve; });
    const released = new Promise(resolve => { releaseLock = resolve; });
    const holding = pg.admin.begin(async tx => { await tx`select pg_advisory_xact_lock(hashtextextended(${subjects.A.canonical},0))`; signalLocked(); await released; });
    let response, elapsed;
    try {
      await Promise.race([locked, sleep(5000).then(() => { throw Error('TEST_LOCK_ACQUISITION_TIMEOUT'); })]);
      const started = performance.now(); response = await http(a, 'upsertBodyRecord', payload); elapsed = performance.now() - started;
      assert.equal(response.http_status, 503); assert.equal(response.ok, false); assert.equal(response.error, 'DB_TIMEOUT_RETRYABLE'); assert.equal(response.retryable, true);
      assert.ok(elapsed <= 6000, `Predeclared lock HTTP bound 6000ms exceeded: ${elapsed}`);
      assert.equal((await http(a, 'getBodyWriteStatus', { clientRequestId: payload.clientRequestId })).data.exists, false);
    } finally { releaseLock(); await holding; }
    assert.deepEqual(await bodyRows(), before, 'Timed-out transaction must not leave body data');
    const retry = await http(a, 'upsertBodyRecord', payload); assert.equal(retry.ok, true); assert.equal(retry.data.status, 'SAVED');
    const receipt = await http(a, 'getBodyWriteStatus', { clientRequestId: payload.clientRequestId }); assert.equal(receipt.data.exists, true); assert.equal(receipt.data.recordId, retry.data.recordId);
    assert.equal((await bodyRows()).filter(r => r.body.date === payload.date && !r.deleted).length, 1);
    report.lock_contention = { declared_sql_lock_timeout_ms: 2000, declared_http_max_ms: 6000, actual_http_ms: elapsed, response, same_request_id_after_release: payload.clientRequestId, final_status: retry.data.status };
    record('Held real PostgreSQL advisory lock returns bounded retryable; exact request retries once after release');
  });

  await gate('browser_nutrition_history_crud', async () => {
    const date = shift(-40), food = 'MANUAL SQL SYNTHETIC LABEL ' + runId.slice(0, 8);
    ({ context, page } = await browserContext('A')); await customRange(page, date, date); await page.locator('.mobile-nav-btn[data-screen="nutrition-screen"]').click(); await page.locator('#add-meal').click();
    await page.locator('#meal-date').fill(date); await page.locator('#meal-food').fill(food); await page.locator('#meal-time').fill('12:00'); await page.locator('#meal-label-mode').check(); await page.locator('#meal-weight-grams').fill('150'); await page.locator('#meal-reference-source').fill('SYNTHETIC LABEL v1; arithmetic only');
    for (const [name, value] of Object.entries({ calories: 200, protein: 10, carbs: 20, fat: 5 })) await page.locator('#meal-' + name).fill(String(value));
    await page.locator('#meal-save').click(); await page.locator('#meal-form').waitFor({ state: 'hidden' });
    let row = await until(async () => (await meals()).find(r => r.body.foodName === food), 'historical-meal-created'); const id = row.meal_id;
    assert.equal(row.body.calories, 300); assert.equal(row.body.date, date); assert.equal(row.body.userConfirmed, true);
    const createdHead = await until(async () => { const head = await nutritionHead(date); return head?.payload?.metrics?.totals?.calories === 300 ? head : false; }, 'stored-historical-engine-aggregate');
    assert.equal(createdHead.engine_version, 'nutrition-score-v1.0'); assert.equal(Number(createdHead.score), 17.6);
    await page.locator(`[data-meal-record-id="${id}"]`).waitFor(); record('Existing meal UI persists confirmed 150 g meal outside former 28-day range', { meal_id: id, date, calories: row.body.calories });
    const a = await loginCookie('A'), b = await loginCookie('B');
    const writeEvent = await until(async () => report.http.find(r => r.transport === 'BROWSER_ACTUAL_HTTP' && r.action === 'upsertMealRecord' && r.payload.foodName === food && r.response.ok === true), 'historical-browser-write-evidence');
    const beforeReplay = await meals(), replayed = await http(a, 'upsertMealRecord', writeEvent.payload); assert.equal(replayed.ok, true); assert.equal(replayed.data.replayed, true); assert.deepEqual(await meals(), beforeReplay);
    const history = await http(a, 'getNutritionRecords', { startDate: date, endDate: date }); assert.equal(history.ok, true); assert.equal(history.data.find(r => r.mealRecordId === id).calories, 300);
    assert.equal((await http(a, 'getNutritionRecords', { startDate: day, endDate: day })).data.some(r => r.mealRecordId === id), false);
    assert.equal((await http(b, 'getNutritionRecords', { startDate: date, endDate: date })).data.length, 0);
    await page.reload(); await page.locator('.mobile-nav-btn[data-screen="nutrition-screen"]').click(); await page.locator(`[data-meal-record-id="${id}"]`).waitFor(); await page.locator(`[data-meal-record-id="${id}"]`).click(); assert.equal(await page.locator('#meal-weight-grams').inputValue(), '150'); assert.equal(await page.locator('#meal-calories').inputValue(), '200');
    await page.locator('#meal-weight-grams').fill('200'); await page.locator('#meal-save').click(); await page.locator('#meal-form').waitFor({ state: 'hidden' }); await until(async () => { row = (await meals()).find(r => r.meal_id === id); return Number(row.revision) === 2 && row.body.calories === 400; }, 'historical-meal-updated');
    const updatedHead = await until(async () => { const head = await nutritionHead(date); return head?.payload?.metrics?.totals?.calories === 400 ? head : false; }, 'updated-engine-aggregate'); assert.equal(Number(updatedHead.score), 23.5); assert.notEqual(updatedHead.input_fingerprint, createdHead.input_fingerprint);
    ({ context, page } = await browserContext('A')); await customRange(page, date, date); await page.locator('.mobile-nav-btn[data-screen="nutrition-screen"]').click(); await page.locator(`[data-meal-record-id="${id}"]`).waitFor();
    assert.equal(await page.evaluate(id => appState.mealsToday.some(r => r.mealRecordId === id), id), false, 'historical meal must never contaminate today list');
    record('Historical meal replay is idempotent; updated aggregate and new-context login re-read actual SQL');
    await page.locator(`[data-meal-record-id="${id}"]`).click(); const before = await meals(); await expectedDialog(page, 'meal', 'dismiss', id); assert.deepEqual(await meals(), before); record('Historical meal update and cancel-delete preserve versioned SQL values');
    await expectedDialog(page, 'meal', 'accept', id); await page.locator('#meal-form').waitFor({ state: 'hidden' }); await until(async () => (await meals()).find(r => r.meal_id === id).deleted, 'historical-meal-tombstone');
    const deletedHead = await until(async () => { const head = await nutritionHead(date); return head?.score === null && head?.score_status === 'INSUFFICIENT_DATA' ? head : false; }, 'deleted-engine-null-head');
    assert.equal(deletedHead.payload.metrics.meal_count, null); assert.ok(Object.values(deletedHead.payload.metrics.totals).every(value => value === null));
    const frozen = await pg.admin`select score,algorithm_version from public.beta_health_scores where canonical_user_id=${subjects.A.canonical} and score_date=${date} and score_type='nutrition'`; assert.ok(frozen.every(r => r.score === null && r.algorithm_version === 'health-score-v1.0'));
    report.nutrition_engine_assertions = { created: createdHead, updated: updatedHead, deleted: deletedHead, original_frozen_nutrition_unchanged: frozen };
    await page.reload(); await page.locator('.mobile-nav-btn[data-screen="nutrition-screen"]').click(); assert.equal(await page.locator(`[data-meal-record-id="${id}"]`).count(), 0); assert.equal((await http(a, 'getNutritionRecords', { startDate: date, endDate: date })).data.length, 0);
    ({ context, page } = await browserContext('B')); await customRange(page, date, date); await page.locator('.mobile-nav-btn[data-screen="nutrition-screen"]').click(); assert.equal(await page.locator('[data-meal-record-id]').count(), 0);
    await page.screenshot({ path: path.join(evidence, 'historical-nutrition-deleted-B-isolation.png'), fullPage: true }); record('Historical meal confirmed delete/reload/B isolation; missing data not fabricated');
  });
  assert.deepEqual(report.page_errors, []); assert.deepEqual(report.blocked_external_requests, []);
} catch (error) { report.errors.push(redact(error.stack || error.message)); }
finally {
  await Promise.allSettled([...responsePromises]);
  for (const entry of contexts) {
    try {
      const raw = path.join(privateDir, entry.name + '-raw.zip'); await entry.context.tracing.stop({ path: raw });
      const zip = await JSZip.loadAsync(await readFile(raw));
      for (const [name, member] of Object.entries(zip.files)) if (!member.dir && /\.(trace|network|json)$/.test(name)) zip.file(name, redact(await member.async('string')));
      await writeFile(path.join(evidence, entry.name + '-trace.zip'), await zip.generateAsync({ type: 'nodebuffer' }));
    } catch (error) { report.errors.push('TRACE_RETAIN_OR_REDACT_FAILED: ' + error.message); }
  }
  if (browser) await browser.close();
  if (child && child.exitCode === null) { if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); else child.kill('SIGTERM'); }
  if (pg) await pg.close();
  report.source_hashes_after = {}; report.source_changed_during_run = [];
  for (const [file, before] of Object.entries(report.source_hashes)) {
    const after = hash(await readFile(file)); report.source_hashes_after[file] = after;
    if (after !== before) report.source_changed_during_run.push(file);
  }
  if (report.source_changed_during_run.length) report.errors.push('SOURCE_CHANGED_DURING_TEST');
  report.ended_at = now(); report.exit_code = report.errors.length ? 1 : 0; report.status = report.errors.length ? 'FAIL' : 'PASS'; report.test_cases = report.gates.length; report.fresh_passed = report.gates.filter(g => g.status === 'PASS').length; report.fresh_failed = report.gates.filter(g => g.status === 'FAIL').length;
  report.trace_retention = 'Raw synthetic-session traces retained only under explicit private backup root; JWT-redacted copies in evidence; no trace files deleted'; report.cleanup = 'Only owned browser contexts/process, Deno process tree, new PostgreSQL instance stopped; DB/evidence/raw private traces retained';
  await writeFile(path.join(evidence, 'server.stdout.log'), stdout); await writeFile(path.join(evidence, 'server.stderr.log'), stderr); await writeFile(path.join(evidence, 'report.json'), redact(JSON.stringify(report, null, 2)));
  console.log(JSON.stringify({ status: report.status, report: path.join(evidence, 'report.json') })); process.exitCode = report.exit_code;
}
