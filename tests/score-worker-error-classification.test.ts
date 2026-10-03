import assert from "node:assert/strict";
import { scoreWorkerFailureCode } from "../supabase/functions/mobile-health-beta/background-runtime.ts";
import { scoreErrorCode } from "../supabase/functions/mobile-health-beta/index.ts";
import { inScoreStage, scoreFailureDiagnostic, scoreStageOf } from "../supabase/functions/mobile-health-beta/score-stage-diagnostic.ts";

Deno.test("scheduled score worker persists only bounded diagnostic error codes", () => {
  assert.equal(scoreWorkerFailureCode(new Error("SCORE_INPUT_BOUND_EXCEEDED")), "SCORE_INPUT_BOUND_EXCEEDED");
  assert.equal(scoreWorkerFailureCode(new Error("SCORE_STAGE_ENGINE_COMPUTE")), "SCORE_STAGE_ENGINE_COMPUTE");
  assert.equal(scoreWorkerFailureCode(new Error("SCORE_STAGE_INPUT_ASSEMBLER")), "SCORE_STAGE_INPUT_ASSEMBLER");
  assert.equal(scoreWorkerFailureCode({ code: "42501", message: "permission denied for private table" }), "SCORE_SQL_PERMISSION_DENIED");
  assert.equal(scoreWorkerFailureCode(new Error("private health value or SQL details")), "WORKER_RECOMPUTE_FAILED");
  assert.equal(scoreWorkerFailureCode(new Error("SECRET_LIKE_UPPERCASE_STRING")), "WORKER_RECOMPUTE_FAILED");
});

Deno.test("stage diagnostics retain cause in memory but expose only safe labels", async () => {
  const secret = "sensitive-health-value-and-token";
  let captured: unknown;
  try {
    await inScoreStage("INPUT_ASSEMBLER", async () => { throw new Error(secret); });
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof Error);
  assert.equal(captured.message, secret);
  assert.equal(scoreStageOf(captured), "INPUT_ASSEMBLER");
  assert.equal(scoreWorkerFailureCode(captured), "SCORE_STAGE_INPUT_ASSEMBLER");
  const safe = scoreFailureDiagnostic(captured, "2026-10-03", scoreErrorCode);
  assert.deepEqual(safe, {
    failure_stage: "INPUT_ASSEMBLER", reason_code: "SCORE_RECOMPUTE_FAILED",
    exception_class: "Error", input_date: "2026-10-03",
  });
  assert.ok(!JSON.stringify(safe).includes(secret));
  let nested: unknown;
  try {
    await inScoreStage("FROZEN_SCORE", () => inScoreStage("ENGINE_COMPUTE", async () => { throw new TypeError(secret); }));
  } catch (error) {
    nested = error;
  }
  assert.ok(nested instanceof TypeError);
  assert.equal(scoreStageOf(nested), "ENGINE_COMPUTE");
  assert.equal(scoreFailureDiagnostic(nested, "unsafe", scoreErrorCode).input_date, "INVALID_DATE");
  const stale = new Error("STALE_SCORE_INPUT");
  await assert.rejects(inScoreStage("ENGINE_PUBLICATION", async () => { throw stale; }), /STALE_SCORE_INPUT/);
  assert.equal(scoreStageOf(stale), "ENGINE_PUBLICATION");
  assert.equal(scoreWorkerFailureCode(stale), "STALE_SCORE_INPUT");
});

Deno.test("scheduled drain passes the classified code to the existing failure RPC", async () => {
  const source = await Deno.readTextFile(new URL("../supabase/functions/mobile-health-beta/background-runtime.ts", import.meta.url));
  assert.match(source, /failureCodes\.push\(failureCode\)/);
  assert.match(source, /SCORE_RECOMPUTE_DIAGNOSTIC/);
  assert.match(source, /beta_fail_score_recompute\([^\n]+\$\{failureCode\},true\)/);
  assert.doesNotMatch(source, /beta_fail_score_recompute\([^\n]+,'WORKER_RECOMPUTE_FAILED',true\)/);
});
