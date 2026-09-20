// Focused, repeatable mobile Web performance profile through the real local HTTP
// handler and a disposable native PostgreSQL database. Evidence is synthetic and
// must never be described as real-user or hosted-network latency.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {spawn, execFileSync} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import net from 'node:net';
import path from 'node:path';
import {createLocalPostgres} from './local-engine-postgres.mjs';

const label=process.argv[2];
assert.ok(['baseline','optimized','acceptance'].includes(label),'Usage: node scripts/profile-web-performance.mjs baseline|optimized|acceptance');
assert.ok(process.env.DENO_DIR&&path.isAbsolute(process.env.DENO_DIR)&&path.resolve(process.env.DENO_DIR).toLowerCase().startsWith('d:\\'),'D-scoped DENO_DIR required');
const root=path.resolve(process.env.WEB_PERF_EVIDENCE_ROOT||'D:/Dev/Evidence/web-performance-20260920');
assert.ok(root.toLowerCase().startsWith('d:\\dev\\evidence\\'),'D-drive evidence root required');
const runId=`${label}-${new Date().toISOString().replace(/[:.]/g,'')}-${randomUUID()}`;
const evidence=path.join(root,runId);await mkdir(evidence,{recursive:true});
const modulePath=process.env.ENGINE_PLAYWRIGHT_MODULE||'C:/Users/D0252/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const browserPath=process.env.ENGINE_BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const {chromium}=await import(pathToFileURL(modulePath).href);
const requireInstalled=createRequire(modulePath);
const base='http://127.0.0.1:57841';
const samples=label==='acceptance'?10:5;
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift=n=>new Date(Date.parse(today)+n*86400000).toISOString().slice(0,10);
const now=()=>new Date().toISOString();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=value=>createHash('sha256').update(value).digest('hex');
const round=value=>Number(Number(value).toFixed(2));
const values={};
const push=(name,value)=>{if(Number.isFinite(value))(values[name]??=[]).push(round(value));};
const percentile=(list,p)=>{const sorted=[...(list||[])].sort((a,b)=>a-b);if(!sorted.length)return null;return round(sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]);};
const stats=list=>{const sorted=[...(list||[])].sort((a,b)=>a-b);return {samples:sorted.length,median_ms:percentile(sorted,.5),p95_ms:sorted.length>=10?percentile(sorted,.95):null,min_ms:sorted.length?round(sorted[0]):null,max_ms:sorted.length?round(sorted.at(-1)):null};};
const summary=()=>Object.fromEntries(Object.entries(values).map(([key,list])=>[key,stats(list)]));
const git=args=>execFileSync('git',['--no-optional-locks','-c','core.fsmonitor=false','-c','diff.autoRefreshIndex=false',...args],{encoding:'utf8',timeout:15000}).trim();
const report={label,run_id:runId,started_at:now(),classification:'LOCAL_NATIVE_PG17_ACTUAL_HTTP_SYNTHETIC_AUTH_MOBILE_EMULATION_NOT_REAL_USER_LATENCY',source_revision:git(['rev-parse','HEAD']),working_tree:git(['status','--short']),samples_per_repeated_flow:samples,viewport:{width:393,height:852},network_profiles:{normal_mobile:{latency_ms:80,download_bps:1_600_000,upload_bps:750_000},moderately_slow:{latency_ms:150,download_bps:750_000,upload_bps:300_000}},requests:[],flows:[],errors:[],source_hashes:{},live_public_probe:null};
for(const file of ['index.html','scripts/local-engine-web.js','scripts/web-view-state.js','scripts/manual-observation-web.js','scripts/manual-sql-config.js'])report.source_hashes[file]=hash(await readFile(file));

