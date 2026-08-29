# iOS Shortcut share-link handoff

No Mac, Xcode, Apple Developer membership, IPA, or TestFlight is required.

1. On the iPhone, create/import the Shortcut described by `config/ios-shortcut-tester.manifest.json` and `docs/IOS_SHORTCUT_TESTER_RUNBOOK.md`.
2. Run it once with the non-production Beta endpoint and a newly issued one-time setup code. Confirm the Shortcut asks only for the listed Apple Health read permissions and shows a safe success/error result.
3. In Shortcuts, open **Share → Copy iCloud Link**.
4. Put that exact URL into the Beta `IOS_SHORTCUT_SHARE_URL` configuration. Never put a setup code, session credential, user identifier, or health payload in the share URL.

Expected duration must be measured by the human; no estimate is recorded as evidence. This is the only iPhone-only distribution step after a real Beta HTTPS endpoint exists.
