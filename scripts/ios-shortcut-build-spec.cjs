'use strict';

// Offline specification helpers only. No uploader, credentials, HealthKit bridge,
// network client, package installation, or generated .shortcut artifact.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const VERSION = 'ios-shortcut-five-window.v1';
const MAX_BATCH = 250;
const DEFINITIONS = Object.freeze([
  Object.freeze({ domain: 'steps', lookback_seconds: 86400, unit: 'count', selection: 'POINT_RECORDED_AT' }),
  Object.freeze({ domain: 'heart_rate', lookback_seconds: 86400, unit: 'bpm', selection: 'POINT_RECORDED_AT' }),
  Object.freeze({ domain: 'sleep', lookback_seconds: 604800, unit: 'minute', selection: 'INTERVAL_OVERLAP' }),
  Object.freeze({ domain: 'weight', lookback_seconds: 2592000, unit: 'kg', selection: 'POINT_RECORDED_AT' }),
  Object.freeze({ domain: 'workout', lookback_seconds: 604800, unit: 'minute', selection: 'INTERVAL_OVERLAP' }),
]);

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

function utcMillis(value) {
  invariant(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value), 'CANONICAL_UTC_REQUIRED');
  const result = Date.parse(value);
  invariant(Number.isFinite(result) && new Date(result).toISOString() === value, 'INVALID_UTC_TIMESTAMP');
  return result;
}

function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'ios-shortcut-tester.manifest.json'), 'utf8'));
}

function validateManifest(manifest) {
  invariant(manifest?.schema_version === 'ios-shortcut-tester.v1', 'INVALID_MANIFEST_VERSION');
  invariant(manifest.environment === 'beta' && manifest.provider === 'apple_health' && manifest.connector_type === 'ios_shortcut', 'INVALID_CONNECTOR');
  invariant(manifest.ingestion_schema === 'hdl-v2.connector-ingestion.v1', 'INVALID_INGESTION_SCHEMA');
  invariant(manifest.session_exchange_path === '/v1/connectors/ios-shortcut/session' && manifest.ingestion_path === '/v1/connectors/ios-shortcut/ingest', 'AUTH_PATH_CHANGED');
  invariant(manifest.authentication === 'short_lived_single_use_beta_setup_code_then_24h_user_scoped_revocable_session', 'AUTH_CONTRACT_CHANGED');
  invariant(manifest.session_request?.environment === 'beta' && manifest.session_request?.claim === 'ONE_TIME_CODE', 'RUNTIME_CLAIM_PLACEHOLDER_REQUIRED');
  invariant(JSON.stringify(manifest.ingestion_auth_headers) === JSON.stringify(['Authorization: Bearer <session access token>', 'x-shortcut-session-id: <session id>']), 'RUNTIME_HEADER_PLACEHOLDERS_REQUIRED');
  const endpoint = new URL(manifest.ingestion_base_url);
  invariant(endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash && endpoint.pathname === '/functions/v1/mobile-health-beta', 'INVALID_ENDPOINT_CONFIGURATION');
  invariant(manifest.max_records_per_batch === MAX_BATCH, 'INVALID_BATCH_LIMIT');
  const spec = manifest.build_spec;
  invariant(spec?.version === VERSION && spec.status === 'OFFLINE_SPEC_ONLY_NOT_IMPORTABLE_SHORTCUT', 'INVALID_BUILD_SPEC');
  invariant(spec.clock_policy === 'ONE_FROZEN_UTC_END_ELAPSED_SECONDS' && spec.point_boundary === 'START_INCLUSIVE_END_EXCLUSIVE' && spec.interval_boundary === 'OVERLAP_PRESERVE_ORIGINAL_INTERVAL', 'WINDOW_POLICY_CHANGED');
  invariant(Array.isArray(spec.selected_domains) && spec.selected_domains.length === DEFINITIONS.length, 'FIVE_DOMAINS_REQUIRED');
  for (const [index, expected] of DEFINITIONS.entries()) {
    const actual = spec.selected_domains[index];
    invariant(Object.keys(expected).every(key => actual?.[key] === expected[key]), 'DOMAIN_WINDOW_CHANGED');
    invariant(manifest.read_only_domains?.includes(expected.domain), 'DOMAIN_NOT_SUPPORTED');
  }
  invariant(spec.device_execution === 'NOT_RUN' && spec.healthkit_shortcuts_field_availability === 'NOT_DEVICE_VERIFIED', 'DEVICE_EVIDENCE_NOT_ESTABLISHED');
  invariant(spec.server_window_enforcement === 'NOT_IMPLEMENTED_BY_THIS_SPEC', 'SERVER_ENFORCEMENT_NOT_ESTABLISHED');
  return manifest;
}

