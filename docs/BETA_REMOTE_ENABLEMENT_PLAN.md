# Beta remote platform preparation — not deployment approval

## 2026-09-17 non-privileged continuation (current, supersedes role/TLS claims below)

Run `health-nonprivileged-20260916-224316`, base d037387. REMOTE_MUTATIONS_PERFORMED = NO.
The normal manual adapter no longer executes SET LOCAL ROLE service_role. It checks
the actual login/effective role and rejects every membership/elevated flag. Verified
Web subject/email hashes are transaction-local; the new invoker/RLS successor is
`20260916144345_manual_runtime_least_privilege.sql`. The original8 files remain
unchanged. The ordered proposal now contains9 migrations, the new one local-only;
old remote snapshot classifications must not be presented as fresh remote evidence.

Fresh native PG17 Release A6 gates and the separate7-gate low-privilege probe pass,
including a nonvacuous14-table isolation matrix, forced pooled reuse, snapshot
barrier, CRUD/recompute, auth, rollback and timeout retry. Actual nonprivileged
official Edge + PG17.11 + existing Web E2E passes all27 gates in `edge5/manual-sql-e2e-
d7334f81-ee08-459b-a432-ad3961fa67a3/report.json` under this run's evidence root.
Runtime source hashes stayed unchanged; no Edge CPU/memory termination was reported.
Earlier HTTP/browser failures remain preserved, not rewritten as passing attempts.
This is a manual SQL-first local rehearsal, NOT whole-site/CLI/remote acceptance.

`release/summary.json` completed exit0: critical Node87, Python74, policy19,
frontend package contracts2, separate legacy Deno/PG/browser27 gates, lint/typecheck,
actionlint/zizmor, OSV/Trivy and SBOM passed. Additional scoped Node25 and Deno14
passed. Do not sum repeat FAST runs or nested vectors as new tests. SQLFluff's
new successor109 cosmetic findings have parser0/blocking0/unknown-rule-review0;
retain the raw warning, no historical migration rewrite or blanket rule disable.
OSV/Trivy/SBOM are allowlisted/offline PARTIAL_COVERAGE, not a whole-system security
certification. AI_POOL_V2_SECURITY_GATE=PASS_WITH_NON_BLOCKING_FINDINGS.

Hosted pool5432/6543 strict TLS chain+hostname probes PASS with the official public
Supabase CA; [TLS and credential contract](BETA_HOSTED_POOL_TLS_CONTRACT.md) records
the source/hash. No DB authentication/role probe occurred without credentials.
The original six setting names remain unchanged; public CA is not a seventh secret.

CLI2.115.0 reused: config/services parse and version work, migration list local
fails ECONNREFUSED57922 and local serve reports no running stack. CLI still selects
PG17.6.1.166; the project's approved compatibility baseline is17.11+. Upstream
postgres PR2155 was freshly checked open/unmerged. No unsafe older instance,
new image pull, global upgrade or current shared-stack mutation performed.

Remaining release blockers are independent: CLI platform, dedicated Beta role/login
and credential approval, real A/B session acceptance, complete deployed rollback
artifact, native scheduled-worker identity separation, and whole-site SQL scope.
The scheduled native worker has no verified Web context and cannot borrow this
manual credential; it must fail closed, not fall back to an elevated adapter.

The current static51-action inventory is26 SQL_READY,4 PARTIAL,15 NOT_IMPLEMENTED,
6 explicit legacy/auth. SQL_READY means route coverage, not remote acceptance.
`getUserProfile`, `getNutritionTargets`, `healthCheck` and legacy `addMealRecord`
are declared API facade entries, not proven active UI flows. Weekly report/check-in
do have UI callers and remain unsupported by SQL; photo analysis is also not ready.
Do not invent those results or silently route them to Sheets. A full-site switch
remains blocked; a supported-manual-only release needs explicit unavailable-feature
presentation and its own accepted scope before authorization.

See [adapter trace](HOSTED_ADAPTER_TRACE.md), [context contract](AUTH_TO_DB_CONTEXT_CONTRACT.md),
[definer containment](SECURITY_DEFINER_REVIEW.md), [Edge rollback gap](BETA_EDGE_ROLLBACK.md),
and [A/B login plan](BETA_AB_TEST_LOGIN_PLAN.md). The old role/secret SQL below is
historical, NOT an executable approval request. PENDING_EXPLICIT_BETA_AUTHORIZATION.

