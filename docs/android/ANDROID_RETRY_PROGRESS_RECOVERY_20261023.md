# Android retry progress and freshness recovery — 2026-10-23

CURRENT_PHASE = ANDROID_RETRY_PROGRESS_AND_FRESHNESS_RECOVERY
STATUS = PARTIAL_RECOVERY_BACKGROUND_UNVERIFIED

## Fixed scope and candidate

- Android baseline: `ca1cfe06410e141bf981aee277bebf423cf39aa2`, repository
  `d0252422-oss/haelth-companion`; beta.31 installed source was `efb3aa7`.
- Candidate: `0.1.0-beta.32-debug`, versionCode 32, package
  `app.healthcompanion.sync.beta.debug`.
- Device APK SHA-256:
  `6bc28bb47b183590c4af447c864d7ebf66eba344f9a2ca37ffd6934d365e2f48`.
- Signing certificate SHA-256 matches installed beta.31:
  `435ef9651e6b6c3141ecfc3370b57e15e93d3ecf3c2a722ded8b6aa875424300`.
- Beta remains `uavimjgccigpbwqmfkhh/mobile-health-beta`, Edge v58, bundle
  `ed8d4fbc6d8b24f0d03651487bd65d6c2dc6e9b32e298361a0a4ab598e1dd80e`.
  No Edge, SQL migration or Web deployment is part of this candidate.

## Confirmed findings and exact limits

1. **Reproduced coverage-cursor regression.** Separate modes retain their own
   frozen window, but formerly wrote the common completed coverage cursor
   unconditionally. An older backfill completing after a newer incremental run
   could move that cursor backwards. A regression failed before the change.
   Completion now retains the greatest actually completed window end. Unfinished
   mode checkpoints and their receipt requirement remain intact.
2. **Different time definitions.** Worker local success represents completed data
   coverage; server `last_success_at` represents a successful status-report time.
   Foreground completion now also uses its actual window end, rather than wall
   clock time. The phone label is `已完成資料截止`.
3. **Actual beta.31 retry cause remains UNKNOWN.** Its latest observed terminal
   stage was UPLOAD, request progress 0, but no safe exception reason survived.
   Duplicate counts alone do not prove repeated batch identity or failure.
   The new diagnostic stores only fixed reason/class labels and terminal stage,
   never exception messages, tokens, source identities or health values. A new
   run and success clear old failures. Retry decisions are unchanged.

`BackfillCatchUpRequired`, socket/deadline failure, incomplete receipt and other
failure types remain distinct. No fairness/scheduler change was made: starvation
has not been established. No checkpoint, frozen window or successful timestamp
was manually edited or cleared.

## Source-verified missing-data recovery

Existing instrumentation was reused. Direct Health Connect and production-reader
captures covered 2026-10-18 through 2026-10-23, Asia/Taipei. All relevant reads
completed, including pagination. Heart rate was empty for that interval with
permission granted: **SOURCE_NO_DATA**, not an ingestion loss finding.

For the five domains below, SQL was independently verified to contain no active
or tombstoned identities in the target affected dates 2026-10-21 through 10-23
before planning recovery. Only source-verified missing identities were submitted
using the normal authenticated ingestion path.

| Domain | Recovered identities | Verification |
|---|---:|---|
| sleep | 8 | source/revision/content signature equals SQL |
| sleep_stage | 79 | source/revision/content signature equals SQL |
| steps | 1,031 | 1,030 signatures plus one separately verified live revision |
| spo2 | 456 | source/revision/content signature equals SQL |
| total_energy | 308 | source/revision/content signature equals SQL |
| **Total** | **1,882** | persisted receipts and independent SQL reconciliation |

The first attempt correctly stopped with VERIFIED_PLAN_STALE before writing:
one current-day step record changed while the source was being read. The bounded
second attempt excluded that identity and persisted 1,881 stable records
(accepted 1,881, duplicate 0, rejected 0). A fresh missing-only plan then persisted
the one changed identity (accepted 1, duplicate 0, rejected 0). Its revision and
content hash were independently read back from SQL. No raw values were exported.

This proves the recorded scoped snapshot, not all future/historical completeness.
SQL active identity duplicate counts were zero for the six inspected domains.
Historical extra SQL identities were not deleted.

## Product readback

The existing normally authenticated Chrome session opened the normal Beta URL,
without uiTest, copied tokens or a fabricated test session. On 2026-10-23 the
7-day dashboard displayed latest sleep on 10/23, current steps and latest complete
daily energy on 10/22. Current-day incomplete energy remained missing rather
than zero. The previous raw 10/20 interval ended before the end of that day;
raw presence alone does not qualify a complete daily energy projection.

No synthetic record, real-user goal or training entry was created. Health Score
staleness did not hide the recovered metrics. This is read-only real-data evidence,
not isolated-account write acceptance.

## Installation and background boundary

