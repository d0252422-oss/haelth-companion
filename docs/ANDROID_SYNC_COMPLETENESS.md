# Android sync completeness candidate

Version: `0.1.0-beta.31`. This document describes the candidate contract, not live acceptance.

The reader uses Asia/Taipei dates and a maximum of two recovery attempts per domain. A read deadline starts after acquiring a concurrency slot. Pagination stops on null, empty or whitespace-only tokens; repeated tokens/page caps remain explicit incomplete reads. Mapper failures and invalid records have bounded reason codes. Exceptions do not log raw values, source identifiers or credentials.

Both foreground and WorkManager upload paths require an exact multiset of SQL accepted/duplicate idempotency keys before advancing a checkpoint. Missing/malformed receipts cannot become success; they receive at most two retries. HTTP 207, auth failures and rejected batches do not advance the cursor. Legacy HTTP-only checkpoints replay safely. Changed datasets do not count the resumed frontier as verified persistence; they retain the existing bounded reconciliation pass.

The incremental worker replays its existing bounded read window by stable source identity. It no longer treats an old source modification time as evidence of a successful upload. This can increase network/DB work; real-device duration, battery and convergence remain acceptance requirements. Heart-rate's existing 24-hour bounded reread and other domains' seven-day reread remain unchanged. Historical backfill must be separately source-verified and scoped.

`sync_completeness` private preferences retain the latest account-scoped run. The contract contains run ID, server-bootstrapped canonical identity, actual per-domain read ranges, source/mapped/acknowledged/persisted counts, recovery counts and warnings. Persistence evidence means exact committed SQL receipt keys, not an independent SQL query. Unknown source or persistence counts are JSON null. Before a read, declared requested domains are pending permission/read and cannot be mistaken for empty source data. An overall read timeout finalizes that pending run as incomplete. This is a local diagnostic contract; no server-side diagnostic storage or schema is introduced.

Reconciliation rules:

| Domain | Expected canonical identity/shape |
|---|---|
| steps | One interval per source record; daily aggregation lineage must resolve overlap, not sum providers blindly. |
| heart_rate | One canonical sample per source record ID plus sample timestamp. |
| resting_heart_rate | One record; source timestamp and revision retained. |
| sleep | One SleepSessionRecord parent, owned by session wake date. |
| sleep_stage | One stage per parent ID plus stage boundaries/type; same parent wake date. |
| weight | One source record; timestamp/revision retained. |
| workout | One ExerciseSessionRecord; stable session identity and interval retained. |
| hrv | One RMSSD record, milliseconds. |
| spo2 | One percentage sample record. |
| total_energy | TotalCaloriesBurnedRecord interval only; existing affected-date markers retained; no Active/Basal addition. |

The test APK `SourceIntegrityProbe` defaults to a direct, read-only source snapshot. It saves hashes, provenance, timestamps and counts without health values or credentials. Its explicit `runtime` mode calls the installed production reader, mapper and batch planner, restoring only the existing session through the production server identity resolver. It does not open a login flow. `verified_backfill` additionally requires a private, independently SQL-verified identity/revision plan whose scope hash matches that server-resolved account. Only listed missing or provably stale records are uploaded through the existing ingestion client; a separate in-memory checkpoint prevents changing normal worker progress or claiming whole-window success. Optional replay verifies duplicate receipts. `verify_sql_extras` performs direct by-ID source reads and never deletes records.

Test invocation is an explicit diagnostic interaction and cannot count as natural background acceptance. These modes never enqueue a worker, change a permission, clear app data or write raw health values to diagnostics. If installation is denied by the phone, do not bypass its policy or substitute SQL for Health Connect source evidence.

For window reconciliation, inspect interval boundaries as well as canonical local dates. Include carry-in records and records covering the requested day whose end belongs to the following day. Total-energy source offsets and `affected_local_dates` must remain visible in the reconciliation rule; an end-date-only SQL filter can miss a legitimate interval. Compare hashed source identities and canonical content hashes, then inspect revision differences: an unchanged content hash can legitimately retain an older receipt/revision representation. SQL IDs absent from current Health Connect are a separate deletion/replacement finding, not missing uploads and not permission to delete historical records.

Before claiming full acceptance: run the direct source snapshot, compare identity/revision/date coverage through reader, mapper, payload and SQL, backfill only verified missing records, repeat the source/SQL comparison, and observe a new natural periodic run on the fixed APK. Golden/unit tests and HTTP 200 alone do not close these gates.
