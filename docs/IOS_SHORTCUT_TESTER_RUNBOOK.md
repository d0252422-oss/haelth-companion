# iPhone Apple Health Shortcut — tester setup

Beta path: `authenticated Web/LINE → 健康資料同步 Shortcut → Apple Health read-only query → authenticated staging ingestion → HDL v2`.

## Current evidence boundary

`config/ios-shortcut-tester.manifest.json` is metadata, **not an importable Shortcut**.
The five-window action specification is `ios-shortcut-five-window.v1`; no `.shortcut`
action artifact, iCloud share link, actual iPhone field/permission behavior, bounded
HTTP action, or current remote ingestion execution has been validated by this work.
The configured HTTPS address is an existing Beta target, not fresh deployment evidence.
Offline preparation needs no phone. The following manual build/device checklist is
for a separately authorized owner session; this document does not initiate it.

## Reproducible non-device specification

```powershell
node scripts/ios-shortcut-build-spec.cjs --at 2026-09-14T04:00:00.000Z
node scripts/ios-shortcut-real-device-gate.cjs --prepare --at 2026-09-14T04:00:00.000Z
node --test tests/ios-shortcut-build-spec.test.cjs
```

The first command prints a deterministic plan to stdout only. It reads the versioned
manifest; it does not query Health, read credentials, upload, contact an endpoint,
generate an Apple-signed artifact, or download anything. `--at` must be canonical UTC
ISO format with milliseconds; no implicit machine clock or timezone is used.
The device-gate preparation command prints a NOT_RUN checklist for all five windows,
receipts, SQL/Web correlation and isolation. It executes no device/network action and
cannot turn a filled template into PASS. `IOS_SHORTCUT_REAL_DEVICE_GATE=PENDING_OWNER_DEVICE`.

| Read-only query | Elapsed lookback before one frozen end E | Unit | Selection |
|---|---:|---|---|
| steps | 86,400 seconds / 24 hours | count | recorded_at in [E−24h, E) |
| heart_rate | 86,400 seconds / 24 hours | bpm | recorded_at in [E−24h, E) |
| sleep | 604,800 seconds / 7×24 hours | minute | original interval overlaps [E−7d, E) |
| weight | 2,592,000 seconds / 30×24 hours | kg | recorded_at in [E−30d, E) |
| workout | 604,800 seconds / 7×24 hours | minute | original interval overlaps [E−7d, E) |

This version deliberately uses elapsed seconds, **not local calendar midnights**.
An interval overlaps only when `started_at < E` and `ended_at > window_start`, with
`started_at < ended_at`. Preserve its original timestamps, value and duration;
do not clip, sum, allocate minutes to dates, merge sleep stages or fabricate records.
Keep the existing record timezone/local_date contract separately from UTC selection.
For point domains this version uses `recorded_at`; if actual Shortcuts only exposes
different sample-time semantics, stop that domain and record the missing mapping.
Do not silently substitute a daily total or another date field.

The manifest retains the backend's nine supported domains for compatibility, but
this build reads **only the five selected domains**. HRV, SpO2, resting heart rate
and sleep stages are not additional actions in this version.

## Explicit manual build owner checklist (not yet executed)

The authorized iPhone build owner must record the iOS/Shortcuts version, action list
or inspectable export hash, test account label, measured start/end and sanitized
receipt evidence. A desktop manifest test cannot check these items.

1. Build **健康資料同步** manually from this specification in Shortcuts. Do not claim
   the JSON manifest can be imported. Keep Health access read-only and do not add
   background triggers while validating a manually initiated first run.
2. Freeze E once, normalize it to UTC, calculate all five starts and create five
   separate queries. Configure/query enough samples to apply the interval rules;
   never use an undocumented default result cap. Inspect that each query returns
   all results or record an explicit limit/blocker; do not infer completeness.
3. Confirm actual availability and meaning of `source_app`, `recorded_at`,
   `started_at`/`ended_at`, units and timezone/local_date. Preserve native record ID
   if exposed. Otherwise reuse the backend's derived-fingerprint contract; do not
   claim an unavailable HealthKit UUID. Keep a stable source revision and content
   on retries; a changed sample requires the existing update/revision contract,
   not a random new identity. Missing required fields block that domain.
4. An empty Health result means `NO_SAMPLES_PERMISSION_UNKNOWN`, not proof that
   permission was granted. Distinguish a known query error/denial where the device
   exposes one. Never create a zero record to represent empty or unavailable data.
