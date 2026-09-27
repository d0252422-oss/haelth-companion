import "../../../fixtures/algorithm-golden/apps-script-health-score-v1.0.snapshot.js";
import { selectScoreRowsForDate } from "./score-read-contract.ts";

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
export type HealthRow = {
  id: string;
  domain: string;
  source_app: string;
  source_record_id: string;
  source_revision: number;
  source_updated_at: string | null;
  source_content_hash: string;
  canonical_record: Json;
  affected_local_dates: Array<string | Date>;
  updated_at: string;
};
export type NormalizedHealthRow = Omit<HealthRow, "affected_local_dates"> & { affected_local_dates: string[] };
export type ScorePreloadedSnapshot = {
  userId: string;
  startDate: string;
  endDate: string;
  rows: NormalizedHealthRow[];
};

export function canonicalScoreLocalDate(value: unknown): string {
  const date = value instanceof Date ? value.toISOString().slice(0, 10) : typeof value === "string" ? value : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error("INVALID_AFFECTED_LOCAL_DATE");
  }
  return date;
}

const POINT_MEASUREMENT_DOMAINS = new Set(["weight", "hrv", "resting_heart_rate"]);

// Older Health Connect uploads represented some point measurements with
// started_at === ended_at.  The portable engine correctly rejects zero-length
// intervals for interval domains (sleep/steps), but weight/HRV/resting HR are
// dated by recorded_at and do not require an interval.  Normalize only that
// legacy point-measurement shape at the persistence adapter boundary; malformed
// timestamps and every real interval still reach the strict engine validator.
export function normalizePointMeasurementInterval(domain: unknown, record: unknown): unknown {
  if (!POINT_MEASUREMENT_DOMAINS.has(String(domain)) || !record || typeof record !== "object" || Array.isArray(record)) return record;
  const canonical = record as Json;
  if (typeof canonical.started_at !== "string" || typeof canonical.ended_at !== "string") return record;
  const started = Date.parse(canonical.started_at), ended = Date.parse(canonical.ended_at);
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended !== started) return record;
  return { ...canonical, started_at: null, ended_at: null };
}

export function normalizeScoreHealthRows<T extends { affected_local_dates: Array<string | Date> }>(rows: T[]): Array<Omit<T, "affected_local_dates"> & { affected_local_dates: string[] }> {
  return rows.map((row) => ({
    ...row,
    affected_local_dates: row.affected_local_dates.map(canonicalScoreLocalDate),
    ...("canonical_record" in row
      ? { canonical_record: normalizePointMeasurementInterval((row as Json).domain, (row as Json).canonical_record) }
      : {}),
  }));
}

const runtime = (globalThis as unknown as { HEALTH_SCORE_V1_RUNTIME: Runtime }).HEALTH_SCORE_V1_RUNTIME;
if (!runtime || runtime.algorithmVersion !== "health-score-v1.0") throw new Error("FROZEN_SCORE_RUNTIME_UNAVAILABLE");

const SCORE_TYPES = [
  "sleep", "activity", "training", "nutrition", "body_composition", "recovery", "fatigue", "health_overall",
] as const;
const SCORE_INPUT_PAGE_SIZE = 1000;
const MAX_SCORE_INPUT_ROWS = 20_000;

