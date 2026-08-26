-- DRAFT ONLY
-- NOT APPROVED FOR PRODUCTION
-- DO NOT EXECUTE AGAINST ANY PRODUCTION DATABASE
-- AI Pool Phase 2C-1 architecture artifact, 2026-08-25
--
-- This file is additive by design. It contains no DROP TABLE, TRUNCATE, data
-- backfill, destructive type conversion, or extension relocation.
-- Remove the guard only in an isolated local/staging review copy.

begin;

do $draft_execution_guard$
begin
  raise exception 'DRAFT ONLY — NOT APPROVED FOR PRODUCTION';
end
$draft_execution_guard$;

-- Everything below remains inside the aborted transaction if this file is
-- accidentally submitted as a batch. The final ROLLBACK is intentional.

create type public.health_source_type as enum (
  'MANUAL',
  'LEGACY_SHEET',
  'HEALTH_CONNECT',
  'WEARABLE',
  'AI_DERIVED',
  'SYSTEM_DERIVED',
  'IMPORT',
  'OTHER_APP'
);

create type public.health_record_layer as enum (
  'RAW',
  'CANONICAL',
  'DAILY_AGGREGATE',
  'DERIVED'
);

create type public.health_metric_type as enum (
  'HEART_RATE_BPM',
  'RESTING_HEART_RATE_BPM',
  'HRV_RMSSD_MS',
  'SPO2_PERCENT',
  'SKIN_TEMPERATURE_C',
  'RESPIRATORY_RATE_BPM'
);

create type public.device_status as enum ('ACTIVE', 'INACTIVE', 'REVOKED');
create type public.external_identity_provider as enum ('GOOGLE', 'LINE', 'LEGACY_SHEET');
create type public.identity_link_status as enum ('VERIFIED', 'QUARANTINED', 'REVOKED');
create type public.ingestion_status as enum ('RECEIVED', 'PROCESSING', 'ACCEPTED', 'PARTIAL', 'REJECTED', 'ROLLED_BACK');
create type public.data_quality_severity as enum ('INFO', 'WARNING', 'HIGH', 'CRITICAL');
create type public.data_quality_status as enum ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED');

-- ---------------------------------------------------------------------------
-- Identity and ingestion
-- ---------------------------------------------------------------------------

create table public.user_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider public.external_identity_provider not null,
  provider_subject_hash text not null,
  normalized_email_hash text,
  legacy_source text,
  status public.identity_link_status not null default 'QUARANTINED',
  verified_at timestamptz,
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_identities_subject_hash_check
    check (provider_subject_hash ~ '^[0-9a-f]{64}$'),
  constraint user_identities_email_hash_check
    check (normalized_email_hash is null or normalized_email_hash ~ '^[0-9a-f]{64}$'),
  constraint user_identities_provider_subject_key
    unique (provider, provider_subject_hash),
  constraint user_identities_owner_key unique (id, user_id)
);

create table public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source_system text not null,
  source_device_id text not null,
  manufacturer text,
  model text,
  device_category text not null,
  capabilities jsonb not null default '{}'::jsonb,
  accuracy_profile jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  status public.device_status not null default 'ACTIVE',
  confidence numeric(5,4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_devices_confidence_check check (confidence is null or confidence between 0 and 1),
  constraint user_devices_source_key unique (user_id, source_system, source_device_id),
  constraint user_devices_owner_key unique (id, user_id)
);

create table public.ingestion_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source_type public.health_source_type not null,
  source_system text not null,
  source_device_id uuid,
  idempotency_key text not null,
  source_started_at timestamptz,
  source_ended_at timestamptz,
  received_at timestamptz not null default now(),
  status public.ingestion_status not null default 'RECEIVED',
  accepted_count integer not null default 0,
  rejected_count integer not null default 0,
  payload_hash text,
  schema_version text not null,
  safe_metadata jsonb not null default '{}'::jsonb,
  error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ingestion_events_device_owner_fk
    foreign key (source_device_id, user_id)
    references public.user_devices(id, user_id),
  constraint ingestion_events_counts_check
    check (accepted_count >= 0 and rejected_count >= 0),
  constraint ingestion_events_idempotency_key
    unique (user_id, source_system, idempotency_key),
  constraint ingestion_events_owner_key unique (id, user_id)
);

create table public.health_samples (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  observed_at timestamptz not null,
  recorded_at timestamptz,
  observed_timezone text,
  observed_utc_offset_minutes smallint,
  local_date date not null,
  metric_type public.health_metric_type not null,
  numeric_value numeric not null,
  unit text,
  record_layer public.health_record_layer not null default 'RAW',
  source_type public.health_source_type not null,
  source_system text not null,
  source_device_id uuid,
  source_record_id text,
  source_fingerprint text not null,
  fingerprint_version text not null default 'sha256-canonical-v1',
  ingestion_id uuid,
  confidence numeric(5,4),
  data_quality jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id, observed_at),
  constraint health_samples_layer_check
    check (source_type <> 'AI_DERIVED' and record_layer in ('RAW', 'CANONICAL')),
  constraint health_samples_confidence_check
    check (confidence is null or confidence between 0 and 1),
  constraint health_samples_fingerprint_check
    check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint health_samples_offset_check
    check (observed_utc_offset_minutes is null or observed_utc_offset_minutes between -840 and 840),
  constraint health_samples_device_owner_fk
    foreign key (source_device_id, user_id)
    references public.user_devices(id, user_id),
  constraint health_samples_ingestion_owner_fk
    foreign key (ingestion_id, user_id)
    references public.ingestion_events(id, user_id)
) partition by range (observed_at);

