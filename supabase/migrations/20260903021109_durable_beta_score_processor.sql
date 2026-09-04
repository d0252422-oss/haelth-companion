-- Beta-only durable score queue orchestration. The Edge worker remains the
-- formula runtime; Postgres owns durable claiming, leases, retries, and cron.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

alter table private.beta_score_recompute_queue
  drop constraint if exists beta_score_recompute_queue_status_check;
alter table private.beta_score_recompute_queue
  add constraint beta_score_recompute_queue_status_check
  check (status in ('DIRTY', 'PROCESSING', 'COMPLETE', 'FAILED')),
  add column if not exists attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz;

create index if not exists beta_score_recompute_queue_ready_idx
  on private.beta_score_recompute_queue(status, next_attempt_at, score_date desc);

create or replace function private.beta_enqueue_score_recompute()
returns trigger
language plpgsql
set search_path = ''
as $$
declare affected_date date;
begin
  foreach affected_date in array new.affected_local_dates loop
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

create or replace function public.beta_claim_score_recompute(
  p_worker_token uuid,
  p_canonical_user_id uuid default null,
  p_limit integer default 3
) returns table(canonical_user_id uuid, score_date date, generation bigint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_worker_token is null then raise exception 'INVALID_WORKER_TOKEN'; end if;

  -- A worker that exhausted its final lease must become terminal instead of
  -- being reclaimed forever after every lease expiry.
  update private.beta_score_recompute_queue q
     set status = 'FAILED', last_error_code = coalesce(q.last_error_code, 'WORKER_LEASE_EXPIRED'),
         lease_token = null, lease_expires_at = null, updated_at = now()
   where q.status = 'PROCESSING' and q.lease_expires_at <= now() and q.attempt_count >= 5
     and (p_canonical_user_id is null or q.canonical_user_id = p_canonical_user_id);

  return query
  with candidates as (
    select q.canonical_user_id, q.score_date
    from private.beta_score_recompute_queue q
    where (p_canonical_user_id is null or q.canonical_user_id = p_canonical_user_id)
      and (
        (q.status = 'DIRTY' and q.next_attempt_at <= now() and q.attempt_count < 5)
        or (q.status = 'PROCESSING' and q.lease_expires_at <= now() and q.attempt_count < 5)
      )
    order by q.score_date desc, q.dirtied_at
    for update skip locked
    limit least(greatest(p_limit, 1), 5)
  )
  update private.beta_score_recompute_queue q
     set status = 'PROCESSING', attempt_count = least(q.attempt_count + 1, 5),
         lease_token = p_worker_token, lease_expires_at = now() + interval '2 minutes',
         updated_at = now()
    from candidates c
   where q.canonical_user_id = c.canonical_user_id and q.score_date = c.score_date
  returning q.canonical_user_id, q.score_date, q.generation;
end;
$$;

create or replace function public.beta_fail_score_recompute(
  p_canonical_user_id uuid,
  p_score_date date,
  p_generation bigint,
  p_worker_token uuid,
  p_error_code text,
  p_retryable boolean default true
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare next_status text;
begin
  if p_error_code !~ '^[A-Z0-9_]{1,64}$' then raise exception 'INVALID_ERROR_CODE'; end if;
  update private.beta_score_recompute_queue q
     set status = case when p_retryable and q.attempt_count < 5 then 'DIRTY' else 'FAILED' end,
         next_attempt_at = case when p_retryable and q.attempt_count < 5
           then now() + make_interval(secs => least(300, 5 * power(2, greatest(q.attempt_count - 1, 0)))::integer)
           else q.next_attempt_at end,
         last_error_code = p_error_code,
         lease_token = null, lease_expires_at = null, updated_at = now()
   where q.canonical_user_id = p_canonical_user_id and q.score_date = p_score_date
     and q.generation = p_generation and q.status = 'PROCESSING'
     and q.lease_token = p_worker_token
  returning q.status into next_status;
  if next_status is null then raise exception 'STALE_SCORE_LEASE'; end if;
  return next_status;
end;
$$;

create or replace function public.beta_get_health_freshness(p_canonical_user_id uuid)
returns table(
  health_data_updated_at timestamptz,
  latest_health_data_date date,
  latest_sleep_date date,
  domain_latest_dates jsonb
)
language sql
security definer
set search_path = ''
as $$
  with active as (
    select r.domain, r.updated_at, d.local_date
    from public.beta_health_records r
    cross join lateral unnest(r.affected_local_dates) d(local_date)
    where r.canonical_user_id = p_canonical_user_id
      and r.operation = 'UPSERT' and r.invalidated_at is null
  ), domain_summary as (
    select domain, max(local_date) as latest_date from active group by domain
  )
  select
    (select max(updated_at) from active),
    (select max(local_date) from active),
    (select max(local_date) from active where domain in ('sleep', 'sleep_stage')),
    coalesce((select jsonb_object_agg(domain, latest_date order by domain) from domain_summary), '{}'::jsonb);
$$;

create or replace function public.beta_get_score_queue_summary(p_canonical_user_id uuid)
returns table(dirty_count bigint, processing_count bigint, failed_count bigint, oldest_dirty_date date, newest_dirty_date date)
language sql
security definer
set search_path = ''
as $$
  select
    count(*) filter (where q.status = 'DIRTY'),
    count(*) filter (where q.status = 'PROCESSING'),
    count(*) filter (where q.status = 'FAILED'),
    min(q.score_date) filter (where q.status = 'DIRTY'),
    max(q.score_date) filter (where q.status = 'DIRTY')
  from private.beta_score_recompute_queue q
  where q.canonical_user_id = p_canonical_user_id;
$$;

create or replace function public.beta_authorize_score_worker(p_secret text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select length(p_secret) >= 32 and exists (
    select 1
    from vault.decrypted_secrets s
    where s.name = 'beta_score_worker_secret'
      and s.decrypted_secret = p_secret
  );
$$;

create or replace function private.beta_clear_terminal_score_lease()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('COMPLETE', 'FAILED') then
    new.lease_token := null;
    new.lease_expires_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists beta_score_queue_clear_terminal_lease on private.beta_score_recompute_queue;
create trigger beta_score_queue_clear_terminal_lease
before update of status on private.beta_score_recompute_queue
for each row execute function private.beta_clear_terminal_score_lease();

revoke all on function public.beta_claim_score_recompute(uuid,uuid,integer) from public, anon, authenticated;
revoke all on function public.beta_fail_score_recompute(uuid,date,bigint,uuid,text,boolean) from public, anon, authenticated;
revoke all on function public.beta_get_health_freshness(uuid) from public, anon, authenticated;
revoke all on function public.beta_get_score_queue_summary(uuid) from public, anon, authenticated;
revoke all on function public.beta_authorize_score_worker(text) from public, anon, authenticated;
grant execute on function public.beta_claim_score_recompute(uuid,uuid,integer) to service_role;
grant execute on function public.beta_fail_score_recompute(uuid,date,bigint,uuid,text,boolean) to service_role;
grant execute on function public.beta_get_health_freshness(uuid) to service_role;
grant execute on function public.beta_get_score_queue_summary(uuid) to service_role;
grant execute on function public.beta_authorize_score_worker(text) to service_role;

do $job$
declare existing_job record;
begin
  for existing_job in select jobid from cron.job where jobname = 'health-companion-beta-score-processor' loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
  perform cron.schedule(
    'health-companion-beta-score-processor',
    '* * * * *',
    $cron$
      select net.http_post(
        url := 'https://uavimjgccigpbwqmfkhh.supabase.co/functions/v1/mobile-health-beta/internal/score-recompute/drain',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-score-worker-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'beta_score_worker_secret' limit 1), '')
        ),
        body := '{"limit":5}'::jsonb,
        timeout_milliseconds := 55000
      );
    $cron$
  );
end;
$job$;
