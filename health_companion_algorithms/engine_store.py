"""Transactional local/test storage with indexed, bounded incremental recomputation.

The existing Supabase production queue is not replaced or activated by this module.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date, datetime, timedelta
from typing import Any

from .aggregation import affected_dates, aggregate_day, derived_metrics, recompute_dates
from .domain_contracts import CanonicalRecord, DailyAggregate, DomainOutput, fingerprint
from .domain_engines import DomainEngines
from .nutrition import NutritionCalculator

SCHEMA = """
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS engine_subject_context (
 subject TEXT PRIMARY KEY, timezone TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS engine_records (
 subject TEXT NOT NULL, source TEXT NOT NULL, domain TEXT NOT NULL, record_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), data TEXT NOT NULL,
 PRIMARY KEY(subject,source,domain,record_id));
CREATE TABLE IF NOT EXISTS engine_record_dates (
 subject TEXT NOT NULL, source TEXT NOT NULL, domain TEXT NOT NULL, record_id TEXT NOT NULL,
 day TEXT NOT NULL, PRIMARY KEY(subject,source,domain,record_id,day),
 FOREIGN KEY(subject,source,domain,record_id)
 REFERENCES engine_records(subject,source,domain,record_id));
CREATE INDEX IF NOT EXISTS engine_dates_lookup ON engine_record_dates(subject,day);
CREATE TABLE IF NOT EXISTS engine_history (
 subject TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, version TEXT NOT NULL,
 fingerprint TEXT NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(subject,day,kind,version,fingerprint));
CREATE TABLE IF NOT EXISTS engine_heads (
 subject TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, version TEXT NOT NULL,
 fingerprint TEXT NOT NULL, PRIMARY KEY(subject,day,kind,version),
 FOREIGN KEY(subject,day,kind,version,fingerprint)
 REFERENCES engine_history(subject,day,kind,version,fingerprint));
