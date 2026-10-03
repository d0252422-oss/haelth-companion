import { deepStrictEqual, equal } from "node:assert/strict";
import {
  collapseRelevantPublishedDailyAutomaticRows,
  projectPublishedDaily,
  PUBLISHED_DAILY_AUTOMATIC_DOMAINS,
  relevantPublishedDailyAutomaticRows,
} from "../supabase/functions/mobile-health-beta/manual-daily-read.ts";

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  queue: [],
  automatic: [],
  manual: [],
  rows: [],
  range: { start: "2026-09-18", end: "2026-09-20" },
  ...overrides,
});

Deno.test("automatic steps input keeps the canonical local day visible without inventing a zero", () => {
  const rows = projectPublishedDaily(
    snapshot({
      automatic: [{ domain: "steps", affected_local_dates: ["2026-09-19"] }],
    }),
    "activity",
  );
  equal(rows.length, 1);
  equal(rows[0].date, "2026-09-19");
  equal(rows[0].steps, null);
  equal(rows[0].dataStatus, "STALE");
  equal(rows[0].source, "SQL_CANONICAL_INPUT_PENDING_PUBLICATION");
});

Deno.test("committed automatic steps remain visible while derived publication failed", () => {
  const rows = projectPublishedDaily(
    snapshot({
      automatic: [{
        domain: "steps",
        local_date: "2026-09-19",
        affected_local_dates: ["2026-09-19"],
        source_app: "com.example.wearable",
        record_count: 24,
        daily_value: 7435,
      }],
      queue: [{
        score_date: "2026-09-19",
        status: "FAILED",
        generation: "4",
        engine_published_generation: "0",
      }],
    }),
    "activity",
  );
  equal(rows.length, 1);
  equal(rows[0].steps, 7435);
  equal(rows[0].dataStatus, "CURRENT");
  equal(rows[0].staleReason, null);
  equal(rows[0].analysisDataStatus, "STALE");
  equal(rows[0].analysisStaleReason, "RECOMPUTE_FAILED");
  equal(rows[0].stepsSource, "WEARABLE_SYNC");
  equal(rows[0].source, "SQL_CANONICAL_AUTOMATIC_FALLBACK");
});

Deno.test("an invalid raw step aggregate stays a missing gap instead of becoming zero", () => {
  const rows = projectPublishedDaily(snapshot({
    automatic: [{
      domain: "steps",
      local_date: "2026-09-19",
      affected_local_dates: ["2026-09-19"],
      source_app: "com.example.wearable",
      daily_value: null,
    }],
  }), "activity");
  equal(rows[0].steps, null);
  equal(rows[0].dataStatus, "STALE");
});

Deno.test("published and manual step totals take precedence over the raw fallback", () => {
  const automatic = [{
    domain: "steps",
    local_date: "2026-09-19",
    affected_local_dates: ["2026-09-19"],
    source_app: "com.example.wearable",
    record_count: 24,
    daily_value: 7435,
  }];
  const published = projectPublishedDaily(snapshot({
    automatic,
    queue: [{ score_date: "2026-09-19", status: "COMPLETE", generation: "3", engine_published_generation: "3" }],
    rows: [{
      output_kind: "activity",
      calculation_date: "2026-09-19",
      payload: { score_status: "VALID", engine_version: "activity-score-v1.0", metrics: { daily: { steps: 7200 } } },
    }],
  }), "activity");
  equal(published[0].steps, 7200);
  equal(published[0].stepsSource, "SQL_PUBLISHED_DAILY_METRICS");

  const manual = projectPublishedDaily(snapshot({
    automatic,
    manual: [{
      local_date: "2026-09-19",
      domain: "steps",
      body: { recordId: "manual-steps", domain: "steps", date: "2026-09-19", value: 8000, coverage: "FULL_DAY" },
    }],
  }), "activity");
  equal(manual[0].steps, 8000);
  equal(manual[0].stepsSource, "SELF_REPORTED_UNKNOWN_QUALITY");
});

