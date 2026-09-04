# iOS Health Sync Helper

This directory contains the Windows-prepared source foundation for the thin iOS HealthKit companion. The primary product remains the LINE MINI App / Web App. The helper has no account form, profile, dashboard, nutrition, payment, chat, or typed configuration UI.

## Implemented source boundary

- SwiftUI state-only UI: setup, permission, syncing, success, error.
- Zero-typed-input web bootstrap using an HTTPS Universal Link fragment containing a short-lived, one-time opaque claim.
- Installation-bound P-256 key generated in Keychain; the claim exchange is signed and receives a scoped app session stored in Keychain.
- HealthKit read-only authorization for Steps, Heart Rate, and Sleep only.
- Anchored incremental reads, source/device metadata mapping, wake-date sleep attribution, deterministic HDL v2 idempotency keys, local protected queue, checkpoints, retries, observer queries, and best-effort background processing.
- Authenticated batch ingestion with a client-side cross-user guard. The backend remains authoritative and must derive/validate the canonical user from the session.

No third-party runtime library is used. `project.yml` is a pinned XcodeGen 2.43.0 project specification for later Mac generation; XcodeGen is a development-only generator and is not linked into the app.

## Security boundary

Direct App Store/install handoff does not transfer browser cookies or the original download context into the installed app. First launch therefore presents one non-text action, **Continue Secure Setup**, which opens the authenticated Web session. The server binds the app-generated installation-key fingerprint to one canonical user and returns through a verified Universal Link. The opaque install claim is carried in the URL fragment, never a query parameter, contains no user/health data, expires after five minutes, and is consumed once.

The source intentionally contains placeholder HTTPS host values. It fails closed until the actual API host, Associated Domain, Team, bundle ID, and signing configuration are supplied on Mac. Never replace these with embedded tokens or user identifiers.

## Windows status

Swift and Xcode are not installed and are not supported for iOS build/runtime validation on this Windows host. Node contract tests under `tests/ios-healthkit-helper-contract.test.cjs` validate the shared backend/mapping/security semantics. Swift XCTest sources are included for Mac execution.

