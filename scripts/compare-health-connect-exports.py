"""Compare two sanitized outputs from inspect-health-connect-export.py."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def load(path: str) -> dict[str, Any]:
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("inspection result must be an object")
    return value


def compare(first: dict[str, Any], second: dict[str, Any]) -> dict[str, object]:
    first_entries = [
        (item.get("name"), item.get("size"), item.get("format"))
        for item in first.get("archive_entries", [])
    ]
    second_entries = [
        (item.get("name"), item.get("size"), item.get("format"))
        for item in second.get("archive_entries", [])
    ]
    return {
        "same_file_id": "UNKNOWN",
        "same_filename": first.get("file_name") == second.get("file_name"),
        "hash_changed": first.get("sha256") != second.get("sha256"),
        "size_changed": first.get("file_size") != second.get("file_size"),
        "entries_changed": first_entries != second_entries,
        "record_count_changed": "UNKNOWN",
        "possible_snapshot_or_delta": "UNKNOWN",
    }


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: compare-health-connect-exports.py <export1.json> <export2.json>")
    print(json.dumps(compare(load(sys.argv[1]), load(sys.argv[2])), sort_keys=True))
