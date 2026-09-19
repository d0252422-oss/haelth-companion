\set ON_ERROR_STOP on
select jsonb_pretty(jsonb_build_object(
  'captured_at', clock_timestamp(),
  'server', jsonb_build_object(
    'version', current_setting('server_version'),
    'version_num', current_setting('server_version_num')::integer,
    'database', current_database(),
    'session_user', session_user,
    'current_user', current_user,
    'password_encryption', current_setting('password_encryption', true),
    'ssl', coalesce((select ssl from pg_stat_ssl where pid = pg_backend_pid()), false),
    'ssl_version', (select version from pg_stat_ssl where pid = pg_backend_pid()),
    'ssl_cipher', (select cipher from pg_stat_ssl where pid = pg_backend_pid())
  ),
  'runtime_roles', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', rolname,
      'login', rolcanlogin,
      'superuser', rolsuper,
      'bypassrls', rolbypassrls,
      'createdb', rolcreatedb,
      'createrole', rolcreaterole,
      'replication', rolreplication,
      'inherit', rolinherit,
      'connection_limit', rolconnlimit,
      'config', rolconfig
    ) order by rolname)
    from pg_roles
    where rolname in ('anon','authenticated','service_role','health_manual_api','health_native_ingest','health_recompute_worker')
  ), '[]'::jsonb),
  'runtime_memberships', coalesce((
    select jsonb_agg(jsonb_build_object('member', member.rolname, 'role', granted.rolname) order by member.rolname, granted.rolname)
    from pg_auth_members m
    join pg_roles granted on granted.oid=m.roleid
    join pg_roles member on member.oid=m.member
    where member.rolname in ('anon','authenticated','service_role','health_manual_api','health_native_ingest','health_recompute_worker')
  ), '[]'::jsonb),
  'extensions', coalesce((
    select jsonb_agg(jsonb_build_object('name', extname, 'version', extversion) order by extname)
    from pg_extension
  ), '[]'::jsonb),
  'security_definers', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', n.nspname,
      'name', p.proname,
      'owner', owner.rolname,
      'search_path', p.proconfig,
      'public_execute', has_function_privilege('public', p.oid, 'EXECUTE'),
      'anon_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'service_role_execute', has_function_privilege('service_role', p.oid, 'EXECUTE')
    ) order by n.nspname, p.proname)
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    join pg_roles owner on owner.oid=p.proowner
    where p.prosecdef and n.nspname in ('public','private')
  ), '[]'::jsonb),
  'rls_tables', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', n.nspname,
      'table', c.relname,
      'rls_enabled', c.relrowsecurity,
      'rls_forced', c.relforcerowsecurity,
      'owner', owner.rolname
    ) order by n.nspname, c.relname)
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    join pg_roles owner on owner.oid=c.relowner
    where c.relkind in ('r','p') and n.nspname in ('public','private')
  ), '[]'::jsonb),
  'policies', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', schemaname,
      'table', tablename,
      'name', policyname,
      'permissive', permissive,
      'roles', roles,
      'command', cmd,
      'using', qual,
      'check', with_check
    ) order by schemaname, tablename, policyname)
    from pg_policies
    where schemaname in ('public','private')
  ), '[]'::jsonb)
));