Deno.test("a verified publication with null steps remains authoritative over raw input", () => {
  const rows = projectPublishedDaily(snapshot({
    automatic: [{
      domain: "steps",
      local_date: "2026-09-19",
      affected_local_dates: ["2026-09-19"],
      source_app: "com.example.wearable",
      daily_value: 7435,
    }],
    queue: [{ score_date: "2026-09-19", status: "COMPLETE", generation: "3", engine_published_generation: "3" }],
    rows: [{
      output_kind: "activity",
      calculation_date: "2026-09-19",
      payload: { score_status: "INSUFFICIENT_DATA", engine_version: "activity-score-v1.0", metrics: { daily: { steps: null } } },
    }],
  }), "activity");
  equal(rows[0].steps, null);
  equal(rows[0].dataStatus, "CURRENT");
  equal(rows[0].source, "SQL_PUBLISHED_DAILY_METRICS");
});

Deno.test("manual override preserves failed analysis state after an automatic fallback", () => {
  const rows = projectPublishedDaily(snapshot({
    automatic: [{
      domain: "steps",
      local_date: "2026-09-19",
      affected_local_dates: ["2026-09-19"],
      source_app: "com.example.wearable",
      daily_value: 7435,
    }],
    queue: [{ score_date: "2026-09-19", status: "FAILED", generation: "4", engine_published_generation: "0" }],
    manual: [{
      local_date: "2026-09-19",
      domain: "steps",
      body: { recordId: "manual-steps", domain: "steps", date: "2026-09-19", value: 8000, coverage: "FULL_DAY" },
    }],
  }), "activity");
  equal(rows[0].steps, 8000);
  equal(rows[0].dataStatus, "CURRENT");
  equal(rows[0].staleReason, null);
  equal(rows[0].analysisDataStatus, "STALE");
  equal(rows[0].analysisStaleReason, "RECOMPUTE_FAILED");
  equal(rows[0].stepsSource, "SELF_REPORTED_UNKNOWN_QUALITY");
});

Deno.test("committed automatic sleep uses interval-union minutes while analysis is failed", () => {
  const rows = projectPublishedDaily(snapshot({
    automatic: [{
      domain: "sleep",
      local_date: "2026-09-19",
      affected_local_dates: ["2026-09-19"],
      source_app: "com.example.wearable",
      daily_value: 419,
    }],
    queue: [{ score_date: "2026-09-19", status: "FAILED", generation: "4", engine_published_generation: "0" }],
  }), "sleep");
  equal(rows[0].totalSleepMinutes, 419);
  equal(rows[0].sleepSource, "WEARABLE_SYNC");
  equal(rows[0].dataStatus, "CURRENT");
  equal(rows[0].staleReason, null);
  equal(rows[0].analysisDataStatus, "STALE");
  equal(rows[0].analysisStaleReason, "RECOMPUTE_FAILED");
});

Deno.test("09/28, 09/30 and 10/03 sleep gaps stay blank until real sessions arrive", () => {
  const range = { start: "2026-09-28", end: "2026-10-03" };
  const queue = [
    { score_date: "2026-09-28", status: "FAILED", generation: "4", engine_published_generation: "0" },
    { score_date: "2026-09-30", status: "COMPLETE", generation: "4", engine_published_generation: "4" },
    { score_date: "2026-10-03", status: "FAILED", generation: "4", engine_published_generation: "0" },
  ];
  const stagesOnly = [{ domain: "sleep_stage", affected_local_dates: ["2026-10-03"] }];
  const missing = projectPublishedDaily(snapshot({ range, queue, automatic: stagesOnly }), "sleep");
  deepStrictEqual(missing.map((row) => [row.date, row.totalSleepMinutes]), [
    ["2026-09-28", null], ["2026-09-30", null], ["2026-10-03", null],
  ]);

  // These values represent SQL-validated session interval unions, not sums of
  // stage fragments. Recompute failure must remain separate from metric readback.
  const recovered = projectPublishedDaily(snapshot({
    range, queue,
    automatic: [
      ...stagesOnly,
      ...(["2026-09-28", "2026-09-30", "2026-10-03"] as const).map((date, index) => ({
        domain: "sleep", local_date: date, affected_local_dates: [date],
        source_app: "com.example.wearable", record_count: 1,
        daily_value: [410, 385, 360][index],
      })),
    ],
  }), "sleep");
  deepStrictEqual(recovered.map((row) => [row.date, row.totalSleepMinutes]), [
    ["2026-09-28", 410], ["2026-09-30", 385], ["2026-10-03", 360],
  ]);
  equal(recovered[0].analysisStaleReason, "RECOMPUTE_FAILED");
  equal(recovered[2].analysisStaleReason, "RECOMPUTE_FAILED");
});

