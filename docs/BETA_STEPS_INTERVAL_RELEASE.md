# Beta current steps interval repair (2026-10-08)

Scope: Android integrity final acceptance; no new engine release.

The verified source snapshot remains closed (404 missing recovered, 3 revisions updated, remaining missing 0). Source lookup absence does not prove deletion. All 236 legacy identities remain active and retained.

A bounded read-only counterfactual proved four old 10/08 steps identities duplicate newer same-origin, same-start/end, same-value identities. The published daily reader summed both. It now ranks exact steps source windows by source timestamp, revision and ingestion timestamp before aggregation. Other domains, owners, null handling, source selection and formulas remain unchanged. No DELETE, invalidation, backfill or migration.

The actual query was executed in the existing synthetic PostgreSQL 17.11 fixture: replaced windows, updated values, other origins, other owners, deleted/invalidated/out-of-range rows, unrelated weight rows, missing and explicit zero all passed. Candidate store/read tests: 10 passed. Full isolated persistence/RLS/consumer fixture: 18 passed; these are local synthetic evidence, not Android background evidence. Training loader: 13 isolated subchecks passed separately.

Beta Edge mobile-health-beta: baseline v51 bundle 070a47b68ec6d2d59da9c65b1e4ede14813b9d66cc75a78a28e6428e6d7ec07f; released v52 bundle 49a8acedec6c88d215e73483d67805b1b48fe099e4f329cd4d65c444687ced91. Only manual-daily-read.ts changed against the fetched deployment; 29 returned files match. This was an exact file-set deployment, not deployment of this branch. Auth and RLS untouched; engine storage migration not applied; Production operations 0.

Private/local evidence: existing .ai-pool/candidates/android-integrity/device-acceptance report and steps-release-manifest.json; existing engine-beta-integration/validation/postgres-integration.test.ts and postgres-test-report.json. No health values, record IDs or credentials included here.

Natural beta.31 periodic full-run acceptance is still pending; source reconciliation and local tests must not be reported as that acceptance. Existing three-hour monitor continues without an App launch, manual sync or forced ADB job. Current-window human activity is UNKNOWN.