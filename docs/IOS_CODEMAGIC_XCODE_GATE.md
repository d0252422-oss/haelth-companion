# iOS Codemagic Xcode Gate

## Purpose

Codemagic is the project's Cloud Mac verification node. The `ios-xcode-gate`
workflow performs one bounded, unsigned Simulator gate:

1. verify Xcode 16.4 and the repository layout;
2. reuse XcodeGen when installed, or install it once with Homebrew;
3. generate `ios-helper/HealthSyncHelper.xcodeproj` from `project.yml`;
4. inspect the generated project and assert the app scheme and test target;
5. compile the app/test bundle and run the seven Swift XCTest cases in an
   available iPhone Simulator;
6. retain the project listing, result bundle, and Xcode activity logs.

The workflow has no automatic trigger, publishing block, signing credential,
archive, deployment, or production mutation. It must be started manually only
when an iOS source/project change has a specific Xcode verification reason.
Its hard duration limit is 30 minutes, below the 100-minute run budget.

## Canonical configuration

- Repository root: `$CM_BUILD_DIR`
- Helper path: `$CM_BUILD_DIR/ios-helper`
- XcodeGen spec: `ios-helper/project.yml`
- Generated project: `HealthSyncHelper.xcodeproj`
- Application/test scheme: `HealthSyncHelper`
- Unit-test target: `HealthSyncHelperTests`
- Deployment target: iOS 17.0
- Runner: `mac_mini_m2`
- Xcode: 16.4
- Signing: Simulator-only; no production signing configuration

## One-run procedure

1. Connect this Git repository to Codemagic without adding Apple signing
   credentials.
2. Select branch `feat/ios-healthkit-helper-beta` and workflow
   `ios-xcode-gate`.
3. Confirm the run reason is Xcode generation/build/test verification, then
   start exactly one build.
4. If XcodeGen or project inspection fails, stop at that failed script and use
   its retained output for a Windows-side fix before considering another run.
5. A passing Simulator run closes compilation/XCTest only. HealthKit runtime,
   signing, Universal Links, background delivery, and real-device acceptance
   remain separate Mac/iPhone gates.