-- Fail-safe quarantine only. A reviewed pre-creation job must create monthly
-- partitions before high-rate ingestion; normal-operation row count here is 0.
create table public.health_samples_default
  partition of public.health_samples default;

-- Direct partition access must never bypass the parent boundary. Every future
-- monthly partition is created in the same transaction with RLS enabled and
-- anon/authenticated revoked before it can receive data.
alter table public.health_samples_default enable row level security;
revoke all on table public.health_samples_default from public, anon, authenticated;
revoke update, delete on table public.health_samples_default from service_role;
grant select, insert on table public.health_samples_default to service_role;

create unique index health_samples_fingerprint_uq
  on public.health_samples (user_id, source_system, observed_at, fingerprint_version, source_fingerprint);

create index health_samples_user_metric_time_idx
  on public.health_samples (user_id, metric_type, observed_at desc);

create index health_samples_ingestion_idx
  on public.health_samples (ingestion_id, user_id)
  where ingestion_id is not null;

create index ingestion_events_pending_idx
  on public.ingestion_events (status, received_at)
  where status in ('RECEIVED', 'PROCESSING', 'PARTIAL');

-- ---------------------------------------------------------------------------
-- Canonical activity, training, sleep and subjective inputs
-- ---------------------------------------------------------------------------

create table public.activity_daily (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  local_date date not null,
  observed_at timestamptz not null,
  recorded_at timestamptz,
  observed_timezone text,
  observed_utc_offset_minutes smallint,
  steps integer,
  active_calories_kcal numeric,
  total_calories_kcal numeric,
  distance_m numeric,
  active_minutes integer,
  source_type public.health_source_type not null,
  source_system text not null,
  source_device_id uuid,
  source_record_id text,
  ingestion_id uuid,
  confidence numeric(5,4),
  data_quality jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint activity_daily_nonnegative_check check (
    (steps is null or steps >= 0)
    and (active_calories_kcal is null or active_calories_kcal >= 0)
    and (total_calories_kcal is null or total_calories_kcal >= 0)
    and (distance_m is null or distance_m >= 0)
    and (active_minutes is null or active_minutes >= 0)
  ),
  constraint activity_daily_confidence_check check (confidence is null or confidence between 0 and 1),
  constraint activity_daily_offset_check
    check (observed_utc_offset_minutes is null or observed_utc_offset_minutes between -840 and 840),
  constraint activity_daily_device_owner_fk
    foreign key (source_device_id, user_id)
    references public.user_devices(id, user_id),
  constraint activity_daily_ingestion_owner_fk
    foreign key (ingestion_id, user_id)
    references public.ingestion_events(id, user_id)
);

create unique index activity_daily_source_device_uq
  on public.activity_daily (user_id, local_date, source_system, source_device_id)
  where deleted_at is null and source_device_id is not null;

create unique index activity_daily_source_no_device_uq
  on public.activity_daily (user_id, local_date, source_system)
  where deleted_at is null and source_device_id is null;

create index activity_daily_user_date_idx
  on public.activity_daily (user_id, local_date desc)
  where deleted_at is null;

create table public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  workout_id uuid not null references public.workouts(id) on delete cascade,
  exercise_key text,
  exercise_name text not null,
  muscle_group text,
  ordinal integer not null,
  source_type public.health_source_type not null,
  source_system text not null,
  source_record_id text,
  ingestion_id uuid,
  confidence numeric(5,4),
  data_quality jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workout_exercises_ordinal_check check (ordinal > 0),
  constraint workout_exercises_confidence_check check (confidence is null or confidence between 0 and 1),
  constraint workout_exercises_ingestion_owner_fk
    foreign key (ingestion_id, user_id)
    references public.ingestion_events(id, user_id),
  constraint workout_exercises_owner_key unique (id, user_id),
  constraint workout_exercises_parent_key unique (id, workout_id, user_id),
  constraint workout_exercises_order_uq unique (workout_id, ordinal)
    deferrable initially deferred
);

create index workout_exercises_user_workout_idx
  on public.workout_exercises (user_id, workout_id, ordinal);

