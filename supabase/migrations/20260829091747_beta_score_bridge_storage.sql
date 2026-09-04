-- Isolated Beta derived-score storage and bounded dirty-date orchestration.
-- The tables intentionally mirror the frozen HDL v2 health-score contract
-- without cloning unrelated production schemas.

create table public.beta_health_scores (
  id uuid primary key default gen_random_uuid(),
  canonical_user_id uuid not null references public.users(id) on delete cascade,
  score_date date not null,
  score_type text not null check (score_type in (
    'sleep', 'activity', 'training', 'nutrition', 'body_composition',
    'recovery', 'fatigue', 'health_overall'
  )),
  score numeric,
  completeness numeric(5,4) not null,
  confidence text not null check (confidence in ('LOW', 'MEDIUM', 'HIGH')),
  status text not null,
  missing_components text[] not null default '{}'::text[],
  algorithm_version text not null check (algorithm_version = 'health-score-v1.0'),
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  safe_output jsonb not null default '{}'::jsonb,
  source_max_updated_at timestamptz,
  calculated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beta_health_scores_range_check check (score is null or score between 0 and 100),
  constraint beta_health_scores_completeness_check check (completeness between 0 and 1),
  constraint beta_health_scores_identity_uq
    unique (canonical_user_id, score_date, score_type, algorithm_version)
);

create index beta_health_scores_user_date_idx
  on public.beta_health_scores(canonical_user_id, score_date desc);

create table private.beta_score_recompute_queue (
  canonical_user_id uuid not null references public.users(id) on delete cascade,
  score_date date not null,
  generation bigint not null default 1 check (generation > 0),
  status text not null default 'DIRTY' check (status in ('DIRTY', 'COMPLETE', 'FAILED')),
  last_input_fingerprint text check (last_input_fingerprint is null or last_input_fingerprint ~ '^[0-9a-f]{64}$'),
  last_error_code text,
  dirtied_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (canonical_user_id, score_date)
);

alter table public.beta_health_scores enable row level security;
alter table private.beta_score_recompute_queue enable row level security;
revoke all on table public.beta_health_scores from public, anon, authenticated;
revoke all on table private.beta_score_recompute_queue from public, anon, authenticated;
grant select, insert, update on table public.beta_health_scores to service_role;
grant select, insert, update on table private.beta_score_recompute_queue to service_role;

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
          status = 'DIRTY', last_error_code = null, completed_at = null,
          dirtied_at = now(), updated_at = now();
  end loop;
  return new;
end;
$$;

create trigger beta_health_records_enqueue_score
after insert or update of source_revision, source_content_hash, operation, invalidated_at
on public.beta_health_records
for each row execute function private.beta_enqueue_score_recompute();

create or replace function public.beta_get_score_generation(
  p_canonical_user_id uuid,
  p_score_date date
) returns table(generation bigint, status text)
language sql
security definer
set search_path = ''
as $$
  select q.generation, q.status
  from private.beta_score_recompute_queue q
  where q.canonical_user_id = p_canonical_user_id and q.score_date = p_score_date;
$$;

create or replace function public.beta_persist_score_bundle(
  p_canonical_user_id uuid,
  p_score_date date,
  p_generation bigint,
  p_input_fingerprint text,
  p_source_max_updated_at timestamptz,
  p_calculated_at timestamptz,
  p_scores jsonb
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare item jsonb;
declare score_count integer;
declare queue_generation bigint;
declare changed_count integer := 0;
begin
  if p_input_fingerprint !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_scores) <> 'array'
     or jsonb_array_length(p_scores) <> 8 then
    raise exception 'INVALID_SCORE_BUNDLE';
  end if;

  select q.generation into queue_generation
  from private.beta_score_recompute_queue q
  where q.canonical_user_id = p_canonical_user_id and q.score_date = p_score_date
  for update;
  if not found or queue_generation <> p_generation then raise exception 'STALE_SCORE_INPUT'; end if;

  for item in select value from jsonb_array_elements(p_scores) loop
    if item->>'score_type' not in (
      'sleep', 'activity', 'training', 'nutrition', 'body_composition',
      'recovery', 'fatigue', 'health_overall'
    ) or item->>'algorithm_version' <> 'health-score-v1.0'
      or item->>'confidence' not in ('LOW', 'MEDIUM', 'HIGH')
      or (item->>'completeness')::numeric not between 0 and 1
      or (item->'score' <> 'null'::jsonb and (item->>'score')::numeric not between 0 and 100)
      or jsonb_typeof(item->'missing_components') <> 'array' then
      raise exception 'INVALID_SCORE_RESULT';
    end if;

    insert into public.beta_health_scores(
      canonical_user_id, score_date, score_type, score, completeness,
      confidence, status, missing_components, algorithm_version,
      input_fingerprint, safe_output, source_max_updated_at, calculated_at
    ) values (
      p_canonical_user_id, p_score_date, item->>'score_type', (item->>'score')::numeric,
      (item->>'completeness')::numeric, item->>'confidence', item->>'status',
      array(select jsonb_array_elements_text(item->'missing_components')),
      item->>'algorithm_version', p_input_fingerprint,
      coalesce(item->'safe_output', '{}'::jsonb), p_source_max_updated_at, p_calculated_at
    ) on conflict (canonical_user_id, score_date, score_type, algorithm_version)
    do update set score = excluded.score, completeness = excluded.completeness,
      confidence = excluded.confidence, status = excluded.status,
      missing_components = excluded.missing_components,
      input_fingerprint = excluded.input_fingerprint,
      safe_output = excluded.safe_output,
      source_max_updated_at = excluded.source_max_updated_at,
      calculated_at = excluded.calculated_at, updated_at = now()
    where public.beta_health_scores.input_fingerprint is distinct from excluded.input_fingerprint;
    get diagnostics score_count = row_count;
    changed_count := changed_count + score_count;
  end loop;

  update private.beta_score_recompute_queue
     set status = 'COMPLETE', last_input_fingerprint = p_input_fingerprint,
         last_error_code = null, completed_at = now(), updated_at = now()
   where canonical_user_id = p_canonical_user_id and score_date = p_score_date
     and generation = p_generation;
  if not found then raise exception 'STALE_SCORE_INPUT'; end if;
  return case when changed_count = 0 then 'REPLAYED' else 'PERSISTED' end;
end;
$$;

revoke all on function public.beta_get_score_generation(uuid,date) from public, anon, authenticated;
revoke all on function public.beta_persist_score_bundle(uuid,date,bigint,text,timestamptz,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.beta_get_score_generation(uuid,date) to service_role;
grant execute on function public.beta_persist_score_bundle(uuid,date,bigint,text,timestamptz,timestamptz,jsonb) to service_role;

comment on table public.beta_health_scores is
  'Isolated Beta derived scores from frozen health-score-v1.0; never a production cutover target.';
