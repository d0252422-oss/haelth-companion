# Multi-domain engine test report

## 2026-09-12 — ENGINE_RUNTIME_BROWSER_BUILD_BLOCKER_CLOSURE (current)

整體專案已驗收完成率：UNKNOWN。首次有效基準
`known-scope-v0.1-provisional-2026-09-12`；暫定已知範圍32.0%，不是全專案進度。
STATUS=PARTIAL_BLOCKED_NOT_PASS. This section supersedes the historical summaries below.

Baseline reviewed: `884ffa280e660f0bb749528bbcae7eeaea1151eb`, reachable commits
`788dc4b`, `884ffa2`, `a3f02ea`, `64aeb3a`, `9cbd260`. No checkout/amend/reset/clean,
remote writes or unrelated Android edits. Audit hashes confirm all10 protected
Android/frozen files unchanged; separate Android audit preserves34 source hashes.
Runtime/Browser/build-preflight source is saved in local commit
`b251afac622a2bbe0d705916e5856c50e87dd800`; test manifests map the baseline plus
working-source hashes to that commit. Progress/instructions/report changes are saved
separately. No Android source is included in either scoped commit.

### Current results

| Gate | Result | Fresh evidence in `.engine-artifacts/blocker-closure/` |
|---|---|---|
| Progress baseline/tool | PASS_TOOL; overall UNKNOWN | `project-progress.json`;25leaves sum100;10tool tests included in Node suite |
| Portable runtime | CODE_PREPARED / LOCAL_HANDLER_PASS | `portable-final.*`, module graph and native tests; no necessary Python subprocess |
| Actual CLI Edge | BLOCKED / NOT_RUN | `edge-cli-preflight.*`, `edge-cli-final.*`; actual serve failed before handler because Docker engine pipe unavailable |
| Cross-runtime parity | PASS_FOR_TESTED_CONTRACT |57unchanged-reference cases plus3meta tests; original28goldens check score/completeness/confidence/missing/version |
| Native PostgreSQL18.6 / identity | LOCAL_PASS | `native-final.*`, `native-junit.xml`, `rls.json`, native DB ownership/manifests |
| Existing Web Browser | LOCAL_PASS; EDGE_BROWSER_BLOCKED | `browser-ts-deno-9c05576c-9599-4512-8280-11ca495aa502/report.json`, trace.zip, screenshots and redacted HTTP |
| APK preflight | COMPLETE / BUILD_BLOCKED | `android-preflight.json`, configuration-source-audit, original-guard exit1 |
| Android JVM/lint | FRESH_PASS |60tests;0lint errors/44unchanged warnings;36actionable tasks actually executed |
| Open source/security review | REVIEW_COMPLETED_WITH_FINDINGS | npm/Deno audits plus independent official PG18.6 acquisition and native-package limitations in version matrix |

Browser root cause is proven native `window.confirm`, not a custom modal or an assumed
tool resource limit: click stayed pending during a bounded150ms diagnostic hold, then
completed after a pre-registered once-only expected-message dismiss/accept handler.
Only this workflow's synthetic meal was targeted. No global auto-accept, confirm
override, deleted product confirmation or direct DELETE substitution was used.

Pure TS Browser run10:48:53.759–10:50:29.367UTC:1workflow/10stages;40real HTTP responses;
0page errors,0external requests.150g→300kcal;200g→400kcal. Cancel retains revision2
and stored heads. Confirm creates revision3 tombstone; nutrition/overall score and
nutrition aggregate become null/INSUFFICIENT_DATA. Reload does not resurrect input;
B sees no A data. Error/loading terminates; retry/double-click creates one record.
Formatter0/null and0.85→85% are separately labeled pure-formatter Browser regressions,
not fabricated DB fixtures. Trace JWTs were redacted and scanned. The earlier
legacy-Deno/Python Browser run is retained separately and is not counted again.

### Final fresh counts (no duplicate reports or nested vectors)

