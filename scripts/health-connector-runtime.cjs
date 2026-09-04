'use strict';

const { ConnectorRecordReconciler, validateEnvelope } = require('./health-connector-contract.cjs');

const MAX_BODY_BYTES = 1024 * 1024;

function createHealthConnectorRuntime(options = {}) {
  const authenticateRequest = options.authenticateRequest || (async () => { throw httpError('AUTH_REQUIRED', 401); });
  const reconciler = options.reconciler || new ConnectorRecordReconciler();

  async function handler(request, response) {
    try {
      if (request.method !== 'POST' || request.url !== '/v1/connectors/ios-shortcut/ingest') {
        return send(response, 404, { error: 'NOT_FOUND' });
      }
      const canonicalUserId = await authenticateRequest(request);
      const payload = validateEnvelope(await readJSON(request), canonicalUserId);
      const results = payload.records.map((record) => ({
        source_record_id: record.source_record_id,
        source_record_id_kind: record.source_record_id_kind,
        decision: reconciler.apply({
          ...record,
          canonical_user_id: canonicalUserId,
          source_revision: record.source_revision || 1,
        }),
      }));
      return send(response, 200, { schema_version: payload.schema_version, results });
    } catch (error) {
      const code = error.code || error.message || 'INTERNAL_ERROR';
      const status = error.status || ({ BAD_AUTH: 403, BAD_SCHEMA: 400 }[code] || 400);
      return send(response, status, { error: code });
    }
  }
  return { handler, reconciler };
}

async function readJSON(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw httpError('BODY_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw httpError('MALFORMED_JSON', 400); }
}

function send(response, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-length': data.length });
  response.end(data);
}

function httpError(code, status) { const error = new Error(code); error.code = code; error.status = status; return error; }

module.exports = { createHealthConnectorRuntime };
