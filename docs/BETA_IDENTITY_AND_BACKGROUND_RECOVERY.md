# Beta canonical identity and background-work recovery

## Canonical identity contract

The Beta Web and native Android clients now converge through a single trusted-server contract. Android presents a Supabase Auth session backed by Google; Web presents the existing Apps Script session. The Edge runtime independently verifies each credential and hashes the normalized, verified email before calling a service-role-only resolver. No client supplies a canonical user ID or trusted email.

`private.beta_web_identity_aliases` maps the verified Web subject hash to the Google-backed canonical owner already recorded in `private.beta_native_auth_identities`. Raw email is not stored. Ambiguous matches, changed email evidence and invalid identities fail closed. The empty legacy canonical slot is preserved for audit; no health, score or connector row is moved or deleted.

The three authenticated Web read routes and legacy claim issuance all use this resolver. The first successful Web request after deployment creates or refreshes the alias. Until an existing Web session is verified, the database intentionally has no alias and runtime Web visibility must remain unclaimed.

## Background-work recovery contract

The Android UI no longer treats a previously persisted `SYNCING` string as authoritative. It records the unique WorkManager ID, enqueue/start/progress/terminal timestamps, stage and request count, then reconciles those values with WorkManager at authenticated startup.

- Active recent work is retained.
- Missing or terminal work is enqueued with the existing checkpoint.
- Running work with no progress beyond the bounded deadline is marked `STALE_RECOVERED` and atomically replaced.
- Network-constrained queued work is retained and does not become a cancellation loop.
- Health reads, uploads and total work each have explicit timeouts; retries remain bounded and user-scoped.

No token, email or raw health value is stored in the recovery metadata. Beta.10 changes only recovery/observability and preserves beta.9 OAuth, canonical binding, Health Connect reads, batching, replay idempotency and score behavior.

## Current evidence

- Beta project: `uavimjgccigpbwqmfkhh`; production target guard passed before migration and Edge deployment.
- Before alias activation: 2 canonical slots, 1 native Google mapping, 35,616 health rows, 256 score rows, latest health/sleep/score date 2026-09-03.
- The resolver transaction test selected the existing native canonical owner and rolled back without persisting a test alias.
- Web/native identity convergence and score visibility have passed the real Beta runtime gate.
- Android beta.10 failed its real-device worker-state gate: it showed `SYNCING` for more than five minutes without a health-ingestion request.
- Android beta.11 compile, lint, 57 unit tests, debug APK assembly, and CI passed. Its WorkInfo-based state reconciliation and direct-over-beta.10 upgrade still require explicit real-device verification; automated evidence is not labeled as real-device PASS.
