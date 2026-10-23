# Android continuation/job registration recovery — beta.34

## Current acceptance — 2026-10-24 post-login follow-up

TASK = BETA34_POST_LOGIN_CONTROLLED_RECOVERY
OWNER = Codex/root, sole writer
REVIEWER = NONE; existing helpers performed bounded read-only SQL/source checks
STATUS = PARTIAL_C_RECOVERED_HISTORICAL_DB_BEGIN_FAILED
GOAL = Close the retained C scope without clearing progress, and distinguish controlled recovery, natural periodic execution and historical completeness.
FILES_CHANGED = Sanitized acceptance evidence and manifests only this follow-up; product e7f8c8e remains unchanged.
TESTS = Reused52 targeted JVM PASS, lint/build PASS and exact-commit CI39977468638 PASS. New product tests0. Fixture4PASS and six-day score recovery remain unchanged. The progress check still fails on the existing52 unique missing historical evidence paths across8 gates; overall project progress UNKNOWN.
RESULT = User completed normal Google login. Correct owner scope f06b9871e33e6fa0 authenticated through native bearer. Original page checkpoint2400->3363 on the same fingerprint. Original20 missing records and19 stale revisions are now39 EXACT. The whole original3363 page and captured next1527 page reconcile EXACT4890, with0 missing/stale/newer/inactive/semantic/idempotency mismatches and0 identity overlap between those two pages.
RISKS = Original beta33 I/O cause remains UNKNOWN. Final incremental page779 was not independently retained as a source manifest. Its normal committed batch receipts and terminal status prove runtime completion, not an independent whole-source SQL audit. Historical HR EOF and natural periodic whole-run remain unaccepted.
BLOCKERS = A distinct historical BACKFILL failed at DB TRANSACTION_BEGIN at00:36:13; checkpoint18700 is retained. Underlying driver machine code was not captured. No proof supports changing the unknown-error retry policy or deploying another Edge version.
NEXT_ACTION = Preserve the historical plan at18700; investigate exact request00d3593f-5d2c-4042-8d8a-eae7f95b8f55 with allowlisted DB-begin diagnostics, and separately accept the next existing natural periodic chain. No reinstall, forced job or broad replay.
HUMAN_APPROVAL_REQUIRED = NO; required phone/login actions RESOLVED; no new human action.

### Actual normal continuation

Frozen incremental window remains2026-10-23T05:18:33.499692Z through09:28:34.815519Z; per-domain late-arrival replay starts are earlier and are retained separately. All four WorkSpecs are SUCCEEDED, with actual persisted Dependency and parent worker/flow input linking:

| Worker | Flow | Normal ingestion occurrences this slice | Terminal |
| --- | --- | ---: | --- |
|5123a553-7149-4c15-811f-c484ca37190c|dc107ff9-9b7c-46a6-a046-cd598b286b50|963|PARTIAL; diagnostic whitelist reports null, not success|
|41ab61b0-dd86-497c-ad20-bc725dc9abfa|c6a9632b-6f0b-4895-81b9-0fb12e6ae656|1200|PARTIAL; null is not success|
|7210426c-0045-4da1-a4f5-57341e40015c|5c470e4c-baea-43e3-9182-05ced16da086|327|PARTIAL; null is not success|
|7d2a996d-7e83-440e-ad45-7af0856dae13|e3208c17-6ce9-447a-9cab-9b8d67d1eaaf|779|SYNCED at2026-10-24T00:27:51.141+08:00|

The first slice starts exactly after the retained2400 prefix, not from zero. Total3269 sent occurrences =253 accepted mutation receipts +3016 verified duplicates +0 rejected. Accepted is not equated with new SQL rows, and occurrence totals do not prove unique source counts. Exact owner/source/revision/15-field semantic/idempotency checks independently cover the two captured pages'4890 unique identities. Individual SQL chunks have their own timestamps; they are not one global database snapshot.

Captured page1 is **not EOF**: steps1000 remained CAPPED and spo2527 completed. The following779-record page was uploaded by the last child. Source manifests for that last page were not retained and are not reconstructed from SQL. The installed runtime only emits its final SYNCED after all remaining domains have completed and all page mutations have exact commit receipts; the subsequent completed coverage cursor advances06:18:33.499692Z->09:28:34.815519Z and the selected pending cache is absent. This is PASS for controlled runtime completion and the original C tail, with the independent-source-audit boundary above.

HOME was sent once at00:26:25.701844 to leave the Activity in the background; no force-stop occurred. Subsequent children and historical handoff executed in background. Origin remains APP_START: **CONTROLLED_RECOVERY**, not a natural PERIODIC_WORKER whole-run. No manual sync, forced Job, broadcast or heartbeat upload was used.