"""


class EngineStore:
    def __init__(
        self, path: str = ":memory:", *, nutrition: NutritionCalculator | None = None
    ) -> None:
        self.db = sqlite3.connect(path)
        self.db.executescript(SCHEMA)
        self.nutrition = nutrition or NutritionCalculator()
        self.engines = DomainEngines()
        self.query_count = 0
        self.db.set_trace_callback(self._count)

    def _count(self, sql: str) -> None:
        if sql.lstrip().upper().startswith("SELECT"):
            self.query_count += 1

    def close(self) -> None:
        self.db.close()

    def ingest(
        self,
        subject: str,
        records: list[CanonicalRecord],
        *,
        timezone: str,
        through: date,
        calculated_at: datetime,
        targets: dict[str, float] | None = None,
    ) -> dict[str, Any]:
        if not subject or any(r.subject_ref != subject for r in records):
            raise ValueError("authenticated subject mismatch")
        if len(records) > 5000:
            raise ValueError("bounded ingestion accepts at most 5000 records")
        # Sort revisions: a batch containing updates is order-independent.
        ordered = sorted(records, key=lambda r: (r.identity, r.revision))
        changed: set[date] = set()
        with self.db:
            existing_zone = self.db.execute(
                "SELECT timezone FROM engine_subject_context WHERE subject=?", (subject,)
            ).fetchone()
            if existing_zone and existing_zone[0] != timezone:
                raise ValueError("timezone change requires explicit projection migration")
            self.db.execute(
                "INSERT INTO engine_subject_context VALUES(?,?) ON CONFLICT DO NOTHING",
                (subject, timezone),
            )
            for record in ordered:
                previous = self.db.execute(
                    "SELECT data FROM engine_records WHERE subject=? AND source=? "
                    "AND domain=? AND record_id=?",
                    record.identity,
                ).fetchone()
                old = CanonicalRecord.model_validate_json(previous[0]) if previous else None
                if old and record.revision < old.revision:
                    continue
                if old and record.revision == old.revision:
                    if old != record:
                        raise ValueError("conflicting same-revision record")
                    continue
                dirty = recompute_dates(old, record, timezone, through)
                changed.update(dirty)
                self.db.execute(
                    "INSERT INTO engine_records VALUES(?,?,?,?,?,?) "
                    "ON CONFLICT(subject,source,domain,record_id) DO UPDATE SET "
                    "revision=excluded.revision,data=excluded.data",
                    (*record.identity, record.revision, record.model_dump_json()),
                )
                self.db.execute(
                    "DELETE FROM engine_record_dates WHERE subject=? AND source=? "
                    "AND domain=? AND record_id=?",
                    record.identity,
                )
                if not record.deleted:
                    self.db.executemany(
                        "INSERT INTO engine_record_dates VALUES(?,?,?,?,?)",
                        [(*record.identity, str(day)) for day in affected_dates(record, timezone)],
                    )
            self._recompute(subject, sorted(changed), timezone, calculated_at, targets)
        return {
            "status": "RECOMPUTED" if changed else "REPLAY_OR_STALE",
            "affected_dates": [str(day) for day in sorted(changed)],
            "days_recomputed": len(changed),
        }

    def recompute(
        self,
        subject: str,
        days: list[date],
        *,
        timezone: str,
        calculated_at: datetime,
        targets: dict[str, float] | None = None,
    ) -> None:
        if not subject:
            raise ValueError("authenticated subject required")
        if len(set(days)) > 366:
            raise ValueError("explicit recompute must be chunked to <=366 dates")
        with self.db:
            existing_zone = self.db.execute(
                "SELECT timezone FROM engine_subject_context WHERE subject=?", (subject,)
            ).fetchone()
            if existing_zone and existing_zone[0] != timezone:
                raise ValueError("timezone change requires explicit projection migration")
            self.db.execute(
                "INSERT INTO engine_subject_context VALUES(?,?) ON CONFLICT DO NOTHING",
                (subject, timezone),
            )
            self._recompute(subject, sorted(set(days)), timezone, calculated_at, targets)

    def _recompute(
        self,
        subject: str,
        days: list[date],
        timezone: str,
        calculated_at: datetime,
        targets: dict[str, float] | None,
    ) -> None:
        if not days:
            return
        history = self.read(
            subject,
            days[0] - timedelta(days=27),
            days[-1],
            "aggregate",
            "daily-aggregation-v1.0",
            max_days=425,
        )
        aggregates = {
            date.fromisoformat(row["calculation_date"]): DailyAggregate.model_validate(row)
            for row in history
        }
        for day in days:
            rows = self.db.execute(
                "SELECT r.data FROM engine_record_dates d JOIN engine_records r "
                "USING(subject,source,domain,record_id) WHERE d.subject=? AND d.day=?",
                (subject, str(day)),
            ).fetchall()
            daily = aggregate_day(
                [CanonicalRecord.model_validate_json(r[0]) for r in rows],
                subject,
                day,
                timezone,
                self.nutrition,
            )
            aggregates[day] = daily
            derived = derived_metrics(list(aggregates.values()), subject, day)
            outputs = self.engines.calculate(
                daily,
                derived,
                calculated_at=calculated_at,
                reason="CANONICAL_CHANGE_OR_EXPLICIT_RECOMPUTE",
                targets=targets,
            )
            self._save(
                subject,
                day,
                "aggregate",
                daily.engine_version,
                daily.input_fingerprint,
                daily.model_dump(mode="json"),
            )
            self._save(
                subject, day, "derived", derived["engine_version"], fingerprint(derived), derived
            )
            for domain, output in outputs.items():
                self._save(
                    subject,
                    day,
                    domain,
                    output.engine_version,
                    output.input_fingerprint,
                    output.model_dump(mode="json"),
                )

    def _save(
        self, subject: str, day: date, kind: str, version: str, digest: str, payload: dict[str, Any]
    ) -> None:
        self.db.execute(
            "INSERT INTO engine_history VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING",
            (
                subject,
                str(day),
                kind,
                version,
                digest,
                json.dumps(payload, sort_keys=True, allow_nan=False),
            ),
        )
        self.db.execute(
            "INSERT INTO engine_heads VALUES(?,?,?,?,?) "
            "ON CONFLICT(subject,day,kind,version) DO UPDATE SET "
            "fingerprint=excluded.fingerprint",
            (subject, str(day), kind, version, digest),
        )

    def read(
        self, subject: str, start: date, end: date, kind: str, version: str, *, max_days: int = 28
    ) -> list[dict[str, Any]]:
        if not subject or end < start or (end - start).days >= max_days:
            raise ValueError("invalid or unbounded read scope")
        rows = self.db.execute(
            "SELECT h.data FROM engine_heads c JOIN engine_history h "
            "USING(subject,day,kind,version,fingerprint) "
            "WHERE c.subject=? AND c.day>=? AND c.day<=? AND c.kind=? AND c.version=? "
            "ORDER BY c.day",
            (subject, str(start), str(end), kind, version),
        ).fetchall()
        return [json.loads(row[0]) for row in rows]

    def domain_api(
        self, authenticated_subject: str | None, domain: str, start: date, end: date, version: str
    ) -> dict[str, Any]:
        """Host must supply its verified subject, never a body/query-selected user ID."""
        if not authenticated_subject:
            raise PermissionError("authentication required")
        rows = self.read(authenticated_subject, start, end, domain, version)
        result = []
        for row in rows:
            output = DomainOutput.model_validate(row)
            result.append(
                {
                    "date": str(output.calculation_date),
                    "score": output.score,
                    "status": output.score_status.value,
                    "confidence": output.confidence.value,
                    "completeness": output.data_completeness,
                    "version": output.engine_version,
                    "components": output.components,
                    "missing_inputs": list(output.missing_inputs),
                    "updated_at": output.calculated_at.isoformat(),
                }
            )
        return {"contract_version": "domain-score-api-v1.0", "domain": domain, "results": result}
