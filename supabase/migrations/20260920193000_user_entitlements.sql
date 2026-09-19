-- Provider-neutral controlled-access state. Payment processing is intentionally absent.
create table private.user_entitlements (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete restrict,
  access_status text not null check (access_status in ('BETA','FREE','TRIAL','PAID','EXPIRED','SUSPENDED','REVOKED')),
  plan_code text check (plan_code is null or plan_code ~ '^[A-Z][A-Z0-9_]{0,31}$'),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  grace_until timestamptz,
  source text not null check (source in ('MANUAL_BETA','ADMIN','PAYMENT','PROMO','MIGRATION','SYSTEM')),
  payment_reference text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > starts_at),
  check (grace_until is null or expires_at is not null and grace_until >= expires_at),
  check (payment_reference is null or length(payment_reference) between 1 and 256)
);
create index user_entitlements_status_expiry_idx on private.user_entitlements(access_status,expires_at);
alter table private.user_entitlements enable row level security;
alter table private.user_entitlements force row level security;
revoke all on private.user_entitlements from public,anon,authenticated,service_role;
grant select(id,user_id,access_status,plan_code,starts_at,expires_at,grace_until) on private.user_entitlements to health_manual_api;
create policy entitlement_self_read on private.user_entitlements for select to health_manual_api
 using(user_id=(select private.manual_context_user()));

create function private.resolve_user_entitlement()
returns table(access_status text,plan_code text,starts_at timestamptz,expires_at timestamptz,grace_until timestamptz)
language sql stable security invoker set search_path='' as $$
 select e.access_status,e.plan_code,e.starts_at,e.expires_at,e.grace_until
 from private.user_entitlements e
 where e.user_id=(select private.manual_context_user())
 limit 1
$$;
revoke all on function private.resolve_user_entitlement() from public,anon,authenticated,service_role;
grant execute on function private.resolve_user_entitlement() to health_manual_api;

comment on table private.user_entitlements is 'Server-managed current entitlement per canonical user; no payment credentials or provider coupling.';
