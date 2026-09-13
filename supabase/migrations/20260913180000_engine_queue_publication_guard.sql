-- Additive proposal. No remote apply, existing data rewrite, new queue or formula change.
-- A legacy worker must not acknowledge work for which portable outputs are still missing.
alter table private.beta_score_recompute_queue
  add column engine_required boolean not null default false,
  add column engine_published_generation bigint not null default 0;

create or replace function private.engine_enqueue_meal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d date; base date; bases date[];
begin
  bases:=array[new.local_date];
  if tg_op='UPDATE' then bases:=array_append(bases,old.local_date); end if;
  for base in select distinct unnest(bases) loop
    for d in select generate_series(base,least(base+27,(now() at time zone 'Asia/Taipei')::date),'1 day')::date loop
      insert into private.beta_score_recompute_queue(canonical_user_id,score_date,engine_required)
      values(new.canonical_user_id,d,true)
      on conflict(canonical_user_id,score_date) do update set
        generation=private.beta_score_recompute_queue.generation+1,status='DIRTY',engine_required=true,
        attempt_count=0,next_attempt_at=now(),lease_token=null,lease_expires_at=null,
        completed_at=null,last_error_code=null,updated_at=now();
    end loop;
  end loop;
  return new;
end $$;
revoke all on function private.engine_enqueue_meal() from public,anon,authenticated;

create function private.engine_require_complete_publication() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Queue row already locked by the existing finalizer. Bounded indexed reads also
  -- protect pre-migration manual inputs/heads without a destructive/bulk backfill.
  -- Tombstones are included: deleting all input still requires reconciliation.
  if new.status='COMPLETE' and new.engine_published_generation<>new.generation and (
    new.engine_required or
    exists(select 1 from public.engine_meals m where m.canonical_user_id=new.canonical_user_id
      and m.local_date between new.score_date-27 and new.score_date) or
    exists(select 1 from public.engine_manual_body_records b where b.canonical_user_id=new.canonical_user_id
      and b.local_date between new.score_date-27 and new.score_date) or
    exists(select 1 from public.engine_output_heads h where h.canonical_user_id=new.canonical_user_id
      and h.calculation_date=new.score_date)
  ) then
    raise exception 'ENGINE_PUBLICATION_REQUIRED' using errcode='55000';
  end if;
  return new;
end $$;
revoke all on function private.engine_require_complete_publication() from public,anon,authenticated;
create trigger engine_complete_publication_guard before update of status
  on private.beta_score_recompute_queue for each row
  execute function private.engine_require_complete_publication();
