"""User-scoped daily projections, reconciliation and rolling dependency windows."""

from __future__ import annotations

import math
import statistics
from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from .domain_contracts import CanonicalRecord, DailyAggregate, Quality, fingerprint
from .nutrition import Meal, NutritionCalculator

METRICS = {
    "steps": ("steps", "count"),
    "workout": ("exercise_minutes", "minute"),
    "active_minutes": ("active_minutes", "minute"),
    "distance": ("distance_km", "km"),
    "energy": ("calories_burned", "kcal"),
    "heart_rate": ("average_hr", "bpm"),
    "resting_heart_rate": ("resting_hr", "bpm"),
    "hrv": ("hrv", "ms"),
    "weight": ("weight", "kg"),
    "body_fat": ("body_fat", "percent"),
    "muscle_mass": ("muscle_mass", "kg"),
    "fat_mass": ("fat_mass", "kg"),
    "sedentary_time": ("sedentary_minutes", "minute"),
}
SUM_DOMAINS = {"steps", "workout", "active_minutes", "distance", "energy", "sedentary_time"}


def day_bounds(day: date, timezone: str) -> tuple[datetime, datetime]:
    zone = ZoneInfo(timezone)
    return (
        datetime.combine(day, time.min, zone).astimezone(UTC),
        datetime.combine(day + timedelta(days=1), time.min, zone).astimezone(UTC),
    )


def affected_dates(record: CanonicalRecord, timezone: str) -> tuple[date, ...]:
    zone = ZoneInfo(timezone)
    if record.domain == "sleep":  # Preserve the existing WAKE_DATE_V1 contract.
        return ((record.ended_at or record.recorded_at).astimezone(zone).date(),)
    if record.domain == "nutrition":
        meal = Meal.model_validate(record.payload)
        return (meal.meal_time.astimezone(zone).date(),)
    if record.domain in SUM_DOMAINS and record.started_at and record.ended_at:
        first = record.started_at.astimezone(zone).date()
        last = (record.ended_at - timedelta(microseconds=1)).astimezone(zone).date()
        if (last - first).days > 31:
            raise ValueError("source interval exceeds bounded 32-date ingestion policy")
        return tuple(first + timedelta(days=i) for i in range((last - first).days + 1))
    return (record.recorded_at.astimezone(zone).date(),)


def reconcile(records: list[CanonicalRecord], subject: str) -> list[CanonicalRecord]:
    latest: dict[tuple[str, str, str, str], CanonicalRecord] = {}
    for record in records:
        if record.subject_ref != subject:
            continue
        old = latest.get(record.identity)
        if old and record.revision == old.revision:
            if record.model_dump(mode="json") != old.model_dump(mode="json"):
                raise ValueError("conflicting canonical revision")
        elif old is None or record.revision > old.revision:
            latest[record.identity] = record
    return sorted((r for r in latest.values() if not r.deleted), key=lambda r: r.identity)


def _union_minutes(intervals: list[tuple[datetime, datetime]]) -> float | None:
    if not intervals:
        return None
    total = 0.0
    start, end = sorted(intervals)[0]
    for left, right in sorted(intervals)[1:]:
        if left <= end:
            end = max(end, right)
        else:
            total += (end - start).total_seconds() / 60
            start, end = left, right
    return round(total + (end - start).total_seconds() / 60, 3)


def _manual_source_excluded(record: CanonicalRecord, day: date) -> bool:
    """Apply a bounded internal projection mask without rewriting source intervals.

    This metadata is supplied by the authenticated SQL projection, not a manual
    input value or a rule that prefers a source. Retaining the canonical record
    in ``active`` keeps its provenance and mask in the aggregate fingerprint.
    """
    if "manual_reconciliation" not in record.payload:
        return False
    reconciliation = record.payload["manual_reconciliation"]
    if (
        not isinstance(reconciliation, dict)
        or reconciliation.get("policy") != "manual-source-exclusion-v1"
    ):
        raise ValueError("INVALID_MANUAL_RECONCILIATION")
    excluded = reconciliation.get("excluded_local_dates")
    if not isinstance(excluded, list) or len(excluded) > 32:
        raise ValueError("INVALID_MANUAL_RECONCILIATION")
    seen: set[str] = set()
    for item in excluded:
        if not isinstance(item, str) or len(item) != 10 or item in seen:
            raise ValueError("INVALID_MANUAL_RECONCILIATION")
        try:
            parsed = date.fromisoformat(item)
        except ValueError as error:
            raise ValueError("INVALID_MANUAL_RECONCILIATION") from error
        if parsed.isoformat() != item:
            raise ValueError("INVALID_MANUAL_RECONCILIATION")
        seen.add(item)
    return day.isoformat() in seen


