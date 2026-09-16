# Remote enablement package — CONDITIONAL, not deploy-ready

Run health-worker-20260917-055400. REMOTE_MUTATIONS_PERFORMED=NO.
This supersedes older privileged-role proposals; no service_role membership,
BYPASSRLS or SUPERUSER runtime exception is requested.

Target: health-companion-beta, uavimjgccigpbwqmfkhh, org pcfenospezigjlgwcbtg,
ap-southeast-1 (prior read-only snapshot, MUST reverify before mutation).
Frontend: d0252422-oss/health-companion-beta main:/ (prior target, independently
reverify Pages/source/API configuration; production must be demonstrably different).
Function: mobile-health-beta. Source revision is the scoped commit containing this
package, with exact artifact hashes to be frozen after outstanding gates close.

## Local prerequisites and blockers

- OfficialCLI2.117.0 on D verified; still selects unapprovedPG17.6.1.166.
  ACTUAL_CLI_PLATFORM remains BLOCKED; no deployment permission can waive this.
- Actual official Edge + dedicated nativePG17.11 is separate local evidence.
- Native delegated role / lease worker implementation and9 actual Edge gates passed;
  manual Web regression is recorded in this run's REPORT, not inferred here.
- Previous deployed Edge artifact remains safely unrecoverable through the supported
  download path (path-validation refusal). BETA_EDGE_ROLLBACK.md remains PARTIAL.
- Hosted credentials/role authentication and real A/B OAuth not done.
- Existing scheduler platform extensions pg_cron/pg_net/vault were NOT reproduced
  by ordinaryPG17 fixtures. Hosted trigger transport requires separate acceptance.

## Ordered installation proposal (NOT EXECUTED)

Use scripts/audit-beta-preparation.mjs output for all26 historical files and exact
hashes. Do NOT reapply history. The prior remote comparison identified missing
original8 engine/manual migrations. Ordered successors:

1. 20260912032458 multi_domain_engine_versioned_outputs
2. 20260912041126 engine_local_runtime_integration
3. 20260912182042 manual_body_local_sql
4. 20260913041844 manual_exercise_catalog_sql
5. 20260913164024 manual_body_engine_recompute
6. 20260913164026 manual_exercise_category_update
7. 20260913180000 engine_queue_publication_guard
8. 20260913190152 manual_observation_canonical_sql
9. 20260916144345 manual_runtime_least_privilege
10. 20260916215632 delegated_worker_runtime_rls

Reconcile actual remote schema/history again; local successors were never compared
with fresh remote schema. Apply only approved missing/equivalent-reviewed items,
one transactional unit per migration, after additive/destructive review and exact
hash match. No DROP/TRUNCATE/bulk DELETE/import/rewrite. Retain rows on rollback.

Role separation/grants: BETA_CREDENTIAL_MATRIX.md and the two successor SQL files.
Original settings: HEALTH_MANUAL_SQL_HOSTED_ENABLED, HEALTH_MANUAL_RELEASE,
HEALTH_MANUAL_ALLOWED_ORIGIN, HEALTH_MANUAL_EXPECTED_PROJECT_REF,
HEALTH_MANUAL_EXPECTED_DB_HOST, HEALTH_MANUAL_DATABASE_URL.
Background: HEALTH_BACKGROUND_SQL_ENABLED, HEALTH_NATIVE_DATABASE_URL,
HEALTH_RECOMPUTE_DATABASE_URL, HEALTH_RECOMPUTE_TRIGGER_SECRET.
Manual SQL-first also fences legacy native ingestion/drain from privileged fallback;
therefore background credentials/flag must be prepared before switching an existing
Beta that relies on native sync. Missing background config intentionally503s those
routes. Do not silently break existing connectors or treat missing credentials as
an optional deploy detail. Offline candidate manifest lists this dependency.
Existing BETA_WEB_AUTH_VERIFY_URL is verified bridge authority, not an Auth JWT.
Values stay in secure configuration backup, never artifacts or frontend.
TLS: BETA_HOSTED_POOL_TLS_CONTRACT.md, strict officialCA/hostname, port6543.

## Rollout / smoke / rollback

Freeze frontend/backend artifact SHA256 and source commit only after local gates,
recover old deployable artifact/config, and receive explicit itemized authorization.
Deploy function first; validate real role/session and user-scoped SQL before Web
provider switch. Frontend READ=SQL/WRITE=SQL; no fallback/double write. Deferred
weekly/check-in show unavailable; photo/real device remain outside manual Beta.
Execute BETA_AB_OAUTH_RUNBOOK.md then existing CRUD/browser/isolation contracts
against an explicitly reviewed remote harness (current local harnesses reject remote).
Do not merely change a local harness URL to bypass its target safety checks.

Limits: maximum24 synthetic raw records,80 mutation requests,500 derived/queue/receipt
rows, two documented test dates, dedicated A/B only. Stop on cap/tenant/auth/RLS/
read-write mismatch or data corruption. Record IDs before cleanup; tombstone/revoke
only identified same-run records with explicit approval, never real data or broad SQL.
Rollback: provider flagsOFF/restore verified code/config; preserve all committedSQL
data. Do not restore elevated runtime as a convenience fallback. Exact remote smoke
commands/artifact hashes remain WITHHELD until real credential/identity/rollback and
CLI prerequisites are verified. This is not a ready-to-execute deploy bundle.
