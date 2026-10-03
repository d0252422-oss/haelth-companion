// Safe bounded labels for score-worker failures. The original exception stays
// in memory as a cause and must never be serialized into logs or receipts.
export type ScoreFailureStage =
  | "INPUT_ASSEMBLER" | "ENGINE_COMPUTE" | "ENGINE_PUBLICATION" | "FROZEN_SCORE";

export class ScoreStageFailure extends Error {
  readonly stage: ScoreFailureStage;
  readonly rootCause: unknown;

  constructor(stage: ScoreFailureStage, rootCause: unknown) {
    super(`SCORE_STAGE_${stage}`);
    this.name = "ScoreStageFailure";
    this.stage = stage;
    this.rootCause = rootCause;
  }
}

const errorStages = new WeakMap<object, ScoreFailureStage>();

export function scoreStageOf(error: unknown): ScoreFailureStage | null {
  if (error instanceof ScoreStageFailure) return error.stage;
  return error !== null && typeof error === "object" ? errorStages.get(error) ?? null : null;
}

export async function inScoreStage<T>(stage: ScoreFailureStage, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error !== null && typeof error === "object") {
      if (!scoreStageOf(error)) errorStages.set(error, stage);
      throw error; // Preserve existing stale/lease/SQL error contracts.
    }
    throw new ScoreStageFailure(stage, error);
  }
}

export function scoreFailureDiagnostic(error: unknown, inputDate: string, classify: (error: unknown) => string) {
  const stage = scoreStageOf(error) ?? "OTHER";
  const root = error instanceof ScoreStageFailure ? error.rootCause : error;
  const className = root instanceof Error ? root.constructor.name : "OTHER";
  const exceptionClass = ["Error", "TypeError", "RangeError", "PostgresError", "TimeoutError"]
    .includes(className) ? className : "OTHER";
  return {
    failure_stage: stage,
    reason_code: classify(root),
    exception_class: exceptionClass,
    input_date: /^\d{4}-\d{2}-\d{2}$/.test(inputDate) ? inputDate : "INVALID_DATE",
  };
}
