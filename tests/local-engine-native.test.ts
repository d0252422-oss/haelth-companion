import assert from "node:assert/strict";
import postgres from "npm:postgres@3.4.8";
import {
  LocalEngineRuntime,
  pgAdmin,
} from "../supabase/functions/mobile-health-beta/local-engine-runtime.ts";
import { createSyntheticAuthority } from "../scripts/local-engine-auth.ts";
import subjects from "../fixtures/engine-local-identities.json" with {
  type: "json",
};
const config = JSON.parse(
  await Deno.readTextFile(Deno.env.get("LOCAL_ENGINE_TEST_CONFIG")!),
);
if (
  config.host !== "127.0.0.1" || config.port !== 57484 ||
  !config.database.startsWith("health_engine_")
) throw Error("UNSAFE_TEST_DATABASE");
const day = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const shift = (date: string, n: number) =>
  new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);
const meal = (extra: Record<string, unknown> = {}) => ({
  clientRequestId: crypto.randomUUID(),
  date: day,
  time: "23:59",
  mealType: "午餐",
  foodName: "Synthetic fixture",
  userConfirmed: true,
  labelMode: true,
  weightGrams: 100,
  referenceSource: "synthetic arithmetic v1",
  calories: 200,
  protein: 10,
  carbs: 20,
  fat: 5,
  ...extra,
});
const request = (token: string) =>
  new Request("http://127.0.0.1/v1/engine/web", {
    headers: { authorization: "Bearer " + token },
  });
async function context() {
  const authority = await createSyntheticAuthority(),
    runtime = new LocalEngineRuntime(config, authority.verify);
  await runtime.start();
  const a = await runtime.identity(request(await authority.issue("A"))),
    b = await runtime.identity(request(await authority.issue("B")));
  return { authority, runtime, a, b };
}

Deno.test("real signed identity / expiry / forged identity / low-privilege RLS", async () => {
  const { authority, runtime, a, b } = await context();
  const owner = postgres({ ...config, username: "engine_owner", max: 1 });
  try {
    assert.notEqual(a.auth, a.canonical);
    assert.equal(a.canonical, subjects.A.canonical);
    for (
      const token of [
        "broken.token.signature",
        await authority.issue("A", true),
        await authority.issue("MISSING"),
      ]
    ) await assert.rejects(() => runtime.identity(request(token)));
    await assert.rejects(() =>
      runtime.mutate(a, meal({ user_id: b.canonical }))
    );
    const saved = await runtime.mutate(a, meal());
    await runtime.drain(a.canonical);
    assert.equal((await runtime.snapshot(b)).meals.length, 0);
    await assert.rejects(() =>
      runtime.mutate(b, meal({ mealRecordId: saved.recordId, revision: 1 }))
    );
    const roles =
      await owner`select rolname,rolsuper,rolbypassrls from pg_roles where rolname in ('service_role','authenticated','anon')`;
    assert.equal(
      roles.find((r: any) => r.rolname === "authenticated")!.rolbypassrls,
      false,
    );
    const protectedCount = await owner.begin(async (tx: any) => {
      await tx.unsafe("set local role authenticated");
      await tx`select set_config('request.jwt.claim.sub',${a.auth},true)`;
      return {
        role: (await tx`select current_user`)[0].current_user,
        own:
          (await tx`select * from engine_meals where canonical_user_id=${a.canonical}`)
            .length,
        other:
          (await tx`select * from engine_meals where canonical_user_id=${b.canonical}`)
            .length,
      };
    });
    assert.equal(protectedCount.role, "authenticated");
    assert.ok(protectedCount.own > 0);
    assert.equal(protectedCount.other, 0);
    await assert.rejects(() =>
      owner.begin(async (tx: any) => {
        await tx.unsafe("set local role anon");
        await tx`select * from engine_output_history`;
      })
    );
    await assert.rejects(() =>
      owner.begin(async (tx: any) => {
        await tx.unsafe("set local role authenticated");
        await tx`select set_config('request.jwt.claim.sub',${a.auth},true)`;
        await tx`update engine_meals set deleted=true where canonical_user_id=${a.canonical}`;
      })
    );
    const grants =
      await owner`select has_function_privilege('anon','public.beta_resolve_native_auth_identity(uuid)','EXECUTE') as anon_rpc,has_function_privilege('authenticated','private.engine_current_canonical_user()','EXECUTE') as mapped_read`;
    assert.equal(grants[0].anon_rpc, false);
    assert.equal(grants[0].mapped_read, true);
    await Deno.writeTextFile(
      (Deno.env.get('LOCAL_ENGINE_NATIVE_EVIDENCE_DIR')||'.engine-artifacts/blocker-closure')+'/rls.json',
      JSON.stringify({ roles, protectedCount, grants }, null, 2),
    );
    await runtime.mutate(a, {
      mealRecordId: saved.recordId,
      revision: 1,
      clientRequestId: crypto.randomUUID(),
    }, true);
    await runtime.drain(a.canonical);
  } finally {
    await runtime.close();
    await owner.end();
  }
});

