import assert from "node:assert/strict";
import { authorizeSession, validateMutation } from "../supabase/functions/mobile-health-beta/index.ts";
import { sameCanonicalUserId } from "../supabase/functions/mobile-health-beta/canonical-user-id.ts";

const user = "a1b2c3d4-e5f6-4789-8abc-def012345678";
const hash = "a".repeat(64);
function mutation(overrides: Record<string, unknown> = {}) {
  const { record: recordOverrides, ...envelopeOverrides } = overrides;
  const record = {
    schema_version: "hdl-v2.health-ingestion.v1",
    canonical_user_id: user,
    platform: "android",
    domain: "steps",
    source_app: "com.example.health",
    source_record_id: "source-1",
    recorded_at: "2026-09-20T08:00:00+08:00",
    local_date: "2026-09-20",
    timezone: "Asia/Taipei",
    value: 8_000,
    unit: "count",
    ...(recordOverrides as Record<string, unknown> ?? {}),
  };
  return {
    canonical_user_id: user,
    platform: "android",
    domain: "steps",
    source_app: "com.example.health",
    source_record_id: "source-1",
    source_revision: 1,
    source_content_hash: hash,
    idempotency_key: hash,
    operation: "UPSERT",
    affected_local_dates: ["2026-09-20"],
    record,
    ...envelopeOverrides,
  };
}

Deno.test("native mutation accepts the canonical aligned record", () => {
  assert.deepEqual(validateMutation(mutation(), user, "android").affected_local_dates, ["2026-09-20"]);
});

Deno.test("source total energy requires kcal and a real interval, without active/basal substitution", () => {
  const total = mutation({
    domain: "total_energy",
    affected_local_dates: ["2026-09-19", "2026-09-20"],
    record: {
      domain: "total_energy",
      unit: "kcal",
      value: 90.5,
      started_at: "2026-09-19T15:30:00Z",
      ended_at: "2026-09-19T16:30:00Z",
      recorded_at: "2026-09-19T16:30:00Z",
      local_date: "2026-09-20",
    },
  });
  assert.equal(validateMutation(total, user, "android").domain, "total_energy");
  assert.doesNotThrow(() => validateMutation(mutation({ ...total, record: { ...total.record, timezone: "+08:00" } }), user, "android"));
  assert.doesNotThrow(() => validateMutation(mutation({ ...total, record: { ...total.record, timezone: "+00:00", local_date: "2026-09-19" }, affected_local_dates: ["2026-09-19"] }), user, "android"));
  assert.throws(() => validateMutation(mutation({ ...total, record: { ...total.record, unit: "cal" } }), user, "android"), /INVALID_UNIT/);
  assert.throws(() => validateMutation(mutation({ ...total, record: { ...total.record, value: 1_000_001 } }), user, "android"), /MALFORMED_VALUE/);
  assert.throws(() => validateMutation(mutation({ ...total, record: { ...total.record, ended_at: "2026-09-19T15:30:00Z" } }), user, "android"), /MALFORMED_INTERVAL/);
  for (const domain of ["active_energy", "basal_energy"]) {
    assert.throws(() => validateMutation(mutation({ ...total, domain, record: { ...total.record, domain } }), user, "android"), /UNSUPPORTED_DOMAIN/);
  }
  assert.throws(() => validateMutation({ ...total, canonical_user_id: "b1b2c3d4-e5f6-4789-8abc-def012345678" }, user, "android"), /CROSS_USER_UPLOAD/);
});

Deno.test("canonical identity comparison accepts Swift UUID casing only", () => {
  const swiftEncodedUser = user.toUpperCase();
  const uppercasePayload = mutation({
    canonical_user_id: swiftEncodedUser,
    record: { canonical_user_id: swiftEncodedUser },
  });
  assert.equal(sameCanonicalUserId(swiftEncodedUser, user), true);
  assert.doesNotThrow(() => validateMutation(uppercasePayload, user, "android"));
  assert.equal(sameCanonicalUserId("b1b2c3d4-e5f6-4789-8abc-def012345678", user), false);
  assert.throws(
    () => validateMutation({ ...uppercasePayload, canonical_user_id: "b1b2c3d4-e5f6-4789-8abc-def012345678" }, user, "android"),
    /CROSS_USER_UPLOAD/,
  );
});

