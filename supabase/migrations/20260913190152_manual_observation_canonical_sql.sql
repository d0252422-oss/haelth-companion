-- Additive canonical manual observation extension. No native/source impersonation.
-- Consumer integration is required: actual manual handler/read projection/compute.
-- Same identity resolver, bounded queue, generation publication and SQL provider.
create table public.engine_manual_observations (
  canonical_user_id uuid not null references public.users(id),
  record_id uuid not null,
  domain text not null check (domain in ('sleep','steps','total_energy')),
  local_date date not null,
  timezone text not null check (timezone='Asia/Taipei'),
  source text not null default 'manual' check (source='manual'),
  revision bigint not null check (revision>0),
  deleted boolean not null default false,
  body jsonb not null check ((body ?& array['source','domain','timezone','date','recordId','value','unit','coverage','revision','deleted']
    and body->>'source'='manual' and body->>'domain'=domain and body->>'timezone'=timezone
    and body->>'date'=local_date::text and body->>'recordId'=record_id::text and jsonb_typeof(body->'value')='number'
    and (body->>'value')::numeric>=0 and (body->>'revision')::bigint=revision and (body->>'deleted')::boolean=deleted
    and (domain<>'steps' or (mod((body->>'value')::numeric,1)=0 and (body->>'value')::numeric<=9007199254740991 and body->>'unit'='count'))
    and (domain<>'sleep' or ((body->>'value')::numeric<=1440 and body->>'unit'='minute' and body->>'coverage'='SESSION'))
    and (domain<>'total_energy' or body->>'unit'='kcal')
    and (domain='sleep' or body->>'coverage' in ('PARTIAL_DAY','FULL_DAY'))
    and (body->>'coverage'<>'PARTIAL_DAY' or body->>'cutoffTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')) is true),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(canonical_user_id,record_id)
);
create index engine_manual_observations_day on public.engine_manual_observations(canonical_user_id,local_date,domain);
create unique index engine_manual_observations_daily_total on public.engine_manual_observations(canonical_user_id,local_date,domain)
  where not deleted and domain in ('steps','total_energy');
create table private.engine_observation_receipts (
  canonical_user_id uuid not null references public.users(id),
  request_id uuid not null,
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  response jsonb not null,
  primary key(canonical_user_id,request_id)
);
alter table public.engine_manual_observations enable row level security;
alter table public.engine_manual_observations force row level security;
alter table private.engine_observation_receipts enable row level security;
revoke all on public.engine_manual_observations,private.engine_observation_receipts from public,anon,authenticated;
grant select on public.engine_manual_observations to authenticated;
grant select,insert,update on public.engine_manual_observations to service_role;
grant select,insert on private.engine_observation_receipts to service_role;
create policy engine_manual_observation_owner on public.engine_manual_observations for select to authenticated
  using(canonical_user_id=(select private.engine_current_canonical_user()));
-- At most24h paired sessions require one neighboring wake-day of context.
-- A later-day insert/delete can invalidate an earlier already-published day.
-- Reuse the same bounded queue; no history rewrite, full scan or new service.
create function private.engine_enqueue_observation() returns trigger
language plpgsql security definer set search_path='' as $$
declare bases date[]:=array[new.local_date]; touched jsonb[]:=array[new.body]; item jsonb; base date; d date;
begin
  if tg_op='UPDATE' then bases:=array_append(bases,old.local_date);touched:=array_append(touched,old.body); end if;
  if new.domain='sleep' then
    foreach item in array touched loop
      if item->>'startedAt' is not null and item->>'endedAt' is not null then
        for base in select distinct o.local_date from public.engine_manual_observations o
          where o.canonical_user_id=new.canonical_user_id and o.domain='sleep' and not o.deleted and o.record_id<>new.record_id
            and o.local_date between (item->>'date')::date-1 and (item->>'date')::date+1
            and (o.body->>'startedAt')::timestamptz < (item->>'endedAt')::timestamptz
            and (item->>'startedAt')::timestamptz < (o.body->>'endedAt')::timestamptz
        loop bases:=array_append(bases,base); end loop;
      end if;
    end loop;
  end if;
  for d in select distinct series::date from unnest(bases) b,
    lateral generate_series(b,least(b+27,(now() at time zone 'Asia/Taipei')::date),'1 day') series loop
    insert into private.beta_score_recompute_queue(canonical_user_id,score_date,engine_required) values(new.canonical_user_id,d,true)
    on conflict(canonical_user_id,score_date) do update set
      generation=private.beta_score_recompute_queue.generation+1,status='DIRTY',engine_required=true,attempt_count=0,next_attempt_at=now(),
      lease_token=null,lease_expires_at=null,completed_at=null,last_error_code=null,updated_at=now();
  end loop;
  return new;
end $$;
revoke all on function private.engine_enqueue_observation() from public,anon,authenticated;
create trigger engine_manual_observation_dirty after insert or update of revision on public.engine_manual_observations
  for each row execute function private.engine_enqueue_observation();

-- Extra bounded guard also covers future disabled/re-enabled triggers and tombstones.
-- It supplements (does not replace/drop) the existing publication guard.
create function private.engine_require_observation_publication() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status='COMPLETE' and new.engine_published_generation<>new.generation and
    exists(select 1 from public.engine_manual_observations o where o.canonical_user_id=new.canonical_user_id
      and o.local_date between new.score_date-27 and new.score_date) then
    raise exception 'ENGINE_PUBLICATION_REQUIRED' using errcode='55000';
  end if;
  return new;
end $$;
revoke all on function private.engine_require_observation_publication() from public,anon,authenticated;
create trigger engine_observation_publication_guard before update of status on private.beta_score_recompute_queue
  for each row execute function private.engine_require_observation_publication();
