-- Additive local proposal. LOGIN/passwords require separate Beta authorization.
do $roles$
declare role_name text;
begin
 foreach role_name in array array['health_native_ingest','health_recompute_worker'] loop
  if not exists(select 1 from pg_roles where rolname=role_name) then
   execute format('create role %I nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication',role_name);
  end if;
  if exists(select 1 from pg_roles where rolname=role_name and (rolsuper or rolbypassrls or rolinherit or rolcreatedb or rolcreaterole or rolreplication))
   or exists(select 1 from pg_auth_members where member=role_name::regrole) then raise exception 'UNSAFE_EXISTING_WORKER_ROLE'; end if;
 end loop;
end $roles$;
grant connect on database postgres to health_native_ingest,health_recompute_worker;
grant usage on schema public,private to health_native_ingest,health_recompute_worker;

-- PL/pgSQL prepares all relations in an expression before boolean short circuit.
-- Native queue invalidation must not need SELECT on unrelated manual records.
create or replace function private.engine_require_complete_publication() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.status<>'COMPLETE' or new.engine_published_generation=new.generation then return new; end if;
 if new.engine_required or
 exists(select 1 from public.engine_meals where canonical_user_id=new.canonical_user_id and local_date between new.score_date-27 and new.score_date) or
 exists(select 1 from public.engine_manual_body_records where canonical_user_id=new.canonical_user_id and local_date between new.score_date-27 and new.score_date) or
 exists(select 1 from public.engine_output_heads where canonical_user_id=new.canonical_user_id and calculation_date=new.score_date)
 then raise exception 'ENGINE_PUBLICATION_REQUIRED' using errcode='55000'; end if;
 return new;
end $$;
create or replace function private.engine_require_observation_publication() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.status<>'COMPLETE' or new.engine_published_generation=new.generation then return new; end if;
 if exists(select 1 from public.engine_manual_observations where canonical_user_id=new.canonical_user_id and local_date between new.score_date-27 and new.score_date)
 then raise exception 'ENGINE_PUBLICATION_REQUIRED' using errcode='55000'; end if;
 return new;
end $$;

-- Existing revocable grants, not a second identity store. No session write privilege.
grant select on private.mobile_app_sessions,private.beta_shortcut_sessions to health_native_ingest;
create policy delegated_app_session on private.mobile_app_sessions for select to health_native_ingest
 using(current_setting('health.worker.kind',true)='app' and id::text=current_setting('health.worker.session',true)
 and access_token_digest=current_setting('health.worker.digest',true) and revoked_at is null and access_expires_at>now() and environment='beta');
create policy delegated_shortcut_session on private.beta_shortcut_sessions for select to health_native_ingest
 using(current_setting('health.worker.kind',true)='shortcut' and id::text=current_setting('health.worker.session',true)
 and access_token_digest=current_setting('health.worker.digest',true) and revoked_at is null and expires_at>now() and environment='beta');
grant select(id,status) on public.users to health_native_ingest;
create policy delegated_user on public.users for select to health_native_ingest using(id in
 (select canonical_user_id from private.mobile_app_sessions union select canonical_user_id from private.beta_shortcut_sessions));
create function private.delegated_worker_user() returns uuid language sql stable security invoker set search_path='' as $$
 select case when count(*)=1 then min(s.canonical_user_id::text)::uuid end from
 (select canonical_user_id from private.mobile_app_sessions union all select canonical_user_id from private.beta_shortcut_sessions) s
 join public.users u on u.id=s.canonical_user_id and u.status='ACTIVE'
$$;
create function private.delegated_worker_platform() returns text language sql stable security invoker set search_path='' as $$
 select platform from private.mobile_app_sessions union all select 'ios' from private.beta_shortcut_sessions
$$;
revoke all on function private.delegated_worker_user(),private.delegated_worker_platform() from public,anon,authenticated;
grant execute on function private.delegated_worker_user(),private.delegated_worker_platform() to health_native_ingest;

do $native$
declare t text;
begin
 foreach t in array array['public.beta_health_records','private.health_source_record_state'] loop
  execute format('create policy delegated_native_owner on %s for all to health_native_ingest using(canonical_user_id=(select private.delegated_worker_user()) and platform=(select private.delegated_worker_platform())) with check(canonical_user_id=(select private.delegated_worker_user()) and platform=(select private.delegated_worker_platform()))',t);
 end loop;
 foreach t in array array['private.health_source_reconciliation_events','private.beta_score_recompute_queue','public.beta_connector_status'] loop
  execute format('create policy delegated_owner on %s for all to health_native_ingest using(canonical_user_id=(select private.delegated_worker_user())) with check(canonical_user_id=(select private.delegated_worker_user()))',t);
 end loop;
