# Multi-domain engine test report

## 2026-09-13 — manual release/exercise readiness (current; new execution)

RUN_ID=`health-release-exercise-20260913-120836`.
CURRENT_PHASE=`MANUAL_SQL_RELEASE_READINESS_AND_EXERCISE_MANAGEMENT`.
STATUS=`PARTIAL_BLOCKED_NOT_PASS`: local scope passes; actual Edge/OAuth/remote release
does not. Overall UNKNOWN; provisional known-scope32.0%, engineering+0.0pp,
ledger correction0.0pp, unchanged25 ×4 baseline. See per-leaf continuation accounting.

Canonical entry `D:/Dev/Projects/health-companion-canonical-20260913-020110`;
source baseline `efe83ed44034ac19d58e1f96e0c3c7dac6a41eaf` plus manifest hashes.
Final scoped source revision is recorded in the new external REPORT/CHECKPOINT;
it is not a repeat of the previous Git/manual SQL closure. The current task workspace
UI still points at old C; every shell/edit/test explicitly used canonical D. Initial
Git/index/environment safety audit passed; original Android and frozen source hashes
remain unchanged, and no original shared worktree or backup was altered.

Evidence root `D:/Dev/Evidence/health-release-exercise-20260913-120836`.

| Latest fresh suite | Result | New evidence under root |
|---|---|---|
| Node |201 named tests +5 whole-file assertion entrypoints;206 JUnit/TAP rows PASS | `regression-295a5857-7530-4b79-9b78-f6e2a895eb39/node-junit.xml` |
| Original-Web adapter/render units |21 named tests, already INCLUDED in Node201; stub transport/DOM only here | same Node report, `tests/manual-sql-ui.test.cjs` |
| Python reference |134 named tests PASS | same regression directory `python-junit.xml` |
| Deno portable/runtime |68 PASS:60 portable +8 auth/runtime;28 original goldens nested, not extra cases | same directory `deno-junit.xml` |
| Typecheck / scoped lint |2 tasks PASS, not cases | same directory command manifests/logs |
| Browser + actual handler/HTTP + native PG |10 integrated gates PASS, not ten unit cases | `manual-sql-e2e-3ed72589-4508-450e-8276-9e8b11287f69/report.json` |
| Revoked verified-Web mapping |9 read-path assertions INCLUDED in that integrated Gate, not extra9 tests | same Browser directory `web-revocation.stdout.log` |
| Progress integrity |PASS,32/100, overall UNKNOWN | regression progress log; final post-document check in external manifest |
| Static review build |New allowlisted artifact plus SHA/source manifest; CONDITIONAL/inert, not remotely enabled | external final artifact path recorded in REPORT |
| Actual CLI Edge / target PG17 / live Apps Script/Google OAuth / remote Beta |NOT_RUN or BLOCKED; no test credit | fresh `edge-preflight-20260913T041211Z/edge-resource-preflight.json` |
| Android JVM/lint/build/device, iOS, remote CI |NOT_RUN this Web/API-only run; preserved prior evidence is not fresh | no Android edits included |

Latest Browser interval:2026-09-13T05:10:12.665Z–05:12:28.593Z
(13:10:12–13:12:28 Asia/Taipei). It records source hashes before/after with zero drift.
The actual route goes through the application default.fetch and @supabase/server
middleware, then separate local signed authorities, canonical mapping, real PG and
portable engine. This is NOT a mock API and NOT actual Supabase Edge.
Python3.12.14, Node24.19.0, Deno2.9.6/TS6.0.3, PostgreSQL18.6,
postgres driver3.4.8, Playwright1.62.1, Chrome152.0.7977.84. CLI2.115.0,
Docker CLI29.7.2; actual Docker server/Edge unavailable. No dependency upgrade.

### New acceptance and fixes

1. Body/meal historical CRUD/replay/revision/response-loss/read-back remains passing
   through actual default handler. CORS origin/methods/preflight/gateway-prefix and
   no-store/error headers are checked. Raw body is saved without fabricated analysis.
2. Native RLS reads use non-owner authenticated/NOBYPASSRLS; backend service-role
   mutations have separate tenant/owner/FK checks. New Web-session key/issuer is
   distinct from native authority. Existing aliases are SELECT-only; subject+exact
   verified email+ACTIVE canonical mapping required. No native mapping is required
   for the Web-only synthetic account. Missing/conflict/revoked, A/B/anonymous,
   expired/forged token and frontend owner fields fail closed.
3. Web alias/users/timestamps are unchanged by normal CRUD; nine repository reads
   reject an identity revoked after initial resolution, including receipts/queue/
   timeline. This is service-role server authorization, not Web RLS or real OAuth.
   Real verifier transport error retains503/retryable through ten sequential handler
   attempts without exhausting admission. A real loopback fetch verifies10-second
   header/body cancellation; transport is explicitly stubbed only in separate unit tests.
