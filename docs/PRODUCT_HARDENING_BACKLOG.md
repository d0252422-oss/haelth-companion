# Product hardening backlog

## WORKOUT_SAVE_LATENCY_POST_SQL_FIRST

```text
TASK_ID = WORKOUT_SAVE_LATENCY_POST_SQL_FIRST
PRIORITY = P0_PRODUCT_HARDENING
CURRENT_STATUS = DEFERRED_UNTIL_SQL_FIRST
BLOCKS_CURRENT_REMOTE_CUTOVER = NO
EXECUTION_TRIGGER = AFTER_BETA_SQL_FIRST_CUTOVER
ACTIVATION_CONDITION = BETA_SQL_FIRST_CUTOVER == PASS
TRIGGER_DRIVER = scripts/beta-next-gate.mjs
TRIGGER_INPUT = reviewed beta-remote-acceptance-v1 report + hash-bound D evidence
TRIGGER_OUTPUT = idempotent local READY_TO_MEASURE work item (not a timed automation)
OWNER = CODEX_PRIMARY_ENGINEER
```

### Scope and activation

Users currently experience a stall after selecting「完成本次訓練」. This is a reported
symptom, not a measured root cause. Do not refactor the legacy Sheets backend now.
This entry only records future work; no instrumentation, optimization or benchmark
is started at registration time. It adds no acceptance weight or progress credit.

After the actual Beta SQL-first cutover is accepted PASS, automatically select this
task in the next engineering stage without asking for another ordinary instruction.
Local SQL PASS, a proposed provider switch, HTTP200 or deployment alone must not
activate it. It never blocks vendor response, PG security or the current cutover.
If cutover remains blocked, leave this entry deferred.

### Measure before changing behavior

On the real SQL path measure each boundary below, reporting median, p95, worst
observed and sample count for each metric. Preserve correlation via the existing
clientRequestId without logging credentials or sensitive health payloads. Document
measurement boundaries and clock sources; do not subtract unsynchronized browser,
Edge and database clocks or substitute API completion for observed DB commit.

| Metric | Boundary |
|---|---|
| CLICK_TO_REQUEST_START | Finish click to actual request start |
| REQUEST_START_TO_DB_COMMIT | Request start to confirmed core SQL transaction commit |
| DB_COMMIT_TO_API_RESPONSE | Confirmed commit to API response |
| API_RESPONSE_TO_UI_READY | API response to usable training analysis UI |
| BACKGROUND_RECOMPUTE_DURATION | Background recompute start to completion |
| TRAINING_RANGE_REFRESH_DURATION | Affected training range refresh start to completion |

Report real observations only; unavailable boundaries stay unmeasured. Do not invent
an SLA, baseline or percentile from insufficient samples. Define the end-to-end
WORKOUT_SAVE metric consistently (click to UI ready), including sample conditions.

### Desired experience and correctness constraints

「完成本次訓練」 → immediately「儲存中…」 → core training SQL commit confirmed →
return to training analysis →「已儲存・分析更新中」. Recompute, score and trend updates
continue in the background; they must not hold the user in the editor after commit.

Required: NO_DUPLICATE_WORKOUTS, NO_DRAFT_LOSS, SQL_COMMIT_CONFIRMED,
TIMEOUT_RECOVERABLE, IDEMPOTENCY, WRITE_STATUS_RECONCILIATION,
RECOMPUTE_NON_BLOCKING and UI_RESPONSIVE.

An uncertain timeout must not create a new request identity. Reconcile the original
clientRequestId through write status: committed means success; definitively not
committed permits safe retry under the existing idempotency contract. Pending or
unknown status remains recoverable with the draft/exact request retained, not a
blind duplicate submission. Never claim success from optimistic UI alone.

Refresh only training records, affected date/aggregate/score, related derived data,
dashboard cache and relevant trend. Do not reload the entire app or refetch body,
nutrition, sleep or activity unless a verified dependency requires it.

### Investigation order

1. Frontend timing.
2. Edge latency.
3. DB transaction latency.
4. Blocking recompute.
5. Unnecessary refetch.
6. Browser render cost.
7. Network timeout/retry.

Use narrow evidence-led fixes and affected regressions, not an architecture rewrite.
If the accepted SQL-first path is already responsive under measured conditions,
record PASS_NO_FURTHER_OPTIMIZATION_REQUIRED; do not optimize for its own sake.

### Completion report (all values pending activation)

```text
WORKOUT_SAVE_SQL_FIRST = PASS / FAIL
WORKOUT_SAVE_LATENCY = PASS_NO_FURTHER_OPTIMIZATION_REQUIRED (if applicable)
WORKOUT_SAVE_MEDIAN_MS = measured
WORKOUT_SAVE_P95_MS = measured
DB_COMMIT_MS = measured, with boundary/statistic defined
UI_READY_MS = measured, with boundary/statistic defined
BACKGROUND_RECOMPUTE_MS = measured
DUPLICATE_PROTECTION = evidence-backed result
DRAFT_RECOVERY = evidence-backed result
TIMEOUT_RECONCILIATION = evidence-backed result
PARTIAL_REFRESH = evidence-backed result
USER_VISIBLE_BLOCKING = observed result
ROOT_CAUSE_IF_SLOW = measured cause or UNKNOWN
```

Include all six timing distributions, worst observations and sample counts alongside
these summary fields. None of these results is presently claimed PASS or measured.