| Suite | Cases / checks | Final report |
|---|---:|---|
| Python reference |134test cases PASS | `python.xml`, `python-fresh.manifest.json` |
| Node |185test cases PASS | `node-final.xml`, `node-final.manifest.json` |
| Portable Deno differential |60test cases PASS | `portable-final.xml`, `portable-final.manifest.json` |
| Native Deno/PostgreSQL |6test cases PASS | `native-junit.xml`, `native-final.manifest.json` |
| HTTP |1test case PASS | `http.xml`, `http-ts-pg186.manifest.json` |
| Android JVM |60test cases PASS | `android-junit/`, `android-fresh-tests-lint.manifest.json` |
| PGlite proposal regression |9custom checks PASS, not native PG | `pglite-fresh.*` |
| Browser |1workflow PASS,10stages not10extra cases | `browser-portable-ts.*` and detailed run directory |

Total fresh final test cases=446, failed=0, cached counted=0, skipped=0. Separately:
9PGlite custom checks and1Browser workflow. The repeated10independent review diagnostics,
28vectors nested in suites, reruns and old Browser run are not extra test cases.
Build/check tasks are not test cases. `:app:verifyBetaRuntimeConfiguration` fresh exit1
is retained as1failed required build-guard task; original APK assembly failure remains
unresolved. assembleDebug was not re-run without configuration; no localDebug variant
was created because JVM/lint already cover the available non-device value.

Required packaging environment names missing: `HEALTH_COMPANION_BETA_API_BASE_URL`,
`HEALTH_COMPANION_BETA_SUPABASE_URL`, `HEALTH_COMPANION_BETA_SUPABASE_PUBLISHABLE_KEY`,
`HEALTH_COMPANION_GOOGLE_WEB_CLIENT_ID`. Also missing legacy bootstrap names:
`HEALTH_COMPANION_BETA_AUTH_SETUP_URL`, `HEALTH_COMPANION_BETA_APP_LINK_HOST`.
Gradle reads process environment only; checked known local sources and user/machine
presence checks found no usable configuration. No values were printed, invented or
retrieved remotely. LOCAL_TEST_BUILD=NOT_CREATED; BETA_APK_BUILD=BLOCKED_REQUIRED_CONFIGURATION;
DISTRIBUTABLE_BETA_READY=NO. Existing guard only covers assembleDebug; release must
not be used to bypass it. No signing/OAuth/credential change occurred.

Independent review initially reproduced10counterexamples: timestamp canonicalization,
microseconds, invalid calendar, typed contract/tombstone handling, identity collision,
exact mean and Santiago midnight DST. All were fixed in glue and re-tested against
unchanged Python. The independent review report and pre-fix observations remain in
`review/`; initial type-check diagnostics were tool-output evidence, not test cases.
No golden expected change or post-hoc tolerance widening occurred. Cross-runtime
engineering parity does not validate a health rule or an untested numeric population.

Fresh typecheck/lint/Ruff/Mypy/wheel passed; no APK was published. Native PG test data
is synthetic and loopback-only. Low-privilege authenticated/anon have no superuser or
BYPASSRLS; service_role has BYPASSRLS, with separately tested server tenant guards.
Synthetic signed login proves neither Google OAuth nor a full Supabase Auth stack.
One legacy RLS summary output path was discovered after the first native run and
redirected to this phase; the original DBs/logs/manifests remain intact. The reused
role-summary file has no run identity and must not serve as prior-run evidence.

Performance: host Deno5000synthetic steps/28days=215.70ms wall, heap delta11,620,488bytes
(not peak).1record cold52.81ms,40records18.71ms; order/warmup affects measurements.
Native PG performance/EXPLAIN and per-job measurements are in `native-performance.json`.
No production SLA or actual Edge CPU/memory/bundle PASS is claimed; SQLite benchmarks
were not re-run because the SQLite path did not change.

Remaining gates retain zero acceptance weight: actual Edge+EdgeBrowser; lawful Beta
APK settings/build; AndroidOEM, iOS, realOAuth/remoteBeta; photo model/accuracy;
food reference licensing/validation; domain real-world validity; release/privacy risks
and the remaining documented roadmap. No real-device or remote CI evidence was used.
PHOTO_MODEL_IMPLEMENTATION=MISSING; FOOD_REFERENCE_VALIDATION=NOT_VERIFIED;
DOMAIN_SCORE_REAL_WORLD_VALIDITY=EXPERIMENTAL_UNVALIDATED.

