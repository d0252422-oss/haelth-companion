# Android Connector V2 — Beta gate evidence

## Product flow

The external Beta path is now:

`Install APK → Login in system browser → return to APK → Health Connect permission → automatic first sync → health-score-v1.0`

The normal APK contains no account ID, endpoint, JWT, or one-time-code text field. The existing manual claim endpoint remains a debug-only server capability and is hidden by default on the Beta Web entry.

## Identity and session

- The APK creates a P-256 installation key in Android Keystore.
- The system-browser setup request contains only its SHA-256 public-key fingerprint and a fixed app callback URI.
- The authenticated Beta Web session requests a five-minute, one-time, Beta-scoped claim already bound to that fingerprint.
- The APK proves possession of the private key during exchange.
- The backend derives the canonical user from the verified Web session; client-supplied user IDs are checked, never trusted.
- Access/refresh credentials are stored AES-GCM encrypted using an Android Keystore key.
- Refresh is signed by the installation key, rotates both credentials, and logout revokes the server session before local credentials are discarded (local discard is fail-closed even when offline).

The custom app callback is not the trust boundary: interception of the short-lived claim does not permit exchange without the pre-bound installation private key. A verified HTTPS App Link remains the later production continuation improvement.

## HTTP 413 correction

Root cause was the previous Android client serializing every record from the bounded 30-day Health Connect read into one request. The Edge runtime rejects bodies over its local 1 MiB application bound. High-volume heart-rate samples can dominate, but the real-device payload was not retained, so the largest domain remains unverified.

V2 orders records deterministically and sends batches capped at both:

- 100 canonical mutations; and
- 256 KiB serialized UTF-8 JSON.

No record is dropped or aggregated. A single record over the byte cap produces a sanitized controlled error identified only by domain and hashed source identity. HTTP 413 and authentication failures are not retried. Network, 429, and 5xx failures use at most three attempts. A plan fingerprint plus next-batch checkpoint resumes after partial failure; canonical idempotency makes replay safe.

## Validation evidence

- Android JVM tests: 11 passed.
- Android debug Beta compile/assemble: passed with API and auth setup URLs injected.
- Node repository suite: 135 passed.
- Python suite: 75 passed; Ruff and mypy passed.
- Deno Edge type-check: passed.
- Beta-only live ingestion/create/replay/cross-user/score smoke: passed.
- Beta-only live session refresh/authorization/logout/revocation smoke: passed.
- Score formula remains `health-score-v1.0`; no formula or golden fixture changed.

Real-device retest remains required. Automated evidence does not establish a physical-device PASS.
