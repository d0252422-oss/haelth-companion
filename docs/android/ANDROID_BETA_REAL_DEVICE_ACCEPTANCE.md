# Android Beta real-device acceptance

Use the prepared `0.1.0-beta.4-debug` APK only after its SHA-256 and OAuth signing certificate match the release metadata. The locally prepared development artifact currently has SHA-256 `5e68bc543015c988593fcd059febe9c2dd256ceb138c83c77498ebc47c04ab17`; do not substitute the older `beta.3` APK for this gate.

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