NEXT_ACTION: authorized host repair of Docker's socket-access failure without reset or
permission bypass, then isolated CLI Edge handler/PG/resource and Edge Browser tests;
when legitimate complete Beta settings are supplied locally, preflight then original
variant build. Full delivery scope confirmation is separately needed for overall%.
No local service must depend on production credentials. Raw DBs/evidence are retained;
only owned test processes are stopped. No automatic session-resume guarantee is made.

REMOTE_PUSH=NO; REMOTE_BETA_WRITES=0; PRODUCTION_WRITES=0; DEPLOYMENTS=0;
PAID_SERVICES_ADDED=0. Necessary gates remain blocked, so this turn is not overall PASS.

## 2026-09-12 — ENGINE_EXISTING_RUNTIME_AND_WEB_LOCAL_E2E_CLOSURE

**Overall: PARTIAL / NOT PASS.** The native local runtime, PostgreSQL and HTTP paths
are implemented and freshly tested. The complete browser Gate remains BLOCKED by the
automation resource's native confirmation handling. APK assembly also failed its
existing required Beta configuration check. These are not hidden by passing suites.
The host adapter cannot run Python inside constrained Supabase Edge; remote runtime
compatibility remains a separate unresolved architecture dependency.

Reviewed reachable commits: `a3f02ea`, `64aeb3a`, `9cbd260`. Original engine algorithms,
golden expectations, CURRENT policy and pre-existing Android source edits were preserved.
This section supersedes reuse of the prior 368-result report as current evidence.

### Gate disposition

| Gate | Result | Evidence / boundary |
|---|---|---|
| 0 baseline audit | PASS | Actual source/diffs and before/after call graph in ENGINE_ARCHITECTURE.md; `audit.json`, per-command manifests and file hashes |
| 1 provenance | PASS_REVIEW_ONLY | ENGINE_VERSION_MATRIX.md rules/units/source/limitations. All new score adapters EXPERIMENTAL / UNVALIDATED; no scientific accuracy claim |
| 2 runtime | LOCAL_DENO_HOST_PASS / EDGE_NOT_SUPPORTED | Real existing route dispatch, existing persistent Python worker; no mock engine or rewritten score core. Production Edge middleware/service deployment NOT tested |
| 3 identity / native PG | LOCAL_PASS | ES256 signature/issuer/audience/expiry checks; existing canonical mapping; actual low-privilege RLS and privileged server tenant checks; native PG 18.4 |
| 4 existing Web | BLOCKED_NOT_PASS | Browser create, reload, update and A/B switch observed. Delete-confirmation automation blocked; delete/reload, error/retry and repeated-click UI closure NOT RUN |
| 5 recompute | LOCAL_PASS_WITH_SCOPE | Actual queue/generation/lease, concurrent replay/drains, stale revision, old/new dates, rolling invalidation, failed worker retry, atomic publish and delete reconciliation. Web timezone is Asia/Taipei; general/DST reference tests are separate |
| 6 fresh regression | PARTIAL | Fresh suites below; APK assembly fails expected-project configuration gate. No cached cases included in fresh counts |
| 7 enablement preparation | PREPARED_NOT_ENABLED | Architecture options, migration rehearsal omissions, flags, rollback, smoke and exact future approval targets documented; no remote execution |

### Fresh suites (count independently; do not add assertion/vector counts again)

