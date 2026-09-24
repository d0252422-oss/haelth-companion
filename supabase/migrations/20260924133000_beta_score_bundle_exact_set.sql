-- A score bundle is complete only when it contains each frozen v1 score type
-- exactly once. Length alone allowed a duplicate type to hide a missing type
-- while the queue was still marked COMPLETE.
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
security invoker
set search_path = ''
as $$
declare item jsonb;
declare score_count integer;
declare queue_generation bigint;
declare changed_count integer := 0;
declare expected_score_types constant text[] := array[
  'activity', 'body_composition', 'fatigue', 'health_overall',
  'nutrition', 'recovery', 'sleep', 'training'
]::text[];
declare submitted_score_types text[];
begin
  if p_input_fingerprint !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_scores) <> 'array'
     or jsonb_array_length(p_scores) <> 8 then
    raise exception 'INVALID_SCORE_BUNDLE';
  end if;

  select coalesce(
    array_agg(distinct score_item->>'score_type' order by score_item->>'score_type'),
    '{}'::text[]
  )
  into submitted_score_types
  from jsonb_array_elements(p_scores) as score_items(score_item);

  if submitted_score_types is distinct from expected_score_types then
    raise exception 'INVALID_SCORE_BUNDLE_EXACT_SET';
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

revoke all on function public.beta_persist_score_bundle(uuid,date,bigint,text,timestamptz,timestamptz,jsonb)
  from public, anon, authenticated;
grant execute on function public.beta_persist_score_bundle(uuid,date,bigint,text,timestamptz,timestamptz,jsonb)
  to service_role, health_manual_api, health_recompute_worker;