## 2026-09-16 authoritative continuation (supersedes conflicting older proposals)

Run: `health-beta-cutover-prep-20260916-192251`, base `a37c7ec`.
Current phase: BETA_REMOTE_PLATFORM_AUTH_AND_SQL_FIRST_CUTOVER_PREPARATION.
REMOTE_MUTATIONS_PERFORMED = NO. PENDING_EXPLICIT_BETA_AUTHORIZATION remains separate
from technical failures. No remote role, secret, migration, deployment or test data action is approved by this plan.

Fresh target/schema/settings/CLI/TLS results: [BETA_REMOTE_INVENTORY.md](BETA_REMOTE_INVENTORY.md).
The existing 8 migrations remain absent. All 24 source migrations were read/hash-inventoried;
16 have remote history entries (not proof of byte-identical schema); 8 have missing
history and absent engine/manual objects. The 51-action inventory remains26 static
SQL_READY,4 PARTIAL,15 NOT_IMPLEMENTED,6 explicit legacy/auth. No frontend flag changed.

### Normal runtime role requirement — NO elevated exception this run

The older `GRANT service_role` proposal below is **historical and NOT APPROVABLE under
the current instruction**. `scopedManualSql` currently checks SET membership then
executes SET LOCAL ROLE service_role. A NOINHERIT/NOBYPASSRLS login alone does not fix
the effective privilege. Do not provision that old proposal or silently disable RLS.

Desired role design (not executable migration):

| Identity | Design / scope |
|---|---|
| migration/admin | Existing authorized operator only; never runtime DB URL |
| health_manual_api | Dedicated LOGIN after explicit provisioning; NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOBYPASSRLS, NOREPLICATION; cannot SET any elevated role |
| health_beta_inspector | Optional NOLOGIN role; catalog-only/read-only; unnecessary health grants omitted |
| verified user context | Existing opaque Web session verifier and exact active canonical alias; not auth.uid equality, body user_id, email similarity or test issuer |

Safe role skeleton proposal, **not run**, and not yet a usable runtime:

```sql
CREATE ROLE health_manual_api NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
GRANT CONNECT ON DATABASE postgres TO health_manual_api;
-- No elevated membership, schema CREATE, table ownership, ALL, TRUNCATE or default grants.
-- LOGIN/password and exact per-object permissions only after adapter/RLS rehearsal and approval.
```

Required permission inventory: SELECT on users/active alias mapping; SELECT/INSERT
on receipts/history; SELECT/INSERT/UPDATE on body/meals/observations/output heads and
bounded queue; catalog/preferences/workout column-limited writes and unreferenced
catalog DELETE only. No workout/health-history DELETE, no cascade. UUID IDs require
no new sequence access. Private schema USAGE and exact helper EXECUTE need caller
review; do not expose private functions to PUBLIC.

Implementation gap: existing migrations grant writes to service_role and native
authenticated SELECT policies resolve native auth.uid(), not the opaque Web session.
A least-privilege successor must establish backend-only transaction context from a
fresh verified Web mapping, add owner-scoped USING/WITH CHECK policies, remove the
SET service_role requirement, and pass read/write/RLS/replay/concurrency tests with
the actual low-privilege login. Queue/system aggregate access needs separate narrow
privileges, not a blanket health-table grant. That adapter/policy work is **NOT
implemented or rehearsed by this preparation**; credentials alone cannot close it.

### Current pre-cutover decision and exact authorization boundary

`scripts/beta-cutover-preflight.mjs <absolute non-secret attestation.json>` is an
offline fail-closed decision helper, **not a deployment or cleanup executor**. It
checks the target, 24 required gates, effective role, TLS/rollback/site readiness,
ordered approved migration hashes and separately dated operation approvals. Its
positive fixture proves only guard logic. Current attestation returns STOP_REMOTE_MUTATION.
Synthetic scope guard refuses foreign account/record/run, production and >24 raw
rows or >80 mutation requests. Existing local synthetic E2E must not be repointed
to Beta; actual remote browser/mutation executor is still NOT_IMPLEMENTED/NOT_RUN.

