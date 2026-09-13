-- PROPOSAL ONLY. Rehearse in a new synthetic local PostgreSQL database.
-- SQL provider for the existing exerciseId / workout-set contract, not mobile ingestion.
create table public.manual_exercise_catalog (
  exercise_id text primary key check (length(exercise_id) between 1 and 128),
  owner_user_id uuid references public.users(id), -- NULL = shared system definition
  exercise_name text not null check (length(btrim(exercise_name)) between 1 and 80),
  muscle_group text not null check (length(btrim(muscle_group)) between 1 and 40)
);
create index manual_exercise_owner on public.manual_exercise_catalog(owner_user_id);
create table public.manual_exercise_preferences (
  canonical_user_id uuid not null references public.users(id),
  exercise_id text not null references public.manual_exercise_catalog(exercise_id) on delete restrict,
  alias text check (alias is null or length(btrim(alias)) between 1 and 80),
  archived boolean not null default false,
  revision bigint not null default 0 check(revision >= 0),
  primary key(canonical_user_id,exercise_id)
);
create index manual_exercise_preferences_reference on public.manual_exercise_preferences(exercise_id);
create table public.manual_workout_sets (
  canonical_user_id uuid not null references public.users(id),
  record_id uuid not null,
  exercise_id text not null,
  session_id uuid not null,
  local_date date not null,
  revision bigint not null check(revision > 0),
  deleted boolean not null default false,
  body jsonb not null check(body->>'source'='MANUAL_WEB'),
  updated_at timestamptz not null default now(),
  primary key(canonical_user_id,record_id),
  foreign key(canonical_user_id,exercise_id) references public.manual_exercise_preferences(canonical_user_id,exercise_id) on delete restrict
);
create index manual_workout_reference on public.manual_workout_sets(canonical_user_id,exercise_id);
create index manual_workout_range on public.manual_workout_sets(canonical_user_id,local_date);
create table private.manual_training_receipts (
  canonical_user_id uuid not null references public.users(id),
  request_id uuid not null,
  input_hash text not null,
  response jsonb not null,
  primary key(canonical_user_id,request_id)
);
-- Even a direct privileged adapter insert cannot attach B's custom exercise to A.
-- FK key locks also arbitrate concurrent reference creation versus physical deletion.
create function private.manual_exercise_owner_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare owner_id uuid;
begin
  select owner_user_id into owner_id from public.manual_exercise_catalog
    where exercise_id=new.exercise_id for key share;
  if not found then raise exception 'EXERCISE_NOT_FOUND'; end if;
  if owner_id is not null and owner_id<>new.canonical_user_id then
    raise exception 'EXERCISE_OWNER_MISMATCH';
  end if;
  return new;
end $$;
create trigger manual_exercise_owner_guard before insert or update of canonical_user_id,exercise_id
on public.manual_exercise_preferences for each row execute function private.manual_exercise_owner_guard();
create function private.manual_workout_reference_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare hidden boolean;
begin
  if tg_op='UPDATE' and new.exercise_id=old.exercise_id and new.canonical_user_id=old.canonical_user_id then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.canonical_user_id::text,0));
  select archived into hidden from public.manual_exercise_preferences
    where canonical_user_id=new.canonical_user_id and exercise_id=new.exercise_id for update;
  if not found then raise exception 'EXERCISE_NOT_FOUND'; end if;
  if hidden then raise exception 'EXERCISE_ARCHIVED'; end if;
  return new;
end $$;
create trigger manual_workout_reference_guard before insert or update of canonical_user_id,exercise_id
on public.manual_workout_sets for each row execute function private.manual_workout_reference_guard();
-- No CASCADE anywhere. Soft-deleted history still counts as a permanent-delete reference.
alter table public.manual_exercise_catalog enable row level security;
alter table public.manual_exercise_catalog force row level security;
alter table public.manual_exercise_preferences enable row level security;
alter table public.manual_exercise_preferences force row level security;
alter table public.manual_workout_sets enable row level security;
alter table public.manual_workout_sets force row level security;
alter table private.manual_training_receipts enable row level security;
revoke all on public.manual_exercise_catalog,public.manual_exercise_preferences,public.manual_workout_sets,private.manual_training_receipts from public,anon,authenticated;
revoke all on function private.manual_exercise_owner_guard() from public,anon,authenticated;
revoke all on function private.manual_workout_reference_guard() from public,anon,authenticated;
grant select on public.manual_exercise_catalog,public.manual_exercise_preferences,public.manual_workout_sets to authenticated;
grant select,insert,delete on public.manual_exercise_catalog,public.manual_exercise_preferences to service_role;
grant update(exercise_name) on public.manual_exercise_catalog to service_role;
grant update(alias,archived,revision) on public.manual_exercise_preferences to service_role;
grant select,insert on public.manual_workout_sets to service_role;
grant update(exercise_id,local_date,revision,deleted,body,updated_at) on public.manual_workout_sets to service_role;
grant select,insert on private.manual_training_receipts to service_role;
grant execute on function private.manual_exercise_owner_guard() to service_role;
grant execute on function private.manual_workout_reference_guard() to service_role;
create policy manual_exercise_visible on public.manual_exercise_catalog for select to authenticated
 using(owner_user_id is null or owner_user_id=(select private.engine_current_canonical_user()));
create policy manual_exercise_preferences_owner on public.manual_exercise_preferences for select to authenticated
 using(canonical_user_id=(select private.engine_current_canonical_user()));
create policy manual_workout_owner on public.manual_workout_sets for select to authenticated
 using(canonical_user_id=(select private.engine_current_canonical_user()));
-- Existing schema contains no runtime workout-template store. Any future template
-- implementation must use a normalized RESTRICT FK before it may reference catalog IDs.
-- Do not turn JSON/name-only template references into an unprotected delete pre-check.
