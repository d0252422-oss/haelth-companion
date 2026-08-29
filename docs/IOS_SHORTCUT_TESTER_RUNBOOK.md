# iPhone Apple Health Shortcut — tester setup

Beta path: `authenticated Web/LINE → 健康資料同步 Shortcut → Apple Health read-only query → authenticated staging ingestion → HDL v2`.

## One-time owner action (no code writing)

1. On an iPhone, create or import the Shortcut from `config/ios-shortcut-tester.manifest.json` using the prepared actions/fields.
2. Confirm its name is **健康資料同步**, it requests only the listed Apple Health read data, and its POST target is the approved HTTPS staging endpoint.
3. Run once with a staging test account. Confirm no long-lived token, service key, email, or production endpoint is embedded.
4. In Shortcuts, choose **Share → Copy iCloud Link**.
5. Put that HTTPS URL into the beta runtime configuration key `IOS_SHORTCUT_SHARE_URL`. Do not commit it as a credential; the share URL is distribution configuration.

Authentication is separate from distribution. At run time the tester signs in to the Web/LINE app, requests a five-minute single-use Beta setup code, and pastes it into the Shortcut prompt. The Shortcut sends `{environment: "beta", claim: <code>}` to the manifest's `session_exchange_path`, then retains the returned session ID and access token only as private Shortcut variables for its bounded POST. The server stores only the token digest; the session is user-scoped, Beta-scoped, revocable, and expires after 24 hours. The iCloud share URL never contains a credential.

The health POST uses the manifest's `ingestion_path`, `Authorization: Bearer <session access token>`, and `x-shortcut-session-id: <session id>`. Its body is the existing `hdl-v2.connector-ingestion.v1` Apple Health envelope. Never put either session value in the shared Shortcut definition or in the share URL.

Expected result: the Web/LINE settings screen changes from **iPhone 健康同步捷徑準備中** to **加入健康同步捷徑**. A real permission/API/HDL result belongs to Phase 4B and must not be inferred from the link alone.

## Tester flow

1. Sign in to the Web/LINE beta and open **設定 → 健康資料連線**.
2. Choose **iPhone / iOS**, then **加入健康同步捷徑**.
3. Add **健康資料同步** in Shortcuts.
4. On first run, approve only the Apple Health read permissions shown.
5. Run the Shortcut and return to the Web app to inspect the sync result.

Supported contract domains are steps, heart rate, resting heart rate, sleep/session stages, weight, workout, HRV and SpO2. Device availability remains real-device evidence; an unavailable domain is not a fabricated PASS.
