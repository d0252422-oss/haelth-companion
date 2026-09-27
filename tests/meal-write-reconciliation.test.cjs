const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

assert.match(html, /function classifyRequestError\(error\)/);
assert.match(html, /NETWORK_FAILURE/);
assert.match(html, /REQUEST_TIMEOUT/);
assert.match(html, /MALFORMED_RESPONSE/);
assert.match(html, /function isWriteStatusUnknownError\(error\)[^{]*\{return \["NETWORK_FAILURE","REQUEST_TIMEOUT","MALFORMED_RESPONSE"\]/);
assert.match(html, /getMealWriteStatus:clientRequestId=>apiPost\("getMealWriteStatus",\{clientRequestId\}\)/);
assert.match(html, /async function reconcileMealWrite\(clientRequestId,expectedOperation="UPSERT",expectedPayload=\{\}\)/);
assert.match(html, /for\(const delayMs of \[0,700,1400\]\)/);
assert.match(html, /function setMealSaveState\(button,state="idle"\)/);
assert.match(html, /function setMealMutationState\(action,state="idle"\)/);
assert.match(html, /function mealMutationEnvelope\(form,payload,operation="UPSERT",context=\{\}\)/);
assert.match(html, /function persistMealMutationEnvelope\(payload,userId=currentUser\?\.userId,operation="UPSERT",context=\{\},providerScope=mealMutationProviderScope\(\)\)/);
assert.match(html, /function restorePendingMealMutationForCurrentUser\(\)/);
assert.match(html, /key\.startsWith\(MEAL_MUTATION_STORAGE_PREFIX\)/);
assert.match(html, /if\(data\.sessionToken!==sessionToken\)\{purgePrivateClientState\(\);resetIdentityBoundView\(\);\}/);
assert.match(html, /if\(previousUserId&&previousUserId!==nextUserId\)\{purgePrivateClientState\(\);resetIdentityBoundView\(\);\}/);
assert.match(html, /discardStoredMealMutation\(currentUser\?\.userId,common\.clientRequestId\)/);
assert.match(html, /function guardUnresolvedMealDismissal\(\)/);
assert.match(html, /if\(wasOpen&&hasUnresolvedMealMutation\(\)\)/);
assert.match(html, /if\(hasUnresolvedMealMutation\(\)\)\{openSheet\("meal-form"\);guardUnresolvedMealDismissal\(\);return;\}/);
assert.match(html, /form\.dataset\.mealMutationUnresolved="true"/);
assert.match(html, /確認儲存狀態…/);
assert.match(html, /manualWrite&&isWriteStatusUnknownError\(err\)/);
assert.match(html, /"clientRequestId","mealMutationPayload","mealMutationOperation","mealMutationUnresolved"/);
assert.match(html, /餐點尚未寫入，請重試；系統會沿用相同請求編號與原始內容避免重複。/);
assert.match(html, /目前仍無法確認儲存狀態；請稍後以相同表單重試原始內容。/);
assert.match(html, /reconcileMealWrite\(clientRequestId,"DELETE",deletePayload\)/);
assert.match(html, /settleDetachedMealMutation\(mutationUser\?\.userId,common\.clientRequestId\)/);
assert.match(html, /mealMutationEnvelope\(form,deletePayloadLive,"DELETE",\{date\}\)/);
assert.doesNotMatch(html, /catch\(err\)\{delete form\.dataset\.clientRequestId/);

function sourceOf(name) {
  const match = html.match(new RegExp(`(?:async )?function ${name}\\([^\\n]+`));
  assert.ok(match, `${name} source must exist`);
  return match[0];
}

async function main() {
  const classification = {};
  vm.runInNewContext(
    `${sourceOf('classifyRequestError')}\n${sourceOf('isWriteStatusUnknownError')}\n` +
      `result={network:classifyRequestError(new TypeError('Failed to fetch')),timeout:classifyRequestError({code:'REQUEST_TIMEOUT'}),server:classifyRequestError(new Error('HTTP 500')),malformed:isWriteStatusUnknownError({code:'MALFORMED_RESPONSE'})};`,
    classification
  );
  assert.deepStrictEqual({ ...classification.result }, { network: 'NETWORK_FAILURE', timeout: 'REQUEST_TIMEOUT', server: 'SERVER_ERROR', malformed: true });

  const buttonContext = {};
  vm.runInNewContext(`${sourceOf('setMealSaveState')}\nbutton={textContent:'加入今日飲食',dataset:{},disabled:false,setAttribute(name,value){this[name]=value;}};setMealSaveState(button,'saving');`, buttonContext);
  assert.strictEqual(buttonContext.button.disabled, true, 'first tap must synchronously disable save');
  assert.strictEqual(buttonContext.button.textContent, '儲存中…');
  assert.strictEqual(buttonContext.button['aria-busy'], 'true');
  vm.runInContext(`setMealSaveState(button,'reconciling');`, buttonContext);
  assert.strictEqual(buttonContext.button.textContent, '確認儲存狀態…');
  vm.runInContext(`setMealSaveState(button,'idle');`, buttonContext);
  assert.strictEqual(buttonContext.button.disabled, false);
  assert.strictEqual(buttonContext.button['aria-busy'], 'false');

  const saveButton={textContent:'加入今日飲食',dataset:{},disabled:false,setAttribute(name,value){this[name]=value;}},deleteButton={textContent:'刪除',dataset:{},disabled:false,setAttribute(name,value){this[name]=value;}};
  const lockContext={saveButton,deleteButton,document:{getElementById:id=>id==='meal-save'?saveButton:deleteButton},setSubmitting(button,on){button.disabled=on;button.setAttribute('aria-busy',String(on));}};
  vm.runInNewContext(`${sourceOf('setMealSaveState')}\n${sourceOf('setMealMutationState')}\nsetMealMutationState('SAVE','saving');`,lockContext);
  assert.equal(saveButton.disabled,true);assert.equal(deleteButton.disabled,true,'save must lock delete on the same sheet');
  vm.runInContext(`setMealMutationState('SAVE','idle');setMealMutationState('DELETE','saving');`,lockContext);
  assert.equal(saveButton.disabled,true,'delete must lock save on the same sheet');assert.equal(deleteButton.disabled,true);
  vm.runInContext(`setMealMutationState('DELETE','idle');`,lockContext);
  assert.equal(saveButton.disabled,false);assert.equal(deleteButton.disabled,false);

  const envelopeContext={JSON};
  envelopeContext.currentUser={userId:'A'};envelopeContext.resetMealMutationClientState=()=>{};envelopeContext.persistMealMutationEnvelope=()=>true;
  vm.runInNewContext(`${sourceOf('mealMutationEnvelope')}\nform={dataset:{mutationUserId:'A'}};first=mealMutationEnvelope(form,{clientRequestId:'same-id',foodName:'原始餐點',calories:500});second=mealMutationEnvelope(form,{clientRequestId:'same-id',foodName:'被修改餐點',calories:900});`,envelopeContext);
  assert.deepStrictEqual({...envelopeContext.second},{clientRequestId:'same-id',foodName:'原始餐點',calories:500},'uncertain retry must replay the immutable first payload');

  const durableStorage={getItem(key){return Object.hasOwn(this,key)?this[key]:null;},setItem(key,value){this[key]=String(value);},removeItem(key){delete this[key];}};
  const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{id,value:'',checked:false,hidden:false,dataset:{},reset(){this.resetCalls=(this.resetCalls||0)+1;},setAttribute(){}});return elements.get(id);};
  const durableContext={JSON,Date,MEAL_MUTATION_STORAGE_PREFIX:'healthCompanionMealMutation:v2:',MEAL_MUTATION_TTL:86400000,localStorage:durableStorage,currentUser:{userId:'A'},providerScope:'provider-a',document:{getElementById:element},setValue(){},setMealMutationFieldsLocked(value){durableContext.locked=value;},setMealMutationState(){}};durableContext.mealMutationProviderScope=()=>durableContext.providerScope;
  vm.runInNewContext([sourceOf('mealMutationStorageKey'),sourceOf('discardStoredMealMutation'),sourceOf('persistMealMutationEnvelope'),sourceOf('readStoredMealMutation'),sourceOf('resetMealMutationClientState'),sourceOf('restorePendingMealMutationForCurrentUser')].join('\n'),durableContext);
  const original={clientRequestId:'stable-request',mealRecordId:'meal-1',revision:7,date:'2026-09-19',time:'12:00',mealType:'午餐',foodName:'原始餐點',calories:500,userConfirmed:true,labelMode:false};
  assert.equal(durableContext.persistMealMutationEnvelope(original),true);
  assert.equal(durableContext.restorePendingMealMutationForCurrentUser(),true,'same canonical user must recover the exact envelope after reload');
  assert.equal(element('meal-food').value,'原始餐點');assert.equal(element('meal-form').dataset.mealMutationUnresolved,'true');assert.equal(element('meal-form').dataset.mutationUserId,'A');assert.equal(JSON.parse(element('meal-form').dataset.mealMutationPayload).revision,7,'edit replay must retain the exact transport revision');
  durableContext.providerScope='provider-b';
  assert.equal(durableContext.restorePendingMealMutationForCurrentUser(),false,'same user on another provider must not restore or replay the prior provider envelope');
  durableContext.providerScope='provider-a';
  assert.equal(durableContext.restorePendingMealMutationForCurrentUser(),true);
  durableContext.resetMealMutationClientState(element('meal-form'));
  durableContext.currentUser={userId:'B'};
  assert.equal(durableContext.restorePendingMealMutationForCurrentUser(),false,'a new user must never recover the prior user envelope');
  assert.equal(Object.keys(durableStorage).some(key=>key.includes('provider-a')&&key.endsWith(':A')),false,'logout/reset must remove the exact prior user/provider envelope');

  durableContext.currentUser={userId:'A'};durableContext.providerScope='provider-a';
  assert.equal(durableContext.persistMealMutationEnvelope(original),true);
  const switchCalls=[];
  const switchContext={currentUser:{userId:'A'},currentAccess:{status:'BETA'},hostedManualBinding:null,purgePrivateClientState(){switchCalls.push('purge');for(const key of Object.keys(durableStorage))if(key.startsWith('healthCompanionMealMutation:v2:'))durableStorage.removeItem(key);},resetIdentityBoundView(){switchCalls.push('reset');this.currentUser=null;this.currentAccess=null;},restorePendingMealMutationForCurrentUser(){switchCalls.push('restore');return false;}};
  vm.runInNewContext(`${sourceOf('applyAuthenticatedUser')}\nresult=applyAuthenticatedUser({user:{userId:'B',name:'User B'},access:{status:'BETA'}});`,switchContext);
  assert.deepStrictEqual(switchCalls,['purge','reset','restore'],'real canonical-user switch must purge private storage before resetting and restoring');
  assert.equal(Object.keys(durableStorage).some(key=>key.includes('provider-a')&&key.endsWith(':A')),false,'account switch must remove user A health payload from shared-device storage');
  assert.equal(switchContext.result.userId,'B');

  durableContext.currentUser={userId:'A'};durableContext.providerScope='provider-a';
  const deletePayload={clientRequestId:'stable-delete',mealRecordId:'meal-1',revision:7};
  assert.equal(durableContext.persistMealMutationEnvelope(deletePayload,'A','DELETE',{date:'2026-09-19'}),true);
  assert.equal(durableContext.restorePendingMealMutationForCurrentUser(),true,'ambiguous delete must survive reload');
  assert.equal(element('meal-form').dataset.deleteRequestId,'stable-delete');assert.equal(element('meal-form').dataset.mealMutationOperation,'DELETE');assert.equal(element('meal-date').value,'2026-09-19');assert.equal(element('meal-save').disabled,true);

  const dismissContext={toastCalls:0,focusCalls:0,history:{state:{},pushState(state){this.state=state;}},document:{getElementById(id){if(id==='meal-form')return{dataset:{mealMutationUnresolved:'true'}};if(id==='meal-save')return{focus(){dismissContext.focusCalls++;}};return{classList:{contains:()=>true}};}},toast(){dismissContext.toastCalls++;}};
  vm.runInNewContext(`${sourceOf('hasUnresolvedMealMutation')}\n${sourceOf('guardUnresolvedMealDismissal')}\nblocked=guardUnresolvedMealDismissal();`,dismissContext);
  assert.equal(dismissContext.blocked,true);assert.equal(dismissContext.toastCalls,1);assert.equal(dismissContext.focusCalls,1);

  let calls = 0;
  const reconciliationContext = {
    apiService: { getMealWriteStatus: async () => (++calls === 2 ? { exists: true, operation: 'UPSERT', recordId: 'MEAL-1' } : { exists: false }) },
    assertManualResponseShape() {},
    setTimeout(callback) { callback(); },
    Promise,
  };
  vm.createContext(reconciliationContext);
  vm.runInContext(sourceOf('reconcileMealWrite'), reconciliationContext);
  const afterWrite = await reconciliationContext.reconcileMealWrite('operation-1');
  assert.strictEqual(afterWrite.exists, true, 'lost response after write must reconcile to the committed row');
  assert.strictEqual(calls, 2);

  reconciliationContext.apiService.getMealWriteStatus = async () => ({ exists: false });
  const beforeWrite = await reconciliationContext.reconcileMealWrite('operation-2');
  assert.deepStrictEqual({ confirmed: beforeWrite.confirmed, exists: beforeWrite.exists }, { confirmed: true, exists: false });

  reconciliationContext.apiService.getMealWriteStatus = async () => ({ exists: true, operation: 'DELETE', deleted: true, recordId: 'MEAL-1' });
  const afterDelete = await reconciliationContext.reconcileMealWrite('operation-delete', 'DELETE');
  assert.deepStrictEqual({ confirmed: afterDelete.confirmed, exists: afterDelete.exists }, { confirmed: true, exists: true });

  reconciliationContext.apiService.getMealWriteStatus = async () => ({ exists: true, operation: 'UPSERT', deleted: false, recordId: 'MEAL-1' });
  const wrongReceipt = await reconciliationContext.reconcileMealWrite('operation-delete-wrong', 'DELETE');
  assert.deepStrictEqual({ confirmed: wrongReceipt.confirmed, exists: wrongReceipt.exists, mismatch: wrongReceipt.mismatch }, { confirmed: true, exists: false, mismatch: true });

  console.log('Meal write reconciliation regression tests: PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
