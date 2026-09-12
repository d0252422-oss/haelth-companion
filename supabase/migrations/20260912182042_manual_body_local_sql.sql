-- PROPOSAL ONLY: apply only in dedicated synthetic loopback PostgreSQL rehearsals.
-- Manual Web body records do not change the Android/iOS ingestion contract.
create table public.engine_manual_body_records (
  canonical_user_id uuid not null references public.users(id),
  record_id uuid not null,
  revision bigint not null check (revision > 0),
  local_date date not null,
  deleted boolean not null default false,
  body jsonb not null check (body->>'source' = 'MANUAL_WEB'),
  updated_at timestamptz not null default now(),
  primary key (canonical_user_id, record_id)
);
create index engine_manual_body_day on public.engine_manual_body_records(canonical_user_id,local_date);
create unique index engine_manual_body_one_live_day
  on public.engine_manual_body_records(canonical_user_id,local_date) where not deleted;
create table private.engine_body_mutation_receipts (
  canonical_user_id uuid not null references public.users(id),
  request_id uuid not null,
  input_hash text not null,
  response jsonb not null,
  primary key (canonical_user_id,request_id)
);
alter table public.engine_manual_body_records enable row level security;
alter table public.engine_manual_body_records force row level security;
alter table private.engine_body_mutation_receipts enable row level security;
revoke all on public.engine_manual_body_records,private.engine_body_mutation_receipts from public,anon,authenticated;
grant select on public.engine_manual_body_records to authenticated;
grant select,insert,update on public.engine_manual_body_records to service_role;
grant select,insert on private.engine_body_mutation_receipts to service_role;
create policy engine_manual_body_owner on public.engine_manual_body_records
  for select to authenticated
  using(canonical_user_id=(select private.engine_current_canonical_user()));
-- Deliberately no trigger into mobile ingestion or the frozen score bridge.
-- Raw saved records are authoritative; body analysis remains explicitly pending.
