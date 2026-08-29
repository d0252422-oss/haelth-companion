# Android Health Sync Companion (Friends & Family beta)

Thin companion only: secure canonical-user bootstrap, Health Connect read permission, bounded read, authenticated HDL v2 upload. It contains no primary dashboard and no production credential.

## Configuration

The debug artifact deliberately defaults to non-routable `https://beta.invalid`. A usable staging build must inject:

- `HEALTH_COMPANION_BETA_API_BASE_URL` — approved HTTPS staging origin.
- `HEALTH_COMPANION_BETA_APP_LINK_HOST` — verified staging App Link host.

No service-role key, account ID, access token or refresh token is a build setting. Sessions are established from a five-minute, one-time, installation-key-bound claim and encrypted with Android Keystore.

## Build

GitHub workflow `Android beta APK` uses JDK 17, Gradle 8.13, AGP 8.13.2 and official Health Connect `1.1.0`. It runs unit tests, produces a debug/development-signed APK and uploads it for seven days with a SHA-256 sidecar. It does not archive, publish, deploy or production-sign.

Health Connect requires an Android 9/API 28 or newer compatible Google Play device. Android 14+ includes Health Connect in the system; Android 13 and below require the Health Connect app.
