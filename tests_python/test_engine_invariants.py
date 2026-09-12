"""Generated and golden fixture assertions; strictly non-clinical validation."""

import json
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from health_companion_algorithms.aggregation import aggregate_day, derived_metrics
from health_companion_algorithms.domain_engines import DomainEngines
from health_companion_algorithms.engine_store import EngineStore
from tests_python.test_domain_engines import DAY, NOW, outputs, record

GOLDEN = json.loads(
    (Path(__file__).parents[1] / "fixtures/algorithm-golden/domain-engine-v1.0.json").read_text(
        encoding="utf-8"
    )
)["cases"]


@pytest.mark.parametrize("case", GOLDEN, ids=lambda item: item["id"])
def test_domain_golden(case):
    values = [] if case["steps"] is None else [record(value=case["steps"])]
    result = outputs(values)[case["domain"]]
    assert result.score == case["score"]
    assert result.data_completeness == case["completeness"]


@settings(max_examples=60, deadline=None)
@given(st.lists(st.integers(min_value=0, max_value=50000), min_size=0, max_size=12))
def test_order_replay_scope_and_score_bounds(values):
    records = [record(record_id=str(i), value=v) for i, v in enumerate(values)]
    one = aggregate_day(records, "alice", DAY, "UTC")
    two = aggregate_day(list(reversed(records)) + records, "alice", DAY, "UTC")
    assert one == two
    assert aggregate_day(records, "bob", DAY, "UTC").metrics["steps"] is None
    result = DomainEngines().calculate(
        one, derived_metrics([one], "alice", DAY), calculated_at=NOW, reason="PROPERTY"
    )
    for output in result.values():
        assert 0 <= output.data_completeness <= 1
        assert output.score is None or 0 <= output.score <= 100


def test_timezone_change_is_explicit_not_silent_mixed_projections():
    store = EngineStore()
    try:
        store.ingest("alice", [record()], timezone="UTC", through=DAY, calculated_at=NOW)
        with pytest.raises(ValueError, match="timezone change"):
            store.ingest(
                "alice",
                [record(revision=2)],
                timezone="Asia/Taipei",
                through=DAY,
                calculated_at=NOW,
            )
        assert store.db.execute("SELECT revision FROM engine_records").fetchone()[0] == 1
    finally:
        store.close()


def test_explicit_recompute_binds_timezone_before_first_ingestion():
    store = EngineStore()
    try:
        store.recompute("alice", [DAY], timezone="UTC", calculated_at=NOW)
        with pytest.raises(ValueError, match="timezone change"):
            store.ingest(
                "alice", [record()], timezone="Asia/Taipei", through=DAY, calculated_at=NOW
            )
        with pytest.raises(ValueError, match="subject"):
            store.recompute("", [DAY], timezone="UTC", calculated_at=NOW)
        assert store.db.execute("SELECT count(*) FROM engine_records").fetchone()[0] == 0
    finally:
        store.close()
