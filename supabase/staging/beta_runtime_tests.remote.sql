-- Transactional verification for the isolated Beta project only.
begin;

do $test$
declare
  user_a uuid := '10000000-0000-4000-8000-000000000001';
  user_b uuid := '20000000-0000-4000-8000-000000000002';
  claim_digest text := repeat('a', 64);
  access_digest text := repeat('b', 64);
  refresh_digest text := repeat('c', 64);
  session_row record;
  result text;
  caught boolean;
begin
  perform public.beta_issue_install_claim(
    user_a, repeat('1', 64), 'android', claim_digest,
    now() + interval '5 minutes', 'ONE_TIME_CODE'
  );

  select * into session_row from public.beta_exchange_install_claim(
    claim_digest, repeat('d', 64), decode(repeat('01', 65), 'hex'),
    access_digest, refresh_digest,
    now() + interval '15 minutes', now() + interval '30 days'
  );
  if session_row.canonical_user_id <> user_a then raise exception 'SESSION_OWNER_MISMATCH'; end if;
  if not exists (
    select 1 from public.beta_authorize_app_session(session_row.session_id, access_digest)
    where canonical_user_id = user_a and environment = 'beta'
  ) then raise exception 'VALID_SESSION_REJECTED'; end if;
  if exists (select 1 from public.beta_authorize_app_session(session_row.session_id, repeat('e', 64))) then
    raise exception 'INVALID_SESSION_ACCEPTED';
  end if;

  caught := false;
  begin
    perform public.beta_exchange_install_claim(
      claim_digest, repeat('d', 64), decode(repeat('01', 65), 'hex'),
      repeat('f', 64), repeat('0', 64),
      now() + interval '15 minutes', now() + interval '30 days'
    );
  exception when others then caught := position('REPLAYED_CLAIM' in sqlerrm) > 0;
  end;
  if not caught then raise exception 'REPLAYED_CLAIM_NOT_REJECTED'; end if;

  perform public.beta_issue_install_claim(
    user_a, repeat('1', 64), 'ios', repeat('9', 64),
    now() + interval '5 minutes', 'ONE_TIME_CODE'
  );
  select * into session_row from public.beta_exchange_shortcut_claim(
    repeat('9', 64), repeat('a', 64), now() + interval '24 hours'
  );
  if session_row.canonical_user_id <> user_a then raise exception 'SHORTCUT_SESSION_OWNER_MISMATCH'; end if;
  if not exists (
    select 1 from public.beta_authorize_shortcut_session(session_row.session_id, repeat('a', 64))
    where canonical_user_id = user_a and environment = 'beta'
  ) then raise exception 'VALID_SHORTCUT_SESSION_REJECTED'; end if;
  if exists (select 1 from public.beta_authorize_shortcut_session(session_row.session_id, repeat('0', 64))) then
    raise exception 'INVALID_SHORTCUT_SESSION_ACCEPTED';
  end if;
  caught := false;
  begin
    perform public.beta_exchange_shortcut_claim(repeat('9', 64), repeat('e', 64), now() + interval '24 hours');
  exception when others then caught := position('REPLAYED_CLAIM' in sqlerrm) > 0;
  end;
  if not caught then raise exception 'REPLAYED_SHORTCUT_CLAIM_NOT_REJECTED'; end if;

  insert into public.users(id, external_subject_hash) values (user_b, repeat('2', 64));
  result := public.beta_ingest_health_mutation(
    user_a, 'android', 'heart_rate', 'test.origin', 'record-1', 1,
    '2026-08-29T01:00:00Z', repeat('3', 64), 'UPSERT', repeat('4', 64),
    jsonb_build_object('schema_version','hdl-v2.health-ingestion.v1','canonical_user_id',user_a),
    array['2026-08-29'::date]
  );
  if result <> 'CREATED' then raise exception 'CREATE_FAILED'; end if;
  result := public.beta_ingest_health_mutation(
    user_a, 'android', 'heart_rate', 'test.origin', 'record-1', 1,
    '2026-08-29T01:00:00Z', repeat('3', 64), 'UPSERT', repeat('4', 64),
    jsonb_build_object('schema_version','hdl-v2.health-ingestion.v1','canonical_user_id',user_a),
    array['2026-08-29'::date]
  );
  if result <> 'REPLAYED' then raise exception 'REPLAY_FAILED'; end if;
  result := public.beta_ingest_health_mutation(
    user_a, 'android', 'heart_rate', 'test.origin', 'record-1', 2,
    '2026-08-29T01:01:00Z', repeat('5', 64), 'UPSERT', repeat('6', 64),
    jsonb_build_object('schema_version','hdl-v2.health-ingestion.v1','canonical_user_id',user_a),
    array['2026-08-29'::date]
  );
  if result <> 'UPDATED' then raise exception 'UPDATE_FAILED'; end if;
  result := public.beta_ingest_health_mutation(
    user_a, 'android', 'heart_rate', 'test.origin', 'record-1', 1,
    '2026-08-29T01:00:00Z', repeat('3', 64), 'UPSERT', repeat('4', 64),
    jsonb_build_object('schema_version','hdl-v2.health-ingestion.v1','canonical_user_id',user_a),
    array['2026-08-29'::date]
  );
  if result <> 'STALE_REJECTED' then raise exception 'STALE_PROTECTION_FAILED'; end if;
  result := public.beta_ingest_health_mutation(
    user_a, 'android', 'heart_rate', 'test.origin', 'record-1', 3,
    '2026-08-29T01:02:00Z', repeat('7', 64), 'DELETE', repeat('8', 64), null,
    array['2026-08-29'::date]
  );
  if result <> 'DELETED' then raise exception 'DELETE_RECONCILIATION_FAILED'; end if;
  if not exists (
    select 1 from public.beta_health_records
    where canonical_user_id = user_a and source_record_id = 'record-1'
      and operation = 'DELETE' and canonical_record is null and invalidated_at is not null
  ) then raise exception 'DELETE_TOMBSTONE_MISSING'; end if;
  if exists (
    select 1 from public.beta_health_records
    where canonical_user_id = user_b and source_record_id = 'record-1'
  ) then raise exception 'CROSS_USER_ISOLATION_FAILED'; end if;
end
$test$;

rollback;
select 'BETA_RUNTIME_SQL_TESTS_PASS' as result;
