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
