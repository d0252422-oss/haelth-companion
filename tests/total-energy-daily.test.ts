import { deepStrictEqual, equal } from "node:assert/strict";
import { projectCompleteTotalEnergyDays } from "../supabase/functions/mobile-health-beta/total-energy-daily.ts";
import { projectPublishedDaily } from "../supabase/functions/mobile-health-beta/manual-daily-read.ts";

const DAY = "2026-09-19";
const DAY_START = Date.parse(DAY + "T00:00:00+08:00");
const AFTER_DAY = Date.parse("2026-09-21T00:00:00+08:00");
const range = { start: DAY, end: "2026-09-20" };
type Input = Parameters<typeof projectCompleteTotalEnergyDays>[0][number];
function interval(
  startMinute: number,
  endMinute: number,
  value: number,
  extra: Partial<Input> = {},
): Input {
  return {
    platform: "android",
    source_app: "com.fitbit.FitbitMobile",
    source_record_id: `fitbit-${startMinute}-${endMinute}`,
    source_revision: 1,
    source_updated_at: "2026-09-21T00:00:00Z",
    updated_at: "2026-09-21T00:00:00Z",
    affected_local_dates: [DAY, "2026-09-20"],
    started_at: new Date(DAY_START + startMinute * 60_000).toISOString(),
    ended_at: new Date(DAY_START + endMinute * 60_000).toISOString(),
    value,
    unit: "kcal",
    ...extra,
  };
}
const fitbitDay = () =>
  Array.from({ length: 96 }, (_, i) => interval(i * 15, (i + 1) * 15, 25));

Deno.test("full-day source selection never adds Fitbit and Google Fit together", () => {
  const google = interval(0, 1440, 3000, {
    source_app: "com.google.android.apps.fitness",
    source_record_id: "google-day",
  });
  const selected = projectCompleteTotalEnergyDays(
    [...fitbitDay(), google],
    range,
    AFTER_DAY,
  );
  equal(selected.get(DAY)?.value, 2400);
  equal(selected.get(DAY)?.sourceApp, "com.fitbit.FitbitMobile");
  equal(selected.get(DAY)?.intervalCount, 96);
  equal(selected.get(DAY)?.allocation, "PROPORTIONAL_INTERVAL_SPLIT");
});

Deno.test("exact-window correction is selected once using the latest source update", () => {
  const corrected = interval(0, 15, 30, {
    source_record_id: "fitbit-correction",
    source_revision: 2,
    source_updated_at: "2026-09-22T00:00:00Z",
  });
  const rows = [...fitbitDay(), corrected];
  equal(
    projectCompleteTotalEnergyDays(rows, range, AFTER_DAY).get(DAY)?.value,
    2405,
  );
  equal(
    projectCompleteTotalEnergyDays([...rows].reverse(), range, AFTER_DAY).get(
      DAY,
    )?.value,
    2405,
  );
});

Deno.test("cross-midnight interval is divided by duration without double counting", () => {
  const rows = [
    interval(0, 1410, 2350),
    interval(1410, 1470, 100),
    interval(1470, 2880, 2350),
  ];
  const projected = projectCompleteTotalEnergyDays(rows, range, AFTER_DAY);
  equal(projected.get(DAY)?.value, 2400);
  equal(projected.get("2026-09-20")?.value, 2400);
});

Deno.test("missing coverage or same-source overlap cannot become a daily total", () => {
  const missing = fitbitDay().slice(1);
  equal(
    projectCompleteTotalEnergyDays(missing, range, AFTER_DAY).get(DAY),
    undefined,
  );
  const overlap = [interval(0, 1440, 2400), interval(720, 1440, 1200)];
  equal(
    projectCompleteTotalEnergyDays(overlap, range, AFTER_DAY).get(DAY),
    undefined,
  );
  const cleanOtherSource = interval(0, 1440, 2500, {
    source_app: "com.google.android.apps.fitness",
    source_record_id: "google-day",
  });
  equal(
    projectCompleteTotalEnergyDays(
      [...overlap, cleanOtherSource],
      range,
      AFTER_DAY,
    ).get(DAY)?.value,
    2500,
  );
});

