-- PROPOSAL: opt-in engine output storage. Not applied to production or Beta.
-- Existing canonical records, Beta queue and health-score-v1.0 tables are unchanged.
create table public.engine_output_history (
  canonical_user_id uuid not null references public.users(id),
  calculation_date date not null,
  output_kind text not null check (output_kind in
    ('aggregate','derived','nutrition','sleep','activity','cardio','body','recovery','overall')),
  engine_version text not null check (length(engine_version) > 0),
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  score numeric check (score >= 0 and score <= 100),
  score_status text not null check (score_status in
    ('VALID','INSUFFICIENT_DATA','PARTIAL_DATA','STALE','ERROR')),
  data_completeness numeric not null check (data_completeness >= 0 and data_completeness <= 1),
  confidence text not null check (confidence in ('HIGH','MEDIUM','LOW','UNKNOWN')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  calculated_at timestamptz not null,
  primary key(canonical_user_id,calculation_date,output_kind,engine_version,input_fingerprint),
  check (score_status not in ('INSUFFICIENT_DATA','ERROR') or score is null)
);

create table public.engine_output_heads (
  canonical_user_id uuid not null,
  calculation_date date not null,
  output_kind text not null,
  engine_version text not null,
  input_fingerprint text not null,
  primary key(canonical_user_id,calculation_date,output_kind,engine_version),
  foreign key(canonical_user_id,calculation_date,output_kind,engine_version,input_fingerprint)
    references public.engine_output_history
      (canonical_user_id,calculation_date,output_kind,engine_version,input_fingerprint)
);

-- Leading owner/date supports dashboard, 7-day and 28-day ranges without per-row queries.
create index engine_output_version_lookup on public.engine_output_heads
  (canonical_user_id,output_kind,engine_version,calculation_date desc);

alter table public.engine_output_history enable row level security;
alter table public.engine_output_heads enable row level security;
revoke all on public.engine_output_history, public.engine_output_heads from public, anon, authenticated;
grant select on public.engine_output_history, public.engine_output_heads to authenticated;
-- Canonical identity is NOT necessarily auth.uid(); use the existing trusted resolver/API.
-- No authenticated SELECT policy is added until that identity binding is wired by the host.
-- No table-wide authenticated writes, no owner-selected client writes.
grant select, insert on public.engine_output_history to service_role;
grant select, insert, update on public.engine_output_heads to service_role;
-- History is append-only for the runtime role: there is deliberately no UPDATE/DELETE grant.
-- Writer must insert one complete versioned bundle + switch heads in one transaction.
