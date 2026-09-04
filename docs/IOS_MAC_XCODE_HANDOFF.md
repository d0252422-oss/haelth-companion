# iOS Mac/Xcode Handoff

Run these steps on a Mac with a current supported Xcode. Expected results are explicit so an operator can stop safely when reality differs.

1. **Install/open Xcode.** Install Xcode from Apple, launch it once, accept its license, then run `xcodebuild -version`. Expected: Xcode and build-version output; no account is needed merely to inspect source.
2. **Cloud Mac gate — completed.** Codemagic build `6a915c828a685d04485758f6` verified commit `de5bd0b`: XcodeGen, `HealthSyncHelper` scheme, `HealthSyncHelperTests` target, Simulator build, and 14/14 XCTest all passed. The retained artifact contains the project listing, `.xcactivitylog`, and `tests.xcresult`. Do not add production signing credentials to this verification workflow.
3. **Set Team and Bundle Identifier.** In Signing & Capabilities select the owner-approved Team and replace `tw.lifehelper.healthsync` only if that identifier is not registered. Expected: Xcode resolves a development provisioning profile; do not borrow an unrelated Team.
4. **Enable HealthKit.** Add HealthKit capability and enable Background Delivery. Expected: entitlements contain `com.apple.developer.healthkit` and `com.apple.developer.healthkit.background-delivery`; no HealthKit write permission is added.
5. **Verify entitlements.** Compare Xcode-generated entitlements with `Configuration/HealthSyncHelper.entitlements`. Expected: HealthKit and one approved `applinks:<host>` entry; placeholders are gone.
6. **Verify usage descriptions.** Confirm `NSHealthShareUsageDescription` explains Steps, Heart Rate and Sleep in Traditional Chinese. Expected: no `NSHealthUpdateUsageDescription`, because the helper performs no write.
7. **Resolve dependencies.** There are no runtime Swift packages. Expected: Xcode resolves only Apple frameworks. XcodeGen is not an app dependency.
8. **Configure backend environment.** Replace the placeholder `API_BASE_URL`, `WEB_BOOTSTRAP_URL`, and `UNIVERSAL_LINK_HOST` in an environment-specific plist/xcconfig excluded from secrets. Expected: HTTPS hosts only and no tokens/user IDs in files.
9. **Configure Universal Link.** Publish `https://<host>/.well-known/apple-app-site-association` with the exact Team ID + bundle ID and `/health-sync/bootstrap` path; enable Associated Domains. Expected: HTTPS 200, no redirect, correct JSON content type, and no claim/user data in the association file.
10. **Build.** Run `xcodebuild -project HealthSyncHelper.xcodeproj -scheme HealthSyncHelper -sdk iphonesimulator -configuration Debug build`. Expected: build succeeds after any Apple SDK concurrency/API corrections are resolved and reviewed.
11. **Run unit tests.** Run `xcodebuild test -project HealthSyncHelper.xcodeproj -scheme HealthSyncHelper -destination 'platform=iOS Simulator,name=iPhone 16'`. Expected: all mapping, claim parser, retry and API error tests pass. HealthKit data access is not considered verified in Simulator.
12. **Connect iPhone.** Enable Developer Mode if requested by iOS and trust the owner-approved Mac. Expected: the physical iPhone appears as a destination.
13. **Install app.** Build/run the Debug target on the iPhone. Expected: app opens to secure continuation, not a login/text form.
14. **Approve HealthKit.** Complete Web continuation, then approve Steps, Heart Rate and Sleep. Expected: Apple’s permission UI lists only those read types. Remember Apple does not disclose individual read denial to the app.
15. **Verify Steps.** With real existing data, execute initial sync and inspect sanitized server reconciliation. Expected: real step records, source metadata where available, and stable idempotency keys.
16. **Verify Heart Rate.** Repeat using real heart-rate data. Expected: BPM samples with timestamps/source; zero records is not permission PASS.
17. **Verify Sleep.** Repeat using a real cross-midnight session. Expected: stage intervals, duration, timezone and wake-date attribution.
18. **Verify backend upload.** Inspect server-safe request IDs/counts only. Expected: authenticated session user equals every payload canonical user; no token/raw claim in logs.
19. **Verify Supabase.** Run owner-approved read-only reconciliation. Expected: HDL v2 records belong only to the canonical user, unique keys prevent duplicates, RLS/anon grants remain safe.
20. **Verify Web display.** Reload the authenticated Web/LINE surface. Expected: the same canonical user sees new health data; another account cannot.
21. **Configure release signing.** Use the approved distribution certificate/profile and confirm Associated Domain/HealthKit capabilities survive Archive. Expected: archive validation passes; do not commit signing secrets.
22. **Prepare TestFlight.** Increment version/build, archive, validate, and upload only after separate release authorization. Expected: build enters App Store Connect processing; this document does not authorize submission or production cutover.

`CLOUD_MAC_XCODE_GATE = PASS`. Physical-device HealthKit, signing, Universal
Links, background delivery, backend visibility, and cross-user acceptance still
require steps 3–20 on an approved Mac/iPhone environment.
