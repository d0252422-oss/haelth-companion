// Read-only acceptance for the published Beta Quick Add surface.
// It aborts every non-GET/HEAD browser request and never authenticates.
import assert from 'node:assert/strict';
import {mkdir, readFile, realpath, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {assertExpectedBuild, assertUnauthenticatedBoundary, filterFirstPartyHttpErrors, observeWebAcceptance, safeResource} from './web-acceptance-observer.mjs';

const target = new URL(process.argv[2] || 'https://liff.line.me/2011116657-9SpSnQlN?range=30d');
const local = ['127.0.0.1','localhost'].includes(target.hostname);
const approvedRemote = target.protocol === 'https:' && !target.port && (
  target.hostname === 'liff.line.me' && target.pathname === '/2011116657-9SpSnQlN'
  || target.hostname === 'd0252422-oss.github.io' && target.pathname.startsWith('/health-companion-beta/')
);
assert.ok(local || approvedRemote, 'UNAPPROVED_ACCEPTANCE_TARGET');
const localBuild = JSON.parse(await readFile(new URL('../build.json', import.meta.url), 'utf8')).buildId;
const expectedBuildId = process.env.WEB_EXPECTED_BUILD_ID?.trim() || localBuild;
assertExpectedBuild(expectedBuildId,{liveDeployedBuildId:expectedBuildId,liffLoadedBuildId:expectedBuildId});
const evidence = path.resolve(process.env.QUICK_ADD_EVIDENCE_DIR || 'D:/Dev/Evidence/quick-add-v3-20260920/live');
const evidenceRoot = await realpath('D:/Dev/Evidence');
await mkdir(path.dirname(evidence), {recursive:true});
const evidenceParent = await realpath(path.dirname(evidence));
const evidenceRelative = path.relative(evidenceRoot,evidenceParent);
assert.ok(evidenceRelative !== '..' && !evidenceRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(evidenceRelative), 'EVIDENCE_OUTSIDE_D_ROOT');
await mkdir(evidence, {recursive:true});
const modulePath = process.env.ENGINE_PLAYWRIGHT_MODULE || 'C:/Users/D0252/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const browserPath = process.env.ENGINE_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const {chromium} = await import(pathToFileURL(modulePath).href);
const viewports = [{width:360,height:800},{width:393,height:852},{width:412,height:915}];
const expected = ['新增體重 / 體脂','新增訓練','新增飲食','新增睡眠','新增步數 / 總消耗','新增身體狀態'];
const report = {target: safeResource(target.href), expected_build_id: expectedBuildId, started_at: new Date().toISOString(), classification: 'LIVE_BETA_PUBLIC_HTML_READ_ONLY_VISUAL_NO_AUTH_NO_REMOTE_WRITE', viewports: [], manual_forms: [], blocked_non_read_requests: [], auth_boundaries: [], diagnostics: []};
const browser = await chromium.launch({headless: true, executablePath: browserPath});
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({viewport, locale:'zh-TW', timezoneId:'Asia/Taipei', colorScheme:'dark', serviceWorkers:'block'});
    const page = await context.newPage();
    const observer = observeWebAcceptance(page);
    await page.route('**/*', route => {
      if (['127.0.0.1','localhost'].includes(target.hostname) && new URL(route.request().url()).pathname.endsWith('/scripts/manual-sql-config.js')) {
        return route.fulfill({status:200, contentType:'application/javascript', body:`globalThis.HEALTH_MANUAL_SQL_CONFIG=Object.freeze({enabled:true,release:'AB',schemaVersion:'manual-sql-v1',projectRef:'uavimjgccigpbwqmfkhh',endpoint:'https://uavimjgccigpbwqmfkhh.supabase.co/functions/v1/mobile-health-beta/v1/engine/web'});`});
      }
      const method = route.request().method();
      if (method === 'GET' || method === 'HEAD') return route.continue();
      observer.markExpectedBlock(route.request());
      report.blocked_non_read_requests.push({method, resource: safeResource(route.request().url())});
      return route.abort('blockedbyclient');
    });
    const url = new URL(target);url.searchParams.set('quickAddAudit', `${Date.now()}-${viewport.width}`);
    const response = await page.goto(url.href, {waitUntil:'domcontentloaded', timeout:30000});
    assert.equal(response?.status(), 200);
    await page.waitForFunction(() => typeof globalThis.openSheet === 'function');
    const delivery = await page.evaluate(() => ({
      resolvedResource: `${location.origin}${location.pathname}`,
      expectedBuildId: globalThis.EXPECTED_BUILD_ID || null,
      liveDeployedBuildId: globalThis.LIVE_DEPLOYED_BUILD_ID || null,
      liffLoadedBuildId: globalThis.LIFF_LOADED_BUILD_ID || null,
      entryVersionTokenPresent: Boolean(globalThis.HEALTH_BUILD_DIAGNOSTICS?.entryVersionToken),
      recoveryAttempted: Boolean(globalThis.HEALTH_BUILD_DIAGNOSTICS?.recovery?.attempted),
    }));
    assertExpectedBuild(expectedBuildId,delivery);
    const buildMatch = true;
    await page.waitForFunction(() => {
      const visible = node => Boolean(node && !node.hidden && getComputedStyle(node).display !== 'none' && node.getClientRects().length);
      return visible(document.getElementById('google-login-entry')) || visible(document.getElementById('controlled-beta-access'));
    }, null, {timeout:10000});
    const authBoundary = await page.evaluate(() => {
      const app = document.getElementById('authenticated-app');
      const visible = node => Boolean(node && !node.hidden && getComputedStyle(node).display !== 'none' && node.getClientRects().length);
      return {authenticatedAppVisible: visible(app),authenticatedAppAriaHidden:app?.getAttribute('aria-hidden')==='true',authenticatedAppInert:Boolean(app?.inert||app?.hasAttribute('inert')),loginVisible: visible(document.getElementById('google-login-entry')), accessGateVisible: visible(document.getElementById('controlled-beta-access'))};
    });
    assertUnauthenticatedBoundary(authBoundary);
    report.auth_boundaries.push({...viewport, ...authBoundary});
    // The public route correctly presents auth first. Hide only its visual layer
    // inside this read-only test page so the deployed sheet itself can be reviewed;
    // no session, entitlement or application data access is created.
    await page.addStyleTag({content:'#google-login-entry,#controlled-beta-access{display:none!important}'});
    const openStarted = await page.evaluate(() => performance.now());
    await page.locator('#quick-open').click();
    await page.locator('#quick-sheet').waitFor({state:'visible'});
    await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.fabOpenMetrics || '[]').length > 0);
    const clickToVisibleMs = await page.evaluate(started => Number((performance.now() - started).toFixed(2)), openStarted);
    const appClickToVisibleMs = await page.evaluate(() => JSON.parse(document.documentElement.dataset.fabOpenMetrics || '[]').at(-1));
    const layout = await page.locator('#quick-sheet').evaluate((node, width) => {
      const options = [...node.querySelectorAll('.quick-option')], rects = options.map(option => option.getBoundingClientRect());
      const nav = document.querySelector('.mobile-nav')?.getBoundingClientRect();
      return {
        uiVersion: node.dataset.uiVersion || null,
        labels: options.map(option => option.querySelector('b')?.textContent?.trim()),
        count: options.length,
        columns: getComputedStyle(node.querySelector('.quick-options')).gridTemplateColumns.split(' ').length,
        minCardHeight: Math.min(...rects.map(rect => rect.height)),
        maxCardHeight: Math.max(...rects.map(rect => rect.height)),
        horizontalOverflow: document.documentElement.scrollWidth > width || rects.some(rect => rect.left < -0.5 || rect.right > width + 0.5),
        clipped: rects.some(rect => rect.top < -0.5 || rect.bottom > innerHeight + 0.5),
        bottomNavPresent: Boolean(nav && nav.height > 0),
      };
    }, viewport.width);
    assert.equal(layout.uiVersion, 'quick-add-v3');
    assert.deepEqual(layout.labels, expected);
    assert.equal(layout.count, 6);assert.equal(layout.columns, 2);
    assert.ok(layout.minCardHeight >= 48);assert.ok(layout.maxCardHeight - layout.minCardHeight <= 1);
    assert.equal(layout.horizontalOverflow, false);assert.equal(layout.clipped, false);assert.equal(layout.bottomNavPresent, true);
    const screenshot = path.join(evidence, `quick-add-live-${viewport.width}x${viewport.height}.png`);
    await page.screenshot({path:screenshot, fullPage:false});
    const beforeBack = page.url();
    await page.evaluate(() => history.back());
    await page.locator('#sheet-backdrop').waitFor({state:'hidden'});
    assert.equal(page.url(), beforeBack);
    report.viewports.push({...viewport, ...layout, ...delivery, expectedBuildId, buildMatch, clickToVisibleMs, appClickToVisibleMs, android_back_dismiss:true, screenshot});
    if (viewport.width === 360) {
      for (const item of [
        {domain:'sleep', title:'新增睡眠', label:'睡眠總時長', timeFields:true},
      ]) {
        await page.evaluate(() => globalThis.openSheet('quick-sheet'));
        await page.locator(`[data-observation-add="${item.domain}"]`).click();
        await page.locator('#observation-form').waitFor({state:'visible'});
        const form = await page.locator('#observation-form').evaluate(node => ({
          domain: node.querySelector('#observation-domain')?.value,
          title: node.querySelector('#observation-title')?.textContent?.trim(),
          valueLabel: node.querySelector('#observation-value-label')?.textContent?.trim(),
          dateVisible: Boolean(node.querySelector('#observation-date')?.getClientRects().length),
          timeVisible: !node.querySelector('#observation-time-group')?.hidden,
        }));
        assert.equal(form.domain, item.domain);assert.equal(form.title, item.title);
        assert.match(form.valueLabel, new RegExp(item.label));assert.equal(form.dateVisible, true);assert.equal(form.timeVisible, item.timeFields);
        const formScreenshot = path.join(evidence, `quick-add-live-${item.domain}-form.png`);
        await page.screenshot({path:formScreenshot, fullPage:false});
        report.manual_forms.push({...form, screenshot:formScreenshot});
        await page.evaluate(() => globalThis.closeSheet());
        await page.locator('#sheet-backdrop').waitFor({state:'hidden'});
      }
      await page.evaluate(() => globalThis.openSheet('quick-sheet'));
      await page.locator('[data-action="weight"]').click();
      await page.locator('#weight-form').waitFor({state:'visible'});
      assert.equal(await page.locator('#weight-input').getAttribute('required'), null);
      assert.equal(await page.locator('#fat-input').getAttribute('required'), null);
      await page.evaluate(() => globalThis.closeSheet());
      await page.locator('#sheet-backdrop').waitFor({state:'hidden'});
      await page.evaluate(() => globalThis.openSheet('quick-sheet'));
      await page.locator('[data-action="activitypair"]').click();
      await page.locator('#activity-pair-form').waitFor({state:'visible'});
      assert.equal(await page.locator('#activity-pair-steps').getAttribute('step'), '1');
      assert.equal(await page.locator('#activity-pair-energy').getAttribute('max'), '30000');
      await page.evaluate(() => globalThis.closeSheet());
      await page.locator('#sheet-backdrop').waitFor({state:'hidden'});
    }
    const diagnostics = observer.snapshot();
    assert.equal(diagnostics.page_errors, 0, 'PAGE_ERROR_DETECTED');
    assert.deepEqual(diagnostics.unexpected_failed_requests, [], 'UNEXPECTED_NETWORK_FAILURE');
    const resolvedHost = new URL(delivery.resolvedResource).hostname;
    assert.deepEqual(filterFirstPartyHttpErrors(diagnostics, [...new Set([target.hostname,resolvedHost,'uavimjgccigpbwqmfkhh.supabase.co'])]), [], 'FIRST_PARTY_HTTP_ERROR');
    report.diagnostics.push({...viewport, ...diagnostics});
    await context.close();
  }
  report.status = 'PASS';
} catch (error) {
  const safeCodes=['EXPECTED_BUILD_ID_REQUIRED','LIVE_DEPLOYED_BUILD_MISMATCH','LIFF_LOADED_BUILD_MISMATCH','UNAUTHENTICATED_APP_VISIBLE','UNAUTHENTICATED_APP_NOT_INERT','AUTH_BOUNDARY_NOT_VISIBLE','PAGE_ERROR_DETECTED','UNEXPECTED_NETWORK_FAILURE','FIRST_PARTY_HTTP_ERROR','UNAPPROVED_ACCEPTANCE_TARGET'];
  report.status='FAIL';report.error={name:error?.name||'Error',code:safeCodes.find(code=>String(error?.message||'').includes(code))||'ACCEPTANCE_FAILED'};process.exitCode=1;
} finally {
  report.ended_at = new Date().toISOString();
  await browser.close();
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({status:report.status, report:path.join(evidence,'report.json')}));
}
