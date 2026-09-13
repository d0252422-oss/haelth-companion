"""Synthetic differential inputs; derive expectations by executing unchanged reference."""

import json
import sys
from copy import deepcopy
from datetime import date, timedelta
from pathlib import Path

from health_companion_algorithms.domain_runtime import compute_domain_request

DAY = "2026-09-12"


def record(domain, value=None, unit=None, **extra):
    return {
        "subject_ref": "synthetic-parity",
        "source": "synthetic",
        "record_id": domain,
        "domain": domain,
        "revision": 1,
        "recorded_at": DAY + "T10:00:00+08:00",
        "updated_at": DAY + "T12:00:00Z",
        "value": value,
        "unit": unit,
        "source_quality": "UNKNOWN",
        **extra,
    }


def meal(known=True, zero=False, confirmed=True):
    return record(
        "nutrition",
        payload={
            "meal_id": "meal-1",
            "meal": "午餐",
            "meal_time": DAY + "T12:00:00+08:00",
            "confirmed": confirmed,
            "food_items": [
                {
                    "item_id": "item-1",
                    "raw_name": "SYNTHETIC_LABEL_NOT_REAL_FOOD",
                    "source": "MANUAL_CONFIRMED" if known else "MODEL",
                    "nutrients": {
                        "calories": 0 if zero else 300,
                        "protein_g": 0 if zero else 15,
                        "carbs_g": 0 if zero else 30,
                        "fat_g": 0 if zero else 7.5,
                    },
                }
            ],
        },
    )


