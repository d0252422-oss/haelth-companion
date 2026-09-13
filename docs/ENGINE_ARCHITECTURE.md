# Multi-domain engine architecture (non-production)

## 2026-09-13 — manual release readiness and exercise management (current)

Run `health-release-exercise-20260913-120836`, continuing `efe83ed` in the
canonical D checkout documented below; no migration/Git isolation was repeated. This section
supersedes older dispatch-only/manual-auth descriptions below, not their evidence.

### Actual execution and identity boundary

| Node | Actual file / function |
|---|---|
| Original body/meal/workout forms and catalog manager | `index.html` existing submit/edit handlers; `scripts/local-engine-web.js:setupLocalExerciseManagement/localEngineRequest` |
| HTTP, gateway-prefix routing, CORS and SDK middleware | `scripts/local-engine-server.ts` calls `mobile-health-beta/index.ts` **default.fetch**, not dispatch-only |
| Native local identity | Distinct ES256 authority -> `authenticateNativeUser/resolveNativeIdentity` -> existing canonical mapping |
| Web session local identity | Separate signed issuer -> verified subject/email -> `manual-web-identity.ts:resolveVerifiedManualWebIdentity`; existing `private.beta_web_identity_aliases` SELECT only |
| Body / catalog / workout SQL | `ManualBodyLocalStore` / `ManualTrainingLocalStore`, same canonical PG provider for CRUD, receipts and read-back |
| Meals / analysis | Existing `LocalEngineRuntime.mutate/compute/snapshot`, portable engine, existing durable recompute queue and versioned PostgreSQL outputs |
| Target CLI-local bootstrap | `local-manual-bootstrap.ts:localManualBootstrap`; actual SDK admin verified auth or existing `verifyWebIdentity`, no local issuer in this module |
| Return | PG rows/receipts -> same original Web UI; new context re-authentication sees durable results |

Native tests use non-owner `authenticated NOSUPERUSER NOBYPASSRLS` for RLS reads;
anonymous reads and authenticated direct writes are denied. Backend writes use
`service_role NOSUPERUSER BYPASSRLS`, with separately tested canonical predicates,
owner/FK guards and narrow column UPDATE grants. Web sessions **do not impersonate
native JWTs** and do not set `auth.uid()` to the canonical UUID. Their existing
alias subject and exact normalized verified email must BOTH match one ACTIVE Beta
mapping. Missing/conflicting/revoked mapping fails closed. All Web reads, including
receipts/queue/timeline, recheck mapping within their transaction; writes lock mapping
rows before mutation. No alias/account creation, timestamp update or merge occurs.
Web isolation evidence is server tenant authorization, **not Web RLS PASS**.

Native SQL is PostgreSQL18.6, driver postgres3.4.8. Actual local handler runs in
Deno2.9.6/TS6.0.3 with @supabase/server1.4.1. Existing intended deployment is Supabase
Edge Runtime; CLI2.115.0 is installed, but its local Docker API pipe is absent.
Actual Edge version/execution/resource/bundle acceptance remains BLOCKED/UNKNOWN.
The repo CLI config selects PG17, which was NOT tested by the PG18.6 rehearsal.
Do not promote ordinary Deno or skills/documentation to Edge evidence.

The new CLI-local bootstrap is opt-in, rejects deployed-worker markers, remote/non-root
auth URLs, wrong DB/role/port, credentials in local config and changed DB/auth environment
after bootstrap. It has no required Python subprocess or remote worker. SDK auth fetch
and existing Web verifier have a 10-second deadline through response body consumption;
transport failure returns503 retryable, not an invalid-login401. Admission is released.
Actual runtime code/handler tests pass, but enabling this **local-only** bootstrap on
a remote deployment remains prohibited. It is not a production auth bypass.

### Raw data and exercise semantics

Body returns `ANALYSIS_PENDING / ALGORITHM_NOT_CONNECTED / analysisJobScheduled=false`.
The Web explains that only the SQL record was saved and no job exists. Raw workout
sets similarly use `MANUAL_WORKOUT_ADAPTER_NOT_CONNECTED`, not imaginary queue work.
Meal analysis continues the existing queue/experimental nutrition path. No body/workout
manual rows are disguised as mobile ingestion or injected into health-score-v1.0.

New additive proposal `20260913041844_manual_exercise_catalog_sql.sql` extends the
existing exerciseId/workout contracts: shared definitions, owned custom definitions,
per-user alias/archive/revision preferences, stable-ID manual sets and write receipts.
Own names may change; system names only receive personal aliases. Historical set JSON
keeps its original name/ID/weight/reps; rename never merges same-name movements.
Archive hides only new selection, restores reversibly, and allows same-ID historical
set edits. Permanent deletion is own-unused-only, with native confirmation and
RESTRICT FKs, never CASCADE. Soft-deleted historical sets still block physical deletion.
There is no existing runtime template store in this repo: template integration is
NOT_IMPLEMENTED, not a tested promise. Any future template store MUST use a normalized
RESTRICT FK before referencing IDs; no name/JSON-only pre-check is sufficient.

