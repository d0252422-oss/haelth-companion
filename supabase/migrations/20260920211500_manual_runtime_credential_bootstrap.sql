-- Temporary, service-role-only bootstrap. A following migration removes this RPC.
create function public.beta_admin_bootstrap_manual_runtime(p_password text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if length(p_password)<48 or length(p_password)>256
    or p_password !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'RUNTIME_PASSWORD_POLICY_REJECTED';
  end if;
  execute format('alter role health_manual_api login password %L',p_password);
  return true;
end $$;
revoke all on function public.beta_admin_bootstrap_manual_runtime(text) from public,anon,authenticated;
grant execute on function public.beta_admin_bootstrap_manual_runtime(text) to service_role;
