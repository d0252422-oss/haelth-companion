# Algorithm cross-language golden parity gate

Status: PASS for the eight duplicated `health-score-v1.0` domains. This is readiness evidence only; runtime cutover is not authorized.

## Runtime discovery

- Canonical runtime: Google Apps Script JavaScript, production scoring unit from canonical source SHA-256 `9c9ad70781a75e04c7bab11528f09fe27b2eed3287a9a2acc0706cd0f881783e`.
- Secondary runtime: Python 3.12 `health_companion_algorithms` parity/reference engine.
- Swift/iOS and connector Node runtimes normalize and ingest records but do not calculate these scores.
- Readiness exists only in Apps Script and is therefore not cross-runtime parity-sensitive.

The committed JavaScript snapshot is mechanically extracted from the canonical runtime. It is a necessary sanitized test artifact, not a third hand-maintained formula implementation. The extraction excludes production identity, properties, network calls and deployment configuration. The full canonical source is not committed because it contains user identity/configuration material.

## Shared fixture contract

`fixtures/algorithm-golden/health-score-v1.0.json` contains 28 language-neutral cases across Sleep, Activity, Training, Nutrition, Body Composition, Recovery, Fatigue and Overall Health. Outputs were blessed only from the frozen Apps Script implementation. They cover normal, partial, all-missing, real-zero, upper/out-of-range, rounding and explicit-timezone-window cases where relevant.

Comparison is exact after the frozen contract's one-decimal score and four-decimal completeness rounding. No tolerance is used. Every case compares score, completeness, categorical confidence, sorted missing inputs, reason codes and algorithm version. Each JavaScript case is executed twice to prove deterministic repeat behavior.

Duplicate/stale/deleted/recalculation are canonical evidence-lifecycle policies rather than arguments to these pure score functions. They remain covered by ingestion/reconciliation and Python traceability tests; they are not fabricated as cross-language formula inputs. Score functions consume an already reconciled canonical input set.

Timezone is explicit in each fixture. The score functions do not derive civil dates, so timezone cannot alter their numeric result. `WAKE_DATE_V1`, UTC/local-midnight and travel/DST behavior remain covered in canonical ingestion tests, outside formula parity.

## Results

- Apps Script: 28/28 golden cases matched; snapshot/contract tests also passed.
- Python: 28/28 golden cases matched.
- Unexplained divergence: 0.
- Formula changes/additions: 0/0.
- Fingerprint parity: not applicable to the existing Apps Script scoring unit, which does not emit an algorithm input fingerprint. Python fingerprint determinism remains independently tested. A production adapter must define this before any cutover, but it is not a formula divergence.

## Duplication classification

- Apps Script ↔ Python formula duplication: `NECESSARY_RUNTIME_DUPLICATION` until a separately authorized runtime cutover.
- JSON fixtures: `SAFE_SHARED_CONTRACT`.
- Generated Apps Script snapshot: `SAFE_SHARED_TEST_ARTIFACT`, regenerated only from reviewed canonical source.
- Accidental duplication: none found.

Real-device connector unknowns remain unchanged and isolated from this gate.