Canonical advisory locks, preference row locks and FK key locks arbitrate writes.
API replay/concurrency and an independent SQL reference/delete race passed. Direct
archived inserts are rejected; archived history stays editable. Both separately
barrier-controlled archive/reference orderings were not measured, so are not claimed.
Raw set old/new dates are returned for view invalidation; no unconnected score job is
fabricated. Existing meal bounded recompute is reused, not replaced with a new queue.

Uncertain workout writes keep a deep immutable envelope/request ID. Back/start and
draft edits are locked while retry remains accessible. Settings/Training and mobile
quick-navigation restore the same draft, not a new one. Account reset unlocks and
clears draft/catalog/state. Provider/database/user namespaces isolate caches; late
catalog/range reads cannot revive an older revision. Zero remains zero, null remains
missing. Names render as text/escaped HTML; control/bidi/blank/overlength names reject.

### Conditional body/meal Beta package — NOT enablement

Build locally with `node scripts/prepare-manual-beta-package.mjs <new-absolute-output>`.
It copies only the original `index.html` and its relative
`scripts/local-engine-web.js`, checks inline/linked JS syntax and records SHA256/source
revision. No synthetic issuer, secret, DB, fixture, Android or source-map is shipped.
This is an **inert static review artifact**, not a working remote manual-SQL release.
Local/manual/exercise flags are OFF; the existing Apps Script default is unchanged.
Uploading it alone cannot enable SQL. Existing external fonts/Tailwind/Lucide/LIFF and
real Google login are not validated by the offline browser harness that strips CDNs.

Documented future Beta target (not fresh remote-state verification):
project `health-companion-beta` / `uavimjgccigpbwqmfkhh`,
function `mobile-health-beta`, Supabase Edge.
Proposed frontend entry:
`https://d0252422-oss.github.io/health-companion-beta/manual-preview/`.
The new subpath is a proposal, not an approved deployment target; preserve current
Beta root, production root, legacy manual data and login. No import, dual-write or
Sheets fallback is permitted on the SQL path.

Body/meal package dependency proposals: existing canonical/identity/queue baseline
plus `20260912032458_multi_domain_engine_versioned_outputs.sql`,
`20260912041126_engine_local_runtime_integration.sql`,
`20260912182042_manual_body_local_sql.sql`. Exercise migration is optional/separate
and MUST NOT hold the body/meal package hostage. Web mapping migration in this run:
NONE; the read-only adapter reuses existing aliases. All20 migration files were rehearsed
in a new UUID synthetic local PG18.6 cluster; the outbound cron/net/vault scheduler
portion of `20260903021109_durable_beta_score_processor.sql` is intentionally omitted.
This is not the complete remote migration or hosted Auth stack rehearsal.

Before enablement: healthy authorized CLI Edge resource; patched target-major PG
compatibility; actual Edge handler/browser/bundle/CPU/memory acceptance; real existing
Web-session verification and user-scoped OAuth mapping; reviewed hosted connection,
non-local provider/route activation design with default-OFF flags; current remote
schema/config diff and explicit migration hash allowlist. Do NOT change the local
guard into an unrestricted remote switch. No remote server may depend on this Windows
host staying awake. Real production/Beta flags/settings are not altered by this run.

Minimum separate authorization request, only after those local prerequisites:
1. Read-only verify named Beta schema/config and exact frontend source/path.
2. Apply only reviewed missing additive migration hashes to the named Beta project;
   no bulk import/delete, account backfill or production schema change.
3. Deploy the reviewed function revision and isolated candidate path, then enable
   the approved user-scoped provider flag; no current-root overwrite.
4. Use designated synthetic Beta A/B identities for body/meal CRUD, canceled/confirmed
   delete, replay/conflict/timeout/reload, anonymous and real-login isolation smoke.
   Approve test write/delete scope explicitly; never touch real health records.
Risks: auth mapping, provider mismatch, unsupported target/runtime, retained-data
availability. Rollback closes new writes and disables the candidate provider/path,
restores prior function/UI revision, but keeps all new tables/records/receipts and
a read-only export path for authorized recovery. Do not DROP tables or redirect an
unsettled SQL mutation into Sheets. Existing legacy records are preserved throughout.
Incremental remote cost/resources UNKNOWN pending target measurements; added paid
services0. The package is ready for **conditional review**, not activation.

## 2026-09-13 — canonical D workspace and manual SQL continuation

