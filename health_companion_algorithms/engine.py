"""Python parity engine for canonical Apps Script health-score-v1.0.

This module deliberately contains no medical diagnosis and no learned coefficients.
Formula constants mirror evidence/apps-script-production/head/程式碼.js.
"""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import cast
from zoneinfo import ZoneInfo

from .models import AlgorithmResult, Confidence, EvidenceRef, EvidenceState

ALGORITHM_VERSION = "health-score-v1.0"
HEALTH_WEIGHTS = {
    "sleep": 0.25,
    "recovery": 0.20,
    "activity": 0.15,
    "training": 0.15,
    "nutrition": 0.15,
    "bodyComposition": 0.10,
}
SLEEP_WEIGHTS = {
    "duration": 0.30,
    "efficiency": 0.20,
    "deep": 0.15,
    "rem": 0.10,
    "continuity": 0.10,
    "regularity": 0.10,
    "nightHeartRate": 0.05,
}
RECOVERY_WEIGHTS = {
    "hrv": 0.35,
    "restingHeartRate": 0.25,
    "sleep": 0.20,
    "training": 0.15,
    "subjective": 0.05,
}
FATIGUE_WEIGHTS = {
    "shortTrainingLoad": 0.35,
    "sleepDebt": 0.25,
    "hrvSuppression": 0.20,
    "restingHeartRateElevation": 0.10,
    "consecutiveTrainingDays": 0.10,
}


def _number(value: object) -> float | None:
    if value is None or value == "" or isinstance(value, (dict, list, tuple, set)):
        return None
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))


def _round1(value: float) -> float:
    return math.floor(value * 10 + 0.5) / 10


def _target_range(
    value: object, lower: float, upper: float, outer_lower: float, outer_upper: float
) -> float | None:
    number = _number(value)
    if number is None:
        return None
    if lower <= number <= upper:
        return 100.0
    if number < lower:
        return _clamp((number - outer_lower) / max(1, lower - outer_lower) * 100, 0, 100)
    return _clamp((outer_upper - number) / max(1, outer_upper - upper) * 100, 0, 100)


def _ratio(actual: object, target: object, lower: float, upper: float) -> float | None:
    actual_number, target_number = _number(actual), _number(target)
    if actual_number is None or target_number is None or target_number <= 0:
        return None
    return _target_range(actual_number / target_number, lower, upper, 0, max(upper * 1.8, 2))


@dataclass(frozen=True)
class _Weighted:
    score: float | None
    completeness: float
    confidence: Confidence
    missing: tuple[str, ...]


def _confidence(completeness: float, sample_count: int | None = None) -> Confidence:
    if completeness >= 0.8 and (sample_count is None or sample_count >= 7):
        return Confidence.HIGH
    if completeness >= 0.5 and (sample_count is None or sample_count >= 3):
        return Confidence.MEDIUM
    return Confidence.LOW


def _weighted(
    components: Mapping[str, float | None],
    weights: Mapping[str, float],
    sample_count: int | None = None,
) -> _Weighted:
    total_weight = sum(weights.values())
    available_weight = sum(
        weights[key] for key in weights if _number(components.get(key)) is not None
    )
    missing = tuple(key for key in weights if _number(components.get(key)) is None)
    score = None
    if available_weight:
        available_scores = {
            key: value for key in weights if (value := _number(components.get(key))) is not None
        }
        score = _round1(
            sum(_clamp(value, 0, 100) * weights[key] for key, value in available_scores.items())
            / available_weight
        )
    completeness = round(available_weight / total_weight, 4) if total_weight else 0.0
    return _Weighted(score, completeness, _confidence(completeness, sample_count), missing)


