# iOS Real-Device HealthKit Acceptance Contract

This gate requires a physical iPhone, real Apple Health records, development
signing, and the approved isolated Beta backend. Simulator, fixtures, screenshots
alone, and synthetic records never qualify as live evidence.

## Common preconditions

- The tester is authenticated to the canonical Web/LINE account.
- A development-signed helper built from the recorded Git commit is installed.
- Universal Links and the one-time install-claim endpoint target isolated Beta.
- HealthKit contains real Steps, Heart Rate, and cross-midnight Sleep records.
- Server evidence uses hashes/opaque request IDs, never credentials or raw payloads.
- `production_writes` is `0` for the entire run.

## Deterministic acceptance matrix

| TEST_ID | Test | Preconditions / device state | Input and action | Expected result / PASS criteria | FAIL criteria | Evidence required |
|---|---|---|---|---|---|---|
| IOS-RD-A | App install / launch | Fresh install; authenticated Web session | Install and launch, then follow the verified continuation | Helper opens without typed configuration; one-time claim binds the same canonical user | Login, email, token, pairing code, guessed identity, or wrong user | App commit, install timestamp, hashed session/user references, claim exchange HTTP status |
| IOS-RD-B | HealthKit authorization | Identity bound; Health data available | Request read access for Steps, Heart Rate, Sleep | Apple permission sheet contains only required read types; request completes | Write permission, unrelated type, crash, or fake permission status | Permission-screen capture plus sanitized authorization lifecycle event |
| IOS-RD-C | HealthKit query | Real records exist | Run initial anchored query for all three domains | At least one real record per required domain is read with timestamps and source metadata | Fixture/simulator data, empty result represented as PASS, or malformed mapping | Sanitized domain counts, source app, hashed source-record IDs, timestamps |
| IOS-RD-D | Background observer | Authorization complete; app active then backgrounded | Add/allow a new real Health record and wait for observer callback | Callback completes once and schedules incremental synchronization | Missing callback, double completion, or full-history replay | Observer callback state, hashed record ID, incremental batch/request ID |
| IOS-RD-E | Background delivery | Background Delivery entitlement active | Background app and create/allow a real Health change | Best-effort delivery runs without claiming real-time guarantees | Entitlement missing, foreground-only behavior presented as background PASS | Device console lifecycle event, background delivery type, resulting request ID |
| IOS-RD-F | Create/update/delete reconciliation | One source record already synchronized | Synchronize create, modify source record, then delete it where feasible | Create/upsert, newer update, and tombstone/invalidation reconcile one source identity | Duplicate canonical row, hard-delete without audit, or derived state left valid | Source/canonical hashes, mutation type, revision, ingestion receipt, recompute marker |
| IOS-RD-G | Duplicate/replay protection | A successful real batch exists | Replay the identical batch twice | First accepted (or already present), subsequent replay deduplicated with zero new rows | Duplicate canonical health event | Request IDs, idempotency hash, accepted/duplicate counts, read-only row counts |
| IOS-RD-H | Stale update protection | Newer source revision already ingested | Submit/replay an older revision | Newer canonical state remains; stale mutation is rejected/deduplicated | Older payload overwrites newer canonical state | Source revision/hash, stale decision, canonical version before/after |
| IOS-RD-I | Cross-user isolation | Two isolated Beta users/sessions | Attempt user B payload under user A session | Client/server reject before mutation; no cross-user row is created | Any cross-user acceptance or visibility | Hashed user/session references, HTTP status/error code, zero-write reconciliation |
| IOS-RD-J | Network failure/retry | Pending real batch; network controllable | Disable network, sync, restore network | Protected queue persists and drains with bounded backoff; no duplicate | Data loss, credential prompt, busy retry, or duplicate insert | Queue counts, retry state/timestamps, final receipt, duplicate count |
| IOS-RD-K | Termination/relaunch | Valid session/checkpoint and pending/complete sync | Terminate and relaunch helper | Keychain session and checkpoint recover; incremental sync resumes | Plaintext token, lost ownership, full replay, or manual account input | Session fingerprint, checkpoint hash, before/after batch counts |
| IOS-RD-L | Background-task expiration | A controlled long-running sync can be expired | Trigger expiration/cancellation during processing | Cancellation observed; completion invoked exactly once with failure; retry retained | Hang, double completion, success after expiration, or queue loss | Task state transitions, callback count/result, retry state |
| IOS-RD-M | End-to-end traceability | Any successful real mutation | Trace source → queue → API → HDL v2 → DB → Web | One sanitized correlation chain preserves provenance and canonical ownership | Missing provenance, unmatched IDs, secret/raw payload in evidence | Timestamped hashes/request IDs, domain/source, operation, HTTP status, ingestion and Web visibility result |

Every row must record `TEST_ID`, preconditions, device state, input summary,
action, expected result, pass/fail criteria, and evidence references. The local
validator in `scripts/ios-real-device-evidence.cjs` rejects incomplete gates,
simulator/synthetic origins, sensitive keys, and missing A–M cases.

## Final pass block

```text
IDENTITY_BOUND = YES/NO
USER_TYPED_INPUT_COUNT = 0/N
HEALTHKIT_PERMISSION = PASS/FAIL
STEPS_READ = PASS/FAIL
HEART_RATE_READ = PASS/FAIL
SLEEP_READ = PASS/FAIL
INITIAL_SYNC = PASS/FAIL
INCREMENTAL_SYNC = PASS/FAIL
BACKGROUND_OBSERVER = PASS/FAIL
BACKGROUND_DELIVERY = PASS/FAIL
UPDATE_DELETE_RECONCILIATION = PASS/FAIL
DUPLICATE_REPLAY = PASS/FAIL
STALE_UPDATE_PROTECTION = PASS/FAIL
CROSS_USER_ISOLATION = PASS/FAIL
NETWORK_RETRY = PASS/FAIL
TERMINATION_RECOVERY = PASS/FAIL
BACKGROUND_EXPIRATION = PASS/FAIL
TRACEABILITY = PASS/FAIL
WEB_DATA_VISIBLE = PASS/FAIL
```

All fields must pass using real-device evidence. Partial domain coverage or a
Simulator result leaves `READY_FOR_REAL_DEVICE_TEST_RESULT = BLOCKED`.