4. Original training page adds SQL-backed catalog management: own rename, personal
   system alias, archive/restore, own-unused permanent-delete and separate set CRUD.
   Stable ID, historical name snapshot and raw facts survive rename/archive. Names
   are safely displayed,0kg is0, session duration is not multiplied by set/date rows.
5. Referenced deletion rejects, no CASCADE; low-role write and ownership reassignment
   reject. Real API concurrency/replay and direct SQL reference/delete race pass.
   Invalid multi-set request rolls back with no receipt or partial sets. Direct
   archived INSERT rejects while same-ID historical edits remain allowed.
6. Browser exercises native delete dismiss/accept, referenced denial, restore, new
   context persistence, system-alias B isolation and provider/database cache isolation.
   Real committed write response plus receipt transport can both be lost: immutable
   envelope persists, navigation/quick-workout restore retry, exact replay stores one
   zero-volume session. Reset unlocks controls and removes previous-account state.
7. Body status now explicitly ALGORITHM_NOT_CONNECTED/no job; manual workout score
   adapter is similarly unconnected. Existing nutrition queue/engine remains real and
   experimental; deleted inputs do not leave a stale valid latest score.
   Frozen health-score-v1.0 source/weights/inputs/goldens were NOT changed.

### Failure history, measurement and remaining limits

All earlier red attempts remain under this new evidence root. Initial SQL race
assertion expected23503, but ON DELETE RESTRICT correctly returns documented23001;
the exact assertion was corrected, not an engine expected value/tolerance. Initial
Browser selection assumed a mobile training tab that does not exist; desktop's
actual sidebar was used. TypeScript unit typing and the old FAB source-shape regex
were updated for the deliberate draft safety guard. Independent review found genuine
draft-navigation/reset, late-catalog, narrow-grant, archived-reference, auth transport
and privileged-read gaps; fixes received fresh regression and counterexample tests.
Latest fresh failures0, cached counted0; earlier failed/repeated suites are not summed.
Independent Codex subagents reviewed bounded scopes, not an external AI review claim.

Fresh PG18.6 body lock observation2027.743ms; training2016.373ms, configured2s lock
timeout, predeclared local HTTP ceiling6s. Previous2029.938ms observation remains
historical, not reused as new or online SLA. Real10s auth deadline is a transport
engineering bound; no production percentiles/CPU/memory/SLA is claimed.
No page JavaScript errors or external requests; expected401/login/fault-injection
console errors and existing focus/aria warnings remain recorded, not zero warnings.
Only owned processes stopped; new DBs, all raw evidence and private synthetic traces
retained. No real health data/credentials are used or exposed in artifacts.

Remaining: actual Edge+target PG17/resource/browser Gate, real verified provider/
Google login, default-OFF hosted provider activation review, exact remote schema
diff and authorization. Static build is not an operational remote manual-SQL release.
Template store integration does not exist; future references must use RESTRICT FK.
Separate barrier tests for both archive/reference acquisition orders were NOT_RUN
(the executed delete/reference race is not substituted). Broader training/recompute/
weekly product acceptance is not inferred from raw manual catalog CRUD.

PHOTO_MODEL_IMPLEMENTATION=MISSING; FOOD_REFERENCE_VALIDATION=NOT_VERIFIED;
NEW_SCORE_VALIDITY=EXPERIMENTAL_UNVALIDATED; REAL_DEVICE/IOS=NOT_RUN.
REMOTE_PUSH=NO; REMOTE_BETA_WRITES=0; PRODUCTION_WRITES=0; DEPLOYMENTS=0;
PAID_SERVICES_ADDED=0; LIVE_USER_PAGE_CHANGED=NO; C_CLEANUP=DEFERRED_NOT_PASSED;
XIAOFEI=OUT_OF_SCOPE_NOT_MODIFIED.

## 2026-09-13 — Git ownership and manual SQL local closure (current)

整體專案已驗收完成率：UNKNOWN。相同
`known-scope-v0.1-provisional-2026-09-12` 已知範圍32.0%，較上一輪+0.0pp。
This is scoped local acceptance, **not** full-project/Beta/device/release PASS.
Canonical development: `D:/Dev/Projects/health-companion-canonical-20260913-020110`.
Tests use preserved HEAD `423da056b0ee544bb5aac3b19346542e2e2a5003` plus explicit
working-source hashes; the scoped commit containing those source bytes is recorded
in the external final report. No original Android changes are included.

Evidence root:
`D:/MigrationReports/dual-project/20260912-2035/git-manual-sql-20260913-020110`.
The original two D worktrees share a duplicate per-worktree identity. Recovery snapshots,
independent index review,24 Git checks, dual fsck, and disposable-only stage/commit probe
support the new standalone alternative; originals remain unchanged. Original1,612
metadata/source and backup hashes were independently rechecked. No C deletion took place.

