"""Strict contracts for the opt-in development engine track (not clinical outputs)."""

from __future__ import annotations

import hashlib
import json
import math
from datetime import date, datetime
from enum import StrEnum
from typing import Any
from zoneinfo import ZoneInfo

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator


class ScoreStatus(StrEnum):
    VALID = "VALID"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"
    PARTIAL_DATA = "PARTIAL_DATA"
    STALE = "STALE"
    ERROR = "ERROR"


class Quality(StrEnum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    UNKNOWN = "UNKNOWN"


def fingerprint(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)


class DomainOutput(Contract):
    subject_ref: str = Field(min_length=1)
    domain: str
    calculation_date: date
    engine_version: str
    score: float | None = Field(default=None, ge=0, le=100)
    score_status: ScoreStatus
    confidence: Quality
    data_completeness: float = Field(ge=0, le=1)
    missing_inputs: tuple[str, ...] = ()
    source_quality: Quality = Quality.UNKNOWN
    metrics: dict[str, Any] = Field(default_factory=dict)
    components: dict[str, float | None] = Field(default_factory=dict)
    explanations: tuple[str, ...] = ()
    recompute_reason: str
    calculated_at: AwareDatetime
    input_fingerprint: str

    @model_validator(mode="after")
    def consistent(self) -> DomainOutput:
        if self.score_status in (ScoreStatus.INSUFFICIENT_DATA, ScoreStatus.ERROR):
            if self.score is not None:
                raise ValueError("missing/error score must be null")
        if self.score_status in (ScoreStatus.VALID, ScoreStatus.PARTIAL_DATA):
            if self.score is None:
                raise ValueError("valid/partial score must exist")
        for value in self.components.values():
            if value is not None and (not math.isfinite(value) or not 0 <= value <= 100):
                raise ValueError("invalid score component")
        fingerprint(self.metrics)  # Reject nested NaN/Infinity and non-JSON values.
        return self


class CanonicalRecord(Contract):
    subject_ref: str = Field(min_length=1)
    source: str = Field(min_length=1)
    record_id: str = Field(min_length=1)
    revision: int = Field(ge=1)
    domain: str
    recorded_at: AwareDatetime
    updated_at: AwareDatetime
    started_at: AwareDatetime | None = None
    ended_at: AwareDatetime | None = None
    value: float | None = None
    unit: str | None = None
    deleted: bool = False
    source_quality: Quality = Quality.UNKNOWN
    payload: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def interval(self) -> CanonicalRecord:
        if (self.started_at is None) != (self.ended_at is None):
            raise ValueError("interval requires both endpoints")
        if self.started_at is not None and self.ended_at is not None:
            if self.ended_at <= self.started_at:
                raise ValueError("interval must have positive duration")
        fingerprint(self.payload)
        return self

    @property
    def identity(self) -> tuple[str, str, str, str]:
        return self.subject_ref, self.source, self.domain, self.record_id


class DailyAggregate(Contract):
    subject_ref: str
    calculation_date: date
    timezone: str
    engine_version: str = "daily-aggregation-v1.0"
    metrics: dict[str, Any]
    flags: tuple[str, ...] = ()
    evidence_ids: tuple[str, ...] = ()
    source_quality: Quality = Quality.UNKNOWN
    input_fingerprint: str

    @model_validator(mode="after")
    def valid_zone(self) -> DailyAggregate:
        ZoneInfo(self.timezone)
        fingerprint(self.metrics)
        return self


def instant(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValueError("timezone-aware timestamp required")
    return value.isoformat()
