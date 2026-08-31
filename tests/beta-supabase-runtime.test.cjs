'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const endpoint = 'https://uavimjgccigpbwqmfkhh.supabase.co/functions/v1/mobile-health-beta';

test('beta Supabase target is explicit and distinct from production', () => {
  const guard = read('scripts/assert-beta-supabase-target.ps1');
  const tester = JSON.parse(read('config/tester-access.environments.json'));
  const shortcut = JSON.parse(read('config/ios-shortcut-tester.manifest.json'));
  assert.equal(tester.beta.BETA_INGESTION_BASE_URL, endpoint);
  assert.equal(shortcut.ingestion_base_url, endpoint);
  assert.match(guard, /TargetProjectRef -ne \$BetaProjectRef/u);
  assert.match(guard, /TargetProjectRef -eq \$ProductionProjectRef/u);
  assert.doesNotMatch(endpoint, /vptqedxdxfoohbqctujf/u);
});

test('beta schema is RLS protected and service-role-only', () => {
  const foundation = read('supabase/migrations/20260827010000_beta_minimum_canonical_schema.sql');
  const bootstrap = read('supabase/migrations/20260827015836_mobile_health_helper_bootstrap.sql');
  const rpc = read('supabase/migrations/20260829082547_beta_ingestion_rpc.sql');
  for (const table of ['users', 'beta_health_records', 'beta_connector_status']) {
    assert.match(foundation, new RegExp(`alter table public\\.${table} enable row level security`, 'u'));
    assert.match(foundation, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, 'u'));
  }
  assert.match(bootstrap, /revoke all on schema private from public, anon, authenticated/u);
  assert.match(rpc, /security definer[\s\S]*set search_path = ''/u);
  assert.match(rpc, /revoke all on function public\.beta_ingest_health_mutation[\s\S]*from public, anon, authenticated/u);
  const shortcutSession = read('supabase/migrations/20260829090000_beta_ios_shortcut_session.sql');
  assert.match(shortcutSession, /alter table private\.beta_shortcut_sessions enable row level security/u);
  assert.match(shortcutSession, /revoke all on table private\.beta_shortcut_sessions from public, anon, authenticated/u);
  assert.match(shortcutSession, /claim\.platform <> 'ios'/u);
  assert.match(shortcutSession, /claim\.consumed_at is not null then raise exception 'REPLAYED_CLAIM'/u);
});

test('custom Edge authentication fails closed without exposing secrets', () => {
  const source = read('supabase/functions/mobile-health-beta/index.ts');
  const config = read('supabase/config.toml');
  assert.match(config, /\[functions\.mobile-health-beta\][\s\S]*verify_jwt = false/u);
  assert.match(source, /verifyWebSession\(bearer\(request\)\)/u);
  assert.match(source, /authorizeSession\(request, admin\)/u);
  assert.match(source, /beta_rotate_app_session/u);
  assert.match(source, /beta_revoke_app_session/u);
  assert.match(source, /authorizeShortcutSession\(request, admin\)/u);
  assert.match(source, /beta_exchange_shortcut_claim/u);
  assert.match(source, /CROSS_USER_UPLOAD/u);
  assert.match(source, /WRONG_ENVIRONMENT/u);
  assert.doesNotMatch(source, /console\.(?:log|debug|info)\(/u);
  assert.doesNotMatch(source, /service_role|SUPABASE_SERVICE_ROLE_KEY/u);
  assert.doesNotMatch(source, /vptqedxdxfoohbqctujf/u);
});

test('Android V2 claim is installation-bound and session lifecycle stays server-only', () => {
  const source = read('supabase/functions/mobile-health-beta/index.ts');
  const migration = read('supabase/migrations/20260830141842_android_connector_v2_sessions.sql');
  assert.match(source, /bindingMethod === "VERIFIED_APP_LINK"/u);
  assert.match(source, /p_installation_key_fingerprint: fingerprint/u);
  assert.match(migration, /INSTALLATION_KEY_MISMATCH/u);
  assert.match(migration, /beta_rotate_app_session/u);
  assert.match(migration, /beta_revoke_app_session/u);
  assert.match(migration, /revoke all on function public\.beta_rotate_app_session/u);
  assert.doesNotMatch(`${source}\n${migration}`, /console\.(?:log|debug|info)|service_role key/iu);
});

test('native Android auth verifies Google-backed Supabase JWT and links canonical identity server-side', () => {
  const source = read('supabase/functions/mobile-health-beta/index.ts');
  const migration = read('supabase/migrations/20260831000913_android_native_auth_identity_link.sql');
  assert.match(source, /admin\.auth\.getUser\(token\)/u);
  assert.match(source, /providers\.has\("google"\)/u);
  assert.match(source, /ACCOUNT_IDENTITY_MISMATCH/u);
  assert.match(source, /nativeUser\.auth_email !== webIdentity\.email/u);
  assert.match(source, /beta_link_native_auth_identity/u);
  assert.match(source, /beta_resolve_native_auth_identity/u);
  assert.match(migration, /auth_user_id uuid primary key references auth\.users\(id\)/u);
  assert.match(migration, /canonical_user_id uuid not null unique/u);
  assert.match(migration, /revoke all on table private\.beta_native_auth_identities from public, anon, authenticated/u);
  assert.match(migration, /to service_role/u);
  assert.doesNotMatch(`${source}\n${migration}`, /console\.(?:log|debug|info)|service[_-]?role key/iu);
});

test('iOS Shortcut uses its canonical envelope and a scoped revocable session', () => {
  const source = read('supabase/functions/mobile-health-beta/index.ts');
  const manifest = JSON.parse(read('config/ios-shortcut-tester.manifest.json'));
  assert.equal(manifest.session_exchange_path, '/v1/connectors/ios-shortcut/session');
  assert.equal(manifest.ingestion_path, '/v1/connectors/ios-shortcut/ingest');
  assert.match(source, /body\.schema_version !== "hdl-v2\.connector-ingestion\.v1"/u);
  assert.match(source, /body\.provider !== "apple_health"/u);
  assert.match(source, /body\.connector_type !== "ios_shortcut"/u);
  assert.match(source, /x-shortcut-session-id/u);
  assert.match(source, /source_record_id_kind: nativeId \? "NATIVE" : "DERIVED_FINGERPRINT"/u);
});

test('Edge dependencies are pinned and Android build embeds only public beta URL', () => {
  const deno = JSON.parse(read('supabase/functions/mobile-health-beta/deno.json'));
  const workflow = read('.github/workflows/android-beta-apk.yml');
  assert.equal(deno.imports['@supabase/server'], 'npm:@supabase/server@1.4.1');
  assert.equal(deno.imports['@supabase/functions-js'], 'jsr:@supabase/functions-js@2.112.4');
  assert.match(workflow, new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
  assert.doesNotMatch(workflow, /service[_-]?role|secret[_-]?key|access[_-]?token/iu);
});

test('canonical beta migrations preserve replay, update, stale and delete reconciliation', () => {
  const source = read('supabase/migrations/20260827023849_health_source_record_reconciliation.sql');
  const rpc = read('supabase/migrations/20260829082547_beta_ingestion_rpc.sql');
  for (const action of ['REPLAYED', 'UPDATED', 'DELETED', 'STALE_REJECTED', 'CONFLICT_REJECTED']) {
    assert.match(source, new RegExp(action, 'u'));
  }
  assert.match(rpc, /selected_action in \('CREATED', 'UPDATED'\)/u);
  assert.match(rpc, /selected_action = 'DELETED'/u);
  assert.match(rpc, /on conflict \(canonical_user_id, platform, domain, source_app, source_record_id\)/u);
});
