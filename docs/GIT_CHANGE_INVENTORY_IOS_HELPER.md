# Git Change Inventory — iOS Helper

Inventory time: 2026-08-27  
Branch: `feat/ios-healthkit-helper-beta`

## Baseline evidence

Before the iOS task started, `git status --short` contained **112 entries**: 6 tracked modified files and 106 untracked entries/groups. No reset, clean, stash, bulk add or checkout of those files occurred. After the task, status contains 117 entries because Git collapses newly created directories into single untracked entries.

## IOS_HELPER_CREATED_THIS_RUN

Clearly isolated paths, safe for path-specific staging:

- `ios-helper/` — complete Swift/project/test source tree, including `.gitignore`.
- `config/ios-health-helper.contract.json`
- `docs/IOS_HEALTHKIT_HELPER_ARCHITECTURE.md`
- `docs/IOS_HEALTHKIT_PRIVACY_PERMISSION_RATIONALE.md`
- `docs/IOS_MAC_XCODE_HANDOFF.md`
- `docs/IOS_REAL_DEVICE_ACCEPTANCE_TEST.md`
- `docs/IOS_PRE_XCODE_STATIC_REVIEW.md`
- `docs/GIT_CHANGE_INVENTORY_IOS_HELPER.md`
- `docs/apple-app-site-association.template.json`
- `IOS_HEALTHKIT_HELPER_WINDOWS_IMPLEMENTATION.md`
- `scripts/mobile-health-helper-contract.cjs`
- `scripts/mobile-health-helper-runtime.cjs`
- `tests/ios-healthkit-helper-contract.test.cjs`
- `tests/mobile-health-helper-runtime.integration.test.cjs`
- `supabase/migrations/20260827015836_mobile_health_helper_bootstrap.sql`
- `supabase/migrations/20260827023849_health_source_record_reconciliation.sql`
- `supabase/staging/mobile_health_helper_bootstrap_tests.local.sql`
- `supabase/staging/health_source_record_reconciliation_tests.local.sql`

## IOS_HELPER_MODIFIED_THIS_RUN — MIXED OWNERSHIP, DO NOT STAGE

These paths already contained pre-existing work before this task and also received narrow architecture/status updates. Whole-file staging would capture unrelated work:

- `HEALTH_DATA_LAYER_V2_ARCHITECTURE.md`
- `LINE_MINI_APP_WEARABLE_PREPARATION.md`
- `DEVICE_CLOUD_CAPABILITY_MATRIX.md`
- `AI_POOL_STATUS.md`
- `AI_POOL_CHECKPOINT.md`
- `tests/zero-download-contract.test.cjs`

Classification: `IOS_HELPER_MODIFIED_THIS_RUN + PREEXISTING_OTHER_FEATURE_CHANGE`.

## PREEXISTING_HUMAN_CHANGE / PREEXISTING_OTHER_FEATURE_CHANGE

Count: **112 original status entries**. Groups include:

- tracked baseline changes: `HEALTH_DATA_LAYER_V2_M1_STAGING_REHEARSAL.md`, `HEALTH_DATA_LAYER_V2_SCHEMA_DRAFT.md`, `README.md`, `index.html`, plus the two mixed architecture files above;
- prior AI Pool/M1/M2/M3/GH1/Google Health/Apps Script/migration reports at repository root;
- pre-existing `.agents/`, `.env.*.example`, `.gitignore`, Python environment/lock metadata;
- pre-existing `config/`, `evidence/`, `scripts/`, `supabase/`, `tests/`, and `tests_python/` content not named in the isolated iOS list.

No ownership was reassigned based solely on timestamps.

## GENERATED_ARTIFACT

- Pre-existing `health_companion_algorithm_environment.egg-info/`, `.pytest_cache`, `.mypy_cache`, and `.ruff_cache` are not part of the iOS commit.
- No Xcode build products, DerivedData, `.xcodeproj`, credentials or signing artifacts were generated.

## UNKNOWN

`UNKNOWN_FILES = 0` for the isolated iOS path set. Ownership of individual files inside the 112-entry pre-existing baseline remains unchanged and they are excluded rather than guessed.

## Commit decision

`IOS_SCOPED_FILES = 49` before this inventory’s final recount (all explicitly listed isolated paths/files).  
`PREEXISTING_FILES = 112 status entries/groups at task start`  
`UNKNOWN_FILES = 0 inside iOS scope`  
`SAFE_TO_CREATE_SCOPED_COMMIT = YES`

Scoped commits created after path verification:

- `7e3e4a2 feat(ios): add HealthKit sync helper foundation` — 33 isolated files.
- `1c2d567 feat(backend): wire mobile health reconciliation runtime` — 8 isolated files.
- `docs(ios): add Mac handoff and change inventory` — 8 isolated files; use `git log -1` for its final hash because this inventory is part of that commit.

`SAFE_SCOPED_COMMITS_CREATED = YES`  
`SCOPED_COMMITTED_FILES = 49`  
`PREEXISTING_OR_MIXED_FILES_COMMITTED = 0`

Only exact listed paths may be staged. `git add .`, `git add -A`, broad directories outside `ios-helper/`, and all six mixed-ownership files are forbidden for this scoped commit.
