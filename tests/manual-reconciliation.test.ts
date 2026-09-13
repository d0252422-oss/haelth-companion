// Synthetic reference inputs only. Python is used by this test, never by Edge.
import assert from "node:assert/strict";
import { computeDomainRequest } from "../supabase/functions/mobile-health-beta/engine-portable.ts";

const subject = "synthetic-manual-day-mask";
const d1 = "2026-09-11", d2 = "2026-09-12";
const policy = "manual-source-exclusion-v1";
const native = (changes: Record<string, unknown> = {}) => ({
  subject_ref: subject,
  source: "SYNTHETIC_NATIVE_INTERVAL_NOT_DEVICE_EVIDENCE",
  record_id: "native-cross-midnight",
  revision: 1,
  domain: "steps",
  recorded_at: `${d2}T01:00:00+08:00`,
  updated_at: `${d2}T02:00:00+08:00`,
  started_at: `${d1}T23:00:00+08:00`,
  ended_at: `${d2}T01:00:00+08:00`,
  value: 1200,
  unit: "count",
  source_quality: "MEDIUM",
  payload: {},
  ...changes,
});
const masked = (record: Record<string, unknown>, days: string[]) => ({
  ...structuredClone(record),
  payload: { manual_reconciliation: { policy, excluded_local_dates: days } },
});
const request = (record: Record<string, unknown>, day: string) => ({
  algorithm_id: "multi-domain-bundle",
  algorithm_version: "health-score-v1.0",
  domain: "multi_domain",
  subject_ref: subject,
  timezone: "Asia/Taipei",
  period_start: `${day}T00:00:00+08:00`,
  period_end: `${day}T23:59:59+08:00`,
  canonical_inputs: {
    date: day,
    records: [record],
    calculated_at: `${d2}T12:00:00Z`,
  },
});

Deno.test("manual day exclusion retains native interval proration and provenance", async () => {
  const original = native(), conflict = masked(original, [d2]);
  const snapshot = structuredClone(conflict);
  const prior = (await computeDomainRequest(request(conflict, d1))).bundle.daily;
  const current = (await computeDomainRequest(request(conflict, d2))).bundle.daily;
  const normal = (await computeDomainRequest(request(original, d2))).bundle.daily;
  assert.equal(prior.metrics.steps, 600);
  assert.deepEqual(prior.flags, ["ESTIMATED_INTERVAL_PRORATION:steps"]);
  assert.equal(normal.metrics.steps, 600);
  assert.equal(current.metrics.steps, null);
  assert.deepEqual(current.flags, ["SOURCE_CONFLICT:steps"]);
  assert.deepEqual(current.evidence_ids, normal.evidence_ids);
  assert.equal(current.evidence_ids.length, 1);
  assert.notEqual(current.input_fingerprint, normal.input_fingerprint);
  assert.equal(prior.source_quality, "LOW");
  assert.equal(current.source_quality, "LOW");
  assert.deepEqual(conflict, snapshot);
});

Deno.test("manual day exclusion preserves zero on other day and rolling coverage", async () => {
  const record = native({ value: 0 });
  const result = await computeDomainRequest(request(masked(record, [d2]), d2));
  assert.equal(result.bundle.daily.metrics.steps, null);
  assert.equal(result.bundle.derived.steps_7d_count, 1);
  assert.equal(result.bundle.derived.steps_28d_count, 1);
  assert.equal(result.bundle.derived.steps_7d_avg, 0);
  assert.equal(result.bundle.derived.steps_28d_avg, 0);
  assert.equal(result.bundle.derived.activity_observed_days_7, 1);
  assert.equal(result.bundle.derived.activity_nonzero_days_7, 0);
  const zero = await computeDomainRequest(request(record, d2));
  assert.equal(zero.bundle.daily.metrics.steps, 0);
  assert.equal(zero.bundle.derived.steps_7d_count, 2);
  const replay = await computeDomainRequest(request(masked(record, [d2]), d2));
  assert.equal(result.bundle.daily.input_fingerprint, replay.bundle.daily.input_fingerprint);
});

Deno.test("manual sleep day exclusion preserves existing wake-date semantics", async () => {
  const sleep = native({ domain: "sleep", value: null, unit: null, ended_at: `${d2}T06:00:00+08:00` });
  const retained = (await computeDomainRequest(request(masked(sleep, [d1]), d2))).bundle.daily;
  const excluded = (await computeDomainRequest(request(masked(sleep, [d2]), d2))).bundle.daily;
  assert.equal(retained.metrics.sleep_minutes, 420);
  assert.equal(retained.metrics.bedtime_minute, 23 * 60);
  assert.equal(excluded.metrics.sleep_minutes, null);
  assert.equal(excluded.metrics.bedtime_minute, null);
  assert.deepEqual(excluded.flags, ["SOURCE_CONFLICT:sleep"]);
});

const invalidMasks: unknown[] = [
  null, false, [], {},
  { policy: "prefer-manual", excluded_local_dates: [d2] },
  { policy },
  { policy, excluded_local_dates: null },
  { policy, excluded_local_dates: d2 },
  { policy, excluded_local_dates: [null] },
  { policy, excluded_local_dates: [20260912] },
  { policy, excluded_local_dates: ["20260912"] },
  { policy, excluded_local_dates: ["2026-9-12"] },
  { policy, excluded_local_dates: ["2026-02-30"] },
  { policy, excluded_local_dates: [d2, d2] },
  { policy, excluded_local_dates: Array.from({ length: 33 }, (_, i) =>
    new Date(Date.parse(`${d2}T00:00:00Z`) - i * 86400000).toISOString().slice(0, 10)) },
];
for (const [index, metadata] of invalidMasks.entries()) {
  Deno.test(`manual day exclusion rejects invalid internal mask ${index + 1}`, async () => {
    await assert.rejects(
      () => computeDomainRequest(request(native({ payload: { manual_reconciliation: metadata } }), d2)),
      /INVALID_MANUAL_RECONCILIATION/,
    );
  });
}

function compareReference(actual: any, expected: any, path = "root") {
  if (
    path.endsWith(".input_fingerprint") || path.endsWith(".input_fingerprints") ||
    path.endsWith(".fingerprint_scheme")
  ) return; // Different documented schemes; change/replay behavior is checked above.
  if (path.endsWith(".calculated_at")) {
    assert.equal(Date.parse(actual), Date.parse(expected), path);
    return;
  }
  if (actual && expected && typeof actual === "object" && typeof expected === "object") {
    const keys = (value: any) => Object.keys(value).filter((key) => key !== "fingerprint_scheme").sort();
    assert.deepEqual(keys(actual), keys(expected), path);
    for (const key of keys(actual)) compareReference(actual[key], expected[key], `${path}.${key}`);
    return;
  }
  assert.equal(actual, expected, path); // Exact contract comparison; no added tolerance.
}

Deno.test("manual day exclusion: fresh Python reference matches full TypeScript outputs", async () => {
  const python = Deno.env.get("ALGORITHM_PYTHON");
  assert.ok(python, "ALGORITHM_PYTHON must be an explicitly verified local reference interpreter");
  const command = new Deno.Command(python, {
    args: ["-m", "tests_python.test_manual_reconciliation"],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  assert.equal(output.code, 0, new TextDecoder().decode(output.stderr));
  const cases = JSON.parse(new TextDecoder().decode(output.stdout));
  assert.equal(cases.length, 10);
  for (const fixture of cases) {
    compareReference(await computeDomainRequest(fixture.request), fixture.expected, fixture.id);
  }
});
