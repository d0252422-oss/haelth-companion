"""Offline, read-only structural inspector for a user-provided Health Connect ZIP."""

from __future__ import annotations

import hashlib
import json
import sys
import zipfile
from pathlib import Path

MAX_ENTRY_SAMPLE = 4096


def classify(sample: bytes) -> str:
    if not sample:
        return "empty"
    if sample.startswith(b"PK\x03\x04"):
        return "zip"
    try:
        text = sample.decode("utf-8")
    except UnicodeDecodeError:
        return "binary"
    stripped = text.lstrip()
    if stripped.startswith(("{", "[")):
        return "json_candidate"
    if "<" in stripped[:100] and ">" in stripped[:100]:
        return "xml_candidate"
    return "text_unknown"


def inspect(path: Path) -> dict[str, object]:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    entries: list[dict[str, object]] = []
    with zipfile.ZipFile(path) as archive:
        for item in archive.infolist():
            if item.is_dir():
                continue
            # ZipFile rejects traversal on extraction; this utility never extracts at all.
            with archive.open(item) as stream:
                sample = stream.read(MAX_ENTRY_SAMPLE)
            entries.append(
                {"name": item.filename, "size": item.file_size, "format": classify(sample)}
            )
    detected_formats = sorted(str(entry["format"]) for entry in entries)
    return {
        "file_name": path.name,
        "file_size": path.stat().st_size,
        "sha256": digest.hexdigest(),
        "archive_entries": entries,
        "detected_formats": sorted(set(detected_formats)),
        "schema_version_if_present": None,
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: inspect-health-connect-export.py <export.zip>")
    candidate = Path(sys.argv[1]).resolve(strict=True)
    if not zipfile.is_zipfile(candidate):
        raise SystemExit("input is not a valid ZIP archive")
    print(json.dumps(inspect(candidate), ensure_ascii=False, sort_keys=True))
