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
const releaseExercise = process.argv.includes('--release-exercise');
const releaseA=process.argv.includes('--release-a');
const actualEdge=process.argv.includes('--edge-container');
const nonprivileged=process.argv.includes('--nonprivileged');
assert.ok(!nonprivileged||actualEdge&&releaseExercise,'Nonprivileged mode requires actual Edge and AB contracts');
assert.ok(!(releaseA&&releaseExercise),'Choose independent Release A or full AB');
const privateTraceRoot = process.env.MANUAL_SQL_PRIVATE_TRACE_DIR;
assert.ok(privateTraceRoot && path.isAbsolute(privateTraceRoot), 'Explicit private trace retention root required');
assert.ok(path.isAbsolute(phase) && ['d:\\migrationreports\\','d:\\dev\\evidence\\'].some(root=>path.resolve(phase).toLowerCase().startsWith(root)), 'External D evidence only');
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
for (const file of ['index.html', 'scripts/build-version.js', 'scripts/core-ux-contract.js', 'scripts/local-engine-web.js', 'scripts/local-engine-server.ts', 'scripts/local-engine-auth.ts', 'fixtures/engine-local-identities.json', 'supabase/functions/mobile-health-beta/index.ts', 'supabase/functions/mobile-health-beta/local-engine-runtime.ts', 'supabase/functions/mobile-health-beta/manual-body-local.ts', 'supabase/functions/mobile-health-beta/engine-portable.ts', 'scripts/test-manual-sql-e2e.mjs', 'config/engine-local.deno.json', 'config/engine-local.deno.lock', 'package-lock.json']) report.source_hashes[file] = hash(await readFile(file));
for (const file of (await readdir('supabase/migrations')).filter(name => name.endsWith('.sql')).sort()) report.source_hashes['supabase/migrations/' + file] = hash(await readFile('supabase/migrations/' + file));
for (const file of ['supabase/functions/mobile-health-beta/manual-training-local.ts','supabase/functions/mobile-health-beta/local-manual-bootstrap.ts','supabase/functions/mobile-health-beta/manual-web-identity.ts','supabase/functions/mobile-health-beta/bounded-auth-fetch.ts','scripts/exercise-release-gates.mjs','scripts/check-manual-web-revocation.ts']) report.source_hashes[file]=hash(await readFile(file));
report.source_hashes['supabase/functions/mobile-health-beta/manual-daily-read.ts']=hash(await readFile('supabase/functions/mobile-health-beta/manual-daily-read.ts'));
report.source_hashes['scripts/web-view-state.js']=hash(await readFile('scripts/web-view-state.js'));
report.source_hashes['scripts/manual-ux-browser-gates.mjs']=hash(await readFile('scripts/manual-ux-browser-gates.mjs'));
report.source_hashes['scripts/manual-observation-browser-gates.mjs']=hash(await readFile('scripts/manual-observation-browser-gates.mjs'));
for(const file of ['scripts/manual-observation-web.js','scripts/manual-observation-pg-gates.mjs','supabase/functions/mobile-health-beta/manual-observations-local.ts','supabase/functions/mobile-health-beta/manual-observation-projection.ts','supabase/functions/mobile-health-beta/score-bridge.ts'])report.source_hashes[file]=hash(await readFile(file));
report.command += releaseExercise ? ' --release-exercise' : '';
report.command += releaseA ? ' --release-a' : '';
report.handler_path='existing mobile-health-beta default.fetch -> @supabase/server middleware -> signed local authority -> canonical PostgreSQL mapping -> real SQL/portable engine; NOT actual Edge';
if(actualEdge){
 report.command+=' --edge-container';report.runtime_classification='OFFICIAL_SUPABASE_EDGE_USER_ISOLATE_NATIVE_PG17_SYNTHETIC_SIGNED_AUTH';
 report.handler_path='Existing Web -> local transport-only proxy -> official Supabase Edge user isolate -> real default.fetch/SDK/local bootstrap -> actual signed session verifier -> canonical PostgreSQL17 -> real engine';
 report.cli_stack='NOT_RUN_IN_THIS_MODE';
 report.source_hashes['scripts/local-edge-container.mjs']=hash(await readFile('scripts/local-edge-container.mjs'));
}
const record = (step, detail = {}) => { report.steps.push({ step, at: now(), ...detail }); console.log('PASS ' + step); };
async function gate(name, fn) {
  const started = now();
  try { await fn(); report.gates.push({ name, status: 'PASS', started_at: started, ended_at: now() }); }
  catch (error) { report.gates.push({ name, status: 'FAIL', started_at: started, ended_at: now(), error: redact(error.stack || error.message) }); report.errors.push(name); console.error('FAIL ' + name + ': ' + error.message); if (page && !page.isClosed()) await page.screenshot({ path: path.join(evidence, name + '-failure.png'), fullPage: true }).catch(() => {}); }
  await writeFile(path.join(evidence,'checkpoint-report.json'),redact(JSON.stringify(report,null,2)));
  // Each gate starts fresh contexts. Retain traces, then release their renderer
  // memory rather than accumulating every full application until the suite ends.
  for(const entry of contexts)await retainContext(entry);
}
async function portFree(port) { await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', () => reject(Error('PORT_ALREADY_IN_USE_' + port))); probe.listen(port, '127.0.0.1', () => probe.close(resolve)); }); }
async function until(fn, description, timeout = 20000) { const deadline = Date.now() + timeout; let value; while (Date.now() < deadline) { value = await fn(); if (value) return value; await sleep(100); } throw Error('BOUNDED_WAIT_FAILED_' + description); }
let pg, child, browser, page, context, edge;
const contexts = [], responsePromises = new Set(); let stdout = '', stderr = '';
async function retainContext(entry){
  if(entry.retained)return;entry.retained=true;
  try{
    const raw=path.join(privateDir,entry.name+'-raw.zip');await entry.context.tracing.stop({path:raw});
    const zip=await JSZip.loadAsync(await readFile(raw));
    for(const [name,member]of Object.entries(zip.files))if(!member.dir&&/\.(trace|network|json)$/.test(name))zip.file(name,redact(await member.async('string')));
    await writeFile(path.join(evidence,entry.name+'-trace.zip'),await zip.generateAsync({type:'nodebuffer'}));
  }catch(error){report.errors.push('TRACE_RETAIN_OR_REDACT_FAILED: '+error.message);}
  finally{await entry.context.close().catch(()=>{});}
}
const http = async (cookie, action, payload = {}) => {
  const start = now(), response = await fetch(base + '/v1/engine/web', { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ action, payload }), signal: AbortSignal.timeout(30000) });
  const body = await response.json(); report.http.push({ transport: 'DIRECT_HTTP_TEST', action, payload, http_status: response.status, response: body, started_at: start, ended_at: now() }); return { http_status: response.status, ...body };
};
async function loginCookie(account, extra = {}) { const res = await fetch(base + '/local-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account,...(nonprivileged?{kind:'web'}:{}), ...extra }), signal: AbortSignal.timeout(10000) }); assert.equal(res.status, 200); return res.headers.get('set-cookie').split(';')[0]; }
async function bodyRows() { return await pg.admin`select canonical_user_id,record_id,revision,local_date,deleted,body from public.engine_manual_body_records order by local_date,record_id`; }
async function meals() { return await pg.admin`select canonical_user_id,meal_id,revision,deleted,local_date,body from public.engine_meals order by meal_id`; }
async function nutritionHead(date, user = subjects.A.canonical) {
  return (await pg.admin`select h.output_kind,h.engine_version,h.score,h.score_status,h.payload,h.input_fingerprint from public.engine_output_heads p join public.engine_output_history h using(canonical_user_id,calculation_date,output_kind,engine_version,input_fingerprint) where h.canonical_user_id=${user} and h.calculation_date=${date} and h.output_kind='nutrition'`)[0];
}
async function browserContext(account,{preservePrevious=false}={}) {
  if(!preservePrevious)for(const entry of contexts)await retainContext(entry);
  if(nonprivileged&&['A','B'].includes(account))account='WEB_'+account;
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, timezoneId: 'Asia/Taipei', locale: 'zh-TW' });
  const entry = { context: ctx, name: account + '-' + contexts.length }; contexts.push(entry);
  const registerRoute=ctx.route.bind(ctx);
  ctx.route=(pattern,handler,options)=>registerRoute(pattern,async(...args)=>{
    try{return await handler(...args);}catch(error){
      report.errors.push('ROUTE_ASSERTION: '+redact(error.stack||String(error)));
      await args[0].abort('failed').catch(()=>{});
    }
  },options);
  await ctx.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === base || ['data:', 'blob:'].includes(url.protocol)) return route.continue(); report.blocked_external_requests.push(url.origin + url.pathname); return route.abort('blockedbyclient'); });
  await ctx.tracing.start({ screenshots: true, snapshots: true, sources: false });
  // Matches the existing 30s HTTP deadline plus 2s for rendering. This is a
  // harness wait, not a relaxed SQL/engine bound or a production latency SLA.
  const p = await ctx.newPage(); p.setDefaultTimeout(32000);
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
  await p.waitForFunction(() => document.getElementById('weight-form')?.dataset.lookupState === 'ready' && !document.getElementById('weight-save')?.disabled);
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
  const pgPort=process.env.LOCAL_ENGINE_PG_MAJOR==='17'?57485:57483;
  await portFree(57841); await portFree(pgPort);
  console.log('START dedicated PostgreSQL initialization ' + now());
  pg = await createLocalPostgres({ port: pgPort,release:releaseA?'A':'AB' }); report.database = pg.evidence;
  if(nonprivileged){await pg.admin.unsafe('alter role health_manual_api login');report.runtime_role='health_manual_api_NO_MEMBERSHIP_NO_BYPASSRLS';report.command+=' --nonprivileged';
   for(const name of ['A','B'])await pg.admin`insert into private.beta_web_identity_aliases(web_subject_hash,verified_email_hash,canonical_user_id) values(${hash('web-session-'+subjects[name].auth)},${hash(name.toLowerCase()+'@example.invalid')},${subjects[name].canonical})`;
  }
  console.log('READY dedicated PostgreSQL ' + now());
  assert.equal(pg.config.host, '127.0.0.1'); assert.match(pg.config.database, /^health_engine_[a-f0-9]{32}$/);
  const config = path.join(evidence, 'runtime-config.json'); await writeFile(config, JSON.stringify(pg.config));
  const childEnv = { ...process.env, HEALTH_ENGINE_LOCAL_ONLY: '1' }; delete childEnv.ALGORITHM_PYTHON;
  childEnv.HEALTH_EXERCISE_MANAGEMENT_LOCAL=releaseExercise?'1':'0';
  childEnv.HEALTH_MANUAL_WEB_SESSION_LOCAL=(releaseExercise||releaseA)?'1':'0';
  if(actualEdge){
   await portFree(57842);await portFree(57921);
   edge=await(await import('./local-edge-container.mjs')).prepareEdgeTest(evidence,privateDir,pg.config,releaseExercise,nonprivileged);
   childEnv.HEALTH_TEST_ACTUAL_EDGE_PROXY=edge.proxy;childEnv.HEALTH_TEST_TLS_CONFIG=edge.tlsConfig;
   report.actual_edge=edge.metadata;
  }
  const denoExecutable = process.env.DENO_EXECUTABLE || 'deno';
  const runtimeArgs = ['run', '--cached-only', '--frozen-lockfile', '--node-modules-dir=none', '--config', 'config/engine-local.deno.json', '--allow-env', '--allow-read', '--allow-sys', '--allow-net=127.0.0.1', 'scripts/local-engine-server.ts', config];
  report.tools.deno = execFileSync(denoExecutable, ['--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true, env: childEnv }).trim();
  report.runtime_command = [denoExecutable, ...runtimeArgs];
  child = spawn(denoExecutable, runtimeArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: childEnv });
  child.stdout.on('data', data => { stdout += redact(data); }); child.stderr.on('data', data => { stderr += redact(data); });
  await until(async () => { if (child.exitCode !== null) throw Error('LOCAL_HOST_EXIT_' + child.exitCode); try { return (await fetch(base + '/local-health', { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } }, 'host-health', 15000);
  if(edge){
   edge.start();
   await until(async()=>{try{return(await fetch('http://127.0.0.1:57921/_health',{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},'actual-edge-health',30000);
   const boundary=await http(null,'getDashboardData',{});assert.equal(boundary.http_status,401,'Actual product handler must deny anonymous before browser E2E');
  }
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
    await page.waitForFunction(() => document.getElementById('body-current-note').dataset.analysisStatus === 'INSUFFICIENT_DATA');
    await page.screenshot({ path: path.join(evidence, 'body-created.png'), fullPage: true }); record('Body actual UI create persists once with null bodyFat and INSUFFICIENT_DATA; lost real response recovered automatically by stored receipt', { row: created });
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
    const tomorrow=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date(Date.now()+86400000));
    for (const payload of [{ date: '2026-02-30', weight: 70 }, { date: tomorrow, weight: 70 }, { date, weight: 70, bodyFat: -1 }, { date, weight: 70, bodyFat: 101 }]) assert.equal((await http(a, 'upsertBodyRecord', { ...payload, clientRequestId: randomUUID() })).ok, false);
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
    ({ context, page } = await browserContext('A')); await customRange(page, date, date); await page.locator('.mobile-nav-btn[data-screen="records-center"]').click(); await page.locator('#add-meal').click();
    await page.locator('#meal-date').fill(date); await page.locator('#meal-food').fill(food); await page.locator('#meal-time').fill('12:00'); await page.locator('#meal-label-details').evaluate(node => { node.open = true; }); await page.locator('#meal-label-mode').check(); await page.locator('#meal-weight-grams').fill('150'); await page.locator('#meal-reference-source').fill('SYNTHETIC LABEL v1; arithmetic only');
    for (const [name, value] of Object.entries({ calories: 200, protein: 10, carbs: 20, fat: 5 })) await page.locator('#meal-' + name).fill(String(value));
    await page.locator('#meal-review-confirmed').check();
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
    await page.reload(); await page.locator('.mobile-nav-btn[data-screen="records-center"]').click(); await page.locator(`[data-meal-record-id="${id}"]`).waitFor(); await page.locator(`[data-meal-record-id="${id}"]`).click(); assert.equal(await page.locator('#meal-weight-grams').inputValue(), '150'); assert.equal(await page.locator('#meal-calories').inputValue(), '200');
    await page.locator('#meal-weight-grams').fill('200'); await page.locator('#meal-save').click(); await page.locator('#meal-form').waitFor({ state: 'hidden' }); await until(async () => { row = (await meals()).find(r => r.meal_id === id); return Number(row.revision) === 2 && row.body.calories === 400; }, 'historical-meal-updated');
    const updatedHead = await until(async () => { const head = await nutritionHead(date); return head?.payload?.metrics?.totals?.calories === 400 ? head : false; }, 'updated-engine-aggregate'); assert.equal(Number(updatedHead.score), 23.5); assert.notEqual(updatedHead.input_fingerprint, createdHead.input_fingerprint);
    ({ context, page } = await browserContext('A')); await customRange(page, date, date); await page.locator('.mobile-nav-btn[data-screen="records-center"]').click(); await page.locator(`[data-meal-record-id="${id}"]`).waitFor();
    assert.equal(await page.evaluate(id => appState.mealsToday.some(r => r.mealRecordId === id), id), false, 'historical meal must never contaminate today list');
    record('Historical meal replay is idempotent; updated aggregate and new-context login re-read actual SQL');
    await page.locator(`[data-meal-record-id="${id}"]`).click(); const before = await meals(); await expectedDialog(page, 'meal', 'dismiss', id); assert.deepEqual(await meals(), before); record('Historical meal update and cancel-delete preserve versioned SQL values');
    await expectedDialog(page, 'meal', 'accept', id); await page.locator('#meal-form').waitFor({ state: 'hidden' }); await until(async () => (await meals()).find(r => r.meal_id === id).deleted, 'historical-meal-tombstone');
    const deletedHead = await until(async () => { const head = await nutritionHead(date); return head?.score === null && head?.score_status === 'INSUFFICIENT_DATA' ? head : false; }, 'deleted-engine-null-head');
    assert.equal(deletedHead.payload.metrics.meal_count, null); assert.ok(Object.values(deletedHead.payload.metrics.totals).every(value => value === null));
    const frozen = await pg.admin`select score,algorithm_version from public.beta_health_scores where canonical_user_id=${subjects.A.canonical} and score_date=${date} and score_type='nutrition'`; assert.ok(frozen.every(r => r.score === null && r.algorithm_version === 'health-score-v1.0'));
    report.nutrition_engine_assertions = { created: createdHead, updated: updatedHead, deleted: deletedHead, original_frozen_nutrition_unchanged: frozen };
    await page.reload(); await page.locator('.mobile-nav-btn[data-screen="records-center"]').click(); assert.equal(await page.locator(`[data-meal-record-id="${id}"]`).count(), 0); assert.equal((await http(a, 'getNutritionRecords', { startDate: date, endDate: date })).data.length, 0);
    ({ context, page } = await browserContext('B')); await customRange(page, date, date); await page.locator('.mobile-nav-btn[data-screen="records-center"]').click(); assert.equal(await page.locator('[data-meal-record-id]').count(), 0);
    await page.screenshot({ path: path.join(evidence, 'historical-nutrition-deleted-B-isolation.png'), fullPage: true }); record('Historical meal confirmed delete/reload/B isolation; missing data not fabricated');
  });
  await gate('browser_incomplete_meal_null_zero_decimal_sql_readback',async()=>{
    const date=shift(-39),cookie=await loginCookie('A');
    ({context,page}=await browserContext('A'));await customRange(page,date,date);await page.locator('.mobile-nav-btn[data-screen="records-center"]').click();
    for(const [label,calories,protein]of[['UNKNOWN',null,null],['EXPLICIT ZERO',0,12.5]]){
      const food='SYNTHETIC '+label+' '+runId.slice(0,8);await page.locator('#add-meal').click();await page.locator('#meal-date').fill(date);await page.locator('#meal-food').fill(food);
      if(calories!==null)await page.locator('#meal-calories').fill(String(calories));if(protein!==null)await page.locator('#meal-protein').fill(String(protein));
      await page.locator('#meal-review-confirmed').check();
      await page.locator('#meal-save').click();await page.locator('#meal-form').waitFor({state:'hidden'});
      const row=await until(async()=> (await meals()).find(r=>r.body.foodName===food),'incomplete meal persisted');
      assert.equal(row.body.calories,calories);assert.equal(row.body.protein,protein);assert.equal(row.body.carbs,null);assert.equal(row.body.fat,null);
      const read=(await http(cookie,'getNutritionRecords',{startDate:date,endDate:date})).data.find(r=>r.mealRecordId===row.meal_id);assert.equal(read.calories,calories);assert.equal(read.includedInTotals,false);
      const write=await until(async()=>report.http.find(r=>r.transport==='BROWSER_ACTUAL_HTTP'&&r.action==='upsertMealRecord'&&r.payload.foodName===food),'null/zero browser request');assert.equal(write.payload.calories,calories);
      await page.reload();await page.locator('.mobile-nav-btn[data-screen="records-center"]').click();await page.locator(`[data-meal-record-id="${row.meal_id}"]`).click();assert.equal(await page.locator('#meal-calories').inputValue(),calories===null?'':String(calories));
      await expectedDialog(page,'meal','accept',row.meal_id);await page.locator('#meal-form').waitFor({state:'hidden'});assert.equal((await meals()).find(r=>r.meal_id===row.meal_id).deleted,true);
    }
    record('Actual original form preserves name-only unknown kcal=null, explicit0 and12.5g; SQL/read/reload agree, incomplete excluded from totals');
  });
  if(releaseA)await gate('release_A_no_exercise_schema_web_session_readback',async()=>{
    for(const table of ['manual_exercise_catalog','manual_exercise_preferences','manual_workout_sets'])assert.equal((await pg.admin`select to_regclass(${'public.'+table}) as object`)[0].object,null);
    for(const [name,user]of Object.entries(subjects).filter(([name])=>['A','B'].includes(name)))await pg.admin`insert into private.beta_web_identity_aliases(web_subject_hash,verified_email_hash,canonical_user_id) values(${hash('web-session-'+user.auth)},${hash(name.toLowerCase()+'@example.invalid')},${user.canonical})`;
    const a=await loginCookie('A',{kind:'web'}),b=await loginCookie('B',{kind:'web'}),date=shift(-3);
    const saved=await http(a,'upsertBodyRecord',{date,weight:84,clientRequestId:randomUUID()});assert.equal(saved.ok,true);
    for(const action of ['getExerciseDatabase','getExerciseBodyParts','getWorkoutRecords','manageExercise','addWorkoutRecord','updateWorkoutSet','deleteWorkoutSet','getTrainingWriteStatus'])assert.equal((await http(a,action)).error,'EXERCISE_MANAGEMENT_DISABLED');
    assert.equal((await http(a,'refreshDerivedData',{recordType:'workout'})).error,'EXERCISE_MANAGEMENT_DISABLED');
    ({context,page}=await browserContext('web_a'));await bodyScreen(page);await weightEditor(page,date);assert.equal(await page.locator('#weight-input').inputValue(),'84');assert.equal(await page.locator('#exercise-management').count(),0);
    assert.equal((await http(b,'getBodyRecords',{date})).data.length,0);
    ({context,page}=await browserContext('web_b'));await bodyScreen(page);await weightEditor(page,date);assert.equal(await page.locator('#weight-input').inputValue(),'');
    report.release_A_independence={exercise_tables:'ABSENT',exercise_actions:'DENIED_BEFORE_SQL',body_meal_browser:'PASS',verified_web_session_new_context:'PASS_SYNTHETIC_NOT_OAUTH'};
  });
  if(releaseExercise)await (await import('./exercise-release-gates.mjs')).runExerciseReleaseGates({pg,subjects,gate,http,loginCookie,browserContext,until,record,evidence,day,shift,base,report,customRange,weightEditor,bodyScreen,setPage:value=>{page=value;}});
  await gate('runtime_source_UI_separates_API_SQL_data_and_analysis',async()=>{
    const {page:p}=await browserContext(releaseExercise||releaseA?'WEB_A':'A');page=p;await p.setViewportSize({width:1280,height:900});
    await p.evaluate(()=>localEngineRequest('getBodyRecords',{}));
    await p.locator('.side-btn[data-screen="settings-screen"]').click();
    assert.equal(await p.locator('#data-connection-state').getAttribute('data-state'),'CONNECTED');
    assert.equal(await p.locator('#technical-database-status').getAttribute('data-state'),'CONNECTED');
    assert.match(await p.locator('#data-storage-provider').textContent(),/本機測試資料庫/);
    assert.equal(await p.locator('#data-last-updated').getAttribute('data-state'),'OBSERVED');
    assert.match(await p.locator('#data-last-updated').textContent(),/最近 SQL 讀寫確認/);
    // Observe this real rejected request atomically. Independent bootstrap SQL
    // reads may legitimately reconnect between separate Playwright round trips.
    // Retain the response and DOM state together, without suppressing real reads.
    const rejected=await p.evaluate(async()=>{try{await localEngineRequest('getBodyRecords',{date:'not-a-date'});return null;}catch(e){return {error:e.code,api:document.getElementById('data-connection-state').dataset.state,database:document.getElementById('technical-database-status').dataset.state,text:document.getElementById('data-connection-state').textContent,at:new Date().toISOString()};}});
    assert.equal(rejected.error,'INVALID_DATE');assert.equal(rejected.api,'CONNECTED');assert.equal(rejected.database,'UNKNOWN');assert.match(rejected.text,/資料庫尚未確認/);
    report.invalid_request_source_state=rejected;
    await p.evaluate(()=>localEngineRequest('localEngineSnapshot',{}));
    assert.equal(await p.locator('#technical-database-status').getAttribute('data-state'),'CONNECTED');
    assert.notEqual(await p.locator('#data-analysis-state').getAttribute('data-state'),'UPDATING');
    await p.screenshot({path:path.join(evidence,'runtime-source-status.png')});
    report.source_status={actual_API_and_SQL:true,HTTP200_alone_does_not_prove_database:true,last_update_kind:'client_observed_SQL_read_write_not_server_modified_at',analysis_scope:'returned_domains_only'};
  });
  await gate('existing_sleep_activity_SQL_reads_preserve_null_zero_stale_and_account_scope',async()=>{
    const date=shift(-1),account=releaseA||releaseExercise?'WEB_A':'A',other=releaseA||releaseExercise?'WEB_B':'B';
    for(const [domain,unit,value] of [['sleep','minute',480],['steps','count',0],['workout','minute',30]]){
      const id='browser-daily-'+domain,canonical={schema_version:'hdl-v2.health-ingestion.v1',canonical_user_id:subjects.A.canonical,platform:'android',domain,source_app:'synthetic-non-device',source_record_id:id,recorded_at:date+'T01:00:00+08:00',timezone:'Asia/Taipei',local_date:date,value,unit,...(domain==='sleep'?{started_at:shift(-2)+'T23:00:00+08:00',ended_at:date+'T07:00:00+08:00'}:{})},fingerprint=hash(JSON.stringify(canonical));
      await pg.admin`select public.beta_ingest_health_mutation(${subjects.A.canonical},'android',${domain},'synthetic-non-device',${id},1,${now()},${fingerprint},'UPSERT',${fingerprint},${pg.admin.json(canonical)},array[${date}::date])`;
    }
    const cookie=await loginCookie('A',account.startsWith('WEB')?{kind:'web'}:{});assert.equal((await http(cookie,'refreshDerivedData',{recordType:'nutrition',date})).ok,true);
    const visit=async(who,section,beforeRead=null)=>{
      ({context,page}=await browserContext(who));await page.setViewportSize({width:1280,height:900});await customRange(page,date,date);
      if(beforeRead)await beforeRead();
      const action=section==='sleep'?'getSleepRecords':'getActivityRecords';
      const response=page.waitForResponse(r=>r.url().endsWith('/v1/engine/web')&&r.request().postDataJSON()?.action===action);
      await page.locator(`.side-btn[data-screen="${section}-screen"]`).click();const result=await(await response).json();assert.equal(result.ok,true);return result.data;
    };
    const sleep=await visit(account,'sleep');assert.equal(sleep[0].totalSleepMinutes,480);assert.equal(sleep[0].sleepScore,null);
    await until(async()=>/8/.test(await page.locator('#sleep-last').textContent()),'sleep-value');assert.match(await page.locator('#sleep-score-note').textContent(),/不替換為實驗分數/);
    const activity=await visit(account,'activity');assert.equal(activity[0].steps,0);assert.equal(activity[0].activeMinutes,null);assert.equal(activity[0].activeCalories,null);assert.equal(activity[0].totalCalories,null);
    await until(async()=>await page.locator('#activity-steps').textContent()==='0','activity-zero');await page.screenshot({path:path.join(evidence,'sql-daily-activity.png')});
    assert.ok((await visit(other,'sleep')).every(r=>r.totalSleepMinutes===null));assert.notEqual(await page.locator('#sleep-last').textContent(),'8 hr');
    const stale=await visit(account,'activity',()=>pg.admin`update private.beta_score_recompute_queue set engine_published_generation=0 where canonical_user_id=${subjects.A.canonical} and score_date=${date}`);assert.equal(stale[0].dataStatus,'CURRENT');assert.equal(stale[0].analysisDataStatus,'STALE');assert.equal(stale[0].analysisStaleReason,'PUBLICATION_GENERATION_NOT_VERIFIED');assert.equal(stale[0].steps,0);assert.equal(stale[0].source,'SQL_CANONICAL_AUTOMATIC_FALLBACK');
    await until(async()=>/自動／分析資料待更新/.test(await page.locator('#activity-steps-note').textContent()),'stale-notice');
    report.daily_read={seed:'SYNTHETIC_NATIVE_CONTRACT_NOT_DEVICE_DATA',real_SQL_and_published_engine:true,new_browser_contexts:true,legacy_sleep_score_mapping:'NOT_CONNECTED',energy_active_total_mapping:'NOT_CONNECTED',raw_canonical_values:'PRESERVED_WHILE_ANALYSIS_STALE'};
  });
  if(releaseExercise)await (await import('./manual-ux-browser-gates.mjs')).runManualUxGates({pg,subjects,gate,http,loginCookie,browserContext,until,record,evidence,day,shift,base,report,customRange,weightEditor,bodyScreen,setPage:value=>{page=value;}});
  await (await import('./manual-observation-pg-gates.mjs')).runManualObservationPgGates({pg,subjects,gate,http,loginCookie,day,shift,until,report});
  await (await import('./manual-observation-browser-gates.mjs')).runManualObservationBrowserGates({pg,subjects,gate,http,loginCookie,browserContext,until,evidence,day,shift,base,report,customRange,setPage:value=>{page=value;}});
  await gate('critical_profile_dashboard_and_explicit_deferred_UI',async()=>{
    const who='A',cookie=await loginCookie(who);
    for(const action of ['getCurrentUser','getUserProfile','getDashboardData','getTodaySummary','getHealthTimeline']){
      const r=await http(cookie,action,{date:day});assert.equal(r.ok,true,action+JSON.stringify(r));
      if(action==='getUserProfile'){assert.equal(r.data.userId,subjects.A.canonical);assert.equal(r.data.profileDetails,null);}
    }
    ({context,page}=await browserContext(who));await page.setViewportSize({width:1280,height:900});
    await page.locator('.side-btn[data-screen="report-screen"]').click();
    await until(async()=>/週報尚未啟用/.test(await page.locator('#report-screen-read-state').textContent()),'deferred-report');
    await page.evaluate(()=>openCheckinEditor());assert.equal(await page.locator('#checkin-save').isDisabled(),true);
    assert.match(await page.locator('#checkin-date-note').textContent(),/尚未啟用/);
    await page.screenshot({path:path.join(evidence,'explicit-deferred-checkin.png')});await page.evaluate(()=>closeSheet());
    const unavailable=await http(cookie,'upsertHealthCheckin',{date:day});assert.equal(unavailable.ok,false);
  });
  assert.deepEqual(report.page_errors, []); assert.deepEqual(report.blocked_external_requests, []);
} catch (error) { report.errors.push(redact(error.stack || error.message)); }
finally {
  await Promise.allSettled([...responsePromises]);
  for (const entry of contexts) await retainContext(entry);
  if (browser) await browser.close();
  if (child && child.exitCode === null) { if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); else child.kill('SIGTERM'); }
  if(edge)try{report.edge_cleanup=await edge.close();if(report.edge_cleanup.resourceErrors.length)report.errors.push('ACTUAL_EDGE_RESOURCE_OR_BOOT_FAILURE');}catch(error){report.errors.push('EDGE_CLEANUP_FAILED: '+error.message);}
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
