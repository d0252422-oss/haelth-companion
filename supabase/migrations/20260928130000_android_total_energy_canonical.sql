-- Offline-only Beta proposal: persist source-provided Health Connect total
-- energy intervals. This does not aggregate overlapping origins into daily kcal
-- or change frozen health-score inputs. Apply only after separate authorization.

alter table public.beta_health_records
  drop constraint beta_health_records_domain_check,
  add constraint beta_health_records_domain_check check (domain in (
    'steps', 'heart_rate', 'resting_heart_rate', 'sleep', 'sleep_stage',
    'weight', 'workout', 'hrv', 'spo2', 'total_energy'
  ));

alter table private.health_source_record_state
  drop constraint health_source_record_state_domain_check,
  add constraint health_source_record_state_domain_check check (domain in (
    'steps', 'heart_rate', 'resting_heart_rate', 'sleep', 'sleep_stage',
    'weight', 'workout', 'hrv', 'spo2', 'total_energy'
  ));

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
     or p_domain not in (
       'steps', 'heart_rate', 'resting_heart_rate', 'sleep', 'sleep_stage',
       'weight', 'workout', 'hrv', 'spo2', 'total_energy'
     )
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
    recompute := p_domain <> 'total_energy';
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

-- Frozen score inputs omit total energy. Raw source writes must not churn the
-- score queue, especially when one day has many Fitbit/Google Fit intervals.
create or replace function private.beta_enqueue_score_recompute()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  affected_date date;
  affected_dates date[] := coalesce(new.affected_local_dates, '{}'::date[]);
begin
  if new.domain = 'total_energy' then return new; end if;
  if tg_op = 'UPDATE' then
    affected_dates := affected_dates || coalesce(old.affected_local_dates, '{}'::date[]);
  end if;

  for affected_date in
    select distinct local_date
    from unnest(affected_dates) as impacted(local_date)
    where local_date is not null
  loop
    insert into private.beta_score_recompute_queue(canonical_user_id, score_date)
    values (new.canonical_user_id, affected_date)
    on conflict (canonical_user_id, score_date) do update
      set generation = private.beta_score_recompute_queue.generation + 1,
          status = 'DIRTY', attempt_count = 0, next_attempt_at = now(),
          lease_token = null, lease_expires_at = null,
          last_error_code = null, completed_at = null,
          dirtied_at = now(), updated_at = now();
  end loop;
  return new;
end;
$$;

create or replace function private.engine_enqueue_health_rolling() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare affected date[] := new.affected_local_dates; d date;
begin
  if new.domain = 'total_energy' then return new; end if;
  if tg_op = 'UPDATE' then affected := affected || old.affected_local_dates; end if;
  for d in select distinct series::date from unnest(affected) base,
    lateral generate_series(base, least(base + 27, (now() at time zone 'Asia/Taipei')::date), '1 day') series loop
    insert into private.beta_score_recompute_queue(canonical_user_id, score_date)
    values (new.canonical_user_id, d) on conflict(canonical_user_id, score_date) do update set
      generation = private.beta_score_recompute_queue.generation + 1, status = 'DIRTY',
      attempt_count = 0, next_attempt_at = now(), lease_token = null,
      lease_expires_at = null, last_error_code = null, completed_at = null, updated_at = now();
  end loop;
  return new;
end $$;