def aggregate_day(
    records: list[CanonicalRecord],
    subject: str,
    day: date,
    timezone: str,
    nutrition: NutritionCalculator | None = None,
) -> DailyAggregate:
    active = [r for r in reconcile(records, subject) if day in affected_dates(r, timezone)]
    groups: dict[str, list[tuple[float, CanonicalRecord]]] = defaultdict(list)
    flags: set[str] = set()
    sleeps: list[tuple[datetime, datetime]] = []
    meals: list[Meal] = []
    left, right = day_bounds(day, timezone)
    for record in active:
        if _manual_source_excluded(record, day):
            flags.add("SOURCE_CONFLICT:" + record.domain)
            continue
        if record.domain == "nutrition":
            meals.append(Meal.model_validate(record.payload))
            continue
        if record.domain == "sleep":
            if record.started_at and record.ended_at:
                duration = (
                    record.ended_at.astimezone(UTC) - record.started_at.astimezone(UTC)
                ).total_seconds() / 60
                if duration <= 1440:
                    sleeps.append(
                        (record.started_at.astimezone(UTC), record.ended_at.astimezone(UTC))
                    )
                else:
                    flags.add("OUTLIER:sleep")
            else:
                flags.add("MISSING_INTERVAL:sleep")
            continue
        spec = METRICS.get(record.domain)
        if spec is None:
            flags.add("UNSUPPORTED_DOMAIN:" + record.domain)
            continue
        metric, unit = spec
        value = record.value
        if value is None:
            continue
        if value < 0 or not math.isfinite(value):
            flags.add("INVALID:" + metric)
            continue
        if record.unit != unit:
            flags.add("UNIT_MISMATCH:" + metric)
            continue
        if (
            metric in {"average_hr", "resting_hr"}
            and not 20 <= value <= 300
            or metric == "body_fat"
            and value > 100
        ):
            flags.add("OUTLIER:" + metric)
            continue
        if record.domain in SUM_DOMAINS and record.started_at and record.ended_at:
            start, end = record.started_at.astimezone(UTC), record.ended_at.astimezone(UTC)
            overlap = (min(end, right) - max(start, left)).total_seconds()
            value *= overlap / (end - start).total_seconds()
            if start < left or end > right:
                flags.add("ESTIMATED_INTERVAL_PRORATION:" + metric)
        groups[metric].append((value, record))
    metrics: dict[str, Any] = dict.fromkeys([v[0] for v in METRICS.values()])
    for metric, pairs in groups.items():
        if len({r.source for _, r in pairs}) > 1:
            flags.add("AMBIGUOUS_SOURCE:" + metric)
            continue  # Do not sum overlapping vendors or invent source reliability.
        if any(r.domain in SUM_DOMAINS for _, r in pairs):
            metrics[metric] = round(sum(v for v, _ in pairs), 3)
        else:
            metrics[metric] = round(statistics.mean(v for v, _ in pairs), 3)
    metrics["sleep_minutes"] = _union_minutes(sleeps)
    if sleeps:
        earliest = min(a for a, _ in sleeps).astimezone(ZoneInfo(timezone))
        metrics["bedtime_minute"] = earliest.hour * 60 + earliest.minute
        if len(sleeps) > 1:
            flags.add("SLEEP_INTERVAL_UNION")
    else:
        metrics["bedtime_minute"] = None
    metrics["nutrition"] = (nutrition or NutritionCalculator()).daily(tuple(meals), day, timezone)
    quality = (
        Quality.UNKNOWN
        if not active or any(r.source_quality == Quality.UNKNOWN for r in active)
        else Quality.LOW
        if flags or any(r.source_quality == Quality.LOW for r in active)
        else Quality.MEDIUM
    )
    evidence = tuple("|".join(r.identity[1:]) + f":{r.revision}" for r in active)
    return DailyAggregate(
        subject_ref=subject,
        calculation_date=day,
        timezone=timezone,
        metrics=metrics,
        flags=tuple(sorted(flags)),
        evidence_ids=evidence,
        source_quality=quality,
        input_fingerprint=fingerprint(
            {
                "records": [r.model_dump(mode="json") for r in active],
                "timezone": timezone,
                "day": str(day),
                "metrics": metrics,
                "version": "daily-aggregation-v1.0",
            }
        ),
    )


