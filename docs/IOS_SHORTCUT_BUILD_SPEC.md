# iOS Shortcut build specification — consolidated entry

Source of truth: config/ios-shortcut-tester.manifest.json and
scripts/ios-shortcut-build-spec.cjs; reuse existing tested fixtures and build rules.

| Domain | Elapsed lookback | Unit / selection |
|---|---|---|
| steps |24h| count; start inclusive/end exclusive point |
| heart_rate |24h| bpm; start inclusive/end exclusive point |
| sleep |7d| minutes; overlap, preserve original interval |
| weight |30d| kg; start inclusive/end exclusive point |
| workout |7d| minutes; overlap, preserve original interval |

One frozen UTC end for all windows. No invented REM/deep/efficiency, no clipping
sleep/workout into misleading new durations. Domain-separated batches <=250 records,
stable IDs/membership/revisions and byte-equivalent bounded retries. Unknown !=zero.

Existing endpoint remains old Beta uavimjgccigpbwqmfkhh with
/v1/connectors/ios-shortcut/session and /v1/connectors/ios-shortcut/ingest. Do not
retarget as a side effect of Web cutover. Short-lived single-use setup code exchanges
for the existing24h user-scoped revocable session; credentials stay runtime-only.
Server canonical mapping is authoritative; arbitrary client user_id is never trusted.

Generate offline gate using scripts/ios-shortcut-gate.ps1 -At <ISO-UTC> -OutputFile
D:/Dev/Evidence/<existing-run>/ios.json. Output refuses overwrite and stays NOT_RUN.
This is not an importable .shortcut file, share link or device-verified field mapping.