create table public.daily_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  local_date date not null,
  observed_at timestamptz not null,
  recorded_at timestamptz,
  observed_timezone text,
  observed_utc_offset_minutes smallint,
  mental_score smallint,
  fatigue_score smallint,
  soreness_score smallint,
  motivation_score smallint,
  note text,
  source_type public.health_source_type not null,
  source_system text not null,
  source_record_id text,
  ingestion_id uuid,
  confidence numeric(5,4),
  data_quality jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_checkins_scores_check check (
    (mental_score is null or mental_score between 0 and 100)
    and (fatigue_score is null or fatigue_score between 0 and 100)
    and (soreness_score is null or soreness_score between 0 and 100)
    and (motivation_score is null or motivation_score between 0 and 100)
  ),
  constraint daily_checkins_confidence_check check (confidence is null or confidence between 0 and 1),
  constraint daily_checkins_ingestion_owner_fk
    foreign key (ingestion_id, user_id)
    references public.ingestion_events(id, user_id),
  constraint daily_checkins_source_uq unique (user_id, local_date, source_system)
);

create table public.sleep_daily_summary (
  user_id uuid not null references public.users(id) on delete cascade,
  summary_date date not null,
  observed_at timestamptz not null,
  recorded_at timestamptz not null,
  observed_timezone text,
  observed_utc_offset_minutes smallint,
  source_type public.health_source_type not null default 'SYSTEM_DERIVED',
  source_system text not null default 'health_data_layer_v2.sleep_summary',
  source_record_id text,
  ingestion_id uuid,
  confidence numeric(5,4),
  sleep_minutes integer,
  awake_minutes integer,
  deep_sleep_minutes integer,
  rem_sleep_minutes integer,
  light_sleep_minutes integer,
  sleep_score numeric,
  avg_hr numeric,
  min_hr numeric,
  hrv_rmssd_ms numeric,
  session_count integer not null default 0,
  completeness numeric(5,4),
  summary_version integer not null default 1,
  algorithm_version text not null,
  input_fingerprint text not null,
  data_quality jsonb not null default '{}'::jsonb,
  source_max_updated_at timestamptz,
  is_stale boolean not null default true,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, summary_date),
  constraint sleep_daily_summary_nonnegative_check check (
    (sleep_minutes is null or sleep_minutes >= 0)
    and (awake_minutes is null or awake_minutes >= 0)
    and (deep_sleep_minutes is null or deep_sleep_minutes >= 0)
    and (rem_sleep_minutes is null or rem_sleep_minutes >= 0)
    and (light_sleep_minutes is null or light_sleep_minutes >= 0)
    and session_count >= 0
  ),
  constraint sleep_daily_summary_completeness_check check (completeness is null or completeness between 0 and 1),
  constraint sleep_daily_summary_confidence_check check (confidence is null or confidence between 0 and 1),
  constraint sleep_daily_summary_offset_check
    check (observed_utc_offset_minutes is null or observed_utc_offset_minutes between -840 and 840),
  constraint sleep_daily_summary_ingestion_owner_fk
    foreign key (ingestion_id, user_id)
    references public.ingestion_events(id, user_id),
  constraint sleep_daily_summary_source_check check (source_type = 'SYSTEM_DERIVED')
);

-- ---------------------------------------------------------------------------
-- Nutrition summaries, scoring and AI provenance
-- ---------------------------------------------------------------------------

create table public.nutrition_daily_summary (
  user_id uuid not null references public.users(id) on delete cascade,
  summary_date date not null,
  observed_at timestamptz not null,
  recorded_at timestamptz not null,
  observed_timezone text,
  observed_utc_offset_minutes smallint,
  source_type public.health_source_type not null default 'SYSTEM_DERIVED',
  source_system text not null default 'health_data_layer_v2.nutrition_summary',
  source_record_id text,
  ingestion_id uuid,
  confidence numeric(5,4),
  calories_kcal numeric,
  protein_g numeric,
  carbohydrates_g numeric,
  fat_g numeric,
  fiber_g numeric,
  meal_count integer not null default 0,
  confirmed_meal_count integer not null default 0,
  completeness numeric(5,4),
  summary_version integer not null default 1,
  algorithm_version text not null,
  input_fingerprint text not null,
  data_quality jsonb not null default '{}'::jsonb,
  source_max_updated_at timestamptz,
  is_stale boolean not null default true,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, summary_date),
  constraint nutrition_daily_summary_nonnegative_check check (
    (calories_kcal is null or calories_kcal >= 0)
    and (protein_g is null or protein_g >= 0)
    and (carbohydrates_g is null or carbohydrates_g >= 0)
    and (fat_g is null or fat_g >= 0)
    and (fiber_g is null or fiber_g >= 0)
    and meal_count >= 0
    and confirmed_meal_count >= 0
  ),
  constraint nutrition_daily_summary_completeness_check check (completeness is null or completeness between 0 and 1),
  constraint nutrition_daily_summary_confidence_check check (confidence is null or confidence between 0 and 1),
  constraint nutrition_daily_summary_offset_check
    check (observed_utc_offset_minutes is null or observed_utc_offset_minutes between -840 and 840),
  constraint nutrition_daily_summary_ingestion_owner_fk
    foreign key (ingestion_id, user_id)
    references public.ingestion_events(id, user_id),
  constraint nutrition_daily_summary_source_check check (source_type = 'SYSTEM_DERIVED')
);

