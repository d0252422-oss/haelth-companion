"""Single-process JSONL worker for isolated non-production algorithm execution."""

from __future__ import annotations

import json
import sys
import time
from typing import Any

from health_companion_algorithms.engine import ALGORITHM_VERSION
from health_companion_algorithms.runtime import ALGORITHM_IDS, compute_request

MAX_REQUEST_BYTES = 1_048_576


def emit(document: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(document, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def error_class(error: Exception) -> str:
    message = str(error)
    known = (
        "INVALID_ENVELOPE",
        "UNEXPECTED_ENVELOPE_FIELD",
        "MISSING_OR_INVALID_REQUIRED_FIELD",
        "UNKNOWN_ALGORITHM_ID",
        "UNKNOWN_ALGORITHM_VERSION",
        "INVALID_CANONICAL_INPUTS",
        "INVALID_MISSING_INPUT_METADATA",
        "INVALID_TRACEABILITY_REFS",
        "INVALID_REQUEST_ID",
    )
    return message if message in known else "ALGORITHM_EXECUTION_ERROR"


def main() -> None:
    emit(
        {
            "type": "ready",
            "runtime": "PYTHON_PERSISTENT_CANDIDATE",
            "algorithm_version": ALGORITHM_VERSION,
            "algorithm_ids": sorted(ALGORITHM_IDS.values()),
        }
    )
    for line in sys.stdin.buffer:
        received_at = time.perf_counter_ns()
        if len(line) > MAX_REQUEST_BYTES:
            emit(
                {
                    "type": "response",
                    "request_id": "",
                    "ok": False,
                    "error_class": "REQUEST_TOO_LARGE",
                }
            )
            continue
        request_id = ""
        try:
            document = json.loads(line)
            if isinstance(document, dict) and isinstance(document.get("request_id"), str):
                request_id = document["request_id"][:128]
            algorithm_started_at = time.perf_counter_ns()
            result = compute_request(document)
            algorithm_finished_at = time.perf_counter_ns()
            response = {
                "type": "response",
                "request_id": request_id,
                "ok": True,
                "result": result,
                "timing": {
                    "request_deserialization_ms": round(
                        (algorithm_started_at - received_at) / 1_000_000, 6
                    ),
                    "algorithm_execution_ms": round(
                        (algorithm_finished_at - algorithm_started_at) / 1_000_000, 6
                    ),
                },
            }
        except json.JSONDecodeError:
            response = {
                "type": "response",
                "request_id": request_id,
                "ok": False,
                "error_class": "INVALID_JSON",
            }
        except Exception as error:
            response = {
                "type": "response",
                "request_id": request_id,
                "ok": False,
                "error_class": error_class(error),
            }
        timing_value = response.get("timing")
        timing: dict[str, float] = timing_value if isinstance(timing_value, dict) else {}
        response["timing"] = timing
        serialization_started_at = time.perf_counter_ns()
        timing["result_serialization_ms"] = 0.0
        json.dumps(response, separators=(",", ":"))
        timing["result_serialization_ms"] = round(
            (time.perf_counter_ns() - serialization_started_at) / 1_000_000, 6
        )
        emit(response)


if __name__ == "__main__":
    main()
