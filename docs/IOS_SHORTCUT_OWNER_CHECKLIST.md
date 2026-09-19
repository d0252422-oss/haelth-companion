# iOS owner checklist — deferred

Do not use a phone now. After platform and connector target activation approval:

1. Verify the imported Shortcut's actions/hash and exact approved Beta endpoint.
2. Sign in/setup through the normal dedicated test-user flow; do not share secrets.
3. Review Health read permissions and the five query fields/windows from the build spec.
4. Run the gate cases: empty/partial data, bounded retry, duplicate/stale revisions,
   revoked session, A/B separation and SQL/Web read-back; save only sanitized evidence.

Actual HealthKit/Shortcuts availability, import/share link and real-device behavior
remain DEFERRED. Do not infer actual background automation from a manual Shortcut run.
