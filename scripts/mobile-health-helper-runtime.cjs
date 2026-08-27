'use strict';

const http = require('node:http');
const { URL } = require('node:url');
const {
  InstallClaimRegistry,
  sha256,
  validateRecord,
} = require('./mobile-health-helper-contract.cjs');

const MAX_BODY_BYTES = 1024 * 1024;

class SourceRecordReconciler {
  constructor() {
    this.state = new Map();
    this.invalidations = [];
  }

  apply(mutation, canonicalUserId) {
    validateMutation(mutation, canonicalUserId);
    const key = [canonicalUserId, mutation.platform, mutation.domain, mutation.source_app, mutation.source_record_id].join('\x1f');
    const current = this.state.get(key);
    if (!current) {
      if (mutation.operation === 'DELETE') return { action: 'DELETE_UNKNOWN_REJECTED', accepted: false };
      this.state.set(key, snapshot(mutation));
      return { action: 'CREATED', accepted: true };
    }
    if (mutation.source_revision < current.source_revision || isOlderSourceTimestamp(mutation, current)) {
      return { action: 'STALE_REJECTED', accepted: false };
    }
    if (mutation.source_revision === current.source_revision) {
      if (mutation.source_content_hash === current.source_content_hash && mutation.operation === current.operation) {
        return { action: 'REPLAYED', accepted: true, duplicate: true };
      }
      return { action: 'CONFLICT_REJECTED', accepted: false };
    }
    this.state.set(key, snapshot(mutation));
    this.invalidations.push(Object.freeze({
      canonicalUserId,
      domain: mutation.domain,
      localDates: [...new Set([...(current.affected_local_dates || []), ...(mutation.affected_local_dates || [])])],
      reason: mutation.operation === 'DELETE' ? 'SOURCE_DELETE' : 'SOURCE_UPDATE',
    }));
    return { action: mutation.operation === 'DELETE' ? 'DELETED' : 'UPDATED', accepted: true };
  }
}

function snapshot(mutation) {
  return Object.freeze({
    source_revision: mutation.source_revision,
    source_updated_at: mutation.source_updated_at || null,
    source_content_hash: mutation.source_content_hash,
    operation: mutation.operation,
    affected_local_dates: [...(mutation.affected_local_dates || [])],
  });
}

function isOlderSourceTimestamp(incoming, current) {
  return incoming.source_updated_at && current.source_updated_at
    && Date.parse(incoming.source_updated_at) < Date.parse(current.source_updated_at);
}

function validateMutation(mutation, canonicalUserId) {
  if (!mutation || mutation.canonical_user_id !== canonicalUserId) throw codeError('CROSS_USER_UPLOAD', 403);
  if (mutation.platform !== 'ios') throw codeError('PLATFORM_MISMATCH', 400);
  if (!['steps', 'heart_rate', 'sleep'].includes(mutation.domain)) throw codeError('UNSUPPORTED_DOMAIN', 400);
  if (!['UPSERT', 'DELETE'].includes(mutation.operation)) throw codeError('INVALID_OPERATION', 400);
  if (!Number.isSafeInteger(mutation.source_revision) || mutation.source_revision < 1) throw codeError('INVALID_SOURCE_REVISION', 400);
  if (!/^[0-9a-f]{64}$/u.test(mutation.source_content_hash || '')) throw codeError('INVALID_CONTENT_HASH', 400);
  if (!mutation.source_record_id || !mutation.source_app) throw codeError('MISSING_SOURCE_IDENTITY', 400);
  if (mutation.operation === 'UPSERT') validateRecord(mutation.record, canonicalUserId);
  if (mutation.operation === 'DELETE' && mutation.record != null) throw codeError('DELETE_CONTAINS_RECORD', 400);
}