Deno.test("manual sleep remains authoritative over the raw interval fallback", () => {
  const rows = projectPublishedDaily(snapshot({
    automatic: [{
      domain: "sleep",
      local_date: "2026-09-19",
      affected_local_dates: ["2026-09-19"],
      source_app: "com.example.wearable",
      daily_value: 492,
    }],
    queue: [{ score_date: "2026-09-19", status: "DIRTY", generation: "4", engine_published_generation: "0" }],
    manual: [{
      local_date: "2026-09-19",
      domain: "sleep",
      body: {
        recordId: "manual-sleep",
        domain: "sleep",
        date: "2026-09-19",
        value: 430,
        coverage: "SESSION",
        startedAt: "2026-09-18T23:50:00+08:00",
        endedAt: "2026-09-19T07:00:00+08:00",
      },
    }],
  }), "sleep");
  equal(rows[0].totalSleepMinutes, 430);
  equal(rows[0].sleepSource, "SELF_REPORTED_UNKNOWN_QUALITY");
  equal(rows[0].analysisDataStatus, "STALE");
  equal(rows[0].analysisStaleReason, "RECOMPUTE_PENDING");
});

Deno.test("safe point-domain fallbacks keep separate metric values and provenance", () => {
  const date = "2026-09-19";
  const rows = projectPublishedDaily(snapshot({
    automatic: [
      { domain: "resting_heart_rate", local_date: date, affected_local_dates: [date], source_app: "rhr.source", source_updated_at: "2026-09-19T10:00:00Z", daily_value: 63 },
      { domain: "hrv", local_date: date, affected_local_dates: [date], source_app: "hrv.source", source_updated_at: "2026-09-19T10:01:00Z", daily_value: 41.2 },
      { domain: "weight", local_date: date, affected_local_dates: [date], source_app: "weight.source", source_updated_at: "2026-09-19T10:02:00Z", daily_value: 87.8 },
      { domain: "spo2", local_date: date, affected_local_dates: [date], source_app: "spo2.source", source_updated_at: "2026-09-19T10:03:00Z", daily_value: 98.1 },
    ],
    queue: [{ score_date: date, status: "DIRTY", generation: "4", engine_published_generation: "0" }],
  }), "activity");
  equal(rows[0].heartRate, 63);
  equal(rows[0].hrv, 41.2);
  equal(rows[0].weight, 87.8);
  equal(rows[0].spo2, 98.1);
  equal(rows[0].heartRateAutomaticSourceApp, "rhr.source");
  equal(rows[0].hrvAutomaticSourceApp, "hrv.source");
  equal(rows[0].weightAutomaticSourceApp, "weight.source");
  equal(rows[0].spo2AutomaticSourceApp, "spo2.source");
  equal(rows[0].analysisDataStatus, "STALE");
  equal(rows[0].analysisStaleReason, "RECOMPUTE_PENDING");
});

Deno.test("verified publication null blocks raw score metrics but still permits unsupported SpO2", () => {
  const date = "2026-09-19";
  const rows = projectPublishedDaily(snapshot({
    automatic: [
      // Keep SpO2 first: applying this allowed augmentation must not mutate the
      // publication guard used by the following score-backed domains.
      { domain: "spo2", local_date: date, affected_local_dates: [date], source_app: "spo2.source", daily_value: 98.1 },
      { domain: "resting_heart_rate", local_date: date, affected_local_dates: [date], source_app: "rhr.source", daily_value: 63 },
      { domain: "hrv", local_date: date, affected_local_dates: [date], source_app: "hrv.source", daily_value: 41.2 },
      { domain: "weight", local_date: date, affected_local_dates: [date], source_app: "weight.source", daily_value: 87.8 },
    ],
    queue: [{ score_date: date, status: "COMPLETE", generation: "4", engine_published_generation: "4" }],
    rows: [{
      output_kind: "activity",
      calculation_date: date,
      payload: { score_status: "INSUFFICIENT_DATA", engine_version: "activity-score-v1.0", metrics: { daily: {} } },
    }],
  }), "activity");
  equal(rows[0].heartRate, null);
  equal(rows[0].hrv, null);
  equal(rows[0].weight, null);
  equal(rows[0].spo2, 98.1);
  equal(rows[0].spo2Source, "WEARABLE_SYNC");
});

