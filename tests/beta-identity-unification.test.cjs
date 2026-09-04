'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const read = (path) => fs.readFileSync(path, 'utf8');
const edge = read('supabase/functions/mobile-health-beta/index.ts');
const sql = read('supabase/migrations/20260903130618_unify_beta_web_native_identity.sql');

test('Web and native Google identities converge through one server resolver', () => {
  assert.match(edge, /verifyWebIdentity\(bearer\(request\)\)/u);
  assert.match(edge, /beta_resolve_web_canonical_identity/u);
  assert.match(edge, /beta_link_native_auth_identity_v2/u);
  assert.match(sql, /join auth\.users au on au\.id = i\.auth_user_id/u);
  assert.match(sql, /au\.email_confirmed_at is not null/u);
  assert.match(sql, /private\.beta_native_auth_identities/u);
});

test('the browser cannot select a canonical user or spoof an unverified email', () => {
  assert.doesNotMatch(edge, /request.*canonical_user_id|body.*verified_email/iu);
  assert.match(edge, /const verified = await verifyWebIdentity/u);
  assert.match(sql, /INVALID_VERIFIED_WEB_IDENTITY/u);
  assert.match(sql, /INVALID_NATIVE_IDENTITY/u);
});

test('legacy aliasing preserves the native data owner and does not rewrite evidence', () => {
  assert.match(sql, /selected_canonical := coalesce\(native_candidates\[1\], p_candidate_canonical_user_id\)/u);
  assert.match(sql, /insert into private\.beta_web_identity_aliases/u);
  assert.doesNotMatch(sql, /update\s+public\.beta_health_records|delete\s+from\s+public\.users/iu);
});

test('different accounts remain isolated and ambiguous identity fails closed', () => {
  assert.match(sql, /verified_email_hash text not null unique/u);
  assert.match(sql, /AMBIGUOUS_VERIFIED_IDENTITY/u);
  assert.match(sql, /WEB_IDENTITY_CONFLICT/u);
  assert.match(sql, /canonical_user_id uuid not null references public\.users\(id\) on delete restrict/u);
});

test('identity mappings are private and callable only by the trusted runtime', () => {
  assert.match(sql, /alter table private\.beta_web_identity_aliases enable row level security/u);
  assert.match(sql, /revoke all on table private\.beta_web_identity_aliases from public, anon, authenticated/u);
  assert.match(sql, /security definer[\s\S]*set search_path = ''/u);
  assert.match(sql, /revoke all on function public\.beta_resolve_web_canonical_identity[\s\S]*from public, anon, authenticated/u);
  assert.match(sql, /to service_role/u);
});

test('all Web read routes and claim issuance use the shared canonical resolver', () => {
  const uses = edge.match(/resolveCanonicalWebIdentity\(request, admin\)/gu) ?? [];
  assert.equal(uses.length, 4);
  assert.doesNotMatch(edge, /verifyWebSession/u);
});
