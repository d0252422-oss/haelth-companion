# Multi-domain engine test report

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
