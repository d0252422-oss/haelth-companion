'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const test = require('node:test');
const { idempotencyKey, sha256 } = require('../scripts/mobile-health-helper-contract.cjs');
const { createMobileHealthRuntime } = require('../scripts/mobile-health-helper-runtime.cjs');

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';

function record(value = 67) {
  const result = {
    canonical_user_id: userA, platform: 'ios', domain: 'heart_rate', source_app: 'com.apple.health',
    source_record_id: 'hk-runtime-1', source_updated_at: null,
    recorded_at: '2026-08-27T01:00:00.000Z', started_at: '2026-08-27T01:00:00.000Z',
    ended_at: '2026-08-27T01:00:01.000Z', timezone: 'Asia/Taipei', local_date: '2026-08-27',
    value, unit: 'bpm', stage: null, schema_version: 'hdl-v2.health-ingestion.v1',
  };
  result.idempotency_key = idempotencyKey(result);
  return result;
}

function mutation(sourceRevision, value = 67, operation = 'UPSERT') {
  const healthRecord = operation === 'UPSERT' ? record(value) : null;
  const content = operation === 'UPSERT' ? healthRecord.idempotency_key : sha256(`DELETE\x1fhk-runtime-1\x1f${sourceRevision}`);
  return {
    canonical_user_id: userA, platform: 'ios', domain: 'heart_rate', source_app: 'com.apple.health',
    source_record_id: 'hk-runtime-1', source_revision: sourceRevision, source_updated_at: null,
    source_content_hash: content, operation, affected_local_dates: ['2026-08-27'],
    idempotency_key: sha256(`${userA}\x1fhk-runtime-1\x1f${sourceRevision}\x1f${content}\x1f${operation}`),
    record: healthRecord,
  };
}

test('runtime registers claim, exchange, ingestion, and revocation routes', () => {
  const runtime = createMobileHealthRuntime({ continuationOrigin: 'https://sync.example.com', authenticateWebRequest: async () => userA });
  assert.deepEqual([...runtime.routes].sort(), [
    'DELETE /v1/mobile/sessions/current',
    'POST /v1/health/ingestion/batches',
    'POST /v1/mobile/install-claims',
    'POST /v1/mobile/install-claims/exchange',
    'GET /v1/mobile/connectors/status',
    'POST /v1/mobile/connectors/status',
    'POST /v1/mobile/sessions/refresh',
  ].sort());
});

