-- Beta-only canonical identity convergence. Verified Web and Supabase Google
-- identities are joined by a server-verified, normalized email hash. Raw email
-- addresses are never persisted in this bridge.

create table private.beta_web_identity_aliases (
  web_subject_hash text primary key check (web_subject_hash ~ '^[0-9a-f]{64}$'),
  verified_email_hash text not null unique check (verified_email_hash ~ '^[0-9a-f]{64}$'),
  canonical_user_id uuid not null references public.users(id) on delete restrict,
  provider text not null default 'google' check (provider = 'google'),
  environment text not null default 'beta' check (environment = 'beta'),
  linked_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now()
);

alter table private.beta_web_identity_aliases enable row level security;
revoke all on table private.beta_web_identity_aliases from public, anon, authenticated;
grant select, insert, update on table private.beta_web_identity_aliases to service_role;

create or replace function public.beta_resolve_web_canonical_identity(
  p_web_subject_hash text,
  p_verified_email_hash text,
  p_candidate_canonical_user_id uuid
) returns table(canonical_user_id uuid, provider text, environment text)
language plpgsql
security definer
set search_path = ''
as $$
declare existing_alias private.beta_web_identity_aliases%rowtype;
declare native_candidates uuid[];
declare selected_canonical uuid;
begin
  if p_web_subject_hash !~ '^[0-9a-f]{64}$'
     or p_verified_email_hash !~ '^[0-9a-f]{64}$'
     or p_candidate_canonical_user_id is null then
    raise exception 'INVALID_VERIFIED_WEB_IDENTITY';
  end if;

  select * into existing_alias
    from private.beta_web_identity_aliases a
   where a.web_subject_hash = p_web_subject_hash
   for update;
  if found then
    if existing_alias.verified_email_hash <> p_verified_email_hash then
      raise exception 'WEB_IDENTITY_CONFLICT';
    end if;
    update private.beta_web_identity_aliases
       set last_verified_at = now()
     where web_subject_hash = p_web_subject_hash;
    return query select existing_alias.canonical_user_id, 'google'::text, 'beta'::text;
    return;
  end if;

  select coalesce(array_agg(distinct i.canonical_user_id), '{}'::uuid[])
    into native_candidates
    from private.beta_native_auth_identities i
    join auth.users au on au.id = i.auth_user_id
   where i.provider = 'google' and i.environment = 'beta'
     and au.email_confirmed_at is not null
     and encode(extensions.digest(lower(trim(au.email)), 'sha256'), 'hex') = p_verified_email_hash;
  if cardinality(native_candidates) > 1 then raise exception 'AMBIGUOUS_VERIFIED_IDENTITY'; end if;
  selected_canonical := coalesce(native_candidates[1], p_candidate_canonical_user_id);

  insert into public.users(id, external_subject_hash)
  values (selected_canonical, p_verified_email_hash)
  on conflict (id) do nothing;
  if not exists (select 1 from public.users u where u.id = selected_canonical and u.status = 'ACTIVE') then
    raise exception 'CANONICAL_IDENTITY_CONFLICT';
  end if;

  insert into private.beta_web_identity_aliases(
    web_subject_hash, verified_email_hash, canonical_user_id
  ) values (
    p_web_subject_hash, p_verified_email_hash, selected_canonical
  );
  return query select selected_canonical, 'google'::text, 'beta'::text;
exception
  when unique_violation then raise exception 'WEB_IDENTITY_CONFLICT';
end;
$$;

create or replace function public.beta_link_native_auth_identity_v2(
  p_auth_user_id uuid,
  p_candidate_canonical_user_id uuid,
  p_google_subject_hash text,
  p_verified_email_hash text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare existing_canonical uuid;
declare aliased_canonical uuid;
declare selected_canonical uuid;
begin
  if p_google_subject_hash !~ '^[0-9a-f]{64}$'
     or p_verified_email_hash !~ '^[0-9a-f]{64}$'
     or not exists (
       select 1 from auth.users au
       where au.id = p_auth_user_id and au.email_confirmed_at is not null
         and encode(extensions.digest(lower(trim(au.email)), 'sha256'), 'hex') = p_verified_email_hash
     )
     or not exists (
       select 1 from auth.identities ai where ai.user_id = p_auth_user_id and ai.provider = 'google'
     ) then
    raise exception 'INVALID_NATIVE_IDENTITY';
  end if;

  select i.canonical_user_id into existing_canonical
    from private.beta_native_auth_identities i
   where i.auth_user_id = p_auth_user_id
   for update;
  if found then
    update private.beta_native_auth_identities set last_verified_at = now()
     where auth_user_id = p_auth_user_id;
    return existing_canonical;
  end if;

  select a.canonical_user_id into aliased_canonical
    from private.beta_web_identity_aliases a
   where a.verified_email_hash = p_verified_email_hash;
  selected_canonical := coalesce(aliased_canonical, p_candidate_canonical_user_id);

  insert into public.users(id, external_subject_hash)
  values (selected_canonical, p_google_subject_hash)
  on conflict (id) do nothing;
  if not exists (select 1 from public.users u where u.id = selected_canonical and u.status = 'ACTIVE') then
    raise exception 'CANONICAL_IDENTITY_CONFLICT';
  end if;

  insert into private.beta_native_auth_identities(
    auth_user_id, canonical_user_id, provider, environment
  ) values (
    p_auth_user_id, selected_canonical, 'google', 'beta'
  );
  return selected_canonical;
exception
  when unique_violation then raise exception 'CANONICAL_IDENTITY_CONFLICT';
end;
$$;

revoke all on function public.beta_resolve_web_canonical_identity(text,text,uuid)
  from public, anon, authenticated;
revoke all on function public.beta_link_native_auth_identity_v2(uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.beta_resolve_web_canonical_identity(text,text,uuid)
  to service_role;
grant execute on function public.beta_link_native_auth_identity_v2(uuid,uuid,text,text)
  to service_role;

comment on table private.beta_web_identity_aliases is
  'Beta-only server-verified alias from Apps Script Web identity to the shared Google-backed canonical user.';