Deno.test("invalid record and unfinished current day fail closed", () => {
  const invalid = interval(0, 15, 25, {
    source_record_id: "invalid",
    unit: "cal",
  });
  equal(
    projectCompleteTotalEnergyDays([...fitbitDay(), invalid], range, AFTER_DAY)
      .get(DAY),
    undefined,
  );
  const todayAtNoon = Date.parse("2026-09-19T12:00:00+08:00");
  equal(
    projectCompleteTotalEnergyDays(fitbitDay(), range, todayAtNoon).get(DAY),
    undefined,
  );
});

Deno.test("seven-day readback keeps only five complete Taipei days", () => {
  const rows: Input[] = [];
  for (let day = 0; day < 7; day++) {
    const date = new Date(Date.parse(DAY + "T00:00:00Z") + day * 86_400_000)
      .toISOString().slice(0, 10);
    const first = day === 0 ? 1 : 0;
    const count = day === 6 ? 88 : 96;
    for (let i = first; i < count; i++) {
      rows.push(interval(day * 1440 + i * 15, day * 1440 + (i + 1) * 15, 25, {
        affected_local_dates: [date],
      }));
    }
  }
  const projected = projectCompleteTotalEnergyDays(
    rows,
    { start: DAY, end: "2026-09-25" },
    Date.parse("2026-09-25T23:23:00+08:00"),
  );
  deepStrictEqual([...projected.keys()].sort(), [
    "2026-09-20",
    "2026-09-21",
    "2026-09-22",
    "2026-09-23",
    "2026-09-24",
  ]);
  equal(projected.get("2026-09-19"), undefined);
  equal(projected.get("2026-09-25"), undefined);
});

Deno.test("activity readback publishes complete wearable total while preserving failed score analysis", () => {
  const [row] = projectPublishedDaily({
    queue: [{
      score_date: DAY,
      status: "FAILED",
      generation: "4",
      engine_published_generation: "0",
    }],
    automatic: [{ domain: "total_energy", affected_local_dates: [DAY] }],
    energy: fitbitDay(),
    manual: [],
    rows: [],
    range: { start: DAY, end: DAY },
    asOfMs: AFTER_DAY,
  }, "activity");
  equal(row.date, DAY);
  equal(row.totalCalories, 2400);
  equal(row.totalEnergySource, "WEARABLE_SYNC");
  equal(row.coverage.totalEnergy, "FULL_DAY");
  equal(row.dataStatus, "CURRENT");
  equal(row.analysisDataStatus, "STALE");
  equal(row.analysisStaleReason, "RECOMPUTE_FAILED");
});

Deno.test("manual daily total remains display preference; truncated raw read does not fabricate value", () => {
  const base = {
    queue: [],
    automatic: [{ domain: "total_energy", affected_local_dates: [DAY] }],
    energy: fitbitDay(),
    rows: [],
    range: { start: DAY, end: DAY },
    asOfMs: AFTER_DAY,
  };
  const [manual] = projectPublishedDaily({
    ...base,
    manual: [{
      local_date: DAY,
      domain: "total_energy",
      body: {
        recordId: "manual-energy",
        domain: "total_energy",
        date: DAY,
        value: 2250,
        coverage: "FULL_DAY",
      },
    }],
  }, "activity");
  equal(manual.totalCalories, 2250);
  equal(manual.totalEnergySource, "SELF_REPORTED_UNKNOWN_QUALITY");
  const [truncated] = projectPublishedDaily({
    ...base,
    manual: [],
    energyReadTruncated: true,
  }, "activity");
  equal(truncated.totalCalories, null);
  deepStrictEqual(truncated.steps, null);
});

Deno.test("manual steps do not erase wearable total-energy coverage", () => {
  const [row] = projectPublishedDaily({
    queue: [],
    automatic: [{ domain: "total_energy", affected_local_dates: [DAY] }],
    energy: fitbitDay(),
    manual: [{
      local_date: DAY,
      domain: "steps",
      body: {
        recordId: "manual-steps",
        domain: "steps",
        date: DAY,
        value: 8000,
        coverage: "FULL_DAY",
      },
    }],
    rows: [],
    range: { start: DAY, end: DAY },
    asOfMs: AFTER_DAY,
  }, "activity");
  equal(row.steps, 8000);
  equal(row.totalCalories, 2400);
  equal(row.totalEnergySource, "WEARABLE_SYNC");
  equal(row.coverage.totalEnergy, "FULL_DAY");
});
