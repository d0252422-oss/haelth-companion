// Source/name assertions only: no environment, private files or credential values.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
export const settingNames=[
 'HEALTH_MANUAL_SQL_HOSTED_ENABLED','HEALTH_MANUAL_RELEASE','HEALTH_MANUAL_ALLOWED_ORIGIN',
 'HEALTH_MANUAL_EXPECTED_PROJECT_REF','HEALTH_MANUAL_EXPECTED_DB_HOST','HEALTH_MANUAL_DATABASE_URL',
 'HEALTH_BACKGROUND_SQL_ENABLED','HEALTH_NATIVE_DATABASE_URL','HEALTH_RECOMPUTE_DATABASE_URL',
 'HEALTH_RECOMPUTE_TRIGGER_SECRET','BETA_WEB_AUTH_VERIFY_URL',
];
export function validateConfigWiring(plan){
 assert.deepEqual([...plan.settings_names].sort(),[...settingNames].sort(),'SETTING_NAMES_DRIFT');
 assert.deepEqual(plan.roles,['health_manual_api','health_native_ingest','health_recompute_worker']);
 const manual=read('supabase/functions/mobile-health-beta/hosted-manual-bootstrap.ts');
 const worker=read('supabase/functions/mobile-health-beta/background-bootstrap.ts');
 const entry=read('supabase/functions/mobile-health-beta/index.ts');
 for(const name of settingNames)assert.ok((manual+worker+entry).includes('"'+name+'"')||(manual+worker+entry).includes("'"+name+"'"),name+'_UNWIRED');
 for(const [role,source] of [['health_manual_api',manual],['health_native_ingest',worker],['health_recompute_worker',worker]])assert.ok(source.includes(role),role+'_UNWIRED');
 assert.match(manual,/rejectUnauthorized:\s*true/);assert.match(worker,/rejectUnauthorized:\s*true/);
 assert.match(manual,/6543/);assert.match(worker,/6543/);
 assert.equal(plan.target.poolHost,'aws-0-ap-southeast-1.pooler.supabase.com');
 assert.notEqual(plan.target.poolHost,plan.target.databaseHost,'DB_HOST setting means pool host, not direct host');
 assert.ok(!settingNames.some(n=>/SERVICE_ROLE|MIGRATION_PASSWORD|TEST_PASSWORD/.test(n)));
 return {status:'PASS_SOURCE_NAMES_ONLY',count:settingNames.length,private_values:'NOT_READ',
  expected_db_host_setting:plan.target.poolHost,migration_identity:'SEPARATE_ADMIN_NOT_EDGE_ENV',test_identity:'NORMAL_A_B_SESSIONS_NOT_DB_PASSWORD'};
}
