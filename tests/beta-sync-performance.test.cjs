'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const migration = fs.readFileSync('supabase/migrations/20260902163000_beta_bulk_ingestion_and_score_queue.sql', 'utf8');
const edge = fs.readFileSync('supabase/functions/mobile-health-beta/index.ts', 'utf8');

test('Beta bulk ingestion preserves existing reconciliation function and service-role-only boundary', () => {
  assert.match(migration, /beta_ingest_health_mutation_batch/u);
  assert.match(migration, /public\.beta_ingest_health_mutation\(/u);
  assert.match(migration, /jsonb_array_length\(p_mutations\) > 100/u);
  assert.match(migration, /CROSS_USER_UPLOAD/u);
  assert.match(migration, /revoke all on function public\.beta_ingest_health_mutation_batch[\s\S]*from public, anon, authenticated/u);
  assert.match(migration, /grant execute on function public\.beta_ingest_health_mutation_batch[\s\S]*to service_role/u);
});

test('Android ingestion uses one bulk RPC and returns score queued without blocking uploads', () => {
  const ingest = edge.slice(edge.indexOf('async function ingest('), edge.indexOf('async function reportStatus('));
  assert.match(ingest, /beta_ingest_health_mutation_batch/u);
  assert.doesNotMatch(ingest, /recomputeBetaScore|recomputeDates/u);
  assert.match(migration, /'score_status', 'QUEUED'/u);
});
