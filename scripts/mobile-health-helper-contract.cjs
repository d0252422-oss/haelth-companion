'use strict';

const crypto = require('node:crypto');

const CLAIM_TTL_SECONDS = 300;
const DOMAINS = new Set(['steps', 'heart_rate', 'sleep']);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalNumber(value) {
  if (!Number.isFinite(value)) throw new Error('MALFORMED_VALUE');
  const fixed = value.toFixed(6).replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '');
  return fixed === '-0' ? '0' : fixed;
}

function idempotencyKey(record) {
  const tuple = [
    'sha256-canonical-v1', record.canonical_user_id.toLowerCase(), 'ios', record.domain,
    record.source_app, record.source_record_id || '', record.started_at || '',
    record.ended_at || '', record.recorded_at, canonicalNumber(record.value),
    record.unit, record.stage || '',
  ].join('\x1f');
  return sha256(tuple);
}

function validateRecord(record, sessionUserId) {
  if (!record || record.canonical_user_id !== sessionUserId) throw new Error('CROSS_USER_UPLOAD');
  if (record.platform !== 'ios') throw new Error('PLATFORM_MISMATCH');
  if (!DOMAINS.has(record.domain)) throw new Error('UNSUPPORTED_DOMAIN');
  if (typeof record.source_app !== 'string' || !record.source_app) throw new Error('MISSING_SOURCE');
  if (!Number.isFinite(Date.parse(record.recorded_at))) throw new Error('MALFORMED_TIMESTAMP');
  if (typeof record.timezone !== 'string' || !record.timezone) throw new Error('MISSING_TIMEZONE');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(record.local_date)) throw new Error('MALFORMED_LOCAL_DATE');
  if (record.schema_version !== 'hdl-v2.health-ingestion.v1') throw new Error('SCHEMA_VERSION_MISMATCH');
  const expected = idempotencyKey(record);
  if (record.idempotency_key !== expected) throw new Error('IDEMPOTENCY_KEY_MISMATCH');
  return Object.freeze({ ...record });
}

function reconcileUploadBatch(records, receipt, previousCheckpoint, nextCheckpoint) {
  const completed = new Set([
    ...(receipt.accepted_idempotency_keys || []),
    ...(receipt.duplicate_idempotency_keys || []),
  ]);
  if ((receipt.rejected || []).length > 0) return { checkpoint: previousCheckpoint, pending: records };
  const pending = records.filter((record) => !completed.has(record.idempotency_key));
  return { checkpoint: pending.length === 0 ? nextCheckpoint : previousCheckpoint, pending };
}

function classifyHTTPStatus(status, retryAfter = null) {
  if (status >= 200 && status < 300) return { kind: 'SUCCESS', retry: false };
  if (status === 401) return { kind: 'UNAUTHORIZED', retry: false };
  if (status === 403) return { kind: 'FORBIDDEN', retry: false };
  if (status === 429) return { kind: 'RATE_LIMITED', retry: true, retryAfter };
  if (status >= 500 && status <= 599) return { kind: 'SERVER_TEMPORARY', retry: true };
  return { kind: 'CLIENT_ERROR', retry: false };
}

class InstallClaimRegistry {
  constructor() {
    this.claims = new Map();
    this.sessions = new Map();
  }

  issue({ canonicalUserId, platform = 'ios', installationKeyFingerprint, now = Date.now(), ttlSeconds = CLAIM_TTL_SECONDS }) {
    if (!canonicalUserId || !/^[0-9a-f]{64}$/u.test(installationKeyFingerprint)) throw new Error('INVALID_BINDING');
    const claim = crypto.randomBytes(32).toString('base64url');
    this.claims.set(sha256(claim), {
      canonicalUserId, platform, installationKeyFingerprint,
      expiresAt: now + ttlSeconds * 1000, consumedAt: null, revokedAt: null,
    });
    return claim;
  }

  exchange({ claim, publicKeyPem, signature, now = Date.now() }) {
    const row = this.claims.get(sha256(claim));
    if (!row) throw new Error('INVALID_CLAIM');
    if (row.revokedAt) throw new Error('REVOKED_CLAIM');
    if (row.consumedAt) throw new Error('REPLAYED_CLAIM');
    if (row.expiresAt <= now) throw new Error('EXPIRED_CLAIM');
    const publicKey = publicKeyPem?.type === 'public' ? publicKeyPem : crypto.createPublicKey(publicKeyPem);
    const fingerprint = sha256(publicKey.export({ type: 'spki', format: 'der' }));
    if (fingerprint !== row.installationKeyFingerprint) throw new Error('WRONG_INSTALLATION_KEY');
    if (!crypto.verify('sha256', Buffer.from(claim), publicKey, signature)) throw new Error('INVALID_SIGNATURE');
    row.consumedAt = now;
    const accessToken = crypto.randomBytes(32).toString('base64url');
    const refreshToken = crypto.randomBytes(48).toString('base64url');
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, {
      canonicalUserId: row.canonicalUserId,
      installationKeyFingerprint: fingerprint,
      accessTokenDigest: sha256(accessToken), refreshTokenDigest: sha256(refreshToken),
      revokedAt: null,
    });
    return { sessionId, canonicalUserId: row.canonicalUserId, accessToken, refreshToken };
  }

  authorizeUpload({ sessionId, accessToken, canonicalUserId }) {
    const session = this.sessions.get(sessionId);
    if (!session || session.revokedAt) throw new Error('REVOKED_SESSION');
    if (!crypto.timingSafeEqual(Buffer.from(session.accessTokenDigest), Buffer.from(sha256(accessToken)))) {
      throw new Error('INVALID_SESSION');
    }
    if (session.canonicalUserId !== canonicalUserId) throw new Error('CROSS_USER_UPLOAD');
    return true;
  }

  revoke(sessionId, now = Date.now()) {
    const session = this.sessions.get(sessionId);
    if (session) session.revokedAt = now;
  }
}

module.exports = {
  CLAIM_TTL_SECONDS,
  InstallClaimRegistry,
  canonicalNumber,
  classifyHTTPStatus,
  idempotencyKey,
  reconcileUploadBatch,
  sha256,
  validateRecord,
};
