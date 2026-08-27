-- Versioned source-record reconciliation. Prepared locally only.
-- Canonical health facts remain in HDL v2 domain tables; this server-only
-- registry prevents source updates/deletions from becoming duplicate facts.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.health_source_record_state (
  id uuid primary key default gen_random_uuid(),
  canonical_user_id uuid not null references public.users(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios')),
  domain text not null check (domain in ('steps', 'heart_rate', 'sleep')),
  source_system text not null,
  source_record_id text not null,
  source_revision bigint not null check (source_revision > 0),
  source_updated_at timestamptz,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  is_deleted boolean not null default false,
  affected_local_dates date[] not null default '{}'::date[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint health_source_record_identity_uq
    unique (canonical_user_id, platform, domain, source_system, source_record_id),
  constraint health_source_record_owner_key unique (id, canonical_user_id)
);

create table private.health_source_reconciliation_events (
  id uuid primary key default gen_random_uuid(),
  canonical_user_id uuid not null references public.users(id) on delete cascade,
  source_state_id uuid not null,
  action text not null check (action in ('CREATED', 'REPLAYED', 'UPDATED', 'DELETED', 'STALE_REJECTED', 'CONFLICT_REJECTED', 'DELETE_UNKNOWN_REJECTED')),
  source_revision bigint not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  requires_derived_recompute boolean not null default false,
  affected_local_dates date[] not null default '{}'::date[],
  recompute_status text not null default 'NOT_REQUIRED'
    check (recompute_status in ('NOT_REQUIRED', 'PENDING', 'PROCESSING', 'COMPLETE', 'FAILED')),
  safe_error_code text,
  created_at timestamptz not null default now(),
  constraint health_source_reconciliation_event_owner_fk
    foreign key (source_state_id, canonical_user_id)
    references private.health_source_record_state(id, canonical_user_id) on delete cascade,
  constraint health_source_reconciliation_event_uq
    unique (source_state_id, action, source_revision, content_hash)
);

alter table private.health_source_record_state enable row level security;
alter table private.health_source_reconciliation_events enable row level security;
revoke all on table private.health_source_record_state from public, anon, authenticated;
revoke all on table private.health_source_reconciliation_events from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update on table private.health_source_record_state to service_role;
grant select, insert, update on table private.health_source_reconciliation_events to service_role;

create or replace function private.reconcile_health_source_record(
  p_canonical_user_id uuid,
  p_platform text,
  p_domain text,
  p_source_system text,
  p_source_record_id text,
  p_source_revision bigint,
  p_source_updated_at timestamptz,
  p_content_hash text,
  p_operation text,
  p_affected_local_dates date[] default '{}'::date[]
) returns text
language plpgsql
set search_path = ''
as $$
declare
  current_state private.health_source_record_state%rowtype;
  selected_action text;
  recompute boolean := false;
begin
  if p_platform not in ('android', 'ios')
     or p_domain not in ('steps', 'heart_rate', 'sleep')
     or p_operation not in ('UPSERT', 'DELETE')
     or p_source_revision <= 0
     or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_SOURCE_RECONCILIATION_INPUT';
  end if;

  select * into current_state
  from private.health_source_record_state
  where canonical_user_id = p_canonical_user_id
    and platform = p_platform
    and domain = p_domain
    and source_system = p_source_system
    and source_record_id = p_source_record_id
  for update;

  if not found then
    if p_operation = 'DELETE' then
      return 'DELETE_UNKNOWN_REJECTED';
    end if;
    insert into private.health_source_record_state (
      canonical_user_id, platform, domain, source_system, source_record_id,
      source_revision, source_updated_at, content_hash, is_deleted, affected_local_dates
    ) values (
      p_canonical_user_id, p_platform, p_domain, p_source_system, p_source_record_id,
      p_source_revision, p_source_updated_at, p_content_hash, false, p_affected_local_dates
    ) returning * into current_state;
    selected_action := 'CREATED';
  elsif p_source_revision < current_state.source_revision
     or (p_source_updated_at is not null and current_state.source_updated_at is not null
         and p_source_updated_at < current_state.source_updated_at) then
    selected_action := 'STALE_REJECTED';
  elsif p_source_revision = current_state.source_revision then
    if p_content_hash = current_state.content_hash
       and (p_operation = 'DELETE') = current_state.is_deleted then
      selected_action := 'REPLAYED';
    else
      selected_action := 'CONFLICT_REJECTED';
    end if;
  else
    recompute := true;
    selected_action := case when p_operation = 'DELETE' then 'DELETED' else 'UPDATED' end;
    update private.health_source_record_state
       set source_revision = p_source_revision,
           source_updated_at = coalesce(p_source_updated_at, source_updated_at),
           content_hash = p_content_hash,
           is_deleted = (p_operation = 'DELETE'),
           affected_local_dates = (
             select coalesce(array_agg(distinct d order by d), '{}'::date[])
             from unnest(current_state.affected_local_dates || p_affected_local_dates) as d
           ),
           updated_at = now()
     where id = current_state.id
     returning * into current_state;
  end if;

  insert into private.health_source_reconciliation_events (
    canonical_user_id, source_state_id, action, source_revision, content_hash,
    requires_derived_recompute, affected_local_dates, recompute_status
  ) values (
    p_canonical_user_id, current_state.id, selected_action, p_source_revision, p_content_hash,
    recompute, p_affected_local_dates,
    case when recompute then 'PENDING' else 'NOT_REQUIRED' end
  ) on conflict do nothing;

  return selected_action;
end;
$$;

revoke all on function private.reconcile_health_source_record(uuid,text,text,text,text,bigint,timestamptz,text,text,date[]) from public, anon, authenticated;
grant execute on function private.reconcile_health_source_record(uuid,text,text,text,text,bigint,timestamptz,text,text,date[]) to service_role;

comment on function private.reconcile_health_source_record(uuid,text,text,text,text,bigint,timestamptz,text,text,date[]) is
  'Server-only source update/tombstone gate. Caller must reconcile canonical facts in the same database transaction.';
