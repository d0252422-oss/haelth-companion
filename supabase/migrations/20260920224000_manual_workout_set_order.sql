-- Additive Beta/local rehearsal migration. Production application requires a
-- separate explicit authorization gate.
-- Supabase CLI 2.115 executes parsed statements through a pipeline that is not
-- itself a PostgreSQL transaction block. Session-level timeouts are therefore
-- used here (not SET LOCAL), while all schema changes remain atomic inside one
-- DO statement transaction. The isolated release connection ends after this one
-- pending migration, so the timeout stays active through the CLI history insert.
set lock_timeout = '5s';
set statement_timeout = '30s';

do $migration$
begin
  execute 'alter table public.manual_workout_sets add column if not exists set_order integer';

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.manual_workout_sets'::regclass
      and conname = 'manual_workout_sets_set_order_positive'
  ) then
    execute 'alter table public.manual_workout_sets add constraint manual_workout_sets_set_order_positive check (set_order > 0)';
  end if;

  -- Historical rows intentionally remain NULL because their original order
  -- cannot be reconstructed from random UUIDs. New writes persist a real order.
  execute 'create unique index if not exists manual_workout_set_order_unique on public.manual_workout_sets(canonical_user_id, session_id, set_order) where not deleted and set_order is not null';
end
$migration$;
