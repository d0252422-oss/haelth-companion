-- Android Connector V2: installation-key-bound browser continuation and
-- rotatable/revocable app sessions. Isolated Beta project only.

drop function if exists public.beta_issue_install_claim(uuid,text,text,text,timestamptz,text);

create function public.beta_issue_install_claim(
  p_canonical_user_id uuid,
  p_external_subject_hash text,
  p_platform text,
  p_claim_digest text,
  p_expires_at timestamptz,
  p_binding_method text,
  p_installation_key_fingerprint text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare claim_id uuid;
begin
  if p_platform not in ('android', 'ios')
     or p_binding_method not in ('VERIFIED_APP_LINK', 'ONE_TIME_CODE')
     or p_claim_digest !~ '^[0-9a-f]{64}$'
     or p_external_subject_hash !~ '^[0-9a-f]{64}$'
     or p_expires_at <= now()
     or p_expires_at > now() + interval '5 minutes 5 seconds'
     or (p_binding_method = 'VERIFIED_APP_LINK' and coalesce(p_installation_key_fingerprint, '') !~ '^[0-9a-f]{64}$')
     or (p_binding_method = 'ONE_TIME_CODE' and p_installation_key_fingerprint is not null) then
    raise exception 'INVALID_INSTALL_CLAIM';
  end if;

  insert into public.users(id, external_subject_hash)
  values (p_canonical_user_id, p_external_subject_hash)
  on conflict (id) do update set updated_at = now()
    where public.users.external_subject_hash = excluded.external_subject_hash;
  if not found then raise exception 'CANONICAL_IDENTITY_CONFLICT'; end if;

  insert into private.mobile_install_claims(
    canonical_user_id, platform, claim_digest, installation_key_fingerprint,
    expires_at, environment, binding_method
  ) values (
    p_canonical_user_id, p_platform, p_claim_digest, p_installation_key_fingerprint,
    p_expires_at, 'beta', p_binding_method
  ) returning id into claim_id;
  return claim_id;
end;
$$;

create or replace function public.beta_exchange_install_claim(
  p_claim_digest text,
  p_installation_key_fingerprint text,
  p_installation_public_key_spki bytea,
  p_access_token_digest text,
  p_refresh_token_digest text,
  p_access_expires_at timestamptz,
  p_refresh_expires_at timestamptz
) returns table(session_id uuid, canonical_user_id uuid, platform text, environment text)
language plpgsql
security definer
set search_path = ''
as $$
declare claim private.mobile_install_claims%rowtype;
declare created private.mobile_app_sessions%rowtype;
begin
  select * into claim from private.mobile_install_claims where claim_digest = p_claim_digest for update;
  if not found then raise exception 'INVALID_CLAIM'; end if;
  if claim.revoked_at is not null then raise exception 'REVOKED_CLAIM'; end if;
  if claim.consumed_at is not null then raise exception 'REPLAYED_CLAIM'; end if;
  if claim.expires_at <= now() then raise exception 'EXPIRED_CLAIM'; end if;
  if claim.environment <> 'beta' then raise exception 'WRONG_ENVIRONMENT'; end if;
  if claim.installation_key_fingerprint is not null
     and claim.installation_key_fingerprint <> p_installation_key_fingerprint then
    raise exception 'INSTALLATION_KEY_MISMATCH';
  end if;
  if p_installation_key_fingerprint !~ '^[0-9a-f]{64}$'
     or p_access_token_digest !~ '^[0-9a-f]{64}$'
     or p_refresh_token_digest !~ '^[0-9a-f]{64}$'
     or octet_length(p_installation_public_key_spki) < 64
     or p_access_expires_at <= now()
     or p_refresh_expires_at <= p_access_expires_at then raise exception 'INVALID_SESSION_INPUT';
  end if;

  update private.mobile_install_claims set consumed_at = now(), installation_key_fingerprint = p_installation_key_fingerprint where id = claim.id;
  insert into private.mobile_app_sessions(
    canonical_user_id, platform, installation_key_fingerprint, installation_public_key_spki,
    access_token_digest, refresh_token_digest, access_expires_at, refresh_expires_at,
    environment, last_seen_at
  ) values (
    claim.canonical_user_id, claim.platform, p_installation_key_fingerprint, p_installation_public_key_spki,
    p_access_token_digest, p_refresh_token_digest, p_access_expires_at, p_refresh_expires_at,
    'beta', now()
  ) on conflict (platform, installation_key_fingerprint) do update set
    canonical_user_id = excluded.canonical_user_id,
    installation_public_key_spki = excluded.installation_public_key_spki,
    access_token_digest = excluded.access_token_digest,
    refresh_token_digest = excluded.refresh_token_digest,
    access_expires_at = excluded.access_expires_at,
    refresh_expires_at = excluded.refresh_expires_at,
    revoked_at = null, last_seen_at = now(), updated_at = now()
  returning * into created;
  return query select created.id, created.canonical_user_id, created.platform, created.environment;
end;
$$;

create function public.beta_get_app_session_refresh_material(p_session_id uuid)
returns table(canonical_user_id uuid, installation_public_key_spki bytea, environment text)
language sql security definer set search_path = ''
as $$
  select s.canonical_user_id, s.installation_public_key_spki, s.environment
  from private.mobile_app_sessions s
  where s.id = p_session_id and s.revoked_at is null
    and s.refresh_expires_at > now() and s.environment = 'beta';
$$;

create function public.beta_rotate_app_session(
  p_session_id uuid,
  p_refresh_token_digest text,
  p_new_access_token_digest text,
  p_new_refresh_token_digest text,
  p_access_expires_at timestamptz,
  p_refresh_expires_at timestamptz
) returns table(session_id uuid, canonical_user_id uuid, platform text, environment text)
language plpgsql security definer set search_path = ''
as $$
begin
  return query update private.mobile_app_sessions s set
    access_token_digest = p_new_access_token_digest,
    refresh_token_digest = p_new_refresh_token_digest,
    access_expires_at = p_access_expires_at,
    refresh_expires_at = p_refresh_expires_at,
    last_seen_at = now(), updated_at = now()
  where s.id = p_session_id and s.refresh_token_digest = p_refresh_token_digest
    and s.revoked_at is null and s.refresh_expires_at > now() and s.environment = 'beta'
    and p_new_access_token_digest ~ '^[0-9a-f]{64}$'
    and p_new_refresh_token_digest ~ '^[0-9a-f]{64}$'
    and p_access_expires_at > now() and p_refresh_expires_at > p_access_expires_at
  returning s.id, s.canonical_user_id, s.platform, s.environment;
end;
$$;

create function public.beta_revoke_app_session(p_session_id uuid, p_access_token_digest text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare changed integer;
begin
  update private.mobile_app_sessions s set revoked_at = now(), updated_at = now()
  where s.id = p_session_id and s.access_token_digest = p_access_token_digest
    and s.revoked_at is null and s.environment = 'beta';
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.beta_issue_install_claim(uuid,text,text,text,timestamptz,text,text) from public, anon, authenticated;
revoke all on function public.beta_exchange_install_claim(text,text,bytea,text,text,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.beta_get_app_session_refresh_material(uuid) from public, anon, authenticated;
revoke all on function public.beta_rotate_app_session(uuid,text,text,text,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.beta_revoke_app_session(uuid,text) from public, anon, authenticated;
grant execute on function public.beta_issue_install_claim(uuid,text,text,text,timestamptz,text,text) to service_role;
grant execute on function public.beta_exchange_install_claim(text,text,bytea,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.beta_get_app_session_refresh_material(uuid) to service_role;
grant execute on function public.beta_rotate_app_session(uuid,text,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.beta_revoke_app_session(uuid,text) to service_role;