Deno.test("sleep stage and cardio inputs keep pending domain days without inventing values", () => {
  const automatic = [{
    domain: "sleep_stage",
    affected_local_dates: ["2026-09-19"],
  }, { domain: "heart_rate", affected_local_dates: ["2026-09-20"] }];
  const sleep = projectPublishedDaily(snapshot({ automatic }), "sleep"),
    activity = projectPublishedDaily(snapshot({ automatic }), "activity");
  deepStrictEqual(sleep.map((row) => row.date), ["2026-09-19"]);
  equal(sleep[0].totalSleepMinutes, null);
  deepStrictEqual(activity.map((row) => row.date), ["2026-09-20"]);
  equal(activity[0].heartRate, null);
});

Deno.test("pending automatic dates are range bounded and deduplicated", () => {
  const automatic = [
    {
      domain: "steps",
      affected_local_dates: ["2026-09-17", "2026-09-19", "2026-09-19"],
    },
    { domain: "steps", affected_local_dates: ["2026-09-21"] },
  ];
  deepStrictEqual(
    projectPublishedDaily(snapshot({ automatic }), "activity").map((row) =>
      row.date
    ),
    ["2026-09-19"],
  );
});

Deno.test("verified publication wins over the pending placeholder and preserves explicit zero", () => {
  const rows = projectPublishedDaily(
    snapshot({
      queue: [{
        score_date: "2026-09-19",
        status: "COMPLETE",
        generation: "3",
        engine_published_generation: "3",
      }],
      automatic: [{ domain: "steps", affected_local_dates: ["2026-09-19"] }],
      rows: [{
        output_kind: "activity",
        calculation_date: "2026-09-19",
        payload: {
          score_status: "VALID",
          engine_version: "activity-score-v1.0",
          calculated_at: "2026-09-19T01:00:00Z",
          input_fingerprint: "fp",
          metrics: { daily: { steps: 0, active_minutes: 0 } },
        },
      }],
    }),
    "activity",
  );
  equal(rows.length, 1);
  equal(rows[0].dataStatus, "CURRENT");
  equal(rows[0].steps, 0);
  equal(rows[0].activeMinutes, 0);
  equal(rows[0].source, "SQL_PUBLISHED_DAILY_METRICS");
});

Deno.test("generation mismatch stays stale/null instead of exposing stale numeric output", () => {
  const rows = projectPublishedDaily(
    snapshot({
      queue: [{
        score_date: "2026-09-19",
        status: "COMPLETE",
        generation: "4",
        engine_published_generation: "3",
      }],
      rows: [{
        output_kind: "activity",
        calculation_date: "2026-09-19",
        payload: {
          score_status: "VALID",
          engine_version: "activity-score-v1.0",
          metrics: { daily: { steps: 8420 } },
        },
      }],
    }),
    "activity",
  );
  equal(rows[0].dataStatus, "STALE");
  equal(rows[0].steps, null);
});

Deno.test("manual daily total overlays the same day without summing another source", () => {
  const manual = [{
    local_date: "2026-09-19",
    domain: "steps",
    body: {
      recordId: "manual-steps",
      domain: "steps",
      date: "2026-09-19",
      value: 8000,
      coverage: "FULL_DAY",
    },
  }];
  const rows = projectPublishedDaily(snapshot({ manual }), "activity");
  equal(rows.length, 1);
  equal(rows[0].steps, 8000);
  equal(rows[0].dataStatus, "CURRENT");
  equal(rows[0].analysisDataStatus, "CURRENT");
  equal(rows[0].source, "SQL_CANONICAL_MANUAL_AND_PUBLISHED");
});

Deno.test("manual sleep stays visible when native sleep arrives without summing sources", () => {
  const manual = [{
    local_date: "2026-09-19",
    domain: "sleep",
    body: {
      recordId: "manual-sleep",
      domain: "sleep",
      date: "2026-09-19",
      value: 460,
      coverage: "SESSION",
      startedAt: "2026-09-18T23:30:00+08:00",
      endedAt: "2026-09-19T07:10:00+08:00",
    },
  }];
  const automatic = [
    { domain: "sleep", affected_local_dates: ["2026-09-19"] },
    { domain: "sleep_stage", affected_local_dates: ["2026-09-19"] },
  ];
  const rows = projectPublishedDaily(
    snapshot({ manual, automatic }),
    "sleep",
  );
  equal(rows.length, 1);
  equal(rows[0].totalSleepMinutes, 460);
  equal(rows[0].dataStatus, "CURRENT");
  equal(rows[0].analysisDataStatus, "STALE");
  equal(rows[0].analysisStaleReason, "PUBLICATION_NOT_AVAILABLE");
  equal(rows[0].source, "SQL_CANONICAL_MANUAL_AND_PUBLISHED");
  equal(rows[0].manualProvenance, "SELF_REPORTED_UNKNOWN_QUALITY");
  deepStrictEqual(rows[0].reconciliationFlags, ["SOURCE_CONFLICT:sleep"]);
});

