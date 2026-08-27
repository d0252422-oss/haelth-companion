-- Must run after the mobile helper migration inside one disposable transaction.
do $$
begin
  if to_regclass('private.mobile_install_claims') is null
     or to_regclass('private.mobile_app_sessions') is null then
    raise exception 'mobile helper private tables missing';
  end if;

  if has_table_privilege('anon', 'private.mobile_install_claims', 'SELECT')
     or has_table_privilege('authenticated', 'private.mobile_install_claims', 'SELECT')
     or has_table_privilege('anon', 'private.mobile_app_sessions', 'SELECT')
     or has_table_privilege('authenticated', 'private.mobile_app_sessions', 'SELECT') then
    raise exception 'client role can access private mobile credentials';
  end if;

  if not has_table_privilege('service_role', 'private.mobile_install_claims', 'SELECT,INSERT,UPDATE')
     or not has_table_privilege('service_role', 'private.mobile_app_sessions', 'SELECT,INSERT,UPDATE') then
    raise exception 'trusted server role lacks required mobile registry access';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'private'
      and table_name in ('mobile_install_claims', 'mobile_app_sessions')
      and column_name in ('claim', 'access_token', 'refresh_token')
  ) then
    raise exception 'plaintext credential column found';
  end if;
end $$;

select 'MOBILE_HEALTH_HELPER_SQL_TESTS=PASS' as result;

