# Engine version matrix

All new adapters are development policies, not clinically validated algorithms. Existing health-score-v1.0 formula and CURRENT routing remain unchanged.

| Output | Version | Policy / required evidence |
|---|---|---|
| Nutrition | nutrition-score-v1.0 | Deterministic reference arithmetic; confirmed manual inputs; frozen macro/meal score; generic target confidence LOW |
| Sleep | sleep-score-v1.0 | Observed interval union, duration, measured regularity; no fabricated stages |
| Activity | activity-score-v1.0 | Observed steps/energy; explicit personal target, stable baseline or frozen fallback |
| Cardio | cardio-score-v1.0 | Existing recovery RHR/HRV components against personal baseline; not clinical risk |
| Body | body-score-v1.0 | Measured weight trend/baseline, actual fat mass and supplied goals; no invented composition |
| Recovery | recovery-score-v1.0 | Measured RHR/HRV and sleep; missing dimensions remain missing |
| Overall | health-score-v1.0 | Existing six-input formula; unchanged weights and missing-value behavior |

Perception: `PREPARED_NOT_PRODUCTION_VALIDATED`, fixture-only. Food-reference source/version accompanies nutrients. Sleep day policy: `WAKE_DATE_V1`. Version history is append-only and separates output kind, engine version and input fingerprint. A changed formula/target policy requires an explicit version decision; no promotion to CURRENT is performed here.

Release boundary: local/test storage and authenticated-host API interface are implemented. Production identity mapping, deployment, verified food reference coverage, real-world calibration and physical-device ingestion-to-score evidence are not included in this release.

## Runtime-closure provenance review (2026-09-12)

This review distinguishes ENGINEERING_CORRECTNESS (testable), REFERENCE_DATA_VALIDATION (source-specific), and REAL_WORLD_VALIDATION (not performed). **Every new domain adapter remains EXPERIMENTAL / UNVALIDATED.** LOW confidence does not validate a formula. There is no established applicable clinical population, outcome calibration, diagnosis capability, pediatric/pregnancy/athlete suitability or medical decision threshold.

| Adapter | Units / rules inspected | Provenance and validation |
|---|---|---|
| Nutrition | kcal; protein/carbs/fat/fiber g; sodium mg. Frozen weights .30/.35/.15/.10/.10 for energy/protein/carbs/fat/meal distribution. Target ratio plateaus .85–1.15/.90–1.25/.70–1.30/.70–1.30; 2–5 meals plateau. Fiber/sodium informational only. | `HealthScoreEngine.score_nutrition` and `DomainEngines.calculate`; ratios, weights, meal-count range and score bands are product heuristics, NOT established scientific rules. |
| Sleep | Minutes. Default 480-minute target; duration/efficiency/deep/REM/continuity/regularity/night-HR weights .30/.20/.15/.10/.10/.10/.05. Adapter supplies measured duration and observed regularity only. | Frozen `score_sleep` + `SLEEP_WEIGHTS`; target and weighted composite unvalidated for personalized use. No fabricated stages/efficiency. |
| Activity | Steps count and energy kcal; weights .7/.3. Explicit target or previous observed baseline or legacy 7,000 fallback; energy baseline plateau .8–1.25. | Frozen `score_activity`; 7,000 is a legacy product fallback, not an individual prescription or universal healthy threshold. |
| Cardio | Resting HR bpm / HRV ms, at least 7 previous daily samples within the 28-day inclusive window (at most 27 previous days). Uses only recovery's HRV/RHR components, renormalized available weights .35/.25. | `score_recovery` heuristic: HRV 50 + relative deviation ×180; RHR 100 − elevation×8 + reduction×2, clamped. No cardiovascular-risk validation. |
| Body | Weight/fat mass kg; 7-day observed weight mean; supplied weight goal only. Weights .45/.25/.30; goal distance ×6, weight change ×18, fat change ×30 rules. | Frozen `score_body_composition`; experimental trend score, not body-composition measurement. BMI only when actual height supplied; no invented goal/height. |
| Recovery | HRV ms, RHR bpm and available sleep score; original component weights .35/.25/.20/.15/.05. Training/subjective remain absent. | Frozen recovery heuristics; overlap adjustment stays in original overall formula. Not fatigue diagnosis or exercise clearance. |
| Existing overall | Sleep/recovery/activity/training/nutrition/body weights .25/.20/.15/.15/.15/.10 with original missing-input/overlap adjustment. | Original Beta score bridge and golden fixtures unchanged. Experimental domain outputs are stored separately and do not replace Beta's original input semantics. |

Missing data: canonical missing fields stay null. Frozen scoring renormalizes available components and reports completeness; no evidence means INSUFFICIENT_DATA. Nutrition additionally needs known energy and protein. Unknown source/portion/nutrient is not converted to a healthy or unhealthy zero. Timezone attribution and outlier exclusion are engineering policies, not accuracy guarantees.

Generic nutrition label targets match the [FDA Daily Value table](https://www.fda.gov/food/nutrition-facts-label/daily-value-nutrition-and-supplement-facts-labels): protein 50 g, carbohydrates 275 g, fat 78 g, fiber 28 g, sodium 2,300 mg. FDA describes [2,000 kcal as general labeling advice](https://www.fda.gov/food/nutrition-facts-label/lows-and-highs-percent-daily-value-nutrition-facts-label), not an individual's energy need. This verifies the origin of constants, **not the app's target-ratio score, weights or health validity**. No FDA food dataset is downloaded or redistributed here.

### Food reference and photo boundary

- No production food catalog, licensed food dataset, verified model weights or image inference implementation exists in this track. PHOTO_MODEL_IMPLEMENTATION = MISSING; fixture/perception interfaces are not a camera feature.
- The local Web path supports confirmed user label values per 100 g scaled by explicitly supplied **edible, as-served grams**, or confirmed whole-meal totals. It does not silently assume weight. A missing/invalid weight or missing label source rejects label-mode submission.
- Serving conversion needs a stated serving weight; raw/cooked foods are different references. No raw-to-cooked yield, edible fraction, cooking multiplier or oil estimate is inferred. The Web label path uses the final prepared food label and never adds oil. It cannot validate whether a user manually entered duplicate ingredients.
- Confirmed user totals have precedence in `MANUAL_CONFIRMED` mode. Otherwise the Python calculator requires an exact preparation-specific food reference; photo nutrients cannot override it. Source/version is stored with the Web meal's label values. User-provided text is provenance metadata, not proof the label is accurate or licensed for redistribution.
- Test numbers are explicitly named synthetic arithmetic vectors, not invented database values for real foods. Their only assertion is multiplication and state propagation. No error percentage, 95% confidence interval, personal goal or real-world accuracy has been manufactured. Estimation bounds, if provided to the reference implementation, must come from the caller/source; none are generated in this E2E.
- Public enablement requires independently validated rule suitability, curated source/version/license review, calibrated missing-data/uncertainty presentation and separately authorized rollout. No user-selected label is promoted into a shared food database.
