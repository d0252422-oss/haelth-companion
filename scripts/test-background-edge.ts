import assert from "node:assert/strict";
import postgres from "npm:postgres@3.4.8";
import { scopedWorkerSql } from "../supabase/functions/mobile-health-beta/worker-sql-context.ts";
import subjects from "../fixtures/engine-local-identities.json" with {
  type: "json",
};
const config = JSON.parse(await Deno.readTextFile(Deno.args[0])),
  out = Deno.args[1];
if (
  config.host !== "127.0.0.1" || config.port !== 57485 ||
  !/^health_engine_[a-f0-9]{32}$/.test(config.database)
) throw Error("UNSAFE_TARGET");
const admin = postgres({ ...config, username: "engine_owner", max: 1 }),
  raw = postgres({ ...config, username: "health_native_ingest", max: 1 }),
  sql = scopedWorkerSql(raw, "health_native_ingest");
const systemRaw = postgres({
    ...config,
    username: "health_recompute_worker",
    max: 1,
  }),
  system = scopedWorkerSql(systemRaw, "health_recompute_worker");
const report: any = {
  started: new Date().toISOString(),
  actual_edge: true,
  synthetic_only: true,
  gates: [],
};
const ids: any = {}, tokens: any = {}, contexts: any = {};
const sha = async (s: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  ).map((x) => x.toString(16).padStart(2, "0")).join("");
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" })
  .format(new Date());