async function portFree(port){await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',()=>reject(Error('PORT_IN_USE_'+port)));server.listen(port,'127.0.0.1',()=>server.close(resolve));});}
async function until(fn,labelName,timeout=30000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await fn();if(value)return value;await sleep(75);}throw Error('WAIT_TIMEOUT_'+labelName);}
async function loginCookie(){const response=await fetch(base+'/local-login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:'A'}),signal:AbortSignal.timeout(10000)});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];}
async function call(cookie,action,payload={}){const started=performance.now(),response=await fetch(base+'/v1/engine/web',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({action,payload}),signal:AbortSignal.timeout(30000)});const body=await response.json();assert.equal(body.ok,true,`${action}: ${body.error||response.status}`);push('setup_api_ms',performance.now()-started);return body.data;}
async function seed(cookie){
  const catalog=await call(cookie,'getExerciseDatabase');
  const exercise=catalog.find(item=>item.exerciseId==='global:barbell-bench-press')||catalog[0];assert.ok(exercise?.exerciseId);
  for(let i=1;i<=3;i++){
    const date=shift(-i);
    await call(cookie,'upsertBodyRecord',{date,weight:70+i/10,bodyFat:18+i/10,clientRequestId:randomUUID()});
    await call(cookie,'upsertMealRecord',{date,time:'12:00',mealType:'午餐',foodName:`合成餐點 ${i}`,calories:500+i,protein:30,carbs:60,fat:15,dataSource:'PERFORMANCE_SYNTHETIC',userConfirmed:true,clientRequestId:randomUUID()});
    await call(cookie,'upsertManualObservation',{domain:'steps',date,timezone:'Asia/Taipei',value:6500+i*100,coverage:'FULL_DAY',clientRequestId:randomUUID(),sourceNote:'PERFORMANCE_SYNTHETIC'});
    await call(cookie,'upsertManualObservation',{domain:'total_energy',date,timezone:'Asia/Taipei',value:2100+i*10,coverage:'FULL_DAY',clientRequestId:randomUUID(),sourceNote:'PERFORMANCE_SYNTHETIC'});
  }
  await call(cookie,'upsertManualObservation',{domain:'sleep',date:shift(-1),timezone:'Asia/Taipei',value:460,coverage:'SESSION',startedAt:shift(-2)+'T23:30:00+08:00',endedAt:shift(-1)+'T07:10:00+08:00',clientRequestId:randomUUID(),sourceNote:'PERFORMANCE_SYNTHETIC'});
  await call(cookie,'addWorkoutRecord',{date:shift(-1),startTime:shift(-1)+'T01:00:00Z',endTime:shift(-1)+'T01:20:00Z',clientRequestId:randomUUID(),exercises:[{exerciseId:exercise.exerciseId,sets:[{weight:20,reps:10}]}]});
}
function networkProfile(name){return name==='moderately_slow'?{latency:150,downloadThroughput:750_000/8,uploadThroughput:300_000/8}:{latency:80,downloadThroughput:1_600_000/8,uploadThroughput:750_000/8};}
async function makeContext(browser,{profile='normal_mobile'}={}){
  const context=await browser.newContext({viewport:{width:393,height:852},timezoneId:'Asia/Taipei',locale:'zh-TW',serviceWorkers:'block'});
  await context.addInitScript(()=>{
    globalThis.__webPerf={longTasks:[],marks:[]};
    try{new PerformanceObserver(list=>{for(const entry of list.getEntries())globalThis.__webPerf.longTasks.push({startTime:entry.startTime,duration:entry.duration});}).observe({type:'longtask',buffered:true});}catch{}
  });
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin===base||url.protocol==='data:'||url.protocol==='blob:')return route.continue();
    if(url.hostname==='cdn.tailwindcss.com')return route.fulfill({status:200,contentType:'application/javascript',body:'globalThis.tailwind={};'});
    if(url.hostname==='cdn.jsdelivr.net')return route.fulfill({status:200,contentType:'application/javascript',body:'globalThis.lucide={createIcons(){}};'});
    if(url.hostname==='static.line-scdn.net')return route.fulfill({status:200,contentType:'application/javascript',body:'globalThis.liff=undefined;'});
    if(url.hostname==='fonts.googleapis.com')return route.fulfill({status:200,contentType:'text/css',body:''});
    return route.abort('blockedbyclient');
  });
  const page=await context.newPage();page.setDefaultTimeout(32000);
  const cdp=await context.newCDPSession(page);const profileValues=networkProfile(profile);
  await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,...profileValues,connectionType:'cellular4g'});
  const pending=new Map();
  page.on('request',request=>{if(!request.url().endsWith('/v1/engine/web'))return;let action='UNKNOWN';try{action=request.postDataJSON()?.action||action;}catch{}pending.set(request,{action,started:performance.now()});});
  page.on('response',response=>{const request=response.request(),item=pending.get(request);if(!item)return;const ended=performance.now();const promise=(async()=>{let body={};try{body=await response.json();}catch{}report.requests.push({profile,action:item.action,duration_ms:round(ended-item.started),http_status:response.status(),db_commit_ms:Number(body?.data?.timing?.dbCommitMs??null),at:now()});})();promise.catch(()=>{});pending.delete(request);});
  page.on('pageerror',error=>report.errors.push('PAGE: '+error.message));
  return {context,page,cdp};
}
async function waitDashboard(page){await page.waitForFunction(()=>document.getElementById('connection-label')?.textContent==='已連線'&&document.documentElement.dataset.mutationMetrics!==undefined||document.getElementById('connection-label')?.textContent==='已連線');await page.locator('#dashboard-screen.active').waitFor();}
async function openSignedApp(page){const started=performance.now();await page.goto(base+'/?debugPerf=1',{waitUntil:'domcontentloaded'});const dom=performance.now();await page.locator('#local-login-a').click();await page.locator('#local-engine-login').waitFor({state:'detached'});const identity=performance.now();await waitDashboard(page);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const ready=performance.now();return {dom_ms:dom-started,auth_to_identity_ms:identity-dom,app_ready_ms:ready-started,identity_to_ready_ms:ready-identity};}
async function reloadWarm(page){const started=performance.now();await page.reload({waitUntil:'domcontentloaded'});const dom=performance.now();await waitDashboard(page);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));return {dom_ms:dom-started,ready_ms:performance.now()-started};}
async function timed(page,name,action,ready){const started=performance.now();await action();const visual=performance.now();await ready();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const ended=performance.now();push(name+'_visual_ms',visual-started);push(name+'_ready_ms',ended-started);report.flows.push({name,visual_ms:round(visual-started),ready_ms:round(ended-started),at:now()});return ended-started;}
async function navigateTo(page,screen){await timed(page,screen.replace('-screen',''),()=>page.evaluate(value=>navigate(value),screen),()=>page.waitForFunction(value=>{const node=document.getElementById(value);return node?.classList.contains('active')&&(!node.dataset.readState||['success','empty'].includes(node.dataset.readState));},screen));}
async function quickWeight(page,index){await page.locator('#quick-open').click();await page.locator('.quick-option[data-action="weight"]').click();await page.waitForFunction(()=>!document.getElementById('weight-date-note').textContent.includes('載入紀錄中'));await page.locator('#weight-input').fill(String(71+index/10));await timed(page,'weight_save',()=>page.locator('#weight-save').click(),()=>page.locator('#weight-form').waitFor({state:'hidden'}));}
async function quickMeal(page,index){await page.locator('#quick-open').click();await page.locator('.quick-option[data-action="meal"]').click();await page.locator('#meal-food').fill(`效能餐點 ${label} ${index}`);await page.locator('#meal-calories').fill(String(410+index));await page.locator('#meal-protein').fill('30.5');await page.locator('#meal-carbs').fill('52.5');await page.locator('#meal-fat').fill('12.5');await timed(page,'nutrition_save',()=>page.locator('#meal-save').click(),()=>page.locator('#meal-form').waitFor({state:'hidden'}));}
async function quickObservation(page,domain,index){await page.locator('#quick-open').click();await page.locator(`[data-observation-add="${domain}"]`).click();await page.waitForFunction(()=>!document.getElementById('observation-status').textContent.includes('正在載入'));
  if(domain==='sleep'){const day=shift(-Math.min(index+4,20));await page.locator('#observation-date').fill(day);await page.locator('#observation-date').dispatchEvent('change');await page.locator('#observation-start').fill(shift(-Math.min(index+5,21))+'T23:30');await page.locator('#observation-end').fill(day+'T07:10');}
  else await page.locator('#observation-value').fill(String((domain==='steps'?8000:2200)+index));
  await timed(page,domain==='total_energy'?'energy_save':domain+'_save',()=>page.locator('#observation-save').click(),()=>page.locator('#observation-form').waitFor({state:'hidden'}));
}
async function workout(page,index){await navigateTo(page,'training-screen');await timed(page,'exercise_picker',()=>page.locator('#start-workout').click(),()=>page.waitForFunction(()=>{const select=document.getElementById('exercise-select');return !select.disabled&&select.options.length>0&&!!select.value;}));await page.locator('#add-exercise').click();const block=page.locator('#exercise-session-list .card').last();await block.locator('.exercise-weight').fill(String(20+index));await block.locator('.exercise-reps').fill('10');await block.locator('.complete-set').click();await timed(page,'workout_save',()=>page.locator('#finish-workout').click(),()=>page.waitForFunction(()=>document.getElementById('training-screen')?.dataset.trainingView==='overview'&&document.getElementById('toast')?.textContent.includes('已儲存')));}
async function profileComplete(browser,index){const {context,page}=await makeContext(browser);try{
  const open=await openSignedApp(page);push('app_open_cold_dom_ms',open.dom_ms);push('auth_session_resolve_ms',open.auth_to_identity_ms);push('app_open_cold_ready_ms',open.app_ready_ms);push('app_interactive_ms',open.app_ready_ms);
  const warm=await reloadWarm(page);push('app_open_warm_dom_ms',warm.dom_ms);push('app_open_warm_ready_ms',warm.ready_ms);
  await timed(page,'dashboard_refresh',()=>page.evaluate(()=>boot()),()=>waitDashboard(page));
  await navigateTo(page,'nutrition-screen');await navigateTo(page,'training-screen');await navigateTo(page,'body-screen');await navigateTo(page,'sleep-screen');await navigateTo(page,'activity-screen');
  await timed(page,'records',()=>page.evaluate(()=>navigate('records-center')),()=>page.waitForFunction(()=>['nutrition-screen','training-screen'].includes(document.querySelector('.screen.active')?.id)&&['success','empty'].includes(document.querySelector('.screen.active')?.dataset.readState)));
  await quickWeight(page,index);await quickMeal(page,index);await quickObservation(page,'sleep',index);await quickObservation(page,'steps',index);await quickObservation(page,'total_energy',index);
  await workout(page,index);
  await timed(page,'return_dashboard',()=>page.evaluate(()=>navigate('dashboard-screen')),()=>page.locator('#dashboard-screen.active').waitFor());
  await timed(page,'date_range',()=>page.locator('#global-range').selectOption(index%2?'7d':'30d'),()=>waitDashboard(page));
  const snapshot=await page.evaluate(()=>({longTasks:globalThis.__webPerf?.longTasks||[],domNodes:document.getElementsByTagName('*').length,resources:performance.getEntriesByType('resource').map(entry=>({name:entry.name,transferSize:entry.transferSize,duration:entry.duration})),mutationMetrics:JSON.parse(document.documentElement.dataset.mutationMetrics||'[]')}));
  push('dom_nodes',snapshot.domNodes);for(const task of snapshot.longTasks)push('long_task_ms',task.duration);
  for(const metric of snapshot.mutationMetrics){if(metric.event==='workout_request_to_api_response')push('workout_request_api_ms',metric.elapsedMs);if(metric.event==='workout_api_response_to_ui_ready')push('workout_response_ui_ms',metric.elapsedMs);if(metric.event==='workout_background_recompute')push('workout_recompute_ms',metric.elapsedMs);if(metric.event==='workout_training_range_refresh')push('workout_refresh_ms',metric.elapsedMs);if(metric.dbCommitMs!==null&&metric.dbCommitMs!==undefined)push('workout_db_commit_ms',Number(metric.dbCommitMs));}
 }finally{await context.close();}}