create table public.health_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  score_date date not null,
  observed_at timestamptz not null,
  recorded_at timestamptz not null,
  observed_timezone text,
  observed_utc_offset_minutes smallint,
  overall_score numeric,
  score_state text not null,
  publication_status text not null default 'DRAFT',
  completeness numeric(5,4),
  confidence numeric(5,4),
  algorithm_version text not null,
  input_fingerprint text not null,
  source_type public.health_source_type not null default 'SYSTEM_DERIVED',
  source_system text not null default 'health_data_layer_v2.scoring',
  source_record_id text,
  ingestion_id uuid,
  data_quality jsonb not null default '{}'::jsonb,
  source_max_updated_at timestamptz,
  is_stale boolean not null default true,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint health_scores_overall_check check (overall_score is null or overall_score between 0 and 100),
  constraint health_scores_completeness_check check (completeness is null or completeness between 0 and 1),
  constraint health_scores_confidence_check check (confidence is null or confidence between 0 and 1),
  constraint health_scores_offset_check
    check (observed_utc_offset_minutes is null or observed_utc_offset_minutes between -840 and 840),
  constraint health_scores_publication_check
    check (publication_status in ('DRAFT', 'ACTIVE', 'SUPERSEDED')),
  constraint health_scores_ingestion_owner_fk
    foreign key (ingestion_id, user_id)
    references public.ingestion_events(id, user_id),
  constraint health_scores_version_input_uq
    unique (user_id, score_date, algorithm_version, input_fingerprint),
  constraint health_scores_owner_key unique (id, user_id)
);

create index health_scores_user_date_idx
  on public.health_scores (user_id, score_date desc, computed_at desc);

create unique index health_scores_one_active_uq
  on public.health_scores (user_id, score_date)
  where publication_status = 'ACTIVE';

create table public.health_score_components (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  health_score_id uuid not null,
  domain text not null,
  component_key text not null,
  component_score numeric,
  weight numeric,
  confidence numeric(5,4),
  evidence jsonb not null default '{}'::jsonb,
  data_quality jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint health_score_components_parent_owner_fk
    foreign key (health_score_id, user_id)
    references public.health_scores(id, user_id) on delete cascade,
  constraint health_score_components_score_check check (component_score is null or component_score between 0 and 100),
  constraint health_score_components_confidence_check check (confidence is null or confidence between 0 and 1),
  constraint health_score_components_key_uq unique (health_score_id, domain, component_key)
);

create table public.ai_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  analysis_type text not null,
  provider text not null,
  model text not null,
  prompt_version text,
  schema_version text not null,
  status text not null,
  attempt_count integer not null default 0,
  source_request_id text,
  input_fingerprint text not null,
  output_fingerprint text,
  input_ingestion_id uuid,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  safe_metadata jsonb not null default '{}'::jsonb,
  error_code text,
  started_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_analysis_runs_nonnegative_check check (
    (latency_ms is null or latency_ms >= 0)
    and (input_tokens is null or input_tokens >= 0)
    and (output_tokens is null or output_tokens >= 0)
    and attempt_count >= 0
  ),
  constraint ai_analysis_runs_ingestion_owner_fk
    foreign key (input_ingestion_id, user_id)
    references public.ingestion_events(id, user_id),
  constraint ai_analysis_runs_request_uq unique (user_id, provider, source_request_id),
  constraint ai_analysis_runs_owner_key unique (id, user_id)
);

create unique index ai_analysis_runs_input_version_uq
  on public.ai_analysis_runs (
    user_id,
    analysis_type,
    provider,
    model,
    coalesce(prompt_version, ''),
    schema_version,
    input_fingerprint
  );

create table public.ai_derived_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  ai_analysis_run_id uuid not null,
  metric_type text not null,
  numeric_value numeric,
  text_value text,
  unit text,
  observed_at timestamptz not null,
  recorded_at timestamptz,
  observed_timezone text,
  observed_utc_offset_minutes smallint,
  period_end_at timestamptz,
  source_type public.health_source_type not null default 'AI_DERIVED',
  source_system text not null,
  source_record_id text,
  confidence numeric(5,4),
  data_quality jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_derived_metrics_run_owner_fk
    foreign key (ai_analysis_run_id, user_id)
    references public.ai_analysis_runs(id, user_id) on delete cascade,
  constraint ai_derived_metrics_value_check check (numeric_value is not null or text_value is not null),
  constraint ai_derived_metrics_source_check check (source_type = 'AI_DERIVED'),
  constraint ai_derived_metrics_confidence_check check (confidence is null or confidence between 0 and 1)
);