Deno.test("verified native sleep remains analysis evidence while manual sleep is the displayed value", () => {
  const manual = [{
    local_date: "2026-09-19",
    domain: "sleep",
    body: {
      recordId: "manual-sleep",
      domain: "sleep",
      date: "2026-09-19",
      value: 460,
      coverage: "SESSION",
      startedAt: "2026-09-18T23:30:00+08:00",
      endedAt: "2026-09-19T07:10:00+08:00",
    },
  }];
  const rows = projectPublishedDaily(snapshot({
    manual,
    automatic: [{ domain: "sleep", affected_local_dates: ["2026-09-19"] }],
    queue: [{ score_date: "2026-09-19", status: "COMPLETE", generation: "3", engine_published_generation: "3" }],
    rows: [{
      output_kind: "sleep",
      calculation_date: "2026-09-19",
      payload: {
        score_status: "VALID",
        engine_version: "sleep-score-v1.0",
        calculated_at: "2026-09-19T01:00:00Z",
        input_fingerprint: "fp",
        metrics: { daily: { sleep_minutes: 420 } },
      },
    }],
  }), "sleep");
  equal(rows[0].totalSleepMinutes, 460);
  equal(rows[0].analysisDataStatus, "CURRENT");
  deepStrictEqual(rows[0].reconciliationFlags, ["SOURCE_CONFLICT:sleep"]);
});

Deno.test("manual overlap remains unavailable even when a native source also conflicts", () => {
  const manual = [{
    local_date: "2026-09-19",
    domain: "sleep",
    body: { recordId: "night", domain: "sleep", date: "2026-09-19", value: 420, coverage: "SESSION", startedAt: "2026-09-18T23:00:00+08:00", endedAt: "2026-09-19T06:00:00+08:00" },
  }, {
    local_date: "2026-09-19",
    domain: "sleep",
    body: { recordId: "overlap", domain: "sleep", date: "2026-09-19", value: 30, coverage: "SESSION", startedAt: "2026-09-19T05:30:00+08:00", endedAt: "2026-09-19T06:00:00+08:00" },
  }];
  const rows = projectPublishedDaily(snapshot({
    manual,
    automatic: [{ domain: "sleep", affected_local_dates: ["2026-09-19"] }],
  }), "sleep");
  equal(rows[0].totalSleepMinutes, null);
  deepStrictEqual(rows[0].reconciliationFlags, [
    "SOURCE_CONFLICT:sleep",
    "OVERLAP_CONFLICT:sleep",
  ]);
});

Deno.test("manual activity totals stay visible beside native inputs without double counting", () => {
  const manual = [{
    local_date: "2026-09-19",
    domain: "steps",
    body: {
      recordId: "manual-steps",
      domain: "steps",
      date: "2026-09-19",
      value: 8000,
      coverage: "FULL_DAY",
    },
  }, {
    local_date: "2026-09-19",
    domain: "total_energy",
    body: {
      recordId: "manual-energy",
      domain: "total_energy",
      date: "2026-09-19",
      value: 2250,
      coverage: "FULL_DAY",
    },
  }];
  const automatic = [
    { domain: "steps", affected_local_dates: ["2026-09-19"] },
    { domain: "energy", affected_local_dates: ["2026-09-19"] },
  ];
  const rows = projectPublishedDaily(
    snapshot({ manual, automatic }),
    "activity",
  );
  equal(rows.length, 1);
  equal(rows[0].steps, 8000);
  equal(rows[0].totalCalories, 2250);
  deepStrictEqual(rows[0].reconciliationFlags, [
    "SOURCE_CONFLICT:steps",
    "SOURCE_CONFLICT:total_energy",
  ]);
});

