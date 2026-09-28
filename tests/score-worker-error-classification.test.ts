import assert from "node:assert/strict";
import { scoreWorkerFailureCode } from "../supabase/functions/mobile-health-beta/background-runtime.ts";

Deno.test("scheduled score worker persists only bounded diagnostic error codes", () => {
  assert.equal(scoreWorkerFailureCode(new Error("SCORE_INPUT_BOUND_EXCEEDED")), "SCORE_INPUT_BOUND_EXCEEDED");
  assert.equal(scoreWorkerFailureCode(new Error("SCORE_STAGE_ENGINE_COMPUTE")), "SCORE_STAGE_ENGINE_COMPUTE");
  assert.equal(scoreWorkerFailureCode({ code: "42501", message: "permission denied for private table" }), "SCORE_SQL_PERMISSION_DENIED");
  assert.equal(scoreWorkerFailureCode(new Error("private health value or SQL details")), "WORKER_RECOMPUTE_FAILED");
  assert.equal(scoreWorkerFailureCode(new Error("SECRET_LIKE_UPPERCASE_STRING")), "WORKER_RECOMPUTE_FAILED");
});

Deno.test("scheduled drain passes the classified code to the existing failure RPC", async () => {
  const source = await Deno.readTextFile(new URL("../supabase/functions/mobile-health-beta/background-runtime.ts", import.meta.url));
  assert.match(source, /failureCodes\.push\(failureCode\)/);
  assert.match(source, /beta_fail_score_recompute\([^\n]+\$\{failureCode\},true\)/);
  assert.doesNotMatch(source, /beta_fail_score_recompute\([^\n]+,'WORKER_RECOMPUTE_FAILED',true\)/);
});