async function gate(name: string, work: () => Promise<void>) {
  try {
    await work();
    report.gates.push({ name, status: "PASS" });
  } catch (e) {
    report.gates.push({ name, status: "FAIL", error: String(e) });
  }
}
async function call(user: string, path: string, body: any, extra: any = {}) {
  const res = await fetch(config.base + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-app-session-id": ids[user] || "",
      authorization: "Bearer " + (tokens[user] || "invalid-token-value"),
      ...extra,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  return {
    http: res.status,
    content_type: res.headers.get("content-type"),
    ...await res.json(),
  };
}
function mutation(user: "A" | "B", domain: string, revision = 1) {
  const value = {
    steps: 6000,
    sleep: 420,
    weight: 75,
    workout: 30,
    heart_rate: 65,
  }[domain] ?? 0;
  return {
    canonical_user_id: subjects[user].canonical,
    platform: "android",
    domain,
    source_app: "SYNTHETIC_HEALTH_CONNECT",
    source_record_id: "synthetic-" + domain,
    source_revision: revision,
    source_content_hash: String(revision).repeat(64),
    idempotency_key: (domain.charCodeAt(0) % 10).toString().repeat(64),
    operation: "UPSERT",
    affected_local_dates: [date],
    record: {
      schema_version: "hdl-v2.health-ingestion.v1",
      canonical_user_id: subjects[user].canonical,
      platform: "android",
      domain,
      value,
      recorded_at: date + "T00:00:00Z",
      local_date: date,
      timezone: "Asia/Taipei",
    },
  };
}
const units: Record<string, string> = {
  steps: "count",
  sleep: "min",
  weight: "kg",
  workout: "min",
  heart_rate: "bpm",
};
const batch = (user: "A" | "B", mutations: any[]) => ({
  environment: "beta",
  canonical_user_id: subjects[user].canonical,
  mutations: mutations.map((m) => ({
    ...m,
    idempotency_key: String(Object.keys(units).indexOf(m.domain) + 1).repeat(
      64,
    ),
    record: m.record ? { ...m.record, unit: units[m.domain] } : null,
  })),
});
const ingest = "/v1/health/ingestion/batches";
try {
  for (const u of ["A", "B"]) {
    ids[u] = crypto.randomUUID();
    tokens[u] = crypto.randomUUID() + crypto.randomUUID();
    const digest = await sha(tokens[u]);
    contexts[u] = { kind: "app", session: ids[u], digest };
    await admin`insert into private.mobile_app_sessions(id,canonical_user_id,platform,installation_key_fingerprint,installation_public_key_spki,access_token_digest,refresh_token_digest,access_expires_at,refresh_expires_at) values(${
      ids[u]
    },${subjects[u as "A"].canonical},'android',${await sha(
      u,
    )},${new Uint8Array(64)},${digest},${await sha(
      "refresh-" + u,
    )},now()+interval '15 minutes',now()+interval '1 day')`;
  }
  await gate("role_flags_and_no_privileged_memberships", async () => {
    report.roles =
      await admin`select rolname,rolsuper,rolbypassrls,rolinherit,rolcreatedb,rolcreaterole,rolreplication from pg_roles where rolname in ('health_native_ingest','health_recompute_worker')`;
    for (const r of report.roles) {
      for (
        const k of [
          "rolsuper",
          "rolbypassrls",
          "rolinherit",
          "rolcreatedb",
          "rolcreaterole",
          "rolreplication",
        ]
      ) assert.equal(r[k], false);
    }
    await assert.rejects(() => raw.unsafe("set role service_role"));
    await assert.rejects(() =>
      systemRaw`update public.beta_health_records set source_revision=100`
    );
  });
  await gate(
    "actual_Edge_five_native_domains_idempotency_and_newer_revision",
    async () => {
      const payload = batch(
        "A",
        ["steps", "sleep", "weight", "workout", "heart_rate"].map((d) =>
          mutation("A", d)
        ),
      );
      assert.equal((await call("A", ingest, payload)).http, 200);
      assert.equal(
        (await call("A", ingest, payload)).duplicate_idempotency_keys.length,
        5,
      );
      assert.equal(
        (await call("A", ingest, batch("A", [mutation("A", "steps", 2)]))).http,
        200,
      );
      const stale = await call(
        "A",
        ingest,
        batch("A", [mutation("A", "steps")]),
      );
      assert.equal(stale.rejected[0].error_code, "STALE_REJECTED");
      assert.equal(
        Number(
          (await admin`select source_revision from public.beta_health_records where canonical_user_id=${subjects.A.canonical} and domain='steps'`)[
            0
          ].source_revision,
        ),
        2,
      );
    },
  );
  await gate("existing_Android_status_payload_and_JSON_contract", async () => {
    const payload = {
      canonical_user_id: subjects.A.canonical,
      platform: "android",
      connector_type: "android_helper",
      connector_version: "synthetic-test",
      last_attempt_at: new Date().toISOString(),
      last_success_at: null,
      last_result: "SYNCED_RECENT",
      available_domains: ["steps"],
      permission_state_if_known: "GRANTED",
    };
    const ok = await call("A", "/v1/mobile/connectors/status", payload);
    assert.equal(ok.http, 200, JSON.stringify(ok));
    assert.match(ok.content_type, /application\/json/);
    assert.equal(ok.score_recompute, "QUEUED");
    assert.equal(
      (await call("A", "/v1/mobile/connectors/status", {
        ...payload,
        last_result: "FAILED",
      })).score_recompute,
      "NOT_QUEUED",
    );
    assert.equal(
      (await call("A", "/v1/mobile/connectors/status", {
        ...payload,
        environment: "production",
      })).http,
      400,
    );
    const [stored] =
      await admin`select last_success_at from public.beta_connector_status where canonical_user_id=${subjects.A.canonical} and platform='android'`;
    assert.ok(stored.last_success_at);
  });
  await gate("A_B_forgery_missing_expired_revoked_fail_closed", async () => {
    assert.equal(
      (await call("A", ingest, batch("B", [mutation("B", "steps")]))).http,
      403,
    );
    assert.equal((await call("none", ingest, batch("A", []))).http, 401);
    await sql.withSession(
      contexts.B,
      async () =>
        assert.equal(
          (await sql`select * from public.beta_health_records`).length,
          0,
        ),
    );
    assert.equal(
      (await sql`select * from public.beta_health_records`).length,
      0,
    );
    await admin`update private.mobile_app_sessions set access_expires_at=now()-interval '1 second' where id=${ids.A}`;
    assert.equal((await call("A", ingest, batch("A", []))).http, 401);
    await admin`update private.mobile_app_sessions set access_expires_at=now()+interval '15 minutes',revoked_at=now() where id=${ids.A}`;
    assert.equal((await call("A", ingest, batch("A", []))).http, 401);
    await admin`update private.mobile_app_sessions set revoked_at=null where id=${ids.A}`;
  });
  await gate("pool_reuse_A_B_failed_transaction_and_anonymous", async () => {
    for (const u of ["A", "B", "B", "A"]) {
      await sql.withSession(
        contexts[u],
        async () =>
          assert.equal(
            (await sql`select private.delegated_worker_user() as id`)[0].id,
            subjects[u as "A"].canonical,
          ),
      );
      assert.equal(
        (await sql`select private.delegated_worker_user() as id`)[0].id,
        null,
      );
    }
    await assert.rejects(() =>
      sql.withSession(contexts.A, () =>
        sql.begin(async () => {
          throw Error("SYNTHETIC_ROLLBACK");
        }))
    );
    assert.equal(
      (await sql`select * from public.beta_health_records`).length,
      0,
    );
  });
  await gate(
    "same_user_concurrent_retry_and_atomic_cross_platform_rejection",
    async () => {
      const p = batch("B", [mutation("B", "steps")]);
      const both = await Promise.all([
        call("B", ingest, p),
        call("B", ingest, p),
      ]);
      assert.ok(both.every((r) => r.http === 200));
      assert.equal(
        both.reduce((n, r) => n + r.accepted_idempotency_keys.length, 0),
        1,
      );
      const bad = { ...mutation("A", "weight", 2), platform: "ios" };
      assert.equal(
        (await call("A", ingest, batch("A", [mutation("A", "steps", 3), bad])))
          .http,
        403,
      );
      assert.equal(
        Number(
          (await admin`select source_revision from public.beta_health_records where canonical_user_id=${subjects.A.canonical} and domain='steps'`)[
            0
          ].source_revision,
        ),
        2,
      );
    },
  );
  await gate("bounded_lock_timeout_retry_and_checkpoint_resume", async () => {
    let locked!: () => void, release!: () => void;
    const barrier = new Promise<void>((r) => locked = r),
      resume = new Promise<void>((r) => release = r);
    const holder = admin.begin(async (tx: any) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${subjects.A.canonical},0))`;
      locked();
      await resume;
    });
    await barrier;
    const started = performance.now();
    let response: any;
    try {
      response = await call(
        "A",
        ingest,
        batch("A", [mutation("A", "steps", 3)]),
      );
    } finally {
      release();
      await holder;
    }
    report.lock_timeout_ms = performance.now() - started;
    assert.equal(response.http, 503);
    assert.equal(response.error, "DB_TIMEOUT_RETRYABLE");
    assert.equal(
      Number(
        (await admin`select source_revision from public.beta_health_records where canonical_user_id=${subjects.A.canonical} and domain='steps'`)[
          0
        ].source_revision,
      ),
      2,
    );
    assert.equal(
      (await call("A", ingest, batch("A", [mutation("A", "steps", 3)]))).http,
      200,
    );
    assert.equal(
      (await call("A", ingest, batch("A", [mutation("A", "steps", 3)])))
        .duplicate_idempotency_keys.length,
      1,
    );
  });
  await gate("credential_rotation_and_cross_tenant_SQL_denials", async () => {
    await admin`update private.mobile_app_sessions set access_token_digest=${await sha(
      "rotated-synthetic-grant",
    )} where id=${ids.A}`;
    assert.equal((await call("A", ingest, batch("A", []))).http, 401);
    await admin`update private.mobile_app_sessions set access_token_digest=${contexts.A.digest} where id=${ids.A}`;
    await assert.rejects(() =>
      sql.withSession(
        contexts.A,
        () =>
          sql`select public.beta_ingest_health_mutation_batch(${subjects.B.canonical},${
            sql.json(batch("B", [mutation("B", "steps", 2)]).mutations)
          })`,
      )
    );
    assert.equal((await call("A", ingest, batch("A", []))).http, 200);
  });
  await gate("lease_scope_expiry_and_retry_context", async () => {
    const token = crypto.randomUUID(),
      jobs =
        await system`select * from public.beta_claim_score_recompute(${token},${subjects.A.canonical},1)`;
    assert.equal(jobs.length, 1);
    const scope = {
      canonical_user_id: subjects.A.canonical,
      score_date: date,
      generation: String(jobs[0].generation),
      token,
    };
    await system.withJob(scope, async () => {
      assert.ok(
        (await system`select * from public.beta_health_records`).length > 0,
      );
      assert.equal(
        (await system`select * from public.beta_health_records where canonical_user_id=${subjects.B.canonical}`)
          .length,
        0,
      );
    });
    await admin`update private.beta_score_recompute_queue set lease_expires_at=now()-interval '1 second' where canonical_user_id=${subjects.A.canonical} and score_date=${date}`;
    await assert.rejects(() =>
      system.withJob(
        scope,
        () => system`select * from public.beta_health_records`,
      )
    );
    const next = crypto.randomUUID();
    assert.equal(
      (await system`select * from public.beta_claim_score_recompute(${next},${subjects.A.canonical},1)`)
        .length,
      1,
    );
    await assert.rejects(() =>
      system.withJob(
        scope,
        () => system`select * from public.beta_health_records`,
      )
    );
    await system`select public.beta_fail_score_recompute(${subjects.A.canonical},${date}::date,${scope.generation},${next},'SYNTHETIC_RETRY',true)`;
    await admin`update private.beta_score_recompute_queue set next_attempt_at=now() where canonical_user_id=${subjects.A.canonical} and score_date=${date}`;
  });
  await gate(
    "system_lease_scope_no_raw_access_and_actual_recompute",
    async () => {
      assert.equal(
        (await system`select * from public.beta_health_records`).length,
        0,
      );
      await assert.rejects(() =>
        system.withJob({
          canonical_user_id: subjects.B.canonical,
          score_date: date,
          generation: 1,
          token: crypto.randomUUID(),
        }, () => system`select * from public.beta_health_records`)
      );
      assert.equal(
        (await call("none", "/internal/score-recompute/drain", { limit: 1 }))
          .http,
        401,
      );
      const r = await call("none", "/internal/score-recompute/drain", {
        limit: 5,
      }, { "x-score-worker-secret": config.triggerSecret });
      assert.equal(r.http, 200, JSON.stringify(r));
      assert.ok(r.completed >= 2, JSON.stringify(r));
      assert.equal(r.failed, 0, JSON.stringify(r));
      report.recompute = r;
    },
  );
} finally {
  await raw.end();
  await systemRaw.end();
  await admin.end();
  report.ended = new Date().toISOString();
  report.status = report.gates.every((g: any) => g.status === "PASS")
    ? "PASS"
    : "FAIL";
  await Deno.writeTextFile(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (report.status !== "PASS") Deno.exitCode = 1;
}
