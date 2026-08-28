"""Versioned, traceable algorithm contracts."""

from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Confidence(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class EvidenceState(StrEnum):
    ACTIVE = "ACTIVE"
    STALE = "STALE"
    DELETED = "DELETED"


class EvidenceRef(BaseModel):
    """A non-sensitive reference to one canonical input record."""

    model_config = ConfigDict(frozen=True)

    record_id: str = Field(min_length=1)
    source_updated_at: datetime
    state: EvidenceState = EvidenceState.ACTIVE


class AlgorithmResult(BaseModel):
    """Shared result contract; value, score, completeness and confidence stay distinct."""

    model_config = ConfigDict(frozen=True)

    algorithm_id: str
    algorithm_version: str
    subject_ref: str
    period_start: datetime
    period_end: datetime
    score: float | None = Field(default=None, ge=0, le=100)
    completeness: float = Field(ge=0, le=1)
    confidence: Confidence
    components: dict[str, float | None]
    missing_inputs: tuple[str, ...]
    input_record_ids: tuple[str, ...]
    input_fingerprint: str
    calculated_at: datetime
    reason_codes: tuple[str, ...]
    status: str
    device_quality: str = "UNKNOWN"
    timezone: str
    local_date: date

    @model_validator(mode="after")
    def validate_period(self) -> AlgorithmResult:
        if self.period_end < self.period_start:
            raise ValueError("period_end must not precede period_start")
        return self
