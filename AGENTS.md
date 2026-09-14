# Health Companion project instructions

These project rules supplement the inherited `AI_POOL_GLOBAL_RULES_V1`; they never
weaken secrets safety, single-primary ownership, destructive-operation approval or
production authorization. Preserve existing unrelated/Android changes. No push,
remote CI, deployment, production/Beta mutation, OAuth/permission/signing change or
paid service without explicit authorization for that action and environment.

## Required completion reporting

At the end of every completed development task, the **first line** of the final
report must state `整體專案已驗收完成率：XX.X%` or `UNKNOWN`.
Read `PROJECT_PROGRESS.md` and `project-progress.json`; run
`node scripts/calculate-project-progress.mjs --check`. Preserve the scope, weights
and baseline version. Credit only leaf gates with semantically accepted, current,
hash-verified PASS evidence. Withdraw credit after a relevant regression. BLOCKED,
FAIL, UNKNOWN and unfinished IN_PROGRESS stay in the denominator with zero credit.
Do not count parents or progress tooling; do not round incomplete scope to 100%.

If the complete delivery version/scope is unconfirmed, overall progress is UNKNOWN;
a provisional known-scope percentage must be labeled separately. First baseline has
PREVIOUS_PROGRESS=NOT_AVAILABLE. Scope/weight changes require a new baseline version
and are not engineering progress. Local evidence never proves remote Beta, device,
Google OAuth, food/photo accuracy or scientific validity. Report release blockers
independently of percentages. Include the baseline version, progress change (or
first baseline), evidence, scoped local commits, remaining blockers and NEXT_ACTION.

## Local runtime and evidence safety

Python remains a reference/test runtime; the opt-in application engine path uses
`engine-portable.ts` and the unchanged frozen JS formulas. Use the checked-in parity
contract; never alter goldens or widen tolerances to hide a difference. Actual
Supabase CLI Edge execution must be separately proven; ordinary Deno is not Edge.
All local feature flags remain OFF by default. Never activate remote routes merely
because compatible code exists.

Use only new, dedicated loopback synthetic PostgreSQL clusters. The legacy bundled
18.4 binary is retained for provenance but must not be executed: set
`LOCAL_ENGINE_PG_BIN` to a reviewed official PostgreSQL 18.6+ portable bin directory.
The explicitly authorized PG17 compatibility track may use reviewed official 17.11+
with `LOCAL_ENGINE_PG_MAJOR=17`, its own new data/database and isolated available port
(normally 57485; the standalone native runner uses 57484). Never point PG17 at a PG18
data directory or equate ordinary PostgreSQL with all Supabase platform extensions.
Do not reset/clear existing databases. Preserve raw run evidence and failed attempts;
manifest commands, times, exit codes and source hashes. Classify fresh/cached/not-run
separately; repeated runs and nested golden vectors are not additional test cases.

## AI Pool v2 local tooling

Use `scripts/ai-pool-v2-check.ps1` and `docs/AI_POOL_V2_TOOLCHAIN.md` for optional
deterministic audits. Reuse installed tools, D-scoped caches and isolated Python venv;
do not reinstall globally or move/clean Docker/WSL data. Scanner findings are distinct
from execution failure and require triage. Never infer release/security PASS from an
empty or incomplete scan, or run Schemathesis/act against real credentials by default.
Reports/snapshots/traces remain ignored/local. Optional audit failures must not suppress
independent required regression; no source/SBOM uploads or paid integrations by default.
