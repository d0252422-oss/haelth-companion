"""Synthetic fixtures only: no claim of real-world nutrition or medical accuracy."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from pydantic import ValidationError

from health_companion_algorithms.aggregation import (
    DEPENDENCIES,
    affected_dates,
    aggregate_day,
    day_bounds,
    dependency_order,
    derived_metrics,
    recompute_dates,
)
from health_companion_algorithms.domain_contracts import (
    CanonicalRecord,
    DomainOutput,
    Quality,
    ScoreStatus,
)
from health_companion_algorithms.domain_engines import DomainEngines, health_score_inputs
from health_companion_algorithms.engine import HealthScoreEngine
from health_companion_algorithms.engine_api import create_app
from health_companion_algorithms.engine_store import EngineStore
from health_companion_algorithms.nutrition import (
    Estimate,
    FixturePerception,
    FoodItem,
    FoodReference,
    Meal,
    Nutrients,
    NutritionCalculator,
    PerceivedFood,
)

DAY = date(2026, 9, 12)
NOW = datetime(2026, 9, 12, 12, tzinfo=UTC)


def record(domain: str = "steps", value: float = 7000, **changes: Any) -> CanonicalRecord:
    data = dict(
        subject_ref="alice",
        source="fixture",
        record_id="r1",
        domain=domain,
        value=value,
        unit="count",
        revision=1,
        recorded_at=NOW,
        updated_at=NOW,
        source_quality="MEDIUM",
    )
    data.update(changes)
    return CanonicalRecord.model_validate(data)


def calculator() -> NutritionCalculator:
    # Deliberately invented reference for arithmetic tests, not a real food database.
    return NutritionCalculator(
        (
            FoodReference(
                food_id="fixture-food",
                name="fixture grain",
                aliases=("fixture rice",),
                preparation_method="boiled",
                nutrients_per_100g=Nutrients(
                    calories=100, protein_g=10, carbs_g=12, fat_g=2, fiber_g=3, sodium_mg=20
                ),
                source="SYNTHETIC_TEST_FIXTURE",
                reference_version="fixture-v1",
                quality="MEDIUM",
                serving_weight_g=150,
            ),
        )
    )


def meal_item(**kwargs: Any) -> FoodItem:
    return FoodItem.model_validate(
        dict(item_id="item-1", raw_name="fixture rice", preparation_method="boiled", **kwargs)
    )


def outputs(records: list[CanonicalRecord]) -> dict[str, DomainOutput]:
    daily = aggregate_day(records, "alice", DAY, "Asia/Taipei", calculator())
    derived = derived_metrics([daily], "alice", DAY)
    return DomainEngines().calculate(daily, derived, calculated_at=NOW, reason="TEST")


@pytest.mark.parametrize("value", [-1, 1.01, float("nan"), float("inf")])
def test_completeness_contract_rejects_out_of_range(value: float) -> None:
    row = outputs([])["activity"].model_dump()
    row["data_completeness"] = value
    with pytest.raises(ValidationError):
        DomainOutput.model_validate(row)


def test_status_and_null_are_distinct_from_zero() -> None:
    assert outputs([])["activity"].score is None
    zero = outputs([record(value=0)])["activity"]
    assert zero.score == 0
    assert zero.score_status == ScoreStatus.PARTIAL_DATA
    row = zero.model_dump()
    row["score_status"] = "INSUFFICIENT_DATA"
    with pytest.raises(ValidationError):
        DomainOutput.model_validate(row)


@pytest.mark.parametrize("domain", ["nutrition", "sleep", "activity", "cardio", "body", "recovery"])
def test_each_domain_missing_input_has_no_fake_score(domain: str) -> None:
    value = outputs([])[domain]
    assert value.score is None
    assert value.confidence == Quality.UNKNOWN
    assert value.engine_version == f"{domain}-score-v1.0"


@pytest.mark.parametrize(
    "portion,unit,expected",
    [(100, "g", 100), (0.1, "kg", 100), (100000, "mg", 100), (1, "serving", 150), (0, "g", 0)],
)
def test_reference_portion_arithmetic(portion: float, unit: str, expected: float) -> None:
    item = meal_item(portion_value=portion, portion_unit=unit)
    assert calculator().item(item)["values"]["calories"] == expected


def test_unknown_missing_portion_and_cooking_are_not_guessed() -> None:
    assert calculator().item(meal_item())["values"]["calories"] is None
    wrong = meal_item(portion_value=100, portion_unit="g").model_copy(
        update={"preparation_method": "fried"}
    )
    assert calculator().item(wrong)["missing"] == ["food_reference"]
    unknown = wrong.model_copy(update={"raw_name": "unknown"})
    assert calculator().item(unknown)["values"]["protein_g"] is None


def test_portion_range_preserved_and_invalid_range_rejected() -> None:
    item = meal_item(
        estimation_range=Estimate(estimated_min=80, estimated_value=100, estimated_max=140)
    )
    assert calculator().item(item)["ranges"]["calories"] == {
        "estimated_min": 80,
        "estimated_value": 100,
        "estimated_max": 140,
    }
    with pytest.raises(ValidationError):
        Estimate(estimated_min=2, estimated_value=1, estimated_max=3)


def test_ai_nutrients_never_become_reference_authority() -> None:
    item = meal_item(
        source="PHOTO_AI",
        nutrients=Nutrients(calories=853, protein_g=200),
        portion_value=100,
        portion_unit="g",
    )
    assert calculator().item(item)["values"]["calories"] == 100
    manual = item.model_copy(update={"source": "MANUAL_CONFIRMED"})
    assert calculator().item(manual)["values"]["calories"] == 853
    with pytest.raises(ValidationError):
        PerceivedFood.model_validate({"candidate_food": "rice", "calories": 853})
    adapter = FixturePerception({b"fixture": (PerceivedFood(candidate_food="grain"),)})
    assert adapter.perceive(b"unknown") == ()
    assert adapter.status == "PREPARED_NOT_PRODUCTION_VALIDATED"


def test_mixed_meal_missing_food_does_not_publish_incomplete_total() -> None:
    known = meal_item(portion_value=100, portion_unit="g")
    unknown = FoodItem(item_id="other", raw_name="unknown")
    meal = Meal(
        meal_id="m", meal="lunch", meal_time=NOW, confirmed=True, food_items=(known, unknown)
    )
    result = calculator().daily((meal,), DAY, "Asia/Taipei")
    assert result["totals"]["calories"] is None
    assert result["known_subtotals"]["calories"] == 100
    with pytest.raises(ValidationError):
        Meal(meal_id="m", meal="lunch", meal_time=NOW, food_items=(known, known))


def test_distinct_identical_food_items_are_real_portions() -> None:
    one = meal_item(portion_value=100, portion_unit="g")
    two = one.model_copy(update={"item_id": "second"})
    meal = Meal(meal_id="m", meal="lunch", meal_time=NOW, confirmed=True, food_items=(one, two))
    assert calculator().daily((meal,), DAY, "Asia/Taipei")["totals"]["calories"] == 200


def test_nutrition_output_components_and_generic_confidence() -> None:
    meal = Meal(
        meal_id="m",
        meal="lunch",
        meal_time=NOW,
        confirmed=True,
        food_items=(meal_item(portion_value=100, portion_unit="g"),),
    )
    out = outputs([record("nutrition", payload=meal.model_dump(mode="json"))])["nutrition"]
    assert out.score is not None and out.confidence == Quality.LOW
    assert len(out.components) == 6
    assert out.metrics["calorie_target_gap"] == -1900
    assert out.metrics["macro_ratio"] is not None
    assert "FDA_LABEL_BASELINE_NOT_PERSONAL_REQUIREMENT" in out.explanations


@pytest.mark.parametrize("bad", [-5, float("nan"), float("inf")])
def test_invalid_nutrients_fail_without_coercion(bad: float) -> None:
    with pytest.raises(ValidationError):
        Nutrients(calories=bad)


def test_sleep_union_cross_midnight_and_timezone() -> None:
    a = record(
        "sleep",
        started_at=datetime(2026, 9, 11, 15, tzinfo=UTC),
        ended_at=datetime(2026, 9, 11, 23, tzinfo=UTC),
        unit="minute",
    )
    b = a.model_copy(
        update={"record_id": "second", "started_at": datetime(2026, 9, 11, 17, tzinfo=UTC)}
    )
    daily = aggregate_day([a, b], "alice", DAY, "Asia/Taipei")
    assert daily.metrics["sleep_minutes"] == 480
    assert "SLEEP_INTERVAL_UNION" in daily.flags
    assert affected_dates(a, "Asia/Taipei") == (DAY,)
    assert daily.source_quality != Quality.HIGH


@pytest.mark.parametrize("day,hours", [(date(2026, 3, 8), 23), (date(2026, 11, 1), 25)])
def test_dst_day_boundaries(day: date, hours: int) -> None:
    start, end = day_bounds(day, "America/New_York")
    assert (end - start).total_seconds() / 3600 == hours


def test_interval_steps_proration_conserves_amount_and_flags_estimate() -> None:
    a = record(
        value=100,
        started_at=datetime(2026, 9, 11, 15, tzinfo=UTC),
        ended_at=datetime(2026, 9, 11, 17, tzinfo=UTC),
    )
    days = affected_dates(a, "Asia/Taipei")
    aggs = [aggregate_day([a], "alice", d, "Asia/Taipei") for d in days]
    assert sum(d.metrics["steps"] for d in aggs) == 100
    assert all("ESTIMATED_INTERVAL_PRORATION:steps" in d.flags for d in aggs)


def test_replay_update_delete_and_user_isolation() -> None:
    a = record()
    assert aggregate_day([a, a], "alice", DAY, "UTC") == aggregate_day([a], "alice", DAY, "UTC")
    b = a.model_copy(update={"revision": 2, "value": 8000})
    assert aggregate_day([b, a], "alice", DAY, "UTC").metrics["steps"] == 8000
    tombstone = b.model_copy(update={"revision": 3, "deleted": True})
    assert aggregate_day([a, b, tombstone], "alice", DAY, "UTC").metrics["steps"] is None
    assert aggregate_day([a], "bob", DAY, "UTC").metrics["steps"] is None
    with pytest.raises(ValueError):
        aggregate_day([a, a.model_copy(update={"value": 1})], "alice", DAY, "UTC")


def test_outlier_flags_and_ambiguous_source_no_silent_rewrite() -> None:
    bad = record("heart_rate", 999, unit="bpm")
    daily = aggregate_day([bad], "alice", DAY, "UTC")
    assert daily.metrics["average_hr"] is None and "OUTLIER:average_hr" in daily.flags
    assert bad.value == 999
    daily = aggregate_day([record(), record(source="another")], "alice", DAY, "UTC")
    assert daily.metrics["steps"] is None and "AMBIGUOUS_SOURCE:steps" in daily.flags


def test_rolling_windows_missing_dates_and_personal_baseline() -> None:
    days = [
        aggregate_day(
            [record(value=float(i), recorded_at=NOW - timedelta(days=i))],
            "alice",
            DAY - timedelta(days=i),
            "UTC",
        )
        for i in range(28)
    ]
    metrics = derived_metrics(days, "alice", DAY)
    assert metrics["steps_7d_avg"] == 3
    assert metrics["steps_28d_avg"] == 13.5
    assert metrics["steps_baseline"] == 14
    assert derived_metrics(days[:3], "alice", DAY)["steps_baseline"] is None
    assert derived_metrics(days, "bob", DAY)["steps_7d_avg"] is None


def test_recompute_dependency_window_late_update_move_and_replay() -> None:
    old = record(recorded_at=NOW - timedelta(days=10))
    new = old.model_copy(update={"revision": 2, "recorded_at": NOW - timedelta(days=5)})
    dates = recompute_dates(old, new, "UTC", DAY)
    assert min(dates) == DAY - timedelta(days=10) and max(dates) == DAY
    assert len(dates) == 11
    assert recompute_dates(old, old, "UTC", DAY) == ()
    assert len(recompute_dates(None, record(), "UTC", DAY + timedelta(days=100))) == 28


def test_dag_no_overall_dependency_and_cycle_detection(monkeypatch: pytest.MonkeyPatch) -> None:
    order = dependency_order()
    assert order.index("sleep") < order.index("recovery") < order.index("overall")
    monkeypatch.setitem(DEPENDENCIES, "sleep", ("overall",))
    with pytest.raises(ValueError):
        dependency_order()


@pytest.mark.parametrize("value", [0, 1, 500, 7000, 10000, 100000])
def test_domain_invariants_and_overall_uses_frozen_formula(value: float) -> None:
    a = outputs([record(value=value)])
    b = outputs([record(value=value)])
    assert a == b
    for out in a.values():
        assert 0 <= out.data_completeness <= 1
        assert out.score is None or 0 <= out.score <= 100
    start, end = day_bounds(DAY, "Asia/Taipei")
    legacy = HealthScoreEngine().score_health(
        subject_ref="alice",
        period_start=start,
        period_end=end - timedelta(microseconds=1),
        timezone="Asia/Taipei",
        calculated_at=NOW,
        **health_score_inputs(a, "alice"),
    )
    assert a["overall"].score == legacy.score


def test_store_atomicity_replay_and_cross_user_api(monkeypatch: pytest.MonkeyPatch) -> None:
    store = EngineStore()
    try:
        result = store.ingest(
            "alice", [record(value=0)], timezone="UTC", through=DAY, calculated_at=NOW
        )
        assert result["days_recomputed"] == 1
        count = store.db.execute("SELECT count(*) FROM engine_history").fetchone()[0]
        assert (
            store.ingest(
                "alice", [record(value=0)], timezone="UTC", through=DAY, calculated_at=NOW
            )["days_recomputed"]
            == 0
        )
        assert store.db.execute("SELECT count(*) FROM engine_history").fetchone()[0] == count
        api = store.domain_api("alice", "activity", DAY, DAY, "activity-score-v1.0")
        assert api["results"][0]["score"] == 0
        assert store.domain_api("bob", "activity", DAY, DAY, "activity-score-v1.0")["results"] == []
        with pytest.raises(PermissionError):
            store.domain_api(None, "activity", DAY, DAY, "activity-score-v1.0")

        def fail(*args: Any, **kwargs: Any) -> Any:
            raise RuntimeError("synthetic failure")

        monkeypatch.setattr(store.engines, "calculate", fail)
        with pytest.raises(RuntimeError):
            store.ingest(
                "alice",
                [record(revision=2, value=9000)],
                timezone="UTC",
                through=DAY,
                calculated_at=NOW,
            )
        assert store.db.execute("SELECT revision FROM engine_records").fetchone()[0] == 1
        assert store.db.execute("SELECT count(*) FROM engine_history").fetchone()[0] == count
    finally:
        store.close()


def test_store_late_update_tombstone_version_history_and_query_bounds() -> None:
    store = EngineStore()
    try:
        initial = [record(record_id=str(i), recorded_at=NOW - timedelta(days=i)) for i in range(35)]
        store.ingest("alice", initial, timezone="UTC", through=DAY, calculated_at=NOW)
        updated = initial[30].model_copy(update={"revision": 2, "value": 1})
        result = store.ingest("alice", [updated], timezone="UTC", through=DAY, calculated_at=NOW)
        assert result["days_recomputed"] == 28
        tombstone = initial[0].model_copy(update={"revision": 2, "deleted": True})
        store.ingest("alice", [tombstone], timezone="UTC", through=DAY, calculated_at=NOW)
        assert (
            store.domain_api("alice", "activity", DAY, DAY, "activity-score-v1.0")["results"][0][
                "score"
            ]
            is None
        )
        assert (
            store.db.execute(
                "SELECT count(*) FROM engine_history WHERE day=? AND kind='activity'", (str(DAY),)
            ).fetchone()[0]
            >= 2
        )
        with pytest.raises(ValueError):
            store.domain_api(
                "alice", "activity", DAY - timedelta(days=28), DAY, "activity-score-v1.0"
            )
        plan = store.db.execute(
            "EXPLAIN QUERY PLAN SELECT * FROM engine_record_dates WHERE subject=? AND day=?",
            ("alice", str(DAY)),
        ).fetchall()
        assert any("INDEX" in row[3] for row in plan)
    finally:
        store.close()


def test_wsgi_api_uses_host_identity_and_rejects_client_user_selection() -> None:
    import json

    store = EngineStore()
    try:
        store.ingest("alice", [record()], timezone="UTC", through=DAY, calculated_at=NOW)
        app = create_app(
            store,
            lambda env: {"synthetic-a": "alice", "synthetic-b": "bob"}.get(
                env.get("HTTP_AUTHORIZATION")
            ),
        )

        def request(token: str, query: str, method: str = "GET") -> tuple[str, Any]:
            statuses = []
            body = b"".join(
                app(
                    {
                        "REQUEST_METHOD": method,
                        "PATH_INFO": "/v1/engine/domain-scores/activity",
                        "QUERY_STRING": query,
                        "HTTP_AUTHORIZATION": token,
                    },
                    lambda status, headers: statuses.append(status),
                )
            )
            return statuses[0], json.loads(body)

        query = "start=2026-09-12&end=2026-09-12&version=activity-score-v1.0"
        assert request("synthetic-a", query)[1]["results"][0]["score"] == 100
        assert request("synthetic-b", query)[1]["results"] == []
        assert request("", query)[0].startswith("401")
        assert request("synthetic-a", query + "&user_id=bob")[0].startswith("400")
        assert request("synthetic-a", query, "POST")[0].startswith("405")
    finally:
        store.close()


def test_cardio_body_recovery_normal_partial_and_no_fabricated_hrv() -> None:
    days = []
    for i in range(8):
        when = NOW - timedelta(days=i)
        rows = [
            record("resting_heart_rate", 60, unit="bpm", recorded_at=when),
            record("weight", 70, unit="kg", recorded_at=when),
            record(
                "sleep",
                unit="minute",
                recorded_at=when,
                started_at=when - timedelta(hours=8),
                ended_at=when,
            ),
        ]
        days.append(aggregate_day(rows, "alice", DAY - timedelta(days=i), "UTC"))
    metrics = derived_metrics(days, "alice", DAY)
    out = DomainEngines().calculate(
        days[0], metrics, calculated_at=NOW, reason="TEST", targets={"height_m": 1.75, "weight": 70}
    )
    assert out["cardio"].score == 100
    assert out["body"].score == 100
    assert out["body"].metrics["BMI"] == 22.9
    assert out["recovery"].score is not None
    assert out["cardio"].components["hrv"] is None
    assert out["cardio"].metrics["daily"]["muscle_mass"] is None
    stale = DomainEngines().calculate(
        days[0], metrics, calculated_at=NOW, reason="TEST", stale=True
    )
    assert all(v.score_status == ScoreStatus.STALE for v in stale.values())
    assert stale["overall"].score is None


def test_unit_mismatch_negative_data_and_reference_changes_are_traceable() -> None:
    negative = aggregate_day([record(value=-1)], "alice", DAY, "UTC")
    assert negative.metrics["steps"] is None and "INVALID:steps" in negative.flags
    mismatch = aggregate_day([record(unit="kcal")], "alice", DAY, "UTC")
    assert mismatch.metrics["steps"] is None
    one = calculator().item(meal_item(portion_value=100, portion_unit="g"))
    two = calculator().item(meal_item(portion_value=200, portion_unit="g"))
    assert two["values"]["calories"] == one["values"]["calories"] * 2


def test_same_input_recompute_preserves_history_and_atomic_failure_after_writes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = EngineStore()
    try:
        store.ingest("alice", [record()], timezone="UTC", through=DAY, calculated_at=NOW)
        count = store.db.execute("SELECT count(*) FROM engine_history").fetchone()[0]
        store.recompute("alice", [DAY], timezone="UTC", calculated_at=NOW + timedelta(days=1))
        assert store.db.execute("SELECT count(*) FROM engine_history").fetchone()[0] == count
        old_save = store._save

        def fail_after_aggregate(*args: Any, **kwargs: Any) -> None:
            old_save(*args, **kwargs)
            if args[2] == "derived":
                raise RuntimeError("failed mid-transaction")

        monkeypatch.setattr(store, "_save", fail_after_aggregate)
        with pytest.raises(RuntimeError):
            store.ingest(
                "alice",
                [record(value=1, revision=2)],
                timezone="UTC",
                through=DAY,
                calculated_at=NOW,
            )
        assert store.db.execute("SELECT count(*) FROM engine_history").fetchone()[0] == count
        assert (
            store.domain_api("alice", "activity", DAY, DAY, "activity-score-v1.0")["results"][0][
                "score"
            ]
            == 100
        )
    finally:
        store.close()
