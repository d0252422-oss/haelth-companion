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
assert.match(html, /async function reconcileMealWrite\(clientRequestId\)/);
assert.match(html, /for\(const delayMs of \[0,700,1400\]\)/);
assert.match(html, /function setMealSaveState\(button,state="idle"\)/);
assert.match(html, /確認儲存狀態…/);
assert.match(html, /manualWrite&&isWriteStatusUnknownError\(err\)/);
assert.match(html, /delete form\.dataset\.clientRequestId/);
assert.match(html, /餐點尚未寫入，請重試；系統會沿用相同請求編號避免重複。/);
assert.match(html, /目前仍無法確認儲存狀態；請稍後以相同表單重試。/);
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
  vm.runInNewContext(`${sourceOf('setMealSaveState')}\nbutton={textContent:'加入今日飲食',dataset:{},disabled:false};setMealSaveState(button,'saving');`, buttonContext);
  assert.strictEqual(buttonContext.button.disabled, true, 'first tap must synchronously disable save');
  assert.strictEqual(buttonContext.button.textContent, '儲存中…');
  vm.runInContext(`setMealSaveState(button,'reconciling');`, buttonContext);
  assert.strictEqual(buttonContext.button.textContent, '確認儲存狀態…');
  vm.runInContext(`setMealSaveState(button,'idle');`, buttonContext);
  assert.strictEqual(buttonContext.button.disabled, false);

  let calls = 0;
  const reconciliationContext = {
    apiService: { getMealWriteStatus: async () => (++calls === 2 ? { exists: true, recordId: 'MEAL-1' } : { exists: false }) },
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

  console.log('Meal write reconciliation regression tests: PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