| Suite / gate | Latest fresh result | Evidence relative to external root |
|---|---|---|
| Python reference |134 named cases PASS; no cached cases | `reference-node-20260912T183643Z` |
| Node broad regression |180 named cases +5 whole-script assertion entrypoints PASS,185 JUnit rows | `node-rerun-20260912T184847Z` |
| Actual adapter/render UI units |14 named cases PASS; fetch/DOM stubs only here | `manual-sql-ui-final-timed.xml`, `manual-sql-ui-final-manifest.json` |
| Portable Deno parity |60 tests PASS;57 reference fixtures+3 meta tests,28 goldens nested not added again | `root-regression-510fa92c-eade-49ac-be62-06e914dfc073` |
| Type/lint/syntax | Deno check/lint and Web JS syntax PASS; tasks not test cases | same root-regression directory |
| Existing Web+real HTTP+native PostgreSQL |4 integrated gates PASS; no mocked persistence/engine/authorization | `manual-sql-e2e-d4b46ab6-e2a6-4318-a24c-3555fa248448/report.json` |
| Android JVM/build/device, iOS, actual Supabase Edge, remote OAuth/Beta |NOT_RUN this scoped continuation | Prior evidence is not fresh credit |

Python3.12.14, pytest9.1.1, Node24.19.0 for broad regression; Node22.23.2 for
the browser/UI runner; Deno2.9.6/TS6.0.3; PostgreSQL18.6; Chrome152.0.7977.84;
Playwright1.62.1. Existing dependencies were copied by allowlist/hash, not upgraded.
No new package/model/service was added. The final integrated run spans
2026-09-12T18:48:58.306Z–18:50:46.861Z (02:48:58–02:50:46 Asia/Taipei).
Application source hashes were identical before/after this run.

The4 gates independently establish:

1. Existing body form creates exactly one SQL record, edits the same ID, preserves
   null/zero, reloads after a new browser-context login, cancels/accepts real native
   delete confirmation, retains tombstone, and does not leak to B or mobile ingestion.
   A transport-only injected lost response still calls the real API/DB first; the
   browser confirms the actual receipt and completes without a duplicate.
2. Real HTTP rejects anonymous, invalid/expired/missing mapping and forged owner.
   Auth subject differs from canonical ID. Low-privilege RLS and privileged server
   authorization are both exercised. Exact replay, changed payload conflict, stale
   revision, date bounds/collision, tombstone and a real receipt-write failure rollback pass.
3. A held real advisory lock produces503 `DB_TIMEOUT_RETRYABLE` after2029.938ms
   (predeclared SQL2s; HTTP ceiling6s), no partial row/receipt. Release then same-ID
   retry persists once. This is a local lock measurement, not a production SLA.
4. A40-day-old meal is created through the existing Web: synthetic per100g label
   200kcal ×150g ->300kcal; edit200g ->400kcal. Actual stored experimental nutrition
   heads change17.6 ->23.5 with distinct fingerprints. Replay/new-context read-back,
   cancel-delete, confirmed delete and reload/B isolation pass. Latest aggregate/score
   becomes null/INSUFFICIENT_DATA after deletion; no old valid output masquerades as current.

The first integrated run correctly FAILED at the historical meal list (SQL already
contained the row). It is retained under `manual-sql-e2e-74c0f5dc-83d0-4dee-89ae-6c2535e15e7f`.
The product's today-only list/edit lookup was fixed. Independent review additionally
found missing SQL bounds and late range/revision-cache races; these were fixed and
retested, including14 actual-function UI tests. Previous6/10/14 unit runs,33-case
initial Node smoke and repeated broad/portable runs are **not added** to latest counts.
Current test failures0; original failures are preserved, not rewritten as successes.
Do not combine named cases, custom integrated gates, build/check tasks or cached Android
report rows into one misleading total.

Page JavaScript errors0; external requests0. Console retains expected initial401
login probes and the deliberate lost-response error, plus3 pre-existing modal focus/
aria-hidden warnings. Accessibility focus restoration remains a LOW follow-up, not
a zero-console-warning claim. Only owned test services were stopped; all new UUID
databases, failed/success evidence and private raw traces remain. External trace
copies redact synthetic JWTs; no real user credentials/data were used.

Body SQL is saved with `MANUAL_WEB / ANALYSIS_PENDING`, not a new body score.
Nutrition engine remains experimental. Frozen health-score-v1.0 code/weights/goldens
are unchanged. Food-reference validation, photo model, domain real-world validity,
actual Edge, real OAuth, remote Beta, Android OEM, iOS and release gates remain open.
The new additive body migration is a locally rehearsed proposal only; see the updated
architecture for exact activation approvals and non-destructive flag rollback.
REMOTE_BETA_WRITES=0; PRODUCTION_WRITES=0; PUSH/DEPLOYMENT=NOT_PERFORMED.

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
