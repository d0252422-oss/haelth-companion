# Health Connect scheduled export POC evidence checklist

No export format is assumed. Collect two real exports after adding or changing one known record.

## Export 1 / Export 2

- `export_timestamp`
- `file_name`
- `file_size`
- `sha256`
- `cloud_file_id` (if the provider exposes one)
- `cloud_modified_time`
- `archive_entries` (name and uncompressed size only)
- `detected_formats`
- `schema_version_if_present`
- record count only when a real, documented format makes counting defensible

Run locally without upload:

```powershell
python scripts/inspect-health-connect-export.py "C:\path\to\export.zip"
```

## Comparison

Record, without guessing:

- `same_file_id = YES/NO/UNKNOWN`
- `same_filename = YES/NO`
- `hash_changed = YES/NO`
- `size_changed = YES/NO`
- `entries_changed = YES/NO`
- `record_count_changed = YES/NO/UNKNOWN`
- `possible_snapshot_or_delta = SNAPSHOT/DELTA/UNKNOWN`

Until two real exports exist, keep these `UNKNOWN`: file-ID stability, ZIP internal format, full snapshot versus delta, update semantics and delete semantics. Absence from an export is not a deletion tombstone.
