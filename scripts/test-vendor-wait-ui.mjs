// Scoped viewport/state regression; local synthetic presentation, no SQL/auth claim.
import fs from 'node:fs/promises';import http from 'node:http';import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
import {assertDDirectory} from './beta-cutover-driver.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=process.argv[2];
assertDDirectory(path.dirname(output));await fs.mkdir(output,{recursive:false});
const allowed=new Set(['/index.html','/build.json','/scripts/build-version.js','/scripts/core-ux-contract.js','/scripts/local-engine-web.js','/scripts/manual-observation-web.js','/scripts/web-view-state.js','/scripts/manual-sql-config.js']);
const server=http.createServer(async(req,res)=>{const p=new URL(req.url,'http://localhost').pathname,name=p==='/'?'/index.html':p;if(!allowed.has(name)){res.writeHead(404);return res.end();}try{res.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':'application/javascript');res.end(await fs.readFile(path.join(repo,name.slice(1))));}catch{res.writeHead(500);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const report={status:'RUNNING',kind:'LOCAL_UI_FIXTURE_ONLY',cases:[],remote_requests:0,sql_auth:'NOT_TESTED'};let browser;
try{
 assert.ok(process.env.ENGINE_PLAYWRIGHT_MODULE,'EXISTING_PLAYWRIGHT_REQUIRED');
 const {chromium}=await import(pathToFileURL(process.env.ENGINE_PLAYWRIGHT_MODULE).href);
 browser=await chromium.launch({headless:true,executablePath:'D:/Dev/Tools/playwright-browsers/chromium-1234/chrome-win64/chrome.exe'});
 for(const width of [320,360,393,430])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:852}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{window.lucide={createIcons(){}};});
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(origin+'/?uiTest=1');await page.waitForFunction(()=>typeof window.openSheet==='function');
  await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;ensureScreenData=async()=>{};},theme);
  async function overflow(label){const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(dimensions.scroll<=dimensions.width+1,`${width}/${theme}/${label} overflow ${dimensions.scroll}`);}
  await overflow('dashboard');
  const initial=await page.evaluate(()=>JSON.stringify(globalDateRange));
  await page.evaluate(()=>{workoutSession={startTime:'fixture-retained',exercises:[]};navigate('training-screen');});
  await page.locator('#training-overview').waitFor({state:'visible'});await overflow('training');
  await page.locator('[data-screen="records-center"]').click();await overflow('records');
  assert.equal(await page.evaluate(()=>JSON.stringify(globalDateRange)),initial);
  assert.equal(await page.evaluate(()=>workoutSession.startTime),'fixture-retained');
  await page.evaluate(()=>openDashboardCard({dataset:{target:'body-screen',metric:'bodyFat'}}));await overflow('body-drilldown');
  assert.equal(await page.locator('#body-metric-select').inputValue(),'bodyFat');
  await page.locator('#quick-open').click();await page.waitForFunction(()=>document.getElementById('sheet-backdrop').contains(document.activeElement));
  await page.evaluate(()=>openSheet('weight-form'));await overflow('manual-form');
  await page.evaluate(()=>{apiService.getBodyRecords=()=>new Promise(resolve=>window.__resolveWeightFixture=resolve);document.getElementById('weight-date').value=getLocalDateString();window.__pendingWeightFixture=loadWeightFormDate(getLocalDateString());});
  assert.equal(await page.locator('#weight-input').isDisabled(),false);assert.equal(await page.locator('#fat-input').isDisabled(),false);assert.equal(await page.locator('#weight-save').isDisabled(),true);
  await page.locator('#weight-input').fill('64.5');
  await page.evaluate(async()=>{window.__resolveWeightFixture([]);await window.__pendingWeightFixture;});assert.equal(await page.locator('#weight-save').isDisabled(),false);assert.equal(await page.locator('#weight-record-id').inputValue(),'');assert.equal(await page.locator('#weight-input').inputValue(),'64.5');
  await page.evaluate(async()=>{apiService.getBodyRecords=async()=>{throw Error('Synthetic local read unavailable');};document.getElementById('weight-date').value=getLocalDateString();await loadWeightFormDate(getLocalDateString());});
  assert.equal(await page.locator('#weight-save').isDisabled(),true);await page.locator('#weight-load-retry').waitFor({state:'visible'});
  await page.screenshot({path:path.join(output,`${width}-${theme}-error.png`)});
  await page.evaluate(()=>{document.getElementById('weight-date').value='';return loadWeightFormDate('');});assert.equal(await page.locator('#weight-delete').isDisabled(),true);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#quick-open').evaluate(e=>e===document.activeElement),true);
  await page.locator('#sheet-backdrop').waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);await page.screenshot({path:path.join(output,`${width}-${theme}.png`)});
  report.cases.push({width,theme,status:'PASS',checks:['dashboard/records/training/body/form overflow','training overview visible','draft and date range preserved','body-fat drilldown','manual loading/empty/error/retry/invalid-date state','keyboard focus/Escape']});await page.close();
 }
 report.status='PASS_IMPACTED_UI_MATRIX';
}catch(error){report.status='FAIL';report.error=error.message;process.exitCode=1;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