Deno.test("manual-only value keeps a dirty recompute visibly pending without hiding the value", () => {
  const manual = [{
    local_date: "2026-09-19",
    domain: "steps",
    body: {
      recordId: "manual-steps",
      domain: "steps",
      date: "2026-09-19",
      value: 8000,
      coverage: "FULL_DAY",
    },
  }];
  const queue = [{
    score_date: "2026-09-19",
    status: "DIRTY",
    generation: "2",
    engine_published_generation: "1",
  }];
  const rows = projectPublishedDaily(snapshot({ manual, queue }), "activity");
  equal(rows[0].steps, 8000);
  equal(rows[0].dataStatus, "CURRENT");
  equal(rows[0].staleReason, null);
  equal(rows[0].analysisDataStatus, "STALE");
  equal(rows[0].analysisStaleReason, "RECOMPUTE_PENDING");
});

Deno.test("manual-only value preserves a failed recompute as an analysis error state", () => {
  const manual = [{
    local_date: "2026-09-19",
    domain: "total_energy",
    body: {
      recordId: "manual-energy",
      domain: "total_energy",
      date: "2026-09-19",
      value: 2250,
      coverage: "FULL_DAY",
    },
  }];
  const queue = [{
    score_date: "2026-09-19",
    status: "FAILED",
    generation: "2",
    engine_published_generation: "1",
  }];
  const rows = projectPublishedDaily(snapshot({ manual, queue }), "activity");
  equal(rows[0].totalCalories, 2250);
  equal(rows[0].dataStatus, "CURRENT");
  equal(rows[0].staleReason, null);
  equal(rows[0].analysisDataStatus, "STALE");
  equal(rows[0].analysisStaleReason, "RECOMPUTE_FAILED");
});

Deno.test("manual steps preserve pending automatic cardio publication as a separate stale state", () => {
  const manual = [{
    local_date: "2026-09-19",
    domain: "steps",
    body: {
      recordId: "manual-steps",
      domain: "steps",
      date: "2026-09-19",
      value: 8000,
      coverage: "FULL_DAY",
    },
  }];
  const automatic = [{
    domain: "heart_rate",
    affected_local_dates: ["2026-09-19"],
  }];
  const rows = projectPublishedDaily(
    snapshot({ manual, automatic }),
    "activity",
  );
  equal(rows[0].steps, 8000);
  equal(rows[0].heartRate, null);
  equal(rows[0].dataStatus, "CURRENT");
  equal(rows[0].analysisDataStatus, "STALE");
  equal(rows[0].analysisStaleReason, "PUBLICATION_NOT_AVAILABLE");
});

Deno.test("manual energy does not mask a generation-mismatched activity head", () => {
  const manual = [{
    local_date: "2026-09-19",
    domain: "total_energy",
    body: {
      recordId: "manual-energy",
      domain: "total_energy",
      date: "2026-09-19",
      value: 2250,
      coverage: "FULL_DAY",
    },
  }];
  const queue = [{
    score_date: "2026-09-19",
    status: "COMPLETE",
    generation: "4",
    engine_published_generation: "3",
  }];
  const rows = [{
    output_kind: "activity",
    calculation_date: "2026-09-19",
    payload: {
      score_status: "VALID",
      engine_version: "activity-score-v1.0",
      metrics: { daily: { average_hr: 72, hrv: 40 } },
    },
  }];
  const projected = projectPublishedDaily(
    snapshot({ manual, queue, rows }),
    "activity",
  );
  equal(projected[0].totalCalories, 2250);
  equal(projected[0].heartRate, null);
  equal(projected[0].dataStatus, "CURRENT");
  equal(projected[0].analysisDataStatus, "STALE");
  equal(
    projected[0].analysisStaleReason,
    "PUBLICATION_GENERATION_NOT_VERIFIED",
  );
});

Deno.test("unreconciled Fitbit and Google Fit total-energy intervals remain a null daily gap", () => {
  const rows = projectPublishedDaily(snapshot({
    automatic: [
      { domain: "total_energy", source_app: "com.fitbit.FitbitMobile", daily_value: 90.5, affected_local_dates: ["2026-09-19"] },
      { domain: "total_energy", source_app: "com.google.android.apps.fitness", daily_value: 92.0, affected_local_dates: ["2026-09-19"] },
    ],
  }), "activity");
  equal(rows.length, 1);
  equal(rows[0].date, "2026-09-19");
  equal(rows[0].totalCalories, null);
  equal(rows[0].activeCalories, null);
  equal(rows[0].dataStatus, "STALE");
});

