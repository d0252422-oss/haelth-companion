"""Run with python -m scripts.benchmark_domain_engines. Synthetic local measurements."""

from __future__ import annotations

import json
import platform
import time
from datetime import UTC, date, datetime, timedelta

from health_companion_algorithms.aggregation import aggregate_day, derived_metrics
from health_companion_algorithms.domain_contracts import CanonicalRecord
from health_companion_algorithms.domain_engines import DomainEngines
from health_companion_algorithms.engine_store import EngineStore


def benchmark(users: int) -> dict[str, object]:
    now = datetime(2026, 9, 12, 12, tzinfo=UTC)
    today = date(2026, 9, 12)
    store = EngineStore()
    began = time.perf_counter()
    all_records = []
    for user in range(users):
        subject = f"synthetic-{user}"
        records = [
            CanonicalRecord(
                subject_ref=subject,
                source="synthetic",
                record_id=str(i),
                domain="steps",
                revision=1,
                value=5000 + (i * 37) % 3000,
                unit="count",
                recorded_at=now - timedelta(days=i),
                updated_at=now,
            )
            for i in range(365)
        ]
        store.ingest(subject, records, timezone="Asia/Taipei", through=today, calculated_at=now)
        all_records.extend(records)
    ingestion_ms = (time.perf_counter() - began) * 1000
    initial_queries = store.query_count
    began = time.perf_counter()
    sample = [r for r in all_records if r.subject_ref == "synthetic-0"]
    daily = aggregate_day(sample, "synthetic-0", today, "Asia/Taipei")
    aggregation_ms = (time.perf_counter() - began) * 1000
    derived = derived_metrics([daily], "synthetic-0", today)
    began = time.perf_counter()
    DomainEngines().calculate(daily, derived, calculated_at=now, reason="BENCHMARK")
    score_ms = (time.perf_counter() - began) * 1000
    began = time.perf_counter()
    store.query_count = 0
    changed = sample[20].model_copy(update={"revision": 2, "value": 9000})
    result = store.ingest(
        "synthetic-0", [changed], timezone="Asia/Taipei", through=today, calculated_at=now
    )
    recompute_ms = (time.perf_counter() - began) * 1000
    recompute_queries = store.query_count
    store.query_count = 0
    store.domain_api(
        "synthetic-0", "overall", today - timedelta(days=27), today, "health-score-v1.0"
    )
    read_queries = store.query_count
    store.close()
    return {
        "users": users,
        "days_per_user": 365,
        "canonical_records": len(all_records),
        "initial_ingestion_ms": round(ingestion_ms, 2),
        "initial_select_queries": initial_queries,
        "aggregation_ms": round(aggregation_ms, 2),
        "score_bundle_ms": round(score_ms, 2),
        "one_late_update_recompute_ms": round(recompute_ms, 2),
        "recompute_dates": result["days_recomputed"],
        "recompute_select_queries": recompute_queries,
        "28d_api_select_queries": read_queries,
    }


if __name__ == "__main__":
    print(
        json.dumps(
            {
                "status": "LOCAL_TEST_RESULT",
                "fixture": "SYNTHETIC_NOT_PRODUCTION_SLA",
                "environment": {
                    "python": platform.python_version(),
                    "os": platform.system(),
                    "database": "SQLite in-memory",
                },
                "measurements": [benchmark(1), benchmark(10)],
            },
            indent=2,
        )
    )