Deno.test("native Google bearer auth is server-bound to the Android platform", async () => {
  const admin = {
    auth: {
      getUser: () => Promise.resolve({
        data: {
          user: {
            id: "auth-user-a",
            email: "owner@example.invalid",
            app_metadata: { provider: "google", providers: ["google"] },
            identities: [{ provider: "google", id: "google-subject-a", identity_data: { sub: "google-subject-a" } }],
          },
        },
        error: null,
      }),
    },
    rpc: (name: string) => {
      if (name !== "beta_resolve_native_auth_identity") throw new Error(`unexpected RPC ${name}`);
      return Promise.resolve({
        data: [{ canonical_user_id: user, provider: "google", environment: "beta" }],
        error: null,
      });
    },
  };
  const request = new Request("https://beta.invalid/v1/ingest", {
    headers: { authorization: "Bearer native-google-access-token" },
  });

  const session = await authorizeSession(request, admin);
  assert.equal(session.canonical_user_id, user);
  assert.equal(session.platform, "android");
});

Deno.test("native mutation platform must match the authenticated app session", () => {
  assert.throws(() => validateMutation(mutation(), user, "ios"), /PLATFORM_MISMATCH/);
  const iosMutation = mutation({
    platform: "ios",
    record: { platform: "ios" },
  });
  assert.throws(() => validateMutation(iosMutation, user, "android"), /PLATFORM_MISMATCH/);
});

Deno.test("native mutation rejects envelope/record identity drift", () => {
  for (const record of [
    { domain: "heart_rate", unit: "bpm", value: 70 },
    { platform: "ios" },
    { source_app: "other" },
    { source_record_id: "other" },
  ]) assert.throws(() => validateMutation(mutation({ record }), user, "android"), /MUTATION_RECORD_MISMATCH/);
});

Deno.test("native mutation rejects invalid unit, value, timezone and calendar date", () => {
  assert.throws(() => validateMutation(mutation({ record: { unit: "bpm" } }), user, "android"), /INVALID_UNIT/);
  assert.throws(() => validateMutation(mutation({ record: { value: -1 } }), user, "android"), /MALFORMED_VALUE/);
  assert.throws(() => validateMutation(mutation({ record: { value: 10_000_001 } }), user, "android"), /MALFORMED_VALUE/);
  assert.throws(() => validateMutation(mutation({ record: { timezone: "Not/AZone" } }), user, "android"), /INVALID_TIMEZONE/);
  assert.throws(() => validateMutation(mutation({ record: { local_date: "2026-02-31" } }), user, "android"), /MALFORMED_LOCAL_DATE/);
});

Deno.test("affected dates are non-empty bounded canonical distinct and include record local date", () => {
  for (const affected_local_dates of [[], ["2026-02-31"], ["2026-09-20", "2026-09-20"], Array(33).fill("2026-09-20")]) {
    assert.throws(() => validateMutation(mutation({ affected_local_dates }), user, "android"), /INVALID_AFFECTED_DATES/);
  }
  assert.throws(() => validateMutation(mutation({ affected_local_dates: ["2026-09-19"] }), user, "android"), /AFFECTED_DATE_MISMATCH/);
});

Deno.test("delete remains record-free but still requires bounded affected dates", () => {
  const deleted = { ...mutation(), operation: "DELETE", record: null };
  assert.equal(validateMutation(deleted, user, "android").operation, "DELETE");
  assert.throws(() => validateMutation(deleted, user, "ios"), /PLATFORM_MISMATCH/);
  assert.throws(() => validateMutation({ ...deleted, affected_local_dates: [] }, user, "android"), /INVALID_AFFECTED_DATES/);
});

Deno.test("malformed mutation shapes and source metadata fail as client errors", () => {
  assert.throws(() => validateMutation(null as unknown as Record<string, unknown>, user, "android"), /INVALID_MUTATION/);
  assert.throws(() => validateMutation(mutation({ source_app: "   " }), user, "android"), /MISSING_SOURCE_IDENTITY/);
  assert.throws(() => validateMutation(mutation({ source_updated_at: "not-a-time" }), user, "android"), /MALFORMED_TIMESTAMP/);
});