### Real registration repair and evidence consistency

Periodic retains UUID2f5e0af8-ffb6-4f67-94f8-053d40b0e49c, generation0->1 and period_count4. SystemIdInfo now maps generation1 to actual namespaced OS job390; `get-job-state` returns waiting. Persisted interval2h and connected-network constraint remain; charging/device-idle requirements are false. No new post-fix periodic execution is claimed. The old failed legacy C/backfill UUIDs were not revived.

The00:25:00 and00:35:51 selected-file captures had stable before/copy/after hashes and SQLite-aware backup integrity ok, including WAL. There is no cross-storage atomicity claim. The cache absence check uses the actual selected path's fixed not-found result; `adb exec-out test` exit status alone was not reliable and is not evidence. Raw archives, manifests, source IDs, credentials and private databases remain on D, outside Git. Only sanitized summaries are committed.

### Separate new historical failure

History remains the fixed2026-09-20T11:01:39.721742Z through2026-10-20T11:01:39.721742Z scope. Normal BACKFILL continued13600->14800->18400->18700 on fingerprint v3:a554b96794b6c0be54069d84f535768a2828ca238387eebe67874199033717ab. It was not restarted from zero or extended to new dates.

At00:36:13.382, Edge64 request00d3593f-5d2c-4042-8d8a-eae7f95b8f55 /execution5ed4158c-0305-45f3-a2cc-91ec0f4aa251 /flow90ae01cc-a7ea-4cee-aff3-0888939a060f /worker ef39ced2-7433-4859-8708-2f2d5db7a41c failed with HTTP400, INGESTION_INTERNAL_ERROR, TRANSACTION_BEGIN, UnknownError, SQLSTATE null. The phone independently records the same flow FAILED/RESPONSE_READ/BatchUploadFailed. The connector table at00:39 reports beta34, FAILED, updated00:36:14.869934; last successful report00:27:48.496 remains intact. Latest failure and earlier success are both retained.

Actual source places APPLY_USER_SCOPE at the first transaction callback line. Thus this failure occurs before that callback, not in record validation or mutation writes. Native scope issuance happened earlier separately, so do not claim no SQL operation of any kind. Boot-to-failure4.575s is compatible with connect_timeout5 but does **not** prove CONNECT_TIMEOUT. UnknownError/null SQLSTATE can mask missing or unallowlisted driver codes. No known payload problem or historical beta33 I/O cause is established.

Existing behavior preserves the cache/window/checkpoint when400 becomes FAILED. It does not immediately retry that failed WorkSpec. After a future normal periodic incremental completes and history_pending remains true, the existing scheduler enqueues a new BACKFILL and can resume18700 if that immutable plan still matches. This source-proven recovery path is not yet an observed post-failure recovery. No unknown-error retry broadening, blind Edge redeploy, backend push-policy workaround or additional phone action was attempted.

C_SCOPE_COMPLETENESS = PASS_ORIGINAL3363_EXACT
MISSING_20_STATUS = RECOVERED
REVISION_19_STATUS = EXACT_CURRENT_SOURCE_REVISION
PERIODIC_JOB_REGISTRATION = PASS_RUNTIME_JOB390
CONTROLLED_RECOVERY = PASS_FROZEN_INCREMENTAL_RUNTIME
INDEPENDENT_NEW_PAGE_SQL_AUDIT =4890EXACT;final779 source manifest not captured
NATURAL_BACKGROUND_WHOLE_RUN = PENDING
HISTORICAL_BACKFILL_COMPLETENESS = PENDING_DB_BEGIN_FAILED_HR_EOF_NOT_PROVEN
DEPLOYMENTS_THIS_FOLLOWUP =0
PRODUCTION_OPERATIONS =0

Evidence: post-login-acceptance-20261024.json, post-login-device-evidence-20261024.json, post-login-server-receipts-20261024.json and backfill-begin-failure-20261024.json. Existing Codex Desktop task beta/DAILY09:00 remains unchanged and observational. No indefinite agent/background execution is claimed.

---
Prior acceptance snapshots follow chronologically; superseded blockers below are retained as history.

