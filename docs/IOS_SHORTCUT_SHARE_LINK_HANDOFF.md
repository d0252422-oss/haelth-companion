# iOS Shortcut share-link handoff

This Shortcut distribution route does not require a native IPA, TestFlight build,
Mac, Xcode or Apple Developer membership. It does require an actual inspectable
Shortcut and iPhone validation. The native iOS build/device roadmap is a separate
Gate; this handoff does not clear it.

Current state: `OFFLINE_SPEC_ONLY_NOT_IMPORTABLE_SHORTCUT`. The manifest's Beta
address is configuration, not a fresh remote PASS; `share_url` intentionally stays
empty. Do not make a fake link or state that only link copying remains.

For a separately authorized owner session:

1. Complete the manual build and five-window checklist in
   `docs/IOS_SHORTCUT_TESTER_RUNBOOK.md`, using
   `config/ios-shortcut-tester.manifest.json` and the offline plan printed by
   `scripts/ios-shortcut-build-spec.cjs`. JSON metadata is not an Apple Shortcut
   action artifact. Inspect the action definition and record its version/hash.
2. With an authorized synthetic/test account, verify the existing one-time setup
   code exchange, user-scoped session, five read-only Health queries, stable retry
   payloads, bounded request handling and receipt/UI results. Preserve failures;
   do not substitute a local contract test for actual target or device evidence.
3. Remove runtime values and real-data examples from the shareable definition.
   Verify no setup code, session credential, canonical ID, health payload, email,
   service key, production target or hidden extra upload action is embedded.
4. In Shortcuts, open **Share → Copy iCloud Link**. Record the exact distribution
   URL and artifact version; independently inspect the shared artifact before use.
5. Only with authorization for that environment, set Beta `IOS_SHORTCUT_SHARE_URL`.
   Adding the URL does not authorize any other deployment or account operation.

Record actual measured duration, iOS/Shortcuts versions, bounded-HTTP capability and
device result; no estimate becomes evidence. Remaining gates are action build,
field/permission mapping, actual session/ingestion, bounded HTTP, then distribution.
No iPhone action, link publication, remote configuration or health upload is carried
out by the non-device preparation scripts.