5. Obtain and exchange a one-time Beta setup code using the existing flow below.
   Use the returned canonical user ID; never choose an arbitrary account or put a
   service credential in the Shortcut. Verify the exact authorized Beta HTTPS target.
6. Keep domains/windows separate: each envelope carries that domain's start/end.
   Sort stable record identities before splitting into at most250 records, save
   each serialized request body once, then reuse its exact bytes for ambiguous
   retries. The helper's synthetic-key checksum covers membership only; it is not
   an HTTP body hash or a production idempotency key.
7. Build bounded error handling: target30 seconds/request, at most3 total attempts
   and120 seconds total elapsed including waits. Respect a retry delay only if it
   fits the remaining budget. Actual Shortcuts cancellation/deadline support is
   **NOT_VERIFIED**: if no supported action can enforce this, mark the HTTP Gate
   BLOCKED rather than claim the surrounding loop bounds a blocked request.
   Never launch parallel requests or retry after an authentication failure.
8. On timeout or an uncertain response, do not assume rollback: ingestion currently
   commits per record. Retry the same batch; do not increment revisions, regenerate
   identities or discard already accepted receipts. A207/partial receipt stays
   PARTIAL; classify rejected entries, do not call the whole run successful.
   A200 alone proves neither analysis completion nor current UI/DB consistency.
9. Display a terminating, sanitized state: no samples/permission unknown, query
   failure, auth required, partial, accepted/analysis unverified, or retry exhausted.
   Never display tokens, setup codes, identifiers or raw health values in logs.
10. Only after the actual device/target checks pass, follow the separate share-link
    handoff. Distribution configuration and remote activation need their own authority.

Authentication is separate from distribution. At run time the tester signs in to the Web/LINE app, requests a five-minute single-use Beta setup code, and pastes it into the Shortcut prompt. The Shortcut sends `{environment: "beta", claim: <code>}` to the manifest's `session_exchange_path`, then retains the returned session ID and access token only as private Shortcut variables for its bounded POST. The server stores only the token digest; the session is user-scoped, Beta-scoped, revocable, and expires after 24 hours. The iCloud share URL never contains a credential.

The health POST uses the manifest's `ingestion_path`, `Authorization: Bearer <session access token>`, and `x-shortcut-session-id: <session id>`. Its body is the existing `hdl-v2.connector-ingestion.v1` Apple Health envelope. Never put either session value in the shared Shortcut definition or in the share URL.

Expected distribution UI result, after an authorized valid link is configured: the
Web/LINE settings screen changes from **iPhone 健康同步捷徑準備中** to **加入健康同步捷徑**.
A real permission/API/HDL result belongs to Phase4B and must not be inferred from a
link, a manifest, or the local build-spec tests.

## Tester flow

1. Sign in to the Web/LINE beta and open **設定 → 健康資料連線**.
2. Choose **iPhone / iOS**, then **加入健康同步捷徑**.
3. Add **健康資料同步** in Shortcuts.
4. On first run, approve only the Apple Health read permissions shown.
5. Run the Shortcut and return to the Web app to inspect the sync result.

This tester flow is gated by the unfinished build/device checklist above; it is not
a request to the current user to perform those actions now.

## Non-device Gate coverage and still-required checks

The owned test suite checks manifest/auth-path preservation, exact five windows,
UTC/DST elapsed-time arithmetic, point/interval boundaries, no record mutation,
250/250/1 deterministic synthetic batching, empty/duplicate identity rejection and
absence of network/device/process-launch code. It does **not** execute ingestion.

Before release, existing handler/SQL tests still need to exercise actual setup-code
expiry/replay, session expiry/revocation, forged canonical IDs, unauthorized users,
batch limits, stale updates and partial-commit recovery for this Shortcut path.
The handler currently parses `sync_window_start/end`; this preparation does not add
server-side ordering, maximum lookback or record-containment enforcement. Offline
predicates must not be reported as deployed authorization or server validation.

`SHORTCUT_BUILD_SPEC = LOCAL_OFFLINE_PREPARED`; `IMPORTABLE_SHORTCUT = MISSING`;
`IOS_DEVICE_EXECUTION = NOT_RUN`; `REMOTE_INGESTION_VALIDATION = NOT_RUN`.
