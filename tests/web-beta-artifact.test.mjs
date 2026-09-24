import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {BETA_PROJECT_REF, PRODUCTION_PROJECT_REF, WEB_FILES, assertWebTarget, createPublicSqlConfig, scanPublicArtifactText} from '../scripts/prepare-web-beta-artifact.mjs';

test('Web publication allowlist excludes runtime, schema, device and private configuration files', () => {
  assert.deepEqual(WEB_FILES, [
    'index.html','build.json','scripts/build-version.js','scripts/core-ux-contract.js',
    'scripts/local-engine-web.js','scripts/web-view-state.js','scripts/manual-observation-web.js',
  ]);
  assert.ok(WEB_FILES.every(file => !/supabase|migration|android|ios|\.env/iu.test(file)));
});

test('generated public overlay keeps SQL-first AB on exact Beta and contains no credential', () => {
  const context = {};
  const source = createPublicSqlConfig(BETA_PROJECT_REF).toString('utf8');
  vm.runInNewContext(source, context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.HEALTH_MANUAL_SQL_CONFIG)), {
    enabled:true,release:'AB',schemaVersion:'manual-sql-v1',projectRef:BETA_PROJECT_REF,
    endpoint:`https://${BETA_PROJECT_REF}.supabase.co/functions/v1/mobile-health-beta/v1/engine/web`,
  });
  assert.deepEqual(scanPublicArtifactText([{file:'config',text:source}]), []);
  assert.doesNotMatch(source,/service[_-]?role|password|authorization|bearer/iu);
});

test('target guard rejects production and arbitrary projects', () => {
  assert.equal(assertWebTarget(BETA_PROJECT_REF), undefined);
  assert.throws(() => assertWebTarget(PRODUCTION_PROJECT_REF), /PRODUCTION_TARGET_DENIED/u);
  assert.throws(() => assertWebTarget('x'.repeat(20)), /BETA_TARGET_NOT_ALLOWLISTED/u);
});

test('public artifact scan reports types and file names without returning secret values', () => {
  const findings = scanPublicArtifactText([{file:'bad.js',text:'const value="sb_secret_not-a-real-fixture";'}]);
  assert.deepEqual(findings,[{file:'bad.js',type:'SUPABASE_SECRET'}]);
  assert.doesNotMatch(JSON.stringify(findings),/not-a-real-fixture/u);
});
