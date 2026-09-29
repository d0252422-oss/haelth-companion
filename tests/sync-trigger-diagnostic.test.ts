import assert from "node:assert/strict";
import {
  logPersistedSyncReceipt,
  safeSyncTriggerDiagnostic,
} from "../supabase/functions/mobile-health-beta/sync-trigger-diagnostic.ts";

const diagnostic = {
  trigger_source: "PERIODIC_WORKER",
  origin_trigger_source: "PERIODIC_WORKER",
  flow_id: "11111111-1111-4111-8111-111111111112",
  worker_id: "11111111-1111-4111-8111-111111111113",
  attempt: 1,
  worker_attempt: 0,
  started_at: "2026-09-29T07:13:00Z",
};

Deno.test("allowlisted periodic provenance survives without becoming an identity claim", () => {
  assert.deepEqual(safeSyncTriggerDiagnostic(diagnostic), diagnostic);
  assert.equal(safeSyncTriggerDiagnostic({ ...diagnostic, trigger_source: "FORGED_OWNER" }).trigger_source, "UNKNOWN");
  assert.equal(safeSyncTriggerDiagnostic({ ...diagnostic, worker_id: "not-a-uuid" }).worker_id, null);
  assert.equal(safeSyncTriggerDiagnostic({ ...diagnostic, attempt: -1 }).attempt, null);
  assert.equal(safeSyncTriggerDiagnostic({ ...diagnostic, started_at: "bad" }).started_at, null);
});

Deno.test("persisted receipt log contains only bounded diagnostics and counts", () => {
  const messages: string[] = [];
  const original = console.info;
  console.info = (message: string) => { messages.push(message); };
  try {
    logPersistedSyncReceipt("ingestion", {
      ...diagnostic, canonical_user_id: "other-user", email: "private@example.invalid",
      access_token: "secret-test-token", flow_id: "bad\nINJECTED",
    }, 200, {
      accepted_idempotency_keys: ["sensitive-key"],
      duplicate_idempotency_keys: [], rejected: [],
      record: { value: 9000 },
    }, { platform: "android", auth_kind: "native_bearer" });
    logPersistedSyncReceipt("ingestion", null, 200, {}, { platform: "android", auth_kind: "native_bearer" });
  } finally {
    console.info = original;
  }
  assert.equal(messages.length, 1);
  assert.ok(messages[0].startsWith("HEALTH_SYNC_RECEIPT "));
  const logged = JSON.parse(messages[0].slice("HEALTH_SYNC_RECEIPT ".length));
  assert.equal(logged.trigger_source, "PERIODIC_WORKER");
  assert.equal(logged.flow_id, null);
  assert.equal(logged.accepted_count, 1);
  assert.equal(logged.http_status, 200);
  assert.equal(logged.verified_platform, "android");
  assert.equal(logged.verified_auth_kind, "native_bearer");
  assert.ok(Number.isFinite(Date.parse(logged.completed_at)));
  for (const forbidden of ["other-user", "private@example.invalid", "secret-test-token", "sensitive-key", "9000", "INJECTED"]) {
    assert.equal(messages[0].includes(forbidden), false);
  }
});
