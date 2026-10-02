// Display-only daily total expenditure. The score engine deliberately does not
// consume this projection. Never add intervals from different device sources.
type EnergyRow = {
  platform?: unknown;
  source_app?: unknown;
  source_record_id?: unknown;
  source_revision?: unknown;
  source_updated_at?: unknown;
  updated_at?: unknown;
  affected_local_dates?: unknown;
  started_at?: unknown;
  ended_at?: unknown;
  value?: unknown;
  unit?: unknown;
};
type Range = { start: string; end: string };
type Interval = {
  sourceKey: string;
  platform: string;
  sourceApp: string;
  recordId: string;
  revision: number;
  updatedAt: number;
  ingestedAt: number;
  start: number;
  end: number;
  value: number;
};
type Segment = { start: number; end: number; interval: Interval };
export type CompleteTotalEnergyDay = {
  date: string;
  value: number;
  platform: string;
  sourceApp: string;
  intervalCount: number;
  allocation: "PROPORTIONAL_INTERVAL_SPLIT";
};

const DAY_MS = 86_400_000;
const TAIPEI_OFFSET_MS = 8 * 3_600_000;
const MAX_INTERVAL_MS = 48 * 3_600_000;
const MAX_DAILY_KCAL = 30_000;
const dateKey = (value: unknown) =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value ?? "").slice(0, 10);
const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value;
};
const nextDate = (value: string) =>
  new Date(Date.parse(value + "T00:00:00Z") + DAY_MS).toISOString().slice(
    0,
    10,
  );
const localDate = (timestamp: number) =>
  new Date(timestamp + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
const dayStart = (value: string) => Date.parse(value + "T00:00:00+08:00");
const timestamp = (value: unknown) => {
  const parsed = typeof value === "string" || value instanceof Date
    ? Date.parse(String(value))
    : NaN;
  return Number.isFinite(parsed) ? parsed : NaN;
};
const sourceKey = (platform: string, sourceApp: string) =>
  JSON.stringify([platform, sourceApp]);
const newer = (a: Interval, b: Interval) =>
  a.updatedAt - b.updatedAt || a.revision - b.revision ||
  a.ingestedAt - b.ingestedAt ||
  a.recordId.localeCompare(b.recordId);

// A value is published only for a finished Taipei calendar day with one
// non-overlapping, complete source. Exact-window replays/corrections use the
// latest source revision; partial days and conflicting intervals remain null.
export function projectCompleteTotalEnergyDays(
  rows: EnergyRow[],
  range: Range,
  nowMs = Date.now(),
): Map<string, CompleteTotalEnergyDay> {
  const windows = new Map<string, Interval>();
  const invalidSourceDays = new Set<string>();
  for (const row of rows) {
    const platform = String(row.platform ?? ""),
      sourceApp = String(row.source_app ?? "");
    if (!platform || !sourceApp) continue;
    const key = sourceKey(platform, sourceApp);
    const recordId = String(row.source_record_id ?? "").trim();
    const start = timestamp(row.started_at), end = timestamp(row.ended_at);
    const value = Number(row.value);
    if (
      !recordId || row.unit !== "kcal" || row.value === null ||
      row.value === undefined || String(row.value).trim() === "" ||
      !Number.isFinite(value) || value < 0 || value > 1_000_000 ||
      !Number.isFinite(start) || !Number.isFinite(end) || end <= start ||
      end - start > MAX_INTERVAL_MS
    ) {
      for (
        const rawDate of Array.isArray(row.affected_local_dates)
          ? row.affected_local_dates
          : []
      ) {
        const date = dateKey(rawDate);
        if (validDate(date) && date >= range.start && date <= range.end) {
          invalidSourceDays.add(JSON.stringify([key, date]));
        }
      }
      continue;
    }
    const ingestedAt = timestamp(row.updated_at) || 0;
    const interval: Interval = {
      sourceKey: key,
      platform,
      sourceApp,
      recordId,
      revision: Number(row.source_revision) || 0,
      updatedAt: timestamp(row.source_updated_at) || ingestedAt,
      ingestedAt,
      start,
      end,
      value,
    };
    const windowKey = JSON.stringify([key, start, end]);
    const prior = windows.get(windowKey);
    if (
      prior && newer(interval, prior) === 0 && interval.value !== prior.value
    ) {
      for (
        const rawDate of Array.isArray(row.affected_local_dates)
          ? row.affected_local_dates
          : []
      ) {
        const date = dateKey(rawDate);
        if (validDate(date) && date >= range.start && date <= range.end) {
          invalidSourceDays.add(JSON.stringify([key, date]));
        }
      }
      continue;
    }
    if (!prior || newer(interval, prior) > 0) windows.set(windowKey, interval);
  }

  const byDate = new Map<string, Map<string, Segment[]>>();
  for (const interval of windows.values()) {
    for (
      let date = localDate(interval.start);
      date <= localDate(interval.end - 1);
      date = nextDate(date)
    ) {
      if (date < range.start || date > range.end) continue;
      const start = Math.max(interval.start, dayStart(date));
      const end = Math.min(interval.end, dayStart(nextDate(date)));
      if (end <= start) continue;
      const sources = byDate.get(date) ?? new Map<string, Segment[]>();
      const segments = sources.get(interval.sourceKey) ?? [];
      segments.push({ start, end, interval });
      sources.set(interval.sourceKey, segments);
      byDate.set(date, sources);
    }
  }

  const result = new Map<string, CompleteTotalEnergyDay>();
  for (const [date, sources] of byDate) {
    const start = dayStart(date), end = dayStart(nextDate(date));
    if (end > nowMs) continue; // Never label an unfinished day as a daily total.
    const complete: Array<CompleteTotalEnergyDay & { newestAt: number }> = [];
    for (const [key, segments] of sources) {
      if (invalidSourceDays.has(JSON.stringify([key, date]))) continue;
      segments.sort((a, b) => a.start - b.start || a.end - b.end);
      let cursor = start, total = 0, newestAt = 0, valid = true;
      for (const segment of segments) {
        if (segment.start !== cursor) {
          valid = false;
          break;
        } // Gap or non-identical overlap.
        total += segment.interval.value * (segment.end - segment.start) /
          (segment.interval.end - segment.interval.start);
        newestAt = Math.max(
          newestAt,
          segment.interval.updatedAt,
          segment.interval.ingestedAt,
        );
        cursor = segment.end;
      }
      if (
        !valid || cursor !== end || !Number.isFinite(total) || total < 0 ||
        total > MAX_DAILY_KCAL
      ) continue;
      const interval = segments[0].interval;
      complete.push({
        date,
        value: Math.round(total * 100) / 100,
        platform: interval.platform,
        sourceApp: interval.sourceApp,
        intervalCount: segments.length,
        allocation: "PROPORTIONAL_INTERVAL_SPLIT",
        newestAt,
      });
    }
    complete.sort((a, b) =>
      b.intervalCount - a.intervalCount || b.newestAt - a.newestAt ||
      a.platform.localeCompare(b.platform) ||
      a.sourceApp.localeCompare(b.sourceApp)
    );
    if (complete.length) {
      const { newestAt: _newestAt, ...selected } = complete[0];
      result.set(date, selected);
    }
  }
  return result;
}
