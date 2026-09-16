# Internal Manual Beta critical SQL contract

Scope: original Web manual body/nutrition/training/sleep/steps/total energy/exercise,
dashboard/timeline/scores, canonical identity/profile and data-source status.
`scripts/audit-beta-preparation.mjs` emits51 action rows with caller/handler line,
SQL objects, auth, tenant, return/error/cache/recompute contract and classification.
Current static split:32SQL_READY,4DEFERRED_NON_BLOCKING,5legacy auth authority,
10unimplemented/legacy-deferred. This count is not an E2E or remotePASS.

Critical data flow: local-engine-web.js allowlist -> /v1/engine/web -> hosted-manual-
bootstrap.ts -> verified session bridge -> canonical alias -> scopedManualSql ->
LocalEngineRuntime.handle -> existing body/meal/observation/training tables ->
action-shaped response -> user/environment cache and source evidence.
getCurrentUser now uses SQL canonical mapping in hostedSQL mode, not legacy profile
read. getUserProfile returns real canonical ID/status and explicitly null,
NOT_CONFIGURED personal details. No invented age/height/goals/nutrition targets.
Interactive session issuance/logout/LINE-link authority remains the existing auth
bridge; it is not a health-data Sheets fallback or a claim of real OAuth acceptance.

Dashboard/timeline read persisted raw/published results; missing scores stay null,
stale publication is suppressed. Body/nutrition retain existing engine adapters;
manual training raw aggregates are supported but its unconnected analysis remains
honestly NOT_ENABLED/INSUFFICIENT, not a new formula. health-score-v1.0 unchanged.
Settings status is assembled from actual request/shape/domain observations, not
an unconditional SQL-connected label or HTTP200 alone.

WEEKLY_REPORT_STATUS=DEFERRED_NON_BLOCKING
CHECKIN_STATUS=DEFERRED_NON_BLOCKING
In SQL-first mode report renders a persistent unavailable explanation and no fake
report; check-in input/save is disabled with explanation. Direct unsupported actions
fail closed. Existing legacy mode remains unchanged; no SQL->Sheets fallback.
Food/photo, optional goals/analytics and connector account administration are not
silently promoted toSQL_READY. Exposed future routes must keep explicit unavailable.

Acceptance: actual Edge+PG17.11 original browser suite plus added canonical profile,
dashboard/timeline and deferred-entry test passed28/28 in this run's
manual/manual-sql-e2e-f1bdcea3-2ef9-49f7-87aa-b91a6e76dd3b/report.json. The
fixed progress leaf includes broader weekly/remote acceptance, so this limited
Internal Manual Beta contract does not close that leaf or change32.0% weighting.