-- V1 sync_state remains transition-only because its (user_id, record_type)
-- primary key cannot represent independent source/device cursors safely.
create table public.sync_cursors_v2 (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source_system text not null,
  source_device_id uuid,
  record_type text not null,
  cursor_value text,
  cursor_version integer not null default 1,
  status text not null default 'ACTIVE',
  attempt_count integer not null default 0,
  last_error_code text,
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sync_cursors_v2_device_owner_fk
    foreign key (source_device_id, user_id)
    references public.user_devices(id, user_id),
  constraint sync_cursors_v2_attempt_check check (attempt_count >= 0),
  constraint sync_cursors_v2_version_check check (cursor_version > 0),
  constraint sync_cursors_v2_owner_key unique (id, user_id)
);

create unique index sync_cursors_v2_device_uq
  on public.sync_cursors_v2 (user_id, source_system, record_type, source_device_id)
  where source_device_id is not null;

create unique index sync_cursors_v2_no_device_uq
  on public.sync_cursors_v2 (user_id, source_system, record_type)
  where source_device_id is null;

create index sync_cursors_v2_retry_idx
  on public.sync_cursors_v2 (status, updated_at)
  where status <> 'ACTIVE';

-- Durable, service-only invalidation queue. Fact writes and queue upserts must
-- occur in the same transaction. Workers lease rows and clear stale state only
-- after the stored source watermark has been fully incorporated.
create table public.summary_recompute_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  summary_domain text not null,
  local_date date not null,
  source_watermark timestamptz not null,
  source_generation bigint not null default 1,
  status text not null default 'PENDING',
  priority smallint not null default 100,
  attempt_count integer not null default 0,
  lease_owner text,
  lease_expires_at timestamptz,
  lease_generation bigint,
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint summary_recompute_queue_domain_check
    check (summary_domain in ('HEALTH', 'NUTRITION', 'SLEEP', 'SCORE')),
  constraint summary_recompute_queue_status_check
    check (status in ('PENDING', 'LEASED', 'RETRY', 'COMPLETE', 'DEAD_LETTER')),
  constraint summary_recompute_queue_attempt_check check (attempt_count >= 0),
  constraint summary_recompute_queue_generation_check check (
    source_generation > 0 and (lease_generation is null or lease_generation > 0)
  ),
  constraint summary_recompute_queue_lease_state_check check (
    (
      status = 'LEASED'
      and lease_owner is not null
      and lease_expires_at is not null
      and lease_generation is not null
      and lease_generation <= source_generation
    )
    or (
      status <> 'LEASED'
      and lease_owner is null
      and lease_expires_at is null
      and lease_generation is null
    )
  ),
  constraint summary_recompute_queue_key_uq unique (user_id, summary_domain, local_date)
);

create index summary_recompute_queue_pending_idx
  on public.summary_recompute_queue (status, next_attempt_at, priority, created_at)
  where status in ('PENDING', 'RETRY');

create index summary_recompute_queue_lease_expiry_idx
  on public.summary_recompute_queue (lease_expires_at)
  where status = 'LEASED';

create table public.data_quality_issues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  rule_key text not null,
  rule_version text not null,
  severity public.data_quality_severity not null,
  status public.data_quality_status not null default 'OPEN',
  entity_type text not null,
  entity_id uuid,
  local_date date,
  safe_details jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index data_quality_issues_action_idx
  on public.data_quality_issues (user_id, status, severity, detected_at desc);

-- ---------------------------------------------------------------------------
-- Additive provenance fields for existing tables. Initially nullable so a
-- separately approved, idempotent backfill can precede NOT NULL constraints.
-- ---------------------------------------------------------------------------

alter table public.body_measurements
  add column if not exists observed_at timestamptz,
  add column if not exists recorded_at timestamptz,
  add column if not exists observed_timezone text,
  add column if not exists observed_utc_offset_minutes smallint,
  add column if not exists source_type public.health_source_type,
  add column if not exists source_system text,
  add column if not exists source_device_id uuid,
  add column if not exists ingestion_id uuid,
  add column if not exists confidence numeric(5,4),
  add column if not exists data_quality jsonb not null default '{}'::jsonb;

alter table public.meals
  add column if not exists observed_at timestamptz,
  add column if not exists recorded_at timestamptz,
  add column if not exists observed_timezone text,
  add column if not exists observed_utc_offset_minutes smallint,
  add column if not exists source_type public.health_source_type,
  add column if not exists source_system text,
  add column if not exists source_device_id uuid,
  add column if not exists source_record_id text,
  add column if not exists ingestion_id uuid,
  add column if not exists confidence numeric(5,4),
  add column if not exists data_quality jsonb not null default '{}'::jsonb,
  add column if not exists input_fingerprint text;

alter table public.meal_items
  add column if not exists user_id uuid,
  add column if not exists observed_at timestamptz,
  add column if not exists recorded_at timestamptz,
  add column if not exists observed_timezone text,
  add column if not exists observed_utc_offset_minutes smallint,
  add column if not exists source_type public.health_source_type,
  add column if not exists source_system text,
  add column if not exists source_record_id text,
  add column if not exists ingestion_id uuid,
  add column if not exists ai_analysis_run_id uuid,
  add column if not exists data_quality jsonb not null default '{}'::jsonb;

