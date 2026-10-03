# Sleep completeness: offline findings and release boundary

Status: **BLOCKED for live acceptance**, with a tested local Android mitigation.
No Beta/Production write, deployment, APK update, phone action, or fabricated sleep value occurred in this run.

| Asia/Taipei date | Google Health display | Health Connect session/stage count | Android reader/upload count | Beta raw sleep/stage | Canonical daily sleep | Beta Web |
|---|---|---|---|---|---|---|
| 2026-09-28 | User confirms present | Not observable without device read | Not correlated to source IDs | 0 / 0 | null | blank |
| 2026-09-30 | User confirms present | Not observable without device read | Not correlated to source IDs | 0 / 0 | null | blank |
| 2026-10-03 | User screenshot shows sleep | Not observable without device read | Stage path reached server; parent not correlated | 0 / 3, all parent identities absent | null | blank |

The first **observed** missing layer is Beta raw SQL. This does not prove that the Android reader never saw the 09/28 or 09/30 sessions. The 10/03 raw stages prove a partial upload path, not a complete `SleepSessionRecord` receipt. No stage fragments were summed into a session. The 07:54 UTC periodic receipt persisted 100 records, while connector `last_success_at` did not advance; whole-run completion is unresolved.

Static contract review found two concrete Android completeness risks:

1. Health Connect can signal the end of a paginated read with an empty page token. The old reader treated it as another page; a subsequent failure/cap can make an otherwise complete read partial. The candidate now normalizes empty token to EOF.
2. A prior partially uploaded multi-batch run can contain stages without its parent. The existing incremental filter used source `lastModifiedTime` to skip older event-time sleep records, even if the parent had never reached SQL. The candidate now replays a bounded seven-day sleep/session window by stable source identity. The preceding beta.29 candidate already placed each parent before its stages in upload order and replays old checkpoints.

There was also a verified cross-midnight ownership mismatch in the mapper: parent `sleep` used session wake date; child `sleep_stage` used the individual stage end date. The candidate assigns every child to its parent's wake date, retaining original stage start/end, source app and record ID. Existing Beta reconciliation rejects changed content at the same source revision, so sleep-stage mutations use a monotonic v2 revision namespace (`2 * source_last_modified_epoch_microseconds + 1`); other domains and parent sleep revisions remain unchanged. This is designed to let the server update, not duplicate, an existing stage. Microsecond precision also preserves a source update inside the same millisecond. It still needs a Beta acceptance replay before release is called complete.

The product's current sleep owner rule is **session end/wake date in Asia/Taipei**, not stage date or start date. This candidate does not change session duration semantics, infer missing sessions from stages, combine overlapping providers, or manufacture zeros. The Web targeted fixture confirms that missing parent sessions stay blank and a valid session remains visible even when Health Score recompute fails.

Tests: Android `testDebugUnitTest` 116 passed, 0 failed; `lintDebug` passed. Web daily readback 32 passed, 0 failed. `git diff --check` passed. A real APK could not be assembled in this process because the required Beta runtime configuration is unavailable; no fake endpoint/key was supplied. An isolated official PostgreSQL runtime was also unavailable, so the source-revision update contract was reviewed against the migration but not DB-integration-tested here. No remote write is authorized by this task.

Next safe release gate: obtain an isolated supported PostgreSQL test runtime, test old stage revision/content -> migrated stage update -> replay -> later source update with 0 duplicates; supply secure Beta build configuration; deploy only with separate approval; then source-correlate all three target dates on the device and verify raw/canonical/API/Web recovery. Until then `ROOT_CAUSE_CONFIRMED` for all three dates is **NO** and `READY_FOR_BETA_SLEEP_FIX_DEPLOYMENT` is **NO**.
