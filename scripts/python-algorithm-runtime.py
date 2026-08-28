"""Compute-only JSON bridge for the non-production Python algorithm candidate."""

from __future__ import annotations

import json
import sys
from datetime import datetime
from typing import Any

from health_companion_algorithms import HealthScoreEngine

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


def main() -> None:
    request: dict[str, Any] = json.load(sys.stdin)
    domain = str(request["domain"])
    method_name = METHODS.get(domain)
    if method_name is None:
        raise ValueError(f"UNSUPPORTED_DOMAIN:{domain}")
    raw_value = request.get("canonical_inputs") or {}
    if not isinstance(raw_value, dict):
        raise TypeError("canonical_inputs must be an object")
    raw_inputs: dict[str, Any] = {str(key): value for key, value in raw_value.items()}
    mapping = INPUT_MAPS.get(domain, {})
    inputs = {mapping.get(key, key): value for key, value in raw_inputs.items()}
    inputs.update(
        subject_ref=str(request["subject_ref"]),
        period_start=datetime.fromisoformat(str(request["period_start"]).replace("Z", "+00:00")),
        period_end=datetime.fromisoformat(str(request["period_end"]).replace("Z", "+00:00")),
        timezone=str(request["timezone"]),
    )
    result = getattr(HealthScoreEngine(), method_name)(**inputs)
    output = {
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
    json.dump(output, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
