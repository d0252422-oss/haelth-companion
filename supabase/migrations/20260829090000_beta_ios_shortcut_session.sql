-- Beta-only Shortcut sessions. A one-time web-issued iOS claim is exchanged for
-- one scoped bearer session; plaintext claim/session credentials are never stored.

create table private.beta_shortcut_sessions (
  id uuid primary key default gen_random_uuid(),
  canonical_user_id uuid not null references public.users(id) on delete cascade,
  access_token_digest text not null unique check (access_token_digest ~ '^[0-9a-f]{64}$'),
  environment text not null default 'beta' check (environment = 'beta'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beta_shortcut_sessions_expiry_check check (expires_at > created_at)
);

alter table private.beta_shortcut_sessions enable row level security;
revoke all on table private.beta_shortcut_sessions from public, anon, authenticated;
grant select, insert, update on table private.beta_shortcut_sessions to service_role;

create or replace function public.beta_exchange_shortcut_claim(
  p_claim_digest text,
  p_access_token_digest text,
  p_expires_at timestamptz
) returns table(session_id uuid, canonical_user_id uuid, environment text)
language plpgsql
security definer
set search_path = ''
as $$
declare claim private.mobile_install_claims%rowtype;
declare created private.beta_shortcut_sessions%rowtype;
begin
  select * into claim from private.mobile_install_claims
   where claim_digest = p_claim_digest for update;
  if not found then raise exception 'INVALID_CLAIM'; end if;
  if claim.platform <> 'ios' then raise exception 'PLATFORM_MISMATCH'; end if;
  if claim.revoked_at is not null then raise exception 'REVOKED_CLAIM'; end if;
  if claim.consumed_at is not null then raise exception 'REPLAYED_CLAIM'; end if;
  if claim.expires_at <= now() then raise exception 'EXPIRED_CLAIM'; end if;
  if claim.environment <> 'beta' then raise exception 'WRONG_ENVIRONMENT'; end if;
  if p_access_token_digest !~ '^[0-9a-f]{64}$'
     or p_expires_at <= now()
     or p_expires_at > now() + interval '24 hours 5 seconds' then
    raise exception 'INVALID_SESSION_INPUT';
  end if;

  update private.mobile_install_claims set consumed_at = now() where id = claim.id;
  insert into private.beta_shortcut_sessions(canonical_user_id, access_token_digest, expires_at)
  values (claim.canonical_user_id, p_access_token_digest, p_expires_at)
  returning * into created;

  return query select created.id, created.canonical_user_id, created.environment;
end;
$$;

create or replace function public.beta_authorize_shortcut_session(
  p_session_id uuid,
  p_access_token_digest text
) returns table(canonical_user_id uuid, environment text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    update private.beta_shortcut_sessions s
       set last_seen_at = now(), updated_at = now()
     where s.id = p_session_id
       and s.access_token_digest = p_access_token_digest
       and s.revoked_at is null
       and s.expires_at > now()
       and s.environment = 'beta'
    returning s.canonical_user_id, s.environment;
end;
$$;

revoke all on function public.beta_exchange_shortcut_claim(text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.beta_authorize_shortcut_session(uuid,text) from public, anon, authenticated;
grant execute on function public.beta_exchange_shortcut_claim(text,text,timestamptz) to service_role;
grant execute on function public.beta_authorize_shortcut_session(uuid,text) to service_role;

comment on table private.beta_shortcut_sessions is
  'Hashed, revocable Beta iOS Shortcut sessions created from one-time web-authenticated claims.';
