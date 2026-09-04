# iOS HealthKit Helper Architecture

## Decision

The helper is a near-invisible sync companion, not another product UI:

`LINE / Web authenticated session → one-time install claim → verified Universal Link → iOS app session → HealthKit → authenticated ingestion → HDL v2 → Supabase/PostgreSQL → analytics/Web`

`USER_TYPED_INPUT_COUNT = 0`. There are no email, password, user ID, pairing code, token, server, database, device, or wearable fields.

## Identity bootstrap

1. The helper generates a non-exportable P-256 private key in Keychain and exposes only its SPKI public key fingerprint.
2. On first launch, the user makes one safe continuation tap. Safari opens the existing authenticated Web bootstrap URL with the public fingerprint (not a credential).
3. The trusted backend derives `canonical_user_id` from the verified Web session. It creates a cryptographically random claim with a maximum five-minute TTL and stores only its SHA-256 digest, the canonical user, platform, and installation-key fingerprint.
4. The backend redirects to `https://<verified-host>/health-sync/bootstrap#claim=<opaque-one-time-value>`.
5. The Associated Domain/Universal Link routes to the helper. The app rejects HTTP, wrong host/path, query-carried claims, short/malformed claims, then signs the claim using the installation private key.
6. The backend atomically validates digest, TTL, unconsumed/unrevoked state, key fingerprint and signature; it marks the claim consumed before issuing scoped access/refresh credentials.
7. The app stores the session in Keychain (`AfterFirstUnlockThisDeviceOnly`). Every upload user ID must match the session, and the server independently enforces the same binding.

This flow never assumes that an installed app can read browser cookies, identify who downloaded it, or inherit a token from the installer. `ZERO_INPUT_IDENTITY = IMPLEMENTED_SOURCE`; `ZERO_EXTRA_TAP = OS_CONSTRAINED`.

## HealthKit and mapping

Read permissions are limited to `stepCount`, `heartRate`, and `sleepAnalysis`. No write type is requested. Apple deliberately prevents an app from learning whether individual read permissions were denied; completion of the authorization request is not represented as per-domain PASS. Real records must be confirmed on an iPhone.

Anchored queries retain source UUIDs and changes per domain. Each mapped record uses the shared `hdl-v2.health-ingestion.v1` envelope. Heart rate is normalized to `bpm`, Steps to `count`, and each sleep stage interval to minutes plus a canonical stage. Sleep `local_date` is the end/wake date. Source bundle ID and available HKDevice manufacturer/model/version fields are retained; unavailable device metadata remains null.

Idempotency uses SHA-256 over a versioned canonical tuple scoped by canonical user, iOS platform, domain, source app, source record UUID, timestamps, normalized value/unit, and stage. A source update produces a new fingerprint; exact replay does not. The backend still owns the unique constraint and duplicate result.

## Sync lifecycle

`permission request → anchored read → map → protected local queue → authenticated upload → accept/deduplicate → remove queue items → advance anchor`

The anchor advances only after every record is accepted or reported duplicate. A crash after upload but before anchor persistence safely replays the same idempotency keys. Pending payloads use iOS complete-file-protection-until-first-authentication and are excluded from backup. Session credentials use Keychain, never the queue or configuration.

Observer queries and HealthKit background delivery request best-effort wakeups. `BGProcessingTask` adds a network-constrained fallback with exponential backoff. iOS scheduling is not exact or real-time. Background capability, delivery frequency, app termination behavior and protected-file access require Mac/iPhone verification.

## Server contract and database preparation

- `POST /v1/mobile/install-claims/exchange`
- `POST /v1/health/ingestion/batches`
- private tables `mobile_install_claims` and `mobile_app_sessions` store only credential digests.
- neither `anon` nor `authenticated` receives table access; only trusted server code may access them.
- the Web session must resolve through the existing canonical identity map; the helper must not create a second account database.

The local migration is prepared but has not been applied to production.

## Unverified boundaries

- Actual backend endpoints are contract/source preparation only and are not deployed.
- Universal Link requires a real HTTPS domain, `apple-app-site-association`, Team ID and signed bundle identifier.
- HealthKit capability, entitlement, permission sheet, anchored query behavior, background delivery, Keychain and real upload require Xcode/iPhone.
- No synthetic record may close the real-device gate.
- Google Health remains deferred and is not a dependency.

