# Multi-domain engine architecture (non-production)

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
