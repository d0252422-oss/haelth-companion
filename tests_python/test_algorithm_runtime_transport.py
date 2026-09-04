from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from health_companion_algorithms.runtime import compute_request, validate_request

FIXTURE = json.loads(
    (Path(__file__).parents[1] / "fixtures/algorithm-golden/health-score-v1.0.json").read_text(
        encoding="utf-8"
    )
)["fixtures"][0]


def valid_request() -> dict[str, Any]:
    return {
        "algorithm_id": FIXTURE["algorithm_id"],
        "algorithm_version": FIXTURE["algorithm_version"],
        "domain": FIXTURE["domain"],
        "subject_ref": "transport-test",
        "period_start": FIXTURE["input_window"]["start"],
        "period_end": FIXTURE["input_window"]["end"],
        "timezone": FIXTURE["timezone"],
        "canonical_inputs": FIXTURE["canonical_inputs"],
        "request_id": "request-one",
    }


@pytest.mark.parametrize(
    ("mutation", "error"),
    [
        (lambda request: request.update(extra="unexpected"), "UNEXPECTED_ENVELOPE_FIELD"),
        (lambda request: request.pop("algorithm_id"), "MISSING_OR_INVALID_REQUIRED_FIELD"),
        (lambda request: request.update(algorithm_id="unknown"), "UNKNOWN_ALGORITHM_ID"),
        (
            lambda request: request.update(algorithm_version="health-score-v9"),
            "UNKNOWN_ALGORITHM_VERSION",
        ),
        (lambda request: request.update(canonical_inputs=[]), "INVALID_CANONICAL_INPUTS"),
        (lambda request: request.update(traceability_refs={}), "INVALID_TRACEABILITY_REFS"),
        (lambda request: request.update(request_id="x" * 129), "INVALID_REQUEST_ID"),
    ],
)
def test_transport_rejects_malformed_envelopes(mutation: Any, error: str) -> None:
    request = valid_request()
    mutation(request)
    with pytest.raises(ValueError, match=error):
        validate_request(request)


def test_request_identity_is_not_part_of_algorithm_result() -> None:
    first = compute_request(valid_request())
    second_request = valid_request()
    second_request["request_id"] = "request-two"
    assert compute_request(second_request) == first
