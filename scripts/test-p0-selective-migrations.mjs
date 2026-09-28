// Rehearses precisely the Beta 401 + raw Total Energy migration set against
// the repository's synthetic pre-September-24 schema. Never uses remote config.
import assert from 'node:assert/strict';
import { createLocalPostgres } from './local-engine-postgres.mjs';

const selected = new Set([
  '20260928050251_native_bearer_ingest_scope.sql',
  '20260928130000_android_total_energy_canonical.sql',
]);
const baseline = '20260920224000';
let priorRls;
const pg = await createLocalPostgres({
  port: 57485,
  includeMigration: (filename) => filename.slice(0, 14) <= baseline || selected.has(filename),
  beforeMigration: async ({ filename, admin }) => {
    if (filename !== '20260928050251_native_bearer_ingest_scope.sql') return;
    priorRls = await admin`select relname,relrowsecurity,relforcerowsecurity
      from pg_class where oid in ('public.beta_health_records'::regclass,
        'private.health_source_record_state'::regclass) order by relname`;
  },
});
try {
  const actual = pg.evidence.migrations.map((item) => item.filename).filter((name) => name.slice(0, 14) > baseline);
  assert.deepEqual(actual, [...selected]);
  const laterRls = await pg.admin`select relname,relrowsecurity,relforcerowsecurity
    from pg_class where oid in ('public.beta_health_records'::regclass,
      'private.health_source_record_state'::regclass) order by relname`;
  assert.deepEqual(laterRls, priorRls);
  const domains = await pg.admin`select conname,pg_get_constraintdef(oid) as definition
    from pg_constraint where conname in ('beta_health_records_domain_check',
      'health_source_record_state_domain_check') order by conname`;
  assert.equal(domains.length, 2);
  assert.ok(domains.every((item) => item.definition.includes('total_energy')));
  const roles = await pg.admin`select rolcanlogin,rolbypassrls,rolsuper
    from pg_roles where rolname='health_native_ingest'`;
  assert.equal(roles.length, 1);
  assert.equal(roles[0].rolbypassrls, false);
  assert.equal(roles[0].rolsuper, false);
  console.log(JSON.stringify({ status: 'PASS', selected: actual,
    rls_unchanged: true, total_energy_constraints: 2, low_privilege_unchanged: true }));
} finally {
  await pg.close();
}
