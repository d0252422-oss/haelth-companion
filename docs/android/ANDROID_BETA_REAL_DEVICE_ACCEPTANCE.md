# Android Beta real-device acceptance

Use the newly published `0.1.0-beta.4` APK only after its SHA-256 and OAuth signing certificate match the release metadata. The locally prepared development artifact currently has SHA-256 `ac21e7eddf8fc8ed52670413cf0245b8edf9f45b08da2a8ac377683aec9cb0a5`; do not substitute the older `beta.3` APK for this gate.

1. Uninstall the older debug APK if its application ID or signing certificate differs; otherwise install the update normally.
2. Open **生活小助手**.
3. Tap **使用 Google 帳號登入** and choose the same Google account used by Health Companion Web.
4. Tap **允許 Health Connect** if prompted.
5. In the official Android permission screen, approve the health domains you are comfortable sharing.
6. Wait for automatic first sync.

Expected outcomes:

- No connection code, copy/paste, token, endpoint, or account-ID field appears.
- The app displays either **健康資料已連接 / 同步完成 / 健康分析已更新** or an explicit **目前沒有可同步的健康資料** state.
- Reopening the app restores the authenticated session without another login unless the session was revoked.

Capture only these non-sensitive evidence items:

- Google account chooser shown (email may be redacted).
- Health Connect permission screen with selected domains.
- Final app state and last-sync timestamp.
- Beta Web score/status result after refresh.

Do not capture tokens, raw health payloads, connection claims, or Supabase credentials.
