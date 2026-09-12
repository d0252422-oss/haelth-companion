from copy import deepcopy
from datetime import date, datetime, timedelta

import pytest

from health_companion_algorithms.aggregation import aggregate_day, derived_metrics
from health_companion_algorithms.domain_contracts import CanonicalRecord
from health_companion_algorithms.domain_engines import DomainEngines
from health_companion_algorithms.domain_runtime import compute_domain_request


@pytest.mark.parametrize(
    "zone,day",
    [
        ("Asia/Taipei", "2026-09-12"),
        ("America/New_York", "2026-03-08"),
        ("America/New_York", "2026-11-01"),
    ],
)
def test_runtime_preserves_reference_bundle_including_dst(zone, day):
    request = {
        "algorithm_version": "health-score-v1.0",
        "subject_ref": "synthetic",
        "timezone": zone,
        "canonical_inputs": {
            "date": day,
            "calculated_at": day + "T12:00:00+00:00",
            "records": [
                {
                    "subject_ref": "synthetic",
                    "source": "synthetic",
                    "record_id": "steps-1",
                    "domain": "steps",
                    "revision": 1,
                    "recorded_at": day + "T06:59:00+00:00",
                    "updated_at": day + "T12:00:00+00:00",
                    "value": 0,
                    "unit": "count",
                    "source_quality": "UNKNOWN",
                }
            ],
        },
    }
    actual = compute_domain_request(request)["bundle"]
    records = [CanonicalRecord.model_validate(r) for r in request["canonical_inputs"]["records"]]
    days = [
        aggregate_day(records, "synthetic", date.fromisoformat(day) - timedelta(days=i), zone)
        for i in range(27, -1, -1)
    ]
    derived = derived_metrics(days, "synthetic", date.fromisoformat(day))
    expected = DomainEngines().calculate(
        days[-1],
        derived,
        calculated_at=datetime.fromisoformat(request["canonical_inputs"]["calculated_at"]),
        reason="EXISTING_BETA_QUEUE_EXPERIMENTAL",
    )
    assert actual == {
        "daily": days[-1].model_dump(mode="json"),
        "derived": derived,
        "outputs": {k: v.model_dump(mode="json") for k, v in expected.items()},
    }
    assert actual["outputs"]["nutrition"]["score"] is None
    changed = deepcopy(request)
    changed["subject_ref"] = "different-subject"
    with pytest.raises(ValueError, match="INVALID_CANONICAL_INPUTS"):
        compute_domain_request(changed)


def test_runtime_rejects_unrecognized_version():
    with pytest.raises(ValueError, match="UNKNOWN_ALGORITHM_VERSION"):
        compute_domain_request({"algorithm_version": "invented"})