class HealthScoreEngine:
    """Small deterministic façade for approved v1.0 activity and aggregate formulas."""

    def activity_components(
        self,
        *,
        steps: object = None,
        step_target: object = 7000,
        calories_burned: object = None,
        calories_burned_baseline: object = None,
    ) -> dict[str, float | None]:
        step_value, target = _number(steps), _number(step_target) or 7000
        return {
            "steps": None if step_value is None else _clamp(step_value / target * 100, 0, 115),
            "calories": _ratio(calories_burned, calories_burned_baseline, 0.8, 1.25),
        }

    def score_activity(
        self,
        *,
        subject_ref: str,
        period_start: datetime,
        period_end: datetime,
        timezone: str,
        evidence: tuple[EvidenceRef, ...] = (),
        calculated_at: datetime | None = None,
        baseline_sample_count: int | None = None,
        **inputs: object,
    ) -> AlgorithmResult:
        components = self.activity_components(**inputs)
        weighted = _weighted(components, {"steps": 0.7, "calories": 0.3}, baseline_sample_count)
        status = (
            "NO_DATA"
            if weighted.score is None
            else "TARGET_MET"
            if weighted.score >= 90
            else "ACTIVE"
            if weighted.score >= 65
            else "LOW_ACTIVITY"
        )
        return self._result(
            "activity-score",
            subject_ref,
            period_start,
            period_end,
            timezone,
            evidence,
            calculated_at,
            weighted,
            components,
            status,
        )

    def score_sleep(self, **kwargs: object) -> AlgorithmResult:
        minutes = _number(kwargs.pop("sleep_minutes", None))
        requirement = _number(kwargs.pop("sleep_requirement_minutes", None)) or 480
        in_bed = _number(kwargs.pop("time_in_bed_minutes", None))
        efficiency = _number(kwargs.pop("sleep_efficiency", None))
        if efficiency is None and minutes is not None and in_bed is not None and in_bed > 0:
            efficiency = minutes / in_bed * 100
        deep = _number(kwargs.pop("deep_sleep_minutes", None))
        rem = _number(kwargs.pop("rem_sleep_minutes", None))
        awake = _number(kwargs.pop("awake_minutes", None))
        deviation = _number(kwargs.pop("bedtime_deviation_minutes", None))
        night_hr = _number(kwargs.pop("night_heart_rate", None))
        baseline_hr = _number(kwargs.pop("resting_heart_rate_baseline", None))
        sample_count = kwargs.pop("baseline_sample_count", None)
        components = {
            "duration": _ratio(minutes, requirement, 0.88, 1.12),
            "efficiency": _target_range(efficiency, 85, 100, 55, 115),
            "deep": None
            if minutes in (None, 0) or deep is None
            else _target_range(deep / minutes * 100, 15, 25, 3, 45),
            "rem": None
            if minutes in (None, 0) or rem is None
            else _target_range(rem / minutes * 100, 18, 27, 5, 45),
            "continuity": None
            if awake is None or minutes is None
            else _clamp(100 - awake / max(1, minutes) * 260, 0, 100),
            "regularity": None
            if deviation is None
            else _clamp(100 - deviation / 120 * 100, 0, 100),
            "nightHeartRate": None
            if night_hr is None or baseline_hr is None
            else _clamp(100 - max(0, night_hr - baseline_hr) * 7, 0, 100),
        }
        weighted = _weighted(
            components, SLEEP_WEIGHTS, sample_count if isinstance(sample_count, int) else None
        )
        status = (
            "NO_DATA"
            if weighted.score is None
            else "EXCELLENT"
            if weighted.score >= 85
            else "GOOD"
            if weighted.score >= 70
            else "FAIR"
            if weighted.score >= 55
            else "POOR"
        )
        return self._domain_result("sleep-score", weighted, components, status, kwargs)

    def score_training(self, **kwargs: object) -> AlgorithmResult:
        daily = _number(kwargs.pop("training_load", None))
        baseline = _number(kwargs.pop("training_load_baseline", None))
        acute = _number(kwargs.pop("acute_load", None))
        chronic = _number(kwargs.pop("chronic_load", None))
        consecutive = _number(kwargs.pop("consecutive_training_days", None))
        sample_count = kwargs.pop("baseline_sample_count", None)
        ratio = (
            acute / chronic if acute is not None and chronic is not None and chronic > 0 else None
        )
        components = {
            "dailyLoad": None
            if daily is None
            else 75
            if daily == 0
            else 80
            if baseline is None
            else _ratio(daily, baseline, 0.55, 1.45),
            "loadBalance": _target_range(ratio, 0.75, 1.35, 0.25, 2.25),
            "recoverySpacing": None
            if consecutive is None
            else _clamp(100 - max(0, consecutive - 3) * 18, 25, 100),
        }
        weighted = _weighted(
            components,
            {"dailyLoad": 0.45, "loadBalance": 0.40, "recoverySpacing": 0.15},
            sample_count if isinstance(sample_count, int) else None,
        )
        status = (
            "NO_DATA"
            if weighted.score is None
            else "REST_DAY"
            if daily == 0
            else "LOAD_SPIKE"
            if ratio is not None and ratio > 1.5
            else "BALANCED"
            if weighted.score >= 70
            else "REVIEW_LOAD"
        )
        return self._domain_result("training-score", weighted, components, status, kwargs)

    def score_nutrition(self, **kwargs: object) -> AlgorithmResult:
        values = kwargs.pop("values", {})
        targets = kwargs.pop("targets", {})
        assert isinstance(values, Mapping) and isinstance(targets, Mapping)
        components = {
            "calories": _ratio(values.get("calories"), targets.get("calories"), 0.85, 1.15),
            "protein": _ratio(values.get("protein"), targets.get("protein"), 0.90, 1.25),
            "carbs": _ratio(values.get("carbs"), targets.get("carbs"), 0.70, 1.30),
            "fat": _ratio(values.get("fat"), targets.get("fat"), 0.70, 1.30),
            "mealDistribution": _target_range(values.get("mealCount"), 2, 5, 1, 8),
        }
        weighted = _weighted(
            components,
            {
                "calories": 0.30,
                "protein": 0.35,
                "carbs": 0.15,
                "fat": 0.10,
                "mealDistribution": 0.10,
            },
        )
        status = (
            "NO_DATA"
            if weighted.score is None
            else "ON_TARGET"
            if weighted.score >= 80
            else "PARTIAL"
            if weighted.score >= 60
            else "REVIEW_INTAKE"
        )
        return self._domain_result("nutrition-score", weighted, components, status, kwargs)

    def score_body_composition(self, **kwargs: object) -> AlgorithmResult:
        weight = _number(kwargs.pop("weight", None))
        fat = _number(kwargs.pop("fat_mass", None))
        target = _number(kwargs.pop("target_weight", None))
        weight_base = _number(kwargs.pop("weight_baseline", None))
        fat_base = _number(kwargs.pop("fat_mass_baseline", None))
        sample_count = kwargs.pop("baseline_sample_count", None)
        distance = (
            None
            if weight is None or target is None
            else abs(weight - target) / max(target, 1) * 100
        )
        components = {
            "goalProgress": None if distance is None else _clamp(100 - distance * 6, 25, 100),
            "weightStability": None
            if weight is None or weight_base is None
            else _clamp(100 - abs(weight - weight_base) * 18, 25, 100),
            "fatMassTrend": None
            if fat is None or fat_base is None
            else _clamp(80 - (fat - fat_base) * 30, 20, 100),
        }
        weighted = _weighted(
            components,
            {"goalProgress": 0.45, "weightStability": 0.25, "fatMassTrend": 0.30},
            sample_count if isinstance(sample_count, int) else None,
        )
        status = (
            "NO_DATA"
            if weighted.score is None
            else "ON_TRACK"
            if weighted.score >= 80
            else "STABLE"
            if weighted.score >= 60
            else "REVIEW_TREND"
        )
        return self._domain_result("body-composition-score", weighted, components, status, kwargs)

    def score_recovery(self, **kwargs: object) -> AlgorithmResult:
        hrv = _number(kwargs.pop("hrv_rmssd", None))
        hrv_base = _number(kwargs.pop("hrv_baseline", None))
        rhr = _number(kwargs.pop("resting_heart_rate", None))
        rhr_base = _number(kwargs.pop("resting_heart_rate_baseline", None))
        sample_count = kwargs.pop("baseline_sample_count", None)
        components = {
            "hrv": None
            if hrv is None or hrv_base in (None, 0)
            else _clamp(50 + (hrv / hrv_base - 1) * 180, 0, 100),
            "restingHeartRate": None
            if rhr is None or rhr_base is None
            else _clamp(100 - max(0, rhr - rhr_base) * 8 + max(0, rhr_base - rhr) * 2, 0, 100),
            "sleep": _number(kwargs.pop("sleep_score", None)),
            "training": _number(kwargs.pop("training_recovery_score", None)),
            "subjective": _number(kwargs.pop("subjective_recovery_score", None)),
        }
        weighted = _weighted(
            components, RECOVERY_WEIGHTS, sample_count if isinstance(sample_count, int) else None
        )
        status = (
            "NO_DATA"
            if weighted.score is None
            else "VERY_GOOD"
            if weighted.score >= 85
            else "GOOD"
            if weighted.score >= 70
            else "MODERATE"
            if weighted.score >= 50
            else "RECOVERY_NEEDED"
        )
        return self._domain_result("recovery-score", weighted, components, status, kwargs)

    def score_fatigue(self, **kwargs: object) -> AlgorithmResult:
        acute = _number(kwargs.pop("acute_load", None))
        chronic = _number(kwargs.pop("chronic_load", None))
        debt = _number(kwargs.pop("sleep_debt_minutes", None))
        hrv = _number(kwargs.pop("hrv_rmssd", None))
        hrv_base = _number(kwargs.pop("hrv_baseline", None))
        rhr = _number(kwargs.pop("resting_heart_rate", None))
        rhr_base = _number(kwargs.pop("resting_heart_rate_baseline", None))
        consecutive = _number(kwargs.pop("consecutive_training_days", None))
        sample_count = kwargs.pop("baseline_sample_count", None)
        ratio = (
            acute / chronic if acute is not None and chronic is not None and chronic > 0 else None
        )
        components = {
            "shortTrainingLoad": None
            if ratio is None
            else _clamp((ratio - 0.7) / 1.1 * 100, 0, 100),
            "sleepDebt": None if debt is None else _clamp(debt / 420 * 100, 0, 100),
            "hrvSuppression": None
            if hrv is None or hrv_base in (None, 0)
            else _clamp((1 - hrv / hrv_base) * 240, 0, 100),
            "restingHeartRateElevation": None
            if rhr is None or rhr_base is None
            else _clamp((rhr - rhr_base) * 10, 0, 100),
            "consecutiveTrainingDays": None
            if consecutive is None
            else _clamp((consecutive - 2) * 22, 0, 100),
        }
        weighted = _weighted(
            components, FATIGUE_WEIGHTS, sample_count if isinstance(sample_count, int) else None
        )
        status = (
            "NO_DATA"
            if weighted.score is None
            else "LOW"
            if weighted.score < 30
            else "MODERATE"
            if weighted.score < 55
            else "HIGH"
            if weighted.score < 75
            else "VERY_HIGH"
        )
        return self._domain_result("fatigue-index", weighted, components, status, kwargs)

    def _domain_result(
        self,
        algorithm_id: str,
        weighted: _Weighted,
        components: Mapping[str, float | None],
        status: str,
        kwargs: Mapping[str, object],
    ) -> AlgorithmResult:
        required = ("subject_ref", "period_start", "period_end", "timezone")
        missing = [key for key in required if key not in kwargs]
        if missing:
            raise ValueError(f"missing output context: {', '.join(missing)}")
        period_start = kwargs["period_start"]
        period_end = kwargs["period_end"]
        evidence = kwargs.get("evidence", ())
        calculated_at = kwargs.get("calculated_at")
        if not isinstance(period_start, datetime) or not isinstance(period_end, datetime):
            raise TypeError("period_start and period_end must be datetime values")
        if not isinstance(evidence, tuple) or not all(
            isinstance(item, EvidenceRef) for item in evidence
        ):
            raise TypeError("evidence must be a tuple of EvidenceRef values")
        if calculated_at is not None and not isinstance(calculated_at, datetime):
            raise TypeError("calculated_at must be a datetime")
        return self._result(
            algorithm_id,
            str(kwargs["subject_ref"]),
            period_start,
            period_end,
            str(kwargs["timezone"]),
            cast(tuple[EvidenceRef, ...], evidence),
            calculated_at,
            weighted,
            components,
            status,
        )

    def score_health(
        self,
        *,
        subject_ref: str,
        period_start: datetime,
        period_end: datetime,
        timezone: str,
        evidence: tuple[EvidenceRef, ...] = (),
        calculated_at: datetime | None = None,
        **components_input: object,
    ) -> AlgorithmResult:
        components = {key: _number(components_input.get(key)) for key in HEALTH_WEIGHTS}
        weights = dict(HEALTH_WEIGHTS)
        overlap = components["recovery"] is not None and (
            components["sleep"] is not None or components["training"] is not None
        )
        if overlap:
            weights["recovery"] *= 0.5
        weighted = _weighted(components, weights)
        status = (
            "NO_DATA"
            if weighted.score is None
            else "EXCELLENT"
            if weighted.score >= 85
            else "GOOD"
            if weighted.score >= 70
            else "FAIR"
            if weighted.score >= 55
            else "NEEDS_ATTENTION"
        )
        reasons = (
            ("RECOVERY_WEIGHT_HALVED_TO_LIMIT_SLEEP_TRAINING_DOUBLE_COUNT",)
            if overlap
            else ("NONE",)
        )
        return self._result(
            "health-score",
            subject_ref,
            period_start,
            period_end,
            timezone,
            evidence,
            calculated_at,
            weighted,
            components,
            status,
            reasons,
        )

    def _result(
        self,
        algorithm_id: str,
        subject_ref: str,
        period_start: datetime,
        period_end: datetime,
        timezone: str,
        evidence: tuple[EvidenceRef, ...],
        calculated_at: datetime | None,
        weighted: _Weighted,
        components: Mapping[str, float | None],
        status: str,
        reasons: tuple[str, ...] = (),
    ) -> AlgorithmResult:
        zone = ZoneInfo(timezone)
        newest_by_id: dict[str, EvidenceRef] = {}
        for item in evidence:
            if item.state is not EvidenceState.ACTIVE:
                continue
            previous = newest_by_id.get(item.record_id)
            if previous is None or item.source_updated_at > previous.source_updated_at:
                newest_by_id[item.record_id] = item
        active = sorted(newest_by_id.values(), key=lambda item: item.record_id)
        trace = [
            (item.record_id, item.source_updated_at.astimezone(UTC).isoformat()) for item in active
        ]
        payload = {
            "algorithm_id": algorithm_id,
            "version": ALGORITHM_VERSION,
            "subject_ref": subject_ref,
            "period_start": period_start.astimezone(UTC).isoformat(),
            "period_end": period_end.astimezone(UTC).isoformat(),
            "components": components,
            "evidence": trace,
        }
        fingerprint = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        return AlgorithmResult(
            algorithm_id=algorithm_id,
            algorithm_version=ALGORITHM_VERSION,
            subject_ref=subject_ref,
            period_start=period_start,
            period_end=period_end,
            score=weighted.score,
            completeness=weighted.completeness,
            confidence=weighted.confidence,
            components=dict(components),
            missing_inputs=weighted.missing,
            input_record_ids=tuple(item.record_id for item in active),
            input_fingerprint=fingerprint,
            calculated_at=calculated_at or datetime.now(UTC),
            reason_codes=reasons,
            status=status,
            timezone=timezone,
            local_date=period_end.astimezone(zone).date(),
        )