test('HTTP E2E binds web user, exchanges signed claim, reconciles updates/deletes, and revokes', async (t) => {
  const auditEvents = [];
  const runtime = createMobileHealthRuntime({
    continuationOrigin: 'https://sync.example.com',
    audit: (event) => auditEvents.push(event),
    authenticateWebRequest: async (request) => request.headers.authorization === 'Bearer verified-web-session' ? userA : Promise.reject(Object.assign(new Error(), { code: 'WEB_SESSION_REQUIRED', status: 401 })),
  });
  const server = http.createServer(runtime.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicDer = keys.publicKey.export({ type: 'spki', format: 'der' });

  const issued = await request(origin, '/v1/mobile/install-claims', 'POST', {
    platform: 'ios', installation_key_fingerprint: sha256(publicDer),
  }, { authorization: 'Bearer verified-web-session' });
  assert.equal(issued.status, 201);
  const claim = new URL(issued.body.continuation_url).hash.slice('#claim='.length);

  const exchanged = await request(origin, '/v1/mobile/install-claims/exchange', 'POST', {
    claim,
    installation_public_key: publicDer.toString('base64'),
    signature: crypto.sign('sha256', Buffer.from(claim), keys.privateKey).toString('base64'),
  });
  assert.equal(exchanged.status, 200);
  assert.equal(exchanged.body.canonical_user_id, userA);
  const exchangeReplay = await request(origin, '/v1/mobile/install-claims/exchange', 'POST', {
    claim,
    installation_public_key: publicDer.toString('base64'),
    signature: crypto.sign('sha256', Buffer.from(claim), keys.privateKey).toString('base64'),
  });
  assert.equal(exchangeReplay.status, 409);
  assert.equal(exchangeReplay.body.error, 'REPLAYED_CLAIM');
  const refreshMessage = `${exchanged.body.session_id}\x1f${exchanged.body.refresh_token}`;
  const refreshed = await request(origin, '/v1/mobile/sessions/refresh', 'POST', {
    session_id: exchanged.body.session_id,
    refresh_token: exchanged.body.refresh_token,
    signature: crypto.sign('sha256', Buffer.from(refreshMessage), keys.privateKey).toString('base64'),
  });
  assert.equal(refreshed.status, 200);
  assert.notEqual(refreshed.body.access_token, exchanged.body.access_token);
  assert.notEqual(refreshed.body.refresh_token, exchanged.body.refresh_token);

  const oldToken = await ingest(origin, {
    authorization: `Bearer ${exchanged.body.access_token}`,
    'x-app-session-id': exchanged.body.session_id,
  }, mutation(1));
  assert.equal(oldToken.status, 401);

  const authHeaders = {
    authorization: `Bearer ${refreshed.body.access_token}`,
    'x-app-session-id': exchanged.body.session_id,
  };

  const create = await ingest(origin, authHeaders, mutation(1));
  const replay = await ingest(origin, authHeaders, mutation(1));
  const update = await ingest(origin, authHeaders, mutation(2, 68));
  const stale = await ingest(origin, authHeaders, mutation(1));
  const repeatedUpdate = await ingest(origin, authHeaders, mutation(2, 68));
  const deletion = await ingest(origin, authHeaders, mutation(3, 0, 'DELETE'));
  assert.equal(create.body.accepted_idempotency_keys.length, 1);
  assert.equal(replay.body.duplicate_idempotency_keys.length, 1);
  assert.equal(update.body.accepted_idempotency_keys.length, 1);
  assert.equal(stale.body.rejected[0].error_code, 'STALE_REJECTED');
  assert.equal(repeatedUpdate.body.duplicate_idempotency_keys.length, 1);
  assert.equal(deletion.body.accepted_idempotency_keys.length, 1);
  assert.equal(runtime.reconciler.invalidations.length, 2);

  const crossUser = await request(origin, '/v1/health/ingestion/batches', 'POST', {
    canonical_user_id: userB, mutations: [{ ...mutation(4), canonical_user_id: userB }],
  }, authHeaders);
  assert.equal(crossUser.status, 403);
  assert.equal(crossUser.body.error, 'CROSS_USER_UPLOAD');

  const revoked = await request(origin, '/v1/mobile/sessions/current', 'DELETE', null, {
    ...authHeaders, 'x-canonical-user-id': userA,
  });
  assert.equal(revoked.status, 204);
  const afterRevoke = await ingest(origin, authHeaders, mutation(4));
  assert.equal(afterRevoke.status, 401);
  assert.equal(afterRevoke.body.error, 'REVOKED_SESSION');

  assert.ok(auditEvents.some((event) => event.event === 'INSTALL_CLAIM_ISSUED'));
  assert.ok(auditEvents.some((event) => event.event === 'APP_SESSION_ISSUED'));
  assert.ok(auditEvents.some((event) => event.event === 'APP_SESSION_REFRESHED'));
  assert.ok(auditEvents.some((event) => event.event === 'APP_SESSION_REVOKED'));
  assert.ok(auditEvents.some((event) => event.ingestion_result === 'CREATED'));
  assert.ok(auditEvents.some((event) => event.dedupe_result === 'DUPLICATE'));
  assert.ok(auditEvents.some((event) => event.stale_update_decision === 'REJECTED_STALE'));
  assert.ok(auditEvents.some((event) => event.event === 'REQUEST_REJECTED'));
  const serializedAudit = JSON.stringify(auditEvents);
  assert.doesNotMatch(serializedAudit, new RegExp(exchanged.body.access_token, 'u'));
  assert.doesNotMatch(serializedAudit, new RegExp(exchanged.body.refresh_token, 'u'));
  assert.doesNotMatch(serializedAudit, new RegExp(claim, 'u'));
  assert.doesNotMatch(serializedAudit, /"(?:access_token|refresh_token|claim|health_value|raw_payload)"/u);
});

async function ingest(origin, headers, item) {
  return request(origin, '/v1/health/ingestion/batches', 'POST', { canonical_user_id: userA, mutations: [item] }, headers);
}

async function request(origin, path, method, body, headers = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: { ...(body == null ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
