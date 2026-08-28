# Algorithm runtime cutover preparation

Status: non-production preparation only. The score formula remains `health-score-v1.0`; Python is a candidate, not an approved production runtime.

## Current runtime flow

The canonical deployed source examined for this audit is the read-only Apps Script evidence at `evidence/apps-script-production/head/程式碼.js`.

1. `doGet` / `doPost` authenticate the user, enforce the action allowlist and rate limit, then dispatch through `handleCanvaGetAction_` / `handleCanvaPostAction_`.
2. Score reads enter through `getDashboardData_`, `getDailyHealthScore_`, `getHealthScoreTrend_`, or `getHealthTimeline_`. Dashboard reads may synchronously recompute a missing, dirty, source-newer, or domain-incomplete score.
3. `buildDailyHealthFeatures_` reads user-scoped rows from wearable daily data, daily status, body records, workout records, and deduplicated meal records. `calculateBaselines` and canonical normalization helpers produce the scoring inputs.
4. `calculateDailyHealthScoreRecord_` calls the seven domain functions and `calculateHealthScore`, then builds metadata, recommendations, missing-data details, baselines, raw-feature audit data, and the deterministic user/date `ScoreID`.
5. `recalculateDailyHealthScoreForUser_` performs an optimistic source-version check, then `upsertRecord_` writes one `DailyHealthScores` row and invalidates the health-timeline cache. A source change during calculation leaves the record dirty instead of overwriting newer state.
6. Source mutations for Health Connect, nutrition, meals, body, workouts, and check-ins call `invalidateDailyHealthScore_` / `invalidateDailyHealthScores_`; some paths immediately call `refreshHealthScoreAfterWrite_`. `processDirtyDailyHealthScores` recomputes at most 25 dirty records per invocation. Backfill has explicit resumable batches.
7. `canonicalHealthScoreRecord_` produces the API shape. `getDashboardData_` returns it under `today`; `getHealthTimeline_` incorporates trend fields and caches the result for 300 seconds using a user/range/data-version key.
8. The frontend consumes `healthScore`, domain scores, `dataCompleteness`, `scoreConfidence`, missing/available/partial domains, freshness and `algorithmVersion` in `index.html`.

Current boundaries and side effects:

- Formula functions are deterministic compute functions, but their orchestration is not side-effect-free.
- Reads touch multiple Google Sheet tabs. Writes upsert `DailyHealthScores`, set dirty state, update timestamps, write Apps Script properties for backfill state, invalidate cache versions, and emit sanitized performance/error logs.
- Errors at the API boundary are normalized by `handleApiError_`. Recompute errors are logged and the dashboard can continue with the prior/fallback result. Cache write failures do not fail the request. Lock waits in meal writes are bounded at 10 seconds; Apps Script execution itself remains subject to platform execution limits.
- The safe shadow insertion point is after canonical input normalization and before record construction/upsert. Candidate execution must never own persistence, invalidation, recommendations, or API response selection.

## Runtime-neutral contract

`scripts/algorithm-runtime-adapter.cjs` defines:

`AlgorithmRequest -> AlgorithmRuntimeAdapter -> AlgorithmResult`

Requests carry algorithm identity/version, domain, canonical inputs, subject reference, period, timezone, missing-input metadata, traceability references and a non-sensitive trace ID. Results normalize value/score, completeness, confidence, missing inputs, reason codes, version and traceability.

- `AppsScriptRuntimeAdapter` wraps the sanitized, provenance-pinned canonical Apps Script score snapshot and preserves the original raw result as `userResult`.
- `PythonRuntimeAdapter` invokes the Python 3.12 parity engine as a compute-only process. It has no datastore or writer interface.
- `AlgorithmRuntimeRouter` supports `CURRENT`, `SHADOW`, and locally authorized `CANDIDATE`. Default and invalid configuration resolve to `CURRENT`. Candidate-primary activation is disabled unless an explicit non-production constructor option is supplied.
- In `SHADOW`, the Apps Script raw result remains the user result. Candidate failure produces only an allowlisted error class; raw inputs and exception details are absent from telemetry.

## Parity and writes

Comparison is field-specific for value, score, completeness, confidence, missing inputs, reason codes and version. Classifications are `MATCH`, `ROUNDING_ONLY`, `NULL_SEMANTICS`, `ORDERING_ONLY`, `FORMULA_DIVERGENCE`, or `UNKNOWN`; timezone and unit normalization remain reserved classifications for a later broader canonical-input adapter.

Both adapters declare compute-only behavior. The router has no writer callback and shadow tests prove that candidate execution does not invoke a write. Existing Apps Script persistence remains outside the adapter and continues exactly once after the primary computation. Consequently shadow cannot duplicate scores, derived records, reconciliation events or audit-side effects.

## Rollback contract

- Trigger: candidate error, unexplained mismatch, latency budget breach, security issue, or operator decision.
- Action: set runtime selection to `CURRENT` (invalid/missing values also fail closed to `CURRENT`).
- Scope: algorithm routing only.
- Data impact: none; the candidate is compute-only and shadow results are not persisted.
- Cache handling: no purge is required because user-visible output remains current-runtime output. A future candidate-primary rollout must key cache/derived provenance by algorithm version before production authorization.
- Derived records: unchanged; no historical recomputation or schema/data migration is part of rollback.
- Observability: record only the allowlisted runtime, parity, duration, fallback, error class and trace fields.
- Validation: repeat a frozen fixture in `CURRENT`, switch through `SHADOW` or locally allowed `CANDIDATE`, return to `CURRENT`, and require byte-equivalent normalized output.

Local tests prove `CURRENT -> SHADOW -> CURRENT` and non-production `CURRENT -> CANDIDATE -> CURRENT`. No schema migration, data migration, code revert, or production write is required.

## Security and telemetry

Telemetry is allowlisted to `algorithm_id`, `algorithm_version`, selected/shadow runtime, parity result, difference class, durations, fallback flag, error class and trace ID. It does not include canonical inputs, health payloads, credentials, OAuth material, user email, or candidate stderr. The bridge truncates internal stderr before wrapping it, and the router reduces that to a fixed error class.

## Performance evidence

Measured locally on Windows with `node scripts/benchmark-algorithm-runtime.cjs`: current Apps Script VM adapter mean 0.264 ms (20 runs), Python process candidate mean 566.277 ms (5 runs), and end-to-end shadow mean 540.424 ms (5 runs). The Python measurement includes process startup and is therefore an adapter/prototype cost, not Python compute latency in a resident service. These environments are not production-comparable; no production latency claim is made.

## Production boundary

This work does not wire the router into deployed Apps Script, switch traffic, modify schema, recompute history, or write production data. Before any production cutover, a separate human-authorized gate must decide the target runtime, deployment topology, resident Python execution model, cache/version provenance, operational SLOs, and rollback owner.
