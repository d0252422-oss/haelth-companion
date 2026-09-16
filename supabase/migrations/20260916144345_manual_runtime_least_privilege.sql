-- Local rehearsal / proposal only. Provision LOGIN/credential separately after approval.
-- Existing roles are not silently altered or granted elevated memberships.
do $role$ begin
 if not exists(select 1 from pg_roles where rolname='health_manual_api') then
  create role health_manual_api nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication;
 end if;
 if exists(select 1 from pg_roles where rolname='health_manual_api' and
  (rolsuper or rolbypassrls or rolinherit or rolcreatedb or rolcreaterole or rolreplication))
  or exists(select 1 from pg_auth_members where member='health_manual_api'::regrole) then
  raise exception 'UNSAFE_EXISTING_MANUAL_ROLE';
 end if;
end $role$;
grant connect on database postgres to health_manual_api;
grant usage on schema public,private to health_manual_api;

create function private.manual_context_user() returns uuid
language sql stable security invoker set search_path='' as $$
 select case when count(*)=1 then min(a.canonical_user_id::text)::uuid end
 from private.beta_web_identity_aliases a join public.users u on u.id=a.canonical_user_id and u.status='ACTIVE'
 where a.web_subject_hash=nullif(current_setting('health.manual.subject',true),'')
 and a.verified_email_hash=nullif(current_setting('health.manual.email',true),'')
 and a.provider='google' and a.environment='beta'
$$;
revoke all on function private.manual_context_user() from public,anon,authenticated;
grant execute on function private.manual_context_user() to health_manual_api;
grant select on private.beta_web_identity_aliases to health_manual_api;
create policy manual_alias_context on private.beta_web_identity_aliases for select to health_manual_api
 using(web_subject_hash=nullif(current_setting('health.manual.subject',true),'')
 or verified_email_hash=nullif(current_setting('health.manual.email',true),''));
grant select(id,status) on public.users to health_manual_api;
create policy manual_user_context on public.users for select to health_manual_api
 using(id in(select a.canonical_user_id from private.beta_web_identity_aliases a
 where a.web_subject_hash=nullif(current_setting('health.manual.subject',true),'')
 or a.verified_email_hash=nullif(current_setting('health.manual.email',true),'')));

-- Explicit finite table allowlist; all runtime reads/writes remain owner-scoped.
do $policies$
declare t text;
begin
 foreach t in array array['public.engine_meals','public.engine_manual_body_records',
 'public.engine_manual_observations','public.engine_output_history','public.engine_output_heads',
 'public.beta_health_scores','private.beta_score_recompute_queue',
 'private.engine_mutation_receipts','private.engine_body_mutation_receipts','private.engine_observation_receipts'] loop
  execute format('create policy manual_runtime_owner on %s for all to health_manual_api using(canonical_user_id=(select private.manual_context_user())) with check(canonical_user_id=(select private.manual_context_user()))',t);
 end loop;
end $policies$;
grant select,insert,update on public.engine_meals,public.engine_manual_body_records,public.engine_manual_observations,
 public.engine_output_heads,public.beta_health_scores,private.beta_score_recompute_queue to health_manual_api;
grant select,insert on public.engine_output_history,private.engine_mutation_receipts,
 private.engine_body_mutation_receipts,private.engine_observation_receipts to health_manual_api;
grant select on public.beta_health_records to health_manual_api;
create policy manual_native_read on public.beta_health_records for select to health_manual_api
 using(canonical_user_id=(select private.manual_context_user()));

