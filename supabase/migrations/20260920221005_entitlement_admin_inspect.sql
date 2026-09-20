-- Service-only inspection for the controlled-Beta entitlement CLI.
create function public.beta_admin_get_entitlement(p_user_id uuid)
returns table(
  user_id uuid,
  access_status text,
  plan_code text,
  starts_at timestamptz,
  expires_at timestamptz,
  grace_until timestamptz,
  source text,
  updated_at timestamptz
)
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.users u where u.id=p_user_id) then
    raise exception 'ENTITLEMENT_USER_NOT_FOUND';
  end if;
  return query
    select e.user_id,e.access_status,e.plan_code,e.starts_at,e.expires_at,
      e.grace_until,e.source,e.updated_at
    from private.user_entitlements e
    where e.user_id=p_user_id;
end $$;
revoke all on function public.beta_admin_get_entitlement(uuid) from public,anon,authenticated;
grant execute on function public.beta_admin_get_entitlement(uuid) to service_role;
comment on function public.beta_admin_get_entitlement(uuid) is
  'Service-only controlled-Beta entitlement inspection; returns no payment reference or metadata.';
