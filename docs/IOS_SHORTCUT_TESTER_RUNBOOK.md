# iPhone Apple Health Shortcut — tester setup

Beta path: `authenticated Web/LINE → 健康資料同步 Shortcut → Apple Health read-only query → authenticated staging ingestion → HDL v2`.

## One-time owner action (no code writing)

1. On an iPhone, create or import the Shortcut from `config/ios-shortcut-tester.manifest.json` using the prepared actions/fields.
2. Confirm its name is **健康資料同步**, it requests only the listed Apple Health read data, and its POST target is the approved HTTPS staging endpoint.
3. Run once with a staging test account. Confirm no long-lived token, service key, email, or production endpoint is embedded.
4. In Shortcuts, choose **Share → Copy iCloud Link**.
5. Put that HTTPS URL into the beta runtime configuration key `IOS_SHORTCUT_SHARE_URL`. Do not commit it as a credential; the share URL is distribution configuration.

Authentication is separate from distribution. At run time the tester signs in to the Web/LINE app, requests a five-minute single-use Beta setup code, and pastes it into the Shortcut prompt. The code is exchanged server-side for a user- and environment-scoped session; the iCloud share URL never contains a credential.

Expected result: the Web/LINE settings screen changes from **iPhone 健康同步捷徑準備中** to **加入健康同步捷徑**. A real permission/API/HDL result belongs to Phase 4B and must not be inferred from the link alone.

## Tester flow

1. Sign in to the Web/LINE beta and open **設定 → 健康資料連線**.
2. Choose **iPhone / iOS**, then **加入健康同步捷徑**.
3. Add **健康資料同步** in Shortcuts.
4. On first run, approve only the Apple Health read permissions shown.
5. Run the Shortcut and return to the Web app to inspect the sync result.

Supported contract domains are steps, heart rate, resting heart rate, sleep/session stages, weight, workout, HRV and SpO2. Device availability remains real-device evidence; an unavailable domain is not a fabricated PASS.
