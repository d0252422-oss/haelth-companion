type ScoreRow = Record<string, unknown>;

export function canonicalScoreDate(value: unknown): string {
  const date = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error("INVALID_SCORE_DATE");
  }
  return date;
}

export function selectScoreRowsForDate(rows: ScoreRow[], requestedDate?: string): { selectedDate: string | null; selectedRows: ScoreRow[] } {
  const selectedDate = requestedDate
    ? canonicalScoreDate(requestedDate)
    : rows.length ? canonicalScoreDate(rows[0].score_date) : null;
  return {
    selectedDate,
    selectedRows: selectedDate
      ? rows.filter((row) => canonicalScoreDate(row.score_date) === selectedDate)
      : [],
  };
}

export function scoreRecomputeStatus(freshness: unknown): "QUEUED" | "PARTIAL" | "CURRENT" | "UNKNOWN" {
  if (freshness === "UPDATING") return "QUEUED";
  if (freshness === "PARTIAL") return "PARTIAL";
  if (freshness === "UP_TO_DATE") return "CURRENT";
  return "UNKNOWN";
}
