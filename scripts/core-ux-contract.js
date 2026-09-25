(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HealthCoreUX = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const nutrientKeys = Object.freeze(["calories", "protein", "carbs", "fat"]);
  const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

  function finiteNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function positiveInteger(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  function isValidDateKey(value) {
    const key = String(value || "");
    if (!dateKeyPattern.test(key)) return false;
    const [year, month, day] = key.split("-").map(Number);
    const checked = new Date(Date.UTC(year, month - 1, day));
    return checked.getUTCFullYear() === year && checked.getUTCMonth() === month - 1 && checked.getUTCDate() === day;
  }

  function localDateKey(value = new Date(), timeZone = "Asia/Taipei") {
    if (typeof value === "string" && isValidDateKey(value)) return value;
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const key = `${values.year}-${values.month}-${values.day}`;
    return isValidDateKey(key) ? key : null;
  }

  function recordLocalDate(record, timeZone = "Asia/Taipei") {
    if (!record || typeof record !== "object") return null;
    // Relational/canonical local-date fields outrank duplicated JSON display
    // fields. This prevents a stale body.date from moving a stored day.
    for (const key of ["local_date", "localDate", "date", "recordDate", "scoreDate"]) {
      if (isValidDateKey(record[key])) return String(record[key]);
    }
    for (const key of ["recordedAt", "recorded_at", "sourceTimestamp", "source_updated_at", "timestamp", "createdAt", "created_at"]) {
      if (record[key]) {
        const resolved = localDateKey(record[key], timeZone);
        if (resolved) return resolved;
      }
    }
    return null;
  }

  function localDateRange(start, end, limit = 367) {
    if (!isValidDateKey(start) || !isValidDateKey(end) || start > end || !Number.isSafeInteger(limit) || limit < 1) {
      throw Error("INVALID_LOCAL_DATE_RANGE");
    }
    const [year, month, day] = start.split("-").map(Number);
    const cursor = new Date(Date.UTC(year, month - 1, day));
    const result = [];
    while (result.length < limit) {
      const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`;
      if (key > end) break;
      result.push(key);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    if (result.at(-1) !== end) throw Error("LOCAL_DATE_RANGE_EXCEEDS_LIMIT");
    return result;
  }

  function shiftLocalDate(value, dayDelta) {
    if (!isValidDateKey(value) || !Number.isSafeInteger(dayDelta)) throw Error("INVALID_LOCAL_DATE_SHIFT");
    const [year, month, day] = value.split("-").map(Number);
    const cursor = new Date(Date.UTC(year, month - 1, day));
    cursor.setUTCDate(cursor.getUTCDate() + dayDelta);
    return `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`;
  }

  function fillLocalDateGaps(rows, window, timeZone = "Asia/Taipei") {
    const source = Array.isArray(rows) ? rows : [];
    if (!window?.start || !window?.end) return source;
    const byDate = new Map();
    for (const row of source) {
      const date = recordLocalDate(row, timeZone);
      if (date) byDate.set(date, { ...row, date });
    }
    return localDateRange(window.start, window.end).map((date) => byDate.get(date) || { date });
  }

  function calculateKnownNutrientTotals(foods) {
    const rows = Array.isArray(foods) ? foods : [];
    return Object.fromEntries(nutrientKeys.map((key) => {
      if (!rows.length) return [key, null];
      const values = rows.map((food) => finiteNumber(food?.[key]));
      if (values.some((value) => value === null || value < 0)) return [key, null];
      return [key, values.reduce((total, value) => total + value, 0)];
    }));
  }

  const nutritionDisplayFormat = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 });
  function formatNutritionAmount(value) {
    const number = finiteNumber(value);
    return number === null ? "—" : nutritionDisplayFormat.format(number);
  }

  function visibleMeals(records) {
    return (Array.isArray(records) ? records : []).filter((record) => record && record.deleted !== true);
  }

  function aggregateNutritionByDate(records, timeZone = "Asia/Taipei") {
    const grouped = new Map();
    for (const record of visibleMeals(records)) {
      const date = recordLocalDate(record, timeZone);
      if (!date) continue;
      if (!grouped.has(date)) grouped.set(date, { visibleCount: 0, included: [] });
      const day = grouped.get(date);
      day.visibleCount++;
      if (record.includedInTotals === true) day.included.push(record);
    }
    return [...grouped.entries()].map(([date, day]) => ({
      date,
      ...calculateKnownNutrientTotals(day.included),
      mealCount: day.visibleCount,
    })).sort((left, right) => left.date.localeCompare(right.date));
  }

  const timelineMetricKeys = Object.freeze([
    "weight", "bodyFatPercentage", "fatMass", "bmi", "sleepHours", "sleepScore",
    "steps", "activeMinutes", "activeCalories", "caloriesBurned", "heartRate", "hrv", "spo2",
    "caloriesIntake", "protein", "carbs", "fat", "nutritionMealCount", "trainingSets",
    "trainingVolume", "trainingSessions", "healthScore", "recoveryScore", "fatigueScore",
    "activityScore", "trainingScore", "nutritionScore", "bodyCompositionScore",
  ]);

  const terminalStaleReasons = Object.freeze(new Set(["RECOMPUTE_FAILED"]));

  function rowStaleReasons(row) {
    return [row?.staleReason, row?.sleepStaleReason, row?.activityStaleReason, row?.nutritionStaleReason, row?.healthStaleReason]
      .filter((reason) => typeof reason === "string" && reason.length);
  }

  function timelineReadState(rows, today = null) {
    const candidates = [...(Array.isArray(rows) ? rows : []), ...(today && typeof today === "object" ? [today] : [])];
    if (candidates.some((row) => rowStaleReasons(row).some((reason) => terminalStaleReasons.has(reason)))) return "error";
    if (candidates.some((row) => [row?.dataStatus, row?.sleepDataStatus, row?.activityDataStatus, row?.sleepAnalysisDataStatus, row?.activityAnalysisDataStatus, row?.healthStatus].includes("STALE")
      || rowStaleReasons(row).length)) return "updating";
    if (candidates.some((row) => timelineMetricKeys.some((key) => finiteNumber(row?.[key]) !== null))) return "ready";
    return "empty";
  }

  function nutritionReadState(records, rows, date, timeZone = "Asia/Taipei") {
    const targetDate = isValidDateKey(date) ? date : null;
    if (!targetDate) return "error";
    const targetRow = (Array.isArray(rows) ? rows : []).find((row) => recordLocalDate(row, timeZone) === targetDate);
    if (terminalStaleReasons.has(targetRow?.nutritionStaleReason) || terminalStaleReasons.has(targetRow?.healthStaleReason)) return "error";
    if (targetRow?.nutritionDataStatus === "STALE" || targetRow?.nutritionStaleReason || targetRow?.healthStatus === "STALE" || targetRow?.healthStaleReason) return "updating";
    const targetMeals = visibleMeals(records).filter((record) => recordLocalDate(record, timeZone) === targetDate);
    if (targetMeals.length || ["caloriesIntake", "protein", "carbs", "fat", "nutritionMealCount"]
      .some((key) => finiteNumber(targetRow?.[key]) !== null)) return "ready";
    return "empty";
  }

  function metricReadState(metric, rows, fallbackState = "ready") {
    const candidates = Array.isArray(rows) ? rows : [];
    const hasValue = candidates.some((row) => finiteNumber(row?.[metric]) !== null);
    if (!candidates.length) return ["loading", "updating", "error"].includes(fallbackState) ? fallbackState : "empty";
    const domain = ["sleepHours", "sleepScore"].includes(metric) ? "sleep"
      : ["steps", "activeMinutes", "activeCalories", "caloriesBurned", "heartRate", "hrv", "spo2"].includes(metric) ? "activity"
      : ["caloriesIntake", "protein", "carbs", "fat", "nutritionMealCount"].includes(metric) ? "nutrition"
      : ["healthScore", "recoveryScore", "fatigueScore", "activityScore", "trainingScore", "nutritionScore", "bodyCompositionScore"].includes(metric) ? "health"
      : "body";
    const reasonKey = `${domain}StaleReason`, statusKeys = domain === "sleep"
      ? ["sleepDataStatus", "sleepAnalysisDataStatus"]
      : domain === "activity" ? ["activityDataStatus", "activityAnalysisDataStatus"]
      : domain === "nutrition" ? ["nutritionDataStatus"]
      : domain === "health" ? ["healthStatus"] : [];
    if (candidates.some((row) => terminalStaleReasons.has(row?.[reasonKey]))) return "error";
    if (candidates.some((row) => statusKeys.some((key) => row?.[key] === "STALE") || row?.[reasonKey])) return "updating";
    return hasValue ? "ready" : "empty";
  }

  function sortMealsByLocalTime(records, timeZone = "Asia/Taipei") {
    return visibleMeals(records).map((record) => ({ ...record, date: recordLocalDate(record, timeZone) }))
      .filter((record) => record.date)
      .sort((left, right) => right.date.localeCompare(left.date)
        || String(left.time || left.recordedAt || left.recorded_at || "").localeCompare(String(right.time || right.recordedAt || right.recorded_at || "")));
  }

  function workoutGroupKey(record, index, timeZone = "Asia/Taipei") {
    const date = recordLocalDate(record, timeZone) || "unknown-date";
    const recordId = String(record?.recordId || `row-${index}`);
    // Never merge legacy rows by a mutable display label. Records without both
    // canonical identifiers stay isolated until the server supplies stable IDs.
    const bodyPartId = record?.bodyPartId ? String(record.bodyPartId) : `legacy-body:${recordId}`;
    const exerciseId = record?.exerciseId ? String(record.exerciseId) : `legacy-exercise:${recordId}`;
    return { date, bodyPartId, exerciseId, key: JSON.stringify([date, bodyPartId, exerciseId]) };
  }

  function groupWorkoutRecords(records, timeZone = "Asia/Taipei") {
    const groups = new Map();
    for (const [index, record] of (Array.isArray(records) ? records : []).filter((record) => record?.deleted !== true).entries()) {
      const identity = workoutGroupKey(record, index, timeZone);
      let group = groups.get(identity.key);
      if (!group) {
        group = {
          ...identity,
          bodyPartName: String(record?.bodyPartName || record?.muscleGroup || "未分類"),
          exerciseName: String(record?.exerciseName || "未命名動作"),
          totalSets: 0,
          totalVolume: 0,
          sessions: [],
          records: [],
          historicalNames: [],
        };
        groups.set(identity.key, group);
      }
      const totalSets = finiteNumber(record?.totalSets);
      const totalVolume = finiteNumber(record?.totalVolume);
      group.totalSets += totalSets === null ? 1 : totalSets;
      group.totalVolume += totalVolume === null ? 0 : totalVolume;
      group.records.push(record);
      if (record?.exerciseName && !group.historicalNames.includes(String(record.exerciseName))) {
        group.historicalNames.push(String(record.exerciseName));
      }
      const sessionId = String(record?.sessionId || `legacy-session:${record?.recordId || index}`);
      let session = group.sessions.find((item) => item.sessionId === sessionId);
      if (!session) {
        session = { sessionId, durationMinutes: finiteNumber(record?.durationMinutes), sets: [] };
        group.sessions.push(session);
      }
      const duration = finiteNumber(record?.durationMinutes);
      if (duration !== null) session.durationMinutes = Math.max(session.durationMinutes ?? 0, duration);
      session.sets.push({
        recordId: String(record?.recordId || ""),
        revision: positiveInteger(record?.revision),
        setOrder: positiveInteger(record?.setOrder),
        setNumber: positiveInteger(record?.setNumber) ?? session.sets.length + 1,
        weight: finiteNumber(record?.weight),
        reps: finiteNumber(record?.reps),
        totalVolume,
      });
    }
    return [...groups.values()].map((group) => ({
      ...group,
      sessions: group.sessions.map((session) => ({...session,sets:[...session.sets].sort((a,b) =>
        (a.setOrder??Number.MAX_SAFE_INTEGER)-(b.setOrder??Number.MAX_SAFE_INTEGER)||a.recordId.localeCompare(b.recordId))})),
      sessionCount: group.sessions.length,
    })).sort((a, b) => b.date.localeCompare(a.date) || a.bodyPartName.localeCompare(b.bodyPartName, "zh-Hant") || a.exerciseName.localeCompare(b.exerciseName, "zh-Hant"));
  }

  function workoutBatchUpdates(group, patch, allRecords = group?.records) {
    if (!group || !Array.isArray(group.records) || !group.records.length) throw Error("EMPTY_WORKOUT_GROUP");
    const date = String(patch?.date || "");
    const exerciseId = String(patch?.exerciseId || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !exerciseId) throw Error("INVALID_WORKOUT_BATCH_PATCH");
    const groupIds = new Set(group.records.map((record) => String(record?.recordId || "")));
    const records = [...group.records];
    if (date !== group.date) {
      const sessionIds = new Set(group.records.map((record) => String(record?.sessionId || "")));
      if (sessionIds.has("")) throw Error("MISSING_WORKOUT_SESSION_ID");
      for (const record of Array.isArray(allRecords) ? allRecords : []) {
        if (sessionIds.has(String(record?.sessionId || "")) && !groupIds.has(String(record?.recordId || ""))) records.push(record);
      }
    }
    return records.map((record) => {
      const recordId = String(record?.recordId || "");
      const revision = positiveInteger(record?.revision);
      if (!recordId || revision === null) throw Error("INVALID_WORKOUT_BATCH_RECORD");
      return { recordId, revision, date, ...(groupIds.has(recordId) ? { exerciseId } : {}) };
    });
  }

  return Object.freeze({
    nutrientKeys,
    isValidDateKey,
    localDateKey,
    recordLocalDate,
    localDateRange,
    shiftLocalDate,
    fillLocalDateGaps,
    calculateKnownNutrientTotals,
    formatNutritionAmount,
    visibleMeals,
    aggregateNutritionByDate,
    timelineReadState,
    nutritionReadState,
    metricReadState,
    sortMealsByLocalTime,
    groupWorkoutRecords,
    workoutBatchUpdates,
  });
});
