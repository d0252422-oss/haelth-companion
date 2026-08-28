import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "scripts" / "compare-health-connect-exports.py"
SPEC = importlib.util.spec_from_file_location("health_connect_export_compare", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
compare = MODULE.compare


def test_compare_reports_only_observable_changes_and_keeps_model_unknown() -> None:
    first = {
        "file_name": "export.zip",
        "file_size": 10,
        "sha256": "a",
        "archive_entries": [{"name": "one", "size": 1, "format": "binary"}],
    }
    second = {
        "file_name": "export.zip",
        "file_size": 12,
        "sha256": "b",
        "archive_entries": [{"name": "one", "size": 2, "format": "binary"}],
    }
    result = compare(first, second)
    assert result["same_filename"] is True
    assert result["hash_changed"] is True
    assert result["size_changed"] is True
    assert result["entries_changed"] is True
    assert result["same_file_id"] == "UNKNOWN"
    assert result["record_count_changed"] == "UNKNOWN"
    assert result["possible_snapshot_or_delta"] == "UNKNOWN"
