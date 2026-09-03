-- Beta-only performance boundary: keep validation/reconciliation semantics in the
-- existing single-mutation function while avoiding one PostgREST round-trip per
-- record. Score work remains represented by the existing dirty-date queue.

create or replace function public.beta_ingest_health_mutation_batch(
  p_canonical_user_id uuid,
  p_mutations jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  mutation jsonb;
  action text;
  accepted jsonb := '[]'::jsonb;
  duplicate jsonb := '[]'::jsonb;
  rejected jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_mutations) <> 'array'
     or jsonb_array_length(p_mutations) > 100 then
    raise exception 'INVALID_BATCH';
  end if;

  for mutation in select value from jsonb_array_elements(p_mutations) loop
    if (mutation->>'canonical_user_id')::uuid <> p_canonical_user_id then
      raise exception 'CROSS_USER_UPLOAD';
    end if;

    action := public.beta_ingest_health_mutation(
      p_canonical_user_id,
      mutation->>'platform',
      mutation->>'domain',
      mutation->>'source_app',
      mutation->>'source_record_id',
      (mutation->>'source_revision')::bigint,
      nullif(mutation->>'source_updated_at', '')::timestamptz,
      mutation->>'source_content_hash',
      mutation->>'operation',
      mutation->>'idempotency_key',
      case when mutation->>'operation' = 'UPSERT' then mutation->'record' else null end,
      coalesce(array(select jsonb_array_elements_text(mutation->'affected_local_dates'))::date[], '{}'::date[])
    );

    if action in ('CREATED', 'UPDATED', 'DELETED') then
      accepted := accepted || jsonb_build_array(mutation->>'idempotency_key');
    elsif action = 'REPLAYED' then
      duplicate := duplicate || jsonb_build_array(mutation->>'idempotency_key');
    else
      rejected := rejected || jsonb_build_array(jsonb_build_object(
        'idempotency_key', mutation->>'idempotency_key', 'error_code', action
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'accepted_idempotency_keys', accepted,
    'duplicate_idempotency_keys', duplicate,
    'rejected', rejected,
    'score_status', 'QUEUED'
  );
end;
$$;

create or replace function public.beta_list_dirty_score_dates(
  p_canonical_user_id uuid,
  p_limit integer default 7
) returns table(score_date date)
language sql
security definer
set search_path = ''
as $$
  select q.score_date
  from private.beta_score_recompute_queue q
  where q.canonical_user_id = p_canonical_user_id and q.status = 'DIRTY'
  order by q.score_date desc
  limit least(greatest(p_limit, 1), 7);
$$;

revoke all on function public.beta_ingest_health_mutation_batch(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.beta_list_dirty_score_dates(uuid,integer) from public, anon, authenticated;
grant execute on function public.beta_ingest_health_mutation_batch(uuid,jsonb) to service_role;
grant execute on function public.beta_list_dirty_score_dates(uuid,integer) to service_role;