The minimum future authorization remains Beta ref `uavimjgccigpbwqmfkhh` only:

1. Provision the above non-elevated runtime identity and its **new reviewed/rehearsed**
   per-object grants, not the old service_role membership. Metadata writes; recovery
   is disable dedicated login/revoke dedicated grants, preserving rows. Exact policy
   successor/hash is pending; do not approve unspecified future SQL today.
2. Set the six named settings in the matrix below and supply the DB URL through secure
   local/platform settings, never chat. Configuration-only; restore captured config
   or provider OFF. No OAuth scope change, shared credential rotation or global CA install.
3. Apply the exact8 migration hashes in `sql-contract-inventory.json` only after a fresh
   rehearsal and approved least-privilege successor. Additive schema writes; preserve
   data and forward-fix. Any destructive successor requires new review.
4. Deploy only `mobile-health-beta`, then the verified Beta Pages target/main:/;
   backend failure stops frontend switch. Requires complete recoverable previous
   artifacts first. Rollback code/config via a new commit, never force push or data reversal.
5. Two dedicated A/B accounts only: <=24 raw synthetic rows, <=80 mutation requests,
   <=500 derived/queue/receipt rows, two declared dates and bounded following27 days.
   Stop on overrun or uncertain ownership. Cleanup only manifest-listed same-run IDs
   verified again against the live row/account; no deletion by broad date/email.

Owner prerequisites that cannot be automated: designate two dedicated non-admin Beta
accounts and complete their first existing Google consent if required; provide the
official **public** project CA through a file/approved dashboard route (no secrets in
chat). Runtime credential provisioning is requested only after the low-privilege
adapter and platform gates pass. Do not ask Owner to authorize production or a
service_role exception to compensate for these technical blockers.

Remaining engineering/platform work: approved compatible CLI PG17.11+ stack, strict
hosted CA validation, non-elevated adapter/RLS, explicit unavailable UI for noncore
weekly/check-in/photo paths (or actual SQL implementation), complete rollback and
remote authenticated browser harness. This is not READY_FOR_REMOTE_ENABLEMENT.
No new inert frontend package was produced this turn. Prior local PASS stays prior;
no full-suite rerun or new runtime/remote PASS is claimed.

Run `health-beta-preparation-20260914-092035`, 2026-09-14; audited product revision
`29346ace9842d9bbde221d0fcf4026a52ad3b80c`. Canonical workspace remains
`D:/Dev/Projects/health-companion-canonical-20260913-020110`.
REMOTE_MUTATIONS_PERFORMED = NO. Status = PENDING_EXPLICIT_BETA_AUTHORIZATION **and technical preconditions**.
This document supersedes older conditional deployment permission for this run only.
The direct official Edge/native PG17.11 and manual CRUD/browser local PASS evidence
remains valid; it is not fresh CLI, hosted pool, real OAuth or remote E2E evidence.

## Evidence and verified targets

Evidence root: `D:/Dev/Evidence/health-beta-preparation-20260914-092035`.
`project.json`, `organization.json`, `schema.json`, `schema-baseline-dependencies.json`,
`migrations.json`, `functions.json` are fresh metadata-only reads. No health rows,
real sessions, browser credentials or passwords were collected. Organization display
details are deliberately omitted here.

| Boundary | Fresh observed target |
|---|---|
| Project / ref | health-companion-beta / uavimjgccigpbwqmfkhh |
| Organization / region | pcfenospezigjlgwcbtg / ap-southeast-1 |
| Direct DB | db.uavimjgccigpbwqmfkhh.supabase.co:5432 / postgres |
| Hosted DB version | SQL server17.6; management build17.6.1.166 |
| Edge | mobile-health-beta v14; custom authorization, verify_jwt=false |
| Existing Edge bundle digest | a40beb78e41f0a969af44b72a66efa0c31fed8234d794e51770284952749ed07 |
| Beta frontend | https://d0252422-oss.github.io/health-companion-beta/ |
| Deployment | GitHub Pages legacy build, d0252422-oss/health-companion-beta main:/ |
| Production exclusion | vptqedxdxfoohbqctujf — not queried or modified |

