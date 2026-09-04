-- Minimal canonical foundation for the isolated Health Companion Beta project.
-- This migration is intentionally narrower than the production HDL v2 draft.
-- It is safe only after the deployment guard proves the target is the dedicated
-- Beta project and is never an authorization to apply it to production.

create table if not exists public.users (
  id uuid primary key,
  external_subject_hash text not null unique
    check (external_subject_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED')),
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users enable row level security;
revoke all on table public.users from public, anon, authenticated;
grant select, insert, update on table public.users to service_role;

create table public.beta_health_records (
  id uuid primary key default gen_random_uuid(),
  canonical_user_id uuid not null references public.users(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios')),
  domain text not null check (domain in (
    'steps', 'heart_rate', 'resting_heart_rate', 'sleep', 'sleep_stage',
    'weight', 'workout', 'hrv', 'spo2'
  )),
  source_app text not null,
  source_record_id text not null,
  source_revision bigint not null check (source_revision > 0),
  source_updated_at timestamptz,
  source_content_hash text not null check (source_content_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null check (idempotency_key ~ '^[0-9a-f]{64}$'),
  operation text not null check (operation in ('UPSERT', 'DELETE')),
  canonical_record jsonb,
  affected_local_dates date[] not null default '{}'::date[],
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beta_health_records_identity_uq
    unique (canonical_user_id, platform, domain, source_app, source_record_id),
  constraint beta_health_records_delete_payload_check check (
    (operation = 'UPSERT' and canonical_record is not null and invalidated_at is null)
    or (operation = 'DELETE' and canonical_record is null and invalidated_at is not null)
  )
);

alter table public.beta_health_records enable row level security;
revoke all on table public.beta_health_records from public, anon, authenticated;
grant select, insert, update on table public.beta_health_records to service_role;

create table public.beta_connector_status (
  id uuid primary key default gen_random_uuid(),
  canonical_user_id uuid not null references public.users(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios')),
  connector_type text not null,
  connector_version text not null,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_result text not null,
  available_domains text[] not null default '{}'::text[],
  permission_state text not null default 'UNKNOWN',
  updated_at timestamptz not null default now(),
  constraint beta_connector_status_identity_uq
    unique (canonical_user_id, platform, connector_type)
);

alter table public.beta_connector_status enable row level security;
revoke all on table public.beta_connector_status from public, anon, authenticated;
grant select, insert, update on table public.beta_connector_status to service_role;

comment on table public.beta_health_records is
  'Isolated closed-beta HDL v2 records. Not a production source or cutover target.';
