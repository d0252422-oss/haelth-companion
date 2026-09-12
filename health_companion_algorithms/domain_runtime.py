"""Compute-only bridge for the existing bounded JSONL worker. No database or network."""

from datetime import date, datetime, timedelta
from typing import Any

from .aggregation import aggregate_day, derived_metrics
from .domain_contracts import CanonicalRecord
from .domain_engines import DomainEngines


def compute_domain_request(request: dict[str, Any]) -> dict[str, Any]:
    if request.get("algorithm_version") != "health-score-v1.0":
        raise ValueError("UNKNOWN_ALGORITHM_VERSION")
    subject = request["subject_ref"]
    inputs = request["canonical_inputs"]
    day = date.fromisoformat(inputs["date"])
    records = [CanonicalRecord.model_validate(r) for r in inputs["records"]]
    if not subject or len(records) > 5000 or any(r.subject_ref != subject for r in records):
        raise ValueError("INVALID_CANONICAL_INPUTS")
    days = [
        aggregate_day(records, subject, day - timedelta(days=i), request["timezone"])
        for i in range(27, -1, -1)
    ]
    daily = days[-1]
    derived = derived_metrics(days, subject, day)
    outputs = DomainEngines().calculate(
        daily,
        derived,
        calculated_at=datetime.fromisoformat(inputs["calculated_at"]),
        reason="EXISTING_BETA_QUEUE_EXPERIMENTAL",
    )
    overall = outputs["overall"]
    return {
        "value": overall.score,
        "score": overall.score,
        "completeness": overall.data_completeness,
        "confidence": overall.confidence.value,
        "missing_inputs": list(overall.missing_inputs),
        "reason_codes": ["EXPERIMENTAL_UNVALIDATED"],
        "algorithm_version": "health-score-v1.0",
        "traceability": {"input_fingerprint": overall.input_fingerprint},
        "bundle": {
            "daily": daily.model_dump(mode="json"),
            "derived": derived,
            "outputs": {k: v.model_dump(mode="json") for k, v in outputs.items()},
        },
    }
