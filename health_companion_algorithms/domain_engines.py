"""Domain adapters around the frozen v1 formulas; no production routing changes."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from .aggregation import day_bounds, dependency_order
from .domain_contracts import DailyAggregate, DomainOutput, Quality, ScoreStatus, fingerprint
from .engine import HealthScoreEngine

VERSIONS = {
    name: f"{name}-score-v1.0"
    for name in ("nutrition", "sleep", "activity", "cardio", "body", "recovery")
}
VERSIONS["overall"] = "health-score-v1.0"
GENERIC_TARGETS = {
    "calories": 2000.0,
    "protein": 50.0,
    "carbs": 275.0,
    "fat": 78.0,
    "fiber": 28.0,
    "sodium": 2300.0,
}


def health_score_inputs(outputs: dict[str, DomainOutput], subject: str) -> dict[str, float | None]:
    """No new cardio weight, no fabricated training, no null-to-zero coercion."""
    if any(output.subject_ref != subject for output in outputs.values()):
        raise ValueError("cross-user score dependency")
    dates = {output.calculation_date for output in outputs.values()}
    if len(dates) > 1:
        raise ValueError("cross-date score dependency")
    return {
        legacy: outputs[domain].score
        if domain in outputs
        and outputs[domain].score_status
        not in (ScoreStatus.STALE, ScoreStatus.ERROR, ScoreStatus.INSUFFICIENT_DATA)
        else None
        for domain, legacy in (
            ("sleep", "sleep"),
            ("recovery", "recovery"),
            ("activity", "activity"),
            ("training", "training"),
            ("nutrition", "nutrition"),
            ("body", "bodyComposition"),
        )
    }


class DomainEngines:
    def __init__(self) -> None:
        self.legacy = HealthScoreEngine()

    def calculate(
        self,
        daily: DailyAggregate,
        derived: dict[str, Any],
        *,
        calculated_at: datetime,
        reason: str,
        targets: dict[str, float] | None = None,
        stale: bool = False,
    ) -> dict[str, DomainOutput]:
        if calculated_at.tzinfo is None:
            raise ValueError("calculated_at requires timezone")
        for key, value in (targets or {}).items():
            if not isinstance(value, (float, int)) or not 0 < value < float("inf"):
                raise ValueError(f"invalid target: {key}")
        personal = targets or {}
        nutrition_targets = {**GENERIC_TARGETS, **personal}
        start, end = day_bounds(daily.calculation_date, daily.timezone)
        context: dict[str, Any] = dict(
            subject_ref=daily.subject_ref,
            period_start=start,
            period_end=end - timedelta(microseconds=1),
            timezone=daily.timezone,
            calculated_at=calculated_at,
        )
        m = daily.metrics
        nutrition = m["nutrition"]
        values = nutrition["totals"]
        output: dict[str, DomainOutput] = {}
        for domain in dependency_order():
            explanations = ["DEVELOPMENT_POLICY_NOT_CLINICALLY_VALIDATED", *daily.flags]
            components: dict[str, float | None]
            extra: dict[str, Any] = {}
            baseline_count = int(derived.get("resting_hr_baseline_count", 0))
            if domain == "sleep":
                result = self.legacy.score_sleep(
                    **context,
                    sleep_minutes=m.get("sleep_minutes"),
                    sleep_requirement_minutes=personal.get("sleep_minutes", 480),
                    bedtime_deviation_minutes=derived.get("sleep_regularity_minutes"),
                )
                explanations.append("WAKE_DATE_INTERVAL_UNION_NOT_SOURCE_CONFIDENCE")
                average = derived.get("sleep_minutes_7d_avg")
                extra["sleep_debt_minutes_daily_average"] = (
                    round(max(0, personal.get("sleep_minutes", 480) - average), 1)
                    if average is not None
                    else None
                )
            elif domain == "activity":
                result = self.legacy.score_activity(
                    **context,
                    steps=m.get("steps"),
                    step_target=personal.get("steps", derived.get("steps_baseline") or 7000),
                    calories_burned=m.get("calories_burned"),
                    calories_burned_baseline=derived.get("calories_burned_baseline"),
                    baseline_sample_count=int(derived.get("steps_baseline_count", 0)),
                )
            elif domain == "body":
                smoothed = derived.get("weight_7d_avg")
                result = self.legacy.score_body_composition(
                    **context,
                    weight=smoothed,
                    target_weight=personal.get("weight"),
                    weight_baseline=derived.get("weight_baseline"),
                    fat_mass=m.get("fat_mass"),
                    fat_mass_baseline=derived.get("fat_mass_baseline"),
                    baseline_sample_count=int(derived.get("weight_baseline_count", 0)),
                )
                height = personal.get("height_m")
                extra["BMI"] = round(smoothed / height**2, 1) if smoothed and height else None
                extra["weight_rate_of_change_kg_per_day"] = derived.get("weight_trend")
            elif domain in ("recovery", "cardio"):
                result = self.legacy.score_recovery(
                    **context,
                    resting_heart_rate=m.get("resting_hr"),
                    resting_heart_rate_baseline=derived.get("resting_hr_baseline"),
                    hrv_rmssd=m.get("hrv"),
                    hrv_baseline=derived.get("hrv_baseline"),
                    sleep_score=output["sleep"].score if domain == "recovery" else None,
                    baseline_sample_count=baseline_count,
                )
                if domain == "cardio":
                    explanations.append("PERSONAL_RHR_HRV_COMPONENTS_ONLY_NO_DIAGNOSIS")
            elif domain == "nutrition":
                result = self.legacy.score_nutrition(
                    **context,
                    values={
                        "calories": values["calories"],
                        "protein": values["protein_g"],
                        "carbs": values["carbs_g"],
                        "fat": values["fat_g"],
                        "mealCount": nutrition["meal_count"],
                    },
                    targets=nutrition_targets,
                )
                extra.update(nutrition)
                for window in (7, 28):
                    extra[f"rolling_{window}d"] = {
                        key: {
                            "average": derived.get(f"nutrition_{key}_{window}d_avg"),
                            "observed_days": derived.get(f"nutrition_{key}_{window}d_count", 0),
                        }
                        for key in values
                    }
                extra["nutrition_trend"] = {
                    key: derived.get(f"nutrition_{key}_trend") for key in values
                }
                extra["calorie_target_gap"] = (
                    values["calories"] - nutrition_targets["calories"]
                    if values["calories"] is not None
                    else None
                )
                extra["protein_target_gap"] = (
                    values["protein_g"] - nutrition_targets["protein"]
                    if values["protein_g"] is not None
                    else None
                )
                explanations.append("FIBER_SODIUM_INFORMATIONAL_NOT_IN_FROZEN_NUTRITION_WEIGHTS")
                if not all(k in personal for k in ("calories", "protein", "carbs", "fat")):
                    explanations.append("FDA_LABEL_BASELINE_NOT_PERSONAL_REQUIREMENT")
            else:
                overall_inputs: dict[str, Any] = health_score_inputs(output, daily.subject_ref)
                result = self.legacy.score_health(**context, **overall_inputs)
                explanations.append("FROZEN_OVERALL_WEIGHTS_AND_OVERLAP_ADJUSTMENT")
            score = result.score
            completeness = result.completeness
            missing = list(result.missing_inputs)
            # Legacy activity exposes a raw 115% target component. The frozen weighted
            # score already clamps it; preserve raw diagnostics separately from 0..100 scores.
            extra["legacy_component_values"] = dict(result.components)
            components = {
                key: min(100.0, max(0.0, value)) if value is not None else None
                for key, value in result.components.items()
            }
            if domain == "nutrition":
                components = {
                    "energy_component": components.get("calories"),
                    "protein_component": components.get("protein"),
                    "macro_component": (
                        round(
                            (float(components["carbs"] or 0) + float(components["fat"] or 0)) / 2, 1
                        )
                        if components.get("carbs") is not None and components.get("fat") is not None
                        else None
                    ),
                    "fiber_component": (
                        min(100, values["fiber_g"] / nutrition_targets["fiber"] * 100)
                        if values["fiber_g"] is not None
                        else None
                    ),
                    "sodium_component": (
                        100
                        if values["sodium_mg"] <= nutrition_targets["sodium"]
                        else max(0, 200 - values["sodium_mg"] / nutrition_targets["sodium"] * 100)
                    )
                    if values["sodium_mg"] is not None
                    else None,
                    "consistency_component": components.get("mealDistribution"),
                }
                completeness = nutrition["data_completeness"]
                missing.extend(nutrition["missing_inputs"])
                if values["calories"] is None or values["protein_g"] is None:
                    score = None
                    missing.append("calories_and_protein_required")
            confidence = (
                Quality.MEDIUM
                if completeness >= 0.8
                and daily.source_quality in (Quality.HIGH, Quality.MEDIUM)
                and personal
                else Quality.LOW
            )
            if score is None:
                confidence = Quality.UNKNOWN
            if domain == "nutrition" and nutrition["source_quality"] in ("LOW", "UNKNOWN"):
                confidence = Quality.LOW if score is not None else Quality.UNKNOWN
            status = (
                ScoreStatus.INSUFFICIENT_DATA
                if score is None
                else ScoreStatus.PARTIAL_DATA
                if completeness < 1 or confidence == Quality.LOW
                else ScoreStatus.VALID
            )
            if stale:
                status = ScoreStatus.STALE
                confidence = Quality.LOW
                explanations.append("STALE_INPUTS")
            metrics = {"daily": m, "derived": derived, **extra}
            output[domain] = DomainOutput(
                subject_ref=daily.subject_ref,
                domain=domain,
                calculation_date=daily.calculation_date,
                engine_version=VERSIONS[domain],
                score=score,
                score_status=status,
                confidence=confidence,
                data_completeness=completeness,
                missing_inputs=tuple(sorted(set(missing))),
                source_quality=daily.source_quality,
                metrics=metrics,
                components=components,
                explanations=tuple(explanations),
                recompute_reason=reason,
                calculated_at=calculated_at,
                input_fingerprint=fingerprint(
                    {
                        "daily": daily.input_fingerprint,
                        "derived": derived,
                        "targets": personal,
                        "version": VERSIONS[domain],
                        "stale": stale,
                        "dependencies": {k: v.input_fingerprint for k, v in output.items()}
                        if domain in ("recovery", "overall")
                        else {},
                    }
                ),
            )
        return output
