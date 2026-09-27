// Focused local keyboard regression. No API/DB/auth acceptance is inferred.
import fs from 'node:fs/promises';import http from 'node:http';import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=process.argv[2];
assert.ok(output&&path.isAbsolute(output)&&/^D:[\\/]/i.test(output),'D_OUTPUT_REQUIRED');
assert.ok(process.env.ENGINE_PLAYWRIGHT_MODULE,'EXISTING_PLAYWRIGHT_REQUIRED');
await fs.mkdir(output,{recursive:false});
const allowed=new Set(['/index.html','/build.json','/scripts/build-version.js','/scripts/core-ux-contract.js','/scripts/local-engine-web.js','/scripts/manual-observation-web.js','/scripts/web-view-state.js','/scripts/manual-sql-config.js']);
const server=http.createServer(async(req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;const name=pathname==='/'?'/index.html':pathname;if(!allowed.has(name)){res.writeHead(404);return res.end();}try{res.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':'application/javascript');res.end(await fs.readFile(path.join(repo,name.slice(1))));}catch{res.writeHead(500);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
let browser;const report={status:'RUNNING',classification:'LOCAL_UI_KEYBOARD_ONLY',viewport:{width:393,height:852},remote_requests:0,checks:[],external_libraries:'Lucide icon renderer stub only; external scripts/fonts blocked',api_db_auth:'NOT_TESTED'};
try{
 const {chromium}=await import(pathToFileURL(process.env.ENGINE_PLAYWRIGHT_MODULE).href);
 browser=await chromium.launch({headless:true,executablePath:'D:/Dev/Tools/playwright-browsers/chromium-1234/chrome-win64/chrome.exe'});
 const page=await browser.newPage({viewport:report.viewport});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.lucide={createIcons(){}};});
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin+'/?uiTest=1');await page.waitForFunction(()=>document.documentElement.dataset.healthViewState==='ready'||typeof window.openSheet==='function');
 async function checkTrap(id){
  const modal=page.locator('#'+id);await modal.waitFor({state:'visible'});
  await page.waitForFunction(id=>document.getElementById(id).contains(document.activeElement),id);
  await modal.evaluate(el=>overlayFocusable(el).at(-1).focus());await page.keyboard.press('Tab');
  assert.equal(await modal.evaluate(el=>document.activeElement===overlayFocusable(el)[0]),true);
  await page.keyboard.press('Shift+Tab');assert.equal(await modal.evaluate(el=>document.activeElement===overlayFocusable(el).at(-1)),true);
  await page.locator('#quick-open').evaluate(el=>el.focus());assert.equal(await modal.evaluate(el=>el.contains(document.activeElement)),true);
  report.checks.push(id+': initial focus, Tab/Shift+Tab trap, background focus containment');
 }
 await page.locator('#quick-open').focus();await page.keyboard.press('Enter');await checkTrap('sheet-backdrop');
 // Change only presentation; no record fetch in this keyboard-only test.
 await page.evaluate(()=>openSheet('weight-form'));await page.waitForFunction(()=>document.getElementById('weight-form').contains(document.activeElement));
 await page.keyboard.press('Escape');assert.equal(await page.locator('#quick-open').evaluate(el=>el===document.activeElement),true);report.checks.push('sheet form switch retains original opener; Escape restores focus');
 await page.locator('#global-range').focus();await page.locator('#global-range').selectOption('custom');await checkTrap('date-range-backdrop');
 await page.keyboard.press('Escape');assert.equal(await page.locator('#global-range').evaluate(el=>el===document.activeElement),true);report.checks.push('date Escape restores opener');
 await page.locator('#open-trend-settings').click();await checkTrap('trend-settings-backdrop');await page.keyboard.press('Escape');assert.equal(await page.locator('#open-trend-settings').evaluate(el=>el===document.activeElement),true);report.checks.push('trend Escape restores opener');
 assert.deepEqual(errors,[]);await page.screenshot({path:path.join(output,'keyboard-393x852.png')});report.status='PASS_LOCAL_KEYBOARD';
}catch(error){report.status='FAIL';report.error=error.message;process.exitCode=1;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
