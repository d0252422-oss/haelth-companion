-- Additive forward fix for the durable queue function replacement in
-- 20260903021109. An UPDATE that moves a native record from D1 to D2 must
-- invalidate both dates; otherwise D1 can retain a published stale score.
create or replace function private.beta_enqueue_score_recompute()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  affected_date date;
  affected_dates date[] := coalesce(new.affected_local_dates, '{}'::date[]);
begin
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

revoke all on function private.beta_enqueue_score_recompute() from public, anon, authenticated;