alter table public.workouts
  add column if not exists observed_at timestamptz,
  add column if not exists recorded_at timestamptz,
  add column if not exists observed_timezone text,
  add column if not exists observed_utc_offset_minutes smallint,
  add column if not exists source_type public.health_source_type,
  add column if not exists source_system text,
  add column if not exists source_device_id uuid,
  add column if not exists source_record_id text,
  add column if not exists ingestion_id uuid,
  add column if not exists confidence numeric(5,4),
  add column if not exists data_quality jsonb not null default '{}'::jsonb;

alter table public.workout_sets
  add column if not exists user_id uuid,
  add column if not exists workout_exercise_id uuid,
  add column if not exists observed_at timestamptz,
  add column if not exists recorded_at timestamptz,
  add column if not exists observed_timezone text,
  add column if not exists observed_utc_offset_minutes smallint,
  add column if not exists source_type public.health_source_type,
  add column if not exists source_system text,
  add column if not exists ingestion_id uuid,
  add column if not exists confidence numeric(5,4),
  add column if not exists data_quality jsonb not null default '{}'::jsonb;

alter table public.sleep_sessions
  add column if not exists observed_at timestamptz,
  add column if not exists recorded_at timestamptz,
  add column if not exists observed_timezone text,
  add column if not exists observed_utc_offset_minutes smallint,
  add column if not exists source_type public.health_source_type,
  add column if not exists source_system text,
  add column if not exists source_device_id uuid,
  add column if not exists source_record_id text,
  add column if not exists ingestion_id uuid,
  add column if not exists confidence numeric(5,4),
  add column if not exists data_quality jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz;

alter table public.daily_health_summary
  add column if not exists summary_version integer not null default 1,
  add column if not exists algorithm_version text,
  add column if not exists input_fingerprint text,
  add column if not exists observed_at timestamptz,
  add column if not exists recorded_at timestamptz,
  add column if not exists observed_timezone text,
  add column if not exists observed_utc_offset_minutes smallint,
  add column if not exists source_type public.health_source_type,
  add column if not exists source_system text,
  add column if not exists source_device_id uuid,
  add column if not exists source_record_id text,
  add column if not exists ingestion_id uuid,
  add column if not exists confidence numeric(5,4),
  add column if not exists completeness numeric(5,4),
  add column if not exists data_quality jsonb not null default '{}'::jsonb,
  add column if not exists source_max_updated_at timestamptz,
  add column if not exists is_stale boolean not null default true,
  add column if not exists computed_at timestamptz;

-- Child ownership is made enforceable before child RLS is switched to direct
-- user_id predicates. Nullable child user_id remains a deliberate transition
-- state; backfill, validation and NOT NULL are separate reviewed steps.
alter table public.meals
  add constraint meals_owner_key unique (id, user_id);

alter table public.meal_items
  add constraint meal_items_parent_owner_fk
  foreign key (meal_id, user_id) references public.meals(id, user_id)
  not valid;

alter table public.body_measurements
  add constraint body_measurements_ingestion_owner_fk
  foreign key (ingestion_id, user_id)
  references public.ingestion_events(id, user_id)
  not valid;

alter table public.body_measurements
  add constraint body_measurements_device_owner_fk
  foreign key (source_device_id, user_id)
  references public.user_devices(id, user_id)
  not valid;

alter table public.meals
  add constraint meals_ingestion_owner_fk
  foreign key (ingestion_id, user_id)
  references public.ingestion_events(id, user_id)
  not valid;

alter table public.meals
  add constraint meals_device_owner_fk
  foreign key (source_device_id, user_id)
  references public.user_devices(id, user_id)
  not valid;

alter table public.meal_items
  add constraint meal_items_ingestion_owner_fk
  foreign key (ingestion_id, user_id)
  references public.ingestion_events(id, user_id)
  not valid;

alter table public.workouts
  add constraint workouts_owner_key unique (id, user_id);

alter table public.workouts
  add constraint workouts_ingestion_owner_fk
  foreign key (ingestion_id, user_id)
  references public.ingestion_events(id, user_id)
  not valid;

alter table public.workouts
  add constraint workouts_device_owner_fk
  foreign key (source_device_id, user_id)
  references public.user_devices(id, user_id)
  not valid;

alter table public.workout_exercises
  add constraint workout_exercises_workout_owner_fk
  foreign key (workout_id, user_id) references public.workouts(id, user_id);

alter table public.workout_sets
  add constraint workout_sets_parent_owner_fk
  foreign key (workout_id, user_id) references public.workouts(id, user_id)
  not valid;

alter table public.workout_sets
  add constraint workout_sets_ingestion_owner_fk
  foreign key (ingestion_id, user_id)
  references public.ingestion_events(id, user_id)
  not valid;

alter table public.workout_sets
  add constraint workout_sets_exercise_parent_fk
  foreign key (workout_exercise_id, workout_id, user_id)
  references public.workout_exercises(id, workout_id, user_id)
  not valid;

alter table public.meal_items
  add constraint meal_items_analysis_owner_fk
  foreign key (ai_analysis_run_id, user_id)
  references public.ai_analysis_runs(id, user_id)
  not valid;

