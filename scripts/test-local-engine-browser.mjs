// Reproducible Browser E2E against the existing application, real runtime and a NEW native PG cluster.
// Requires an already installed Playwright module and browser. Does not install, deploy or contact remote APIs.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import net from 'node:net';
import { createLocalPostgres, subjects } from './local-engine-postgres.mjs';

const base = 'http://127.0.0.1:57841';
const runName = process.env.ENGINE_BROWSER_RUN_LABEL || 'ts-deno';
assert.match(runName, /^[a-z0-9-]+$/);
const artifactDir = path.resolve('.engine-artifacts/blocker-closure/browser-' + runName + '-' + randomUUID());
await mkdir(artifactDir, { recursive: true });
const modulePath = process.env.ENGINE_PLAYWRIGHT_MODULE;
const browserPath = process.env.ENGINE_BROWSER_EXECUTABLE;
assert.ok(modulePath && path.isAbsolute(modulePath), 'Set ENGINE_PLAYWRIGHT_MODULE to an installed Playwright module');
assert.ok(browserPath && path.isAbsolute(browserPath), 'Set ENGINE_BROWSER_EXECUTABLE to an installed browser');
const { chromium } = await import(pathToFileURL(modulePath).href);
const requireInstalled = createRequire(modulePath);
const JSZip = requireInstalled('jszip');
const report = {
  source_revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  working_tree: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim(),
  command: 'node scripts/test-local-engine-browser.mjs', started_at: new Date().toISOString(),
  run_label: runName, runtime_classification: 'LOCAL_DENO_PORTABLE_TS_NOT_SUPABASE_EDGE',
  subprocess_permission: 'DENIED_BY_DENO_NO_ALLOW_RUN', target_engine: 'PortableEngineRuntime; Python reference/test only',
  playwright_version: requireInstalled('playwright/package.json').version,
  node: process.version, browser_executable: browserPath, synthetic_only: true,
  api_mocking: false, engine_mocking: false, persistence_mocking: false,
  identity: 'Verified ES256 synthetic issuer -> existing canonical mapping; NOT Google OAuth',
  steps: [], console: [], http: [], page_errors: [], blocked_external_requests: [], dialogs: [], source_hashes: {},
};
for (const filename of ['index.html', 'scripts/local-engine-web.js', 'scripts/local-engine-server.ts', 'supabase/functions/mobile-health-beta/local-engine-runtime.ts', 'supabase/functions/mobile-health-beta/engine-portable.ts']) {
  report.source_hashes[filename] = createHash('sha256').update(await readFile(filename)).digest('hex');
}
const redact = text => String(text).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_SYNTHETIC_SESSION_JWT]');
const record = (step, details = {}) => { report.steps.push({ step, status: 'PASS', at: new Date().toISOString(), ...details }); console.log('PASS ' + step); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(Error('PORT_ALREADY_IN_USE_' + port)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}
let pg, child, browser, context, page;
let stdout = '', stderr = '';
const pendingResponses = new Set();
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const food = 'Browser 合成標示餐點 ' + randomUUID().slice(0, 8);
async function persisted() {
  return await pg.admin`select canonical_user_id,meal_id,revision,deleted,local_date,body from public.engine_meals order by meal_id`;
}
async function currentOutputs(user = subjects.A.canonical) {
  return await pg.admin`select h.output_kind,h.engine_version,h.score,h.score_status,h.data_completeness,h.input_fingerprint,h.payload
    from public.engine_output_heads p join public.engine_output_history h using(canonical_user_id,calculation_date,output_kind,engine_version,input_fingerprint)
    where h.canonical_user_id=${user} and h.calculation_date=${day} order by h.output_kind`;
}
async function screenshot(name) { await page.screenshot({ path: path.join(artifactDir, name + '.png'), fullPage: true }); }
async function ready() { await page.locator('#local-engine-output[data-state="ready"]').waitFor({ timeout: 20000 }); }
async function nutritionScore(expected) {
  await page.waitForFunction(score => document.querySelector('#local-engine-output [data-domain="nutrition"]')?.dataset.score === score, String(expected), { timeout: 20000 });
  const text = await page.locator('#local-engine-output [data-domain="nutrition"]').innerText();
  assert.ok(!text.includes('8500%'));
  return text;
}
async function deleteDialog(action, diagnose = false) {
  assert.equal(await page.locator('#meal-food').inputValue(), food);
  const targetId = await page.locator('#meal-record-id').inputValue();
  assert.ok((await persisted()).some(row => row.meal_id === targetId && row.body.foodName === food));
  let clickSettled = false;
  const observed = new Promise(resolve => page.once('dialog', resolve));
  const click = page.locator('#meal-delete').click({ timeout: 10000 }).finally(() => { clickSettled = true; });
  const dialog = await Promise.race([observed, sleep(5000).then(() => { throw Error('EXPECTED_CONFIRM_NOT_OBSERVED'); })]);
  assert.equal(dialog.type(), 'confirm');
  assert.equal(dialog.message(), '確定刪除此筆餐點？此動作無法復原。');
  if (diagnose) {
    await sleep(150);
    report.dialog_root_cause_probe = { kind: 'NATIVE_CONFIRM', expected_message: dialog.message(), click_pending_before_handling: !clickSettled, bounded_hold_ms: 150 };
    assert.equal(clickSettled, false, 'Native confirm blocks completion until handled');
  }
  report.dialogs.push({ type: dialog.type(), message: dialog.message(), action, target_meal_id: targetId, at: new Date().toISOString(), listener: 'once registered before click' });
  await dialog[action]();
  await click;
}
try {
  await assertPortFree(57841); await assertPortFree(57483);
  pg = await createLocalPostgres({ port: 57483 });
  report.database = pg.evidence;
  const config = path.join(artifactDir, 'runtime-config.json');
  await writeFile(config, JSON.stringify(pg.config));
  assert.equal((await persisted()).length, 0, 'New dedicated database must have no meal data');
  const childEnv = { ...process.env, HEALTH_ENGINE_LOCAL_ONLY: '1' };
  delete childEnv.ALGORITHM_PYTHON;
  child = spawn('deno', ['run', '--config', 'config/engine-local.deno.json', '--allow-env', '--allow-read', '--allow-sys', '--allow-net=127.0.0.1', 'scripts/local-engine-server.ts', config], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: childEnv,
  });
  child.stdout.on('data', chunk => { stdout += redact(chunk); }); child.stderr.on('data', chunk => { stderr += redact(chunk); });
  let healthy = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null) throw Error('LOCAL_HOST_EXIT_' + child.exitCode + ': ' + stderr);
    try { const response = await fetch(base + '/local-health', { signal: AbortSignal.timeout(1000) }); if (response.ok) { healthy = true; break; } } catch {}
    await sleep(250);
  }
  assert.ok(healthy, 'Bounded local host health check');
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
  report.browser_version = browser.version();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Taipei', locale: 'zh-TW' });
  // External requests are refused, never fulfilled with mocked responses. Local requests are untouched.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === base || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    report.blocked_external_requests.push(url.origin + url.pathname); return route.abort('blockedbyclient');
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('console', entry => report.console.push({ type: entry.type(), text: redact(entry.text()), at: new Date().toISOString() }));
  page.on('pageerror', error => report.page_errors.push(redact(error.stack || error.message)));
  page.on('response', response => {
    const req = response.request();
    if (new URL(response.url()).pathname !== '/v1/engine/web') return;
    const pending = (async () => {
      let body; try { body = await response.json(); } catch { body = { unparsed: true }; }
      report.http.push({ at: new Date().toISOString(), action: req.postDataJSON()?.action, payload: req.postDataJSON()?.payload, status: response.status(), response: body, timing: req.timing() });
    })();
    pendingResponses.add(pending); pending.finally(() => pendingResponses.delete(pending));
  });
  await page.goto(base); await page.locator('#local-login-a').click();
  await page.locator('#local-engine-login').waitFor({ state: 'detached' });
  await page.locator('.side-btn[data-screen="nutrition-screen"]').click(); await ready();
  assert.equal((await persisted()).length, 0); record('A enters existing Web with real verified local identity');
  await page.locator('#add-meal').click();
  await page.locator('#meal-label-mode').check(); await page.locator('#meal-weight-grams').fill('150');
  await page.locator('#meal-food').fill(food); await page.locator('#meal-time').fill('12:00');
  for (const [key, value] of Object.entries({ calories: 200, protein: 10, carbs: 20, fat: 5 })) await page.locator('#meal-' + key).fill(String(value));
  assert.equal(await page.locator('#chatgpt-meal-box').isVisible(), false);
  const errorResponse = page.waitForResponse(res => res.url().endsWith('/v1/engine/web') && res.request().postDataJSON()?.action === 'upsertMealRecord');
  await page.locator('#meal-save').click();
  const errorBody = await (await errorResponse).json(); assert.equal(errorBody.ok, false);
  await page.waitForFunction(() => !document.getElementById('meal-save').disabled);
  assert.equal((await persisted()).length, 0); record('Missing reference is rejected; save loading ends; no partial write', { error: errorBody.error });
  await page.locator('#meal-reference-source').fill('SYNTHETIC LABEL v1; arithmetic only, not a real food reference');
  await page.locator('#meal-save').click({ clickCount: 2 });
  await page.locator('#meal-form').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.getElementById('nutrition-calories').textContent === '300 kcal');
  await nutritionScore('17.6');
  let meals = await persisted(); assert.equal(meals.length, 1); assert.equal(meals[0].body.calories, 300); assert.equal(meals[0].body.protein, 15);
  const mealId = meals[0].meal_id; assert.equal(meals[0].canonical_user_id, subjects.A.canonical);
  record('Create retry and duplicate click persist exactly one 150 g meal', { meal_id: mealId, calories: 300, score: 17.6, outputs: await currentOutputs() }); await screenshot('01-created');
  await page.reload(); await page.locator('.side-btn[data-screen="nutrition-screen"]').click(); await ready();
  assert.equal(await page.locator('#nutrition-calories').innerText(), '300 kcal'); await nutritionScore('17.6'); record('Refresh retains meal and versioned output');
  await page.locator(`[data-meal-record-id="${mealId}"]`).click();
  assert.equal(await page.locator('#meal-calories').inputValue(), '200'); assert.equal(await page.locator('#meal-weight-grams').inputValue(), '150');
  await page.locator('#meal-weight-grams').fill('200'); await page.locator('#meal-save').click();
  await page.locator('#meal-form').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.getElementById('nutrition-calories').textContent === '400 kcal'); await nutritionScore('23.5');
  meals = await persisted(); assert.equal(meals.length, 1); assert.equal(Number(meals[0].revision), 2); assert.equal(meals[0].body.calories, 400);
  const beforeDelete = await currentOutputs(); record('Update 200 g persists 400 kcal and recalculates score', { outputs: beforeDelete }); await screenshot('02-updated');
  await page.locator(`[data-meal-record-id="${mealId}"]`).click();
  const deleteCallsBefore = report.http.filter(r => r.action === 'deleteMealRecord').length;
  await deleteDialog('dismiss', true);
  assert.equal(await page.locator('#meal-form').isVisible(), true); assert.equal(await page.locator('#meal-delete').isEnabled(), true);
  assert.deepEqual(await currentOutputs(), beforeDelete); meals = await persisted(); assert.equal(meals[0].deleted, false); assert.equal(Number(meals[0].revision), 2);
  assert.equal(report.http.filter(r => r.action === 'deleteMealRecord').length, deleteCallsBefore);
  record('Cancel native delete keeps meal and exact effective output unchanged'); await screenshot('03-cancel-keeps-meal');
  await deleteDialog('accept'); await page.locator('#meal-form').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.getElementById('nutrition-calories').textContent === '—');
  const nullText = await nutritionScore('null'); assert.ok(nullText.includes('INSUFFICIENT_DATA')); assert.ok(nullText.includes('資料不足'));
  meals = await persisted(); assert.equal(meals[0].deleted, true); assert.equal(Number(meals[0].revision), 3);
  const afterDelete = await currentOutputs();
  const clearedScores = afterDelete.filter(row => ['nutrition', 'overall'].includes(row.output_kind));
  assert.equal(clearedScores.length, 2);
  assert.ok(clearedScores.every(row => row.score === null && row.score_status === 'INSUFFICIENT_DATA'));
  const clearedNutrition = clearedScores.find(row => row.output_kind === 'nutrition').payload.metrics;
  assert.equal(clearedNutrition.meal_count, null);
  assert.ok(Object.values(clearedNutrition.totals).every(value => value === null));
  record('Confirm native delete tombstones actual DB and replaces old valid score with null', { outputs: afterDelete }); await screenshot('04-deleted-null');
  await page.reload(); await page.locator('.side-btn[data-screen="nutrition-screen"]').click(); await ready(); await nutritionScore('null');
  assert.equal(await page.locator('[data-meal-record-id]').count(), 0); assert.equal(await page.locator('#nutrition-calories').innerText(), '—');
  record('Refresh does not resurrect deleted meal or valid score');
  await page.locator('.side-btn[data-screen="settings-screen"]').click(); await page.locator('#logout-button').click(); await page.locator('#local-login-b').click();
  await page.locator('#local-engine-login').waitFor({ state: 'detached' }); await page.locator('.side-btn[data-screen="nutrition-screen"]').click(); await ready();
  assert.equal(await page.locator('[data-meal-record-id]').count(), 0); assert.equal(await page.locator('#nutrition-calories').innerText(), '—');
  assert.equal(await page.locator('#local-engine-output [data-domain]').count(), 0); assert.equal((await currentOutputs(subjects.B.canonical)).length, 0);
  record('Switch to B exposes neither A meal nor A outputs'); await screenshot('05-B-isolated');
  // Pure display helper checks, explicitly separated from persisted browser flow.
  const formatter = await page.evaluate(() => ({ zero: localEngineOutputText({ domain:'nutrition',score:0,score_status:'VALID',data_completeness:.85,engine_version:'test-display-only' }), missing: localEngineOutputText({ domain:'nutrition',score:null,score_status:'INSUFFICIENT_DATA',data_completeness:0,engine_version:'test-display-only' }) }));
  assert.ok(formatter.zero.includes('nutrition: 0')); assert.ok(formatter.zero.includes('85%')); assert.ok(!formatter.zero.includes('8500%')); assert.ok(formatter.missing.includes('— 資料不足'));
  record('Display helper 0/null and 0.85/85% regression', { scope: 'BROWSER_EXECUTED_PURE_HELPER_NOT_PERSISTED_FIXTURE', formatter });
  assert.deepEqual(report.page_errors, []); assert.deepEqual(report.blocked_external_requests, []);
  report.status = 'PASS'; report.test_cases = 1;
} catch (error) {
  report.status = 'FAIL'; report.error = redact(error.stack || error.message); process.exitCode = 1;
  if (page) { await screenshot('failure').catch(() => {}); report.failure_dom = await page.locator('body').innerText().catch(() => 'unavailable'); }
  console.error(report.error);
} finally {
  await Promise.allSettled([...pendingResponses]);
  if (context) {
    const rawTrace = path.join(artifactDir, 'trace-raw.zip');
    await context.tracing.stop({ path: rawTrace });
    const zip = await JSZip.loadAsync(await readFile(rawTrace));
    for (const [name, entry] of Object.entries(zip.files)) if (!entry.dir && /\.(trace|network|json)$/.test(name)) zip.file(name, redact(await entry.async('string')));
    await writeFile(path.join(artifactDir, 'trace.zip'), await zip.generateAsync({ type: 'nodebuffer' })); await unlink(rawTrace);
    report.trace_redaction = 'Synthetic signed session JWTs redacted from trace/network/JSON; credentials not published';
  }
  if (browser) await browser.close();
  if (child) {
    // taskkill targets only this spawned process tree, never a global browser/node/deno name.
    if (process.platform === 'win32' && child.exitCode === null) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else if (child.exitCode === null) child.kill('SIGTERM');
  }
  if (pg) await pg.close();
  report.ended_at = new Date().toISOString(); report.exit_code = process.exitCode || 0;
  report.cleanup = 'Only this runner browser, Deno process tree and owned native PG stopped; database directory retained';
  await writeFile(path.join(artifactDir, 'server.stdout.log'), stdout); await writeFile(path.join(artifactDir, 'server.stderr.log'), stderr);
  await writeFile(path.join(artifactDir, 'report.json'), redact(JSON.stringify(report, null, 2)));
  console.log(JSON.stringify({ status: report.status, evidence: path.join(artifactDir, 'report.json') }));
}