TASK = REPAIR_C_CONTINUATION_AND_JOB_REGISTRATION
OWNER = Codex/root (sole writer)
REVIEWER = existing read-only ui_audit and engine_gap; no additional reviewer
STATUS = PARTIAL_IMPLEMENTED_CI_PASS_DEVICE_INSTALL_BLOCKED
GOAL = Restore C's existing scope through supported scheduling and normal ingestion, without restarting completed prefixes.
FILES_CHANGED = 8 Android source/test/build files; see candidate-manifest.json
TESTS = 52 targeted JVM PASS, 0 FAIL; lint 0 errors/68 warnings; debug APK build PASS.
RESULT = Product repair e7f8c8e merged via PR #5 to the existing Beta development branch (merge64c66d5); exact-commit CI39977468638 PASS. Same-signature beta.34 built. Device disappeared before install, so no device update/recovery is claimed.
RISKS = Original C I/O substage and cause remain UNKNOWN. Force-stop/revocation/logout restrictions remain. Natural whole-run and fixed historical source EOF are separate pending gates.
BLOCKERS = Original phone disconnected before adb install; device installation and C tail verification cannot run. Natural whole-run/source EOF remain pending.
NEXT_ACTION = Reconnect the original phone, install this already verified beta.34 APK once with -r, verify namespaced jobs and the unchanged C plan/frontier, then let normal ingestion account for its tail. No rebuild/CI rerun unless the candidate changes.
HUMAN_APPROVAL_REQUIRED = NO (existing scoped Beta authorization; only a real phone security prompt could require one action)

## What changed

- The existing boot/package-replaced/inexact watchdog receiver reconciles already configured work without making an online native-auth/Health Connect call first. The actual worker still performs the original authenticated canonical-owner and Health Connect permission checks.
- Newly created one-time jobs durably save an allowlisted descriptor by owner scope, mode and UUID before enqueue. Failed child enqueue/KEEP cannot overwrite a parent's descriptor. Finished descriptors are pruned through public WorkInfo state, never by modifying WorkManager's database.
- Two missing namespaced OS-job reads and a fresh same UUID/generation/ENQUEUED check are required. Official public `updateWork` preserves that UUID, exact input, constraints, delay, tags and configured backoff. Unknown inputs, blocked/running/finished or racing generations are not revived. Repairs use the same unique-work scopes, process mutex and cooldown.
- Existing legacy C has no guessed descriptor. A same-signature APK update permits WorkManager 2.11.2's supported initialization reconciliation to restore its original request/dependencies.
- Active periodic orphan repair uses UPDATE; finished periodic recovery retains scoped cancel/re-enqueue. No cancelAll, new scheduler, reflection or WorkDB writes.
- Upload stages now distinguish BATCH_POST, RESPONSE_READ, RECEIPT_VERIFY and CHECKPOINT_SAVE. Fixed checkpoint/scope/DNS/connect/TLS/interrupted labels do not retain messages or health payloads. Cancellation presenting as I/O does not retry or advance the checkpoint.

## Evidence boundaries

Original device evidence and this round's 22:58 stable file-set capture independently confirm jobs385/386/388 missing in namespace `androidx.work.systemjobscheduler`, while their generation0 WorkSpecs remain ENQUEUED. Original prefix2400 and plan fingerprint remain unchanged. The three OS disappearances' historical cause is not established.

Before recovery, the exact old39 source identities still reconcile as20 MISSING and19 SERVER_STALE. This is diagnostic metadata, not new source reading. The whole3363 immutable page, further source pages and the run terminal state must be verified after recovery.

Historical range stays 2026-09-20T11:01:39.721742Z through2026-10-20T11:01:39.721742Z. Its cached79106 identities already matched SQL, but the retained HR cursor is not EOF. Neither that cached-page PASS nor a natural/controlled incremental completion proves whole historical completeness.

52 local tests are five nonoverlapping suites (13+15+7+10+7);13 cases are newly added. Required CI may execute its existing broader Android suite; it is not added to52 as unique new cases. Prior fixture4 PASS and six-day score publication recovery are reused unchanged; no Edge/Web/SQL release is made.

Full project progress remains UNKNOWN under `known-scope-v0.1-provisional-2026-09-12`. Existing progress evidence failures are retained, not repaired by manufactured artifacts. Unrelated staged/root changes and untracked evidence are preserved.

Private file sets, WAL/SQLite and raw pending pages stay under `D:/Dev/Evidence/beta33-repair-c-20261023` and the prior protected snapshot directory; no private database or token is committed. This report contains no raw health values. The existing task beta remains daily09:00 and is an observer, not a dependency of phone sync.

## Supported APIs

- https://developer.android.com/develop/background-work/background-tasks/persistent/how-to/update-work
- https://developer.android.com/reference/android/app/job/JobScheduler
- https://developer.android.com/develop/background-work/background-tasks/persistent/how-to/manage-work
- Actual cached AndroidX WorkManager2.11.2 source/bytecode was checked for initialization reconciliation and UPDATE behavior; official interfaces only are used at runtime.

PRODUCTION_OPERATIONS = 0

## This round's actual closure state

