# Conditional authorization draft — NOT READY FOR EXECUTION

## Precision package — 2026-09-17 (supersedes unspecific revisions below)

Candidate Edge and Web source: `d7a00d527d7486ccbfadfaec5225b3fa604600db`.
Offline AB artifact: `D:/Dev/Evidence/health-critical-20260917-065444/forward-candidate`.
Artifact manifest SHA256:
`6ba88dd5320a35a72c52c6524ea01bc811136be749a0caacd00aababd4a1bc4c`.
All56 file hashes verified; this is NOT old deployed v14 or a tested remote build.
Exact migration/grant hashes: `authorization-artifacts.json` in that evidence run.

Target function `mobile-health-beta` on `uavimjgccigpbwqmfkhh` only; Beta frontend
`d0252422-oss/health-companion-beta`, main root, existing Pages entry. Reverify
org/region/host/function/frontend identity immediately before future execution.
Source pin does not authorize general pushes or other branches/repositories.

The only proposed schema versions, in order, are:
`20260912032458`, `20260912041126`, `20260912182042`, `20260913041844`,
`20260913164024`, `20260913164026`, `20260913180000`, `20260913190152`,
`20260916144345`, `20260916215632`.
Apply only missing versions after schema/history review, exact hash match and safe
rehearsal. If already applied, do not reapply. No destructive statements authorized.

Required backend settings to authorize individually (values never in this file):
`HEALTH_MANUAL_SQL_HOSTED_ENABLED`, `HEALTH_MANUAL_RELEASE`,
`HEALTH_MANUAL_ALLOWED_ORIGIN`, `HEALTH_MANUAL_EXPECTED_PROJECT_REF`,
`HEALTH_MANUAL_EXPECTED_DB_HOST`, `HEALTH_MANUAL_DATABASE_URL`,
`HEALTH_BACKGROUND_SQL_ENABLED`, `HEALTH_NATIVE_DATABASE_URL`,
`HEALTH_RECOMPUTE_DATABASE_URL`, `HEALTH_RECOMPUTE_TRIGGER_SECRET`.
Existing `BETA_WEB_AUTH_VERIFY_URL`: validate; changing it needs separate review.
Credential roles/grants/rotation: BETA_REMOTE_CREDENTIAL_REQUIREMENTS.md.

These are proposed operations, not an authorization currently granted. Enablement
is still WITHHELD: vendor security-patch evidence/focused parity/actualCLI and safe
rollback not complete. A/B runbook is ready for future Owner use, not OAuth PASS.
Changing frontend flags from the current OFF candidate requires a separate hashed
config overlay with the verified Beta API/origin, reviewed before deployment; do
not call the OFF artifact an already-enabled SQL-first build.

Target only uavimjgccigpbwqmfkhh / health-companion-beta. Production excluded.
No blanket approval requested. Technical blockers (CLI patch selection, previous
Edge rollback artifact, hosted auth) must close before final exact revision/hash
authorization is presented. Prior chat approval does not override current no-remote
mutation instruction. REMOTE_MUTATION=STOP.

| Later separately approved operation | Purpose / writes / risk | Reversibility and rollback |
|---|---|---|
| Provision health_manual_api, health_native_ingest, health_recompute_worker; exact grants from20260916144345/20260916215632 | role metadata, no health rows; least-privilege isolation | disable dedicated LOGIN/flags; retain schema; no elevated fallback |
| Set six manual names and four background names in package, verify existing bridge | backend config/credentials only; mis-target/auth risk | secure before-state restore/flagsOFF; credentials never frontend |
| Apply only reviewed missing versions in ordered10-file package after fresh comparison | additive schema/functions/policies; lock/compatibility risk | per-file transaction; reviewed forward fix; no destructive down migration |
| Deploy mobile-health-beta exact future verified artifact/hash | Beta code only; contract/auth regression risk | recover previous verified artifact first; otherwise blocked |
| Publish exact future Beta Web revision to verified Beta target | SQL-only provider config/code; no production cutover | restore code/config while retaining newSQL rows |
| A/B synthetic smoke <=24 raw records,80 requests,500 derived/queue/receipt rows | dedicated test users only; no real history/import | stop on integrity/isolation failure; preserve failure evidence |
| Cleanup exact same-run manifest IDs only | test-data tombstones/deletions subject to existingFK rules | preserve raw evidence; ambiguous data retained, never broad deletion |

Dedicated test A/B aliases, if absent, need separate exact mapping approval; no
automatic account merge or production admin identity. No OAuth scope change,
secret rotation of shared credentials, production, paid service, general push or
real-device ingestion is included. Native provisioning authority is a separately
reviewed existing admin boundary, not an approval to grant service_role to runtime.

BETA_REMOTE_MUTATION_AUTHORIZATION_REQUEST=CONDITIONAL_DRAFT_TECHNICAL_GATES_BLOCKED
READY_FOR_REMOTE_ENABLEMENT=NO. Owner need not paste any secret or act on phone.