alter table public.sleep_sessions
  add constraint sleep_sessions_ingestion_owner_fk
  foreign key (ingestion_id, user_id)
  references public.ingestion_events(id, user_id)
  not valid;

alter table public.sleep_sessions
  add constraint sleep_sessions_device_owner_fk
  foreign key (source_device_id, user_id)
  references public.user_devices(id, user_id)
  not valid;

alter table public.daily_health_summary
  add constraint daily_health_summary_ingestion_owner_fk
  foreign key (ingestion_id, user_id)
  references public.ingestion_events(id, user_id)
  not valid;

alter table public.daily_health_summary
  add constraint daily_health_summary_device_owner_fk
  foreign key (source_device_id, user_id)
  references public.user_devices(id, user_id)
  not valid;

-- Rollback/reconciliation probes are always scoped by one ingestion batch.
create index body_measurements_ingestion_idx on public.body_measurements (ingestion_id) where ingestion_id is not null;
create index meals_ingestion_idx on public.meals (ingestion_id) where ingestion_id is not null;
create index meal_items_ingestion_idx on public.meal_items (ingestion_id) where ingestion_id is not null;
create index workouts_ingestion_idx on public.workouts (ingestion_id) where ingestion_id is not null;
create index workout_sets_ingestion_idx on public.workout_sets (ingestion_id) where ingestion_id is not null;
create index sleep_sessions_ingestion_idx on public.sleep_sessions (ingestion_id) where ingestion_id is not null;
create index daily_health_summary_ingestion_idx on public.daily_health_summary (ingestion_id) where ingestion_id is not null;
create index activity_daily_ingestion_idx on public.activity_daily (ingestion_id) where ingestion_id is not null;
create index workout_exercises_ingestion_idx on public.workout_exercises (ingestion_id) where ingestion_id is not null;
create index daily_checkins_ingestion_idx on public.daily_checkins (ingestion_id) where ingestion_id is not null;
create index sleep_daily_summary_ingestion_idx on public.sleep_daily_summary (ingestion_id) where ingestion_id is not null;
create index nutrition_daily_summary_ingestion_idx on public.nutrition_daily_summary (ingestion_id) where ingestion_id is not null;
create index health_scores_ingestion_idx on public.health_scores (ingestion_id) where ingestion_id is not null;
create index ai_analysis_runs_ingestion_idx on public.ai_analysis_runs (input_ingestion_id) where input_ingestion_id is not null;
create index body_measurements_source_device_idx on public.body_measurements (source_device_id, user_id) where source_device_id is not null;
create index meals_source_device_idx on public.meals (source_device_id, user_id) where source_device_id is not null;
create index workouts_source_device_idx on public.workouts (source_device_id, user_id) where source_device_id is not null;
create index sleep_sessions_source_device_idx on public.sleep_sessions (source_device_id, user_id) where source_device_id is not null;
create index daily_health_summary_source_device_idx on public.daily_health_summary (source_device_id, user_id) where source_device_id is not null;
create index body_measurements_dashboard_latest_idx
  on public.body_measurements (user_id, local_date desc, measured_at desc)
  where deleted_at is null;

alter table public.sync_state
  add column if not exists source_system text,
  add column if not exists source_device_id uuid,
  add column if not exists status text,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_error_code text,
  add column if not exists cursor_version integer not null default 1;

-- Backfill and NOT NULL/composite-FK enforcement for the nullable columns above
-- must be separate reviewed steps. Do not combine them with table creation.

-- ---------------------------------------------------------------------------
-- RLS and explicit grants for new tables
-- ---------------------------------------------------------------------------

alter table public.user_devices enable row level security;
alter table public.user_identities enable row level security;
alter table public.ingestion_events enable row level security;
alter table public.health_samples enable row level security;
alter table public.activity_daily enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.daily_checkins enable row level security;
alter table public.sleep_daily_summary enable row level security;
alter table public.nutrition_daily_summary enable row level security;
alter table public.health_scores enable row level security;
alter table public.health_score_components enable row level security;
alter table public.ai_analysis_runs enable row level security;
alter table public.ai_derived_metrics enable row level security;
alter table public.data_quality_issues enable row level security;
alter table public.summary_recompute_queue enable row level security;
alter table public.sync_cursors_v2 enable row level security;

revoke all on table
  public.user_identities,
  public.user_devices,
  public.ingestion_events,
  public.health_samples,
  public.activity_daily,
  public.workout_exercises,
  public.daily_checkins,
  public.sleep_daily_summary,
  public.nutrition_daily_summary,
  public.health_scores,
  public.health_score_components,
  public.ai_analysis_runs,
  public.ai_derived_metrics,
  public.data_quality_issues,
  public.summary_recompute_queue,
  public.sync_cursors_v2
from public, anon, authenticated;

grant select on table
  public.user_devices,
  public.ingestion_events,
  public.health_samples,
  public.activity_daily,
  public.workout_exercises,
  public.daily_checkins,
  public.sleep_daily_summary,
  public.nutrition_daily_summary,
  public.health_scores,
  public.health_score_components,
  public.ai_analysis_runs,
  public.ai_derived_metrics,
  public.data_quality_issues
