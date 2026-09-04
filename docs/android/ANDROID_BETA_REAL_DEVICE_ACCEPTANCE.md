# Android Beta real-device acceptance

## Verified runtime evidence — 2026-09-03

- APK: `0.1.0-beta.6-debug` (`a96b5eff16a287027e287680cf5530497b03fe4730e9805cd88bb83344fc4da0`).
- Google sign-in: PASS on a real Android device.
- Supabase session: PASS indirectly through authenticated, user-scoped ingestion.
- Health Connect permission and read: PASS on a real Android device.
- Foreground recent-data sync: PASS; a terminal state was reached at 2026-09-03 02:58 Asia/Taipei.
- Infinite-spinner fix: PASS on a real Android device.
- Beta.9 background automatic sync: PASS on the tested real device; the Beta connector reported `SYNCED` and the database received current records.
- Beta.9 score update: PASS server-side; the latest stored score date is 2026-09-03. Web visibility remains gated by the canonical identity bridge until the existing Web session is verified once.

These results apply only to the tested device and dataset. Samsung, Xiaomi, Pixel, other OEM scheduling behavior, other wearable sources, and materially different dataset sizes remain unverified.

## Friends-and-family device matrix

| Android | Manufacturer | Health Connect | Wearable source | Steps | Heart rate | Sleep | Foreground | Background | Score |
|---|---|---|---|---|---|---|---|---|---|
| ACTUAL DEVICE (redacted) | UNKNOWN | PASS | UNKNOWN | EVIDENCE RECEIVED | EVIDENCE RECEIVED | EVIDENCE RECEIVED | PASS | PASS | PASS_SERVER |

Background sync is best-effort Android OS scheduling, not real-time execution or a permanent background service. Testers do not need to sign in, reauthorize, or press Sync every day unless the session or permission has been revoked.

Beta.10 failed its real-device recovery gate: the UI remained `SYNCING` for more than five minutes while the server received a valid session request but no health ingestion. Install `0.1.0-beta.11-debug` directly over beta.10 without clearing app data. Its SHA-256 is `e3e992d700f0674bdc41499d1e2eb88070c19861dd5032ac31b9c15c9023f739`; its debug signing SHA-1 remains `D1:A7:F6:7A:C2:F5:2B:EF:06:DF:B3:E4:D5:8A:56:47:DF:53:34:65`.

Beta.7 was packaged locally without the required public Beta runtime configuration. That made both encrypted-session restore and the Google login fallback fail before any network request. Beta.8 adds a fail-closed packaging check and restores beta.6's unscoped sync metadata only after the encrypted session and canonical user have been resolved. The migration never reads or clears the separate authentication store.

1. Install beta.11 over the current beta.10. Do not clear app data and do not uninstall.
2. Open **生活小助手**; the existing session and Health Connect authorization should remain available.
3. Confirm the beta-only diagnostic says `Beta 0.1.0-beta.11-debug`; the stale prior **同步中** state must become `ENQUEUED`, `WAITING_FOR_CONSTRAINT`, `RUNNING`, or `RETRY_PENDING` according to WorkManager rather than remaining falsely stuck.
4. Leave the app without pressing **立即同步**.
5. After Health Connect or the wearable has new data and Android has had a reasonable scheduling opportunity, reopen the app or Beta Web and check whether the last-background-sync time, data, and final score changed.

Expected outcomes:

- No connection code, copy/paste, token, endpoint, or account-ID field appears.
- Startup must not wait for all upload batches. Activity recreation and leaving the app must not cancel the WorkManager-owned sync.
- `RETRY_PENDING` should read as automatic background retry; manual action is offered only after retries are exhausted.
- Approve the additional Health Connect background-read permission when Android presents it. No reinstall, logout, OAuth repeat, ADB, token, or connection code is required.
- Reopening the app restores the authenticated session without another login unless the session was revoked.

Capture only these non-sensitive evidence items:

- Google account chooser shown (email may be redacted).
- Health Connect permission screen with selected domains.
- Final app state and last-sync timestamp.
- Beta Web score/status result after refresh.

Do not capture tokens, raw health payloads, connection claims, or Supabase credentials.