def derived_metrics(days: list[DailyAggregate], subject: str, day: date) -> dict[str, Any]:
    selected = {
        d.calculation_date: d
        for d in days
        if d.subject_ref == subject and day - timedelta(days=27) <= d.calculation_date <= day
    }
    result: dict[str, Any] = {"engine_version": "derived-metrics-v1.0"}
    for metric in (
        "steps",
        "weight",
        "resting_hr",
        "sleep_minutes",
        "hrv",
        "exercise_minutes",
        "calories_burned",
        "fat_mass",
        "bedtime_minute",
        "nutrition_calories",
        "nutrition_protein_g",
        "nutrition_carbs_g",
        "nutrition_fat_g",
        "nutrition_fiber_g",
        "nutrition_sodium_mg",
    ):
        for window in (7, 28):
            pairs = []
            for when, agg in sorted(selected.items()):
                if when < day - timedelta(days=window - 1):
                    continue
                value = (
                    agg.metrics["nutrition"]["totals"][metric.removeprefix("nutrition_")]
                    if metric.startswith("nutrition_")
                    else agg.metrics.get(metric)
                )
                if value is not None:
                    pairs.append((when, float(value)))
            result[f"{metric}_{window}d_count"] = len(pairs)
            result[f"{metric}_{window}d_avg"] = (
                round(statistics.mean(v for _, v in pairs), 3) if pairs else None
            )
            if window == 28:
                prior = [(d, v) for d, v in pairs if d < day]
                result[f"{metric}_baseline_count"] = len(prior)
                result[f"{metric}_baseline"] = (
                    round(statistics.mean(v for _, v in prior), 3) if len(prior) >= 7 else None
                )
                result[f"{metric}_trend"] = (
                    round((pairs[-1][1] - pairs[0][1]) / (pairs[-1][0] - pairs[0][0]).days, 3)
                    if len(pairs) >= 2
                    else None
                )
                if metric == "bedtime_minute":
                    values = [v for _, v in pairs]
                    # Unwrap around the first observed bedtime, not midnight.
                    offsets = [((v - values[0] + 720) % 1440) - 720 for v in values]
                    result["sleep_regularity_minutes"] = (
                        round(statistics.pstdev(offsets), 3) if len(values) >= 3 else None
                    )
    result["input_fingerprints"] = [selected[d].input_fingerprint for d in sorted(selected)]
    activity_days = [
        agg.metrics["steps"]
        for when, agg in selected.items()
        if when >= day - timedelta(days=6) and agg.metrics["steps"] is not None
    ]
    result["activity_observed_days_7"] = len(activity_days)
    result["activity_nonzero_days_7"] = sum(v > 0 for v in activity_days)
    result["activity_consistency_observed_fraction"] = (
        sum(v > 0 for v in activity_days) / len(activity_days) if activity_days else None
    )
    return result


DEPENDENCIES = {
    "nutrition": (),
    "sleep": (),
    "activity": (),
    "cardio": (),
    "body": (),
    "recovery": ("sleep", "activity", "cardio"),
    "overall": ("nutrition", "sleep", "activity", "body", "recovery"),
}


def dependency_order() -> tuple[str, ...]:
    order: list[str] = []
    pending = dict(DEPENDENCIES)
    while pending:
        ready = sorted(k for k, deps in pending.items() if all(d in order for d in deps))
        if not ready:
            raise ValueError("engine dependency cycle")
        for key in ready:
            order.append(key)
            del pending[key]
    return tuple(order)


def recompute_dates(
    old: CanonicalRecord | None, new: CanonicalRecord, timezone: str, through: date
) -> tuple[date, ...]:
    if old and old.subject_ref != new.subject_ref:
        raise ValueError("cross-user update")
    if old and old.model_dump(mode="json") == new.model_dump(mode="json"):
        return ()
    affected = set(affected_dates(new, timezone))
    if old:
        affected.update(affected_dates(old, timezone))
    return tuple(
        sorted(
            {
                start + timedelta(days=i)
                for start in affected
                for i in range(28)
                if start + timedelta(days=i) <= through
            }
        )
    )