Deno.test("verified cardio publication coexists with a manual daily steps override", () => {
  const manual = [{
    local_date: "2026-09-19",
    domain: "steps",
    body: {
      recordId: "manual-steps",
      domain: "steps",
      date: "2026-09-19",
      value: 8000,
      coverage: "FULL_DAY",
    },
  }];
  const queue = [{
    score_date: "2026-09-19",
    status: "COMPLETE",
    generation: "3",
    engine_published_generation: "3",
  }];
  const rows = [{
    output_kind: "activity",
    calculation_date: "2026-09-19",
    payload: {
      score_status: "VALID",
      engine_version: "activity-score-v1.0",
      metrics: { daily: { steps: 7200, average_hr: 72.5, resting_hr: 63, hrv: 41.2 } },
    },
  }];
  const projected = projectPublishedDaily(
    snapshot({ manual, queue, rows }),
    "activity",
  );
  equal(projected[0].steps, 8000);
  equal(projected[0].heartRate, 63);
  equal(projected[0].hrv, 41.2);
  equal(projected[0].stepsSource, "SELF_REPORTED_UNKNOWN_QUALITY");
  equal(projected[0].heartRateSource, "SQL_PUBLISHED_DAILY_METRICS");
  equal(projected[0].hrvSource, "SQL_PUBLISHED_DAILY_METRICS");
  equal(projected[0].dataStatus, "CURRENT");
  equal(projected[0].analysisDataStatus, "CURRENT");
});

Deno.test("published activity exposes automatic body values and resting-heart-rate fallback with metric provenance", () => {
  const rows = projectPublishedDaily(
    snapshot({
      queue: [{
        score_date: "2026-09-19",
        status: "COMPLETE",
        generation: "3",
        engine_published_generation: "3",
      }],
      rows: [{
        output_kind: "activity",
        calculation_date: "2026-09-19",
        payload: {
          score_status: "INSUFFICIENT_DATA",
          engine_version: "activity-score-v1.0",
          metrics: { daily: { weight: 87.8, body_fat: 29.2, average_hr: null, resting_hr: 63, hrv: 41.2 } },
        },
      }],
    }),
    "activity",
  );
  equal(rows[0].weight, 87.8);
  equal(rows[0].bodyFatPercentage, 29.2);
  equal(rows[0].heartRate, 63);
  equal(rows[0].weightSource, "SQL_PUBLISHED_DAILY_METRICS");
  equal(rows[0].bodyFatPercentageSource, "SQL_PUBLISHED_DAILY_METRICS");
  equal(rows[0].heartRateSource, "SQL_PUBLISHED_DAILY_METRICS");
});

