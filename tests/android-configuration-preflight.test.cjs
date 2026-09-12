const test = require('node:test');
const assert = require('node:assert/strict');

async function inspect(environment) {
  const { inspectAndroidConfiguration } = await import('../scripts/android-configuration-preflight.mjs');
  return inspectAndroidConfiguration(environment);
}

test('Android preflight reports every effective packaging gap once, without exposing values', async () => {
  const report = await inspect({});
  assert.equal(report.status, 'BLOCKED_REQUIRED_CONFIGURATION');
  assert.equal(report.blocking_names.length, 4);
  assert.equal(report.settings.length, 6);
  assert.equal(report.settings.filter(x => x.scope === 'legacy_bootstrap').length, 2);
  assert.equal(report.build_executed, false);
  assert.equal(report.environment_mutated, false);
});

test('Android preflight rejects secret-role keys and unexpected Beta targets', async () => {
  const privateMarker = 'SYNTHETIC_SECRET_MARKER_NEVER_A_REAL_CREDENTIAL';
  const report = await inspect({
    HEALTH_COMPANION_BETA_API_BASE_URL: 'https://different.invalid/functions/v1/mobile-health-beta',
    HEALTH_COMPANION_BETA_SUPABASE_URL: 'https://unexpected.supabase.co',
    HEALTH_COMPANION_BETA_SUPABASE_PUBLISHABLE_KEY: `sb_secret_${privateMarker}`,
    HEALTH_COMPANION_GOOGLE_WEB_CLIENT_ID: 'invalid',
  });
  assert.equal(report.blocking_names.length, 4);
  assert.equal(report.settings.find(x => x.name.endsWith('PUBLISHABLE_KEY')).status, 'FORBIDDEN_SECRET_KEY');
  assert.ok(!JSON.stringify(report).includes(privateMarker));
  const key = `e30.${Buffer.from(JSON.stringify({ role: 'service_role', marker: privateMarker })).toString('base64url')}.SYNTHETIC`;
  assert.equal((await inspect({ HEALTH_COMPANION_BETA_SUPABASE_PUBLISHABLE_KEY: key })).settings[2].status, 'FORBIDDEN_NON_PUBLIC_KEY');
  assert.equal((await inspect({ HEALTH_COMPANION_BETA_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' })).settings[2].status, 'INVALID_FORMAT');
});

test('Android preflight format fixtures cannot claim approved Beta provenance or readiness', async () => {
  // These are unit-only strings: never exported into a real Gradle environment.
  const input = {
    HEALTH_COMPANION_BETA_API_BASE_URL: 'https://uavimjgccigpbwqmfkhh.supabase.co/functions/v1/mobile-health-beta',
    HEALTH_COMPANION_BETA_SUPABASE_URL: 'https://uavimjgccigpbwqmfkhh.supabase.co',
    HEALTH_COMPANION_BETA_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_SYNTHETIC_UNIT_ONLY',
    HEALTH_COMPANION_GOOGLE_WEB_CLIENT_ID: 'SYNTHETIC_UNIT_ONLY.apps.googleusercontent.com',
  };
  const before = { ...input };
  const report = await inspect(input);
  assert.deepEqual(input, before);
  assert.equal(report.status, 'FORMAT_READY_PROVENANCE_REVIEW_REQUIRED');
  assert.equal(report.provenance_verified, false);
  assert.equal(report.remote_operations, 0);
  assert.ok(!JSON.stringify(report).includes('SYNTHETIC_UNIT_ONLY'));
});
