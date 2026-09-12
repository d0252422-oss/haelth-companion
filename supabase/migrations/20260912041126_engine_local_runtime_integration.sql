-- PROPOSAL ONLY. Rehearsed on a newly created loopback-only synthetic database.
-- Existing auth subject -> canonical mapping is reused; no account linking/backfill.
create table public.engine_meals (
  canonical_user_id uuid not null references public.users(id),
  meal_id uuid not null,
  revision bigint not null check (revision > 0),
  local_date date not null,
  deleted boolean not null default false,
  body jsonb not null,
  canonical_record jsonb not null,
  updated_at timestamptz not null default now(),
  primary key(canonical_user_id, meal_id)
);
create index engine_meal_day on public.engine_meals(canonical_user_id, local_date);
create table private.engine_mutation_receipts (
  canonical_user_id uuid not null references public.users(id),
  request_id uuid not null,
  input_hash text not null,
  response jsonb not null,
  primary key(canonical_user_id,request_id)
);
alter table public.engine_meals enable row level security;
alter table private.engine_mutation_receipts enable row level security;
revoke all on public.engine_meals, private.engine_mutation_receipts from public,anon,authenticated;
grant select on public.engine_meals to authenticated;
grant select,insert,update on public.engine_meals to service_role;
grant select,insert on private.engine_mutation_receipts to service_role;

create function private.engine_current_canonical_user() returns uuid
language sql stable security definer set search_path = '' as $$
  select i.canonical_user_id from private.beta_native_auth_identities i
  join public.users u on u.id=i.canonical_user_id
  where i.auth_user_id=auth.uid() and i.provider='google'
    and i.environment='beta' and u.status='ACTIVE'
$$;
revoke all on function private.engine_current_canonical_user() from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.engine_current_canonical_user() to authenticated;
create policy engine_meal_owner on public.engine_meals for select to authenticated
  using(canonical_user_id=(select private.engine_current_canonical_user()));
create policy engine_history_owner on public.engine_output_history for select to authenticated
  using(canonical_user_id=(select private.engine_current_canonical_user()));
create policy engine_heads_owner on public.engine_output_heads for select to authenticated
  using(canonical_user_id=(select private.engine_current_canonical_user()));

create function private.engine_enqueue_meal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d date; base date; bases date[];
begin
  bases:=array[new.local_date];
  if tg_op='UPDATE' then bases:=array_append(bases,old.local_date); end if;
  for base in select distinct unnest(bases) loop
    for d in select generate_series(base,least(base+27,(now() at time zone 'Asia/Taipei')::date),'1 day')::date loop
      insert into private.beta_score_recompute_queue(canonical_user_id,score_date)
      values(new.canonical_user_id,d)
      on conflict(canonical_user_id,score_date) do update set
        generation=private.beta_score_recompute_queue.generation+1,status='DIRTY',
        attempt_count=0,next_attempt_at=now(),lease_token=null,lease_expires_at=null,
        completed_at=null,last_error_code=null,updated_at=now();
    end loop;
  end loop;
  return new;
end $$;
revoke all on function private.engine_enqueue_meal() from public,anon,authenticated;
create trigger engine_meal_dirty after insert or update of revision on public.engine_meals
  for each row execute function private.engine_enqueue_meal();

-- Preserve original remote queue behavior unless an explicitly configured host enables this.
create function private.engine_enqueue_health_rolling() returns trigger
language plpgsql security definer set search_path = '' as $$
declare affected date[]:=new.affected_local_dates; d date;
begin
  if tg_op='UPDATE' then affected:=affected||old.affected_local_dates; end if;
  for d in select distinct series::date from unnest(affected) base,
    lateral generate_series(base,least(base+27,(now() at time zone 'Asia/Taipei')::date),'1 day') series loop
    insert into private.beta_score_recompute_queue(canonical_user_id,score_date)
    values(new.canonical_user_id,d) on conflict(canonical_user_id,score_date) do update set
      generation=private.beta_score_recompute_queue.generation+1,status='DIRTY',attempt_count=0,
      next_attempt_at=now(),lease_token=null,lease_expires_at=null,last_error_code=null,completed_at=null,updated_at=now();
  end loop;
  return new;
end $$;
revoke all on function private.engine_enqueue_health_rolling() from public,anon,authenticated;
create trigger engine_health_rolling_dirty after insert or update of source_revision,source_content_hash,operation,invalidated_at
  on public.beta_health_records for each row
  when (current_setting('health.engine.experimental',true)='on')
  execute function private.engine_enqueue_health_rolling();
