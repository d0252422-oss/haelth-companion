// Read-only acceptance for the published Beta Quick Add surface.
// It aborts every non-GET/HEAD browser request and never authenticates.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

const target = new URL(process.argv[2] || 'https://d0252422-oss.github.io/health-companion-beta/');
assert.equal(target.hostname, 'd0252422-oss.github.io');
assert.equal(target.pathname, '/health-companion-beta/');
const evidence = path.resolve(process.env.QUICK_ADD_EVIDENCE_DIR || 'D:/Dev/Evidence/quick-add-v2-20260920/live');
assert.ok(evidence.toLowerCase().startsWith('d:\\dev\\evidence\\'));
await mkdir(evidence, {recursive: true});
const modulePath = process.env.ENGINE_PLAYWRIGHT_MODULE || 'C:/Users/D0252/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const browserPath = process.env.ENGINE_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const {chromium} = await import(pathToFileURL(modulePath).href);
const viewports = [{width:360,height:800},{width:393,height:852},{width:412,height:915}];
const expected = ['新增體重','新增體脂','新增訓練','新增飲食','新增睡眠','新增步數','新增總消耗','新增身體狀態'];
const report = {target: target.href, started_at: new Date().toISOString(), classification: 'LIVE_BETA_PUBLIC_HTML_READ_ONLY_VISUAL_NO_AUTH_NO_REMOTE_WRITE', viewports: [], blocked_non_read_requests: []};
const browser = await chromium.launch({headless: true, executablePath: browserPath});
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({viewport, locale:'zh-TW', timezoneId:'Asia/Taipei', colorScheme:'dark', serviceWorkers:'block'});
    const page = await context.newPage();
    await page.route('**/*', route => {
      const method = route.request().method();
      if (method === 'GET' || method === 'HEAD') return route.continue();
      report.blocked_non_read_requests.push({method, url: route.request().url()});
      return route.abort('blockedbyclient');
    });
    const url = new URL(target);url.searchParams.set('quickAddAudit', `${Date.now()}-${viewport.width}`);
    const response = await page.goto(url.href, {waitUntil:'domcontentloaded', timeout:30000});
    assert.equal(response?.status(), 200);
    await page.waitForFunction(() => typeof globalThis.openSheet === 'function');
    await page.evaluate(() => globalThis.openSheet('quick-sheet'));
    await page.locator('#quick-sheet').waitFor({state:'visible'});
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
    assert.equal(layout.uiVersion, 'quick-add-v2');
    assert.deepEqual(layout.labels, expected);
    assert.equal(layout.count, 8);assert.equal(layout.columns, 2);
    assert.ok(layout.minCardHeight >= 48);assert.ok(layout.maxCardHeight - layout.minCardHeight <= 1);
    assert.equal(layout.horizontalOverflow, false);assert.equal(layout.clipped, false);assert.equal(layout.bottomNavPresent, true);
    const screenshot = path.join(evidence, `quick-add-live-${viewport.width}x${viewport.height}.png`);
    await page.screenshot({path:screenshot, fullPage:false});
    const beforeBack = page.url();
    await page.evaluate(() => history.back());
    await page.locator('#sheet-backdrop').waitFor({state:'hidden'});
    assert.equal(page.url(), beforeBack);
    report.viewports.push({...viewport, ...layout, android_back_dismiss:true, screenshot});
    await context.close();
  }
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';report.error = error.stack || error.message;process.exitCode = 1;
} finally {
  report.ended_at = new Date().toISOString();
  await browser.close();
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({status:report.status, report:path.join(evidence,'report.json')}));
}
