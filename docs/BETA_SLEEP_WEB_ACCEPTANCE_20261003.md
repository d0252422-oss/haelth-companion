# Authenticated Beta readback acceptance (prepared, not executed)

Scope: authenticated Beta session only, after a separately authorized sleep candidate deployment and source-record backfill. Do not use Production or treat a public screenshot as an authenticated API contract test. No login is requested by this document.

1. Record Beta Web build ID, Edge version, installed APK version, canonical owner and Asia/Taipei date range before testing. Keep credentials out of evidence.
2. For 2026-09-28, 09-30 and 10-03, correlate Health Connect `SleepSessionRecord` identity and stages with Android read/upload diagnostics, Edge receipt, Beta `beta_health_records`, canonical sleep session, authenticated API response and Web detail/7D value. Check the session's wake date, not its start or each stage's end date. Do not infer a session from fragments.
3. Verify same-day and cross-midnight session fixtures; a stage without a parent stays blank. Overlapping origins remain separate raw records until the existing source-reconciliation policy selects one. Replay and source revision update must not create duplicates or change owner.
4. Test sleep, steps, Total Energy, SpO2 and nutrition independently in 7D/30D. An available metric remains visible if the Health Score recompute for that date failed. A missing metric is blank, not zero; unreconciled Total Energy remains explicitly pending rather than fabricated.
5. Verify a valid 09/29 score remains visible, and failed 09/27/09/28/10/02/10/03 scores produce date-scoped partial-analysis status instead of a whole-page data refresh error. Do not change the score formula for this acceptance.
6. Compare authenticated API and Web under the same canonical owner and range. If SQL has a value but API does not, assign the API/read-model boundary; if API has it but Web does not, assign Web render/cache/build. Confirm no cross-user value appears.

Offline evidence: `tests/manual-daily-read.test.ts` passes the three-date null/session-recovery fixture, including failed score isolation. Live authenticated acceptance is **BLOCKED_HUMAN** until an authorized login/session and separately approved deployment exist. The currently installed beta.25 APK is not the local beta.30 sleep candidate.