Deno.test("concurrent replay, stale revision, moved dates and tombstone reconciliation", async () => {
  const { runtime, a } = await context();
  try {
    const input = meal({ date: shift(day, -2) });
    const writes = await Promise.all([
      runtime.mutate(a, input),
      runtime.mutate(a, input),
    ]);
    assert.equal(writes[0].recordId, writes[1].recordId);
    assert.equal(writes.filter((w) => w.replayed).length, 1);
    const queued = await runtime
      .sql`select score_date from private.beta_score_recompute_queue where canonical_user_id=${a.canonical} and status='DIRTY'`;
    assert.equal(queued.length, 3);
    const newer = await runtime.mutate(
      a,
      meal({
        mealRecordId: writes[0].recordId,
        revision: 1,
        date: shift(day, -1),
      }),
    );
    await assert.rejects(() =>
      runtime.mutate(a, meal({ mealRecordId: writes[0].recordId, revision: 1 }))
    );
    await Promise.all([runtime.drain(a.canonical), runtime.drain(a.canonical)]);
    const old = (await runtime.snapshot(a)).outputs.find((o: any) =>
      o.domain === "nutrition" && o.calculation_date === shift(day, -2)
    );
    assert.equal(old.score, null);
    await runtime.mutate(a, {
      mealRecordId: newer.recordId,
      revision: 2,
      clientRequestId: crypto.randomUUID(),
    }, true);
    await runtime.drain(a.canonical);
    const snap = await runtime.snapshot(a);
    assert.equal(snap.meals.length, 0);
    assert.ok(
      snap.outputs.every((o: any) =>
        o.domain !== "nutrition" || o.score === null
      ),
    );
    const replay = await runtime.mutate(a, input);
    assert.equal(replay.replayed, true);
    assert.equal((await runtime.snapshot(a)).meals.length, 0);
  } finally {
    await runtime.close();
  }
});

Deno.test("old running compute cannot overwrite newer generation; failed worker retries", async () => {
  const { runtime, a } = await context();
  try {
    const created = await runtime.mutate(a, meal());
    const original = runtime.compute.bind(runtime);
    let release!: () => void, entered!: () => void;
    const pause = new Promise<void>((r) => release = r),
      ready = new Promise<void>((r) => entered = r);
    let first = true;
    runtime.compute = async (user: string, date: string) => {
      const bundle = await original(user, date);
      if (first) {
        first = false;
        entered();
        await pause;
      }
      return bundle;
    };
    const stale = runtime.drain(a.canonical);
    await ready;
    await runtime.mutate(
      a,
      meal({ mealRecordId: created.recordId, revision: 1, weightGrams: 200 }),
    );
    await runtime.drain(a.canonical);
    const before = (await runtime.snapshot(a)).outputs.find((o: any) =>
      o.domain === "nutrition" && o.calculation_date === day
    ).input_fingerprint;
    release();
    await stale;
    assert.equal(
      (await runtime.snapshot(a)).outputs.find((o: any) =>
        o.domain === "nutrition" && o.calculation_date === day
      ).input_fingerprint,
      before,
    );
    await runtime.mutate(
      a,
      meal({ mealRecordId: created.recordId, revision: 2, weightGrams: 250 }),
    );
    runtime.compute = async () => {
      throw Error("INJECTED_WORKER_FAILURE");
    };
    await assert.rejects(() =>
      runtime.drain(a.canonical)
    );
    const status = (await runtime
      .sql`select status,attempt_count from private.beta_score_recompute_queue where canonical_user_id=${a.canonical} and score_date=${day}`)[
        0
      ];
    assert.equal(status.status, "DIRTY");
    assert.ok(
      (await runtime.snapshot(a)).outputs.filter((o: any) =>
        o.calculation_date === day
      ).every((o: any) => o.score_status === "STALE"),
    );
    runtime.compute = original;
    // Explicit clock acceleration belongs to this fault-injection test, not E2E evidence.
    const owner = postgres({ ...config, username: "engine_owner", max: 1 });
    try {
      await owner`update private.beta_score_recompute_queue set next_attempt_at=now() where canonical_user_id=${a.canonical}`;
    } finally {
      await owner.end();
    }
    await runtime.drain(a.canonical);
    assert.equal(
      (await runtime.snapshot(a)).outputs.find((o: any) =>
        o.domain === "nutrition" && o.calculation_date === day
      ).metrics.totals.calories,
      500,
    );
    await runtime.mutate(a, {
      mealRecordId: created.recordId,
      revision: 3,
      clientRequestId: crypto.randomUUID(),
    }, true);
    await runtime.drain(a.canonical);
  } finally {
    await runtime.close();
  }
});