| Suite | Command / report under `.engine-artifacts/runtime-e2e/` | Result |
|---|---|---|
| Python | `.venv/Scripts/python.exe -m pytest tests_python -q --junitxml=.../python-final.xml`; `python-final.log` + manifest | FRESH_PASSED 134 |
| Node | `node --test tests/*.test.cjs`; `node-ui-closure.log` / `node-junit.xml` | FRESH_PASSED 172, including 3 new UI/transport contract tests |
| Actual Deno + native PostgreSQL | `node scripts/test-local-engine-native.mjs`; `native-closure.log`, later `native-junit.log` / XML | FRESH_PASSED 6 cases; includes 28 original golden vectors, not 28 extra cases |
| Live local HTTP | `node --test tests/local-engine-http.test.mjs`; `http-closure.log` | FRESH_PASSED 1 integrated case with CRUD, receipt replay, tenant isolation, missing/invalid auth and original dashboard version checks |
| Legacy PGlite proposal | `node scripts/test-engine-postgres.mjs`; `legacy-pglite-regression.log` | FRESH_PASSED 9 custom checks; **WASM/in-memory, not native PostgreSQL Gate evidence** |
| Android JVM | repo `./gradlew.bat --no-daemon --rerun-tasks --no-build-cache testDebugUnitTest`; `android-fresh.log`, copied `android-junit/*.xml` | FRESH_PASSED 60, 26 actionable tasks executed; test XML timestamps 2026-09-12T04:28Z |
| Deno type/lint | `deno-closure.log` | FRESH_PASSED; real Deno check. Local adapter lint explicitly permits dynamic repository `any`, require-await and npm import conventions; not a claim of strict repository interface types |
| Python lint/types/wheel | `static-final.log` | FRESH_PASSED Ruff, Mypy, wheel build; generated build metadata remains untracked |
| Android APK + lint combined | `android-build-lint-fresh.log` | FRESH_FAILED: `:app:verifyBetaRuntimeConfiguration`, missing/invalid expected-project Beta API config. No guard bypass, fake config or credential change |
| Android standalone lint | `android-lint-fresh.log` | FRESH_PASSED: 30 tasks executed, 0 errors / 44 warnings; no Android warning/source edits folded into this track |
| Browser | `browser-evidence.json` transcription of actual CUA AX/DOM observations | PARTIAL, not an automated PASS suite |

Cached cases counted as fresh: **0**. Previous cached Android reports are superseded
only by this turn's actual JVM execution. No connected/instrumentation/OEM, iOS,
remote CI, live OAuth, full Supabase Edge or production tests were run. The native
PostgreSQL harness uses a minimal synthetic Auth schema, not an actual Supabase Auth server.

Earlier red runs are retained: missing canonical updated_at, manual-confirmation source
tag, SQL JSON serialization and PostgreSQL driver Date handling were integration defects
found and fixed before the final HTTP/native reruns. A test idempotency hash fixture was
also made unique by source ID. Golden expected values and the original formula were not
changed. The separate APK failure is unresolved, not reclassified as a passing test.

### What was actually observed in the existing Web

The existing meal editor, not a second dashboard, submitted a clearly synthetic label:
200 kcal / 10 g protein / 20 g carbs / 5 g fat per 100 g. A's 150 g record displayed
300 kcal / 15 / 30 / 7.5, nutrition 17.6, completeness 67%, version
`nutrition-score-v1.0`. A page reload retained it. Updating to 200 g displayed
400 kcal / 20 / 40 / 10 and nutrition 23.5. Switching to B showed no A meal or outputs;
switching/reloading A again retained the 400 kcal record. Other missing domains showed
INSUFFICIENT_DATA, not poor-health zero. The original overview did not take the new
experimental nutrition result as an original frozen-score input.

Deleting through the existing form reached its native confirmation. The browser tool
then timed out on focus-emulation/dialog handling, including its documented dialog API,
CDP dialog control and an alternate Chrome tab. No confirmation override was injected.
Accordingly **MEAL_CREATE_UPDATE_DELETE_BROWSER_E2E is not PASS**. Live HTTP DELETE
passes separately; it is not substituted for the missing browser deletion evidence.
Formatter 0/null, 0.85 -> 85%, STALE, error/retry structure and late-account-response guard
have separate Node unit/contract evidence, not fabricated browser observations.

### PostgreSQL and identity scope

Both native test accounts have distinct auth subjects and canonical UUIDs. Invalid,
expired and missing-map identities fail closed; client owner fields are rejected.
Low-privilege `authenticated` is neither superuser nor BYPASSRLS; `anon` protected reads
fail, A's mapped RLS read cannot see B, authenticated writes are denied. The local
`service_role` is BYPASSRLS; mutations/receipts/original-score reads are separately scoped
by server-verified identity. No service credential is exposed in Web code or fixtures.
`rls.json` records roles/grants; `native-db.manifest.json` records actual server/database
identity and migration hashes. Actual ingestion uses the existing `beta_ingest_health_mutation`
and durable recompute functions. Snapshot heads and payload versions are persisted/read,
not recreated only for the response. Receipt replay after tombstone does not resurrect it.

### Fresh performance — measurements, not SLA

