# iOS Real-Device HealthKit Runbook

## Required environment

- **Mac:** Apple-supported macOS capable of running Xcode 16.4 or a newer
  project-compatible Xcode.
- **iPhone:** Physical iPhone on iOS 17 or later, Developer Mode enabled, with
  real Steps, Heart Rate, and Sleep records available in Apple Health.
- **Apple account:** Owner-approved Apple Developer development team. Account
  login, 2FA, device registration, and certificate/profile changes are human actions.
- **Project:** `ios-helper/HealthSyncHelper.xcodeproj`, generated from
  `ios-helper/project.yml`; scheme `HealthSyncHelper`.
- **Bundle ID:** `tw.lifehelper.healthsync`, or an owner-approved registered
  replacement configured consistently in the project and AASA file.
- **Capabilities:** HealthKit with Background Delivery; Background Modes needed
  by the implementation; Associated Domains for the approved HTTPS host.
- **Entitlements:** `com.apple.developer.healthkit`, HealthKit background
  delivery, and the exact `applinks:<host>` value. No HealthKit write access.
- **Signing:** Development signing only for this gate. Production signing,
  archive distribution, TestFlight, and App Store upload are not authorized.

## Minimal human path to ready state

1. On the approved Mac, fetch branch `feat/ios-healthkit-helper-beta` and verify
   the expected commit from the handoff.
2. Run `cd ios-helper && xcodegen generate --spec project.yml` and open
   `HealthSyncHelper.xcodeproj` in Xcode.
3. Select the approved development Team and registered Bundle Identifier.
4. Confirm HealthKit, Background Delivery, Background Modes, and Associated
   Domains match the requirements above; resolve placeholders only with the
   owner-approved Beta host.
5. Connect the physical iPhone, enable Developer Mode/trust when iOS requests
   it, select the device, and run the Debug build.
6. From the authenticated Beta Web/LINE session, start the secure continuation;
   approve only Steps, Heart Rate, and Sleep reads.
7. Execute IOS-RD-A through IOS-RD-M in
   `IOS_REAL_DEVICE_ACCEPTANCE_TEST.md`, collecting sanitized JSON evidence.
8. Validate locally with:
   `node scripts/ios-real-device-evidence.cjs <evidence.json>`.

Expected ready result: the helper is installed under development signing, the
verified continuation reaches the same canonical user, the HealthKit permission
sheet is available, and no production system or credential was changed.

## Evidence and cleanup

- Store only sanitized evidence outside Git unless explicitly approved.
- Use hashes/opaque request IDs for user, session, source record, and canonical
  record references. Do not store email, token, claim, Apple credential, or raw
  sensitive health payload.
- Revoke the development app session and remove the Debug app after acceptance
  if the test device should not remain connected.
- Do not remove real Apple Health records as cleanup. Any isolated Beta rows are
  handled only under the environment's approved retention procedure.

`READY_TO_RUN_REAL_DEVICE_TEST = NO` until the approved Mac/iPhone, development
team, registered Bundle ID, Beta backend configuration, and real Health records
are all available.
