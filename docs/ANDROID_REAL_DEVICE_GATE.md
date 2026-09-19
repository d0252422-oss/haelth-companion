# Android real-device gate preparation

STATUS = READY_COLLECTOR_PREPARATION; REAL_DEVICE = DEFERRED.
No ADB connected test, app start/install, permission change or job force is run here.

## Future preflight

Use scripts/android-real-device-gate.ps1 only when the device track is authorized.
Require one unambiguous device, exact Beta package/version/hash and explicit16hex
account ScopeHash. Default command10s, observation90s, bounded child timeout. Never
kill-server/clear app data, alter network or infer success from starting the app.
Save evidence under D:/Dev/Evidence/<new-run>. Captured model/API/package metadata
must agree with APK manifest. Health Connect checklist: provider availability,
per-domain read grants, background/history permission support, revoked/denied/empty
distinctions and OS/OEM battery restrictions. Verify actual UI state, do not auto-grant.

## Observability contract / gaps

| Field | Existing collector / required evidence |
|---|---|
| work_id | Account-scoped runtime metadata; correlate with actual WorkInfo UUID |
| canonical_user | Do not log raw identity; use explicit ScopeHash and secure server mapping |
| attempt | Mixed runAttemptCount/completed-batch request_count is not HTTP count |
| batch_index/checkpoint | Need account-scoped acknowledged receipt; global checkpoint not collected |
| request_start/end/duration | Not currently emitted as correlated per-HTTP evidence |
| retry_reason/result | Runtime stage/result plus WorkInfo/network/server receipt correlation |
| next_schedule | Actual WorkManager enqueue/next-run evidence, not inferred from counters |
| automatic resume | New WorkInfo progress and server receipt after natural OS/network recovery |

Required chain: queued work -> worker start -> each bounded request -> accepted
receipt/checkpoint -> retry/re-enqueue if needed -> automatic resume -> SQL/engine/Web.
No raw health payload, token, Authorization header, password or full unfiltered
logcat/bugreport in evidence. Upload timing must be actual request boundaries, not
overall worker duration. Retry attempts and batches have separate meanings.

The Kotlin ingestion/worker files contain pre-existing unrelated dirty changes.
This run does not overwrite or commit them. Per-request logging remains a concrete
integration gap; collector now declares it explicitly rather than inventing fields.
Integrate sanitized event boundaries after that work is handed off/committed; run
only affected unit/static tests. No new Android UX or device acceptance implied.

Offline regression: scripts/test-device-collector-offline.ps1 uses an intentionally
missing ADB path and owned fake child to test guards/timeouts; it never contacts ADB.
