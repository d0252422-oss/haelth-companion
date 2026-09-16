// Imported only by the owned real HTTP/native PostgreSQL runner. Never starts a
// server or reads ambient DB/auth configuration. All observations are synthetic.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import postgres from 'postgres';

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject}; }
async function bounded(promise, label, ms = 5000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {timer = setTimeout(() => reject(Error(label)), ms);})]); }
  finally { clearTimeout(timer); }
}
export async function runManualObservationPgGates(h) {
  const {pg, subjects, gate, http, loginCookie, shift, until, report} = h;
  assert.equal(pg.config.host, '127.0.0.1');
  assert.match(pg.config.database, /^health_engine_[a-f0-9]{32}$/);
  assert.equal(pg.evidence.synthetic_only, true); assert.equal(pg.evidence.remote, false);
  const A = subjects.A.canonical, B = subjects.B.canonical;
  assert.notEqual(A, subjects.A.auth);
  const a = await loginCookie('A'), b = await loginCookie('B');
  report.manual_observation_evidence = {classification: report.actual_edge?'ACTUAL_EDGE_AND_NATIVE_POSTGRES_SYNTHETIC_AUTH_NOT_LIVE_OAUTH':'ACTUAL_HTTP_AND_NATIVE_POSTGRES_SYNTHETIC_AUTH_NOT_EDGE_OR_LIVE_OAUTH', barriers: [], assertions: []};
  const proof = report.manual_observation_evidence;
  const call = async (cookie, action, payload = {}) => {const response = await http(cookie, action, payload); assert.equal(response.ok, true, JSON.stringify(response)); return response.data;};
  const save = payload => call(a, 'upsertManualObservation', {clientRequestId: randomUUID(), ...payload});
  const read = (date, domain) => call(a, 'getManualObservations', {date, ...(domain ? {domain} : {})});
  const daily = date => call(a, 'getManualObservationDaily', {date});
  const status = id => call(a, 'getObservationWriteStatus', {clientRequestId: id});
  const remove = row => call(a, 'deleteManualObservation', {recordId: row.recordId, revision: row.revision, clientRequestId: randomUUID()});
  const raw = id => pg.admin`select record_id,domain,local_date::text as date,revision,deleted,body from public.engine_manual_observations where canonical_user_id=${A} and record_id=${id}`;
  const base = (domain, date, value, extra = {}) => ({domain, date, timezone: 'Asia/Taipei', value, coverage: domain === 'sleep' ? 'SESSION' : 'FULL_DAY', sourceNote: 'SYNTHETIC integration fixture', ...extra});
  const noReceipt = async id => assert.equal((await pg.admin`select count(*)::int as n from private.engine_observation_receipts where canonical_user_id=${A} and request_id=${id}`)[0].n, 0);

  // Holding connection is a distinct real service_role connection. pg.admin has
  // max:1 in the harness, so it must NOT be used as the holder and observer alike.
  async function withCanonicalLock(work) {
    const sql = postgres({...pg.config, max: 1, connect_timeout: 5, connection: {application_name: 'manual_observation_barrier', lock_timeout: 2000, statement_timeout: 5000}});
    const acquired = deferred(), released = deferred();
    const holding = sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${A},0))`;
      const [owner] = await tx`select pg_backend_pid() as pid,current_user as role`;
      acquired.resolve(owner); await released.promise;
    });
    holding.catch(error => acquired.reject(error));
    try { const owner = await bounded(acquired.promise, 'OBSERVATION_HOLDER_BARRIER_TIMEOUT'); return await work(owner, () => released.resolve()); }
    finally { released.resolve(); try {await holding;} finally {await sql.end({timeout: 5});} }
  }
  const waitingWriters = holderPid => pg.admin`select pid,wait_event_type,wait_event from pg_stat_activity
    where datname=current_database() and pid<>${holderPid} and wait_event_type='Lock' and wait_event='advisory'
    and query like '%pg_advisory_xact_lock%'`;

  await gate('manual_observation_sql_crud_cumulative_totals_receipts_and_nulls', async () => {
    const date = shift(-41), request = {...base('steps', date, 6000), clientRequestId: randomUUID()};
    const [first, duplicate] = await Promise.all([call(a, 'upsertManualObservation', request), call(a, 'upsertManualObservation', request)]);
    assert.equal(first.recordId, duplicate.recordId); assert.ok(first.replayed || duplicate.replayed);
    assert.equal(Number((await raw(first.recordId))[0].revision), 1);
    assert.equal((await read(date, 'steps'))[0].value, 6000);
    const recovered = await status(request.clientRequestId); assert.equal(recovered.exists, true); assert.equal(recovered.recordId, first.recordId);
    // Receipt lookup proves post-commit recovery without inventing a new request ID.
    assert.equal((await http(a, 'upsertManualObservation', {...request, value: 6001})).error, 'REQUEST_ID_CONFLICT');
    const energy = await save(base('total_energy', date, 2200.5));
    const changed = await save({recordId: first.recordId, revision: 1, value: 8000});
    assert.equal(changed.recordId, first.recordId); assert.equal(changed.record.value, 8000); assert.equal(changed.record.revision, 2);
    let projection = (await daily(date))[0]; assert.equal(projection.steps.value, 8000); assert.equal(projection.totalEnergy.value, 2200.5);
    assert.equal((await pg.admin`select count(*)::int as n from public.engine_manual_observations where canonical_user_id=${A} and local_date=${date} and domain='steps' and not deleted`)[0].n, 1);
    const zero = await save({recordId: energy.recordId, revision: 1, value: 0});
    projection = (await daily(date))[0]; assert.equal(projection.totalEnergy.value, 0); assert.equal(projection.steps.value, 8000);
    const snapshot = await raw(zero.recordId), invalid = {recordId: zero.recordId, revision: 2, value: null, clientRequestId: randomUUID()};
    assert.equal((await http(a, 'upsertManualObservation', invalid)).error, 'INVALID_OBSERVATION_VALUE'); await noReceipt(invalid.clientRequestId); assert.deepEqual(await raw(zero.recordId), snapshot);
    const noteOnly = await save({recordId: zero.recordId, revision: 2, note: 'SYNTHETIC omitted value preserves zero'}); assert.equal(noteOnly.record.value, 0);
    for (const value of ['', -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const bad = {...base('steps', shift(-42), value), clientRequestId: randomUUID()};
      assert.equal((await http(a, 'upsertManualObservation', bad)).error, 'INVALID_OBSERVATION_VALUE'); await noReceipt(bad.clientRequestId);
    }
    assert.equal((await read(shift(-42))).length, 0);
    const partial = await save(base('steps', shift(-43), 500, {coverage: 'PARTIAL_DAY', cutoffTime: '12:30'}));
    assert.equal((await daily(shift(-43)))[0].steps.status, 'PARTIAL_DAY');
    assert.equal((await read(shift(-43), 'steps'))[0].cutoffTime, '12:30');
    const full = await save({recordId: partial.recordId, revision: 1, coverage: 'FULL_DAY', cutoffTime: null});
    assert.equal(full.record.value, 500); assert.equal(full.record.cutoffTime, null);
    const missingCutoff = {...base('steps', shift(-44), 500, {coverage: 'PARTIAL_DAY'}), clientRequestId: randomUUID()};
    assert.equal((await http(a, 'upsertManualObservation', missingCutoff)).error, 'INVALID_OBSERVATION_CUTOFF'); await noReceipt(missingCutoff.clientRequestId);
    assert.equal((await http(a, 'upsertManualObservation', {recordId: changed.recordId, revision: 1, value: 9000, clientRequestId: randomUUID()})).error, 'STALE_REVISION');
    await remove(changed.record); await remove(noteOnly.record); assert.equal((await read(date)).length, 0);
    assert.equal((await raw(changed.recordId))[0].deleted, true);
    proof.assertions.push({gate: 'raw_crud', stable_record_id: true, cumulative_not_increment: true, zero_not_missing: true, omitted_preserves_other_values: true,
      independent_metrics: true, post_commit_receipt_recovery: true, transport_drop_simulated_here: false, deletion: 'TOMBSTONE'});
  });

  await gate('manual_sleep_duration_timed_sessions_overlap_and_source_conflicts', async () => {
    const durationDate = shift(-45), timedDate = shift(-46), prior = shift(-47);
    const duration = await save(base('sleep', durationDate, 420));
    let row = (await read(durationDate, 'sleep'))[0]; assert.equal(row.value, 420); assert.equal(row.startedAt, null); assert.equal(row.endedAt, null);
    assert.equal('deepSleepMinutes' in row || 'remSleepMinutes' in row || 'efficiency' in row, false);
    const second = await save(base('sleep', durationDate, 30));
    assert.equal((await daily(durationDate))[0].sleep.status, 'OVERLAP_UNRESOLVED'); assert.equal((await daily(durationDate))[0].sleep.value, null);
    await remove(second.record); assert.equal((await daily(durationDate))[0].sleep.value, 420);
    const night = await save(base('sleep', timedDate, 420, {startedAt: prior + 'T23:00:00+08:00', endedAt: timedDate + 'T06:00:00+08:00'}));
    const nap = await save(base('sleep', timedDate, 30, {startedAt: timedDate + 'T14:00:00+08:00', endedAt: timedDate + 'T14:30:00+08:00'}));
    let projected = (await daily(timedDate))[0]; assert.equal(projected.sleep.value, 450); assert.equal(projected.sleep.status, 'AVAILABLE');
    const overlap = await save(base('sleep', timedDate, 30, {startedAt: timedDate + 'T05:30:00+08:00', endedAt: timedDate + 'T06:00:00+08:00'}));
    projected = (await daily(timedDate))[0]; assert.equal(projected.sleep.value, null); assert.equal(projected.sleep.status, 'OVERLAP_CONFLICT');
    await remove(overlap.record);
    const revised = await save({recordId: nap.recordId, revision: 1, value: 20}); assert.equal(revised.record.value, 20);
    assert.equal((await daily(timedDate))[0].sleep.value, 440);
    // Synthetic automatic observations enter their true native table as fixtures;
    // manual observations never claim native platform/source identity.
    const automaticId = randomUUID(), hash = createHash('sha256').update(automaticId).digest('hex');
    await pg.admin`insert into public.beta_health_records(canonical_user_id,platform,domain,source_app,source_record_id,source_revision,source_content_hash,idempotency_key,operation,canonical_record,affected_local_dates)
      values(${A},'android','sleep','SYNTHETIC automatic conflict fixture',${automaticId},1,${hash},${hash},'UPSERT',${pg.admin.json({domain:'sleep',recorded_at:timedDate+'T06:00:00+08:00',started_at:prior+'T23:00:00+08:00',ended_at:timedDate+'T06:00:00+08:00',value:420,unit:'minute'})},array[${timedDate}::date])`;
    projected = (await daily(timedDate))[0]; assert.equal(projected.sleep.status, 'SOURCE_CONFLICT'); assert.equal(projected.sleep.value, null);
    assert.ok((await read(timedDate, 'sleep')).every(r => r.reconciliationStatus === 'SOURCE_CONFLICT'));
    assert.equal((await raw(night.recordId))[0].body.source, 'manual');
    assert.equal((await raw(duration.recordId))[0].body.startedAt, null);
    const stepsDate = shift(-48), steps = await save(base('steps', stepsDate, 8000)), energy = await save(base('total_energy', stepsDate, 2200));
    const stepAutoId = randomUUID(), stepHash = createHash('sha256').update(stepAutoId).digest('hex');
    await pg.admin`insert into public.beta_health_records(canonical_user_id,platform,domain,source_app,source_record_id,source_revision,source_content_hash,idempotency_key,operation,canonical_record,affected_local_dates)
      values(${A},'android','steps','SYNTHETIC automatic conflict fixture',${stepAutoId},1,${stepHash},${stepHash},'UPSERT',${pg.admin.json({domain:'steps',recorded_at:stepsDate+'T23:00:00+08:00',value:9000,unit:'count'})},array[${stepsDate}::date])`;
    const stepConflict = (await daily(stepsDate))[0]; assert.equal(stepConflict.steps.status, 'SOURCE_CONFLICT'); assert.equal(stepConflict.steps.value, null); assert.equal(stepConflict.totalEnergy.value, 2200);
    assert.equal((await raw(steps.recordId))[0].body.value, 8000); assert.equal((await raw(energy.recordId))[0].body.value, 2200);
    proof.assertions.push({gate: 'sleep_semantics', duration_only_without_fake_interval: true, wake_date_cross_midnight: true, distinct_sessions: true,
      overlap_conflict: true, unknown_overlap_conflict: true, manual_auto_conflict: ['sleep', 'steps'], automatic_fixture_rows_created: 2,
      native_total_energy_conflict_fixture: 'NOT_SUPPORTED_BY_EXISTING_NATIVE_DOMAIN_CONTRACT'});
  });

  await gate('manual_observation_http_authorization_and_low_privilege_rls', async () => {
    const date = shift(-50), own = await save(base('steps', date, 0));
    const other = await call(b, 'upsertManualObservation', {...base('steps', date, 111), clientRequestId: randomUUID()});
    assert.ok((await read(date)).every(r => r.recordId !== other.recordId));
    assert.ok((await call(b, 'getManualObservations', {date})).every(r => r.recordId !== own.recordId));
    for (const action of ['upsertManualObservation', 'deleteManualObservation']) {
      const denied = await http(a, action, {recordId: other.recordId, revision: 1, value: 222, clientRequestId: randomUUID()});
      assert.equal(denied.ok, false); assert.equal(denied.error, 'OBSERVATION_NOT_FOUND');
    }
    assert.equal((await http(a, 'getManualObservations', {date, user_id: B})).error, 'CLIENT_IDENTITY_FORBIDDEN');
    assert.equal((await http(a, 'upsertManualObservation', {...base('sleep', date, 1), canonical_user_id: B, clientRequestId: randomUUID()})).error, 'CLIENT_IDENTITY_FORBIDDEN');
    for (const cookie of [null, 'engine_session=invalid.signature.token', await loginCookie('A', {expired: true}), await loginCookie('MISSING')]) {
      assert.equal((await http(cookie, 'getManualObservations', {date})).ok, false);
      assert.equal((await http(cookie, 'upsertManualObservation', {...base('sleep', date, 1), clientRequestId: randomUUID()})).ok, false);
    }
    const userRead = async (auth, target) => pg.admin.begin(async tx => {
      await tx.unsafe('set local role authenticated'); await tx`select set_config('request.jwt.claim.sub',${auth},true)`;
      const role = (await tx`select current_user as role,rolsuper,rolbypassrls from pg_roles where rolname=current_user`)[0];
      const rows = await tx`select record_id from public.engine_manual_observations where canonical_user_id=${target}`;
      return {role, rows};
    });
    const ownLow = await userRead(subjects.A.auth, A), crossLow = await userRead(subjects.B.auth, A);
    assert.ok(ownLow.rows.some(r => r.record_id === own.recordId)); assert.equal(crossLow.rows.length, 0);
    assert.equal(ownLow.role.role, 'authenticated'); assert.equal(ownLow.role.rolsuper, false); assert.equal(ownLow.role.rolbypassrls, false);
    const owner = (await pg.admin`select tableowner from pg_tables where schemaname='public' and tablename='engine_manual_observations'`)[0].tableowner;
    assert.notEqual(owner, ownLow.role.role);
    await assert.rejects(() => pg.admin.begin(async tx => {await tx.unsafe('set local role anon'); await tx`select * from public.engine_manual_observations`;}), error => error.code === '42501');
    await assert.rejects(() => pg.admin.begin(async tx => {await tx.unsafe('set local role authenticated'); await tx`select set_config('request.jwt.claim.sub',${subjects.A.auth},true)`; await tx`update public.engine_manual_observations set deleted=true where canonical_user_id=${A} and record_id=${own.recordId}`;}), error => error.code === '42501');
    for (const role of ['anon', 'authenticated']) await assert.rejects(() => pg.admin.begin(async tx => {await tx.unsafe('set local role ' + role); await tx`select * from private.engine_observation_receipts`;}), error => error.code === '42501');
    assert.equal((await raw(own.recordId))[0].deleted, false);
    assert.equal((await call(b, 'getManualObservations', {date})).find(r => r.recordId === other.recordId).value, 111);
    proof.rls = {role: ownLow.role.role, superuser: false, bypassrls: false, table_owner: false, cross_user_rows: 0, canonical_differs_from_auth: true,
      backend: 'SERVICE_ROLE_WITH_SEPARATE_CANONICAL_AUTHORIZATION_TESTS', live_oauth: 'NOT_RUN'};
  });

  await gate('manual_observation_explicit_lock_barrier_timeout_and_retry', async () => {
    const date = shift(-55), payload = {...base('steps', date, 333), clientRequestId: randomUUID()};
    await withCanonicalLock(async (owner) => {
      const started = performance.now(), request = http(a, 'upsertManualObservation', payload);
      try {
        const waiting = await until(async () => {const rows = await waitingWriters(owner.pid); return rows.length ? rows : false;}, 'observation API acquired separate waiting DB connection', 4000);
        assert.ok(waiting.every(row => row.pid !== owner.pid));
        const response = await request, elapsed = performance.now() - started;
        assert.equal(response.ok, false); assert.equal(response.error, 'DB_TIMEOUT_RETRYABLE'); assert.equal(response.http_status, 503); assert.equal(response.retryable, true);
        assert.ok(elapsed < 10000, 'Bounded local failure (not a production SLA)');
        proof.barriers.push({kind: 'ADVISORY_HOLDER_THEN_API_WAITER', holder_pid: owner.pid, holder_role: owner.role,
          waiter_pids: waiting.map(row => row.pid), observed_wait: waiting.map(row => row.wait_event), result: 'DB_TIMEOUT_RETRYABLE', elapsed_ms: elapsed});
      } finally { await request.catch(() => {}); }
    });
    await noReceipt(payload.clientRequestId); assert.equal((await read(date)).length, 0);
    const saved = await call(a, 'upsertManualObservation', payload); assert.equal(saved.record.value, 333);
    const replay = await call(a, 'upsertManualObservation', payload); assert.equal(replay.replayed, true); assert.equal(replay.recordId, saved.recordId);
    proof.assertions.push({gate: 'bounded_lock_retry', same_request_id_after_timeout: true, no_partial_row_or_receipt: true, independent_connections_proven: true});
  });

  await gate('manual_observation_daily_uniqueness_and_revision_concurrency_barriers', async () => {
    const date = shift(-60), requests = [700, 900].map(value => ({...base('steps', date, value), clientRequestId: randomUUID()}));
    let responses;
    await withCanonicalLock(async (owner, release) => {
      const pending = requests.map(input => http(a, 'upsertManualObservation', input));
      try {
        const waiting = await until(async () => {const rows = await waitingWriters(owner.pid); return rows.length >= 2 ? rows : false;}, 'two independent observation writers waiting', 1500);
        assert.ok(new Set(waiting.map(row => row.pid)).size >= 2);
        proof.barriers.push({kind: 'TWO_API_WRITERS_BLOCKED_BEFORE_RELEASE', holder_pid: owner.pid, waiter_pids: waiting.map(row => row.pid), simultaneous_waiters: waiting.length});
      } finally { release(); responses = await Promise.all(pending); }
    });
    assert.equal(responses.filter(response => response.ok).length, 1); assert.equal(responses.find(response => !response.ok).error, 'OBSERVATION_DATE_CONFLICT');
    const saved = responses.find(response => response.ok).data;
    const count = (await pg.admin`select count(*)::int as n from public.engine_manual_observations where canonical_user_id=${A} and local_date=${date} and domain='steps' and not deleted`)[0].n;
    assert.equal(count, 1);
    for (let index = 0; index < requests.length; index++) assert.equal((await status(requests[index].clientRequestId)).exists, responses[index].ok);
    const updates = [1000, 1100].map(value => ({recordId: saved.recordId, revision: 1, value, clientRequestId: randomUUID()}));
    const updated = await Promise.all(updates.map(input => http(a, 'upsertManualObservation', input)));
    assert.equal(updated.filter(response => response.ok).length, 1); assert.equal(updated.find(response => !response.ok).error, 'STALE_REVISION');
    const result = (await raw(saved.recordId))[0]; assert.equal(Number(result.revision), 2); assert.ok([1000, 1100].includes(result.body.value));
    proof.assertions.push({gate: 'daily_uniqueness', valid_serializations: 1, live_rows: 1, same_revision_winner: 1, loser_receipt_absent: true});
  });

  await gate('manual_observation_bounded_old_new_dates_tombstone_and_failed_write_atomicity', async () => {
    const oldDate = shift(-100), newDate = shift(-98), request = {...base('steps', oldDate, 5000), clientRequestId: randomUUID()};
    const created = await call(a, 'upsertManualObservation', request);
    const queue = async () => pg.admin`select score_date::text as date,generation,engine_required,engine_published_generation,status from private.beta_score_recompute_queue
      where canonical_user_id=${A} and score_date between ${oldDate}::date and ${newDate}::date+27 order by score_date`;
    const before = await queue(), generations = new Map(before.map(q => [q.date, BigInt(q.generation)]));
    assert.equal(before.length, 28); assert.ok(before.every(q => q.engine_required));
    const changed = await save({recordId: created.recordId, revision: 1, date: newDate});
    const moved = await queue(); assert.equal(moved.length, 30); assert.deepEqual(changed.invalidatedDates, [oldDate, newDate]);
    for (const q of moved) assert.ok(BigInt(q.generation) > (generations.get(q.date) ?? 0n), 'old and new bounded rolling dates invalidated');
    assert.equal((await read(oldDate)).length, 0); assert.equal((await read(newDate))[0].recordId, created.recordId);
    const receiptCount = (await pg.admin`select count(*)::int as n from private.engine_observation_receipts where canonical_user_id=${A}`)[0].n;
    const generationState = rows => rows.map(({date, generation, engine_required}) => ({date, generation, engine_required}));
    const rawBefore = await raw(created.recordId), queueBefore = generationState(await queue()), invalid = {recordId: created.recordId, revision: 2, value: -2, clientRequestId: randomUUID()};
    assert.equal((await http(a, 'upsertManualObservation', invalid)).ok, false); assert.deepEqual(await raw(created.recordId), rawBefore); assert.deepEqual(generationState(await queue()), queueBefore);
    await noReceipt(invalid.clientRequestId); assert.equal((await pg.admin`select count(*)::int as n from private.engine_observation_receipts where canonical_user_id=${A}`)[0].n, receiptCount);
    const removed = await remove(changed.record), rawDeleted = (await raw(created.recordId))[0];
    assert.equal(rawDeleted.deleted, true); assert.equal(Number(rawDeleted.revision), 3); assert.equal((await read(newDate)).length, 0);
    assert.ok((await daily(newDate)).every(d => d.steps.value === null));
    assert.equal((await http(a, 'upsertManualObservation', {recordId: created.recordId, revision: 3, value: 6000, clientRequestId: randomUUID()})).error, 'OBSERVATION_DELETED');
    const afterDelete = await queue(); const movedMap = new Map(moved.map(q => [q.date, BigInt(q.generation)]));
    for (const q of afterDelete.filter(q => q.date >= newDate)) assert.ok(BigInt(q.generation) > movedMap.get(q.date));
    assert.equal(removed.recordId, created.recordId);
    proof.assertions.push({gate: 'bounded_recompute', create_dates: 28, move_union_dates: 30, windows: [7, 28], original_new_invalidated: true,
      validation_failure_left_raw_receipt_queue_generation_unchanged: true, tombstone_preserved: true, raw_resurrection_rejected: true, engine_score_non_resurrection: 'SEPARATE_ENGINE_GATE_REQUIRED'});
  });

  await gate('manual_observation_local_query_plans', async () => {
    const plans = {};
    plans.raw30d = await pg.admin`explain (analyze,buffers,format json) select record_id,domain,local_date,body from public.engine_manual_observations
      where canonical_user_id=${A} and not deleted and local_date between ${shift(-70)}::date and ${shift(-41)}::date order by local_date,record_id limit 5001`;
    plans.dailyTotalLookup = await pg.admin`explain (analyze,buffers,format json) select record_id,revision from public.engine_manual_observations
      where canonical_user_id=${A} and local_date=${shift(-60)}::date and domain='steps' and not deleted`;
    plans.receiptLookup = await pg.admin`explain (analyze,buffers,format json) select response from private.engine_observation_receipts
      where canonical_user_id=${A} and request_id=${randomUUID()}`;
    const counts = (await pg.admin`select (select count(*) from public.engine_manual_observations)::int as observations,(select count(*) from private.engine_observation_receipts)::int as receipts`)[0];
    proof.performance = {classification: 'LOCAL_MEASUREMENT_NOT_PRODUCTION_SLA', server_version: (await pg.admin`show server_version`)[0].server_version,
      synthetic_row_counts: counts, range_days: 30, query_count: 3, plans, limitations: ['Small synthetic dataset; sequential scans can be correct', 'No production latency/load inference', 'No index added without comparative evidence']};
  });
}
