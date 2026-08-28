# Health Algorithm Engine Discovery and Frozen Contract

Status: non-production reference foundation. Source of truth: `evidence/apps-script-production/head/程式碼.js` (`health-score-v1.0`).

## Inventory

| Domain/function | Inputs and units | Output/null behavior | Formula/threshold source | Existing coverage |
|---|---|---|---|---|
| Sleep `calculateSleepScore` | minutes, percent, bpm, baseline samples | 0–100 (1 decimal); all unavailable → null | lines 1697–1728; component weights at lines 65–75 | Python golden/missing tests |
| Activity `calculateActivityScore` | steps/count, total calories burned/kcal, personal baseline/kcal | 0–100 (1 decimal); measured zero is 0, missing is null | lines 1731–1745; 70/30 weighting | Python golden/boundary/property tests |
| Training `calculateTrainingScore` | load, 7/28-day load, consecutive days | 0–100 (1 decimal); missing components reweighted | lines 1748–1766 | Python golden/missing tests |
| Nutrition `calculateNutritionScore` | kcal, protein/carbs/fat grams, meal count, user targets | 0–100 (1 decimal); incomplete confirmed nutrition stays missing | lines 1769–1785 | Python golden/missing tests |
| Body composition `calculateBodyCompositionScore` | kg weight/fat mass and baselines/target | 0–100 (1 decimal); no assumption that lower is better | lines 1788–1810 | Python golden/missing tests |
| Recovery `calculateRecoveryScore` | HRV ms, resting HR bpm, sleep/training/subjective scores | 0–100 (1 decimal); missing wearable inputs reweighted | lines 1813–1830 | Python golden/missing tests |
| Fatigue `calculateFatigueIndex` | load ratio, sleep debt minutes, HRV/RHR, training days | 0–100 (1 decimal); higher means more fatigue, not inverse recovery | lines 1833–1854 | Python golden/missing tests |
| Overall health `calculateHealthScore` | six domain scores | 0–100 (1 decimal); aggregate is not an input domain | lines 1857–1875; overlap adjustment | Python golden/missing/zero tests |

Readiness (`_calculateReadinessCore_`) is an existing separate rules engine and is not silently merged with the health score.

## Frozen cross-cutting contract

- Normalization: scores are clamped to 0–100 and API precision is one decimal. Completeness is 0–1 at four decimals.
- Missing: null/unparseable/non-finite is unavailable; a measured numeric zero remains a real value.
- Completeness: nominal configured weight available divided by total nominal weight (`DOMAIN_COVERAGE`). Missing components cause active-weight redistribution.
- Confidence: existing categorical `LOW/MEDIUM/HIGH`, based only on completeness and baseline sample count. It is not a probability and does not imply medical accuracy.
- Versioning: `algorithm_version=health-score-v1.0` is stored with derived output; HDL v2 also stores an input fingerprint and supports one ACTIVE revision.
- Traceability: non-sensitive canonical record IDs and source update times produce a deterministic SHA-256 input fingerprint. Raw health payloads are not embedded.
- Time: canonical timezone is explicit. Sleep daily attribution remains `WAKE_DATE_V1`; the generic output period uses its explicit end instant and timezone.
- Duplicate/update/delete/stale: identical inputs yield an identical fingerprint. Active evidence only participates. Deleted/stale records are excluded; source updates change the fingerprint and must use the existing bounded invalidation/recompute path.
- Device quality: `UNKNOWN`. No accuracy coefficients exist and none are invented.
- Calories: Activity Score uses total calories burned and its baseline; active calories remains a separate canonical value and is not substituted.

## Phase-1 implementation boundary

The Python package is a parity/reference foundation, not a production cutover. It implements shared contracts and the evidenced Sleep, Activity, Training, Nutrition, Body Composition, Recovery, Fatigue, and Overall Health formulas. The canonical Apps Script remains the runtime source until broader cross-language golden parity fixtures and a separately authorized cutover exist. No formula was changed or added.

Recalculation remains bounded through the existing dirty-state and compare-before-save behavior. Production migration, deployment, and database writes are outside this phase.
