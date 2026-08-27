do $$
declare
  test_user uuid := '77777777-7777-4777-8777-777777777777';
  action text;
  pending_count integer;
begin
  insert into auth.users(id, aud, role, created_at, updated_at)
  values (test_user, 'authenticated', 'authenticated', now(), now());
  insert into public.users(id, timezone, created_at, updated_at)
  values (test_user, 'Asia/Taipei', now(), now());

  action := private.reconcile_health_source_record(test_user, 'ios', 'heart_rate', 'com.apple.health', 'hk-1', 1, null, repeat('a',64), 'UPSERT', array['2026-08-27'::date]);
  if action <> 'CREATED' then raise exception 'create failed: %', action; end if;

  action := private.reconcile_health_source_record(test_user, 'ios', 'heart_rate', 'com.apple.health', 'hk-1', 1, null, repeat('a',64), 'UPSERT', array['2026-08-27'::date]);
  if action <> 'REPLAYED' then raise exception 'replay failed: %', action; end if;

  action := private.reconcile_health_source_record(test_user, 'ios', 'heart_rate', 'com.apple.health', 'hk-1', 2, null, repeat('b',64), 'UPSERT', array['2026-08-27'::date]);
  if action <> 'UPDATED' then raise exception 'update failed: %', action; end if;

  action := private.reconcile_health_source_record(test_user, 'ios', 'heart_rate', 'com.apple.health', 'hk-1', 1, null, repeat('a',64), 'UPSERT', array['2026-08-27'::date]);
  if action <> 'STALE_REJECTED' then raise exception 'stale replay accepted: %', action; end if;

  action := private.reconcile_health_source_record(test_user, 'ios', 'heart_rate', 'com.apple.health', 'hk-1', 3, null, repeat('c',64), 'DELETE', array['2026-08-27'::date]);
  if action <> 'DELETED' then raise exception 'delete failed: %', action; end if;

  action := private.reconcile_health_source_record(test_user, 'ios', 'heart_rate', 'com.apple.health', 'hk-1', 3, null, repeat('c',64), 'DELETE', array['2026-08-27'::date]);
  if action <> 'REPLAYED' then raise exception 'delete replay failed: %', action; end if;

  select count(*) into pending_count
  from private.health_source_reconciliation_events
  where canonical_user_id = test_user and requires_derived_recompute and recompute_status = 'PENDING';
  if pending_count <> 2 then raise exception 'expected update+delete invalidations, got %', pending_count; end if;

  if exists (
    select 1 from private.health_source_record_state
    where source_record_id = 'hk-1' and canonical_user_id <> test_user
  ) then raise exception 'cross-user state leak'; end if;

  if has_table_privilege('anon', 'private.health_source_record_state', 'SELECT')
     or has_table_privilege('authenticated', 'private.health_source_record_state', 'SELECT') then
    raise exception 'client role can access reconciliation state';
  end if;
end $$;

select 'HEALTH_SOURCE_RECONCILIATION_SQL_TESTS=PASS' as result;