Repeat these checks immediately before any future approved mutation, including the
repository `scripts/assert-beta-supabase-target.ps1` guard. Cached linked project/ref
or an environment variable name alone is insufficient. Metadata login was postgres,
with BYPASSRLS=true and transaction_read_only=off; issuing only SELECT did **not**
make it a least-privilege runtime credential or demonstrate hosted RLS isolation.

## CLI / platform gate

Use existing project-approved CLI2.115.0, resolved from
`C:/Users/D0252/scoop/apps/supabase/current/supabase.exe` (shim is not the binary).
Executable SHA256: `691a3312584891204dc11893abcd12fa656dbcce186ef8d0a2782f137463f6d7`.
Scoop manifest references the official v2.115.0 GitHub release ZIP, archive SHA256
`76782a0316c6f368dd41c94184faec8a0a3f6ca214b76bf16615536e5ed32bfa`.
This verifies local provenance records/integrity, **not a fresh publisher signature**.
No binary was downloaded, upgraded or installed. Documentation holds2.115.0;
package.json/CI do not enforce a Supabase CLI devDependency pin.

Fresh results in `commands/`:

| Check | Result / boundary |
|---|---|
| --version, functions/db/config/migration/services --help | PASS command inspection |
| services | Config parse succeeds; selects PG17.6.1.166 and Edge1.74.3 |
| functions list | Remote-only command; no local option, not local function discovery |
| migration list --local | FAIL: isolated previous overlay DB127.0.0.1:57922 not running |
| functions serve mobile-health-beta | FAIL: Supabase local stack not running |
| bundle/build/invoke | No such CLI subcommands; bundle requires successful serve; invoke would be HTTP against served handler |
| config validate | No such command; `config push` writes remotely and was NOT executed |
| local SQL/config validation, actual CLI handler invoke | NOT_RUN; required stack unavailable |

CLI_VERSION_OK_DOC_PIN; CLI_PLATFORM_MISMATCH. ACTUAL_CLI_EDGE = BLOCKED.
Official Edge1.74.3 matches the previously accepted direct-Docker image, but that
does not validate CLI stack orchestration. Do not substitute ordinary Deno or image
presence for a running CLI handler. No Docker repair/start/reset was done this run.