Signature-verified `adb install -r` succeeded at 10:24 Asia/Taipei. Version 32,
original first-install time, all Health Connect grants, three existing WorkSpecs,
checkpoints and local completed cursor were retained. No uninstall, clear-data,
pairing or security-policy operation occurred.

Observation baseline: 2026-10-23T02:25:23.236556Z. The local coverage cursor was
still 2026-10-10T07:44:15.244341Z. No new whole-run completion is inferred from
the controlled backfill. One explicit ADB trigger of existing recovery job 305
was recorded as **integration only**; that command initially produced no new Worker
terminal result. WorkManager subsequently executed the existing recovery at
2026-10-23T02:42:45.532714Z and completed it at 02:43:37.959094Z. It is not
natural periodic evidence: this is a one-shot recovery, and the observation window
includes the earlier ADB action.

The same recovery Worker progressed from checkpoint 3 / record 300 to checkpoint
17 / record 1,700, then completed the 1,750-record cumulative verified plan.
The steps 1,363 and total_energy 387 counts were COMPLETE at source, mapping,
upload and persistence, with no warnings. The recovered run's own checkpoint and
frozen window were cleared by its existing normal success path. The unfinished
regular incremental and backfill checkpoints remain intact.

The server now records beta.32, SYNCED, success-report time
2026-10-23T02:43:35.347Z (10:43:35 Asia/Taipei), consistent with that recovery's
local terminal SUCCESS. The common coverage cursor intentionally remains 10/10:
the two-domain P0_RECOVERY window does not complete the regular all-domain window.
This status-report advance is **not** proof of a regular whole-run completion.
The original beta.31 retry exception was not preserved and was not reproduced in
this successful beta.32 attempt; its exact cause remains UNKNOWN.

| Acceptance | Status |
|---|---|
| A: scoped source to SQL and product readback | PASS_SCOPED |
| B: actual fixed-version run/checkpoint progress | PASS_SCOPED_RECOVERY; regular windows pending |
| C: actual fixed-version status update | PASS_SCOPED_RECOVERY; regular whole-run pending |
| D: complete natural periodic on fixed APK | PENDING |

The existing three-hour heartbeat `beta` was updated, not duplicated. It compares
health event dates and same-mode frozen window/fingerprint/checkpoint progression,
distinguishes reconciliation resets, and treats unreadable evidence as UNKNOWN.

## Tests and provenance

- Before fix: SyncRuntimeCursorTest, 3 cases, 1 expected regression failure.
- Final candidate: six affected Android suites, **107 passed / 0 failed**:
  SyncRuntimeCursorTest 6, RetryProgressTest 4, SyncCompletenessTest 18,
  IngestionClientTimeoutTest 15, SyncPerformancePolicyTest 58,
  SessionAndRetryPolicyTest 6. Repeated executions are not added to this total.
- `:app:lintDebug :app:assembleDebug --offline --console=plain`: PASS, with verified
  existing public Beta configuration; no signing key change.
- Existing Android beta APK CI [39890196359](https://github.com/d0252422-oss/haelth-companion/actions/runs/39890196359): PASS for source
  `81cc6a307ee7a4bac6de32d678780f3dd15a5ac5`. [PR 3](https://github.com/d0252422-oss/haelth-companion/pull/3) merged only these six files
  into the existing Android development branch at
  `c88a3c02605661f9cd013c1afb37ed84e3ff0d15`; no old branch was merged into main.
- No Food, training-engine, Health Score, iOS or unrelated SQL tests were run.
- `node scripts/calculate-project-progress.mjs --check`: exit 1 for historical
  missing evidence artifacts. Baseline/scope/weights unchanged; overall UNKNOWN.
- Local private diagnostic captures, JUnit XML, failed attempt, source/SQL
  signatures and APK remain under `.ai-pool/evidence/android-retry-progress-20261023/`.
  They are deliberately excluded from the public repository commit.

## Handoff

TASK = ANDROID_RETRY_PROGRESS_AND_FRESHNESS_RECOVERY
OWNER = Codex primary; sole file writer
REVIEWER = engine_gap / ui_audit, bounded read-only receipt/cursor review
FILES_CHANGED = Android runtime, foreground cursor label, version, two targeted test files, this report
TESTS = 107/0, lint/build PASS; natural periodic NOT_RUN
RESULT = Scoped missing records recovered; cursor regression fixed; recovery checkpoint/terminal accepted; original retry cause unresolved
RISKS = No proof yet that frozen older work converges or recent increments continue automatically
BLOCKERS = Regular all-domain windows and natural periodic completion remain unverified; historical retry exception unavailable
NEXT_ACTION = Use the existing heartbeat to observe the retained regular incremental/backfill checkpoints and one natural periodic completion; if a retry recurs, use its fixed diagnostic to repair only the proved failing layer
HUMAN_APPROVAL_REQUIRED = NO renewed Beta approval; normal device security/OAuth boundaries remain
PRODUCTION_OPERATIONS = 0
