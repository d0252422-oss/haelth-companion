-- Service-role-only transactional API used by the isolated Beta Edge Function.
-- Public/anon/authenticated callers cannot execute these functions.

create or replace function public.beta_issue_install_claim(
  p_canonical_user_id uuid,
  p_external_subject_hash text,
  p_platform text,
  p_claim_digest text,
  p_expires_at timestamptz,
  p_binding_method text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare claim_id uuid;
begin
  if p_platform not in ('android', 'ios')
     or p_binding_method <> 'ONE_TIME_CODE'
     or p_claim_digest !~ '^[0-9a-f]{64}$'
     or p_external_subject_hash !~ '^[0-9a-f]{64}$'
     or p_expires_at <= now()
     or p_expires_at > now() + interval '5 minutes 5 seconds' then
    raise exception 'INVALID_INSTALL_CLAIM';
  end if;

  insert into public.users(id, external_subject_hash)
  values (p_canonical_user_id, p_external_subject_hash)
  on conflict (id) do update
    set updated_at = now()
    where public.users.external_subject_hash = excluded.external_subject_hash;

  if not found then raise exception 'CANONICAL_IDENTITY_CONFLICT'; end if;

  insert into private.mobile_install_claims(
    canonical_user_id, platform, claim_digest, installation_key_fingerprint,
    expires_at, environment, binding_method
  ) values (
    p_canonical_user_id, p_platform, p_claim_digest, null,
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
  select * into claim from private.mobile_install_claims
   where claim_digest = p_claim_digest for update;
  if not found then raise exception 'INVALID_CLAIM'; end if;
  if claim.revoked_at is not null then raise exception 'REVOKED_CLAIM'; end if;
  if claim.consumed_at is not null then raise exception 'REPLAYED_CLAIM'; end if;
  if claim.expires_at <= now() then raise exception 'EXPIRED_CLAIM'; end if;
  if claim.environment <> 'beta' then raise exception 'WRONG_ENVIRONMENT'; end if;
  if p_installation_key_fingerprint !~ '^[0-9a-f]{64}$'
     or p_access_token_digest !~ '^[0-9a-f]{64}$'
     or p_refresh_token_digest !~ '^[0-9a-f]{64}$'
     or octet_length(p_installation_public_key_spki) < 64
     or p_access_expires_at <= now()
     or p_refresh_expires_at <= p_access_expires_at then
    raise exception 'INVALID_SESSION_INPUT';
  end if;

  update private.mobile_install_claims
     set consumed_at = now(), installation_key_fingerprint = p_installation_key_fingerprint
   where id = claim.id;

  insert into private.mobile_app_sessions(
    canonical_user_id, platform, installation_key_fingerprint,
    installation_public_key_spki, access_token_digest, refresh_token_digest,
    access_expires_at, refresh_expires_at, environment, last_seen_at
  ) values (
    claim.canonical_user_id, claim.platform, p_installation_key_fingerprint,
    p_installation_public_key_spki, p_access_token_digest, p_refresh_token_digest,
    p_access_expires_at, p_refresh_expires_at, 'beta', now()
  ) returning * into created;

  return query select created.id, created.canonical_user_id, created.platform, created.environment;
end;
$$;

create or replace function public.beta_authorize_app_session(
  p_session_id uuid,
  p_access_token_digest text
) returns table(canonical_user_id uuid, platform text, environment text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    update private.mobile_app_sessions s
       set last_seen_at = now(), updated_at = now()
     where s.id = p_session_id
       and s.access_token_digest = p_access_token_digest
       and s.revoked_at is null
       and s.access_expires_at > now()
       and s.environment = 'beta'
    returning s.canonical_user_id, s.platform, s.environment;
end;
$$;

create or replace function public.beta_ingest_health_mutation(
  p_canonical_user_id uuid,
  p_platform text,
  p_domain text,
  p_source_app text,
  p_source_record_id text,
  p_source_revision bigint,
  p_source_updated_at timestamptz,
  p_source_content_hash text,
  p_operation text,
  p_idempotency_key text,
  p_record jsonb,
  p_affected_local_dates date[] default '{}'::date[]
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare selected_action text;
begin
  if p_idempotency_key !~ '^[0-9a-f]{64}$'
     or (p_operation = 'UPSERT' and p_record is null)
     or (p_operation = 'DELETE' and p_record is not null) then
    raise exception 'INVALID_CANONICAL_MUTATION';
  end if;

  selected_action := private.reconcile_health_source_record(
    p_canonical_user_id, p_platform, p_domain, p_source_app,
    p_source_record_id, p_source_revision, p_source_updated_at,
    p_source_content_hash, p_operation, p_affected_local_dates
  );

  if selected_action in ('CREATED', 'UPDATED') then
    insert into public.beta_health_records(
      canonical_user_id, platform, domain, source_app, source_record_id,
      source_revision, source_updated_at, source_content_hash, idempotency_key,
      operation, canonical_record, affected_local_dates, invalidated_at
    ) values (
      p_canonical_user_id, p_platform, p_domain, p_source_app, p_source_record_id,
      p_source_revision, p_source_updated_at, p_source_content_hash, p_idempotency_key,
      'UPSERT', p_record, p_affected_local_dates, null
    ) on conflict (canonical_user_id, platform, domain, source_app, source_record_id)
    do update set
      source_revision = excluded.source_revision,
      source_updated_at = excluded.source_updated_at,
      source_content_hash = excluded.source_content_hash,
      idempotency_key = excluded.idempotency_key,
      operation = 'UPSERT', canonical_record = excluded.canonical_record,
      affected_local_dates = excluded.affected_local_dates,
      invalidated_at = null, updated_at = now();
  elsif selected_action = 'DELETED' then
    update public.beta_health_records
       set source_revision = p_source_revision,
           source_updated_at = p_source_updated_at,
           source_content_hash = p_source_content_hash,
           idempotency_key = p_idempotency_key,
           operation = 'DELETE', canonical_record = null,
           affected_local_dates = p_affected_local_dates,
           invalidated_at = now(), updated_at = now()
     where canonical_user_id = p_canonical_user_id
       and platform = p_platform and domain = p_domain
       and source_app = p_source_app and source_record_id = p_source_record_id;
  end if;
  return selected_action;
end;
$$;

create or replace function public.beta_report_connector_status(
  p_canonical_user_id uuid,
  p_platform text,
  p_connector_type text,
  p_connector_version text,
  p_last_attempt_at timestamptz,
  p_last_success_at timestamptz,
  p_last_result text,
  p_available_domains text[],
  p_permission_state text
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.beta_connector_status(
    canonical_user_id, platform, connector_type, connector_version,
    last_attempt_at, last_success_at, last_result, available_domains,
    permission_state, updated_at
  ) values (
    p_canonical_user_id, p_platform, p_connector_type, p_connector_version,
    p_last_attempt_at, p_last_success_at, p_last_result, p_available_domains,
    coalesce(p_permission_state, 'UNKNOWN'), now()
  ) on conflict (canonical_user_id, platform, connector_type)
  do update set connector_version = excluded.connector_version,
    last_attempt_at = excluded.last_attempt_at,
    last_success_at = excluded.last_success_at,
    last_result = excluded.last_result,
    available_domains = excluded.available_domains,
    permission_state = excluded.permission_state,
    updated_at = now();
$$;

revoke all on function public.beta_issue_install_claim(uuid,text,text,text,timestamptz,text) from public, anon, authenticated;
revoke all on function public.beta_exchange_install_claim(text,text,bytea,text,text,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.beta_authorize_app_session(uuid,text) from public, anon, authenticated;
revoke all on function public.beta_ingest_health_mutation(uuid,text,text,text,text,bigint,timestamptz,text,text,text,jsonb,date[]) from public, anon, authenticated;
revoke all on function public.beta_report_connector_status(uuid,text,text,text,timestamptz,timestamptz,text,text[],text) from public, anon, authenticated;

grant execute on function public.beta_issue_install_claim(uuid,text,text,text,timestamptz,text) to service_role;
grant execute on function public.beta_exchange_install_claim(text,text,bytea,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.beta_authorize_app_session(uuid,text) to service_role;
grant execute on function public.beta_ingest_health_mutation(uuid,text,text,text,text,bigint,timestamptz,text,text,text,jsonb,date[]) to service_role;
grant execute on function public.beta_report_connector_status(uuid,text,text,text,timestamptz,timestamptz,text,text[],text) to service_role;