def main():
    fixtures = []

    def add(name, records, day=DAY, zone="Asia/Taipei", invalid=False):
        request = {
            "algorithm_id": "multi-domain-bundle",
            "algorithm_version": "health-score-v1.0",
            "domain": "multi_domain",
            "subject_ref": "synthetic-parity",
            "timezone": zone,
            "period_start": day + "T00:00:00Z",
            "period_end": day + "T23:59:59Z",
            "canonical_inputs": {
                "date": day,
                "records": records,
                "calculated_at": day + "T12:00:00Z",
            },
        }
        try:
            result = compute_domain_request(request)
            assert not invalid, name
            fixtures.append({"id": name, "request": request, "expected": result})
        except (ValueError, TypeError) as error:
            if not invalid:
                raise
            fixtures.append(
                {"id": name, "request": request, "expected_error": type(error).__name__}
            )

    add("empty", [])
    for domain, unit, value in [
        ("steps", "count", 7000),
        ("energy", "kcal", 350.5555),
        ("weight", "kg", 80.005),
        ("resting_heart_rate", "bpm", 61),
        ("hrv", "ms", 43),
        ("body_fat", "percent", 20),
        ("fat_mass", "kg", 16),
        ("workout", "minute", 45),
        ("heart_rate", "bpm", 75),
    ]:
        add("single-" + domain, [record(domain, value, unit)])
        add("zero-" + domain, [record(domain, 0, unit)])
        add("unit-mismatch-" + domain, [record(domain, value, "incorrect")])
    for name, r in [
        ("confirmed-label", meal()),
        ("label-zero", meal(zero=True)),
        ("unknown-food", meal(known=False)),
        ("unconfirmed", meal(confirmed=False)),
    ]:
        add(name, [r])
    for count in [6, 7, 8, 28]:
        rows = []
        for i in range(count):
            d = str(date.fromisoformat(DAY) - timedelta(days=i))
            for domain, unit, value in [
                ("steps", "count", 7000 + i * 100),
                ("energy", "kcal", 350 + i),
                ("weight", "kg", 80 + i * 0.1),
                ("resting_heart_rate", "bpm", 60 + i % 3),
                ("hrv", "ms", 40 + i),
                ("fat_mass", "kg", 16 + i * 0.1),
            ]:
                rows.append(
                    record(
                        domain,
                        value,
                        unit,
                        record_id=f"{domain}-{i}",
                        recorded_at=d + "T10:00:00+08:00",
                    )
                )
            rows.append(
                record(
                    "sleep",
                    record_id=f"sleep-{i}",
                    recorded_at=d + "T08:00:00+08:00",
                    started_at=str(date.fromisoformat(d) - timedelta(days=1)) + "T23:30:00+08:00",
                    ended_at=d + "T07:30:00+08:00",
                )
            )
        add(f"all-domains-baseline-{count}", rows + [meal()])
    r = record("steps", 7000, "count")
    add("replay", [r, deepcopy(r)])
    add("revision", [r, {**r, "revision": 2, "value": 9000}])
    add("delete", [r, {**r, "revision": 2, "deleted": True}])
    add("ambiguous-source", [r, {**r, "source": "second-source"}])
    add("conflicting-revision", [r, {**r, "value": 9000}], invalid=True)
    add("cross-subject", [{**r, "subject_ref": "other"}], invalid=True)
    add(
        "invalid-interval",
        [{**r, "started_at": DAY + "T11:00:00Z", "ended_at": DAY + "T10:00:00Z"}],
        invalid=True,
    )
    for d, zone, start, end in [
        (
            "2026-03-08",
            "America/New_York",
            "2026-03-08T01:30:00-05:00",
            "2026-03-08T03:30:00-04:00",
        ),
        (
            "2026-11-01",
            "America/New_York",
            "2026-11-01T01:30:00-04:00",
            "2026-11-01T01:30:00-05:00",
        ),
        (DAY, "Asia/Taipei", "2026-09-11T23:30:00+08:00", DAY + "T00:30:00+08:00"),
    ]:
        add(
            "boundary-" + d,
            [
                record("sleep", started_at=start, ended_at=end),
                record("steps", 120, "count", started_at=start, ended_at=end),
            ],
            d,
            zone,
        )
    add(
        "overlap-sleep",
        [
            record("sleep", started_at=DAY + "T00:00:00+08:00", ended_at=DAY + "T08:00:00+08:00"),
            record(
                "sleep",
                record_id="sleep-2",
                started_at=DAY + "T07:00:00+08:00",
                ended_at=DAY + "T09:00:00+08:00",
            ),
        ],
    )
    # Independent review regressions: expected values always from the unchanged reference.
    add(
        "review-time-normalized-replay",
        [{**r, "recorded_at": DAY + "T10:00:00Z"}, {**r, "recorded_at": DAY + "T10:00:00+00:00"}],
    )
    add(
        "review-microsecond-interval",
        [{**r, "started_at": DAY + "T10:00:00.000100Z", "ended_at": DAY + "T10:00:00.000900Z"}],
    )
    add("review-invalid-calendar", [{**r, "recorded_at": "2026-02-30T10:00:00Z"}], invalid=True)
    add("review-deleted-false-coercion", [{**r, "deleted": "false"}])
    add("review-source-object", [{**r, "source": {}}], invalid=True)
    add("review-payload-null", [{**r, "payload": None}], invalid=True)
    malformed_meal = meal()
    del malformed_meal["payload"]["food_items"][0]["raw_name"]
    add("review-meal-missing-raw-name", [malformed_meal], invalid=True)
    add(
        "review-identity-delimiter",
        [
            {**r, "source": "a\u001fsteps", "record_id": "d", "value": 100},
            {**r, "source": "a", "record_id": "steps\u001fd", "revision": 2, "value": 200},
        ],
    )
    add(
        "review-exact-mean-rounding",
        [
            record("weight", v, "kg", record_id=f"mean-{i}")
            for i, v in enumerate([69.3024, 68.4976, 87.7085])
        ],
    )
    add(
        "review-midnight-dst-gap",
        [
            record(
                "steps",
                300,
                "count",
                recorded_at="2026-09-06T02:00:00-03:00",
                started_at="2026-09-05T22:00:00-04:00",
                ended_at="2026-09-06T02:00:00-03:00",
            )
        ],
        "2026-09-06",
        "America/Santiago",
    )
    # Explicit new output preserves earlier reference/evidence instead of overwriting it.
    for fat in [None, 0, 20]:
        manual = []
        for i in range(8):
            observed = (date.fromisoformat(DAY) - timedelta(days=i)).isoformat()
            values = [("weight", "kg", 80)]
            if fat is not None:
                values.extend([("body_fat", "percent", fat), ("fat_mass", "kg", 80 * fat / 100)])
            for domain, unit, value in values:
                manual.append(record(
                    domain, value, unit, source="MANUAL_WEB", record_id=observed+":"+domain,
                    recorded_at=observed+"T00:00:00+08:00",
                ))
        add("manual-body-8-days-fat-"+str(fat), manual)
    path = (
        Path(sys.argv[1]) if len(sys.argv) > 1
        else Path(".engine-artifacts/blocker-closure/portable-fixtures.json")
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(fixtures, ensure_ascii=False), encoding="utf-8")
    print(
        json.dumps({"fixtures": len(fixtures), "reference": "unchanged Python", "path": str(path)})
    )


if __name__ == "__main__":
    main()
