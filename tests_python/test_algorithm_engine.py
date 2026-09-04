from datetime import UTC, datetime

import pytest
from hypothesis import given
from hypothesis import strategies as st

from health_companion_algorithms import EvidenceRef, HealthScoreEngine
from health_companion_algorithms.models import EvidenceState

START = datetime(2026, 8, 26, tzinfo=UTC)
END = datetime(2026, 8, 27, tzinfo=UTC)
NOW = datetime(2026, 8, 28, tzinfo=UTC)


def activity(**values: object):
    return HealthScoreEngine().score_activity(
        subject_ref="user-ref",
        period_start=START,
        period_end=END,
        timezone="Asia/Taipei",
        calculated_at=NOW,
        **values,
    )


def test_activity_golden_complete_matches_canonical_formula() -> None:
    result = activity(
        steps=7000, calories_burned=2000, calories_burned_baseline=2000, baseline_sample_count=7
    )
    assert result.score == 100
    assert result.completeness == 1
    assert result.confidence == "HIGH"
    assert result.status == "TARGET_MET"


def test_partial_missing_and_real_zero_have_distinct_semantics() -> None:
    missing = activity()
    zero = activity(steps=0)
    partial = activity(steps=3500)
    assert missing.score is None and missing.completeness == 0
    assert zero.score == 0 and zero.completeness == 0.7
    assert partial.score == 50 and partial.missing_inputs == ("calories",)


@pytest.mark.parametrize("steps, expected", [(-1, 0), (0, 0), (7000, 100), (100_000, 115)])
def test_activity_boundaries_are_clamped(steps: int, expected: float) -> None:
    assert activity(steps=steps).components["steps"] == expected


def test_invalid_and_non_finite_inputs_are_missing() -> None:
    assert activity(steps="bad").score is None
    assert activity(steps=float("nan")).score is None
    assert activity(steps={"value": 1}).score is None


def test_trace_dedupes_deleted_and_stale_records_and_is_deterministic() -> None:
    active = EvidenceRef(record_id="a", source_updated_at=NOW)
    deleted = EvidenceRef(record_id="deleted", source_updated_at=NOW, state=EvidenceState.DELETED)
    stale = EvidenceRef(record_id="stale", source_updated_at=NOW, state=EvidenceState.STALE)
    kwargs = dict(
        subject_ref="u",
        period_start=START,
        period_end=END,
        timezone="Asia/Taipei",
        calculated_at=NOW,
        steps=1,
        evidence=(active, deleted, stale),
    )
    first = HealthScoreEngine().score_activity(**kwargs)
    second = HealthScoreEngine().score_activity(**kwargs)
    assert first.input_record_ids == ("a",)
    assert first.input_fingerprint == second.input_fingerprint


def test_evidence_update_changes_fingerprint_but_out_of_order_input_does_not() -> None:
    older = EvidenceRef(record_id="a", source_updated_at=START)
    newer = EvidenceRef(record_id="b", source_updated_at=NOW)
    base = dict(
        subject_ref="u",
        period_start=START,
        period_end=END,
        timezone="UTC",
        calculated_at=NOW,
        steps=1,
    )
    first = HealthScoreEngine().score_activity(**base, evidence=(older, newer))
    reordered = HealthScoreEngine().score_activity(**base, evidence=(newer, older))
    updated = HealthScoreEngine().score_activity(
        **base, evidence=(EvidenceRef(record_id="a", source_updated_at=NOW), newer)
    )
    assert first.input_fingerprint == reordered.input_fingerprint
    assert first.input_fingerprint != updated.input_fingerprint


def test_timezone_boundary_uses_period_end_local_date() -> None:
    result = activity(steps=1)
    assert result.local_date.isoformat() == "2026-08-27"


def test_health_golden_overlap_and_partial_coverage() -> None:
    result = HealthScoreEngine().score_health(
        subject_ref="u",
        period_start=START,
        period_end=END,
        timezone="UTC",
        calculated_at=NOW,
        sleep=80,
        recovery=60,
        activity=100,
    )
    assert result.score == 82
    assert result.completeness == pytest.approx(0.5 / 0.9, abs=0.0001)
    assert result.reason_codes == ("RECOVERY_WEIGHT_HALVED_TO_LIMIT_SLEEP_TRAINING_DOUBLE_COUNT",)


def test_health_all_missing_and_zero_are_distinct() -> None:
    common = dict(
        subject_ref="u", period_start=START, period_end=END, timezone="UTC", calculated_at=NOW
    )
    missing = HealthScoreEngine().score_health(**common)
    zero = HealthScoreEngine().score_health(**common, activity=0)
    assert missing.score is None
    assert zero.score == 0


def test_duplicate_evidence_keeps_newest_version_once() -> None:
    old = EvidenceRef(record_id="same", source_updated_at=START)
    new = EvidenceRef(record_id="same", source_updated_at=NOW)
    result = HealthScoreEngine().score_activity(
        subject_ref="u",
        period_start=START,
        period_end=END,
        timezone="UTC",
        calculated_at=NOW,
        steps=10,
        evidence=(new, old, new),
    )
    assert result.input_record_ids == ("same",)


@pytest.mark.parametrize(
    ("method", "inputs", "expected"),
    [
        ("score_sleep", {"sleep_minutes": 480}, 100),
        ("score_training", {"training_load": 0}, 75),
        ("score_nutrition", {"values": {"calories": 2000}, "targets": {"calories": 2000}}, 100),
        ("score_body_composition", {"weight": 70, "target_weight": 70}, 100),
        ("score_recovery", {"hrv_rmssd": 50, "hrv_baseline": 50}, 50),
        ("score_fatigue", {"sleep_debt_minutes": 0}, 0),
    ],
)
def test_domain_golden_single_component(
    method: str, inputs: dict[str, object], expected: float
) -> None:
    context = {
        "subject_ref": "u",
        "period_start": START,
        "period_end": END,
        "timezone": "UTC",
        "calculated_at": NOW,
    }
    result = getattr(HealthScoreEngine(), method)(**context, **inputs)
    assert result.score == expected
    assert result.algorithm_version == "health-score-v1.0"


@pytest.mark.parametrize(
    "method",
    [
        "score_sleep",
        "score_training",
        "score_nutrition",
        "score_body_composition",
        "score_recovery",
        "score_fatigue",
    ],
)
def test_each_domain_all_missing_is_no_data(method: str) -> None:
    result = getattr(HealthScoreEngine(), method)(
        subject_ref="u", period_start=START, period_end=END, timezone="UTC", calculated_at=NOW
    )
    assert result.score is None
    assert result.status == "NO_DATA"


@given(st.integers(min_value=0, max_value=100_000))
def test_activity_is_deterministic_and_bounded(steps: int) -> None:
    first = activity(steps=steps)
    second = activity(steps=steps)
    assert first.score == second.score
    assert first.score is not None and 0 <= first.score <= 100
