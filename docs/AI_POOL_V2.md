# AI Pool v2 — deterministic, local-first verification

This extends [AI_POOL_FAILOVER_CONTRACT.md](AI_POOL_FAILOVER_CONTRACT.md), not a
replacement product architecture or a new paid AI subscription. One primary writer;
optional second AI reports findings before edits. No external source upload is needed.

| Role/tool | Responsibility | Evidence boundary |
|---|---|---|
| CHATGPT_ARCHITECT | Architecture, stages, acceptance | Review does not execute tests |
| CODEX_PRIMARY_ENGINEER | Inspect, implement, test, repair, orchestrate | Scoped writes and source-linked evidence |
| Playwright | Browser/mobile UI and existing authenticated SQL E2E | Local synthetic != real OAuth/device |
| Schemathesis | API property/contract/fuzz testing | No project OpenAPI found: prepared, not API PASS |
| POSTGRESQL_NATIVE_TESTS | Schema, RLS, transaction/recompute concurrency | Dedicated reviewed PG17.11+ /18.6+, never remote |
| SQLFluff | postgres dialect parse/lint | Style is advisory; parser errors require actual SQL confirmation |
| OSV | Locked dependency vulnerability matching | Offline DB, no source upload; unlocked dependencies unverified |
| Trivy | Filesystem dependencies/config/secrets/licenses | Tracked-source subset; not all binaries/platform coverage |
| actionlint | Workflow syntax and expressions | Shellcheck/pyflakes intentionally disabled when unavailable |
| zizmor | GitHub Actions security audit | Offline audits, findings need triage, no permission changes |
| act | Local workflow discovery/simulation | This run list-only; no jobs/images or GitHub-equivalence PASS |
| Syft | CycloneDX package/version/license/source inventory | SBOM completeness != absence of vulnerabilities |
| SECONDARY_AI | Optional independent review | Not required to continue; no claim of independent review this run |

## Gate policy

Required: existing lint/typecheck, unit/integration, native SQL/RLS, critical browser
flow and actionlint. Missing required prerequisites return BLOCKED, not PASS.
Security before Beta: OSV/Trivy/secret coverage and zizmor review. A successful scanner
process is not a clean security gate. Critical vulnerability, high-confidence secret
exposure, broken workflow/SQL/browser or API invariant failure blocks the affected
release path. Style-only SQL findings, SBOM generation and incomplete-schema
Schemathesis remain informational. An unavailable optional tool must not suppress
unrelated tests. No scanner automatically upgrades dependencies or changes CI permissions.

Current scan: actionlint PASS; zizmor11 High/High unpinned-uses and3 Medium/Low
artipacked findings need review. SQLFluff1179 layout/reference-name findings, no
PRS/LXR errors. No automatic formatting. OSV/Trivy did not report known vulnerabilities
in their extracted subset; this is not zero risk. The retained legacy PG18.4 binary
remains prohibited by project instructions regardless of scanner findings. Gradle
dependencies lack complete locked resolution. Model/data licenses are separate.

Use [AI_POOL_V2_TOOLCHAIN.md](AI_POOL_V2_TOOLCHAIN.md) for exact paths, tools and commands.
This tooling adds no product acceptance weight. Overall progress remains UNKNOWN;
known-scope-v0.1-provisional-2026-09-12 stays32.0% pending its unchanged product gates.