export async function recomputeBetaScore(
  admin: any,
  userId: string,
  localDate: string,
  projectRows?: (rows: NormalizedHealthRow[], dates: string[]) => Promise<NormalizedHealthRow[]>,
  preloadedSnapshot?: ScorePreloadedSnapshot,
): Promise<Json> {
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new Error("INVALID_SCORE_SCOPE");
  const { data: generationRows, error: generationError } = await admin.rpc("beta_get_score_generation", {
    p_canonical_user_id: userId, p_score_date: localDate,
  });
  if (generationError) throw generationError;
  const queue = Array.isArray(generationRows) ? generationRows[0] : null;
  if (!queue || !["DIRTY", "PROCESSING"].includes(String(queue.status))) return { status: "NOT_DIRTY", local_date: localDate };

  const dates = boundedDates(localDate, 29);
  // The hosted multi-domain publisher has already loaded the same bounded
  // canonical 29-day snapshot for its portable outputs. Reuse that snapshot
  // for the frozen score bridge: the queue-generation guard below still
  // rejects publication if ingestion advances while computation is running.
  // Avoiding a second 12k-20k row fetch/normalization keeps one claimed job
  // inside the Edge CPU budget without changing any score formula.
  const expectedStart = dates.at(-1)!;
  let nativeRows: NormalizedHealthRow[];
  if (preloadedSnapshot) {
    if (preloadedSnapshot.userId !== userId || preloadedSnapshot.startDate !== expectedStart || preloadedSnapshot.endDate !== localDate ||
      preloadedSnapshot.rows.length > MAX_SCORE_INPUT_ROWS || preloadedSnapshot.rows.some((row) =>
        !row.affected_local_dates.some((date) => date >= expectedStart && date <= localDate))) {
      throw new Error("INVALID_SCORE_PRELOADED_SCOPE");
    }
    nativeRows = preloadedSnapshot.rows;
  } else {
    nativeRows = normalizeScoreHealthRows(await loadActiveRows(admin, userId, dates));
  }
  // Projectors receive normalized rows and must preserve that contract. The
  // hosted manual projector does so while applying per-date source exclusion.
  const rows: NormalizedHealthRow[] = projectRows ? await projectRows(nativeRows, dates) : nativeRows;
  if(rows.length>MAX_SCORE_INPUT_ROWS)throw Error('SCORE_INPUT_BOUND_EXCEEDED');
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
  const { selectedDate, selectedRows } = selectScoreRowsForDate(rows, localDate);
  const byType = Object.fromEntries(selectedRows.map((row: Json) => [String(row.score_type), row]));
  const [{ data: healthRows, error: healthError }, { data: queueRows, error: queueError }] = await Promise.all([
    admin.rpc("beta_get_health_freshness", { p_canonical_user_id: userId }),
    admin.rpc("beta_get_score_queue_summary", { p_canonical_user_id: userId }),
  ]);
  if (healthError) throw healthError;
  if (queueError) throw queueError;
  const health = Array.isArray(healthRows) ? healthRows[0] ?? {} : {};
  const queue = Array.isArray(queueRows) ? queueRows[0] ?? {} : {};
  const scoreUpdatedAt = selectedRows.map((row: Json) => String(row.calculated_at ?? "")).filter(Boolean).sort().at(-1) ?? null;
  const pending = Number(queue.dirty_count ?? 0) + Number(queue.processing_count ?? 0);
  return {
    local_date: selectedDate,
    algorithm_version: runtime.algorithmVersion,
    scores: byType,
    health_data_updated_at: health.health_data_updated_at ?? null,
    latest_health_data_date: health.latest_health_data_date ?? null,
    latest_sleep_date: health.latest_sleep_date ?? null,
    domain_latest_dates: health.domain_latest_dates ?? {},
    score_updated_at: scoreUpdatedAt,
    score_freshness: pending > 0 ? "UPDATING" : Number(queue.failed_count ?? 0) > 0 ? "PARTIAL" : "UP_TO_DATE",
    pending_score_dates: pending,
  };
}

function assembleInputs(currentRows: NormalizedHealthRow[], priorRows: NormalizedHealthRow[]): Record<string, Json> {
  const current = selectScoreSourceGroups(currentRows);
  const prior = selectScoreSourceGroups(priorRows);
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
  for (let start = 0; start < MAX_SCORE_INPUT_ROWS; start += SCORE_INPUT_PAGE_SIZE) {
    const { data, error } = await admin.from("beta_health_records")
      .select("id,domain,source_app,source_record_id,source_revision,source_updated_at,source_content_hash,canonical_record,affected_local_dates,updated_at")
      .eq("canonical_user_id", userId).eq("operation", "UPSERT").is("invalidated_at", null)
      .in("domain", ["steps", "sleep", "sleep_stage", "weight", "hrv", "resting_heart_rate"])
      .overlaps("affected_local_dates", dates).order("updated_at", { ascending: true })
      .range(start, start + SCORE_INPUT_PAGE_SIZE - 1);
    if (error) throw error;
    const pageRows = (data ?? []) as HealthRow[];
    output.push(...pageRows);
    if (pageRows.length < SCORE_INPUT_PAGE_SIZE) return output;
  }
  throw new Error("SCORE_INPUT_BOUND_EXCEEDED");
}

