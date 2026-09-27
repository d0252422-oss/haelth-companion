import assert from "node:assert/strict";
import { classifyManualRuntimeError } from "../supabase/functions/mobile-health-beta/local-engine-runtime.ts";

Deno.test("manual runtime reports missing schema as an explicit non-client-retryable outage", () => {
  for (const sqlState of ["42703", "42P01"]) {
    const failure = classifyManualRuntimeError(Object.assign(new Error("database contract mismatch"), { code: sqlState }));
    assert.deepEqual(failure, {
      code: "MANUAL_SCHEMA_OUT_OF_DATE",
      retryable: false,
      status: 503,
    });
  }
});

Deno.test("manual runtime retains existing conflict, timeout and safe-domain error classifications", () => {
  assert.deepEqual(classifyManualRuntimeError(Object.assign(new Error("serialization"), { code: "40001" })), {
    code: "DB_CONFLICT_RETRYABLE",
    retryable: true,
    status: 503,
  });
  assert.deepEqual(classifyManualRuntimeError(Object.assign(new Error("socket"), { code: "ECONNRESET" })), {
    code: "DB_TIMEOUT_RETRYABLE",
    retryable: true,
    status: 503,
  });
  assert.deepEqual(classifyManualRuntimeError(new Error("INVALID_PAYLOAD")), {
    code: "INVALID_PAYLOAD",
    retryable: false,
    status: 400,
  });
  assert.deepEqual(classifyManualRuntimeError(new Error("unexpected lower-case server failure")), {
    code: "ENGINE_REQUEST_FAILED",
    retryable: false,
    status: 500,
  });
});

Deno.test("set-order migration is additive and preserves historical rows", async () => {
  const migration = await Deno.readTextFile("supabase/migrations/20260920224000_manual_workout_set_order.sql");
  assert.match(migration, /set lock_timeout = '5s'/i);
  assert.match(migration, /set statement_timeout = '30s'/i);
  assert.doesNotMatch(migration, /set local (?:lock|statement)_timeout/i);
  assert.match(migration, /do \$migration\$[\s\S]*alter table[\s\S]*create unique index[\s\S]*\$migration\$/i);
  assert.doesNotMatch(migration, /reset (?:lock|statement)_timeout/i);
  assert.match(migration, /add column if not exists set_order integer/i);
  assert.match(migration, /manual_workout_sets_set_order_positive/i);
  assert.match(migration, /check \(set_order > 0\)/i);
  assert.match(migration, /create unique index if not exists manual_workout_set_order_unique/i);
  assert.match(migration, /\(canonical_user_id, session_id, set_order\)/i);
  assert.match(migration, /where not deleted and set_order is not null/i);
  assert.doesNotMatch(migration, /^\s*(delete|drop|truncate|update)\b/im);
});

Deno.test("training runtime and release manifest require the same set-order migration", async () => {
  const runtime = await Deno.readTextFile("supabase/functions/mobile-health-beta/manual-training-local.ts");
  const releaseManifest = await Deno.readTextFile("scripts/manual-release-migrations.mjs");
  assert.match(runtime, /s\.set_order/);
  assert.match(runtime, /set_order,revision,body/);
  assert.match(runtime, /setOrder,setNumber:setIndex\+1/);
  assert.match(releaseManifest, /20260920224000_manual_workout_set_order\.sql/);
});
