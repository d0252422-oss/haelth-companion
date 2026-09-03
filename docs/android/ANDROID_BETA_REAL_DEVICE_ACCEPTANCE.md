# Android Beta real-device acceptance

## Verified beta.6 evidence — 2026-09-03

- APK: `0.1.0-beta.6-debug` (`a96b5eff16a287027e287680cf5530497b03fe4730e9805cd88bb83344fc4da0`).
- Google sign-in: PASS on a real Android device.
- Supabase session: PASS indirectly through authenticated, user-scoped ingestion.
- Health Connect permission and read: PASS on a real Android device.
- Foreground recent-data sync: PASS; a terminal state was reached at 2026-09-03 02:58 Asia/Taipei.
- Infinite-spinner fix: PASS on a real Android device.
- Background automatic sync: NOT YET VERIFIED on a real device.
- Score update after that sync: PENDING VERIFICATION; ingestion success is not score-completion evidence.

These results apply only to the tested device and dataset. Samsung, Xiaomi, Pixel, other OEM scheduling behavior, other wearable sources, and materially different dataset sizes remain unverified.

## Friends-and-family device matrix

| Android | Manufacturer | Health Connect | Wearable source | Steps | Heart rate | Sleep | Foreground | Background | Score |
|---|---|---|---|---|---|---|---|---|---|
| ACTUAL DEVICE (redacted) | UNKNOWN | PASS | UNKNOWN | EVIDENCE RECEIVED | EVIDENCE RECEIVED | EVIDENCE RECEIVED | PASS | PENDING | PENDING |

Background sync is best-effort Android OS scheduling, not real-time execution or a permanent background service. Testers do not need to sign in, reauthorize, or press Sync every day unless the session or permission has been revoked.

For the regression retest, install `0.1.0-beta.8-debug` directly over the current beta.7 without clearing app data. Its SHA-256 is `1b2c4b2629c70c73db6f35462d2d790170918ea249bab85f828e5d9747f2edd7`; its debug signing SHA-1 remains `D1:A7:F6:7A:C2:F5:2B:EF:06:DF:B3:E4:D5:8A:56:47:DF:53:34:65`.

Beta.7 was packaged locally without the required public Beta runtime configuration. That made both encrypted-session restore and the Google login fallback fail before any network request. Beta.8 adds a fail-closed packaging check and restores beta.6's unscoped sync metadata only after the encrypted session and canonical user have been resolved. The migration never reads or clears the separate authentication store.

1. Uninstall the older debug APK if its application ID or signing certificate differs; otherwise install the update normally.
2. Open **生活小助手**.
3. Tap **使用 Google 帳號登入** and choose the same Google account used by Health Companion Web.
4. Tap **允許 Health Connect** if prompted.
5. In the official Android permission screen, approve the health domains you are comfortable sharing.
6. Wait for automatic first sync.

Expected outcomes:

- No connection code, copy/paste, token, endpoint, or account-ID field appears.
- The app must leave the loading state within 120 seconds. Expected terminal text is recent-data success, partial/background continuation, explicit timeout/background continuation, or no-data; an endless spinner is a failure.
- Approve the additional Health Connect background-read permission when Android presents it. No reinstall, logout, OAuth repeat, ADB, token, or connection code is required.
- Reopening the app restores the authenticated session without another login unless the session was revoked.

Capture only these non-sensitive evidence items:

- Google account chooser shown (email may be redacted).
- Health Connect permission screen with selected domains.
- Final app state and last-sync timestamp.
- Beta Web score/status result after refresh.

Do not capture tokens, raw health payloads, connection claims, or Supabase credentials.