- PYTHON_SQLITE_LOCAL: 1 user / 365 records: ingest 2,868.89 ms, aggregate 1.05 ms,
  bundle 1.56 ms, late update 155.70 ms. 10 users / 3,650 records: ingest 27,893.53 ms,
  aggregate 3.20 ms, bundle 5.75 ms, late update 296.08 ms. Both late updates recompute
  21 dates, 24 SELECTs; 28-day API read 1 SELECT. `sqlite-benchmark-fresh.log`.
- POSTGRESQL_LOCAL: native EXPLAIN ANALYZE JSON for the bounded history-head read is
  in `native-performance.json`; database/server/migration identity in native manifest.
  This is distinct from old PGlite EXPLAIN data.
- TARGET_RUNTIME_LOCAL: 1 synthetic user, 40 canonical records across 8 days and
  delete/recompute: approximately 1.7 seconds in the closure run. Individual actual
  Deno->Python compute durations and row counts are recorded in `native-performance.json`.
  Later JUnit rerun measurements may differ; the raw file is authoritative for that run.
- No percentile sampling, defined production SLA, dense population benchmark, remote
  network cost, multi-host contention or device power measurement. Remote resource/cost
  expectation is UNKNOWN pending architecture choice. No paid services were added.

### Remaining closure and enablement status

Next action: restore usable browser native-dialog automation (or review an accessible
confirmation UI as a distinct scoped change), then repeat the complete Web flow against
a newly created final-schema local database. Obtain appropriate build configuration
through the approved existing mechanism before APK assembly; do not paste credentials.
Before Beta enablement, resolve Edge-vs-host runtime architecture and separately authorize
the exact target environment, migrations and feature flags. All defaults remain OFF.

PHOTO_MODEL_IMPLEMENTATION = MISSING; PHOTO_REFERENCE_DATA_VALIDATION = NOT_VERIFIED;
DOMAIN_SCORE_VALIDITY = EXPERIMENTAL_UNVALIDATED; REMOTE_BETA_INTEGRATION = NOT_RUN;
ANDROID_REAL_DEVICE_E2E = NOT_RUN; IOS_BUILD_AND_DEVICE = NOT_RUN;
PRODUCTION_RELEASE = NOT_AUTHORIZED. These gates remain explicitly open.

REMOTE_PUSH = NO; REMOTE_BETA_WRITES = 0; PRODUCTION_WRITES = 0;
DEPLOYMENTS = 0; PAID_SERVICES_ADDED = 0. No overall completion percentage is claimed.

Date: 2026-09-12. Branch: `codex/multi-domain-engine`. Scope: development engine and local integration, not production or clinical validation.

## Results

| Gate | Evidence | Result |
|---|---|---|
| Python full suite | `python -m pytest tests_python -q` | 130 passed, 0 failed, 0 skipped |
| New domain/invariant cases | Included in Python total; 55 cases including a Hypothesis test with 60 generated examples | PASS |
| Frozen formula golden parity | Existing 28 golden cases included in Python total | PASS; original formula files unchanged |
| Node full suite | `node --test tests/*.test.cjs`, ALGORITHM_PYTHON points to Python 3.12 venv | 169 passed, 0 failed, 0 skipped |
| PostgreSQL migration proposal | `node scripts/test-engine-postgres.mjs`; embedded PGlite synthetic schema | 9 checks passed |
| Android unit reports | Existing worktree testDebugUnitTest reports | 60 tests, 0 failures/errors/skips; Gradle task up-to-date |
| Android build and lint | `gradle --no-daemon testDebugUnitTest lintDebug assembleDebug` | BUILD SUCCESSFUL; 54 tasks, 2 executed/52 up-to-date |
| Python lint | Ruff on package/new tests/benchmark | PASS |
| Python types | Mypy package + benchmark | PASS, 11 source files |
| Python artifact | `uv build --wheel --python .venv/Scripts/python.exe --out-dir .engine-artifacts/wheels` | PASS |
| Device utility | PowerShell parser + deliberately nonexistent ADB executable | PASS fail-closed branch only; no physical device inspected |
| Dependency audit | npm install pinned PGlite, scripts disabled | 0 reported vulnerabilities at install time |

Counted suite results: 368 (130 Python + 169 Node + 9 PostgreSQL checks + 60 Android report cases). The PostgreSQL checks are custom assertions, not pytest cases. Android results are valid cached Gradle reports, not newly executed device tests. Hypothesis examples are not added again to the count.

