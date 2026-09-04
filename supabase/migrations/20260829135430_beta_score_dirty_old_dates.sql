-- Preserve bounded score correctness when a source update moves evidence from
-- one local date to another. Both the previous and current dates become dirty.

create or replace function private.beta_enqueue_score_recompute()
returns trigger
language plpgsql
set search_path = ''
as $$
declare affected_date date;
declare affected_dates date[] := new.affected_local_dates;
begin
  if tg_op = 'UPDATE' then
    affected_dates := affected_dates || old.affected_local_dates;
  end if;

  for affected_date in select distinct unnest(affected_dates) loop
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
