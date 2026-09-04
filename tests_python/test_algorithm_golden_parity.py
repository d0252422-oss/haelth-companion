import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from health_companion_algorithms import HealthScoreEngine

FIXTURES = json.loads(
    (
        Path(__file__).parents[1] / "fixtures" / "algorithm-golden" / "health-score-v1.0.json"
    ).read_text(encoding="utf-8")
)["fixtures"]
ENGINE = HealthScoreEngine()


def remap(domain: str, values: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    maps = {
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
    method = {"body_composition": "score_body_composition", "health_overall": "score_health"}.get(
        domain, f"score_{domain}"
    )
    mapping = maps.get(domain, {})
    return method, {mapping.get(key, key): value for key, value in values.items()}


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda item: item["fixture_id"])
def test_python_runtime_matches_apps_script_golden_fixture(fixture: dict[str, Any]) -> None:
    method, inputs = remap(fixture["domain"], fixture["canonical_inputs"])
    result = getattr(ENGINE, method)(
        subject_ref="golden-subject",
        period_start=datetime.fromisoformat(
            fixture["input_window"]["start"].replace("Z", "+00:00")
        ),
        period_end=datetime.fromisoformat(fixture["input_window"]["end"].replace("Z", "+00:00")),
        timezone=fixture["timezone"],
        calculated_at=datetime(2026, 8, 28, tzinfo=UTC),
        **inputs,
    )
    expected = fixture["expected"]
    assert result.score == expected["expected_score"]
    assert result.completeness == expected["expected_completeness"]
    assert result.confidence == expected["expected_confidence"]
    assert sorted(result.missing_inputs) == expected["expected_missing_inputs"]
    assert [code for code in result.reason_codes if code != "NONE"] == expected[
        "expected_reason_codes"
    ]
    assert result.algorithm_version == expected["algorithm_version"]
