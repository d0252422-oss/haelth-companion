# AI Pool v2 security closure — 2026-09-14

Result: PASS_WITH_NON_BLOCKING_FINDINGS, scoped local tooling Gate only.
Evidence: D:/Dev/Evidence/ai-pool-security-20260914-103255
Base revision: 7b7ada185a220dd5fc641c7f191154b56cceaead; final source hashes/commit in external evidence manifest.

## Finding disposition

Fresh count corrects earlier reported 14 to 13 (10 pins, 3 persistence warnings).
All fixes are local. No credential disclosure was established. Each finding had a safe available fix; no accepted exception, false-positive dismissal or external configuration requirement. Upstream resolution URLs/time/SHA: config/github-action-pins.json.

| ID | File / original line | Rule | Severity/confidence | Classification | Disposition / fix |
|---|---|---|---|---|---|
| 1 | .github/workflows/algorithm-runtime-gate.yml : 27 | artipacked | Medium/Low | LIKELY_RISK | Fixed; persist-credentials: false |
| 2 | .github/workflows/algorithm-runtime-gate.yml : 27 | unpinned-uses | High/High | CONFIRMED_RISK | Fixed; Official current tag commit pin, same version |
| 3 | .github/workflows/algorithm-runtime-gate.yml : 28 | unpinned-uses | High/High | CONFIRMED_RISK | Fixed; Official current tag commit pin, same version |
| 4 | .github/workflows/algorithm-runtime-gate.yml : 31 | unpinned-uses | High/High | CONFIRMED_RISK | Fixed; Official current tag commit pin, same version |
| 5 | .github/workflows/android-beta-apk.yml : 23 | artipacked | Medium/Low | LIKELY_RISK | Fixed; persist-credentials: false |
| 6 | .github/workflows/android-beta-apk.yml : 23 | unpinned-uses | High/High | CONFIRMED_RISK | Fixed; Official current tag commit pin, same version |
| 7 | .github/workflows/android-beta-apk.yml : 24 | unpinned-uses | High/High | CONFIRMED_RISK | Fixed; Official current tag commit pin, same version |
| 8 | .github/workflows/android-beta-apk.yml : 28 | unpinned-uses | High/High | CONFIRMED_RISK | Fixed; Official current tag commit pin, same version |
| 9 | .github/workflows/android-beta-apk.yml : 42 | unpinned-uses | High/High | CONFIRMED_RISK | Fixed; Official current tag commit pin, same version |
| 10 | .github/workflows/domain-engine-gate.yml : 25 | artipacked | Medium/Low | LIKELY_RISK | Fixed; persist-credentials: false |
| 11 | .github/workflows/domain-engine-gate.yml : 25 | unpinned-uses | High/High | CONFIRMED_RISK | Fixed; Official current tag commit pin, same version |
| 12 | .github/workflows/domain-engine-gate.yml : 26 | unpinned-uses | High/High | CONFIRMED_RISK | Fixed; Official current tag commit pin, same version |
| 13 | .github/workflows/domain-engine-gate.yml : 29 | unpinned-uses | High/High | CONFIRMED_RISK | Fixed; Official current tag commit pin, same version |

## SQL debt

28 SQL files parsed, 0 parser errors. LT01=498, LT02=453, LT05=219, RF04=9, LT12=1; 1180 total. Migrations alone remain1179; the extra LT12 is from expanded staging/draft coverage. No SQL bytes changed. Baseline is reviewed/hash-specific, not a path-wide ignore. Actual parser/style/clean probes passed3/3; initial Windows ESM probe failure is retained externally.

## Fresh regression

Node critical87 + Python critical74 + build contracts2 + policy/tooling19 =182 distinct cases. PG17.11/browser27 integration gates separately (not added to unit-case count). Ruff/mypy/actionlint, offline zizmor/OSV/Trivy and SBOM generation succeeded. Zizmor after0. No product regression failure. FAST and SECURITY final runs passed; RELEASE passed, followed by scoped policy retests. FULL mode shares comprehensive checks but was not separately executed to duplicate the costly browser suite; do not report a fresh FULL run.

OSV/Trivy report no blocking finding within their source/lock subset, not universal coverage. SBOM CycloneDX1.7 has16 versioned components. Unlocked/transitive Python, Gradle resolution, binary/tool images and complete license coverage are not established. No new tools or image pulls.

Nonblocking: unchanged SQL style debt; no canonical OpenAPI; act simulation not run because no suitable cached runner; incomplete scanner coverage. Source-linked native/browser evidence remains synthetic local Deno+PG17, not actual Edge/remote/device acceptance this turn.

## CI and release boundary

The local runner is the primary Gate. Existing three CI workflows retain their triggers, commands, versions and contents:read permissions; only immutable pins/persist-credentials changed. Semantic comparison passed. Lightweight future CI integration is documented in GITHUB_ACTIONS_SECURITY_POLICY.md; no new matrix or hosted run was created.

No production/Beta writes, deploy, push, tool installs, Docker data change or paid services. Original seven protected Android/lock file hashes preserved. Overall progressUNKNOWN; provisional known scope32.0%, +0.0pp, unchanged denominator.
