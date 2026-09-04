'use strict';

const crypto = require('node:crypto');

const SCHEMA_VERSION = 'hdl-v2.connector-ingestion.v1';
const DOMAINS = new Set(['steps', 'heart_rate', 'sleep', 'sleep_stage', 'weight', 'workout', 'hrv', 'spo2']);
const CONNECTORS = new Set(['ios_shortcut', 'android_helper', 'health_connect_export', 'vendor_cloud', 'manual']);
const UNITS = {
  steps: new Set(['count']), heart_rate: new Set(['bpm']), sleep: new Set(['minute']),
  sleep_stage: new Set(['minute']), weight: new Set(['kg']), workout: new Set(['minute']),
  hrv: new Set(['ms']), spo2: new Set(['percent']),
};

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function derivedSourceId(record) {
  const normalized = {
    provider: record.provider, connector_type: record.connector_type, domain: record.domain,
    source_app: record.source_app || '', recorded_at: record.recorded_at || '',
    started_at: record.started_at || '', ended_at: record.ended_at || '',
    timezone: record.timezone || '', local_date: record.local_date || '', unit: record.unit || '',
    stage: record.stage || '',
  };
  return sha256(JSON.stringify(stable(normalized)));
}

function sourceFingerprint(record) {
  return sha256(JSON.stringify(stable({
    source_record_id: record.source_record_id, value: record.value, unit: record.unit,
    recorded_at: record.recorded_at, started_at: record.started_at || '',
    ended_at: record.ended_at || '', stage: record.stage || '',
  })));
}

function normalizeRecord(record, envelope) {
  if (!record || !DOMAINS.has(record.domain)) throw new Error('UNSUPPORTED_DOMAIN');
  if (!UNITS[record.domain].has(record.unit)) throw new Error('INVALID_UNIT');
  if (!Number.isFinite(record.value) || record.value < 0) throw new Error('INVALID_VALUE');
  if (!Number.isFinite(Date.parse(record.recorded_at))) throw new Error('INVALID_RECORDED_AT');
  if (!record.timezone || !/^\d{4}-\d{2}-\d{2}$/u.test(record.local_date || '')) throw new Error('INVALID_CIVIL_TIME');
  const native = typeof record.native_record_id === 'string' && record.native_record_id.length > 0;
  const sourceRecordId = native ? record.native_record_id : derivedSourceId({ ...record, ...envelope });
  const normalized = {
    ...record, provider: envelope.provider, connector_type: envelope.connector_type,
    source_record_id: sourceRecordId,
    source_record_id_kind: native ? 'NATIVE' : 'DERIVED_FINGERPRINT',
    sync_method: envelope.connector_type === 'ios_shortcut' ? 'USER_AUTOMATION'
      : envelope.connector_type === 'android_helper' ? 'BACKGROUND_HELPER' : 'SCHEDULED_EXPORT',
  };
  return Object.freeze({ ...normalized, source_fingerprint: sourceFingerprint(normalized) });
}

function validateEnvelope(payload, canonicalUserId) {
  if (!payload || payload.schema_version !== SCHEMA_VERSION) throw new Error('BAD_SCHEMA');
  if (payload.canonical_user_id !== canonicalUserId) throw new Error('BAD_AUTH');
  if (payload.provider !== 'apple_health' || payload.connector_type !== 'ios_shortcut') throw new Error('BAD_CONNECTOR');
  if (!Array.isArray(payload.records) || payload.records.length > 250) throw new Error('BAD_RECORDS');
  if (!Number.isFinite(Date.parse(payload.sync_window_start)) || !Number.isFinite(Date.parse(payload.sync_window_end))) throw new Error('BAD_SYNC_WINDOW');
  return Object.freeze({ ...payload, records: payload.records.map((record) => normalizeRecord(record, payload)) });
}

const CAPABILITIES = Object.freeze({
  ios: Object.freeze([
    { connector: 'ios_shortcut', label: '加入健康同步捷徑', installRequired: false, status: 'BETA_PRIMARY' },
    { connector: 'ios_helper', label: 'iOS 原生同步器', installRequired: true, status: 'FUTURE_OPTIONAL' },
  ]),
  android: Object.freeze([
    { connector: 'android_helper', label: '下載 Android Beta', installRequired: true, status: 'BETA_PRIMARY' },
    { connector: 'health_connect_export', label: 'Health Connect 匯出診斷', installRequired: false, status: 'FALLBACK_DIAGNOSTIC' },
    { connector: 'vendor_cloud', label: '品牌雲端連線', installRequired: false, status: 'FUTURE_CONDITIONAL' },
  ]),
});

function connectorOptions(os) { return CAPABILITIES[String(os).toLowerCase()] || []; }

function selectSource(records) {
  if (!Array.isArray(records) || records.length === 0) return null;
  const ranked = [...records].sort((a, b) => {
    const quality = (record) => [record.native_provenance === true ? 1 : 0, Number(record.data_resolution || 0), Date.parse(record.recorded_at || 0), -Number(record.duplicate_risk || 0)];
    const left = quality(a); const right = quality(b);
    for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return right[index] - left[index];
    return String(a.source_fingerprint || '').localeCompare(String(b.source_fingerprint || ''));
  });
  return ranked[0];
}

class ConnectorRecordReconciler {
  constructor() { this.state = new Map(); }
  apply(record) {
    const key = `${record.canonical_user_id}\x1f${record.connector_type}\x1f${record.domain}\x1f${record.source_record_id}`;
    const revision = Number(record.source_revision || 1);
    const current = this.state.get(key);
    if (!current) { this.state.set(key, { revision, fingerprint: record.source_fingerprint }); return 'CREATE'; }
    if (revision < current.revision) return 'STALE_UPDATE';
    if (revision === current.revision) return current.fingerprint === record.source_fingerprint ? 'REPLAY' : 'CONFLICT';
    this.state.set(key, { revision, fingerprint: record.source_fingerprint });
    return 'UPDATE';
  }
}

module.exports = { CAPABILITIES, CONNECTORS, ConnectorRecordReconciler, DOMAINS, SCHEMA_VERSION, connectorOptions, derivedSourceId, normalizeRecord, selectSource, validateEnvelope };
