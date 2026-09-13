"""Synthetic day-mask regression and executable Python/TypeScript parity reference.

No reference food values, score weights, or original golden expectations change.
``python -m tests_python.test_manual_reconciliation`` writes fresh reference JSON
to stdout for the Deno differential test; it does not access a DB or network.
"""

from __future__ import annotations

import json
from copy import deepcopy
from datetime import date, timedelta
from typing import Any

import pytest

from health_companion_algorithms.aggregation import aggregate_day, derived_metrics
from health_companion_algorithms.domain_contracts import CanonicalRecord, Quality
from health_companion_algorithms.domain_runtime import compute_domain_request

SUBJECT = "synthetic-manual-day-mask"
ZONE = "Asia/Taipei"
D1 = date(2026, 9, 11)
D2 = date(2026, 9, 12)
POLICY = "manual-source-exclusion-v1"


def native_record(**changes: Any) -> dict[str, Any]:
    return {
        "subject_ref": SUBJECT,
        "source": "SYNTHETIC_NATIVE_INTERVAL_NOT_DEVICE_EVIDENCE",
        "record_id": "native-cross-midnight",
        "revision": 1,
        "domain": "steps",
        "recorded_at": "2026-09-12T01:00:00+08:00",
        "updated_at": "2026-09-12T02:00:00+08:00",
        "started_at": "2026-09-11T23:00:00+08:00",
        "ended_at": "2026-09-12T01:00:00+08:00",
        "value": 1200,
        "unit": "count",
        "source_quality": "MEDIUM",
        "payload": {},
        **changes,
    }


def masked(record: dict[str, Any], days: list[str]) -> dict[str, Any]:
    result = deepcopy(record)
    result["payload"]["manual_reconciliation"] = {
        "policy": POLICY,
        "excluded_local_dates": days,
    }
    return result


def aggregate(record: dict[str, Any], day: date):
    return aggregate_day([CanonicalRecord.model_validate(record)], SUBJECT, day, ZONE)


def request(record: dict[str, Any], day: date) -> dict[str, Any]:
    return {
        "algorithm_id": "multi-domain-bundle",
        "algorithm_version": "health-score-v1.0",
        "domain": "multi_domain",
        "subject_ref": SUBJECT,
        "timezone": ZONE,
        "period_start": f"{day}T00:00:00+08:00",
        "period_end": f"{day}T23:59:59+08:00",
        "canonical_inputs": {
            "date": str(day),
            "records": [record],
            "calculated_at": "2026-09-12T12:00:00Z",
        },
    }


def reference_cases() -> list[dict[str, Any]]:
    original = native_record()
    conflict = masked(original, [str(D2)])
    sleep = native_record(
        domain="sleep", value=None, unit=None,
        ended_at="2026-09-12T06:00:00+08:00",
    )
    cases = [
        ("native-D1", original, D1),
        ("native-D2", original, D2),
        ("masked-D1-retained", conflict, D1),
        ("masked-D2-excluded", conflict, D2),
        ("zero-is-observed", native_record(value=0), D2),
        ("masked-zero-is-missing", masked(native_record(value=0), [str(D2)]), D2),
        ("empty-mask", masked(original, []), D2),
        ("sleep-wake-date-retained", masked(sleep, [str(D1)]), D2),
        ("sleep-wake-date-excluded", masked(sleep, [str(D2)]), D2),
        ("mask-replay", conflict, D2),
    ]
    return [
        {"id": name, "request": value, "expected": compute_domain_request(value)}
        for name, record, day in cases
        for value in [request(record, day)]
    ]


def test_mask_retains_original_native_interval_and_nonconflicting_day() -> None:
    original = native_record()
    conflict = masked(original, [str(D2)])
    before = deepcopy(conflict)
    d1, d2 = aggregate(conflict, D1), aggregate(conflict, D2)
    assert d1.metrics["steps"] == aggregate(original, D1).metrics["steps"] == 600
    assert d1.flags == ("ESTIMATED_INTERVAL_PRORATION:steps",)
    assert aggregate(original, D2).metrics["steps"] == 600
    assert d2.metrics["steps"] is None
    assert d2.flags == ("SOURCE_CONFLICT:steps",)
    assert d1.source_quality == d2.source_quality == Quality.LOW
    assert conflict == before  # No interval clipping or invented per-day source value.
    assert original["value"] == conflict["value"] == 1200


