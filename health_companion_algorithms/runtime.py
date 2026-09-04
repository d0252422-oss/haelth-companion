"""Transport-neutral request execution for the frozen algorithm engine."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from .engine import ALGORITHM_VERSION, HealthScoreEngine

METHODS = {
    "sleep": "score_sleep",
    "activity": "score_activity",
    "training": "score_training",
    "nutrition": "score_nutrition",
    "body_composition": "score_body_composition",
    "recovery": "score_recovery",
    "fatigue": "score_fatigue",
    "health_overall": "score_health",
}

ALGORITHM_IDS = {
    "sleep": "sleep-score",
    "activity": "activity-score",
    "training": "training-score",
    "nutrition": "nutrition-score",
    "body_composition": "body-composition-score",
    "recovery": "recovery-score",
    "fatigue": "fatigue-index",
    "health_overall": "health-score",
}

INPUT_MAPS = {
    "sleep": {
        "sleepMinutes": "sleep_minutes",
        "sleepRequirementMinutes": "sleep_requirement_minutes",
        "timeInBedMinutes": "time_in_bed_minutes",
        "sleepEfficiency": "sleep_efficiency",
        "deepSleepMinutes": "deep_sleep_minutes",
        "remSleepMinutes": "rem_sleep_minutes",
        "awakeMinutes": "awake_minutes",
        "bedtimeDeviationMinutes": "bedtime_deviation_minutes",
        "nightHeartRate": "night_heart_rate",
        "restingHeartRateBaseline": "resting_heart_rate_baseline",
        "baselineSampleCount": "baseline_sample_count",
    },
    "activity": {
        "stepTarget": "step_target",
        "caloriesBurned": "calories_burned",
        "caloriesBurnedBaseline": "calories_burned_baseline",
        "baselineSampleCount": "baseline_sample_count",
    },
    "training": {
        "trainingLoad": "training_load",
        "trainingLoadBaseline": "training_load_baseline",
        "acuteLoad": "acute_load",
        "chronicLoad": "chronic_load",
        "consecutiveTrainingDays": "consecutive_training_days",
        "baselineSampleCount": "baseline_sample_count",
    },
    "body_composition": {
        "fatMass": "fat_mass",
        "targetWeight": "target_weight",
        "weightBaseline": "weight_baseline",
        "fatMassBaseline": "fat_mass_baseline",
        "baselineSampleCount": "baseline_sample_count",
    },
    "recovery": {
        "hrvRmssd": "hrv_rmssd",
        "hrvBaseline": "hrv_baseline",
        "restingHeartRate": "resting_heart_rate",
        "restingHeartRateBaseline": "resting_heart_rate_baseline",
        "sleepScore": "sleep_score",
        "trainingRecoveryScore": "training_recovery_score",
        "subjectiveRecoveryScore": "subjective_recovery_score",
        "baselineSampleCount": "baseline_sample_count",
    },
    "fatigue": {
        "acuteLoad": "acute_load",
        "chronicLoad": "chronic_load",
        "sleepDebtMinutes": "sleep_debt_minutes",
        "hrvRmssd": "hrv_rmssd",
        "hrvBaseline": "hrv_baseline",
        "restingHeartRate": "resting_heart_rate",
        "restingHeartRateBaseline": "resting_heart_rate_baseline",
        "consecutiveTrainingDays": "consecutive_training_days",
        "baselineSampleCount": "baseline_sample_count",
    },
    "health_overall": {
        "sleepScore": "sleep",
        "recoveryScore": "recovery",
        "activityScore": "activity",
        "trainingScore": "training",
        "nutritionScore": "nutrition",
        "bodyCompositionScore": "bodyComposition",
    },
}

ALLOWED_REQUEST_KEYS = {
    "algorithm_id",
    "algorithm_version",
    "domain",
    "subject_ref",
    "period_start",
    "period_end",
    "timezone",
    "canonical_inputs",
    "missing_input_metadata",
    "traceability_refs",
    "trace_id",
    "request_id",
}


def validate_request(request: object) -> dict[str, Any]:
    if not isinstance(request, dict):
        raise ValueError("INVALID_ENVELOPE")
    normalized: dict[str, Any] = {str(key): value for key, value in request.items()}
    if set(normalized) - ALLOWED_REQUEST_KEYS:
        raise ValueError("UNEXPECTED_ENVELOPE_FIELD")
    required = (
        "algorithm_id",
        "algorithm_version",
        "domain",
        "subject_ref",
        "period_start",
        "period_end",
        "timezone",
    )
    if any(not isinstance(normalized.get(key), str) or not normalized[key] for key in required):
        raise ValueError("MISSING_OR_INVALID_REQUIRED_FIELD")
    domain = normalized["domain"]
    if domain not in METHODS or normalized["algorithm_id"] != ALGORITHM_IDS[domain]:
        raise ValueError("UNKNOWN_ALGORITHM_ID")
    if normalized["algorithm_version"] != ALGORITHM_VERSION:
        raise ValueError("UNKNOWN_ALGORITHM_VERSION")
    if not isinstance(normalized.get("canonical_inputs"), dict):
        raise ValueError("INVALID_CANONICAL_INPUTS")
    for key in ("missing_input_metadata",):
        if key in normalized and not isinstance(normalized[key], dict):
            raise ValueError(f"INVALID_{key.upper()}")
    if "traceability_refs" in normalized and not isinstance(normalized["traceability_refs"], list):
        raise ValueError("INVALID_TRACEABILITY_REFS")
    if "request_id" in normalized and (
        not isinstance(normalized["request_id"], str) or len(normalized["request_id"]) > 128
    ):
        raise ValueError("INVALID_REQUEST_ID")
    return normalized


def compute_request(raw_request: object) -> dict[str, Any]:
    request = validate_request(raw_request)
    domain = str(request["domain"])
    raw_inputs = request["canonical_inputs"]
    assert isinstance(raw_inputs, dict)
    mapping = INPUT_MAPS.get(domain, {})
    inputs: dict[str, Any] = {
        mapping.get(str(key), str(key)): value for key, value in raw_inputs.items()
    }
    inputs.update(
        subject_ref=str(request["subject_ref"]),
        period_start=datetime.fromisoformat(str(request["period_start"]).replace("Z", "+00:00")),
        period_end=datetime.fromisoformat(str(request["period_end"]).replace("Z", "+00:00")),
        timezone=str(request["timezone"]),
    )
    result = getattr(HealthScoreEngine(), METHODS[domain])(**inputs)
    return {
        "value": result.score,
        "score": result.score,
        "completeness": result.completeness,
        "confidence": result.confidence.value,
        "missing_inputs": sorted(result.missing_inputs),
        "reason_codes": sorted(code for code in result.reason_codes if code != "NONE"),
        "algorithm_version": result.algorithm_version,
        "traceability": {
            "input_fingerprint": result.input_fingerprint,
            "input_record_ids": list(result.input_record_ids),
        },
    }
