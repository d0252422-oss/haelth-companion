import "../../../fixtures/algorithm-golden/apps-script-health-score-v1.0.snapshot.js";

type Json = Record<string, unknown>;
type ScoreResult = {
  score: number | null;
  completeness: number;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  status: string;
  missingData?: string[];
  dependencyAdjustment?: string;
};
type Runtime = {
  algorithmVersion: string;
  calculateSleepScore(input: Json): ScoreResult;
  calculateActivityScore(input: Json): ScoreResult;
  calculateTrainingScore(input: Json): ScoreResult;
  calculateNutritionScore(input: Json): ScoreResult;
  calculateBodyCompositionScore(input: Json): ScoreResult;
  calculateRecoveryScore(input: Json): ScoreResult;
  calculateFatigueIndex(input: Json): ScoreResult;
  calculateHealthScore(input: Json): ScoreResult;
};
type HealthRow = {
  id: string;
  domain: string;
  source_app: string;
  source_record_id: string;
  source_revision: number;
  source_updated_at: string | null;
  source_content_hash: string;
  canonical_record: Json;
  affected_local_dates: string[];
  updated_at: string;
};

const runtime = (globalThis as unknown as { HEALTH_SCORE_V1_RUNTIME: Runtime }).HEALTH_SCORE_V1_RUNTIME;
if (!runtime || runtime.algorithmVersion !== "health-score-v1.0") throw new Error("FROZEN_SCORE_RUNTIME_UNAVAILABLE");

const SCORE_TYPES = [
  "sleep", "activity", "training", "nutrition", "body_composition", "recovery", "fatigue", "health_overall",
] as const;

export async function recomputeBetaScore(admin: any, userId: string, localDate: string): Promise<Json> {
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new Error("INVALID_SCORE_SCOPE");
  const { data: generationRows, error: generationError } = await admin.rpc("beta_get_score_generation", {
    p_canonical_user_id: userId, p_score_date: localDate,
  });
  if (generationError) throw generationError;
  const queue = Array.isArray(generationRows) ? generationRows[0] : null;
  if (!queue || queue.status !== "DIRTY") return { status: "NOT_DIRTY", local_date: localDate };

  const dates = boundedDates(localDate, 29);
  const rows = await loadActiveRows(admin, userId, dates);
  const evidence = rows.map((row) => ({
    id: row.id, hash: row.source_content_hash, revision: row.source_revision,
    updated_at: row.source_updated_at ?? row.updated_at,
  })).sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
  const inputFingerprint = await sha256(stableJson({ algorithm_version: runtime.algorithmVersion, userId, localDate, evidence }));
  const current = rows.filter((row) => row.affected_local_dates.includes(localDate));
  const prior = rows.filter((row) => !row.affected_local_dates.includes(localDate));
  const inputs = assembleInputs(current, prior);

  const sleep = runtime.calculateSleepScore(inputs.sleep);
  const activity = runtime.calculateActivityScore(inputs.activity);
  const training = runtime.calculateTrainingScore({});
  const nutrition = runtime.calculateNutritionScore({});
  const body = runtime.calculateBodyCompositionScore(inputs.body);
  const recovery = runtime.calculateRecoveryScore({ ...inputs.recovery, sleepScore: sleep.score });
  const fatigue = runtime.calculateFatigueIndex(inputs.fatigue);
  const overall = runtime.calculateHealthScore({
    sleepScore: sleep.score, recoveryScore: recovery.score, activityScore: activity.score,
    trainingScore: training.score, nutritionScore: nutrition.score, bodyCompositionScore: body.score,
  });
  const results = [sleep, activity, training, nutrition, body, recovery, fatigue, overall];
  const availableDomains = SCORE_TYPES.filter((_, index) => results[index].score !== null);
  const missingDomains = SCORE_TYPES.filter((_, index) => results[index].score === null);
  const scores = results.map((result, index) => scoreRow(SCORE_TYPES[index], result,
    SCORE_TYPES[index] === "health_overall" ? { available_domains: availableDomains, missing_domains: missingDomains } : {}));
  const sourceMax = evidence.map((item) => item.updated_at).filter(Boolean).sort().at(-1) ?? null;
  const calculatedAt = new Date().toISOString();
  const { data: persistStatus, error: persistError } = await admin.rpc("beta_persist_score_bundle", {
    p_canonical_user_id: userId, p_score_date: localDate, p_generation: queue.generation,
    p_input_fingerprint: inputFingerprint, p_source_max_updated_at: sourceMax,
    p_calculated_at: calculatedAt, p_scores: scores,
  });
  if (persistError) throw persistError;
  return { status: persistStatus, local_date: localDate, input_fingerprint: inputFingerprint };
}

export async function readBetaScores(admin: any, userId: string, localDate?: string): Promise<Json> {
  let query = admin.from("beta_health_scores")
    .select("score_date,score_type,score,completeness,confidence,status,missing_components,algorithm_version,safe_output,calculated_at")
    .eq("canonical_user_id", userId).order("score_date", { ascending: false }).order("score_type", { ascending: true });
  if (localDate) query = query.eq("score_date", localDate);
  else query = query.limit(8);
  const { data, error } = await query;
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  const byType = Object.fromEntries(rows.map((row: Json) => [String(row.score_type), row]));
  return { local_date: rows[0]?.score_date ?? localDate ?? null, algorithm_version: runtime.algorithmVersion, scores: byType };
}

