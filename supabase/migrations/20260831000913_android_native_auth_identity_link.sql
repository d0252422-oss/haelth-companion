-- Isolated Beta-only mapping between a verified Supabase Auth identity and the
-- existing canonical Health Companion user. Apply only after the deployment
-- guard proves the target is uavimjgccigpbwqmfkhh and not production.

create table private.beta_native_auth_identities (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  canonical_user_id uuid not null unique references public.users(id) on delete cascade,
  provider text not null check (provider = 'google'),
  environment text not null default 'beta' check (environment = 'beta'),
  linked_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now()
);

alter table private.beta_native_auth_identities enable row level security;
revoke all on table private.beta_native_auth_identities from public, anon, authenticated;
grant select, insert, update, delete on table private.beta_native_auth_identities to service_role;

create or replace function public.beta_link_native_auth_identity(
  p_auth_user_id uuid,
  p_canonical_user_id uuid,
  p_external_subject_hash text,
  p_provider text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare existing_canonical uuid;
begin
  if p_provider <> 'google'
     or p_external_subject_hash !~ '^[0-9a-f]{64}$'
     or not exists (select 1 from auth.users where id = p_auth_user_id) then
    raise exception 'INVALID_NATIVE_IDENTITY';
  end if;

  insert into public.users(id, external_subject_hash)
  values (p_canonical_user_id, p_external_subject_hash)
  on conflict (id) do update
    set updated_at = now()
    where public.users.external_subject_hash = excluded.external_subject_hash;
  if not found then raise exception 'CANONICAL_IDENTITY_CONFLICT'; end if;

  select canonical_user_id into existing_canonical
    from private.beta_native_auth_identities
   where auth_user_id = p_auth_user_id
   for update;
  if found and existing_canonical <> p_canonical_user_id then
    raise exception 'CANONICAL_IDENTITY_CONFLICT';
  end if;

  insert into private.beta_native_auth_identities(
    auth_user_id, canonical_user_id, provider, environment
  ) values (
    p_auth_user_id, p_canonical_user_id, p_provider, 'beta'
  ) on conflict (auth_user_id) do update
    set last_verified_at = now()
    where private.beta_native_auth_identities.canonical_user_id = excluded.canonical_user_id
      and private.beta_native_auth_identities.provider = excluded.provider
      and private.beta_native_auth_identities.environment = 'beta';
  if not found then raise exception 'CANONICAL_IDENTITY_CONFLICT'; end if;

  return p_canonical_user_id;
exception
  when unique_violation then raise exception 'CANONICAL_IDENTITY_CONFLICT';
end;
$$;

create or replace function public.beta_resolve_native_auth_identity(
  p_auth_user_id uuid
) returns table(canonical_user_id uuid, provider text, environment text)
language sql
security definer
set search_path = ''
stable
as $$
  select i.canonical_user_id, i.provider, i.environment
    from private.beta_native_auth_identities i
    join public.users u on u.id = i.canonical_user_id
   where i.auth_user_id = p_auth_user_id
     and i.environment = 'beta'
     and u.status = 'ACTIVE';
$$;

revoke all on function public.beta_link_native_auth_identity(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.beta_resolve_native_auth_identity(uuid)
  from public, anon, authenticated;
grant execute on function public.beta_link_native_auth_identity(uuid, uuid, text, text)
  to service_role;
grant execute on function public.beta_resolve_native_auth_identity(uuid)
  to service_role;

comment on table private.beta_native_auth_identities is
  'Beta-only one-to-one link from a verified Google-backed Supabase Auth user to the canonical Health Companion user.';