-- Release A does not require the optional exercise tables.
do $exercise$ begin
 if to_regclass('public.manual_exercise_catalog') is not null then
  grant select,insert,delete on public.manual_exercise_catalog,public.manual_exercise_preferences to health_manual_api;
  grant update(exercise_name,muscle_group) on public.manual_exercise_catalog to health_manual_api;
  grant update(alias,archived,revision) on public.manual_exercise_preferences to health_manual_api;
  grant select,insert on public.manual_workout_sets,private.manual_training_receipts to health_manual_api;
  grant update(exercise_id,local_date,revision,deleted,body,updated_at) on public.manual_workout_sets to health_manual_api;
  create policy manual_catalog_read on public.manual_exercise_catalog for select to health_manual_api
   using(owner_user_id is null or owner_user_id=(select private.manual_context_user()));
  create policy manual_catalog_insert on public.manual_exercise_catalog for insert to health_manual_api
   with check(owner_user_id=(select private.manual_context_user()));
  create policy manual_catalog_update on public.manual_exercise_catalog for update to health_manual_api
   using(owner_user_id=(select private.manual_context_user())) with check(owner_user_id=(select private.manual_context_user()));
  create policy manual_catalog_delete on public.manual_exercise_catalog for delete to health_manual_api
   using(owner_user_id=(select private.manual_context_user()));
  create policy manual_preferences_owner on public.manual_exercise_preferences for all to health_manual_api
   using(canonical_user_id=(select private.manual_context_user())) with check(canonical_user_id=(select private.manual_context_user()));
  create policy manual_workout_runtime_owner on public.manual_workout_sets for all to health_manual_api
   using(canonical_user_id=(select private.manual_context_user())) with check(canonical_user_id=(select private.manual_context_user()));
  create policy manual_training_receipt_owner on private.manual_training_receipts for all to health_manual_api
   using(canonical_user_id=(select private.manual_context_user())) with check(canonical_user_id=(select private.manual_context_user()));
  grant execute on function private.manual_exercise_owner_guard(),private.manual_workout_reference_guard() to health_manual_api;
  -- A row-locking SELECT also applies UPDATE RLS and would hide immutable shared
  -- catalog rows. FK insertion supplies the referenced-key lock; ownership is
  -- immutable to runtime roles and the FK remains RESTRICT, never CASCADE.
  execute $definition$
   create or replace function private.manual_exercise_owner_guard() returns trigger
   language plpgsql security invoker set search_path='' as $body$
   declare owner_id uuid;
   begin
    select owner_user_id into owner_id from public.manual_exercise_catalog where exercise_id=new.exercise_id;
    if not found then raise exception 'EXERCISE_NOT_FOUND'; end if;
    if owner_id is not null and owner_id<>new.canonical_user_id then raise exception 'EXERCISE_OWNER_MISMATCH'; end if;
    return new;
   end $body$
  $definition$;
 end if;
end $exercise$;

-- Same bounded algorithms/leases. Execute with caller privileges and RLS, not owner.
alter function public.beta_claim_score_recompute(uuid,uuid,integer) security invoker;
alter function public.beta_fail_score_recompute(uuid,date,bigint,uuid,text,boolean) security invoker;
alter function public.beta_get_score_generation(uuid,date) security invoker;
alter function public.beta_persist_score_bundle(uuid,date,bigint,text,timestamptz,timestamptz,jsonb) security invoker;
grant execute on function public.beta_claim_score_recompute(uuid,uuid,integer),
 public.beta_fail_score_recompute(uuid,date,bigint,uuid,text,boolean),public.beta_get_score_generation(uuid,date),
 public.beta_persist_score_bundle(uuid,date,bigint,text,timestamptz,timestamptz,jsonb) to health_manual_api;
alter function private.engine_enqueue_meal() security invoker;
alter function private.engine_enqueue_observation() security invoker;
alter function private.engine_require_complete_publication() security invoker;
alter function private.engine_require_observation_publication() security invoker;
grant execute on function private.engine_enqueue_meal(),private.engine_enqueue_observation(),
 private.engine_require_complete_publication(),private.engine_require_observation_publication(),
 private.beta_clear_terminal_score_lease() to health_manual_api;
-- No aliases/users/native-record writes, sequence grants, table ownership,
-- SET ROLE membership, PUBLIC function grants, physical health/history deletes or CASCADE.
