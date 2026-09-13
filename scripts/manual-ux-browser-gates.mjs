import assert from 'node:assert/strict';
import path from 'node:path';
async function bounded(promise,label,ms=15000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error(label)),ms))]);}finally{clearTimeout(timer);}}
// Real server/authorization/SQL inherited from the existing runner. Network faults
// delay or interrupt real requests; they never substitute a fixture response.
export async function runManualUxGates(h) {
 const {gate,browserContext,until,day,shift,customRange,base,http,loginCookie,pg,subjects,evidence}=h;
 await gate('mobile_drilldown_records_drafts_and_themes',async()=>{
  const {page:p}=await browserContext('A');h.setPage(p);
  const home=()=>p.locator('.mobile-nav-btn[data-screen="dashboard-screen"]').click();
  for(const width of [320,360,393,430]) {
   await p.setViewportSize({width,height:900});await home();
   for(const [selector,screen,metric] of [
    ['.kpi-card[data-metric="weight"]','body-screen','weight'],
    ['.kpi-card[data-metric="bodyFat"]','body-screen','bodyFat'],
    ['.kpi-card[data-target="sleep-screen"]','sleep-screen'],
    ['.kpi-card[data-target="training-screen"]','training-screen'],
    ['.kpi-card[data-target="health-score-screen"]','health-score-screen']]){
     await home();const card=p.locator(selector);assert.equal(await card.getAttribute('role'),'button');await p.keyboard.press('Tab');await card.focus();
     const accessibility=await card.evaluate(el=>{const bounds=el.getBoundingClientRect(),style=getComputedStyle(el);return {width:bounds.width,height:bounds.height,outline:parseFloat(style.outlineWidth),outlineStyle:style.outlineStyle,label:el.getAttribute('aria-label')};});
     assert.ok(accessibility.width>=44&&accessibility.height>=44,`${width}px KPI touch target`);assert.ok(accessibility.label);assert.ok(accessibility.outline>=2&&accessibility.outlineStyle!=='none',`${width}px KPI focus-visible`);
     await p.keyboard.press('Enter');
     await p.locator('#'+screen+'.active').waitFor();if(metric)assert.equal(await p.locator('#body-metric-select').inputValue(),metric);
     if(screen==='training-screen')assert.equal(await p.locator('#training-screen').getAttribute('data-training-view'),'overview');
     assert.equal(await p.locator('#'+screen).evaluate(el=>el.getBoundingClientRect().height>80),true);
    }
   await home();await p.locator('.mobile-nav-btn[data-screen="records-center"]').click();
   await p.locator('#nutrition-screen [data-record-view]').selectOption('training');await p.locator('#training-screen.active').waitFor();
   await p.locator('#training-overview [data-record-view]').selectOption('nutrition');await p.locator('#nutrition-screen.active').waitFor();
   for(const mode of ['dark','light']){
    await p.locator('.mobile-nav-btn[data-screen="settings-screen"]').click();await p.locator(`[data-mode="${mode}"]`).click();await home();
    assert.equal(await p.locator('html').getAttribute('data-theme'),mode);
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`${width}px ${mode} overflow`);
   }
   await p.screenshot({path:path.join(evidence,`manual-ux-${width}.png`),fullPage:true});
  }
  await home();await p.locator('.kpi-card[data-target="training-screen"]').click();await p.locator('#start-workout').click();
  await until(async()=>await p.locator('#exercise-select option').count()>0,'exercise catalog');
  await p.locator('#add-exercise').click();await p.locator('.exercise-weight').fill('0');await p.locator('.exercise-reps').fill('10');await p.locator('.complete-set').click();
  await home();await p.locator('.kpi-card[data-target="training-screen"]').click();await p.locator('#training-draft-notice').waitFor({state:'visible'});
  await p.locator('#resume-workout').click();assert.match(await p.locator('.set-log').innerText(),/0 kg × 10/);
  await p.locator('#back-training').click();await p.locator('#start-workout').click();await p.locator('#draft-continue').click();assert.match(await p.locator('.set-log').innerText(),/0 kg × 10/);
  await p.locator('#back-training').click();await p.locator('#start-workout').click();
  for(const answer of ['dismiss','accept']){
   const received=new Promise(resolve=>p.once('dialog',resolve));const clicked=p.locator('#draft-discard').click();const dialog=await bounded(received,'DRAFT_DIALOG_TIMEOUT');
   assert.equal(dialog.type(),'confirm');assert.equal(dialog.message(),'確定捨棄尚未儲存的訓練草稿並開始新訓練？');await dialog[answer]();await clicked;
   if(answer==='dismiss')assert.equal(await p.locator('#training-draft-dialog').isVisible(),true);
  }
  assert.equal(await p.locator('.set-log').count(),0);await p.locator('#add-exercise').click();
  for(const [weight,reps] of [['-1','10'],['10','1.5'],['10','0']]){await p.locator('.exercise-weight').fill(weight);await p.locator('.exercise-reps').fill(reps);await p.locator('.complete-set').click();assert.equal(await p.locator('.set-log').innerText(),'');}
  await p.locator('.exercise-weight').fill('0');await p.locator('.exercise-reps').fill('2');await p.locator('.complete-set').click();assert.match(await p.locator('.set-log').innerText(),/0 kg × 2/);
  const b=await browserContext('B');h.setPage(b.page);await b.page.locator('.kpi-card[data-target="training-screen"]').click();assert.equal(await b.page.locator('#training-draft-notice').isVisible(),false);
 });
 await gate('weight_date_barrier_inline_retry_and_range_refresh',async()=>{
  const cookie=await loginCookie('A'),d1=shift(-8),d2=shift(-7);
  for(const [date,weight]of[[d1,61],[d2,72]])assert.equal((await http(cookie,'upsertBodyRecord',{date,weight,clientRequestId:crypto.randomUUID()})).ok,true);
  const {page:p,context}=await browserContext('A');h.setPage(p);
  await p.locator('#quick-open').click();await p.locator('[data-action="weight"]').click();await until(()=>p.locator('#weight-save').isEnabled(),'weight loaded');
  let release,seen;const blocked=new Promise(resolve=>seen=resolve),barrier=new Promise(resolve=>release=resolve);
  await context.route(base+'/v1/engine/web',async route=>{const input=route.request().postDataJSON();if(input.action==='getBodyRecords'&&input.payload.startDate===d1&&input.payload.endDate===d1){const response=await route.fetch();seen();await bounded(barrier,'WEIGHT_RESPONSE_RELEASE_TIMEOUT');await route.fulfill({response});}else await route.continue();});
  await p.locator('#weight-date').fill(d1);await p.locator('#weight-date').dispatchEvent('change');await bounded(blocked,'WEIGHT_RESPONSE_BARRIER_TIMEOUT');
  assert.equal(await p.locator('#weight-input').isDisabled(),true);await p.locator('#weight-date').fill(d2);await p.locator('#weight-date').dispatchEvent('change');
  await until(async()=>await p.locator('#weight-input').inputValue()==='72','new date value');release();await context.unroute(base+'/v1/engine/web');
  await until(async()=>await p.locator('#weight-save').isEnabled(),'new date ready');assert.equal(await p.locator('#weight-input').inputValue(),'72');
  const id=await p.locator('#weight-record-id').inputValue();assert.equal((await pg.admin`select local_date::text as date from public.engine_manual_body_records where canonical_user_id=${subjects.A.canonical} and record_id=${id}`)[0].date,d2);
  // Abort the real read only, then retry through the real handler and DB.
  await context.route(base+'/v1/engine/web',route=>route.request().postDataJSON().action==='getBodyRecords'?route.abort('failed'):route.continue());
  await p.locator('#weight-date').dispatchEvent('change');await p.locator('#weight-load-retry').waitFor({state:'visible'});assert.equal(await p.locator('#weight-save').isDisabled(),true);
  await context.unroute(base+'/v1/engine/web');await p.locator('#weight-load-retry').click();await until(()=>p.locator('#weight-save').isEnabled(),'retry ready');assert.equal(await p.locator('#weight-input').inputValue(),'72');
  await p.locator('#sheet-backdrop').click({position:{x:2,y:2}});await p.locator('.mobile-nav-btn[data-screen="body-screen"]').click();await customRange(p,d1,d1);await p.locator('#body-current').filter({hasText:'61'}).waitFor();await customRange(p,d2,d2);await p.locator('#body-current').filter({hasText:'72'}).waitFor();
  await context.route(base+'/v1/engine/web',route=>route.request().postDataJSON().action==='getBodyRecords'?route.abort('failed'):route.continue());await customRange(p,shift(-6),shift(-6));await p.locator('#body-screen-read-state button').waitFor({state:'visible'});assert.equal(await p.locator('#body-screen .skeleton').count(),0);
  await context.unroute(base+'/v1/engine/web');await p.locator('#body-screen-read-state button').click();await until(async()=>await p.locator('#body-screen').getAttribute('data-read-state')==='empty','inline retry empty');
  assert.ok(!h.report.http.some(r=>r.transport==='BROWSER_ACTUAL_HTTP'&&/Sheets/.test(r.response?.provider||'')));
 });
}
