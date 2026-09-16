// Offline configuration guards only, not actual Edge/SQL acceptance.
import assert from "node:assert/strict";
import {
  backgroundBootstrap,
  backgroundConfig,
} from "../supabase/functions/mobile-health-beta/background-bootstrap.ts";
const project = "a".repeat(20), host = "aws-0-test.pooler.supabase.com";
const env: Record<string, string> = {
  HEALTH_BACKGROUND_SQL_ENABLED: "1",
  HEALTH_MANUAL_EXPECTED_PROJECT_REF: project,
  HEALTH_MANUAL_EXPECTED_DB_HOST: host,
  HEALTH_MANUAL_ALLOWED_ORIGIN: "https://synthetic.invalid",
  SUPABASE_URL: `https://${project}.supabase.co`,
  HEALTH_NATIVE_DATABASE_URL:
    `postgresql://health_native_ingest.${project}:synthetic-unit@${host}:6543/postgres`,
  HEALTH_RECOMPUTE_DATABASE_URL:
    `postgresql://health_recompute_worker.${project}:synthetic-unit@${host}:6543/postgres`,
};
Deno.test("background default OFF; independent roles and strict hosted TLS", () => {
  assert.throws(() => backgroundConfig(() => undefined, false));
  for (const system of [false, true]) {
    const c = backgroundConfig((k) => env[k], system);
    assert.equal(c.ssl?.rejectUnauthorized, true);
    assert.equal(
      c.role,
      system ? "health_recompute_worker" : "health_native_ingest",
    );
    const key = system
      ? "HEALTH_RECOMPUTE_DATABASE_URL"
      : "HEALTH_NATIVE_DATABASE_URL";
    for (
      const value of [
        env[key].replace(c.role, "postgres"),
        env[key] + "?sslmode=disable",
        env[key].replace(":6543", ":5432"),
        env[key].replace(host, "localhost"),
      ]
    ) {
      assert.throws(() =>
        backgroundConfig((k) => k === key ? value : env[k], system)
      );
    }
  }
});
Deno.test("local-only worker fixture cannot activate on deployed environment", () => {
  const local = {
    ...env,
    HEALTH_ENGINE_LOCAL_ONLY: "1",
    HEALTH_BACKGROUND_LOCAL_CONFIG: JSON.stringify({
      host: "127.0.0.1",
      port: 57485,
      database: "health_engine_" + "a".repeat(32),
    }),
  };
  assert.equal(
    backgroundConfig((k) => (local as any)[k], false).role,
    "health_native_ingest",
  );
  assert.throws(() =>
    backgroundConfig(
      (k) =>
        k === "DENO_DEPLOYMENT_ID"
          ? "synthetic-deployment"
          : k === "HEALTH_NATIVE_DATABASE_URL"
          ? undefined
          : (local as any)[k],
      false,
    )
  );
});
Deno.test("background CORS and missing system trigger fail before DB connection", async () => {
  const names = [
    ...Object.keys(env),
    "HEALTH_ENGINE_LOCAL_ONLY",
    "DENO_DEPLOYMENT_ID",
    "HEALTH_RECOMPUTE_TRIGGER_SECRET",
  ];
  const saved = names.map((k) => [k, Deno.env.get(k)] as const);
  try {
    for (const k of names) Deno.env.delete(k);
    for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
    assert.equal(
      (await backgroundBootstrap(
        new Request("https://unit.invalid/internal/score-recompute/drain", {
          method: "POST",
        }),
      )).status,
      401,
    );
    assert.equal(
      (await backgroundBootstrap(
        new Request("https://unit.invalid/v1/health/ingestion/batches", {
          method: "OPTIONS",
          headers: { origin: "https://other.invalid" },
        }),
      )).status,
      403,
    );
    assert.equal(
      (await backgroundBootstrap(
        new Request("https://unit.invalid/v1/health/ingestion/batches", {
          method: "OPTIONS",
          headers: { origin: env.HEALTH_MANUAL_ALLOWED_ORIGIN },
        }),
      )).status,
      204,
    );
  } finally {
    for (const [k, v] of saved) {
      v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
    }
  }
});