function assembleInputs(currentRows: HealthRow[], priorRows: HealthRow[]): Record<string, Json> {
  const current = selectSourceGroups(currentRows);
  const prior = selectSourceGroups(priorRows);
  const sleepMinutes = sum(current.sleep);
  const stages = current.sleep_stage ?? [];
  const stageMinutes = (pattern: RegExp) => sum(stages.filter((row) => pattern.test(String(row.canonical_record.stage ?? ""))));
  const priorRhr = dailyMeans(prior.resting_heart_rate ?? []);
  const priorHrv = dailyMeans(prior.hrv ?? []);
  const priorWeight = dailyLatest(prior.weight ?? []);
  const restingHeartRate = mean(current.resting_heart_rate ?? []);
  const hrv = mean(current.hrv ?? []);
  const weight = latestValue(current.weight ?? []);
  const baselineSampleCount = Math.max(priorRhr.length, priorHrv.length, priorWeight.length);
  return {
    sleep: {
      sleepMinutes, timeInBedMinutes: stages.length ? sum(stages) : null,
      deepSleepMinutes: stageMinutes(/deep/i), remSleepMinutes: stageMinutes(/rem/i),
      awakeMinutes: stageMinutes(/awake/i), baselineSampleCount,
    },
    activity: { steps: sum(current.steps), baselineSampleCount: 0 },
    body: {
      weight, weightBaseline: average(priorWeight), baselineSampleCount: priorWeight.length,
    },
    recovery: {
      hrvRmssd: hrv, hrvBaseline: average(priorHrv), restingHeartRate,
      restingHeartRateBaseline: average(priorRhr), baselineSampleCount,
    },
    fatigue: {
      sleepDebtMinutes: sleepMinutes === null ? null : Math.max(0, 480 - sleepMinutes),
      hrvRmssd: hrv, hrvBaseline: average(priorHrv), restingHeartRate,
      restingHeartRateBaseline: average(priorRhr), baselineSampleCount,
    },
  };
}

async function loadActiveRows(admin: any, userId: string, dates: string[]): Promise<HealthRow[]> {
  const output: HealthRow[] = [];
  for (let page = 0; page < 5; page += 1) {
    const start = page * 1000;
    const { data, error } = await admin.from("beta_health_records")
      .select("id,domain,source_app,source_record_id,source_revision,source_updated_at,source_content_hash,canonical_record,affected_local_dates,updated_at")
      .eq("canonical_user_id", userId).eq("operation", "UPSERT").is("invalidated_at", null)
      .in("domain", ["steps", "sleep", "sleep_stage", "weight", "hrv", "resting_heart_rate"])
      .overlaps("affected_local_dates", dates).order("updated_at", { ascending: true }).range(start, start + 999);
    if (error) throw error;
    const pageRows = (data ?? []) as HealthRow[];
    output.push(...pageRows);
    if (pageRows.length < 1000) return output;
  }
  throw new Error("SCORE_INPUT_BOUND_EXCEEDED");
}

function selectSourceGroups(rows: HealthRow[]): Record<string, HealthRow[]> {
  const grouped = new Map<string, HealthRow[]>();
  for (const row of rows) {
    const key = `${row.domain}\u001f${row.source_app}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const result: Record<string, HealthRow[]> = {};
  for (const domain of new Set(rows.map((row) => row.domain))) {
    const candidates = [...grouped.entries()].filter(([key]) => key.startsWith(`${domain}\u001f`));
    candidates.sort((left, right) => {
      const count = right[1].length - left[1].length;
      if (count) return count;
      const newest = newestAt(right[1]).localeCompare(newestAt(left[1]));
      return newest || left[0].localeCompare(right[0]);
    });
    result[domain] = candidates[0]?.[1] ?? [];
  }
  return result;
}

function scoreRow(scoreType: string, result: ScoreResult, extra: Json): Json {
  return {
    score_type: scoreType, score: result.score, completeness: result.completeness,
    confidence: result.confidence, status: result.status,
    missing_components: [...(result.missingData ?? [])].sort(), algorithm_version: runtime.algorithmVersion,
    safe_output: { ...extra, reason_codes: result.dependencyAdjustment && result.dependencyAdjustment !== "NONE" ? [result.dependencyAdjustment] : [] },
  };
}

function sum(rows: HealthRow[] | undefined): number | null {
  if (!rows?.length) return null;
  return rows.reduce((total, row) => total + Number(row.canonical_record.value), 0);
}
function mean(rows: HealthRow[]): number | null { return average(rows.map((row) => Number(row.canonical_record.value))); }
function average(values: number[]): number | null { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function latestValue(rows: HealthRow[]): number | null {
  const sorted = [...rows].sort((left, right) => String(right.canonical_record.recorded_at).localeCompare(String(left.canonical_record.recorded_at)));
  return sorted.length ? Number(sorted[0].canonical_record.value) : null;
}
function dailyMeans(rows: HealthRow[]): number[] {
  const days = groupByDate(rows);
  return [...days.values()].map((items) => mean(items)).filter((value): value is number => value !== null);
}
function dailyLatest(rows: HealthRow[]): number[] {
  return [...groupByDate(rows).values()].map(latestValue).filter((value): value is number => value !== null);
}
function groupByDate(rows: HealthRow[]): Map<string, HealthRow[]> {
  const days = new Map<string, HealthRow[]>();
  for (const row of rows) for (const date of row.affected_local_dates) days.set(date, [...(days.get(date) ?? []), row]);
  return days;
}
function newestAt(rows: HealthRow[]): string { return rows.map((row) => row.source_updated_at ?? row.updated_at).sort().at(-1) ?? ""; }
function boundedDates(localDate: string, count: number): string[] {
  const base = new Date(`${localDate}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => new Date(base.getTime() - index * 86_400_000).toISOString().slice(0, 10));
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Json).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