type SourceSelectionRow = { domain: string; source_app: string; source_updated_at?: string | null; updated_at: string };

export function selectScoreSourceGroups<T extends SourceSelectionRow>(rows: T[]): Record<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = `${row.domain}\u001f${row.source_app}`;
    // This path receives up to 20k Health Connect interval rows. Rebuilding the
    // accumulated array for every row made grouping quadratic and could exhaust
    // the Edge isolate CPU budget before the latest day was published.
    const existing = grouped.get(key);
    if (existing) existing.push(row);
    else grouped.set(key, [row]);
  }
  const result: Record<string, T[]> = {};
  for (const domain of new Set(rows.map((row) => row.domain))) {
    const candidates = [...grouped.entries()].filter(([key]) => key.startsWith(`${domain}\u001f`)).map(([key, items]) => ({key, items, newest: newestAt(items)}));
    candidates.sort((left, right) => {
      const count = right.items.length - left.items.length;
      if (count) return count;
      const newest = right.newest.localeCompare(left.newest);
      return newest || left.key.localeCompare(right.key);
    });
    result[domain] = candidates[0]?.items ?? [];
  }
  return result;
}

export function selectScoreSourceRows<T extends SourceSelectionRow>(rows: T[]): T[] {
  return Object.values(selectScoreSourceGroups(rows)).flat();
}

export function selectScoreSourceRowsForDate<T extends SourceSelectionRow & { affected_local_dates: string[] }>(rows: T[], date: string): T[] {
  const current=rows.filter(row=>row.affected_local_dates.includes(date));
  const prior=rows.filter(row=>!row.affected_local_dates.includes(date));
  return [...selectScoreSourceRows(current),...selectScoreSourceRows(prior)];
}

function scoreRow(scoreType: string, result: ScoreResult, extra: Json): Json {
  return {
    score_type: scoreType, score: result.score, completeness: result.completeness,
    confidence: result.confidence, status: result.status,
    missing_components: [...(result.missingData ?? [])].sort(), algorithm_version: runtime.algorithmVersion,
    safe_output: { ...extra, reason_codes: result.dependencyAdjustment && result.dependencyAdjustment !== "NONE" ? [result.dependencyAdjustment] : [] },
  };
}

function sum(rows: NormalizedHealthRow[] | undefined): number | null {
  if (!rows?.length) return null;
  return rows.reduce((total, row) => total + Number(row.canonical_record.value), 0);
}
function mean(rows: NormalizedHealthRow[]): number | null { return average(rows.map((row) => Number(row.canonical_record.value))); }
function average(values: number[]): number | null { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function latestValue(rows: NormalizedHealthRow[]): number | null {
  let latest: NormalizedHealthRow | null = null;
  for (const row of rows) if (!latest || String(row.canonical_record.recorded_at).localeCompare(String(latest.canonical_record.recorded_at)) > 0) latest = row;
  return latest ? Number(latest.canonical_record.value) : null;
}
function dailyMeans(rows: NormalizedHealthRow[]): number[] {
  const days = groupByDate(rows);
  return [...days.values()].map((items) => mean(items)).filter((value): value is number => value !== null);
}
function dailyLatest(rows: NormalizedHealthRow[]): number[] {
  return [...groupByDate(rows).values()].map(latestValue).filter((value): value is number => value !== null);
}
export function groupScoreRowsByDate<T extends { affected_local_dates: string[] }>(rows: T[]): Map<string, T[]> {
  const days = new Map<string, T[]>();
  for (const row of rows) for (const date of row.affected_local_dates) {
    const existing = days.get(date);
    if (existing) existing.push(row);
    else days.set(date, [row]);
  }
  return days;
}
function groupByDate(rows: NormalizedHealthRow[]): Map<string, NormalizedHealthRow[]> { return groupScoreRowsByDate(rows); }
function newestAt<T extends SourceSelectionRow>(rows: T[]): string { let newest="";for(const row of rows){const value=row.source_updated_at??row.updated_at;if(value>newest)newest=value;}return newest; }
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
