-- Purpose: add stable system/user body-part identities for manual exercises.
-- Scope: additive registry + catalog FK/backfill; no exercise or workout rows are deleted.
-- Rollout: the legacy muscle_group column remains as a server-maintained compatibility value.

create or replace function private.manual_body_part_normalized_name(p_name text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select lower(btrim(regexp_replace(normalize(p_name, NFC), '[[:space:]]+', ' ', 'g')))
$$;

revoke all on function private.manual_body_part_normalized_name(text) from public, anon, authenticated;
grant execute on function private.manual_body_part_normalized_name(text) to service_role, health_manual_api;

create table public.manual_exercise_body_parts (
  body_part_id text primary key check (length(body_part_id) between 1 and 128),
  canonical_key text,
  display_name text not null check (length(btrim(display_name)) between 1 and 40),
  source text not null check (source in ('SYSTEM', 'USER')),
  owner_user_id uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manual_body_part_source_owner_coherent check (
    (source = 'SYSTEM' and owner_user_id is null and canonical_key is not null)
    or
    (source = 'USER' and owner_user_id is not null and canonical_key is null)
  ),
  constraint manual_body_part_system_key_format check (
    canonical_key is null or canonical_key ~ '^[A-Z][A-Z0-9_]*$'
  ),
  constraint manual_body_part_id_format check (
    body_part_id ~ '^(system:[a-z0-9]+(-[a-z0-9]+)*|custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|custom:legacy:[0-9a-f]{32})$'
  )
);

create unique index manual_body_part_system_key_unique
  on public.manual_exercise_body_parts(canonical_key)
  where source = 'SYSTEM';
create unique index manual_body_part_system_name_unique
  on public.manual_exercise_body_parts(private.manual_body_part_normalized_name(display_name))
  where source = 'SYSTEM';
create unique index manual_body_part_owner_name_unique
  on public.manual_exercise_body_parts(owner_user_id, private.manual_body_part_normalized_name(display_name))
  where source = 'USER';
create index manual_body_part_owner
  on public.manual_exercise_body_parts(owner_user_id)
  where owner_user_id is not null;

create or replace function private.manual_body_part_name_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.source = 'USER' and exists(
    select 1
    from public.manual_exercise_body_parts b
    where b.source = 'SYSTEM'
      and private.manual_body_part_normalized_name(b.display_name)
        = private.manual_body_part_normalized_name(new.display_name)
      and b.body_part_id <> new.body_part_id
  ) then
    raise exception 'BODY_PART_DUPLICATE_VISIBLE_NAME';
  end if;
  return new;
end
$$;

revoke all on function private.manual_body_part_name_guard() from public, anon, authenticated;
grant execute on function private.manual_body_part_name_guard() to service_role, health_manual_api;

create trigger manual_body_part_name_guard
before insert or update of display_name, source, owner_user_id
on public.manual_exercise_body_parts
for each row execute function private.manual_body_part_name_guard();

insert into public.manual_exercise_body_parts(body_part_id, canonical_key, display_name, source, owner_user_id)
values
  ('system:chest', 'CHEST', '胸部', 'SYSTEM', null),
  ('system:back', 'BACK', '背部', 'SYSTEM', null),
  ('system:shoulders', 'SHOULDERS', '肩部', 'SYSTEM', null),
  ('system:biceps', 'BICEPS', '二頭肌', 'SYSTEM', null),
  ('system:triceps', 'TRICEPS', '三頭肌', 'SYSTEM', null),
  ('system:legs', 'LEGS', '腿部', 'SYSTEM', null),
  ('system:glutes', 'GLUTES', '臀部', 'SYSTEM', null),
  ('system:core', 'CORE', '核心', 'SYSTEM', null),
  ('system:cardio', 'CARDIO', '有氧', 'SYSTEM', null),
  ('system:full-body', 'FULL_BODY', '全身', 'SYSTEM', null),
  ('system:other', 'OTHER', '其他', 'SYSTEM', null)
on conflict(body_part_id) do nothing;

do $validate_system_body_parts$
begin
  if (
    select count(*)
    from public.manual_exercise_body_parts
    where source = 'SYSTEM'
      and body_part_id in (
        'system:chest', 'system:back', 'system:shoulders', 'system:biceps',
        'system:triceps', 'system:legs', 'system:glutes', 'system:core',
        'system:cardio', 'system:full-body', 'system:other'
      )
  ) <> 11 then
    raise exception 'SYSTEM_BODY_PART_SEED_CONFLICT';
  end if;
end
$validate_system_body_parts$;

alter table public.manual_exercise_catalog
  add column body_part_id text;

-- Existing custom values equal to a system key or its Chinese display label are
-- references to that system body part, not new user taxonomy rows.
update public.manual_exercise_catalog c
set body_part_id = b.body_part_id,
    muscle_group = b.canonical_key
from public.manual_exercise_body_parts b
where b.source = 'SYSTEM'
  and (
    lower(b.canonical_key) = lower(btrim(c.muscle_group))
    or private.manual_body_part_normalized_name(b.display_name)
      = private.manual_body_part_normalized_name(c.muscle_group)
  );

-- Preserve every remaining legacy custom category once per owner. Deterministic
-- IDs make the backfill repeatable in independently-created environments.
insert into public.manual_exercise_body_parts(
  body_part_id, canonical_key, display_name, source, owner_user_id
)
select
  'custom:legacy:' || md5(c.owner_user_id::text || ':' || private.manual_body_part_normalized_name(c.muscle_group)),
  null,
  min(btrim(regexp_replace(normalize(c.muscle_group, NFC), '[[:space:]]+', ' ', 'g'))),
  'USER',
  c.owner_user_id
from public.manual_exercise_catalog c
where c.owner_user_id is not null
  and c.body_part_id is null
group by c.owner_user_id, private.manual_body_part_normalized_name(c.muscle_group)
on conflict do nothing;

update public.manual_exercise_catalog c
set body_part_id = b.body_part_id,
    muscle_group = b.display_name
from public.manual_exercise_body_parts b
where c.owner_user_id is not null
  and c.body_part_id is null
  and b.source = 'USER'
  and b.owner_user_id = c.owner_user_id
  and private.manual_body_part_normalized_name(b.display_name)
    = private.manual_body_part_normalized_name(c.muscle_group);

do $validate_body_part_backfill$
begin
  if exists(select 1 from public.manual_exercise_catalog where body_part_id is null) then
    raise exception 'MANUAL_EXERCISE_BODY_PART_BACKFILL_INCOMPLETE';
  end if;
end
$validate_body_part_backfill$;

alter table public.manual_exercise_catalog
  alter column body_part_id set not null,
  add constraint manual_exercise_body_part_reference
    foreign key(body_part_id)
    references public.manual_exercise_body_parts(body_part_id)
    on delete restrict;

create index manual_exercise_body_part_reference_idx
  on public.manual_exercise_catalog(body_part_id);

create or replace function private.manual_exercise_body_part_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  part public.manual_exercise_body_parts%rowtype;
  normalized_name text;
begin
  -- Compatibility for a previously-deployed API that only supplies muscle_group.
  -- New code always sends body_part_id and never trusts client category text.
  if tg_op = 'UPDATE'
    and new.body_part_id is not null
    and new.body_part_id is not distinct from old.body_part_id
    and new.muscle_group is distinct from old.muscle_group
  then
    -- The prior Edge revision classified by updating muscle_group only. Resolve
    -- that value to the canonical/user-scoped row during an ordered migration
    -- then Edge rollout instead of silently restoring the old body_part_id.
    new.body_part_id := null;
  end if;

  if new.body_part_id is null then
    select b.* into part
    from public.manual_exercise_body_parts b
    where (
      b.source = 'SYSTEM'
      and (
        lower(b.canonical_key) = lower(btrim(new.muscle_group))
        or private.manual_body_part_normalized_name(b.display_name)
          = private.manual_body_part_normalized_name(new.muscle_group)
      )
    ) or (
      b.source = 'USER'
      and b.owner_user_id = new.owner_user_id
      and private.manual_body_part_normalized_name(b.display_name)
        = private.manual_body_part_normalized_name(new.muscle_group)
    )
    order by case b.source when 'SYSTEM' then 0 else 1 end
    limit 1;

    if not found and new.owner_user_id is not null then
      normalized_name := private.manual_body_part_normalized_name(new.muscle_group);
      insert into public.manual_exercise_body_parts(
        body_part_id, canonical_key, display_name, source, owner_user_id
      ) values (
        'custom:' || gen_random_uuid()::text,
        null,
        btrim(regexp_replace(normalize(new.muscle_group, NFC), '[[:space:]]+', ' ', 'g')),
        'USER',
        new.owner_user_id
      )
      on conflict do nothing;

      select b.* into part
      from public.manual_exercise_body_parts b
      where b.source = 'USER'
        and b.owner_user_id = new.owner_user_id
        and private.manual_body_part_normalized_name(b.display_name) = normalized_name;
    end if;

    if part.body_part_id is null then
      raise exception 'BODY_PART_NOT_FOUND';
    end if;
    new.body_part_id := part.body_part_id;
  else
    select b.* into part
    from public.manual_exercise_body_parts b
    where b.body_part_id = new.body_part_id;
    if not found then
      raise exception 'BODY_PART_NOT_FOUND';
    end if;
  end if;

  if part.source = 'USER' and part.owner_user_id is distinct from new.owner_user_id then
    raise exception 'BODY_PART_OWNER_MISMATCH';
  end if;

  if new.owner_user_id is null and part.source <> 'SYSTEM' then
    raise exception 'GLOBAL_EXERCISE_REQUIRES_SYSTEM_BODY_PART';
  end if;

  new.muscle_group := coalesce(part.canonical_key, part.display_name);
  return new;
end
$$;

revoke all on function private.manual_exercise_body_part_guard() from public, anon, authenticated;
grant execute on function private.manual_exercise_body_part_guard() to service_role, health_manual_api;

create trigger manual_exercise_body_part_guard
before insert or update of body_part_id, owner_user_id, muscle_group
on public.manual_exercise_catalog
for each row execute function private.manual_exercise_body_part_guard();

alter table public.manual_exercise_body_parts enable row level security;
alter table public.manual_exercise_body_parts force row level security;

revoke all on public.manual_exercise_body_parts from public, anon, authenticated;
grant select on public.manual_exercise_body_parts to authenticated;
grant select, insert, delete on public.manual_exercise_body_parts to service_role, health_manual_api;
grant update(body_part_id, muscle_group) on public.manual_exercise_catalog to service_role, health_manual_api;

create policy manual_body_part_visible
on public.manual_exercise_body_parts
for select
to authenticated
using (
  source = 'SYSTEM'
  or owner_user_id = (select private.engine_current_canonical_user())
);

create policy manual_body_part_runtime_read
on public.manual_exercise_body_parts
for select
to health_manual_api
using (
  source = 'SYSTEM'
  or owner_user_id = (select private.manual_context_user())
);

create policy manual_body_part_runtime_insert
on public.manual_exercise_body_parts
for insert
to health_manual_api
with check (
  source = 'USER'
  and canonical_key is null
  and owner_user_id = (select private.manual_context_user())
);

create policy manual_body_part_runtime_delete
on public.manual_exercise_body_parts
for delete
to health_manual_api
using (
  source = 'USER'
  and owner_user_id = (select private.manual_context_user())
);

comment on table public.manual_exercise_body_parts is
  'Canonical system and owner-scoped custom training body parts. Display names are not identifiers.';
comment on column public.manual_exercise_catalog.body_part_id is
  'Stable body-part identity. muscle_group remains a trigger-maintained compatibility value.';
comment on function private.manual_exercise_body_part_guard() is
  'Enforces system/user ownership and synchronizes legacy muscle_group without trusting client identity.';
comment on function private.manual_body_part_name_guard() is
  'Rejects owner-scoped names that collide exactly with a visible canonical system body part.';