Canonical local development entry:
`D:/Dev/Projects/health-companion-canonical-20260913-020110`.
It is an independent, snapshot-derived repository retaining baseline
`423da056b0ee544bb5aac3b19346542e2e2a5003`, refs, history and original dirty work.
The two original D folders still have duplicate linked-worktree identity; they were
not repaired in place, deleted or overwritten. No Git objects/metadata in the new
checkout depend on the C project. The Codex task's original workspace root was not
automatically changed; explicitly select this D entry for subsequent development.
Recovery and detailed topology evidence are in the matching
`D:/MigrationReports/dual-project/20260912-2035/git-manual-sql-20260913-020110` run.

### Actual local manual call graph

| Node | File / function |
|---|---|
| Existing body editor | `index.html:openWeightEditor/loadWeightFormDate`, weight form submit/delete |
| Same local provider for reads/writes | `scripts/local-engine-web.js:localEngineRequest`; explicit loopback flag only |
| Authenticated HTTP | `scripts/local-engine-server.ts` -> existing `dispatchLocalEngine` -> `LocalEngineRuntime.handle` |
| Trusted identity | Existing verified ES256 synthetic subject -> `authenticateNativeUser/resolveNativeIdentity` -> canonical user; no body user ID |
| Body SQL | `manual-body-local.ts:ManualBodyLocalStore.write/read/status`; receipt and record in one PostgreSQL transaction |
| Body read-back | `getBodyRecords` under authenticated non-BYPASSRLS role -> existing body record/chart/editor |
| Meal SQL / engine | Existing `LocalEngineRuntime.mutate` receipt+meal transaction -> existing queue/portable compute -> history/head -> bounded snapshot |
| Meal read-back | Existing nutrition range/list/editor in `index.html`; same provider, historical dates editable |

Manual body uses `engine_manual_body_records`, not `beta_health_records`.
`source=MANUAL_WEB` and `analysisStatus=ANALYSIS_PENDING` explicitly distinguish raw
saved measurements from analysis. Weight and body-fat zero/null semantics are retained.
Body data is **not** injected into unsupported mobile domains or the frozen score
bridge; no synthetic goal, fat mass or score is fabricated. No new score is added.
Nutrition continues confirmed-label arithmetic and existing experimental engines;
unknown/partial nutrients stay null in the local UI, while actual measured zero stays zero.
Labels are synthetic fixtures/user supplied provenance, not a verified food database.

Reads accept explicit real-calendar dates, at most366 inclusive days; the old implicit
28-day restriction is not silently imposed on a selected historical window. Existing
per-table5000-row guard remains; body allows one active user/day and at most366 rows.
Today summary cards retain today's meaning while the meal list labels its chosen range.
User/session/range/sequence guards prevent late body/nutrition responses from replacing
the current view. Default/remote legacy provider, UI and login remain unchanged.

Body receipts bind a stable UUID to the original request hash and canonical owner.
Replay is idempotent, mismatched payload rejects, stale revision rejects, tombstones
do not revive. After response loss the browser queries the actual receipt before
reporting failure; unresolved/retryable requests retain the original envelope.
Service-role SQL still has explicit tenant predicates; authenticated reads exercise
the canonical resolver through RLS, not owner/superuser-only acceptance.

Local PostgreSQL limits: lock2s, statement10s, idle transaction10s, transaction15s,
connect5s. These are engineering test bounds, **not** a production SLA. HTTP admits
at most8 active requests; slots are released only when server work actually ends.
Background polling is non-overlapping. Recognized SQL/connection timeout errors return
503 with a retryable state. Saved meal rows remain saved when analysis fails;
analysis is returned as pending and the durable queue remains the source of recovery.

### Future activation package — preparation only

- Additive migration proposal: `20260912182042_manual_body_local_sql.sql`; two tables,
  owner/date indexes, body SELECT RLS, narrow authenticated/service-role grants.
  It is rehearsed only in new UUID-named loopback synthetic PostgreSQL18.6 clusters;
  no existing database is reset. Old tables/columns and mobile ingestion are untouched.
- Keep `window.HEALTH_ENGINE_LOCAL_CONFIG.enabled` absent/OFF in shipped Web;
  `HEALTH_ENGINE_LOCAL_ONLY=1` is a local host guard, not a production rollout switch.
  Never deploy the synthetic login issuer or put privileged credentials in the Web.
- Before any remote action, separately authorize the exact Supabase project/environment,
  the specific migration file/hash, real verified-auth/canonical mapping adapter,
  API deployment and Web flag target, and synthetic-only smoke write/delete identities.
  Current target identity is unspecified: remote execution remains unauthorized.
- Require actual Edge/runtime execution and real OAuth integration gates before activation.
  Windows/Python is not a product server dependency; ordinary local Deno is not Edge.