to authenticated;

grant select, insert, update, delete on table
  public.user_identities,
  public.user_devices,
  public.activity_daily,
  public.workout_exercises,
  public.daily_checkins,
  public.sleep_daily_summary,
  public.nutrition_daily_summary,
  public.health_scores,
  public.health_score_components,
  public.ai_analysis_runs,
  public.ai_derived_metrics,
  public.data_quality_issues,
  public.summary_recompute_queue
to service_role;

revoke delete on table public.sync_cursors_v2 from service_role;
grant select, insert, update on table public.sync_cursors_v2 to service_role;

-- The ingestion identity, owner, source key, payload hash and schema version are
-- immutable audit evidence. Only bounded processing lifecycle fields may change.
revoke update, delete on table public.ingestion_events from service_role;
grant select, insert on table public.ingestion_events to service_role;
grant update (status, accepted_count, rejected_count, error_code, completed_at, updated_at)
  on table public.ingestion_events to service_role;

-- Raw sensor facts are append-only for runtime roles. Staging rollback uses the
-- database owner inside an isolated, explicitly approved rehearsal—not the
-- service_role used by normal ingestion.
revoke update, delete on table public.health_samples from service_role;
grant select, insert on table public.health_samples to service_role;

-- Identity links are deliberately service-only. Email is a discovery hint, not
-- an automatic merge key; collisions remain QUARANTINED for human resolution.

-- Owner SELECT policies for every new table.
do $owner_select_policies$
declare
  table_name text;
begin
  foreach table_name in array array[
    'user_devices', 'ingestion_events', 'health_samples', 'activity_daily',
    'workout_exercises', 'daily_checkins', 'sleep_daily_summary',
    'nutrition_daily_summary', 'health_scores', 'health_score_components',
    'ai_analysis_runs', 'ai_derived_metrics', 'data_quality_issues'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      table_name || '_select_own',
      table_name
    );
  end loop;
end
$owner_select_policies$;

-- Direct authenticated writes are disabled for every V2 fact/provenance table.
-- Writes pass through a trusted transactional API that validates ownership,
-- provenance, idempotency and summary invalidation together.

-- Existing 13 warning-bearing policies require a separate policy-only migration
-- that preserves each current command/role/parent predicate while changing
-- auth.uid() to (select auth.uid()). This draft does not guess their definitions.

-- ---------------------------------------------------------------------------
-- Read-only dashboard RPC. It never refreshes summaries on the read path.
-- ---------------------------------------------------------------------------

create or replace function public.get_dashboard_v2(p_local_date date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select jsonb_build_object(
    'schema_version', '2-draft',
    'local_date', p_local_date,
    'health', to_jsonb(dhs),
    'nutrition', to_jsonb(nds),
    'sleep', to_jsonb(sds),
    'score', to_jsonb(hs),
    'body', to_jsonb(bm),
    'freshness', jsonb_build_object(
      'health', jsonb_build_object('is_stale', dhs.is_stale, 'computed_at', dhs.computed_at, 'source_watermark', dhs.source_max_updated_at),
      'nutrition', jsonb_build_object('is_stale', nds.is_stale, 'computed_at', nds.computed_at, 'source_watermark', nds.source_max_updated_at),
      'sleep', jsonb_build_object('is_stale', sds.is_stale, 'computed_at', sds.computed_at, 'source_watermark', sds.source_max_updated_at),
      'score', jsonb_build_object('is_stale', hs.is_stale, 'computed_at', hs.computed_at, 'source_watermark', hs.source_max_updated_at)
    )
  )
  from (select (select auth.uid()) as user_id) caller
  left join public.daily_health_summary dhs
    on dhs.user_id = caller.user_id
    and dhs.summary_date = p_local_date
    and dhs.deleted_at is null
  left join public.nutrition_daily_summary nds
    on nds.user_id = caller.user_id and nds.summary_date = p_local_date
  left join public.sleep_daily_summary sds
    on sds.user_id = caller.user_id and sds.summary_date = p_local_date
  left join lateral (
    select h.*
    from public.health_scores h
    where h.user_id = caller.user_id
      and h.score_date = p_local_date
      and h.publication_status = 'ACTIVE'
    order by h.computed_at desc
    limit 1
  ) hs on true
  left join lateral (
    select b.*
    from public.body_measurements b
    where b.user_id = caller.user_id
      and b.local_date <= p_local_date
      and b.deleted_at is null
    order by b.local_date desc, b.measured_at desc
    limit 1
  ) bm on true
  where caller.user_id is not null;
$function$;

revoke execute on function public.get_dashboard_v2(date) from public, anon;
grant execute on function public.get_dashboard_v2(date) to authenticated;

-- Proposed refresh posture: service-only, SECURITY INVOKER, idempotent and
-- separately reviewed. No write-capable refresh implementation is included.

rollback;