Deno.test("mid-bundle PostgreSQL failure rolls back history and original score transaction", async () => {
  const { runtime } = await context();
  const owner = postgres({ ...config, username: "engine_owner", max: 1 });
  try {
    const before = Number(
      (await owner`select count(*) as n from engine_output_history`)[0].n,
    );
    const admin = pgAdmin(runtime.sql, async () => ({}), async (tx: any) => {
      await tx`insert into engine_output_history select canonical_user_id,calculation_date,output_kind,engine_version||'-test',input_fingerprint,score,score_status,data_completeness,confidence,payload,calculated_at from engine_output_history limit 1`;
      throw Error("TEST_TRANSACTION_ABORT");
    });
    const result = await admin.rpc("beta_persist_score_bundle", {});
    assert.ok(result.error);
    assert.equal(
      Number(
        (await owner`select count(*) as n from engine_output_history`)[0].n,
      ),
      before,
    );
    assert.equal(
      (await owner`select * from engine_output_heads where engine_version like '%-test'`)
        .length,
      0,
    );
  } finally {
    await runtime.close();
    await owner.end();
  }
});

Deno.test("native PostgreSQL health ingestion -> existing queue -> all other domain adapters", async () => {
  const { runtime, b } = await context();
  try {
    const started = performance.now();
    for (let i = 7; i >= 0; i--) {
      for (
        const [domain, unit, value] of [
          ["steps", "count", 7000],
          ["sleep", "minute", 480],
          ["resting_heart_rate", "bpm", 60],
          ["hrv", "ms", 40],
          ["weight", "kg", 80],
        ] as const
      ) {
        const date = shift(day, -i),
          sourceId = `fixture-${domain}-${i}`,
          hash = Array.from(
            new Uint8Array(
              await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(sourceId),
              ),
            ),
          ).map((b) => b.toString(16).padStart(2, "0")).join("");
        const record = {
          schema_version: "hdl-v2.health-ingestion.v1",
          canonical_user_id: b.canonical,
          platform: "android",
          domain,
          source_app: "synthetic-non-device",
          source_record_id: sourceId,
          recorded_at: date + "T10:00:00+08:00",
          timezone: "Asia/Taipei",
          local_date: date,
          value,
          unit,
          ...(domain === "sleep"
            ? {
              started_at: shift(date, -1) + "T23:00:00+08:00",
              ended_at: date + "T07:00:00+08:00",
            }
            : {}),
        };
        await runtime
          .sql`select public.beta_ingest_health_mutation(${b.canonical},'android',${domain},'synthetic-non-device',${sourceId},1,${
          new Date().toISOString()
        },${hash},'UPSERT',${hash},${
          runtime.sql.json(record)
        },array[${date}::date])`;
      }
    }
    await runtime.drain(b.canonical);
    const outputs = (await runtime.snapshot(b)).outputs.filter((o: any) =>
      o.calculation_date === day
    );
    for (const domain of ["activity", "sleep", "cardio", "body", "recovery"]) {
      assert.ok(
        outputs.find((o: any) => o.domain === domain && o.score !== null),
        domain,
      );
    }
    assert.equal(
      outputs.find((o: any) => o.domain === "nutrition").score,
      null,
    );
    const legacy = await runtime
      .sql`select score_type,score from beta_health_scores where canonical_user_id=${b.canonical} and score_date=${day}`;
    assert.equal(
      legacy.find((o: any) => o.score_type === "nutrition").score,
      null,
    );
    const prior = (await runtime
      .sql`select * from beta_health_records where canonical_user_id=${b.canonical} and domain='steps' and source_record_id='fixture-steps-7'`)[
        0
      ];
    await runtime
      .sql`select public.beta_ingest_health_mutation(${b.canonical},'android','steps','synthetic-non-device','fixture-steps-7',2,${
      new Date().toISOString()
    },${"f".repeat(64)},'DELETE',${"f".repeat(64)},null,array[${
      shift(day, -7)
    }::date])`;
    const queued = await runtime
      .sql`select score_date from private.beta_score_recompute_queue where canonical_user_id=${b.canonical} and status='DIRTY'`;
    assert.equal(queued.length, 8);
    await runtime.drain(b.canonical);
    const plan = await runtime
      .sql`explain (analyze,format json) select * from engine_output_heads where canonical_user_id=${b.canonical} and calculation_date between ${
      shift(day, -27)
    } and ${day}`;
    await Deno.writeTextFile(
      (Deno.env.get('LOCAL_ENGINE_NATIVE_EVIDENCE_DIR')||'.engine-artifacts/blocker-closure')+'/native-performance.json',
      JSON.stringify(
        {
          environment: {
            deno: Deno.version,
            postgres: (await runtime.sql`select version()`)[0].version,
            engine: "PORTABLE_TYPESCRIPT_NO_SUBPROCESS",
          },
          synthetic: true,
          users: 1,
          canonical_records: 40,
          days: 8,
          elapsed_ms: performance.now() - started,
          measurements: runtime.timings,
          plan,
          deleted_record_was_present: Boolean(prior),
          production_sla: "NOT_DEFINED",
        },
        null,
        2,
      ),
    );
  } finally {
    await runtime.close();
  }
});

