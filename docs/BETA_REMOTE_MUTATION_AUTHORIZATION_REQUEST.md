# Conditional authorization draft — NOT READY FOR EXECUTION

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
