# iOS Pre-Xcode Static Review

Date: 2026-08-27  
Scope: Windows source/static inspection only; no compiler or HealthKit runtime claim.

## HIGH_CONFIDENCE_CODE_ISSUE

| Finding | Resolution |
|---|---|
| App entry used `try!` for configuration and HealthKit reader assembly, so an unconfigured Beta could crash before showing a safe state. | Fixed. App assembly now returns a result and renders a non-technical configuration error without choosing a fallback server/user/credential. |
| `HKDeletedObject` identifiers were read but discarded, so source deletion could never invalidate canonical/derived state. | Fixed for records known to the protected source-version store. Deletions become versioned tombstone mutations; the server never hard-deletes and creates a pending derived-recompute event. Unknown deletions fail closed. |
| Content changes for the same HealthKit UUID previously produced another content fingerprint without an explicit source revision, allowing duplicate canonical interpretation. | Fixed. The protected version store remembers content-hash→revision history. Identical replay keeps its revision, modified content advances it, and an out-of-order previously seen hash retains its older revision for server rejection. |
| Runtime route source was not registered in an executable HTTP handler. | Fixed for Windows/local runtime: claim creation/exchange, authenticated ingestion and revocation are registered and covered by HTTP integration tests. Production persistence/deployment adapter remains intentionally unimplemented. |

## LIKELY_XCODE_WARNING

| Area | Static assessment / Mac action |
|---|---|
| Swift 6 concurrency | HealthKit callbacks cross non-Sendable Apple classes. `AnchoredSamples` and HealthKit service wrappers use narrowly scoped `@unchecked Sendable`; Xcode strict-concurrency diagnostics must confirm no callback race. |
| Background callback state | `BackgroundHealthSync` is `@unchecked Sendable` and owns observer arrays/retry state. Mac review should consider isolating it to an actor or MainActor if Xcode reports captured mutable-state warnings. |
| XCTest URL protocol stub | Static mutable test handler is marked `nonisolated(unsafe)` and restricted to tests. Confirm tests are not parallelized against this shared stub. |
| Foundation date encoding | App DTO dates use ISO-8601 while idempotency uses fractional-second UTC strings. Run Swift↔backend golden-vector tests on Mac before Beta. |

## MAC_VERIFICATION_REQUIRED

- XcodeGen 2.43.0 project generation and Swift 6 compilation.
- HealthKit symbols, anchored query callbacks, deletion UUID behavior and sleep-stage availability on the selected SDK/deployment target.
- HealthKit read permission behavior; Apple does not reveal individual read denial.
- Keychain P-256 SPKI export/signature compatibility with the backend verifier.
- Associated Domain/AASA Team ID, bundle ID, HTTPS host and CDN verification.
- HealthKit background-delivery entitlement, observer completion timing and BGProcessingTask registration.
- File-protection behavior before/after first unlock and following reboot.
- Real source update/deletion ordering after reinstall. The local version map deliberately refuses unknown tombstones; a bounded server lookup policy must be validated before broad Beta.
- App signing, provisioning, iPhone installation and real Steps/Heart Rate/Sleep records.

## NO_FINDING

- No SwiftUI typed input controls.
- No HealthKit write permission or unrelated read type.
- No embedded default user, server token, claim, client secret or service-role credential.
- Universal Link claim parser requires HTTPS, exact host/path and fragment; query-carried claim is rejected.
- Keychain uses `AfterFirstUnlockThisDeviceOnly`; pending health queue uses protected files excluded from backup.
- Checkpoint advances only after every mutation is accepted or reported duplicate.
- Source deletion is a tombstone/invalidation, not a hard delete.
- Runtime errors return stable codes without request body, token, claim or health-payload logging.

`IOS_PRE_XCODE_STATIC_REVIEW = PASS_WITH_MAC_VERIFICATION_ITEMS`