- Local52 targeted tests PASS; lint/build PASS. Exact-commit required CI39977468638 PASS; no required CI bypass. PR #5 merged at2026-10-23T15:26:08Z to `codex/android-full-health-integrity`; no Production/main deploy.
- APK `a829b3c0ad2bf3639ae8ba26f43116c0a7e45bc5c86b6c8c9891979c81432424`, version34, same signer435ef965… as installed beta.33. Source/APK hashes rechecked immediately before install.
- Install output: original serial not found. An immediate bounded `adb devices -l` returned empty. No install succeeded, no Activity/job/broadcast was forced, and no checkpoint or real health data was written by diagnostic commands.
- One necessary reconnect request was sent; no permission/authorization is requested again. Installation, actual registration repair and normal continuation verification remain NOT_RUN, not PASS.
- Pre-install SQL still classified the exact prior39 exceptions as20MISSING/19SERVER_STALE. Prefix2400 is preserved; post-recovery cursor is UNKNOWN. The original C remains the acceptance reference; no replacement claim is invented.
- New user authorization explicitly superseded the older read-only limitation; controlled recovery after installation is authorized and must be labeled CONTROLLED_RECOVERY. It does not count as the separate natural background whole-run acceptance.
- No unrelated Edge/Web/migration or API release, no Production operations, no new observer/schedule. Original I/O cause and the OS disappearance cause remain UNKNOWN; the proven missing recovery branches were repaired.

## 2026-10-24 installation / controlled acceptance follow-up

STATUS = PARTIAL_INSTALLED_SESSION_UNAVAILABLE

User reconnected the original phone. At00:03:33 Asia/Taipei, verified product e7f8c8e APK was installed with `adb install -r`; version34 and the original signing certificate are confirmed. First install2026-09-02, application data inode,10 granted Health Connect permissions (including background), both immutable pending-cache byte hashes and original plan/checkpoints remain intact. No rebuild or test rerun was required; all product hashes still match the frozen manifest.

A stable pre-install snapshot independently showed a **newer state than the old39f5a25 report**: at2026-10-23T15:32:55.898427Z (23:32:55 Taipei), account-scoped status had already become AUTH_REQUIRED at SESSION. C and historical backfill WorkSpecs were FAILED before beta34 installation; periodic remained ENQUEUED with period_count4. Thus jobs for finished C/backfill must not be blindly resurrected or treated as current ENQUEUED registration gaps. The retained background_work_id may be older than this session-only result; recordSessionFailure does not bind a new flow, so no unsupported exact flow attribution is made.

One authorized normal MainActivity launch was performed as CONTROLLED_RECOVERY (not natural background evidence). It still produced no authenticated handoff/new upload. Incremental checkpoint remains2400 on the same fingerprint; historical checkpoint13600 also remains intact. After this launch, the captured periodic ENQUEUED row had no matching active SystemIdInfo/OS job; successful registration repair is therefore **not claimed**.

Reason/exception-class fields are absent in the session-only status. Source review shows the worker can label restore()==null as AUTH_REQUIRED, but Supabase Kotlin3.2.6 also returns currentSessionOrNull()==null in RefreshFailure. Missing/decode/decrypt/temporary-refresh conditions are not distinguished by existing diagnostics. This does not prove an expired/revoked token, and no historical cause is invented. Full SDK logs or credential storage were not copied/read; on-device fixed-literal filtering yielded no usable classification. No second product release is made for an unproven cause.

At00:06:30.052086 Taipei, one scoped readonly SQL aggregate still found20 MISSING and19 SERVER_STALE among the exact original39 tail identities. No new source snapshot or SQL backfill was performed. This is POST_INSTALL_PRE_CONTROLLED_RECOVERY evidence, not successful recovery.

The next normal product path requires a usable App session. One human Google-login action was requested under the user-provided AGENTS.md `Human stop conditions: OAuth or account login`; this is not another request for Beta authorization. No automated account selection, copied session, service credential, backdoor or auth-policy change is used. After the user completes normal login, continue the same plan through normal ingestion and verify its trusted receipts; do not reset cursors or rerun completed prefixes.

APK_INSTALL = PASS
APP_DATA_AND_PERMISSIONS = PASS
C_SCOPE_COMPLETENESS = PENDING
CHECKPOINT_BEFORE_AFTER = 2400 ->2400
NATURAL_BACKGROUND_WHOLE_RUN = PENDING
HISTORICAL_BACKFILL_COMPLETENESS = PENDING
TESTS_NEWLY_EXECUTED = 0 (unchanged candidate)
NEXT_ACTION = complete normal original-account phone login,then verify authenticated background handoff,actual namespaced jobs,C tail receipts and source EOF; do not press immediate sync
PRODUCTION_OPERATIONS = 0