Deno.test("portable adapter and frozen JavaScript match original golden contracts without subprocess", async () => {
  const { runtime } = await context();
  try {
    const fixtures = JSON.parse(
      await Deno.readTextFile(
        "fixtures/algorithm-golden/health-score-v1.0.json",
      ),
    ).fixtures;
    const names: Record<string, string> = {
      sleep: "calculateSleepScore",
      activity: "calculateActivityScore",
      training: "calculateTrainingScore",
      nutrition: "calculateNutritionScore",
      body_composition: "calculateBodyCompositionScore",
      recovery: "calculateRecoveryScore",
      fatigue: "calculateFatigueIndex",
      health_overall: "calculateHealthScore",
    };
    for (const f of fixtures) {
      const js = (globalThis as any).HEALTH_SCORE_V1_RUNTIME[names[f.domain]](
        f.canonical_inputs,
      );
      const py = (await runtime.worker.execute({
        algorithm_id: f.algorithm_id,
        algorithm_version: f.algorithm_version,
        domain: f.domain,
        subject_ref: "synthetic-parity",
        period_start: f.input_window.start,
        period_end: f.input_window.end,
        timezone: f.timezone,
        canonical_inputs: f.canonical_inputs,
      })).normalized;
      assert.equal(js.score, f.expected.expected_score, f.fixture_id);
      assert.equal(py.score, js.score, f.fixture_id);
      assert.equal(py.completeness, js.completeness, f.fixture_id);
      assert.equal(py.confidence, js.confidence, f.fixture_id);
      assert.deepEqual(
        py.missing_inputs,
        [...(js.missingData || [])].sort(),
        f.fixture_id,
      );
      assert.equal(py.algorithm_version, f.algorithm_version);
    }
  } finally {
    await runtime.close();
  }
});