def test_excluded_day_preserves_evidence_and_changes_fingerprint() -> None:
    original = native_record()
    conflict = masked(original, [str(D2)])
    before, after = aggregate(original, D2), aggregate(conflict, D2)
    assert after.evidence_ids == before.evidence_ids
    assert len(after.evidence_ids) == 1
    assert after.input_fingerprint != before.input_fingerprint
    assert aggregate(conflict, D2).input_fingerprint == after.input_fingerprint
    assert aggregate(masked(original, []), D2).input_fingerprint != after.input_fingerprint


def test_masked_day_is_missing_not_zero_in_rolling_windows() -> None:
    zero = native_record(value=0)
    conflict = masked(zero, [str(D2)])
    assert aggregate(zero, D2).metrics["steps"] == 0
    assert aggregate(conflict, D1).metrics["steps"] == 0
    assert aggregate(conflict, D2).metrics["steps"] is None
    derived = derived_metrics([aggregate(conflict, D1), aggregate(conflict, D2)], SUBJECT, D2)
    assert derived["steps_7d_count"] == derived["steps_28d_count"] == 1
    assert derived["steps_7d_avg"] == derived["steps_28d_avg"] == 0
    assert derived["activity_observed_days_7"] == 1
    assert derived["activity_nonzero_days_7"] == 0


def test_sleep_keeps_wake_date_and_never_fabricates_interval() -> None:
    sleep = native_record(
        domain="sleep", value=None, unit=None,
        ended_at="2026-09-12T06:00:00+08:00",
    )
    assert aggregate(sleep, D1).metrics["sleep_minutes"] is None
    retained = aggregate(masked(sleep, [str(D1)]), D2)
    assert retained.metrics["sleep_minutes"] == 420
    assert retained.metrics["bedtime_minute"] == 23 * 60
    excluded = aggregate(masked(sleep, [str(D2)]), D2)
    assert excluded.metrics["sleep_minutes"] is None
    assert excluded.metrics["bedtime_minute"] is None
    assert excluded.flags == ("SOURCE_CONFLICT:sleep",)


@pytest.mark.parametrize("metadata", [
    None,
    False,
    [],
    {},
    {"policy": "prefer-manual", "excluded_local_dates": [str(D2)]},
    {"policy": POLICY},
    {"policy": POLICY, "excluded_local_dates": None},
    {"policy": POLICY, "excluded_local_dates": str(D2)},
    {"policy": POLICY, "excluded_local_dates": [None]},
    {"policy": POLICY, "excluded_local_dates": [20260912]},
    {"policy": POLICY, "excluded_local_dates": ["20260912"]},
    {"policy": POLICY, "excluded_local_dates": ["2026-9-12"]},
    {"policy": POLICY, "excluded_local_dates": ["2026-02-30"]},
    {"policy": POLICY, "excluded_local_dates": [str(D2), str(D2)]},
    {"policy": POLICY, "excluded_local_dates": [
        str(D2 - timedelta(days=i)) for i in range(33)
    ]},
])
def test_invalid_internal_mask_fails_closed(metadata: Any) -> None:
    record = native_record(payload={"manual_reconciliation": metadata})
    with pytest.raises(ValueError, match="^INVALID_MANUAL_RECONCILIATION$"):
        aggregate(record, D2)


def test_absent_or_empty_mask_does_not_change_metrics() -> None:
    original = native_record()
    assert aggregate(original, D2).metrics == aggregate(masked(original, []), D2).metrics
    assert aggregate(original, D2).flags == aggregate(masked(original, []), D2).flags


if __name__ == "__main__":
    print(json.dumps(reference_cases(), ensure_ascii=True, allow_nan=False))
