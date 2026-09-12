# Project acceptance progress

整體專案已驗收完成率：UNKNOWN

Baseline: `known-scope-v0.1-provisional-2026-09-12`.
Status: `PROVISIONAL_KNOWN_SCOPE_ONLY`. Previous comparable progress: `32.0%`.
暫定已知範圍完成率：**32.0%**（32 / 100）；這不是全專案完成率。
Uncredited weight: 68. Progress change: **+0.0 percentage points** on the same baseline.
The original2026-09-12 calculation remains the first baseline (`PREVIOUS_PROGRESS=NOT_AVAILABLE`);
this2026-09-13 continuation is a comparison, not a scope/weight revision.

## Scope evidence and missing decision

No earlier `PROJECT_PROGRESS.md`, `project-progress.json` or valid weight baseline was
found. Historical chat estimates are not a baseline. The original workspace
`docs/ROADMAP.md` defines V1–V5, while `docs/PROJECT_PRD.md` describes an older
AppSheet/Sheets implementation. Current `LINE_MINI_APP_WEARABLE_PREPARATION.md`
freezes Friends & Family Beta around Android Helper and iOS Shortcut; a native iOS
helper is described as future optional. There is no approved complete-delivery
version/cutoff reconciling those scopes. Therefore a full-project denominator cannot
honestly be asserted. Charging/store ideas are deferred/unconfirmed, not invented as
committed features and not silently declared removed from a previously signed scope.

The provisional candidate union preserves the documented roadmap and every platform,
photo/food, score-validity, Beta/OAuth and release acceptance requirement. The machine
ledger contains 25 independent leaf acceptance units, **4 weight each**, totaling100.
Equal acceptance-unit weighting is an initial planning assumption, not effort or
business-value estimation; it was not reverse-fitted to completed work. No parent,
progress script or documentation gate earns product weight. Future scope/weight
confirmation requires a new baseline version, not an engineering-progress increment.

## Current module weights

| Known-scope module | Earned / total weight | Boundary |
|---|---:|---|
| Local canonical data / identity / PG | 12 / 12 | Native synthetic tests, not remote production acceptance |
| Engines | 12 / 16 | Engineering and label arithmetic only; real-world validity unverified |
| Runtime | 4 / 8 | Portable core passed; actual Edge execution blocked |
| Existing Web | 4 / 8 | Full meal Browser passed; full overview/training/weekly acceptance unverified |
| Android | 0 / 8 | JVM/lint passed, but intended APK build and OEM device gates not accepted |
| iOS | 0 / 8 | Build/platform scope/device evidence still required |
| Photo / food | 0 / 12 | Model, benchmark and reference validation remain open |
| Release / Beta / privacy | 0 / 12 | No remote authorization; security/distribution gates open |
| Remaining documented roadmap | 0 / 16 | LINE V4, recovery V2, guidance V3, personalization V5 retained |

The exact per-leaf acceptance conditions and hashed evidence are in
`project-progress.json`. Run `node scripts/calculate-project-progress.mjs --check`.
Only semantically accepted PASS with existing matching evidence gets credit. Missing
or changed evidence withdraws credit; BLOCKED/FAIL/UNKNOWN/IN_PROGRESS stays in the
denominator. Hash integrity alone is not semantic acceptance. Raw local evidence is
intentionally ignored by Git; another checkout without it must not inherit these PASS
credits merely from a cached report. Incomplete scope is never rounded to100%.

Required first-line reporting is now saved in effective root `AGENTS.md`.

## 2026-09-13 continuation

Git isolation/migration has no product weight. Manual body SQL and the added historical
meal/read-back/security regression do not complete the broader overview/training/weekly
leaf, and do not imply remote Beta, real OAuth, OEM device or clinical validity.
The same25 leaves and weights remain unchanged. Overall scope is still unconfirmed;
the known-scope32.0% must not be labeled a full-project percentage. C cleanup is deferred,
not accepted and not a prerequisite for the independent D checkout's local development.
