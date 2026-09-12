# Multi-domain engine architecture (non-production)

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
