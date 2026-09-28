# Total energy and health-score refresh — offline candidate (2026-09-28)

Base: `a411d6596a702784bb511d6ccd3c813d40c02e35`. This branch is separate from the body-composition worktree and does not modify the fixed release candidate or its manifest. No remote request, database write, push, or deployment was made for this candidate.

## Confirmed defects and bounded fixes

- A failed timeline read could coexist with a summary marked `NO_DATA`, causing the metric detail to present a failed read as if absence had been confirmed. The Web now distinguishes read failure, labels retained cached values as old, and clears that label only after a successful timeline response. Late responses from a prior identity or date range cannot replace the active view.
- A stored dashboard for the same custom range could survive an Asia/Taipei midnight boundary. The cache now carries the local day and the request scope changes with it. This does not itself schedule a midnight refresh while the app remains open.
- A vertical touch scroll that began on the shared chart selected a different date. Selection now occurs on a stationary pointer release; the detail identifies the selected date and provides a return-to-today action. The chart invalidates on same-day value changes and metric detail state is scoped to the selected range.
- Manual `total_energy` is a durable, display-only observation under the frozen `health-score-v1.0` inputs, yet its SQL trigger invalidated up to 28 score dates and the Edge woke a drain. The local migration makes this domain a no-op for score invalidation; the write receipt and Edge skip an unnecessary drain. Steps and sleep retain their existing queue behavior. No score formula, fingerprint, source-selection formula, or historical records were changed.

The screenshot's manual 1,064 kcal on 9/20 belongs to 30D but not 7D on 9/28. It is neither today's value nor evidence of wearable synchronization. The user's device-side availability of a total-calorie Health Connect record is UNKNOWN. The current Android app does not request/read that record; Edge validation and Beta record constraints also omit its explicit native domain. This candidate **does not** enable automatic total-energy ingestion. A future permission decision and explicit `total_energy`/`kcal` interval contract are required; generic `energy`, active calories, food intake, and basal estimates cannot be substituted. The current frozen score formula does not consume total energy.

`getHealthTimeline` may schedule a drain when work is pending. It was not used as a remote read-only probe. A prior HTTP 546 is not proof of this candidate's root cause or of a completed recompute; its current cause remains UNKNOWN.

## Offline verification

| Check | Result |
| --- | --- |
| Web error/recovery, identity/range race, midnight cache, chart/date and manual 9/20 regression | `node --test tests/energy-score-refresh.test.cjs tests/trend-chart.test.cjs tests/manual-sql-ui.test.cjs`: 101/101 pass |
| Score bridge/queue/UI focused CJS | `node --test tests/beta-score-durable-queue.test.cjs tests/beta-score-bridge.test.cjs tests/domain-score-response.test.cjs tests/health-score-completeness.test.cjs`: 19/19 pass |
| Isolated migration replacement, raw record preservation, queue generation, invoker/grant preservation | `node --test tests/manual-total-energy-queue.test.mjs`: 1/1 pass in PGlite |
| Native bearer/session, manual observation, score freshness, daily read | `deno test --cached-only --frozen-lockfile --node-modules-dir=none --config config/engine-local.deno.json --allow-all tests/native-ingestion-validation.test.ts tests/manual-observations.test.ts tests/score-read-freshness.test.ts tests/manual-daily-read.test.ts`: 66/66 pass |
| Changed Edge TypeScript | `deno check` and `deno lint` with the same local config: pass |
| Web inline script syntax and diff whitespace | pass |

The dedicated `manual-observation-publication.test.ts` needs `LOCAL_ENGINE_TEST_CONFIG`; the two real-PostgreSQL score tests need `LOCAL_ENGINE_PG_BIN` pointing to a reviewed patched binary. These were attempted, not passed, and are not replaced by the PGlite result. The SQL lint command reported zero parser/blocking errors but `WARN_REVIEW_REQUIRED` across the repository. Project progress remains UNKNOWN: this isolated worktree lacks historical `.engine-artifacts` evidence required by the provisional progress checker.

## Publication boundary and rollback

This is a **new** candidate, not the fixed release artifact. Any later authorized publication must identify the exact new commit, verify the actual live rollback build, then apply only `20260928110000_manual_total_energy_score_queue_scope.sql` before publishing the matching Edge files (`manual-observation-projection.ts`, `manual-observations-local.ts`, `local-engine-runtime.ts`) and Web files (`index.html`, `scripts/core-ux-contract.js`). Do not sweep other pending migrations into that operation. The SQL function replacement is compatible with the earlier Edge and preserves grants; if later Web/Edge publication fails, restore the verified previous Web/Edge build without restoring a database snapshot or removing user records. A failed SQL transaction should leave the prior function in place. No rollback has been performed.

Before publication authorization, use the existing dedicated PostgreSQL fixture to verify the migration against the full schema. Native automatic total-energy support requires a separate approved Android Health Connect permission and an end-to-end, nonduplicating interval projection owned by the Python engine; it must not be described as part of this candidate. Live LIFF/account validation, Beta queue publication, and 546 diagnostics remain NOT_RUN/UNKNOWN. No user-resume claim follows from these offline tests.
