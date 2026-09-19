-- Narrow administrative path for controlled Beta access. Never used by normal app runtime.
create function public.beta_admin_set_entitlement(
  p_user_id uuid,
  p_access_status text,
  p_expires_at timestamptz default null
) returns table(user_id uuid,access_status text,starts_at timestamptz,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  if p_access_status not in ('BETA','REVOKED','SUSPENDED','EXPIRED') then
    raise exception 'ENTITLEMENT_STATUS_NOT_ADMIN_SETTABLE';
  end if;
  if not exists(select 1 from public.users u where u.id=p_user_id) then
    raise exception 'ENTITLEMENT_USER_NOT_FOUND';
  end if;
  if p_access_status='BETA' and p_expires_at is not null and p_expires_at<=now() then
    raise exception 'ENTITLEMENT_EXPIRY_INVALID';
  end if;
  insert into private.user_entitlements(user_id,access_status,starts_at,expires_at,source,metadata)
  values(p_user_id,p_access_status,now(),p_expires_at,'ADMIN','{}'::jsonb)
  on conflict(user_id) do update set access_status=excluded.access_status,starts_at=excluded.starts_at,
    expires_at=excluded.expires_at,grace_until=null,source='ADMIN',payment_reference=null,
    metadata='{}'::jsonb,updated_at=now();
  return query select e.user_id,e.access_status,e.starts_at,e.expires_at
    from private.user_entitlements e where e.user_id=p_user_id;
end $$;
revoke all on function public.beta_admin_set_entitlement(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.beta_admin_set_entitlement(uuid,text,timestamptz) to service_role;
comment on function public.beta_admin_set_entitlement(uuid,text,timestamptz) is
  'Administrative controlled-Beta grant/revoke only; payment activation is intentionally unsupported.';