function createMobileHealthRuntime(options = {}) {
  const claims = options.claimRegistry || new InstallClaimRegistry();
  const reconciler = options.reconciler || new SourceRecordReconciler();
  const authenticateWebRequest = options.authenticateWebRequest || (async () => { throw codeError('WEB_SESSION_REQUIRED', 401); });
  const continuationOrigin = options.continuationOrigin;
  if (!continuationOrigin || new URL(continuationOrigin).protocol !== 'https:') throw new Error('HTTPS_CONTINUATION_ORIGIN_REQUIRED');

  const routes = new Map();
  route('POST', '/v1/mobile/install-claims', async (request, response, body) => {
    const canonicalUserId = await authenticateWebRequest(request);
    const claim = claims.issue({
      canonicalUserId,
      platform: body.platform,
      installationKeyFingerprint: body.installation_key_fingerprint,
    });
    json(response, 201, {
      continuation_url: `${continuationOrigin}/health-sync/bootstrap#claim=${encodeURIComponent(claim)}`,
      expires_in: 300,
    });
  });

  route('POST', '/v1/mobile/install-claims/exchange', async (_request, response, body) => {
    const publicKey = Buffer.from(body.installation_public_key || '', 'base64');
    const session = claims.exchange({
      claim: body.claim,
      publicKeyPem: { key: publicKey, format: 'der', type: 'spki' },
      signature: Buffer.from(body.signature || '', 'base64'),
    });
    json(response, 200, {
      canonical_user_id: session.canonicalUserId,
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      session_id: session.sessionId,
    });
  });

  route('POST', '/v1/health/ingestion/batches', async (request, response, body) => {
    const authorization = request.headers.authorization || '';
    const accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const sessionId = request.headers['x-app-session-id'];
    const canonicalUserId = body.canonical_user_id;
    authorizeSession(claims, { sessionId, accessToken, canonicalUserId });
    if (!Array.isArray(body.mutations) || body.mutations.length > 250) throw codeError('INVALID_BATCH', 400);
    const receipt = { accepted_idempotency_keys: [], duplicate_idempotency_keys: [], rejected: [] };
    for (const mutation of body.mutations) {
      const result = reconciler.apply(mutation, canonicalUserId);
      if (!result.accepted) {
        receipt.rejected.push({ idempotency_key: mutation.idempotency_key, error_code: result.action });
      } else if (result.duplicate) {
        receipt.duplicate_idempotency_keys.push(mutation.idempotency_key);
      } else {
        receipt.accepted_idempotency_keys.push(mutation.idempotency_key);
      }
    }
    json(response, receipt.rejected.length ? 207 : 200, receipt);
  });

  route('DELETE', '/v1/mobile/sessions/current', async (request, response) => {
    const sessionId = request.headers['x-app-session-id'];
    const authorization = request.headers.authorization || '';
    const accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const canonicalUserId = request.headers['x-canonical-user-id'];
    authorizeSession(claims, { sessionId, accessToken, canonicalUserId });
    claims.revoke(sessionId);
    response.writeHead(204).end();
  });

  function route(method, path, handler) { routes.set(`${method} ${path}`, handler); }

  async function handler(request, response) {
    try {
      const url = new URL(request.url, 'http://runtime.local');
      const matched = routes.get(`${request.method} ${url.pathname}`);
      if (!matched) return json(response, 404, { error: 'NOT_FOUND' });
      const body = request.method === 'GET' || request.method === 'DELETE' ? {} : await readJSON(request);
      await matched(request, response, body);
    } catch (error) {
      json(response, error.status || 500, { error: error.code || 'INTERNAL_ERROR' });
    }
  }

  return { handler, routes: Object.freeze([...routes.keys()]), claimRegistry: claims, reconciler };
}

async function readJSON(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw codeError('BODY_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw codeError('MALFORMED_JSON', 400); }
}

function json(response, status, body) {
  const encoded = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'content-length': encoded.length,
  });
  response.end(encoded);
}

function codeError(code, status) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function authorizeSession(claims, input) {
  try { return claims.authorizeUpload(input); }
  catch (error) {
    const code = error.message || 'INVALID_SESSION';
    throw codeError(code, code === 'CROSS_USER_UPLOAD' ? 403 : 401);
  }
}

module.exports = { SourceRecordReconciler, createMobileHealthRuntime, validateMutation };