function buildSpec(frozenEnd, manifest = readManifest()) {
  validateManifest(manifest);
  const end = utcMillis(frozenEnd);
  return {
    version: VERSION,
    status: 'OFFLINE_SPEC_ONLY_NOT_IMPORTABLE_SHORTCUT',
    network_operations: 0,
    device_execution: 'NOT_RUN',
    authentication: 'REUSE_EXISTING_CLAIM_AND_USER_SCOPED_SESSION_NO_NEW_AUTH',
    windows: DEFINITIONS.map(definition => ({
      ...definition,
      sync_window_start: new Date(end - definition.lookback_seconds * 1000).toISOString(),
      sync_window_end: frozenEnd,
    })),
    interval_handling: 'OVERLAP_ONLY_DO_NOT_CLIP_REDATE_SUM_OR_SYNTHESIZE_RECORDS',
    max_records_per_batch: MAX_BATCH,
    batch_partition: 'ONE_DOMAIN_ONE_WINDOW_PER_ENVELOPE',
    retry: {
      identity: 'REUSE_SAME_NATIVE_OR_DERIVED_ID_CONTENT_HASH_AND_SOURCE_REVISION',
      payload: 'REUSE_ORIGINAL_SERIALIZED_BODY_BYTES_AND_MEMBERSHIP',
      ambiguous_response: 'DO_NOT_ASSUME_ROLLBACK_REPLAY_EXACT_BATCH',
      bounded_policy: 'STOP_AFTER_3_TOTAL_ATTEMPTS_OR_120_SECONDS_ELAPSED',
      request_deadline: '30_SECONDS_REQUIRED_DEVICE_MECHANISM_NOT_VERIFIED',
      auth_failure: 'STOP_NO_AUTOMATIC_REAUTH_OR_ALTERNATE_USER',
    },
    result_states: ['NO_SAMPLES_PERMISSION_UNKNOWN', 'QUERY_FAILED', 'AUTH_REQUIRED', 'PARTIAL', 'INGESTION_ACCEPTED_ANALYSIS_UNVERIFIED', 'RETRY_EXHAUSTED'],
    remaining_gates: ['IMPORTABLE_SHORTCUT_ACTIONS', 'FIELD_AND_PERMISSION_DEVICE_VALIDATION', 'BOUNDED_POST_DEVICE_VALIDATION', 'REAL_TARGET_SESSION_AND_INGESTION', 'ICLOUD_SHARE_LINK'],
  };
}

// Normalized synthetic metadata predicate; does not query or validate HealthKit.
function matchesWindow(record, window) {
  const start = utcMillis(window.sync_window_start);
  const end = utcMillis(window.sync_window_end);
  invariant(start < end, 'BAD_WINDOW_ORDER');
  const expected = DEFINITIONS.find(definition => definition.domain === window.domain);
  invariant(expected && window.selection === expected.selection && window.unit === expected.unit && end - start === expected.lookback_seconds * 1000, 'INVALID_DOMAIN_WINDOW');
  invariant(record?.domain === window.domain && record.unit === window.unit, 'RECORD_DOMAIN_OR_UNIT_MISMATCH');
  if (window.selection === 'INTERVAL_OVERLAP') {
    const from = utcMillis(record.started_at);
    const to = utcMillis(record.ended_at);
    invariant(from < to, 'BAD_RECORD_INTERVAL');
    return from < end && to > start;
  }
  const at = utcMillis(record.recorded_at);
  return at >= start && at < end;
}

// Keys are synthetic fixture identities, not generated production idempotency keys.
// This checksum describes membership only, never proves actual serialized HTTP bytes.
function planBatches(recordKeys) {
  invariant(Array.isArray(recordKeys) && recordKeys.every(key => typeof key === 'string' && key.length > 0), 'INVALID_RECORD_KEYS');
  invariant(new Set(recordKeys).size === recordKeys.length, 'DUPLICATE_RECORD_KEY');
  const ordered = [...recordKeys].sort();
  const batches = [];
  for (let index = 0; index < ordered.length; index += MAX_BATCH) {
    const keys = ordered.slice(index, index + MAX_BATCH);
    batches.push({
      batch_index: batches.length,
      record_keys: keys,
      membership_sha256: createHash('sha256').update(JSON.stringify(keys)).digest('hex'),
    });
  }
  return batches;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    invariant(args.length === 2 && args[0] === '--at', 'USAGE: node scripts/ios-shortcut-build-spec.cjs --at YYYY-MM-DDTHH:mm:ss.sssZ');
    process.stdout.write(`${JSON.stringify(buildSpec(args[1]), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { VERSION, DEFINITIONS, readManifest, validateManifest, buildSpec, matchesWindow, planBatches };
