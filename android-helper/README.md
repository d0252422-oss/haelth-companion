# Android Health Sync Companion (Friends & Family beta)

Thin companion only: secure canonical-user bootstrap, Health Connect read permission, bounded read, authenticated HDL v2 upload. It contains no primary dashboard and no production credential.

For Friends & Family Beta, the app opens the existing authenticated Beta Web entry in the system browser. After login, the server creates a five-minute, single-use claim already bound to the Android Keystore installation key and returns it through the app callback. The user never copies or pastes a code. The legacy one-time-code endpoint remains available only for explicit debug diagnostics and is not shown in the external-beta app UI.

## Configuration

The debug artifact deliberately defaults to non-routable `https://beta.invalid`. A usable staging build must inject:

- `HEALTH_COMPANION_BETA_API_BASE_URL` — approved HTTPS staging origin.
- `HEALTH_COMPANION_BETA_AUTH_SETUP_URL` — approved HTTPS Beta login/setup entry.
- `HEALTH_COMPANION_BETA_APP_LINK_HOST` — verified staging App Link host.

No service-role key, account ID, access token or refresh token is a build setting. Sessions are established from a five-minute, one-time, installation-key-bound browser continuation, encrypted with Android Keystore, rotated with a device signature and revoked on logout.

Uploads are deterministically ordered and split at 100 records or 256 KiB of serialized UTF-8 JSON, whichever comes first. A single oversized record fails explicitly; 413/auth failures are never blindly retried, while 429/network/5xx retries are bounded to three attempts. A local plan fingerprint and next-batch checkpoint make partial upload recovery duplicate-safe.

## Build

GitHub workflow `Android beta APK` uses JDK 17, Gradle 8.13, AGP 8.13.2 and official Health Connect `1.1.0`. It runs unit tests, produces a debug/development-signed APK and uploads it for seven days with a SHA-256 sidecar. It does not archive, publish, deploy or production-sign.

Health Connect requires an Android 9/API 28 or newer compatible Google Play device. Android 14+ includes Health Connect in the system; Android 13 and below require the Health Connect app.
