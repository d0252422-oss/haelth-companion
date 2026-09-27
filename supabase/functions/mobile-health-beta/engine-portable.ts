// Pure computation glue for the existing frozen JS formulas. No I/O or subprocess.
// Reference: aggregation.py, nutrition.py (empty-catalog runtime), domain_engines.py.
import "../../../fixtures/algorithm-golden/apps-script-health-score-v1.0.snapshot.js";
type J = Record<string, any>;
// One authoritative bound for the hosted loader and the pure engine. Keeping
// a smaller legacy bound here rejected valid 28-day Health Connect histories
// after the loader had already accepted them.
export const CANONICAL_ENGINE_INPUT_LIMIT = 20_000;
const frozen = (globalThis as any).HEALTH_SCORE_V1_RUNTIME;
const nutrients = [
  "calories",
  "protein_g",
  "carbs_g",
  "fat_g",
  "fiber_g",
  "sodium_mg",
];
const specs: J = {
  steps: ["steps", "count"],
  workout: ["exercise_minutes", "minute"],
  active_minutes: ["active_minutes", "minute"],
  distance: ["distance_km", "km"],
  energy: ["calories_burned", "kcal"],
  heart_rate: ["average_hr", "bpm"],
  resting_heart_rate: ["resting_hr", "bpm"],
  hrv: ["hrv", "ms"],
  weight: ["weight", "kg"],
  body_fat: ["body_fat", "percent"],
  muscle_mass: ["muscle_mass", "kg"],
  fat_mass: ["fat_mass", "kg"],
  sedentary_time: ["sedentary_minutes", "minute"],
};
const sums = new Set([
  "steps",
  "workout",
  "active_minutes",
  "distance",
  "energy",
  "sedentary_time",
]);
const order = [
  "activity",
  "body",
  "cardio",
  "nutrition",
  "sleep",
  "recovery",
  "overall",
];
const targetsDefault = {
  calories: 2000,
  protein: 50,
  carbs: 275,
  fat: 78,
  fiber: 28,
  sodium: 2300,
};
const clamp = (v: number) => Math.min(100, Math.max(0, v));
// statistics.mean accumulates exact binary rationals, then rounds ONCE to float.
function rational(v: number): [bigint, bigint] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, Math.abs(v));
  const bits = buf.getBigUint64(0),
    e = Number((bits >> 52n) & 2047n),
    p = (e || 1) - 1023 - 52;
  let n = ((bits & ((1n << 52n) - 1n)) + (e ? 1n << 52n : 0n)) *
      (v < 0 ? -1n : 1n),
    d = 1n;
  if (p >= 0) n <<= BigInt(p);
  else d <<= BigInt(-p);
  return [n, d];
}
function ratioFloat(n: bigint, d: bigint): number {
  if (!n) return 0;
  const sign = n < 0n ? -1 : 1;
  n = n < 0n ? -n : n;
  let e = n.toString(2).length - d.toString(2).length;
  if (e >= 0 ? n < (d << BigInt(e)) : (n << BigInt(-e)) < d) e--;
  const shift = Math.max(52 - e, 0), denShift = Math.max(e - 52, 0);
  const numerator = n << BigInt(shift), denominator = d << BigInt(denShift);
  let q = numerator / denominator;
  const rem = numerator % denominator;
  if (rem * 2n > denominator || (rem * 2n === denominator && q % 2n === 1n)) {
    q++;
  }
  return sign * Number(q) * 2 ** (e - 52);
}
function mean(v: number[]): number | null {
  if (!v.length) return null;
  const terms = v.map(rational),
    den = terms.reduce((d, [, b]) => b > d ? b : d, 1n);
  return ratioFloat(
    terms.reduce((n, [a, b]) => n + a * (den / b), 0n),
    den * BigInt(v.length),
  );
}
const sorted = (v: Iterable<string>) => [...new Set(v)].sort();
export const fingerprintScheme = "JS_CANONICAL_JSON_V1";
function canonical(value: any): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw Error("NON_FINITE_INPUT");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" +
    Object.keys(value).sort().map((k) =>
      JSON.stringify(k) + ":" + canonical(value[k])
    ).join(",") + "}";
}
async function hash(value: any) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical(value)),
      ),
    ),
  ).map((v) => v.toString(16).padStart(2, "0")).join("");
}
// Python round(x,n): round the exact IEEE754 value to decimal, ties to even.
export function pyRound(value: number, digits = 0): number {
  if (!Number.isFinite(value)) throw Error("NON_FINITE_INPUT");
  if (!value) return value;
  const sign = value < 0 ? -1 : 1, buffer = new DataView(new ArrayBuffer(8));
  buffer.setFloat64(0, Math.abs(value));
  const bits = buffer.getBigUint64(0),
    e = Number((bits >> 52n) & 2047n),
    mantissa = (bits & ((1n << 52n) - 1n)) + (e ? 1n << 52n : 0n),
    power = (e || 1) - 1023 - 52;
  let numerator = mantissa * 10n ** BigInt(digits), denominator = 1n;
  if (power >= 0) numerator <<= BigInt(power);
  else denominator <<= BigInt(-power);
  let q = numerator / denominator;
  const rem = numerator % denominator;
  if (rem * 2n > denominator || (rem * 2n === denominator && q % 2n === 1n)) {
    q++;
  }
  return sign * Number(q) / 10 ** digits;
}
export function shiftDay(day: string, n: number) {
  return new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString()
    .slice(0, 10);
}
const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(at: string | number, zone: string) {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(zone, f);
  }
  return Object.fromEntries(
    f.formatToParts(new Date(at)).map((p) => [p.type, p.value]),
  );
}
function localDay(at: string | number, zone: string) {
  const p = parts(at, zone);
  return `${p.year}-${p.month}-${p.day}`;
}
function midnight(day: string, zone: string) {
  const target = Date.parse(day + "T00:00:00Z");
  let value = target;
  const visited: number[] = [];
  for (let i = 0; i < 4; i++) {
    visited.push(value);
    const p = parts(value, zone),
      wall = Date.parse(
        `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`,
      );
    const next = value + target - wall;
    // ZoneInfo fold=0 resolves nonexistent midnight with the pre-transition offset.
    if (next !== value && visited.includes(next)) {
      return Math.max(...visited.slice(visited.indexOf(next)));
    }
    value = next;
  }
  return value;
}
function timestamp(s: any) {
  const m = typeof s === "string" &&
    /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|z|[+-]\d{2}:?\d{2})$/
      .exec(s);
  if (
    !m || m[1].startsWith("0000") || Number(m[2]) > 23 || Number(m[3]) > 59 ||
    Number(m[4]) > 59 ||
    !Number.isFinite(Date.parse(m[1])) ||
    new Date(m[1]).toISOString().slice(0, 10) !== m[1]
  ) throw Error("INVALID_TIMESTAMP");
  let offset = m[6].toUpperCase();
  if (offset !== "Z") {
    offset = offset.slice(0, 3) + ":" + offset.replace(":", "").slice(3);
    if (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59) {
      throw Error("INVALID_TIMESTAMP");
    }
    if (offset.slice(1) === "00:00") offset = "Z";
  }
  const micro = (m[5] || "").padEnd(6, "0").slice(0, 6);
  return `${m[1]}T${m[2]}:${m[3]}:${m[4]}${
    Number(micro) ? "." + micro : ""
  }${offset}`;
}
function micros(s: string): bigint {
  const normalized = timestamp(s), fraction = /\.(\d{6})/.exec(normalized);
  return BigInt(Date.parse(normalized.replace(/\.\d{6}/, ""))) * 1000n +
    BigInt(fraction?.[1] || 0);
}
const milliFloor = (v: bigint) =>
  Number(v < 0n ? (v - 999n) / 1000n : v / 1000n);
