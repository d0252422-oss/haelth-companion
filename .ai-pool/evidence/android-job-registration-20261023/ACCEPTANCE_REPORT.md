# Android continuation/job registration recovery — beta.34

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
