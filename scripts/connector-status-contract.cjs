'use strict';

const PLATFORMS = new Set(['android', 'ios']);
const CONNECTORS = new Set(['android_helper', 'ios_shortcut']);
const RESULTS = new Set(['NOT_INSTALLED_OR_UNKNOWN', 'PERMISSION_REQUIRED', 'CONNECTED', 'SYNCING', 'SYNCED', 'ERROR', 'UNKNOWN', 'PARTIAL', 'REQUESTED']);

function validateStatus(input, canonicalUserId) {
  if (!input || input.canonical_user_id !== canonicalUserId) throw new Error('CROSS_USER_STATUS');
  if (!PLATFORMS.has(input.platform) || !CONNECTORS.has(input.connector_type)) throw new Error('INVALID_CONNECTOR_STATUS');
  if (!RESULTS.has(input.last_result)) throw new Error('INVALID_CONNECTOR_RESULT');
  if (!Array.isArray(input.available_domains) || input.available_domains.some((value) => typeof value !== 'string')) throw new Error('INVALID_AVAILABLE_DOMAINS');
  const date = (value) => value == null || Number.isFinite(Date.parse(value));
  if (!date(input.last_attempt_at) || !date(input.last_success_at)) throw new Error('INVALID_STATUS_TIMESTAMP');
  return Object.freeze({
    canonical_user_id: canonicalUserId, platform: input.platform, connector_type: input.connector_type,
    connector_version: String(input.connector_version || 'unknown'), last_success_at: input.last_success_at || null,
    last_attempt_at: input.last_attempt_at || null, last_result: input.last_result,
    available_domains: [...new Set(input.available_domains)].sort(), permission_state_if_known: input.permission_state_if_known || 'UNKNOWN',
  });
}

class ConnectorStatusRegistry {
  constructor() { this.rows = new Map(); }
  report(input, canonicalUserId) {
    const row = validateStatus(input, canonicalUserId);
    this.rows.set(`${canonicalUserId}\x1f${row.platform}\x1f${row.connector_type}`, row);
    return row;
  }
  forUser(canonicalUserId) { return [...this.rows.values()].filter((row) => row.canonical_user_id === canonicalUserId); }
}

module.exports = { ConnectorStatusRegistry, validateStatus };