The safety requirement is **PostgreSQL17.11+**, not an invented minimum CLI version:
[CVE-2026-16239](https://www.postgresql.org/support/security/CVE-2026-16239/)
is fixed in17.11/18.6. Current CLI services selects17.6.1.166; prior verified image
inventory found17.6.1.171, no approved17.11 image. Do not lower the repo baseline,
spoof image versions or swap a plain native server into the CLI stack and call it
platform-compatible. Hosted vendor backport status is UNKNOWN, not proof of an
exploitable tenant. Obtain vendor patch attestation/approved platform image before
that security/platform gate. No remote version upgrade is proposed for automatic execution.

## BETA_MIGRATION_DEPENDENCY_GRAPH

Remote16-version history ends `20260903130618_unify_beta_web_native_identity`.
Fresh schema metadata has no engine_* / manual_* tables/functions. All eight below
are MISSING, not ALREADY_APPLIED or EQUIVALENT_REMOTE_STATE. Existing users,
beta_health_records, native identities, Web aliases and score queue exist with RLS.
Queue lacks engine_required and engine_published_generation. Actual schema agrees
with missing history for this subset; full platform schema equivalence is not claimed.

| Order/version | Purpose | Direct dependencies |
|---|---|---|
| 1 20260912032458 | Versioned output history/heads | users + authenticated/service_role |
| 2 20260912041126 | Meals, canonical identity policy, bounded queue triggers | 1; native identities/auth.uid, health records, existing queue generation/lease schema |
| 3 20260912182042 | Manual body/receipt store | 2 canonical policy |
| 4 20260913041844 | Exercise/preferences/workout history/receipts | 2; users; key-share/advisory lifecycle guards |
| 5 20260913164024 | Body enqueue trigger | 2 + 3 |
| 6 20260913164026 | Exercise muscle_group update grant | 4 |
| 7 20260913180000 | Queue publication generation guard | 1 + 2 + 3; body/meal trigger consumers |
| 8 20260913190152 | Manual observation/receipt/overlap publication | 2 + 7 |

Files are the unique versions under `supabase/migrations/`; the generated
`sql-contract-inventory.json` records exact filenames, SHA256, and line locations for
tables, functions, grants, policies, indexes and triggers. Generate it using:

```powershell
node scripts/audit-beta-preparation.mjs <new-absolute-evidence-json-path>
```

All eight were read completely. No top-level DROP/TRUNCATE/mass DELETE/irreversible
data rewrite found. UPDATE in trigger functions/grants is not bulk migration DML.
ADD COLUMN and CREATE OR REPLACE FUNCTION still have lock/behavior risks. Keep
ordered, bounded transactions; re-diff hashes and rehearse the exact changed subset
against a new approved PG17.11 cluster before application. Prior rehearsal is retained
as historical evidence, not eight new tests. Never apply only8 or blindly push the
entire historical migration folder. Release AB needs all8; Release A may omit4/6
only after its existing isolation tests and release-specific bundle are selected.

Recovery: retain additive tables/new rows, switch code/config off, forward-fix
function definitions and publication errors from the captured before-state. No
automatic down migration or deleting legitimate SQL rows. Baseline function bodies,
policies/grants and old Edge deployable bundle still need a full pre-apply snapshot;
the metadata inventory alone is not a schema/Edge rollback artifact.

## BETA SQL role design — explicit elevated-runtime exception

Remote `health_manual_api` role is absent. Current implementation is
`hosted-manual-bootstrap.ts::scopedManualSql`: login must be health_manual_api,
NOINHERIT/NOBYPASSRLS/NOSUPERUSER and allowed to SET service_role without inheriting it;
**every transaction then executes SET LOCAL ROLE service_role**. Effective role has
BYPASSRLS. The Web adapter revalidates the canonical mapping and tenant predicates
inside writes; independent native authenticated RLS tests do not replace those checks.

| Role | LOGIN | INHERIT | BYPASSRLS | SUPERUSER / CREATEDB / CREATEROLE | Purpose |
|---|---|---|---|---|---|
| Existing postgres/admin | YES | YES | YES | NO / YES / YES observed | Approved migrations only, never normal Web connection |
| Proposed health_manual_api | YES after separately approved credential provisioning | NO | NO | NO / NO / NO | Pool login; effective transaction role remains elevated |
| Existing service_role | NO | YES | YES | NO / NO / NO | Current runtime SQL/queue permission contract; server tenant authorization required |
| Existing authenticated/anon | NO | YES | NO | NO / NO / NO | Verified native subject RLS reads / protected anonymous denial |
| Optional health_beta_inspector | NO initially | NO | NO | NO / NO / NO | Catalog-only/read-only diagnostics; no health table grants |

Proposal only (not a migration file; **DO NOT execute under current authorization**):

```sql
-- Stop if the role already exists; inspect its effective grants instead of overwriting.
CREATE ROLE health_manual_api NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT CONNECT ON DATABASE postgres TO health_manual_api;
GRANT service_role TO health_manual_api WITH ADMIN FALSE;
GRANT service_role TO health_manual_api WITH INHERIT FALSE;
GRANT service_role TO health_manual_api WITH SET TRUE;
-- LOGIN/password provisioning is a separate approved secret-channel action, no password SQL here.
```

Membership option semantics: [PostgreSQL17 GRANT](https://www.postgresql.org/docs/17/sql-grant.html).
NOINHERIT is **not** a least-privilege shield when SET is permitted. Fresh remote
service_role has even TRUNCATE privileges on users/health records. Current code does
not invoke them, but a credential compromise has that blast radius. Do not grant
ALL/default privileges, membership ADMIN, schema CREATE or ownership to this login.
Owner must explicitly approve the elevated exception or authorize a separately
implemented, tested scoped-role adapter before provisioning. This prep does not
silently change the application's role contract.

Required effective permissions are the exact versioned GRANT statements: history
SELECT/INSERT; heads SELECT/INSERT/UPDATE; meals/body/observations SELECT/INSERT/UPDATE;
receipts SELECT/INSERT; queue SELECT/INSERT/UPDATE; aliases/users SELECT for mapping;
exercise/preferences limited column UPDATE and safe DELETE; workouts SELECT/INSERT
and allowed column UPDATE (tombstone, not cascade). New IDs are UUIDs, no new sequence
grant is needed. Private schema USAGE and helper EXECUTE must match function caller
and SECURITY DEFINER/INVOKER semantics; do not expose private functions to PUBLIC.
Native authenticated receives only published owner reads via verified auth.uid mapping,
not direct Web writes. No explicit role was created or permission changed.

## BETA_REQUIRED_SETTINGS_MATRIX (the original six)

Source: `hosted-manual-bootstrap.ts::validateHostedManualConfig`, package manifest,
prior checkpoint and fresh **names-only** secret inventory. CLI list digest does not
prove value, password validity or pool connectivity. All six names are MISSING.

| Setting | Purpose / safe expected non-secret config | Type / owner | Validation |
|---|---|---|---|
| HEALTH_MANUAL_SQL_HOSTED_ENABLED | 1 only after all preconditions; absent/off now | non-secret / release owner | Route fails closed before activation |
| HEALTH_MANUAL_RELEASE | A or AB selected package, not inconsistent frontend flag | non-secret / release owner | Release-specific route regression |
| HEALTH_MANUAL_ALLOWED_ORIGIN | https://d0252422-oss.github.io (origin, not repository path) | non-secret / release owner | exact CORS, rejected foreign Origin; shared GitHub origin risk remains |
| HEALTH_MANUAL_EXPECTED_PROJECT_REF | uavimjgccigpbwqmfkhh | non-secret / Beta operator | compare management project + SDK SUPABASE_URL |
| HEALTH_MANUAL_EXPECTED_DB_HOST | aws-0-ap-southeast-1.pooler.supabase.com, subject to fresh tenant confirmation | non-secret / DB operator | Confirm actual Connect metadata, not region-derived hostname |
| HEALTH_MANUAL_DATABASE_URL | server-only transaction pool URI, health_manual_api.<ref>, port6543, /postgres | SECRET / Beta DB operator | TLS verified; session_user/role membership + read-only SQL probe |

Other prerequisite (not silently added to the six): BETA_WEB_AUTH_VERIFY_URL name is
PRESENT, value UNKNOWN. Must independently match existing approved HTTPS Apps Script
deployment; no verifier-secret read attempted. Supabase SDK built-ins present by name,
not validated as usable credentials. Credential rollback is disable provider then
revoke only the dedicated login/membership under separate approval; preserve rows.
No fake password/endpoint or test issuer enters the deployable path.

## Hosted pool / TLS readiness

`hosted-pool-readiness.json`: transaction6543 and session5432 DNS/TCP PASS;
TLS FAIL SELF_SIGNED_CERT_IN_CHAIN in the strict Node probe. Direct hostname resolution
failed ENOTFOUND in this environment; this alone does not identify IPv4/IPv6 cause.
Probe sent only PostgreSQL SSLRequest + certificate/hostname-verified TLS negotiation,
no StartupMessage/password/query. No DB runtime credentials existed in the checked
process/known project settings; AUTH/ROLE/PG_VERSION through pool NOT_RUN.
Management-reported17.6 must not be relabeled a successful pool query.

The linked pool hostname is shared; DNS/TLS alone cannot bind it to this tenant.
Use transaction mode6543, prepare:false, max2 as the current driver specifies; session
mode5432 is only a diagnosed alternate endpoint, not a silent runtime switch.
Current code supplies rejectUnauthorized:true without explicit CA. Obtain the official
Supabase project CA through an approved source and validate it in a command-scoped
probe while retaining hostname verification. No global CA install, TLS bypass or
trusting a peer-supplied root. Public CA retrieval was not verified this run; document
that gap rather than retrying an unsafe URL through another transport. Whether Edge's
trust store behaves identically remains NOT_RUN, not a confirmed deployed code defect.

Sources: [Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres),
[SSL enforcement/CA guidance](https://supabase.com/docs/guides/platform/ssl-enforcement).
Once legitimate dedicated credential exists, use a short read-only transaction:
`SELECT current_database(),session_user,current_user; SHOW server_version;
SHOW transaction_read_only;` plus pg_roles/pg_auth_members metadata. Never SELECT health
rows just to prove connectivity. End transaction; no runtime role security PASS from admin login.

## BETA_TEST_LOGIN_CONTRACT

REAL_BETA_LOGIN = BLOCKED_MISSING_TEST_IDENTITY. No dedicated A/B credential or
revocable session was evidenced; do not repurpose a real tester/Owner from a DB search.
Existing route: Google GIS consent -> Apps Script createSession -> opaque Web session
-> Edge verifyWebIdentity/getCurrentUser -> verified subject+email -> exactly one
ACTIVE Beta canonical alias. That is not a Supabase Auth JWT. Manual mapping is
read-only and fail-closed on missing/conflict; it does not auto-link users.
LINE/LIFF relies on the existing Web/Google linking bridge; it is not independently
accepted here, and link/unlink is a separate account write. Local ES256 synthetic
issuer is excluded from hosted bootstrap, never enable a hosted auth bypass.

Minimum future Owner action: designate two dedicated Beta accounts, complete first
Google consent in the existing Beta login if required, then allow only those accounts'
Beta alias provisioning if missing, with explicit account selection outside source.
No consent/MFA/CAPTCHA bypass, production admin, cookie extraction or shared password.
Validate expiry/revocation/logout using the bridge; A/B/anonymous/forged/expired cases
must run on real Beta authorization before remote acceptance. Tokens stay in normal
session storage/secure test process; artifacts contain no credentials or identity values.

## FULL_SQL_CONTRACT — cutover blocker, not a hidden fallback

The generated action inventory records literal frontend call lines, runtime handler,
storage, auth/tenant, response/error, cache and recompute boundaries per action.
`SQL_READY` means implemented static route coverage, **not remote PASS**. Body,
nutrition, training/exercises and observations use real hosted handlers. Dashboard/
timeline/refresh are PARTIAL (published/available data only); training raw aggregates
do not imply a new validated training score. All reference scores remain unchanged.

Known unsupported hosted actions: healthCheck, getUserProfile, getNutritionTargets,
getTodayCheckin, upsertHealthCheckin, deleteHealthCheckin, getWeeklyReport, photo/session
analysis actions and unused legacy addMealRecord alias. Verify current form uses
upsertMealRecord before counting it as a broken active meal path. Hosted unsupported
actions throw MANUAL_ACTION_NOT_SUPPORTED; they do not silently call Sheets.
Auth getCurrentUser/logout/LINE links deliberately use the existing bridge and are
LEGACY_ONLY, not SQL data fallback. Dynamic reachability must be checked separately.

Full-site Beta SQL-first remains BLOCKED_FULL_SQL_CONTRACT. Before cutover, implement
critical missing SQL actions or explicitly disable their entry points with persistent
NOT_AVAILABLE states and test navigation/profile/bootstrap. Do not approve global
provider switching based solely on accepted manual forms. This preparation-only run
does not add product features, change flags or label unavailable paths SQL-ready.

## Release artifact / rollback / smoke sequence (not executed)

Frontend source29346ace; `scripts/prepare-manual-beta-package.mjs` generates an
allowlisted source deploy tree, pinned imports and OFF flags; **not a CLI-compiled
bundle**. Prior package hashes remain in the accepted prior-run evidence. Exact
current deployed frontend recovery is in [BETA_FRONTEND_ROLLBACK.md](BETA_FRONTEND_ROLLBACK.md).
Old Edge v14 digest is known, but its deployable source bundle must still be saved and
verified before replacement. Never infer an Edge rollback command from version number alone.

Future authorized order: target revalidation -> before-state and deployable rollback
artifacts -> approved roles/config/CA -> hash-matched migration rehearsal and8-version
apply -> schema/RLS/grants verification -> deploy mobile-health-beta -> test dedicated
session, all SQL CRUD and score/read contracts -> then Beta frontend/provider switch
-> new-session Browser A/B/reload/update/delete/error E2E -> safely scoped test cleanup.
Stop immediately on mapping, RLS, cross-user, schema or read/write mismatch; do not
publish frontend after failed backend smoke. Recover code/config, not data deletion.

Read-only checks now supported (run help first, no blanket database dump):

```text
supabase --version
supabase services
supabase functions list --project-ref uavimjgccigpbwqmfkhh --output json
supabase migration list --project-ref uavimjgccigpbwqmfkhh
gh api repos/d0252422-oss/health-companion-beta/pages
```

Future mutation command shapes, **not executable authorization**:

```text
supabase secrets set --project-ref uavimjgccigpbwqmfkhh --env-file <private-six-setting-file>
supabase functions deploy mobile-health-beta --project-ref uavimjgccigpbwqmfkhh --workdir <verified-AB-package>
```

Migration application must use a reviewed runner for the exact eight approved files
with target assertion/lock timeout/history recording; never unrestricted db push.
That remote runner and remote-auth Browser smoke are **NOT_IMPLEMENTED/NOT_RUN**:
existing local synthetic runners cannot safely be redirected to Beta. Before approving
data writes, implement a Beta-only runner pinned to ref + A/B + run nonce, requiring
confirmation of the manifest and refusing any unlisted record ID, then dry-test its
guards locally. Lack of a safe remote harness is an enablement blocker, not an excuse
to improvise commands against live data.

## BETA_AUTHORIZATION_REQUEST — narrow, conditional, no action this run

Do not request or execute a blanket production approval. After technical gates above
close, request permission only for project uavimjgccigpbwqmfkhh and the stated Beta
Pages repository. Each item is separately approvable:

1. **Role/credential**: create health_manual_api and membership exactly reviewed above,
   provision one server-only credential through secure settings. Purpose: pool login.
   Writes: role/credential metadata, no health rows. Risk: explicit service_role SET
   blast radius; require that exception approval or a tested least-privilege successor.
   Recovery: provider OFF, revoke dedicated login/membership; preserve SQL data.
2. **Six settings** listed above (only DB URL secret), verify existing bridge setting;
   no OAuth scope/secret rotation. Purpose: bind Beta provider. Recovery: captured
   setting values/flag OFF using secure backup, no values in reports. CA setting only
   if separately designed/tested; do not invent a seventh required secret today.
3. **Migrations1–8** exact table above, current reviewed hashes only. Purpose: manual
   canonical/derived SQL and safe references. Writes: additive DDL/functions/grants;
   no historical import/mass mutation. Recovery: forward-fix/code flag OFF. Reapprove
   any destructive successor, not covered by this list.
4. **Edge deployment**: mobile-health-beta verified source/package revision, after
   old deployable bundle and new hosted smoke harness exist. Recovery: old verified
   bundle/config. No other function or production project.
5. **Beta frontend**: new scoped commit/publication to d0252422-oss/health-companion-beta
   main:/ only, once backend/whole-site contracts pass. This is a future Beta-only
   push/deploy approval, not permission to push the product branch or production.
   Recovery: new commit restoring saved prior source/config, never reset/force-push.
6. **Test identities and bounded data**: only two designated Beta accounts; if aliases
   missing, separately approve precise Beta-only mappings, no real account merge.
   Maximum24 synthetic raw records across body/meals/workout sets/sleep/steps/energy/
   exercise catalog; at most80 mutation requests including retries, two specified
   test dates. Expected bounded recompute may extend through27 following days;
   budget at most500 derived/queue/receipt rows and abort on overrun. These are proposed
   caps, not observed execution counts. Purpose: A/B/isolation/idempotency/reload smoke.
   Cleanup only the run manifest's synthetic IDs, subject to FK/tombstone contract;
   never bulk-delete by date/email. Preserve failure evidence and ambiguous rows.

Current request is preparation, not approval of items1–6. Missing technical gates
cannot be cured by authorization alone. No immediate phone action is required.
Android/iOS device gates remain DEFERRED; production and historical data migration
remain outside every item above.

## Progress reconciliation

Existing baseline known-scope-v0.1-provisional-2026-09-12 unchanged: overall UNKNOWN,
known scope32/100, +0.0pp; no ledger correction. Existing local leaves already credited;
CLI/remote/OAuth/full-site acceptances not met. New unweighted deliverables: fresh
target/schema/role inventory, strict pool TLS diagnosis, source-hashed dependency/action
audit, partial frontend rollback recovery, and this precise role/settings/login/approval
plan. Preparation does not earn runtime/remote release weights.