Deno.test("raw automatic read collapses high-frequency records to bounded domain/date rows", async () => {
  deepStrictEqual(PUBLISHED_DAILY_AUTOMATIC_DOMAINS, [
    "sleep",
    "sleep_stage",
    "steps",
    "energy",
    "total_energy",
    "heart_rate",
    "resting_heart_rate",
    "hrv",
    "weight",
    "spo2",
  ]);
  const sleepStages = Array.from(
    { length: 5001 },
    (_, index) => ({
      domain: "sleep_stage",
      affected_local_dates: [
        "2026-09-19",
        index % 2 ? "2026-09-20" : "2026-09-19",
      ],
    }),
  );
  equal(
    relevantPublishedDailyAutomaticRows([...sleepStages, {
      domain: "irrelevant",
      affected_local_dates: ["2026-09-19"],
    }]).length,
    5001,
  );
  deepStrictEqual(collapseRelevantPublishedDailyAutomaticRows(sleepStages), [{
    domain: "sleep_stage",
    affected_local_dates: ["2026-09-19", "2026-09-20"],
  }]);
  const source = await Deno.readTextFile(
    new URL(
      "../supabase/functions/mobile-health-beta/manual-daily-read.ts",
      import.meta.url,
    ),
  );
  for (
    const contract of [
      /cross join lateral unnest\(r\.affected_local_dates\)/u,
      /r\.affected_local_dates && array\(select generate_series\(\$\{range\.start\}::date,\$\{range\.end\}::date,'1 day'\)::date\)/u,
      /group by r\.domain,affected\.local_date,r\.source_app/u,
      /row_number\(\) over\(partition by domain,local_date[\s\S]*record_count desc,newest_at desc/u,
      /from ranked where source_rank=1/u,
      /case\s+when r\.domain='steps' then sum/u,
      /when r\.domain='resting_heart_rate' then avg/u,
      /when r\.domain='spo2' then avg/u,
      /case when r\.domain='sleep' then range_agg/u,
      /from unnest\(interval_ranges\) span/u,
      /canonical_record->>'unit'='count'/u,
      /canonical_record->>'unit'='bpm'/u,
      /canonical_record->>'unit'='minute'/u,
      /canonical_record->>'unit'='percent'/u,
    ]
  ) {
    if (!contract.test(source)) {
      throw Error(`AUTOMATIC_DOMAIN_DATE_COLLAPSE_MISSING:${contract}`);
    }
  }
  const energyRead = source.split("const energy=await tx`")[1]?.split("`;")[0] ?? "";
  for (const contract of [
    /r\.canonical_user_id=\$\{identity\.canonical\}/u,
    /r\.domain='total_energy'/u,
    /r\.operation='UPSERT' and r\.invalidated_at is null/u,
    /r\.affected_local_dates && array\(select generate_series/u,
    /limit \$\{TOTAL_ENERGY_READ_LIMIT\+1\}/u,
  ]) {
    if (!contract.test(energyRead)) throw Error(`TOTAL_ENERGY_SCOPED_READ_MISSING:${contract}`);
  }
});

Deno.test("pending native total energy keeps its local day as a null gap", () => {
  const rows = projectPublishedDaily(
    snapshot({
      automatic: [{ domain: "energy", affected_local_dates: ["2026-09-19"] }],
    }),
    "activity",
  );
  equal(rows.length, 1);
  equal(rows[0].date, "2026-09-19");
  equal(rows[0].totalCalories, null);
  equal(rows[0].dataStatus, "STALE");
});

Deno.test("automatic input without an output head preserves queue failure and pending reasons", () => {
  const automatic = [{ domain: "steps", affected_local_dates: ["2026-09-19"] }];
  const failed = projectPublishedDaily(snapshot({automatic,queue:[{score_date:"2026-09-19",status:"FAILED",generation:"2",engine_published_generation:"1"}]}),"activity");
  equal(failed[0].staleReason,"RECOMPUTE_FAILED");
  const pending = projectPublishedDaily(snapshot({automatic,queue:[{score_date:"2026-09-19",status:"DIRTY",generation:"2",engine_published_generation:"1"}]}),"activity");
  equal(pending[0].staleReason,"RECOMPUTE_PENDING");
  const mismatched = projectPublishedDaily(snapshot({automatic,queue:[{score_date:"2026-09-19",status:"COMPLETE",generation:"2",engine_published_generation:"1"}]}),"activity");
  equal(mismatched[0].staleReason,"PUBLICATION_GENERATION_NOT_VERIFIED");
});

Deno.test("queue-only dates preserve failure and pending evidence without inventing values", () => {
  for(const [status,reason] of [["FAILED","RECOMPUTE_FAILED"],["DIRTY","RECOMPUTE_PENDING"],["PROCESSING","RECOMPUTE_PENDING"]]){
    const rows=projectPublishedDaily(snapshot({queue:[{score_date:"2026-09-19",status,generation:"2",engine_published_generation:"0"}]}),"activity");
    equal(rows.length,1);equal(rows[0].date,"2026-09-19");equal(rows[0].dataStatus,"STALE");equal(rows[0].staleReason,reason);equal(rows[0].steps,null);
  }
});

Deno.test("published activity never labels a daily average as resting heart rate", () => {
  const rows = projectPublishedDaily(
    snapshot({
      queue: [{
        score_date: "2026-09-19",
        status: "COMPLETE",
        generation: "3",
        engine_published_generation: "3",
      }],
      rows: [{
        output_kind: "activity",
        calculation_date: "2026-09-19",
        payload: {
          score_status: "VALID",
          engine_version: "activity-score-v1.0",
          metrics: { daily: { average_hr: 72.5, hrv: 41.2 } },
        },
      }],
    }),
    "activity",
  );
  equal(rows[0].heartRate, null);
  equal(rows[0].heartRateSource, null);
  equal(rows[0].hrv, 41.2);
});