- Smoke scope: A/B/anonymous, expired/forged subject, raw body and meal CRUD/read-back,
  revision/replay/timeout, cancellation/tombstone, and no old score after deleted inputs.
  Rollback first disables the new route/flag and restores old UI/provider; retain new
  tables/receipts/data for investigation. No destructive table rollback is automated.
- No paid resources or external service added. Remote resource/cost expectations are
  UNKNOWN until the target runtime/environment is approved.

Photo model, food reference validity, new score validity, real Google OAuth, remote
Beta, Android OEM, iOS and production release remain independent open gates.

## 2026-09-12 blocker closure — current execution path

This section supersedes the earlier Python-host limitation below, without erasing its
historical evidence. Baseline `884ffa280e660f0bb749528bbcae7eeaea1151eb`; no original
score formula, golden fixture, CURRENT routing or pre-existing Android edit changed.

| Actual node | File / function |
|---|---|
| Existing meal UI | `index.html` meal handlers -> `scripts/local-engine-web.js:localEngineRequest` (local flag only) |
| HTTP | `scripts/local-engine-server.ts` -> `mobile-health-beta/index.ts:dispatchLocalEngine` -> `LocalEngineRuntime.handle` |
| Verified identity | `scripts/local-engine-auth.ts:createSyntheticAuthority` -> existing `authenticateNativeUser` / `resolveNativeIdentity` -> `beta_resolve_native_auth_identity` |
| Input / queue | `local-engine-runtime.ts:mutate` -> existing receipt/meal transaction / `engine_enqueue_meal`; canonical ingestion uses existing `beta_ingest_health_mutation` |
| Computation | `LocalEngineRuntime.compute` -> `engine-portable.ts:PortableEngineRuntime.execute` -> `computeDomainRequest` -> `aggregate`, `derive`, `domainOutputs` |
| Frozen formulas | Existing `fixtures/algorithm-golden/apps-script-health-score-v1.0.snapshot.js` functions; no duplicate formula implementation |
| Storage / return | Existing claim/generation/lease checks -> atomic history/head + original score bundle -> PG snapshot -> existing Web panel/meal form |
| Python | Reference/test-only `domain_runtime.py`, original package and differential fixture generator; no necessary application-path import or subprocess |
| Supabase CLI Edge execution | **BLOCKED / NOT EXECUTED** before handler startup: Docker engine pipe unavailable after backend socket-access failure |

Only aggregation, empty-catalog confirmed nutrition normalization, exact Python-style
mean/rounding and domain glue were ported. All score functions are reused. The parity
contract was written before differential execution; explicitly versioned JS JSON
fingerprints differ lexically from Python, with immutable history retained. Native PG
tests separately verify replay, revision sensitivity, tombstones and generation safety.

### Edge preparation is not an Edge PASS

CLI2.115.0 and host Deno2.9.6/V8 15.0/TS6.0.3 were recorded; no upgrade performed.
Actual Edge Runtime version is UNKNOWN because it never started. `functions serve
--help` was inspected before a bounded isolated-project serve attempt. No original
Supabase stack, migrations, outbound cron or remote worker was started. Docker4.88.1
reported `sailor-ingest.sock` system-access failure then shut down its engines. No
factory reset, socket removal, permission change, alternate daemon/tunnel or
substitute `deno run` evidence was used to claim Edge execution.

