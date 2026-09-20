// Hook for the existing real-browser/real-handler/dedicated PostgreSQL runner.
// This module starts no service and reads no ambient credentials. Fixtures are
// entered through the original UI; HTTP/SQL reads below independently verify it.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import path from 'node:path';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  // Route callbacks may fail before the controlling assertion reaches this wait.
  promise.catch(() => {});
  return {promise, resolve, reject};
}

async function bounded(promise, label, milliseconds = 15000) {
  let timer;
  try {return await Promise.race([promise, new Promise((_, reject) => {timer = setTimeout(() => reject(Error(label)), milliseconds);})]);}
  finally {clearTimeout(timer);}
}

export async function runManualObservationBrowserGates(h) {
  const {pg, subjects, gate, browserContext, until, shift, customRange, http, loginCookie, base, report, evidence} = h;
  assert.equal(new URL(base).hostname, '127.0.0.1');
  assert.equal(pg.config.host, '127.0.0.1');
  assert.match(pg.config.database, /^health_engine_[a-f0-9]{32}$/);
  assert.equal(pg.evidence.synthetic_only, true);
  assert.equal(pg.evidence.remote, false);
  const A = subjects.A.canonical, B = subjects.B.canonical;
  assert.notEqual(A, B);
  const endpoint = base + '/v1/engine/web';
  const proof = report.manual_observation_browser = {
    classification: report.actual_edge?'EXISTING_BROWSER_ACTUAL_EDGE_POSTGRES_SYNTHETIC_AUTH_NOT_DEVICE':'EXISTING_BROWSER_REAL_HTTP_POSTGRES_SYNTHETIC_AUTH_NOT_EDGE_OR_DEVICE',
    dates: {cumulative: shift(-10), duration: shift(-11), timed: shift(-12), timedStart: shift(-13), raceOld: shift(-14), raceNew: shift(-15), responseLoss: shift(-16)},
    mutations: 'ORIGINAL_QUICK_FORM_AND_RECORD_EDIT_DELETE_CONTROLS',
    mocks: {engine: false, persistence: false, authorization: false, response_data: false},
    assertions: [], barriers: [],
  };
  const raw = (user, date) => pg.admin`select canonical_user_id,record_id,domain,local_date::text as date,revision,deleted,body
    from public.engine_manual_observations where canonical_user_id=${user} and local_date=${date} order by record_id`;
  const live = async (user, date, domain) => (await raw(user, date)).filter(row => !row.deleted && (!domain || row.domain === domain));
  const daily = async (cookie, date) => {
    const result = await http(cookie, 'getManualObservationDaily', {date});
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(Array.isArray(result.data));
    return result.data;
  };
  const browser = async account => {
    // These gates intentionally return to A after opening a fresh B context.
    const entry = await browserContext(account,{preservePrevious:true});
    h.setPage(entry.page);
    return entry;
  };
  const sheetClosed = p => p.locator('#sheet-backdrop').waitFor({state: 'hidden', timeout: 20000});
  async function openQuick(p, domain, date) {
    await p.locator('#quick-open').click();
    await p.locator(`.quick-option[data-observation-add="${domain}"]`).click();
    await p.locator('#observation-form').waitFor({state: 'visible'});
    await until(() => p.locator('#observation-save').isEnabled(), 'initial observation date read');
    await p.locator('#observation-date').fill(date);
    await p.locator('#observation-date').dispatchEvent('change');
    await until(() => p.locator('#observation-save').isEnabled(), 'selected observation date read');
    assert.equal(await p.locator('#observation-domain').inputValue(), domain);
    assert.equal(await p.locator('#observation-date').inputValue(), date);
  }
  async function submit(p) {
    await p.locator('#observation-save').click();
    await sheetClosed(p);
  }
  async function create(p, domain, date, value, extra = {}) {
    await openQuick(p, domain, date);
    await p.locator('#observation-value').fill(String(value));
    await p.locator('#observation-source-note').fill('SYNTHETIC Browser Gate, no device data');
    if (extra.startedAt) await p.locator('#observation-start').fill(extra.startedAt);
    if (extra.endedAt) await p.locator('#observation-end').fill(extra.endedAt);
    if (extra.coverage) await p.locator('#observation-coverage').selectOption(extra.coverage);
    if (extra.cutoffTime) await p.locator('#observation-cutoff').fill(extra.cutoffTime);
    await submit(p);
  }
  async function showRecords(p, section, first, last = first) {
    await p.locator('.mobile-nav-btn[data-screen="dashboard-screen"]').click();
    await p.locator(`${section==='activity'?'.score-domain':'.kpi-card'}[data-target="${section}-screen"]`).click();
    await customRange(p, first, last);
    await until(async () => {
      const state = await p.locator('#' + section + '-screen').getAttribute('data-read-state');
      return state === 'success' || state === 'empty';
    }, section + ' detail read complete');
    await p.locator('#' + section + '-manual-records h3').waitFor({state: 'visible'});
  }
  const card = (p, id) => p.locator(`[data-observation-id="${id}"]`);
  async function edit(p, id) {
    await card(p, id).getByRole('button', {name: '編輯／刪除', exact: true}).click();
    await p.locator('#observation-form').waitFor({state: 'visible'});
    await until(() => p.locator('#observation-save').isEnabled(), 'observation edit ready');
  }
  async function confirmDelete(p, id, answer = 'accept') {
    const expected = '刪除此筆手動紀錄？將保留刪除標記，不會刪除自動來源。';
    const received = deferred();
    const listener = dialog => received.resolve(dialog);
    p.once('dialog', listener);
    const clicked = p.locator('#observation-delete').click({timeout: 8000});
    clicked.catch(error => received.reject(error));
    let dialog;
    try {
      dialog = await bounded(received.promise, 'OBSERVATION_CONFIRM_DIALOG_MISSING', 9000);
      assert.equal(dialog.type(), 'confirm');
      assert.equal(dialog.message(), expected);
      assert.ok(answer === 'accept' || answer === 'dismiss');
      report.dialogs.push({kind: 'manual-observation', record_id: id, action: answer, message: expected, listener: 'once before synthetic UI delete', at: new Date().toISOString()});
      await dialog[answer]();
      dialog = null;
      await clicked;
      if (answer === 'accept') await sheetClosed(p);
    } finally {
      p.off('dialog', listener);
      if (dialog) await dialog.dismiss().catch(() => {});
      await clicked.catch(() => {});
    }
  }

  await gate('manual_quick_add_mobile_layout_and_sleep_duration', async () => {
    const {page: p} = await browser('A'), original = p.viewportSize();
    try {
      const viewports = [{width:360,height:800},{width:393,height:852},{width:412,height:915}];
      for (const {width,height} of viewports) {
        await p.setViewportSize({width, height});
        await p.locator('#quick-open').click();
        await p.locator('#quick-sheet').waitFor({state: 'visible'});
        const layout = await p.locator('.quick-options').evaluate((node, viewportWidth) => {
          const cards = [...node.querySelectorAll('.quick-option')], heights = cards.map(card => card.getBoundingClientRect().height);
          return {count: cards.length, order: cards.map(card => card.querySelector('b')?.textContent?.trim()), minHeight: Math.min(...heights), maxHeight: Math.max(...heights),
            overflow: document.documentElement.scrollWidth > viewportWidth || cards.some(card => card.getBoundingClientRect().right > viewportWidth + 0.5)};
        }, width);
        assert.equal(layout.count, 8);assert.deepEqual(layout.order, ['新增體重','新增體脂','新增訓練','新增飲食','新增睡眠','新增步數','新增總消耗','新增身體狀態']);
        assert.equal(layout.overflow, false);assert.ok(layout.minHeight >= 48);assert.ok(layout.maxHeight - layout.minHeight <= 1);
        const beforeBack = p.url();
        await p.goBack();
        await p.locator('#sheet-backdrop').waitFor({state:'hidden'});
        assert.equal(p.url(), beforeBack, 'Android/browser back closes Quick Add without navigating away');
      }
      await p.locator('#quick-open').click();await p.locator('[data-observation-add="sleep"]').click();
      const wakeDate = proof.dates.duration, startDate = shift(-12);
      await p.locator('#observation-date').fill(wakeDate);await p.locator('#observation-date').dispatchEvent('change');
      await p.locator('#observation-start').fill(startDate+'T23:30');await p.locator('#observation-end').fill(wakeDate+'T07:10');
      assert.equal(await p.locator('#observation-value').inputValue(), '460');assert.match(await p.locator('#observation-status').innerText(), /7 小時 40 分鐘/u);
      await p.locator('#sheet-backdrop').click({position: {x: 2, y: 2}});
      proof.assertions.push({gate: 'quick_add_mobile', viewports, cards: 8, minimum_touch_target_px: 48, android_back_dismiss: true, sleep_cross_date_minutes: 460});
    } finally {if (original) await p.setViewportSize(original);}
  });

  await gate('manual_observation_browser_cumulative_zero_restart_and_account_isolation', async () => {
    const date = proof.dates.cumulative, {page: p} = await browser('A');
    assert.equal((await live(A, date)).length, 0, 'reserved observation fixture date must be empty');
    await create(p, 'steps', date, 6000);
    const first = (await live(A, date, 'steps'))[0];
    assert.equal(first.body.value, 6000);
    assert.equal(first.body.source, 'manual');
    assert.equal(Number(first.revision), 1);
    await openQuick(p, 'steps', date);
    assert.equal(await p.locator('#observation-value').inputValue(), '6000');
    await p.locator('#observation-value').fill('8000');
    await submit(p);
    const revised = await live(A, date, 'steps');
    assert.equal(revised.length, 1);
    assert.equal(revised[0].record_id, first.record_id);
    assert.equal(revised[0].body.value, 8000, 'daily cumulative value must replace, not add to6000');
    assert.equal(Number(revised[0].revision), 2);
    await create(p, 'total_energy', date, 0);
    const energy = (await live(A, date, 'total_energy'))[0];
    assert.equal(energy.body.value, 0);
    const cookie = await loginCookie('A');
    const projection = (await daily(cookie, date))[0];
    assert.equal(projection.steps.value, 8000);
    assert.equal(projection.totalEnergy.value, 0);
    assert.equal(projection.sleep.value, null);

    // A new browser storage context must reconstruct these records from actual SQL.
    const {page: restarted} = await browser('A');
    await showRecords(restarted, 'activity', date);
    await card(restarted, first.record_id).waitFor({state: 'visible'});
    await card(restarted, energy.record_id).waitFor({state: 'visible'});
    assert.match(await card(restarted, first.record_id).innerText(), /步數 8000 count/u);
    assert.match(await card(restarted, energy.record_id).innerText(), /總消耗熱量 0 kcal/u);
    assert.doesNotMatch(await card(restarted, energy.record_id).innerText(), /分數 0/u);
    await edit(restarted, energy.record_id);
    assert.equal(await restarted.locator('#observation-value').inputValue(), '0');
    await restarted.locator('#sheet-backdrop').click({position: {x: 2, y: 2}});

    const {page: other} = await browser('B');
    await showRecords(other, 'activity', date);
    assert.equal(await other.locator('#activity-manual-records [data-observation-id]').count(), 0);
    await openQuick(other, 'steps', date);
    assert.equal(await other.locator('#observation-value').inputValue(), '');
    await other.locator('#observation-value').fill('111');
    await submit(other);
    const otherRow = (await live(B, date, 'steps'))[0];
    assert.notEqual(otherRow.record_id, first.record_id);
    assert.equal((await live(A, date, 'steps'))[0].body.value, 8000);
    assert.equal((await live(B, date, 'steps'))[0].body.value, 111);
    await showRecords(other, 'activity', date);
    assert.equal(await card(other, first.record_id).count(), 0);
    assert.equal(await card(other, energy.record_id).count(), 0);
    await card(other, otherRow.record_id).waitFor({state: 'visible'});
    h.setPage(restarted);
    await restarted.reload();
    await restarted.locator('#local-engine-login').waitFor({state: 'detached'});
    await showRecords(restarted, 'activity', date);
    assert.equal(await card(restarted, otherRow.record_id).count(), 0);
    await card(restarted, first.record_id).waitFor({state: 'visible'});
    await restarted.screenshot({path: path.join(evidence, 'observation-cumulative-zero-persistence.png'), fullPage: true});
    proof.assertions.push({gate: 'cumulative_zero_isolation', date, steps: 8000, totalEnergy: 0, sleep: null, revision: 2, same_record: true, fresh_browser_context: true, different_canonical_users: true});
  });

  await gate('manual_observation_browser_sleep_duration_cross_midnight_sessions_edit_delete', async () => {
    const date = proof.dates.duration, timed = proof.dates.timed, prior = proof.dates.timedStart;
    const cookie = await loginCookie('A'), {page: p} = await browser('A');
    assert.equal((await live(A, date)).length, 0);
    assert.equal((await live(A, timed)).length, 0);
    await create(p, 'sleep', date, 420);
    const duration = (await live(A, date, 'sleep'))[0];
    assert.equal(duration.body.startedAt, null);
    assert.equal(duration.body.endedAt, null);
    for (const key of ['deepSleepMinutes', 'remSleepMinutes', 'efficiency']) assert.equal(Object.hasOwn(duration.body, key), false);
    await create(p, 'sleep', date, 30);
    const second = (await live(A, date, 'sleep')).find(row => row.record_id !== duration.record_id);
    assert.ok(second);
    let projected = (await daily(cookie, date))[0].sleep;
    assert.equal(projected.value, null);
    assert.equal(projected.status, 'OVERLAP_UNRESOLVED');
    await showRecords(p, 'sleep', date);
    await card(p, second.record_id).waitFor({state: 'visible'});
    assert.match(await card(p, duration.record_id).innerText(), /OVERLAP_UNRESOLVED/u);
    // Two genuine browser contexts edit the same stable ID; stale editor reload
    // must fetch that exact session/revision, not the first sleep of the date.
    await edit(p, duration.record_id);
    const {page:other}=await browser('A');await showRecords(other,'sleep',date);await edit(other,duration.record_id);
    await other.locator('#observation-value').fill('425');await submit(other);
    await p.locator('#observation-reload').click();await until(async()=>await p.locator('#observation-value').inputValue()==='425','sleep exact record latest revision');
    await p.locator('#observation-value').fill('420');await submit(p);assert.equal(Number((await live(A,date,'sleep')).find(r=>r.record_id===duration.record_id).revision),3);
    h.setPage(p);await showRecords(p,'sleep',date);
    await edit(p, second.record_id);
    await confirmDelete(p, second.record_id, 'dismiss');
    assert.equal(await p.locator('#observation-form').isVisible(), true);
    assert.equal((await live(A, date, 'sleep')).length, 2);
    await confirmDelete(p, second.record_id);
    assert.equal((await raw(A, date)).find(row => row.record_id === second.record_id).deleted, true);
    assert.equal((await daily(cookie, date))[0].sleep.value, 420);

    await create(p, 'sleep', timed, 420, {startedAt: prior + 'T23:00', endedAt: timed + 'T06:00'});
    const night = (await live(A, timed, 'sleep'))[0];
    assert.equal(night.body.date, timed, 'cross-midnight sleep belongs to wake date');
    assert.equal(night.body.startedAt, new Date(prior + 'T23:00:00+08:00').toISOString());
    assert.equal(night.body.endedAt, new Date(timed + 'T06:00:00+08:00').toISOString());
    await create(p, 'sleep', timed, 30, {startedAt: timed + 'T14:00', endedAt: timed + 'T14:30'});
    const nap = (await live(A, timed, 'sleep')).find(row => row.record_id !== night.record_id);
    assert.ok(nap);
    projected = (await daily(cookie, timed))[0].sleep;
    assert.equal(projected.value, 450);
    assert.equal(projected.status, 'AVAILABLE');
    await showRecords(p, 'sleep', timed);
    await edit(p, nap.record_id);
    await p.locator('#observation-value').fill('20');
    await p.locator('#observation-end').fill(timed + 'T14:20');
    await submit(p);
    const edited = (await live(A, timed, 'sleep')).find(row => row.record_id === nap.record_id);
    assert.equal(edited.body.value, 20);
    assert.equal(Number(edited.revision), 2);
    assert.equal((await daily(cookie, timed))[0].sleep.value, 440);
    await until(async () => /睡眠 20 minute/u.test(await card(p, nap.record_id).innerText()), 'edited sleep value visible');
    await edit(p, night.record_id);
    await confirmDelete(p, night.record_id);
    assert.equal((await daily(cookie, timed))[0].sleep.value, 20);
    await until(async () => await card(p, night.record_id).count() === 0, 'deleted night removed from UI');
    await edit(p, nap.record_id);
    await confirmDelete(p, nap.record_id);
    assert.equal((await live(A, timed, 'sleep')).length, 0);
    assert.deepEqual(await daily(cookie, timed), []);
    assert.ok((await raw(A, timed)).every(row => row.deleted));
    await p.reload();
    await p.locator('#local-engine-login').waitFor({state: 'detached'});
    await showRecords(p, 'sleep', timed);
    assert.equal(await p.locator('#sleep-manual-records [data-observation-id]').count(), 0);
    assert.match(await p.locator('#sleep-manual-records').innerText(), /尚無手動紀錄/u);
    await p.screenshot({path: path.join(evidence, 'observation-sleep-delete-empty.png'), fullPage: true});
    proof.assertions.push({gate: 'sleep_sessions', duration_only_without_fabricated_timing: true, ambiguous_multiple_duration: 'NULL_OVERLAP_UNRESOLVED', timed_total_before: 450, timed_total_after_edit: 440, deletion: 'TOMBSTONES_NO_REVIVAL', cancel_preserved: true});
  });

  await gate('manual_observation_browser_date_read_barrier_prevents_wrong_delete', async () => {
    const oldDate = proof.dates.raceOld, newDate = proof.dates.raceNew;
    const {page: p, context} = await browser('A');
    assert.equal((await live(A, oldDate)).length, 0);
    assert.equal((await live(A, newDate)).length, 0);
    await create(p, 'steps', oldDate, 1400);
    await create(p, 'steps', newDate, 1500);
    const oldRow = (await live(A, oldDate, 'steps'))[0], newRow = (await live(A, newDate, 'steps'))[0];
    await showRecords(p, 'activity', newDate, oldDate);
    await edit(p, oldRow.record_id);
    assert.equal(await p.locator('#observation-value').inputValue(), '1400');
    const reached = deferred(), released = deferred(), finished = deferred();
    let intercepted = false, deletionRequests = 0;
    const observeRequest = request => {if (request.url() === endpoint && request.postDataJSON()?.action === 'deleteManualObservation') deletionRequests++;};
    p.on('request', observeRequest);
    const handler = async route => {
      const input = route.request().postDataJSON();
      // Date inputs may emit both native and explicit change events. Hold every
      // matching real read; a second successful new-date response is not a stale
      // binding defect and must not bypass this test's serialization position.
      if (input?.action !== 'getManualObservations' || input.payload?.domain !== 'steps' || input.payload?.date !== newDate) return route.continue();
      intercepted = true;
      try {
        const response = await route.fetch({timeout: 12000});
        const actual = await response.json();
        assert.equal(actual.ok, true);
        assert.ok(actual.data.some(row => row.recordId === newRow.record_id && row.value === 1500));
        reached.resolve();
        await bounded(released.promise, 'OBSERVATION_DATE_RESPONSE_RELEASE_TIMEOUT', 15000);
        await route.fulfill({response});
        finished.resolve();
      } catch (error) {
        reached.reject(error); finished.reject(error);
        await route.abort('failed').catch(() => {});
      }
    };
    await context.route(endpoint, handler);
    try {
      await p.locator('#observation-date').fill(newDate);
      await p.locator('#observation-date').dispatchEvent('change');
      await bounded(reached.promise, 'OBSERVATION_DATE_REAL_READ_NOT_REACHED');
      assert.equal(await p.locator('#observation-save').isDisabled(), true);
      const deleteButton = p.locator('#observation-delete');
      assert.equal(await deleteButton.isHidden() || await deleteButton.isDisabled(), true, 'delete must not retain old record ownership while new date is loading');
      assert.equal(deletionRequests, 0);
      assert.equal((await live(A, oldDate, 'steps'))[0].body.value, 1400);
      released.resolve();
      await bounded(finished.promise, 'OBSERVATION_DATE_REAL_RESPONSE_NOT_DELIVERED');
      await until(async () => await p.locator('#observation-value').inputValue() === '1500' && await p.locator('#observation-save').isEnabled(), 'new observation date bound');
    } finally {
      released.resolve();
      if (intercepted) await bounded(finished.promise, 'OBSERVATION_DATE_ROUTE_CLEANUP_TIMEOUT').catch(() => {});
      await context.unroute(endpoint, handler);
      p.off('request', observeRequest);
    }
    await confirmDelete(p, newRow.record_id);
    const afterOld = (await raw(A, oldDate))[0], afterNew = (await raw(A, newDate))[0];
    assert.equal(afterOld.deleted, false);
    assert.equal(afterOld.body.value, 1400);
    assert.equal(Number(afterOld.revision), 1);
    assert.equal(afterNew.deleted, true);
    assert.equal(Number(afterNew.revision), 2);
    proof.barriers.push({kind: 'REAL_SELECT_RESPONSE_HELD_BEFORE_DATE_REBIND', old_date: oldDate, new_date: newDate, old_record_untouched: true, intended_new_record_tombstoned: true, data_mocked: false});
  });

  await gate('manual_observation_browser_committed_response_loss_recovers_stable_receipt', async () => {
    const date = proof.dates.responseLoss, {page: p, context} = await browser('A');
    assert.equal((await live(A, date)).length, 0);
    await openQuick(p, 'steps', date);
    await p.locator('#observation-value').fill('1600');
    await p.locator('#observation-source-note').fill('SYNTHETIC committed-response-loss');
    const committed = deferred(), done = deferred();
    let lost = false, captured;
    const handler = async route => {
      const request = route.request(), input = request.postDataJSON();
      if (lost || input?.action !== 'upsertManualObservation' || input.payload?.date !== date) return route.continue();
      lost = true;
      try {
        const actual = await route.fetch({timeout: 20000}), body = await actual.json();
        assert.equal(actual.ok(), true);
        assert.equal(body.ok, true);
        assert.equal(body.data.status, 'SAVED');
        const row = (await live(A, date, 'steps'))[0];
        assert.equal(row.record_id, body.data.recordId);
        assert.equal(row.body.value, 1600);
        const receipts = await pg.admin`select request_id,response from private.engine_observation_receipts where canonical_user_id=${A} and request_id=${input.payload.clientRequestId}`;
        assert.equal(receipts.length, 1);
        captured = {request_id: input.payload.clientRequestId, record_id: row.record_id, actual_http_status: actual.status(), payload_sha256: createHash('sha256').update(request.postData()).digest('hex')};
        committed.resolve();
        await route.abort('failed');
        done.resolve();
      } catch (error) {committed.reject(error); done.reject(error); await route.abort('failed').catch(() => {});}
    };
    await context.route(endpoint, handler);
    const receiptResponse = p.waitForResponse(response => response.url() === endpoint && response.request().postDataJSON()?.action === 'getObservationWriteStatus', {timeout: 25000});
    receiptResponse.catch(() => {});
    try {
      await p.locator('#observation-save').click();
      await bounded(committed.promise, 'OBSERVATION_WRITE_DID_NOT_COMMIT', 25000);
      await bounded(done.promise, 'OBSERVATION_RESPONSE_NOT_ABORTED');
      const response = await receiptResponse, request = response.request().postDataJSON();
      assert.equal(request.payload.clientRequestId, captured.request_id);
      const receipt = await response.json();
      assert.equal(receipt.ok, true);
      assert.equal(receipt.data.exists, true);
      assert.equal(receipt.data.recordId, captured.record_id);
      await sheetClosed(p);
      assert.equal((await live(A, date, 'steps')).length, 1);
      assert.equal(Number((await live(A, date, 'steps'))[0].revision), 1);
      assert.equal((await pg.admin`select count(*)::int as n from private.engine_observation_receipts where canonical_user_id=${A} and request_id=${captured.request_id}`)[0].n, 1);
      await showRecords(p, 'activity', date);
      await card(p, captured.record_id).waitFor({state: 'visible'});
      assert.match(await card(p, captured.record_id).innerText(), /步數 1600 count/u);
      proof.barriers.push({kind: 'ABORT_AFTER_REAL_WRITE_AND_RECEIPT_COMMIT', ...captured, receipt_queried_with_original_request_id: true, rows: 1, revision: 1, mocked_response: false});
    } finally {
      await context.unroute(endpoint, handler);
      if (lost) await bounded(done.promise, 'OBSERVATION_ABORT_ROUTE_CLEANUP_TIMEOUT').catch(() => {});
    }
  });
}
