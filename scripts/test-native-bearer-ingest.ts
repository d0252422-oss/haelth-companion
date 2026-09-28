import assert from 'node:assert/strict';
import postgres from 'npm:postgres@3.4.8';
import { createDelegatedIngestion } from '../supabase/functions/mobile-health-beta/background-runtime.ts';
import { scopedWorkerSql } from '../supabase/functions/mobile-health-beta/worker-sql-context.ts';
import subjects from '../fixtures/engine-local-identities.json' with { type: 'json' };

const config = JSON.parse(await Deno.readTextFile(Deno.args[0]));
if (config.host !== '127.0.0.1' || config.port !== 57484 ||
    !/^health_engine_[a-f0-9]{32}$/.test(config.database)) throw Error('UNSAFE_TARGET');
const owner = postgres({ ...config, username: 'engine_owner', max: 1 });
const broker = postgres({ ...config, username: 'service_role', max: 1 });
const raw = postgres({ ...config, username: 'health_native_ingest', max: 1 });
const scoped = scopedWorkerSql(raw, 'health_native_ingest');
const ingest = createDelegatedIngestion(raw);
const report: { synthetic_only: true; gates: { name: string; status: string; error?: string }[] } =
  { synthetic_only: true, gates: [] };
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
const hash = async (value: string) => Array.from(new Uint8Array(
  await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
)).map((x) => x.toString(16).padStart(2, '0')).join('');
const token = { A: 'synthetic-valid-a-bearer', B: 'synthetic-valid-b-bearer' };
const authUser = (who: 'A' | 'B') => ({
  id: subjects[who].auth,
  email: `${who.toLowerCase()}@example.invalid`,
  app_metadata: { provider: 'google', providers: ['google'] },
  identities: [{ provider: 'google', id: `synthetic-google-${who}`, identity_data: { sub: `synthetic-google-${who}` } }],
});
let issued = 0;
const admin = {
  auth: { getUser: async (access: string) =>
    access === token.A || access === token.B
      ? { data: { user: authUser(access === token.A ? 'A' : 'B') }, error: null }
      : { data: { user: null }, error: { status: 401, message: 'invalid or expired' } } },
  rpc: async (name: string, args: { p_auth_user_id: string; p_capability_digest: string }) => {
    assert.equal(name, 'beta_issue_native_ingest_scope');
    issued++;
    try {
      const [row] = await broker`select public.beta_issue_native_ingest_scope(${args.p_auth_user_id}::uuid,${args.p_capability_digest}) as id`;
      return { data: row.id, error: null };
    } catch (e) {
      return { data: null, error: { message: String(e) } };
    }
  },
};
const mutation = (who: 'A' | 'B', source = 'native-steps') => ({
  canonical_user_id: subjects[who].canonical,
  platform: 'android', domain: 'steps', source_app: 'SYNTHETIC_HEALTH_CONNECT',
  source_record_id: source, source_revision: 1,
  source_content_hash: 'a'.repeat(64), idempotency_key: 'b'.repeat(64),
  operation: 'UPSERT', affected_local_dates: [day],
  record: {
    schema_version: 'hdl-v2.health-ingestion.v1',
    canonical_user_id: subjects[who].canonical,
    platform: 'android', domain: 'steps', source_app: 'SYNTHETIC_HEALTH_CONNECT',
    source_record_id: source, recorded_at: `${day}T00:00:00Z`,
    local_date: day, timezone: 'Asia/Taipei', value: 6000, unit: 'count',
  },
});
const body = (who: 'A' | 'B', source?: string) => ({
  environment: 'beta', canonical_user_id: subjects[who].canonical,
  mutations: [mutation(who, source)],
});
async function call(
  access: string | null, payload: unknown, appSession?: string,
  adminOverride: any = admin, path = '/v1/health/ingestion/batches',
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (access) headers.authorization = `Bearer ${access}`;
  if (appSession) headers['x-app-session-id'] = appSession;
  const response = await ingest.handle(new Request(`https://synthetic.invalid${path}`, {
    method: 'POST', headers, body: JSON.stringify(payload),
  }), adminOverride);
  return { status: response.status, data: await response.json() };
}
async function gate(name: string, work: () => Promise<void>) {
  try { await work(); report.gates.push({ name, status: 'PASS' }); }
  catch (e) { report.gates.push({ name, status: 'FAIL', error: String(e) }); }
}
try {
  await gate('native_bearer_without_app_session_persists_and_reads_back', async () => {
    const beforeSessions = Number((await owner`select count(*) as n from private.mobile_app_sessions`)[0].n);
    const response = await call(token.A, body('A'));
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(response.data.accepted_idempotency_keys.length, 1);
    assert.equal(Number((await owner`select count(*) as n from private.mobile_app_sessions`)[0].n), beforeSessions);
    assert.equal(Number((await owner`select count(*) as n from public.beta_health_records where canonical_user_id=${subjects.A.canonical}`)[0].n), 1);
    assert.equal(Number((await owner`select count(*) as n from private.beta_native_ingest_scopes where consumed_at is not null`)[0].n), 1);
  });
  await gate('retry_duplicate_is_idempotent', async () => {
    const response = await call(token.A, body('A'));
    assert.equal(response.status, 200);
    assert.equal(response.data.duplicate_idempotency_keys.length, 1);
    assert.equal(Number((await owner`select count(*) as n from public.beta_health_records where canonical_user_id=${subjects.A.canonical}`)[0].n), 1);
  });
  await gate('missing_invalid_expired_bearer_deny_before_scope', async () => {
    const previous = issued;
    assert.equal((await call(null, body('A'))).status, 401);
    assert.equal((await call('synthetic-invalid-bearer', body('A'))).status, 401);
    assert.equal((await call('synthetic-expired-bearer', body('A'))).status, 401);
    assert.equal(issued, previous);
  });
  await gate('forged_user_and_malformed_payload_deny', async () => {
    assert.equal((await call(token.A, body('B'))).status, 403);
    assert.equal((await call(token.A, { environment: 'beta', canonical_user_id: subjects.A.canonical, mutations: 'bad' })).status, 400);
    assert.equal(Number((await owner`select count(*) as n from public.beta_health_records where canonical_user_id=${subjects.B.canonical}`)[0].n), 0);
  });
  await gate('native_connector_status_uses_same_owner_scope', async () => {
    const status = {
      canonical_user_id: subjects.A.canonical, platform: 'android',
      connector_type: 'android_helper', connector_version: 'synthetic-test',
      last_result: 'SYNCED_RECENT', available_domains: ['steps'],
      permission_state_if_known: 'GRANTED',
    };
    const path = '/v1/mobile/connectors/status';
    assert.equal((await call(token.A, status, undefined, admin, path)).status, 200);
    assert.equal((await call(token.A, { ...status, canonical_user_id: subjects.B.canonical }, undefined, admin, path)).status, 403);
    assert.equal((await call(token.A, { ...status, platform: 'ios' }, undefined, admin, path)).status, 403);
    const rows = await owner`select platform from public.beta_connector_status where canonical_user_id=${subjects.A.canonical}`;
    assert.deepEqual(rows.map((row) => row.platform), ['android']);
  });
  await gate('role_cannot_see_scope_or_issue_or_forge_guc', async () => {
    await assert.rejects(() => raw`select * from private.beta_native_ingest_scopes`);
    await assert.rejects(() => raw`select public.beta_issue_native_ingest_scope(${subjects.A.auth}::uuid,${'c'.repeat(64)})`);
    await assert.rejects(() => scoped.withSession({ kind: 'native', session: '', digest: 'd'.repeat(64) }, () => scoped`select 1`));
    const [flags] = await owner`select rolsuper,rolbypassrls,rolinherit,rolcreatedb,rolcreaterole from pg_roles where rolname='health_native_ingest'`;
    assert.ok(Object.values(flags).every((value) => value === false));
  });
  await gate('native_scope_is_owner_bound_expires_and_cannot_replay', async () => {
    const digest = await hash(crypto.randomUUID());
    await broker`select public.beta_issue_native_ingest_scope(${subjects.A.auth}::uuid,${digest})`;
    await scoped.withSession({ kind: 'native', session: '', digest }, async () => {
      assert.equal((await scoped`select private.delegated_worker_user() as id`)[0].id, subjects.A.canonical);
      assert.equal((await scoped`select private.delegated_worker_platform() as platform`)[0].platform, 'android');
      assert.equal((await scoped`select * from public.beta_health_records where canonical_user_id=${subjects.B.canonical}`).length, 0);
      await assert.rejects(() => scoped`select public.beta_ingest_health_mutation_batch(${subjects.B.canonical},${scoped.json([mutation('B')])})`);
    });
    await owner`update private.beta_native_ingest_scopes set expires_at=now()-interval '1 second' where capability_digest=${digest}`;
    await assert.rejects(() => scoped.withSession({ kind: 'native', session: '', digest }, () => scoped`select 1`));
    const consumed = (await owner`select capability_digest from private.beta_native_ingest_scopes where consumed_at is not null limit 1`)[0].capability_digest;
    await assert.rejects(() => scoped.withSession({ kind: 'native', session: '', digest: consumed }, () => scoped`select 1`));
  });
  await gate('legacy_app_session_contract_unchanged', async () => {
    const id = crypto.randomUUID(), access = 'synthetic-legacy-app-session';
    await owner`insert into private.mobile_app_sessions(id,canonical_user_id,platform,installation_key_fingerprint,installation_public_key_spki,access_token_digest,refresh_token_digest,access_expires_at,refresh_expires_at)
      values(${id},${subjects.A.canonical},'android',${await hash('legacy-install')},${new Uint8Array(64)},${await hash(access)},${await hash('legacy-refresh')},now()+interval '15 minutes',now()+interval '1 day')`;
    const response = await call(access, body('A', 'legacy-steps'), id, null);
    assert.equal(response.status, 200, JSON.stringify(response));
  });
  await gate('native_link_revocation_and_account_deletion_invalidate_scopes', async () => {
    const revokedDigest = await hash(crypto.randomUUID());
    await broker`select public.beta_issue_native_ingest_scope(${subjects.B.auth}::uuid,${revokedDigest})`;
    await owner`delete from private.beta_native_auth_identities where auth_user_id=${subjects.B.auth}`;
    await assert.rejects(() => scoped.withSession(
      { kind: 'native', session: '', digest: revokedDigest }, () => scoped`select 1`,
    ));
    await owner`insert into private.beta_native_auth_identities(auth_user_id,canonical_user_id,provider)
      values(${subjects.B.auth},${subjects.B.canonical},'google')`;
    for (const deleted of ['auth', 'canonical'] as const) {
      const authId = crypto.randomUUID(), canonicalId = crypto.randomUUID();
      await owner`insert into auth.users(id,email,email_confirmed_at)
        values(${authId},${`${deleted}@example.invalid`},now())`;
      await owner`insert into public.users(id,external_subject_hash,timezone)
        values(${canonicalId},${await hash(deleted)},'Asia/Taipei')`;
      await owner`insert into private.beta_native_auth_identities(auth_user_id,canonical_user_id,provider)
        values(${authId},${canonicalId},'google')`;
      const digest = await hash(crypto.randomUUID());
      await broker`select public.beta_issue_native_ingest_scope(${authId}::uuid,${digest})`;
      await scoped.withSession({ kind: 'native', session: '', digest }, () => scoped.begin(async (tx: any) => {
        const [used] = await tx`select private.consume_native_ingest_scope() as ok`;
        assert.equal(used.ok, true);
      }));
      if (deleted === 'auth') await owner`delete from auth.users where id=${authId}`;
      else await owner`delete from public.users where id=${canonicalId}`;
      assert.equal(Number((await owner`select count(*) as n from private.beta_native_ingest_scopes where capability_digest=${digest}`)[0].n), 0);
    }
  });
  await gate('android_request_contract_remains_bearer_only', async () => {
    const client = await Deno.readTextFile('android-helper/app/src/main/java/app/healthcompanion/sync/IngestionClient.kt');
    const session = await Deno.readTextFile('android-helper/app/src/main/java/app/healthcompanion/sync/SessionStore.kt');
    assert.match(client, /header\(HttpHeaders\.Authorization, "Bearer \$\{session\.accessToken\}"\)/);
    assert.match(client, /session\.legacySessionId\?\.let \{ header\("X-App-Session-Id", it\) \}/);
    assert.match(session, /override val legacySessionId: String\? = null/);
  });
} finally {
  await Deno.writeTextFile(Deno.args[1], JSON.stringify(report, null, 2));
  await Promise.all([owner.end(), broker.end(), raw.end()]);
}
console.log(JSON.stringify({ passed: report.gates.filter((g) => g.status === 'PASS').length,
  failed: report.gates.filter((g) => g.status === 'FAIL').map((g) => g.name) }));
if (report.gates.some((g) => g.status === 'FAIL')) Deno.exit(1);
