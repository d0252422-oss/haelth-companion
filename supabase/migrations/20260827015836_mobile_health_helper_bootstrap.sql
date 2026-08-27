-- Server-only bootstrap/session registry for Android and iOS health-sync helpers.
-- No raw claim or bearer/refresh credential is stored. This migration is prepared
-- locally and is not authorization to apply it to production.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.mobile_install_claims (
  id uuid primary key default gen_random_uuid(),
  canonical_user_id uuid not null references public.users(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios')),
  claim_digest text not null unique check (claim_digest ~ '^[0-9a-f]{64}$'),
  installation_key_fingerprint text not null check (installation_key_fingerprint ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint mobile_install_claims_lifecycle_check check (
    consumed_at is null or consumed_at >= created_at
  )
);

create index mobile_install_claims_expiry_idx
  on private.mobile_install_claims (expires_at)
  where consumed_at is null and revoked_at is null;

create table private.mobile_app_sessions (
  id uuid primary key default gen_random_uuid(),
  canonical_user_id uuid not null references public.users(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios')),
  installation_key_fingerprint text not null check (installation_key_fingerprint ~ '^[0-9a-f]{64}$'),
  access_token_digest text not null unique check (access_token_digest ~ '^[0-9a-f]{64}$'),
  refresh_token_digest text not null unique check (refresh_token_digest ~ '^[0-9a-f]{64}$'),
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mobile_app_sessions_expiry_check check (refresh_expires_at > access_expires_at),
  constraint mobile_app_sessions_installation_key unique (platform, installation_key_fingerprint)
);

alter table private.mobile_install_claims enable row level security;
alter table private.mobile_app_sessions enable row level security;
revoke all on table private.mobile_install_claims from public, anon, authenticated;
revoke all on table private.mobile_app_sessions from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update on table private.mobile_install_claims to service_role;
grant select, insert, update on table private.mobile_app_sessions to service_role;

comment on table private.mobile_install_claims is
  'Hashed, short-lived, one-time web-authenticated install claims. Plaintext claims never persist.';
comment on table private.mobile_app_sessions is
  'Hashed mobile helper session credentials bound to one canonical user and installation key.';
