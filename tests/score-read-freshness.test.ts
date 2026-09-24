import assert from "node:assert/strict";
import { canonicalScoreDate, scoreRecomputeStatus, selectScoreRowsForDate } from "../supabase/functions/mobile-health-beta/score-read-contract.ts";

Deno.test("latest score read never mixes or overwrites with an older date", () => {
  const latest = "2026-09-20";
  const older = "2026-09-19";
  const rows = [
    { score_date: latest, score_type: "activity", score: 91 },
    { score_date: latest, score_type: "sleep", score: 81 },
    { score_date: older, score_type: "activity", score: 11 },
    { score_date: older, score_type: "body_composition", score: 12 },
    { score_date: older, score_type: "fatigue", score: 13 },
    { score_date: older, score_type: "health_overall", score: 14 },
    { score_date: older, score_type: "nutrition", score: 15 },
    { score_date: older, score_type: "recovery", score: 16 },
  ];
  const selected = selectScoreRowsForDate(rows);
  assert.equal(selected.selectedDate, latest);
  assert.deepEqual(selected.selectedRows, rows.slice(0, 2));
  assert.equal(Object.fromEntries(selected.selectedRows.map(row => [row.score_type, row])).activity.score, 91);
});

Deno.test("explicit score date selects only that canonical local date", () => {
  const rows = [
    { score_date: "2026-09-20", score_type: "sleep" },
    { score_date: "2026-09-19", score_type: "sleep" },
  ];
  const selected = selectScoreRowsForDate(rows, "2026-09-19");
  assert.equal(selected.selectedDate, "2026-09-19");
  assert.deepEqual(selected.selectedRows, [rows[1]]);
});

Deno.test("score freshness mapping fails closed instead of reporting failed work current", () => {
  assert.equal(scoreRecomputeStatus("UPDATING"), "QUEUED");
  assert.equal(scoreRecomputeStatus("PARTIAL"), "PARTIAL");
  assert.equal(scoreRecomputeStatus("UP_TO_DATE"), "CURRENT");
  assert.equal(scoreRecomputeStatus("FAILED"), "UNKNOWN");
  assert.equal(scoreRecomputeStatus(undefined), "UNKNOWN");
});

Deno.test("score date rejects impossible calendar dates at the request boundary contract", () => {
  assert.equal(canonicalScoreDate("2026-09-20"), "2026-09-20");
  assert.throws(() => canonicalScoreDate("2026-02-31"), /INVALID_SCORE_DATE/);
  assert.throws(() => canonicalScoreDate("2026-9-20"), /INVALID_SCORE_DATE/);
});
