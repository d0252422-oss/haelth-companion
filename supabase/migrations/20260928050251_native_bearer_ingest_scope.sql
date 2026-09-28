-- Beta-only native bearer delegation. This is not an App Session and is never
-- handed to Android. Edge verifies Supabase Auth before issuing a short-lived,
-- single-use capability; the existing health-record RLS predicates stay intact.
create table private.beta_native_ingest_scopes (
  capability_digest text primary key check (capability_digest ~ '^[0-9a-f]{64}$'),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  canonical_user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index beta_native_ingest_scopes_expiry
  on private.beta_native_ingest_scopes(expires_at);
revoke all on private.beta_native_ingest_scopes
  from public, anon, authenticated, service_role, health_native_ingest;

create function public.beta_issue_native_ingest_scope(
  p_auth_user_id uuid,
  p_capability_digest text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid;
begin
  if p_capability_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_NATIVE_SCOPE';
  end if;
  select i.canonical_user_id into owner_id
    from private.beta_native_auth_identities i
    join public.users u on u.id = i.canonical_user_id
   where i.auth_user_id = p_auth_user_id
     and i.provider = 'google' and i.environment = 'beta'
     and u.status = 'ACTIVE';
  if owner_id is null then raise exception 'NATIVE_IDENTITY_NOT_LINKED'; end if;
  -- Bounded global pruning avoids retaining spent credentials for inactive users.
  delete from private.beta_native_ingest_scopes
   where capability_digest in (
     select capability_digest from private.beta_native_ingest_scopes
      where expires_at < now() order by expires_at limit 100
   );
  insert into private.beta_native_ingest_scopes(
    capability_digest, auth_user_id, canonical_user_id, expires_at
  ) values (p_capability_digest, p_auth_user_id, owner_id, now() + interval '45 seconds');
  return owner_id;
end $$;
revoke all on function public.beta_issue_native_ingest_scope(uuid,text)
  from public, anon, authenticated, health_native_ingest;
grant execute on function public.beta_issue_native_ingest_scope(uuid,text)
  to service_role;

create function private.native_ingest_scope_user() returns uuid
language sql stable security definer set search_path = '' as $$
  select s.canonical_user_id
    from private.beta_native_ingest_scopes s
    join private.beta_native_auth_identities i
      on i.auth_user_id = s.auth_user_id and i.canonical_user_id = s.canonical_user_id
     and i.provider = 'google' and i.environment = 'beta'
    join public.users u on u.id = s.canonical_user_id and u.status = 'ACTIVE'
   where current_setting('health.worker.kind', true) = 'native'
     and s.capability_digest = current_setting('health.worker.digest', true)
     and s.expires_at > now() and s.consumed_at is null
$$;
create function private.consume_native_ingest_scope() returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('health.worker.kind', true) <> 'native' then return false; end if;
  update private.beta_native_ingest_scopes s set consumed_at = now()
   where s.capability_digest = current_setting('health.worker.digest', true)
     and s.expires_at > now() and s.consumed_at is null
     and exists (
       select 1 from private.beta_native_auth_identities i
         join public.users u on u.id = i.canonical_user_id and u.status = 'ACTIVE'
        where i.auth_user_id = s.auth_user_id
          and i.canonical_user_id = s.canonical_user_id
          and i.provider = 'google' and i.environment = 'beta'
     );
  return found;
end $$;
revoke all on function private.native_ingest_scope_user(),
  private.consume_native_ingest_scope() from public, anon, authenticated, service_role;
grant execute on function private.native_ingest_scope_user(),
  private.consume_native_ingest_scope() to health_native_ingest;

create or replace function private.delegated_worker_user() returns uuid
language sql stable security invoker set search_path = '' as $$
  select case when current_setting('health.worker.kind', true) = 'native'
    then private.native_ingest_scope_user()
    else (
      select case when count(*) = 1 then min(s.canonical_user_id::text)::uuid end
        from (select canonical_user_id from private.mobile_app_sessions
              union all select canonical_user_id from private.beta_shortcut_sessions) s
        join public.users u on u.id = s.canonical_user_id and u.status = 'ACTIVE'
    ) end
$$;
create or replace function private.delegated_worker_platform() returns text
language sql stable security invoker set search_path = '' as $$
  select case when current_setting('health.worker.kind', true) = 'native'
    then case when private.native_ingest_scope_user() is not null then 'android' end
    else (
      select platform from private.mobile_app_sessions
      union all select 'ios' from private.beta_shortcut_sessions
    ) end
$$;
