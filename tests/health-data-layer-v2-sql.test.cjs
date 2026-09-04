const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'drafts', 'health_data_layer_v2.sql'),
  'utf8',
);

const compact = sql.replace(/--[^\r\n]*/g, ' ').replace(/\s+/g, ' ');

assert.ok(sql.indexOf("raise exception 'DRAFT ONLY") < sql.indexOf('create type public.health_source_type'));
assert.match(sql.trimEnd(), /rollback;$/i);
assert.doesNotMatch(compact, /\bdrop\s+(table|schema|column|constraint)\b/i);
assert.doesNotMatch(compact, /\btruncate\b/i);
assert.doesNotMatch(compact, /\bauth\.role\s*\(/i);

assert.match(sql, /alter table public\.health_samples_default enable row level security;/);
assert.match(sql, /revoke all on table public\.health_samples_default from public, anon, authenticated;/);
assert.match(sql, /revoke update, delete on table public\.health_samples_default from service_role;/);
assert.match(sql, /grant select, insert on table public\.health_samples_default to service_role;/);
assert.match(sql, /revoke update, delete on table public\.health_samples from service_role;/);
assert.match(sql, /grant select, insert on table public\.health_samples to service_role;/);

const serviceCrudGrant = sql.match(/grant select, insert, update, delete on table([\s\S]*?)to service_role;/i)?.[1] || '';
assert.doesNotMatch(serviceCrudGrant, /public\.health_samples/);
assert.doesNotMatch(serviceCrudGrant, /public\.ingestion_events/);
assert.match(sql, /revoke update, delete on table public\.ingestion_events from service_role;/);
assert.match(sql, /grant update \(status, accepted_count, rejected_count, error_code, completed_at, updated_at\)[\s\S]*?public\.ingestion_events to service_role;/);

assert.doesNotMatch(sql, /grant insert, update, delete on table[\s\S]*?to authenticated;/i);
assert.doesNotMatch(sql, /\$owner_write_policies\$/i);

const expectedIngestionConstraints = [
  'health_samples_ingestion_owner_fk',
  'activity_daily_ingestion_owner_fk',
  'workout_exercises_ingestion_owner_fk',
  'daily_checkins_ingestion_owner_fk',
  'sleep_daily_summary_ingestion_owner_fk',
  'nutrition_daily_summary_ingestion_owner_fk',
  'health_scores_ingestion_owner_fk',
  'ai_analysis_runs_ingestion_owner_fk',
  'body_measurements_ingestion_owner_fk',
  'meals_ingestion_owner_fk',
  'meal_items_ingestion_owner_fk',
  'workouts_ingestion_owner_fk',
  'workout_sets_ingestion_owner_fk',
  'sleep_sessions_ingestion_owner_fk',
  'daily_health_summary_ingestion_owner_fk',
];
expectedIngestionConstraints.forEach((name) => assert.match(sql, new RegExp(`constraint ${name}\\b`)));

[
  'health_samples_device_owner_fk',
  'activity_daily_device_owner_fk',
  'body_measurements_device_owner_fk',
  'meals_device_owner_fk',
  'workouts_device_owner_fk',
  'sleep_sessions_device_owner_fk',
  'daily_health_summary_device_owner_fk',
].forEach((name) => assert.match(sql, new RegExp(`constraint ${name}\\b`)));

assert.match(sql, /unique \(user_id, score_date, algorithm_version, input_fingerprint\)/);
assert.match(sql, /where publication_status = 'ACTIVE'/);
assert.match(sql, /source_fingerprint ~ '\^\[0-9a-f\]\{64\}\$'/);
assert.match(sql, /source_generation bigint not null default 1/);
assert.match(sql, /lease_generation bigint/);
assert.match(sql, /summary_recompute_queue_lease_expiry_idx/);
assert.match(sql, /summary_recompute_queue_lease_state_check/);
assert.match(sql, /create table public\.sync_cursors_v2/);
assert.match(sql, /sync_cursors_v2_device_uq/);
assert.match(sql, /sync_cursors_v2_no_device_uq/);
assert.match(sql, /revoke delete on table public\.sync_cursors_v2 from service_role;/);
assert.doesNotMatch(sql, /add column if not exists created_at timestamptz not null default now\(\)/);
assert.match(sql, /security invoker/i);
assert.match(sql, /set search_path = ''/i);
assert.match(sql, /\(select auth\.uid\(\)\) = user_id/);

console.log('Health Data Layer v2 SQL safety contract tests: PASS');