An initial `python -m pip wheel` invocation could not run because this uv-managed venv has no pip; the supported `uv build` fallback succeeded. No test failure is hidden by that tooling fallback. Remote GitHub CI was prepared but not dispatched or claimed as passing.

## Coverage

Contracts cover explicit null/zero, score bounds, completeness 0..1, strict shapes and unknown quality. Nutrition covers reference arithmetic, units, serving sizes, missing portions, cooked/raw mismatch, preparation identity, ranges, confirmed manual values, ignored model nutrient estimates, duplicates, partial meal totals and malformed nutrient metadata. No fixture is a real food accuracy certification.

Aggregation/recompute tests cover replay, order independence, latest revision, tombstones, moved dates, late data, same-revision conflict, source ambiguity, unit/outlier handling, sleep interval union, midnight/DST, observed rolling windows, personal baselines and cross-user separation. Transaction tests inject failure after writes and verify rollback; timezone tests prevent silent mixed projections. DAG cycle checks and unchanged overall mapping protect the frozen formula.

API tests exercise injected authentication, subject isolation, required bounded dates/version, duplicate/unauthorized scope and response contract. Frontend tests preserve zero versus null and stale/error distinction. PostgreSQL tests apply the actual proposal and verify RLS default denial, history immutability for service role, numeric/status checks, cross-user foreign-key rejection and rollback. EXPLAIN uses synthetic indexed history/heads for 1, 7 and 28 days.

## Performance: LOCAL_TEST_RESULT

Environment: Windows, Python 3.12.14, SQLite in-memory, synthetic steps only (one canonical record per user/day). This is a single local run, not a percentile distribution or production SLA. Initial import includes aggregation/derived metrics/seven-score bundles/history persistence for every day.

| Measurement | 1 user × 365 days | 10 users × 365 days |
|---|---:|---:|
| Canonical records | 365 | 3,650 |
| Initial ingestion | 2,030.67 ms | 21,997.94 ms |
| Initial SELECT queries | 732 | 7,320 |
| One-day aggregation | 1.08 ms | 2.23 ms |
| One-day score bundle | 1.62 ms | 1.54 ms |
| Late update recompute | 113.75 ms | 118.52 ms |
| Recomputed dates | 21 | 21 |
| Late update SELECT queries | 24 | 24 |
| 28-day API SELECT queries | 1 | 1 |

The late record is 20 days before through-date, so exactly 21 dates are recalculated, not all 365 or other users. Index plans were observed on SQLite and embedded PostgreSQL. Larger raw record densities, concurrent users, network round trips, device power use and remote PostgreSQL execution are not benchmarked. Raw benchmark/Node/PostgreSQL/build outputs are in ignored `.engine-artifacts/` locally; the durable measured summary is this file.

## Security and activation limits

No production writes, migrations, deployment, paid services, signing changes, credential output or secret rotation. The migration is a proposal only. Production authenticated RLS intentionally denies until canonical identity mapping is explicitly implemented/approved. The local API requires a trusted host authentication callback and is not mounted into production/Beta routing. Production credentials are not part of fixtures or commits.

The food catalog, real perception model, measured confidence calibration and real-world health accuracy remain UNVERIFIED. Full physical ingestion → WorkManager → bounded HTTP → backend → domain recompute → UI evidence remains UNVERIFIED_REAL_DEVICE. The deferred PowerShell utility captures allowlisted metadata, not full end-to-end PASS evidence. Outstanding Android runtime diagnostics from the preceding track are preserved, not declared repaired by Engine work.

## Delivery and next gate

Engine files are committed separately from pre-existing Android changes. No push or deployment is performed. New SQL: `supabase/migrations/20260912032458_multi_domain_engine_versioned_outputs.sql`. Frozen `engine.py`, `models.py`, original golden fixtures and CURRENT routing have no changes in this track.

Next authorized gates: review local engine policies/reference data and the proposed canonical-identity/transaction integration; then activate only in an explicitly authorized environment. Resume the independent physical-device Gate with an available device and correlate actual HTTP/WorkInfo/backend evidence. Do not request or synthesize manual Sync to manufacture evidence.

Overall: CONDITIONAL_PASS for the tested local implementation. Database/API production activation, perception/food accuracy and the full real-device gate are not PASS claims.