end $native$;
grant select,insert,update on public.beta_health_records,private.health_source_record_state,
 private.health_source_reconciliation_events,private.beta_score_recompute_queue,public.beta_connector_status to health_native_ingest;
alter function public.beta_ingest_health_mutation(uuid,text,text,text,text,bigint,timestamptz,text,text,text,jsonb,date[]) security invoker;
alter function public.beta_ingest_health_mutation_batch(uuid,jsonb) security invoker;
alter function public.beta_report_connector_status(uuid,text,text,text,timestamptz,timestamptz,text,text[],text) security invoker;
alter function private.engine_enqueue_health_rolling() security invoker;
grant execute on function public.beta_ingest_health_mutation(uuid,text,text,text,text,bigint,timestamptz,text,text,text,jsonb,date[]),
 public.beta_ingest_health_mutation_batch(uuid,jsonb),private.reconcile_health_source_record(uuid,text,text,text,text,bigint,timestamptz,text,text,date[]),
 public.beta_report_connector_status(uuid,text,text,text,timestamptz,timestamptz,text,text[],text),
 private.engine_enqueue_health_rolling(),private.beta_clear_terminal_score_lease() to health_native_ingest;

-- System worker may claim existing queue items across tenants, never edit raw data.
-- A valid, unexpired exact lease gates every input read and output publication.
grant select,update on private.beta_score_recompute_queue to health_recompute_worker;
create policy system_queue_scope on private.beta_score_recompute_queue for all to health_recompute_worker using(true) with check(true);
create function private.recompute_worker_user() returns uuid language sql stable security invoker set search_path='' as $$
 select q.canonical_user_id from private.beta_score_recompute_queue q
 where q.canonical_user_id::text=current_setting('health.job.user',true)
 and q.score_date::text=current_setting('health.job.date',true)
 and q.generation::text=current_setting('health.job.generation',true)
 and q.lease_token::text=current_setting('health.job.token',true)
 and q.status='PROCESSING' and q.lease_expires_at>now()
$$;
revoke all on function private.recompute_worker_user() from public,anon,authenticated;
grant execute on function private.recompute_worker_user() to health_recompute_worker;
do $compute$
declare t text;
begin
 foreach t in array array['public.beta_health_records','public.engine_meals','public.engine_manual_body_records','public.engine_manual_observations','public.engine_output_history','public.engine_output_heads','public.beta_health_scores'] loop
  execute format('grant select on %s to health_recompute_worker',t);
  execute format('create policy worker_input_read on %s for select to health_recompute_worker using(canonical_user_id=(select private.recompute_worker_user()))',t);
 end loop;
 if to_regclass('public.manual_workout_sets') is not null then
  grant select on public.manual_workout_sets to health_recompute_worker;
  create policy worker_workout_read on public.manual_workout_sets for select to health_recompute_worker using(canonical_user_id=(select private.recompute_worker_user()));
 end if;
 foreach t in array array['public.engine_output_history','public.engine_output_heads'] loop
  execute format('create policy worker_output_insert on %s for insert to health_recompute_worker with check(canonical_user_id=(select private.recompute_worker_user()) and calculation_date::text=current_setting(''health.job.date'',true))',t);
 end loop;
end $compute$;
grant insert on public.engine_output_history,public.engine_output_heads,public.beta_health_scores to health_recompute_worker;
grant update on public.engine_output_heads,public.beta_health_scores to health_recompute_worker;
create policy worker_heads_update on public.engine_output_heads for update to health_recompute_worker
 using(canonical_user_id=(select private.recompute_worker_user()) and calculation_date::text=current_setting('health.job.date',true))
 with check(canonical_user_id=(select private.recompute_worker_user()) and calculation_date::text=current_setting('health.job.date',true));
create policy worker_score_insert on public.beta_health_scores for insert to health_recompute_worker
 with check(canonical_user_id=(select private.recompute_worker_user()) and score_date::text=current_setting('health.job.date',true));
create policy worker_score_update on public.beta_health_scores for update to health_recompute_worker
 using(canonical_user_id=(select private.recompute_worker_user()) and score_date::text=current_setting('health.job.date',true))
 with check(canonical_user_id=(select private.recompute_worker_user()) and score_date::text=current_setting('health.job.date',true));
grant execute on function public.beta_claim_score_recompute(uuid,uuid,integer),public.beta_fail_score_recompute(uuid,date,bigint,uuid,text,boolean),
 public.beta_get_score_generation(uuid,date),public.beta_persist_score_bundle(uuid,date,bigint,text,timestamptz,timestamptz,jsonb),
 private.engine_require_complete_publication(),private.engine_require_observation_publication(),private.beta_clear_terminal_score_lease() to health_recompute_worker;