[Supabase local-runtime documentation](https://supabase.com/docs/guides/functions/development-environment)
distinguishes CLI Edge Runtime from ordinary Deno. [Official resource limits](https://supabase.com/docs/guides/functions/limits)
currently list256MB memory,2s CPU/request,150s/400s free/paid wall limits,150s request
idle limit and20MB CLI bundle (5MB server-created bundle). These are requirements,
not acceptance results. The frozen+portable source is57,684 raw bytes, not a built
Edge bundle. Host benchmark5000 synthetic records/28days measured215.70ms wall and
11,620,488-byte heap delta; neither is actual Edge CPU or peak-memory evidence.
Actual Edge bundle, resource, connection and Browser tests remain NOT_RUN.

### Reproduce / future enablement package

1. Use a reviewed official PostgreSQL18.6+ portable server. Set only the current
   shell's `LOCAL_ENGINE_PG_BIN`; harness verifies18.x>=18.6 before initdb, binds
   loopback and creates a new UUID cluster/database. Original18.4 and DBs stay intact.
2. Generate Python reference fixtures, run `deno test --config config/engine-local.deno.json
   --allow-read tests/engine-portable.test.ts`; then `node scripts/test-local-engine-native.mjs`
   and `node scripts/test-local-engine-http-run.mjs`. No Deno `--allow-run` is granted.
3. Browser runner requires existing `ENGINE_PLAYWRIGHT_MODULE` and
   `ENGINE_BROWSER_EXECUTABLE` absolute paths; run `node scripts/test-local-engine-browser.mjs`.
   It owns a fresh DB, once-only expected native dialogs, trace redaction and cleanup.
4. After Docker is repaired through authorized host administration, first run
   `node scripts/check-local-edge-resource.mjs`. This is a resource preflight only.
   Prepare/verify an isolated CLI function host with a dedicated local PG connection,
   same canonical identity adapter and portable engine; current loopback DB guard must
   not be broadened to arbitrary hosts. Run actual handler/auth/PG/resource tests and
   rerun the Browser workflow through that Edge host. Do not promote resource preflight
   or host Deno success into Edge PASS.
5. Any remote Beta enablement needs separate authorization for the named Beta project,
   additive migrations, server-side canonical mapping/grants, feature flags and deploy.
   No identity backfill, production auth merge or remote settings change is authorized.

Existing remote/default feature flags stay OFF. Rollback is disabling the local feature
flag and returning to existing Web routing; persisted versioned history remains intact.
No new cloud service/dependency is introduced. Future hosted resource/cost impact is
UNKNOWN until Edge measurement and current-plan review. Beta smoke must include real
OAuth, A/B/anonymous isolation, actual persistence/recompute and cancel/delete/reload;
synthetic signatures cannot establish real Google login. No remote operations performed.

## 2026-09-12 existing-runtime closure (supersedes activation claims below)

Source baseline: reachable ancestors `a3f02ea`, `64aeb3a`, `9cbd260` on
`codex/multi-domain-engine`, worktree `D:/Dev/Projects/web-health-companion-phase4a`.
The audit reads the actual commit diffs, not their reported test totals. The original
five tracked Android changes and untracked timeout test remain outside this track.
No checkout, cherry-pick, remote CI, push, deployment, account linking or backfill was performed.

### Before / after call graph

| Node | Baseline reality | Explicit local path now |
|---|---|---|
| Existing Web | `index.html:sessionPost`, `apiService`, meal form -> existing Apps Script API; new domains MISSING | same `index.html` form -> `scripts/local-engine-web.js:localEngineRequest`; loopback feature flag only |
| API | Python `engine_api.py:create_app` WSGI was test-callable, not mounted in existing app | `scripts/local-engine-server.ts` -> `mobile-health-beta/index.ts:dispatchLocalEngine` -> `local-engine-runtime.ts:LocalEngineRuntime.handle` |
| Verification | Beta `authenticateNativeUser` uses admin auth.getUser; Python callback was injected by tests | same native authentication function, backed locally by `local-engine-auth.ts:createSyntheticAuthority` ES256 signature/issuer/audience/expiry verification |
| Canonical mapping | `resolveNativeIdentity` -> `beta_resolve_native_auth_identity`; already exists | same function and SQL, seeded synthetic auth subject != canonical ID; absent mapping fails closed |
| Input / invalidation | engine_store.py SQLite path, no real app call | `LocalEngineRuntime.mutate` -> native PG `engine_meals` + receipt transaction -> `private.engine_enqueue_meal`; native health ingestion -> existing mutation function + opt-in rolling trigger |
| Worker | existing persistent Python JSONL infrastructure; new domains not connected | actual `beta_claim_score_recompute` -> `LocalEngineRuntime.compute` -> `PersistentPythonRuntimeAdapter.execute` -> `python-algorithm-worker.py` -> `domain_runtime.py:compute_domain_request` -> existing `aggregate_day`, `derived_metrics`, `DomainEngines.calculate` |
| Storage | proposed engine history/head schema; PGlite test only | native PG output history/head and original `beta_persist_score_bundle` in the same transaction, generation/lease checked before publish |
| Original scores | `score-bridge.ts:recomputeBetaScore` frozen eight-score bridge | unchanged computation, unchanged missing nutrition/training inputs; separate original `beta_health_scores` |
| Response / UI | new outputs MISSING from app | real PG snapshot -> existing meal list + experimental panel; `legacyTimeline` reads original persisted scores for existing overview; request receipts reconcile writes |
| Photo | perception adapter / fixtures only | MISSING model/weights/inference; local photo/handoff controls hidden, no fake success |

The local HTTP host calls the exported shared route dispatch, **not the production
`withSupabase` HTTP middleware**. It reuses the real native verification/mapping contract
and frozen queue/score functions. It does not claim a full local Supabase Auth stack.
The synthetic issuer verifies real signed tokens; it is not Google OAuth. No production
session, key or account is used. A/B isolation tests include the privileged write path
and low-privilege `authenticated` RLS reads. `service_role` has BYPASSRLS and is never a
frontend credential; its server SQL scopes exclusively to the verified canonical ID.

### Runtime choice and hard boundary

Actual local runtime: Deno 2.9.6 host + existing Python 3.12 persistent JSONL adapter +
native PostgreSQL 18.4. There is no second scoring implementation. Deno also executes
the unchanged JS score snapshot and compares all 28 original golden vectors against
the persistent Python worker exactly. Reference orchestration tests compare complete
domain bundles, including nulls, metrics, versions and timezone cases.

**SUPABASE_EDGE_DEPLOYABILITY = NOT_SUPPORTED_BY_THIS_HOST_ADAPTER.** A constrained
Edge worker cannot spawn this Python process. The Windows test host is not a formal
service dependency. Existing CURRENT policy is unchanged. Future options are a
runtime-compatible core port with exact differential tests, or an independently hosted
Python worker with explicit operations/security/cost review. Neither service nor public
tunnel has been enabled. This local proof does not close the remote target-runtime gate.

### Local database and migration rehearsal

`scripts/local-engine-postgres.mjs:createLocalPostgres` creates a unique
`health_engine_<uuid>` database in a new native cluster bound to 127.0.0.1 on 57483
(Web) or 57484 (tests). It never reads DATABASE_URL, existing secrets or tunnel config.
Each database manifest records server version/address/name and SHA256 of every migration.
Only synthetic accounts/records are seeded. The minimal `auth.users`, `auth.identities`
and `auth.uid()` compatibility schema is explicitly local; no OAuth server is imitated.

The migration chain is applied in filename order. The durable processor migration's
outbound pg_net/cron/vault authorizer/scheduler sections are omitted; real queue, lease,
generation and retry SQL is retained. Therefore this is **native PostgreSQL schema and
repository rehearsal**, not a complete Supabase deployment rehearsal. PGlite results
remain a separate legacy regression and are not evidence for native PostgreSQL Gate 3.

New proposal: `20260912041126_engine_local_runtime_integration.sql`, after existing
`20260912032458_multi_domain_engine_versioned_outputs.sql`. It adds meals, idempotent
receipts, mapped read policies, and bounded invalidation. No identity table replacement
or account merge exists. Health rolling invalidation needs the session setting
`health.engine.experimental=on`; absence leaves existing remote behavior unchanged.
Meal changes invalidate old/new dates and their necessary forward 27-day windows,
capped at current Asia/Taipei date. Snapshot/input limits are 28 days and 5,000 rows;
this is not an unbounded historical reporting service. Generic/DST attribution is tested
in the Python reference adapter; the local Web meal form is explicitly Asia/Taipei only.

Publish checks generation and lease inside the same transaction as both score stores.
Replay receipts cannot resurrect tombstones; stale revisions fail. Pending or failed
recompute surfaces STALE without rewriting historical payloads. Delete-all produces
INSUFFICIENT_DATA rather than promoting old valid scores. A job failure retains actual
queue retry state; test-only clock acceleration is disclosed separately from live HTTP.

### Enablement preparation — do not execute remotely

1. Local reproduction: `npm ci --ignore-scripts` (native PG binary optional, Windows x64
   harness); existing Python environment; `node scripts/start-local-engine-e2e.mjs`.
   Deno config/lock is isolated in `config/engine-local.deno.*` so the pre-existing
   untracked Beta `deno.lock` is not included in this delivery. Browser URL is
   `http://127.0.0.1:57841/`, synthetic A/B only. No external CDN/OAuth requests allowed.
2. Native tests: `node scripts/test-local-engine-native.mjs`; HTTP tests require that
   local host: `node --test tests/local-engine-http.test.mjs`. Logs are captured by
   `scripts/run-engine-evidence.ps1`, including command, source hash, UTC start/end and exit.
3. Defaults: Web flag absent/OFF; `HEALTH_ENGINE_LOCAL_ONLY` absent/OFF; registration
   rejects nonlocal settings/hosts. Disable flags and stop the dedicated host to restore
   the original Web/API route. Do not delete remote tables as a rollback shortcut.
4. Future Beta requires separately approving the exact target project/environment,
   runtime architecture, provider/token verification path, staged migration apply,
   feature flag enablement, smoke accounts and rollback plan. **None approved here.**
   Production requires another independent authorization and data/backup review.
5. Native smoke: A create -> receipt replay -> stored nutrition version -> frozen score
   unchanged -> B denied -> update -> stale revision denied -> delete -> null latest.
   Browser smoke must also complete the blocked confirmation/reload path before claiming
   the complete Web Gate. See ENGINE_TEST_REPORT.md.
6. Paid resources added: 0. Local processes use existing CPU/RAM/disk; no remote service
   estimate is justified before architecture choice. Expected remote cost = UNKNOWN.
   No permanent power, sleep, security-policy, permission or secret changes were made.

Independent gates remain: PHOTO_MODEL_IMPLEMENTATION, PHOTO_REFERENCE_DATA_VALIDATION,
DOMAIN_SCORE_VALIDITY, REMOTE_BETA_INTEGRATION, ANDROID_REAL_DEVICE_E2E,
IOS_BUILD_AND_DEVICE, PRODUCTION_RELEASE. None is removed or counted as complete.

## Stage 0 audit

Audit base: `codex/phase-4a-tester-access`, HEAD `64bf2e33e4889d4fedd91de429ddb7da09bac411`.
The pre-existing five tracked Android beta.12 changes and untracked timeout test are outside this engine track. They must not be committed with engine work.

| Area | State before this track | Existing implementation / extension point |
|---|---|---|
| NUTRITION_MODEL | PARTIAL | HDL v2 `meals`, `meal_items` proposal; legacy confirmed meal flow |
| NUTRITION_ENGINE | PARTIAL | Python `HealthScoreEngine.score_nutrition` scores provided nutrients, does not resolve food references |
| FOOD_DATABASE | PARTIAL | `foods`, `food_aliases`, `nutrition_sources` in schema design; no verified offline catalog bundled |
| PHOTO_FOOD_FLOW | EXISTS | Web ChatGPT handoff + user confirmation; not an authoritative nutrient reference |
| SLEEP_ENGINE | EXISTS | Frozen Python / Apps Script duration, stages, continuity, regularity components |
| ACTIVITY_ENGINE | EXISTS | Frozen steps + energy/baseline formula |
| CARDIO_ENGINE | PARTIAL | RHR/HRV inputs in recovery; no independent cardiovascular contract |
| BODY_ENGINE | EXISTS | Frozen weight/fat mass/goal/baseline components |
| RECOVERY_ENGINE | EXISTS | Frozen HRV/RHR/sleep/training/subjective components |
| HEALTH_SCORE_V1 | EXISTS | Frozen Python engine + Apps Script snapshot; 28 golden fixtures |
| AGGREGATION | PARTIAL | Beta `score-bridge.ts` bounded assembly; no common materialized daily contract |
| RECOMPUTE | EXISTS | Beta dirty queue, lease/generation, bounded input reads and atomic score bundles |
| ENGINE_VERSIONING | PARTIAL | Existing outputs carry health-score-v1.0; independent domain history not integrated |
| DATA_COMPLETENESS | EXISTS | AlgorithmResult completeness 0..1; missing != measured zero |
| CONFIDENCE | PARTIAL | LOW/MEDIUM/HIGH coverage categories, unknown device quality |
| TEST_FIXTURES | EXISTS | 28 Apps Script/Python golden cases; Node runtime/Beta/queue contracts |

STAGE_0_AUDIT = PASS. Existing formulas and CURRENT routing remain frozen. This track extends the same Python package with normalization, aggregation, versioned orchestration and local storage; it does not fork the frozen formula implementation.

## Execution boundary

Canonical records → indexed daily aggregates → derived metrics → domain adapters → domain outputs → existing overall formula. Recovery consumes sleep/activity evidence, never overall. Cardiovascular is an explanatory personal-baseline adapter, not a diagnosis and not a new weight in health-score-v1.0.

No production activation, cloud deployment, paid model, or production migration is authorized. New score versions are development policies validated on synthetic fixtures only. Food reference coverage and real-world accuracy remain unvalidated. The existing Android runtime failure remains a separate outstanding real-device gate.

## Contracts and responsibilities

`domain_contracts.py` provides strict typed canonical records, daily aggregates and domain outputs. Completeness is always 0..1, scores/components 0..100. Missing scores remain null; measured zero remains zero. VALID, PARTIAL_DATA, INSUFFICIENT_DATA, STALE and ERROR are distinct. Every output includes version, confidence, missing fields, source quality, metrics, explanations, recompute reason, timestamp and input fingerprint. Staleness is an explicit caller policy, not inferred merely because a historical date is old.

`nutrition.py` separates perception from arithmetic. The perception protocol returns candidates, portions and uncertainty, never authoritative calories. The supplied fixture adapter is synthetic, not a deployed vision model. Caller-supplied food references carry preparation, aliases, units, provenance and version. Matching requires unambiguous identity and exact preparation; there are no invented cooking conversion factors. Confirmed manual totals may be used. Model-provided nutrient totals are ignored. Reference values scale by measured/estimated grams; serving sizes must be supplied. Ranges propagate and reduce quality. Unknown items make affected daily totals null while known subtotals remain separately available. There is no verified food catalog or micronutrient reference coverage bundled with this change.

`aggregation.py` reconciles revisions and tombstones by user/source/domain/record ID, rejects conflicting equal revisions and splits additive intervals across timezone-aware days. Sleep uses interval union and wake-date attribution, not a longest-session assumption. DST day length is respected. Incompatible units, invalid values and ambiguous overlapping vendors are flagged/excluded, not fabricated. Prorated interval data is marked estimated. Device/source quality is conservative and is not a calibrated clinical probability.

Derived metrics use observed daily values, not missing-as-zero. Windows include 7/28-day means, counts, trends, previous-only baselines, nutrition nutrient averages, active-day frequency and circular bedtime variability. Sleep efficiency/stages, subjective readiness, VO2 max and additional body metrics are unavailable unless supported by actual input; their absence is not repaired by invented values.

`domain_engines.py` adapts these contracts to the existing frozen `HealthScoreEngine`. Generic nutrition label targets are a scoring policy, not personal dietary advice. Fiber/sodium are explanatory components and do not change the frozen nutrition weighting. Cardiovascular is a personal RHR/HRV baseline indicator, not a clinical cardiovascular-risk score. Overall uses exactly the existing six inputs and weights; cardio receives no additional weight. Missing training remains missing. Legacy raw components that can exceed 100 are retained in metrics; displayed components are bounded without changing the frozen score.

## Storage and bounded recomputation

`engine_store.py` is the executable local SQLite integration. Canonical updates, record/date projection, daily/derived outputs, versioned score history and heads are committed in one transaction. Equal replay makes no changes; older revisions are ignored; a failure rolls back canonical data and output writes together. Subject timezone is persisted and cannot silently change: a future explicit projection migration is required for timezone changes.

Create/update/delete/moved-date corrections invalidate old and new affected dates and their following 27 days, capped by the requested through-date. The dependency DAG is cycle checked. The implementation conservatively regenerates the complete seven-score bundle for each affected date, rather than attempting component-level selective recomputation. It does not rescan all users or full raw history. Ingest accepts at most 5,000 records; intervals are bounded to 32 local dates; explicit recompute accepts at most 366 dates and fails closed if the required aggregate read exceeds its 425-day bound. Domain API reads are limited to 28 days and use one indexed join. Initial historical import still scales with imported days; it is not a constant-time operation.

History keys are `(user, date, kind, version, fingerprint)`; heads point to an immutable output. Version changes append alongside old versions, not overwrite their meaning. Repeated identical computation reuses the same history identity. Caller-provided references/targets are fingerprinted with the input evidence.

Read-only Beta inspection found existing `public.beta_health_records`, `public.beta_health_scores` and `private.beta_score_recompute_queue`. No new remote tables were created. The SQL migration is an additive proposal for history/heads only. PostgreSQL RLS defaults to deny for authenticated users until the existing canonical identity resolver is explicitly wired; `auth.uid()` is NOT assumed to equal the application user ID. Service-role history is insert/read only. Production transactions, identity policies and rollout remain subject to a separate authorized integration gate. PGlite tests cover the actual proposal, but are not evidence of deployed Supabase compatibility.

## API and frontend boundary

`engine_api.py` is an opt-in WSGI handler with a mandatory injected authentication callback. It does not open a listener or trust a client-supplied user ID. GET `/v1/engine/domain-scores/{domain}?start=YYYY-MM-DD&end=YYYY-MM-DD&version=...` returns score, status, confidence, completeness, version, component scores, missing fields and updated time. Invalid/unbounded ranges and duplicate parameters are rejected. Responses are private/no-store. The host must validate sessions and provide its trusted canonical subject; no default authentication is supplied.

`scripts/domain-score-response.cjs` is the frontend response adapter: zero renders as zero, null as an em dash, with distinct stale/error states. Neither this API nor adapter is mounted into existing Beta/Web CURRENT routing. End-to-end deployed ingestion → engine → UI remains a separate activation gate, not claimed complete here.

## Deferred physical-device utility

`scripts/android-real-device-gate.ps1` provides a bounded observation window with structured JSON. It does not install an APK, clear data, press Sync, force WorkManager or toggle networks. Default invocation never starts the app; `-StartApp` explicitly requests startup, which is not proof of a new work request. It reads only allowlisted runtime metadata and checkpoint presence and does not print credential stores.

The utility deliberately cannot declare HTTP, ingestion, engine recompute or score-update PASS from metadata alone. Full WorkInfo correlation, HTTP duration, backend ingestion and app score presentation need actual device/backend evidence plus the outstanding Android runtime/instrumentation work. This is an evidence-capture foundation, not a completed one-command end-to-end physical gate. Testing a nonexistent ADB path only verifies its fail-closed branch and does not establish whether a phone is currently connected.

## Reproduction

Use Python 3.12 with the project dev dependencies. Run `python -m pytest tests_python -q`, `node --test tests/*.test.cjs` (set `ALGORITHM_PYTHON` to that interpreter), `npm ci --ignore-scripts`, `npm run test:engine-db`, and `python -m scripts.benchmark_domain_engines`. The new GitHub workflow reproduces the targeted domain/property/frozen-formula, PostgreSQL and frontend gates; remote CI execution itself is not claimed. See ENGINE_TEST_REPORT.md and ENGINE_VERSION_MATRIX.md for measured scope and policy versions.
