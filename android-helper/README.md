# Android Health Sync Companion (Friends & Family beta)

Thin companion only: secure canonical-user bootstrap, Health Connect read permission, bounded read, authenticated HDL v2 upload. It contains no primary dashboard and no production credential.

For Friends & Family Beta, the app uses Android Credential Manager to obtain a Google ID token and exchanges it with Supabase Auth for a user session. The same verified Google identity is linked server-side to the existing canonical Health Companion user. The user never creates, copies, or pastes a connection code. The legacy claim implementation remains source-compatible only as an explicit debug/recovery fallback and is not referenced by the normal app UI.

## Configuration

The debug artifact deliberately defaults to non-routable `https://beta.invalid`. A usable staging build must inject:

- `HEALTH_COMPANION_BETA_API_BASE_URL` — approved HTTPS staging origin.
- `HEALTH_COMPANION_BETA_AUTH_SETUP_URL` — approved HTTPS Beta login/setup entry.
- `HEALTH_COMPANION_BETA_APP_LINK_HOST` — verified staging App Link host.

No service-role key, account ID, access token or refresh token is a build setting. Supabase sessions are encrypted at rest with an Android Keystore AES-GCM key, restored/refreshed by the official client, and cleared on logout. Every ingestion request carries the current Supabase access token; the Edge Function validates it with Supabase Auth and resolves canonical ownership server-side.

Uploads are deterministically ordered and split at 100 records or 256 KiB of serialized UTF-8 JSON, whichever comes first. A single oversized record fails explicitly; 413/auth failures are never blindly retried, while 429/network/5xx retries are bounded to three attempts. A local plan fingerprint and next-batch checkpoint make partial upload recovery duplicate-safe.

## Build

GitHub workflow `Android beta APK` uses JDK 17, Gradle 8.13, AGP 8.13.2 and official Health Connect `1.1.0`. It runs unit tests, produces a debug/development-signed APK and uploads it for seven days with a SHA-256 sidecar. It does not archive, publish, deploy or production-sign.

Health Connect requires an Android 9/API 28 or newer compatible Google Play device. Android 14+ includes Health Connect in the system; Android 13 and below require the Health Connect app.