async function liveProbe(browser){const started=performance.now(),context=await browser.newContext({viewport:{width:393,height:852},locale:'zh-TW',serviceWorkers:'block'});try{const page=await context.newPage(),cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,...networkProfile('normal_mobile'),connectionType:'cellular4g'});const response=await page.goto('https://d0252422-oss.github.io/health-companion-beta/',{waitUntil:'domcontentloaded',timeout:45000});await page.waitForTimeout(1500);const metrics=await page.evaluate(()=>({navigation:performance.getEntriesByType('navigation')[0]?.toJSON(),resources:performance.getEntriesByType('resource').map(entry=>({name:entry.name,duration:entry.duration,transferSize:entry.transferSize,decodedBodySize:entry.decodedBodySize})),domNodes:document.getElementsByTagName('*').length,loginVisible:!!document.getElementById('google-login-entry')}));return {http_status:response?.status(),elapsed_ms:round(performance.now()-started),...metrics};}catch(error){return {error:error.message,elapsed_ms:round(performance.now()-started)};}finally{await context.close();}}

let pg,child,browser,stdout='',stderr='';
try{
 await portFree(57841);await portFree(57485);pg=await createLocalPostgres({port:57485,release:'AB'});const config=path.join(evidence,'runtime-config.json');await writeFile(config,JSON.stringify(pg.config));
 const env={...process.env,HEALTH_ENGINE_LOCAL_ONLY:'1',HEALTH_EXERCISE_MANAGEMENT_LOCAL:'1',HEALTH_MANUAL_WEB_SESSION_LOCAL:'1'};delete env.ALGORITHM_PYTHON;
 const deno=process.env.DENO_EXECUTABLE||'deno',args=['run','--cached-only','--frozen-lockfile','--node-modules-dir=none','--config','config/engine-local.deno.json','--allow-env','--allow-read','--allow-sys','--allow-net=127.0.0.1','scripts/local-engine-server.ts',config];
 child=spawn(deno,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env});child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
 await until(async()=>{if(child.exitCode!==null)throw Error('LOCAL_SERVER_EXIT_'+child.exitCode);try{return(await fetch(base+'/local-health',{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},'server');
 const cookie=await loginCookie();await seed(cookie);
 browser=await chromium.launch({executablePath:browserPath,headless:true});report.browser_version=browser.version();report.playwright_version=requireInstalled('playwright/package.json').version;report.postgres=pg.evidence.server;
 report.live_public_probe=await liveProbe(browser);
 for(let index=0;index<samples;index++){console.log(`PROFILE ${label} ${index+1}/${samples}`);await profileComplete(browser,index);await writeFile(path.join(evidence,'checkpoint.json'),JSON.stringify({...report,metrics:summary()},null,2));}
 const requestDurations={};for(const request of report.requests){(requestDurations[request.action]??=[]).push(request.duration_ms);if(Number.isFinite(request.db_commit_ms)&&request.db_commit_ms>0)push('db_commit_ms',request.db_commit_ms);}
 report.request_action_stats=Object.fromEntries(Object.entries(requestDurations).map(([action,list])=>[action,stats(list)]));
 report.metrics=summary();report.request_count=report.requests.length;report.duplicate_request_candidates=Object.entries(requestDurations).filter(([,list])=>list.length>samples*2).map(([action,list])=>({action,count:list.length}));report.ended_at=now();
 await writeFile(path.join(evidence,'performance-report.json'),JSON.stringify(report,null,2));await writeFile(path.join(evidence,'runtime.stdout.log'),stdout);await writeFile(path.join(evidence,'runtime.stderr.log'),stderr);
 console.log(JSON.stringify({evidence,status:report.errors.length?'FAIL':'PASS',metrics:report.metrics,request_action_stats:report.request_action_stats,live_public_probe:report.live_public_probe&&{http_status:report.live_public_probe.http_status,elapsed_ms:report.live_public_probe.elapsed_ms}},null,2));if(report.errors.length)process.exitCode=1;
}catch(error){report.errors.push(error.stack||error.message);await writeFile(path.join(evidence,'performance-report.json'),JSON.stringify({...report,metrics:summary(),ended_at:now()},null,2));console.error(error);process.exitCode=1;}
finally{await writeFile(path.join(evidence,'runtime.stdout.log'),stdout).catch(()=>{});await writeFile(path.join(evidence,'runtime.stderr.log'),stderr).catch(()=>{});if(browser)await browser.close().catch(()=>{});if(child&&!child.killed){child.kill('SIGTERM');await sleep(600);if(child.exitCode===null)child.kill();}if(pg)await pg.close().catch(()=>{});}
