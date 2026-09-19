# Beta cutover master — vendor-wait edition

Status: READY_OFFLINE_PREPARATION / REMOTE_EXECUTION_BLOCKED.
No remote action is authorized by running a local validator. Existing local PASS
stays accepted. Current hosted/probe17.6.1.166 evidence is not re-queried this phase.

## One-command validation and resume

Use the canonical D repository; commit reviewed source, then build a new package:

```powershell
./scripts/beta-cutover-package.ps1 -OutputDirectory D:/Dev/Evidence/<new-package> -ProjectRef dsdfacbjaicdcwayhhil
./scripts/beta-cutover.ps1 -Mode dryrun -ProjectRef dsdfacbjaicdcwayhhil -PackageDirectory D:/Dev/Evidence/<new-package> -EvidenceDirectory D:/Dev/Evidence/<new-run>
# Revalidates bytes and adds a checkpoint entry; it never trusts prior PASS blindly.
./scripts/beta-cutover.ps1 -Mode preflight -Resume -ProjectRef dsdfacbjaicdcwayhhil -PackageDirectory D:/Dev/Evidence/<new-package> -EvidenceDirectory D:/Dev/Evidence/<new-run>
```

Modes: preflight/dryrun/deploy-edge/deploy-web/e2e/rollback/full. The last five
currently return BLOCKED_CURRENT_RUN_REMOTE_MUTATION_FORBIDDEN, exit2, with a
checkpoint; **they are not implemented live executors**. There is no bypass flag.
Preflight/dryrun exit0 means local bytes/contracts verified, NOT release approval.
Invalid evidence exits1. Concurrent invocations lock the run directory; a crash
lock needs manual read-only ownership review, never automatic stale-lock deletion.
Resume binds exact HEAD, plan hash and project; changed inputs need a new run.

## Target and ordered safety gates

| Stage | Required evidence / action when a future execution phase authorizes it |
|---|---|
| Identity | New probe dsdfacbjaicdcwayhhil; old Beta uavimjgccigpbwqmfkhh; org pcfenospezigjlgwcbtg; ap-southeast-1. Production vptqedxdxfoohbqctujf is denied. Reconfirm plan/cost/DB/pool/Edge/Web identities. |
| PG | Fresh official and SQL server_version_num >=170011, <180000 under current PG17 approval; other major requires compatibility review. Paid actions denied. |
| Recovery | Verified recovery path and old Beta intact; no DROP/TRUNCATE/bulk DELETE/schema rewind. See BETA_ROLLBACK_MASTER.md. |
| Migration | Exact 26-file fresh order in cutover-plan.json / freshMigrationOrder; old target10 successors only after actual schema/history comparison. Hashes must agree with source and attestation. Full supported Supabase zero-schema rehearsal required; native tests omitting platform scheduler extensions are insufficient. |
| Roles | health_manual_api / health_native_ingest / health_recompute_worker, separate identities. Exact grants in20260916144345 and20260916215632, not owner or wildcard grants. Migration admin remains separate. No SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE runtime or elevated membership. |
| Settings | Six manual settings below + reviewed background/auth settings. Private credential delivery outside artifact; never chat/log values. |
| RLS | Actual low-privilege effective role, verified server-derived user context, transaction-local pool A/B/anon isolation. Metadata alone is not RLS acceptance. |
| Edge | Exact mobile-health-beta candidate/hash/ref. Pinned CLI syntax templates are in package. Custom verifier config requires full auth smoke; HTTP200 insufficient. Stop Web on failure. |
| Web | Dedicated Beta Pages repository/path only. Rehash source after proposed overlay is applied in future authorized phase. READ/WRITE SQL, Sheets fallback disabled, no dual-write. Current package itself remains OFF. |
| E2E | Static plan + later actual dedicated A/B browser transport/receipt-backed writes. Verify seven domains, profile/dashboard/timeline/scores, correct rows/revisions and invariants. |
| Isolation | A/B canonical mapping differs; foreign reads/writes, anonymous and forged IDs denied by exact contract. Empty reads cannot prove isolation. |
| Persistence | Reload/new context/logout-login; compare acknowledged SQL rows, cache/environment isolation. Optimistic state never qualifies. |
| Cleanup | Same-run acknowledged exact IDs/account/revision only; unresolved timeout reconciles receipt first; otherwise retain and report. |
| Readiness | Platform, migration, RLS, Edge, Web, CRUD, identity, persistence, rollback and necessary release Gate all accepted. No OAuth/device/local PASS substitution. |

Six original manual settings: HEALTH_MANUAL_SQL_HOSTED_ENABLED,
HEALTH_MANUAL_RELEASE, HEALTH_MANUAL_ALLOWED_ORIGIN, HEALTH_MANUAL_EXPECTED_PROJECT_REF,
HEALTH_MANUAL_EXPECTED_DB_HOST, HEALTH_MANUAL_DATABASE_URL.
Additional reviewed names: HEALTH_BACKGROUND_SQL_ENABLED, HEALTH_NATIVE_DATABASE_URL,
HEALTH_RECOMPUTE_DATABASE_URL, HEALTH_RECOMPUTE_TRIGGER_SECRET, BETA_WEB_AUTH_VERIFY_URL.
See BETA_CREDENTIAL_MATRIX.md for use/scope/rotation; do not copy old project URLs
or credentials into a new target. Missing settings block their dependent stage.

## Remaining implementation versus vendor dependency

The current driver verifies packages and persists safe decisions; live deploy/Web
publication orchestration and full browser CRUD execution are still unimplemented.
beta-remote-e2e.ps1 validates the executable static test plan and cleanup preconditions,
not response data. beta-remote-read-smoke.mjs is the separate normal-session read
adapter. These limits must remain visible until a future authorized implementation
is rehearsed. Vendor response alone does not magically make these steps PASS.

No vendor searches, probes, OAuth, ADB, remote mutations or production operations
are performed by this runbook's local commands.