const minBig = (a: bigint, b: bigint) => a < b ? a : b;
const maxBig = (a: bigint, b: bigint) => a > b ? a : b;
function strictObject(v: any, fields: string[]) {
  if (
    !v || typeof v !== "object" || Array.isArray(v) ||
    Object.keys(v).some((k) => !fields.includes(k))
  ) throw Error("INVALID_CONTRACT_OBJECT");
}
function stringValue(v: any, nonempty = false) {
  if (typeof v !== "string" || (nonempty && !v.length)) {
    throw Error("INVALID_CONTRACT_STRING");
  }
  return v;
}
function numberValue(v: any) {
  if (
    !["number", "string", "boolean"].includes(typeof v) ||
    (typeof v === "string" && !v.trim()) || !Number.isFinite(Number(v))
  ) throw Error("INVALID_CONTRACT_NUMBER");
  return Number(v);
}
function booleanValue(v: any) {
  if (
    v === true || v === 1 ||
    (typeof v === "string" &&
      ["1", "on", "t", "true", "y", "yes"].includes(v.toLowerCase()))
  ) return true;
  if (
    v === false || v === 0 ||
    (typeof v === "string" &&
      ["0", "off", "f", "false", "n", "no"].includes(v.toLowerCase()))
  ) return false;
  throw Error("INVALID_CONTRACT_BOOLEAN");
}
function quality(v: any) {
  if (!["UNKNOWN", "LOW", "MEDIUM", "HIGH"].includes(v)) {
    throw Error("INVALID_CONTRACT_QUALITY");
  }
  return v;
}
function validateMeal(input: J) {
  strictObject(input, [
    "meal_id",
    "meal",
    "meal_time",
    "food_items",
    "confirmed",
  ]);
  const m: J = {
    ...input,
    meal_id: stringValue(input.meal_id),
    meal: stringValue(input.meal),
    meal_time: timestamp(input.meal_time),
    confirmed: booleanValue(input.confirmed ?? false),
  };
  if (!Array.isArray(input.food_items)) throw Error("INVALID_MEAL");
  m.food_items = input.food_items.map((input: J) => {
    strictObject(input, [
      "item_id",
      "raw_name",
      "normalized_food_id",
      "normalized_food_name",
      "portion_value",
      "portion_unit",
      "estimated_weight_g",
      "preparation_method",
      "nutrients",
      "micronutrients",
      "source",
      "confidence",
      "estimation_range",
    ]);
    const item: J = {
      ...input,
      item_id: stringValue(input.item_id, true),
      raw_name: stringValue(input.raw_name),
      source: stringValue(input.source ?? "MANUAL"),
      preparation_method: stringValue(input.preparation_method ?? "unknown"),
      confidence: quality(input.confidence ?? "UNKNOWN"),
    };
    for (
      const key of [
        "normalized_food_id",
        "normalized_food_name",
        "portion_unit",
      ]
    ) if (item[key] != null) stringValue(item[key]);
    for (const key of ["portion_value", "estimated_weight_g"]) {
      if (item[key] != null) {
        item[key] = numberValue(item[key]);
        if (item[key] < 0) throw Error("INVALID_PORTION");
      }
    }
    const values = input.nutrients === undefined ? {} : input.nutrients;
    strictObject(values, nutrients);
    item.nutrients = Object.fromEntries(
      nutrients.map(
        (k) => [k, values[k] == null ? null : numberValue(values[k])],
      ),
    );
    if (Object.values(item.nutrients).some((v: any) => v !== null && v < 0)) {
      throw Error("INVALID_NUTRIENT");
    }
    const micro = input.micronutrients === undefined
      ? {}
      : input.micronutrients;
    if (!micro || typeof micro !== "object" || Array.isArray(micro)) {
      throw Error("INVALID_MICRONUTRIENTS");
    }
    for (const v of Object.values(micro)) {
      if (v !== null && numberValue(v) < 0) {
        throw Error("INVALID_MICRONUTRIENTS");
      }
    }
    if (item.estimation_range != null) {
      strictObject(item.estimation_range, [
        "estimated_min",
        "estimated_value",
        "estimated_max",
      ]);
      const values = ["estimated_min", "estimated_value", "estimated_max"].map(
        (k) => numberValue(item.estimation_range[k]),
      );
      if (values[0] < 0 || values[0] > values[1] || values[1] > values[2]) {
        throw Error("INVALID_ESTIMATE_RANGE");
      }
    }
    return item;
  });
  if (
    new Set(m.food_items.map((i: J) => i.item_id)).size !== m.food_items.length
  ) throw Error("INVALID_MEAL");
  return m;
}
function recordsFor(inputs: any[], subject: string) {
  if (
    !subject || !Array.isArray(inputs) ||
    inputs.length > CANONICAL_ENGINE_INPUT_LIMIT
  ) {
    throw Error("INVALID_CANONICAL_INPUTS");
  }
  const map = new Map<string, J>();
  for (const input of inputs) {
    const r = {
      value: null,
      unit: null,
      started_at: null,
      ended_at: null,
      deleted: false,
      source_quality: "UNKNOWN",
      payload: {},
      ...input,
    };
    if (
      r.subject_ref !== subject
    ) throw Error("INVALID_CANONICAL_INPUTS");
    if (
      Object.keys(r).some((k) =>
        ![
          "subject_ref",
          "source",
          "record_id",
          "revision",
          "domain",
          "recorded_at",
          "updated_at",
          "started_at",
          "ended_at",
          "value",
          "unit",
          "deleted",
          "source_quality",
          "payload",
        ].includes(k)
      )
    ) throw Error("INVALID_CANONICAL_INPUTS");
    stringValue(r.subject_ref, true);
    stringValue(r.source, true);
    stringValue(r.record_id, true);
    stringValue(r.domain);
    r.revision = numberValue(r.revision);
    if (!Number.isInteger(r.revision) || r.revision < 1) {
      throw Error("INVALID_CANONICAL_INPUTS");
    }
    if (r.unit !== null) stringValue(r.unit);
    r.recorded_at = timestamp(r.recorded_at);
    r.updated_at = timestamp(r.updated_at);
    r.deleted = booleanValue(r.deleted);
    if (r.value !== null) r.value = numberValue(r.value);
    if (
      !r.payload || typeof r.payload !== "object" || Array.isArray(r.payload)
    ) throw Error("INVALID_CANONICAL_INPUTS");
    if (!["UNKNOWN", "LOW", "MEDIUM", "HIGH"].includes(r.source_quality)) {
      throw Error("INVALID_CANONICAL_INPUTS");
    }
    if ((r.started_at !== null) !== (r.ended_at !== null)) {
      throw Error("INVALID_INTERVAL");
    }
    if (r.started_at !== null) {
      r.started_at = timestamp(r.started_at);
      r.ended_at = timestamp(r.ended_at);
      if (micros(r.ended_at) <= micros(r.started_at)) {
        throw Error("INVALID_INTERVAL");
      }
    }
    canonical(r.payload);
    const id = JSON.stringify([r.subject_ref, r.source, r.domain, r.record_id]),
      old = map.get(id);
    if (old && old.revision === r.revision && canonical(old) !== canonical(r)) {
      throw Error("CONFLICTING_CANONICAL_REVISION");
    }
    if (!old || r.revision > old.revision) map.set(id, r);
  }
  return [...map.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map((
    [, r],
  ) => r).filter((r) => !r.deleted);
}
function dates(r: J, zone: string) {
  if (r.domain === "nutrition") {
    return [localDay(validateMeal(r.payload).meal_time, zone)];
  }
  if (r.domain === "sleep") {
    return [localDay(r.ended_at || r.recorded_at, zone)];
  }
  if (sums.has(r.domain) && r.started_at) {
    const first = localDay(r.started_at, zone),
      last = localDay(milliFloor(micros(r.ended_at) - 1n), zone),
      count = (Date.parse(last) - Date.parse(first)) / 86400000;
    if (count > 31) throw Error("INTERVAL_BOUND_EXCEEDED");
    return Array.from({ length: count + 1 }, (_, i) => shiftDay(first, i));
  }
  return [localDay(r.recorded_at, zone)];
}
function nutritionDaily(meals: J[], day: string, zone: string) {
  const selected = meals.map(validateMeal).filter((m) =>
    m.confirmed === true && localDay(timestamp(m.meal_time), zone) === day
  );
  if (new Set(selected.map((m) => m.meal_id)).size !== selected.length) {
    throw Error("MEAL_REPLAY_UNRECONCILED");
  }
  const items: J[] = [];
  for (const meal of selected) {
    if (
      !Array.isArray(meal.food_items) ||
      new Set(meal.food_items.map((i: J) => i.item_id)).size !==
        meal.food_items.length
    ) throw Error("INVALID_MEAL");
    for (const item of meal.food_items) {
      const values = Object.fromEntries(
        nutrients.map((k) => [
          k,
          item.source === "MANUAL_CONFIRMED"
            ? (item.nutrients?.[k] ?? null)
            : null,
        ]),
      );
      if (
        Object.values(values).some((v) =>
          v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0)
        )
      ) throw Error("INVALID_NUTRIENT");
      items.push({
        values,
        missing: item.source === "MANUAL_CONFIRMED"
          ? nutrients.filter((k) => values[k] === null)
          : ["food_reference"],
        reference: item.source === "MANUAL_CONFIRMED"
          ? "MANUAL_CONFIRMED"
          : null,
        quality: item.source === "MANUAL_CONFIRMED"
          ? (item.confidence || "UNKNOWN")
          : "UNKNOWN",
      });
    }
  }
  const totals: J = {}, known: J = {}, ranges: J = {};
  for (const k of nutrients) {
    const observed = items.map((i) => i.values[k]).filter((v) => v !== null);
    known[k] = observed.length
      ? pyRound(observed.reduce((a, b) => a + b, 0), 1)
      : null;
    totals[k] = items.length && observed.length === items.length
      ? known[k]
      : null;
    if (totals[k] !== null) {
      ranges[k] = {
        estimated_min: known[k],
        estimated_value: known[k],
        estimated_max: known[k],
      };
    }
  }
  const macros: J = { protein_g: 4, carbs_g: 4, fat_g: 9 },
    energy = Object.entries(macros).reduce(
      (s, [k, f]) => s + (totals[k] || 0) * f,
      0,
    );
  const ratio = Object.keys(macros).every((k) => totals[k] !== null) && energy
    ? Object.fromEntries(
      Object.entries(macros).map((
        [k, f],
      ) => [k, pyRound(totals[k] * f / energy, 4)]),
    )
    : null;
  const distribution: J = {};
  for (const meal of selected) {
    distribution[meal.meal] = (distribution[meal.meal] || 0) + 1;
  }
  return {
    totals,
    known_subtotals: known,
    ranges,
    macro_ratio: ratio,
    meal_distribution: distribution,
    meal_count: selected.length || null,
    data_completeness: Object.values(totals).filter((v) => v !== null).length /
      6,
    missing_inputs: sorted(items.flatMap((i) => i.missing)),
    references: sorted(items.map((i) => i.reference).filter(Boolean)),
    source_quality: items.some((i) => i.quality === "LOW")
      ? "LOW"
      : !items.length || items.some((i) => i.quality === "UNKNOWN")
      ? "UNKNOWN"
      : "MEDIUM",
  };
}
async function aggregate(
  active: J[],
  subject: string,
  day: string,
  zone: string,
) {
  const flags = new Set<string>(),
    groups: J = {},
    sleeps: bigint[][] = [],
    meals: J[] = [],
    left = BigInt(midnight(day, zone)) * 1000n,
    right = BigInt(midnight(shiftDay(day, 1), zone)) * 1000n;
  for (const r of active) {
    // Internal canonical projection, not a measured value or source preference.
    // Keep original intervals/evidence; suppress only explicitly conflicted days.
    const reconciliation = r.payload?.manual_reconciliation;
    if (reconciliation !== undefined && (reconciliation===null || reconciliation.policy!=='manual-source-exclusion-v1' || !Array.isArray(reconciliation.excluded_local_dates) || reconciliation.excluded_local_dates.length>32 || new Set(reconciliation.excluded_local_dates).size!==reconciliation.excluded_local_dates.length || reconciliation.excluded_local_dates.some((d:unknown)=>typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)))throw Error('INVALID_MANUAL_RECONCILIATION');
    if (reconciliation?.excluded_local_dates.includes(day)) {
      flags.add('SOURCE_CONFLICT:' + r.domain);
      continue;
    }
    if (r.domain === "nutrition") {
      meals.push(r.payload);
      continue;
    }
    if (r.domain === "sleep") {
      if (!r.started_at) flags.add("MISSING_INTERVAL:sleep");
      else if (
        Number(micros(r.ended_at) - micros(r.started_at)) / 60000000 > 1440
      ) flags.add("OUTLIER:sleep");
      else sleeps.push([micros(r.started_at), micros(r.ended_at)]);
      continue;
    }
    const spec = specs[r.domain];
    if (!spec) {
      flags.add("UNSUPPORTED_DOMAIN:" + r.domain);
      continue;
    }
    const [metric, unit] = spec;
    let v = r.value;
    if (v === null) continue;
    if (v < 0) {
      flags.add("INVALID:" + metric);
      continue;
    }
    if (r.unit !== unit) {
      flags.add("UNIT_MISMATCH:" + metric);
      continue;
    }
    if (
      (["average_hr", "resting_hr"].includes(metric) && (v < 20 || v > 300)) ||
      (metric === "body_fat" && v > 100)
    ) {
      flags.add("OUTLIER:" + metric);
      continue;
    }
    if (sums.has(r.domain) && r.started_at) {
      const start = micros(r.started_at), end = micros(r.ended_at);
      v *= Number(minBig(end, right) - maxBig(start, left)) /
        Number(end - start);
      if (start < left || end > right) {
        flags.add("ESTIMATED_INTERVAL_PRORATION:" + metric);
      }
    }
    (groups[metric] ??= []).push([v, r]);
  }
  const metrics: J = Object.fromEntries(
    Object.values(specs).map((s: any) => [s[0], null]),
  );
  for (const [metric, pairs] of Object.entries(groups) as [string, any[]][]) {
    if (new Set(pairs.map(([, r]) => r.source)).size > 1) {
      flags.add("AMBIGUOUS_SOURCE:" + metric);
      continue;
    }
    const values = pairs.map(([v]) => v);
    metrics[metric] = pyRound(
      pairs.some(([, r]) => sums.has(r.domain))
        ? values.reduce((a, b) => a + b, 0)
        : mean(values)!,
      3,
    );
  }
  let sleep: number | null = null;
  if (sleeps.length) {
    sleeps.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    let [start, end] = sleeps[0], total = 0;
    for (const [a, b] of sleeps.slice(1)) {
      if (a <= end) end = maxBig(end, b);
      else {
        total += Number(end - start) / 60000000;
        start = a;
        end = b;
      }
    }
    sleep = pyRound(total + Number(end - start) / 60000000, 3);
    if (sleeps.length > 1) flags.add("SLEEP_INTERVAL_UNION");
    const p = parts(milliFloor(sleeps[0][0]), zone);
    metrics.bedtime_minute = Number(p.hour) * 60 + Number(p.minute);
  } else metrics.bedtime_minute = null;
  metrics.sleep_minutes = sleep;
  metrics.nutrition = nutritionDaily(meals, day, zone);
  const quality =
    !active.length || active.some((r) => r.source_quality === "UNKNOWN")
      ? "UNKNOWN"
      : flags.size || active.some((r) => r.source_quality === "LOW")
      ? "LOW"
      : "MEDIUM";
  return {
    subject_ref: subject,
    calculation_date: day,
    timezone: zone,
    engine_version: "daily-aggregation-v1.0",
    metrics,
    flags: sorted(flags),
    evidence_ids: active.map((r) =>
      `${r.source}|${r.domain}|${r.record_id}:${r.revision}`
    ),
    source_quality: quality,
    input_fingerprint: await hash({
      records: active,
      timezone: zone,
      day,
      metrics,
      version: "daily-aggregation-v1.0",
      fingerprint_scheme: fingerprintScheme,
    }),
  };
}
function derive(days: J[], day: string) {
  const result: J = { engine_version: "derived-metrics-v1.0" };
  for (
    const metric of [
      "steps",
      "weight",
      "resting_hr",
      "sleep_minutes",
      "hrv",
      "exercise_minutes",
      "calories_burned",
      "fat_mass",
      "bedtime_minute",
      ...nutrients.map((k) => "nutrition_" + k),
    ]
  ) {
    for (const window of [7, 28]) {
      const pairs = days.filter((d) =>
        d.calculation_date >= shiftDay(day, -window + 1)
      ).map((d) => [
        d.calculation_date,
        metric.startsWith("nutrition_")
          ? d.metrics.nutrition.totals[metric.slice(10)]
          : d.metrics[metric],
      ]).filter(([, v]) => v !== null);
      result[`${metric}_${window}d_count`] = pairs.length;
      result[`${metric}_${window}d_avg`] = pairs.length
        ? pyRound(
          mean(pairs.map(([, v]) => v))!,
          3,
        )
        : null;
      if (window === 28) {
        const prior = pairs.filter(([d]) => d < day);
        result[`${metric}_baseline_count`] = prior.length;
        result[`${metric}_baseline`] = prior.length >= 7
          ? pyRound(mean(prior.map(([, v]) => v))!, 3)
          : null;
        result[`${metric}_trend`] = pairs.length >= 2
          ? pyRound(
            (pairs.at(-1)![1] - pairs[0][1]) /
              ((Date.parse(pairs.at(-1)![0]) - Date.parse(pairs[0][0])) /
                86400000),
            3,
          )
          : null;
        if (metric === "bedtime_minute") {
          const values = pairs.map(([, v]) => v),
            offsets = values.map((v) =>
              ((v - values[0] + 720) % 1440 + 1440) % 1440 - 720
            ),
            avg = mean(offsets);
          result.sleep_regularity_minutes = values.length >= 3
            ? pyRound(Math.sqrt(mean(offsets.map((v) => (v - avg!) ** 2))!), 3)
            : null;
        }
      }
    }
  }
  result.input_fingerprints = days.map((d) => d.input_fingerprint);
  const activity = days.filter((d) =>
    d.calculation_date >= shiftDay(day, -6) && d.metrics.steps !== null
  ).map((d) => d.metrics.steps);
  result.activity_observed_days_7 = activity.length;
  result.activity_nonzero_days_7 = activity.filter((v) => v > 0).length;
  result.activity_consistency_observed_fraction = activity.length
    ? result.activity_nonzero_days_7 / activity.length
    : null;
  return result;
}
async function domainOutputs(
  daily: J,
  derived: J,
  calculated: string,
  personal: J = {},
  stale = false,
) {
  if (
    Object.values(personal).some((v) =>
      typeof v !== "number" || !Number.isFinite(v) || v <= 0
    )
  ) throw Error("INVALID_TARGET");
  const targets = { ...targetsDefault, ...personal },
    m = daily.metrics,
    n = m.nutrition,
    values = n.totals,
    output: J = {};
  for (const domain of order) {
    const explanations = [
        "DEVELOPMENT_POLICY_NOT_CLINICALLY_VALIDATED",
        ...daily.flags,
      ],
      extra: J = {};
    let result: J;
    if (domain === "sleep") {
      result = frozen.calculateSleepScore({
        sleepMinutes: m.sleep_minutes,
        sleepRequirementMinutes: personal.sleep_minutes ?? 480,
        bedtimeDeviationMinutes: derived.sleep_regularity_minutes,
      });
      explanations.push("WAKE_DATE_INTERVAL_UNION_NOT_SOURCE_CONFIDENCE");
      extra.sleep_debt_minutes_daily_average =
        derived.sleep_minutes_7d_avg !== null
          ? pyRound(
            Math.max(
              0,
              (personal.sleep_minutes ?? 480) - derived.sleep_minutes_7d_avg,
            ),
            1,
          )
          : null;
    } else if (domain === "activity") {
      result = frozen.calculateActivityScore({
        steps: m.steps,
        stepTarget: personal.steps ?? (derived.steps_baseline || 7000),
        caloriesBurned: m.calories_burned,
        caloriesBurnedBaseline: derived.calories_burned_baseline,
        baselineSampleCount: derived.steps_baseline_count,
      });
    } else if (domain === "body") {
      result = frozen.calculateBodyCompositionScore({
        weight: derived.weight_7d_avg,
        targetWeight: personal.weight,
        weightBaseline: derived.weight_baseline,
        fatMass: m.fat_mass,
        fatMassBaseline: derived.fat_mass_baseline,
        baselineSampleCount: derived.weight_baseline_count,
      });
      extra.BMI = derived.weight_7d_avg && personal.height_m
        ? pyRound(derived.weight_7d_avg / personal.height_m ** 2, 1)
        : null;
      extra.weight_rate_of_change_kg_per_day = derived.weight_trend;
    } else if (domain === "cardio" || domain === "recovery") {
      result = frozen.calculateRecoveryScore({
        restingHeartRate: m.resting_hr,
        restingHeartRateBaseline: derived.resting_hr_baseline,
        hrvRmssd: m.hrv,
        hrvBaseline: derived.hrv_baseline,
        sleepScore: domain === "recovery" ? output.sleep.score : null,
        baselineSampleCount: derived.resting_hr_baseline_count,
      });
      if (domain === "cardio") {
        explanations.push("PERSONAL_RHR_HRV_COMPONENTS_ONLY_NO_DIAGNOSIS");
      }
    } else if (domain === "nutrition") {
      result = frozen.calculateNutritionScore({
        values: {
          calories: values.calories,
          protein: values.protein_g,
          carbs: values.carbs_g,
          fat: values.fat_g,
          mealCount: n.meal_count,
        },
        targets,
      });
      Object.assign(extra, n);
      for (const window of [7, 28]) {
        extra[`rolling_${window}d`] = Object.fromEntries(
          nutrients.map(
            (k) => [k, {
              average: derived[`nutrition_${k}_${window}d_avg`],
              observed_days: derived[`nutrition_${k}_${window}d_count`],
            }],
          ),
        );
      }
      extra.nutrition_trend = Object.fromEntries(
        nutrients.map((k) => [k, derived[`nutrition_${k}_trend`]]),
      );
      extra.calorie_target_gap = values.calories === null
        ? null
        : values.calories - targets.calories;
      extra.protein_target_gap = values.protein_g === null
        ? null
        : values.protein_g - targets.protein;
      explanations.push(
        "FIBER_SODIUM_INFORMATIONAL_NOT_IN_FROZEN_NUTRITION_WEIGHTS",
      );
      if (
        !["calories", "protein", "carbs", "fat"].every((k) => k in personal)
      ) explanations.push("FDA_LABEL_BASELINE_NOT_PERSONAL_REQUIREMENT");
    } else {
      const input: J = {};
      for (
        const [d, k] of [
          ["sleep", "sleepScore"],
          ["recovery", "recoveryScore"],
          ["activity", "activityScore"],
          ["training", "trainingScore"],
          ["nutrition", "nutritionScore"],
          ["body", "bodyCompositionScore"],
        ]
      ) {
        input[k] = output[d] &&
            !["STALE", "ERROR", "INSUFFICIENT_DATA"].includes(
              output[d].score_status,
            )
          ? output[d].score
          : null;
      }
      result = frozen.calculateHealthScore(input);
      explanations.push("FROZEN_OVERALL_WEIGHTS_AND_OVERLAP_ADJUSTMENT");
    }
    let score = result.score,
      completeness = result.completeness,
      missing = result.missingData || [];
    extra.legacy_component_values = { ...result.components };
    let components: J = Object.fromEntries(
      Object.entries(result.components).map((
        [k, v],
      ) => [k, v === null ? null : clamp(v as number)]),
    );
    if (domain === "nutrition") {
      components = {
        energy_component: components.calories,
        protein_component: components.protein,
        macro_component: components.carbs !== null && components.fat !== null
          ? pyRound((components.carbs + components.fat) / 2, 1)
          : null,
        fiber_component: values.fiber_g === null
          ? null
          : Math.min(100, values.fiber_g / targets.fiber * 100),
        sodium_component: values.sodium_mg === null
          ? null
          : values.sodium_mg <= targets.sodium
          ? 100
          : Math.max(0, 200 - values.sodium_mg / targets.sodium * 100),
        consistency_component: components.mealDistribution,
      };
      completeness = n.data_completeness;
      missing = [...missing, ...n.missing_inputs];
      if (values.calories === null || values.protein_g === null) {
        score = null;
        missing.push("calories_and_protein_required");
      }
    }
    let confidence = score === null ? "UNKNOWN" : completeness >= 0.8 &&
        ["HIGH", "MEDIUM"].includes(daily.source_quality) &&
        Object.keys(personal).length
      ? "MEDIUM"
      : "LOW";
    if (
      domain === "nutrition" && ["LOW", "UNKNOWN"].includes(n.source_quality)
    ) confidence = score === null ? "UNKNOWN" : "LOW";
    let status = score === null
      ? "INSUFFICIENT_DATA"
      : completeness < 1 || confidence === "LOW"
      ? "PARTIAL_DATA"
      : "VALID";
    if (stale) {
      status = "STALE";
      confidence = "LOW";
      explanations.push("STALE_INPUTS");
    }
    const version = domain === "overall"
      ? "health-score-v1.0"
      : `${domain}-score-v1.0`;
    output[domain] = {
      subject_ref: daily.subject_ref,
      domain,
      calculation_date: daily.calculation_date,
      engine_version: version,
      score,
      score_status: status,
      confidence,
      data_completeness: completeness,
      missing_inputs: sorted(missing),
      source_quality: daily.source_quality,
      metrics: { daily: m, derived, ...extra },
      components,
      explanations,
      recompute_reason: "EXISTING_BETA_QUEUE_EXPERIMENTAL",
      calculated_at: calculated,
      input_fingerprint: await hash({
        daily: daily.input_fingerprint,
        derived,
        targets: personal,
        version,
        stale,
        dependencies: ["recovery", "overall"].includes(domain)
          ? Object.fromEntries(
            Object.entries(output).map((
              [k, v],
            ) => [k, (v as J).input_fingerprint]),
          )
          : {},
        fingerprint_scheme: fingerprintScheme,
      }),
    };
  }
  return output;
}
export async function computeDomainRequest(request: J) {
  if (request.algorithm_version !== "health-score-v1.0") {
    throw Error("UNKNOWN_ALGORITHM_VERSION");
  }
  const input = request.canonical_inputs, day = String(input?.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || shiftDay(day, 0) !== day) {
    throw Error("INVALID_DATE");
  }
  timestamp(input.calculated_at);
  parts(0, request.timezone);
  const active = recordsFor(input.records, request.subject_ref),
    byDate = new Map<string, J[]>();
  for (const r of active) {
    for (const d of dates(r, request.timezone)) {
      if (d < shiftDay(day, -27) || d > day) continue;
      const bucket = byDate.get(d) || [];
      bucket.push(r);
      byDate.set(d, bucket);
    }
  }
  const days = [];
  for (let i = 27; i >= 0; i--) {
    const d = shiftDay(day, -i);
    days.push(
      await aggregate(
        byDate.get(d) || [],
        request.subject_ref,
        d,
        request.timezone,
      ),
    );
  }
  const daily = days.at(-1)!,
    derived = derive(days, day),
    outputs = await domainOutputs(daily, derived, input.calculated_at);
  const overall = outputs.overall;
  return {
    value: overall.score,
    score: overall.score,
    completeness: overall.data_completeness,
    confidence: overall.confidence,
    missing_inputs: overall.missing_inputs,
    reason_codes: ["EXPERIMENTAL_UNVALIDATED"],
    algorithm_version: "health-score-v1.0",
    traceability: {
      input_fingerprint: overall.input_fingerprint,
      fingerprint_scheme: fingerprintScheme,
    },
    bundle: { daily, derived, outputs },
  };
}
export class PortableEngineRuntime {
  async start() {}
  async close() {}
  async execute(request: J) {
    if (request.domain === "multi_domain") {
      return { normalized: await computeDomainRequest(request) };
    }
    if (request.algorithm_version !== "health-score-v1.0") {
      throw Error("UNKNOWN_ALGORITHM_VERSION");
    }
    const names: J = {
      sleep: "calculateSleepScore",
      activity: "calculateActivityScore",
      training: "calculateTrainingScore",
      nutrition: "calculateNutritionScore",
      body_composition: "calculateBodyCompositionScore",
      recovery: "calculateRecoveryScore",
      fatigue: "calculateFatigueIndex",
      health_overall: "calculateHealthScore",
    };
    if (!names[request.domain]) throw Error("UNKNOWN_DOMAIN");
    const result = frozen[names[request.domain]](request.canonical_inputs);
    return {
      normalized: {
        ...result,
        missing_inputs: sorted(result.missingData || []),
        algorithm_version: "health-score-v1.0",
      },
    };
  }
}
