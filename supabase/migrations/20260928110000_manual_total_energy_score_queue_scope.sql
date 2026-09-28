-- Total energy is a display-only manual observation under health-score-v1.0.
-- Preserve the durable observation and receipt, but do not invalidate scores
-- whose frozen input set does not include this domain. No historical rewrite.
create or replace function private.engine_enqueue_observation() returns trigger
language plpgsql security invoker set search_path='' as $$
declare bases date[]:=array[new.local_date]; touched jsonb[]:=array[new.body]; item jsonb; base date; d date;
begin
  if new.domain='total_energy' then return new; end if;
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
