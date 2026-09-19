# Project acceptance progress

整體專案已驗收完成率：UNKNOWN

Baseline: `known-scope-v0.1-provisional-2026-09-12`.
Status: `PROVISIONAL_KNOWN_SCOPE_ONLY`. Previous comparable progress: `32.0%`.
暫定已知範圍完成率：**32.0%**（32 / 100）；這不是全專案完成率。
Uncredited weight: 68. Progress change: **+0.0 percentage points** on the same baseline.
The original2026-09-12 calculation remains the first baseline (`PREVIOUS_PROGRESS=NOT_AVAILABLE`);
this2026-09-14 continuation is a comparison, not a scope/weight revision.

## Scope evidence and missing decision

Empty-probe run `health-beta-probe-20260919-223821` created one explicitly authorized
Free Beta project (`dsdfacbjaicdcwayhhil`), then confirmed hosted build17.6.1.166 and
SQL17.6 /170006. The version gate failed; no migration/deployment/test-data write
followed. This closes the provisioning-target uncertainty, not a release leaf.
Prior local PASS remains accepted. Fixed known scope32.0%, +0.0pp; overallUNKNOWN.
New unweighted deliverable: actual new-Free-project version evidence and stop record.

External-evidence continuation `health-external-20260917-081934` found an official
v14 source export and exact four-file match to a69cb33, closing rollback provenance,
and confirmed the Beta organization is Free with a documented managed minor-upgrade
path. The target version/downtime still require Owner review and the remote database
remains17.6, so no remote/release weighted leaf closes. New unweighted evidence only;
scope/weights unchanged:32.0%, +0.0pp, overallUNKNOWN.

Security/provenance review `health-security-20260917-075734` mapped official PG17.7–
17.11 advisories and refreshed Beta metadata/Git/CI rollback provenance. Vendor
security-equivalence evidence and trusted old rollback source remain absent.
No weighted leaf closed, no prior local acceptance withdrawn;32.0%, +0.0pp.
New unweighted deliverables: advisory applicability matrix, baseline origin,
upgrade feasibility and rollback source inventory. No scope/weight changes.

Critical-path review `health-critical-20260917-065444` clarified CLI local pin versus
default and retained the security-patch floor; froze candidate/authorization hashes,
rechecked old Edge download containment refusal, and finalized credential/OAuth
instructions. No remote or weighted release leaf closed; known scope32.0%, +0.0pp.

Worker/CLI continuation `health-worker-20260917-055400` adds separate delegated
ingestion and lease-bound recompute roles, pooled-context/retry rehearsal, SQL
canonical profile routing and explicit weekly/check-in deferral. CLI2.117 still
selects a patch below the approved platform baseline. These are unweighted
deliverables or strengthening of already-credited local gates. Broader weekly,
CLI-platform/remote/OAuth acceptance remains incomplete. Fixed denominator/weights
unchanged:32.0%, engineering+0.0pp, ledger correction+0.0pp, overallUNKNOWN.

Current non-privileged continuation `health-nonprivileged-20260916-224316` adds
transaction-local verified Web identity, a restrictive manual runtime role/RLS
successor, pooled-context isolation tests and strict official hosted CA validation.
These strengthen already-credited local leaves; they do not satisfy the unchanged
CLI-platform, complete hosted SQL/auth, or remote Beta acceptance conditions.
The25 original leaves/weights remain unchanged: engineering +0.0pp, ledger
correction +0.0pp, known scope32.0%, whole-project UNKNOWN. See this run's external
REPORT/manifest for fresh execution; migration preparation/TLS transport alone do
not prove remote DB authentication or deployment readiness.

AI Pool v2 toolchain run `ai-pool-v2-20260914-094638` adds dev-only tooling, D-scoped
installs/cache and repeatable scans, not product features or weighted acceptance units.
Existing local regression remains accepted; no scope/denominator/weight change.
Known-scope32.0%, overall UNKNOWN, +0.0pp. Scanner findings and coverage limits are
tracked separately in `docs/AI_POOL_V2.md`; installed tools do not resolve remote,
OAuth, CLI-platform, real-device or scientific-validation release gates.

Current preparation run `health-beta-preparation-20260914-092035` makes no product
weight change. Fresh read-only Beta schema/settings/platform/rollback checks and an
offline eight-migration/51-action inventory are new unweighted deliverables. Original
local PASS evidence is retained. `edge_execution`, `overview_training_weekly` and
`remote_beta_oauth` remain ACCEPTANCE_NOT_FULLY_MET (CLI platform, whole-site SQL and
hosted auth still blocked); existing local leaves ALREADY_CREDITED. No ledger omission,
reweight or denominator change. Engineering0.0pp, correction0.0pp, known scope32.0%.
See [remote enablement preparation](docs/BETA_REMOTE_ENABLEMENT_PLAN.md). No remote
role/settings/migration/deployment/data mutation was performed.

Previous run `health-edge-recovery-20260914-072059` recovered Docker and passed27
original-Web/SQL gates through the official Supabase Edge user isolate and fresh
nativePG17.11. Direct Docker orchestration is not the unchanged `edge_execution`
leaf's Supabase CLI acceptance. The CLI platform remains blocked by the approved
PG17.11+ image requirement; current official platform inventory is17.6.1.171 and the
queried17.11 registry tag set is empty. This is not a reason to falsify platform
metadata, lower the reviewed PostgreSQL baseline or mutate the old running stack.
Fresh Node91, Deno99, package2 and Deno-host ReleaseA19 regression supplement the
EdgeAB27 evidence; tests and integration gates are counted separately.

The25 original acceptances/weights are copied in `edge_recovery_continuation`.
Eight remain ALREADY_CREDITED;17 ACCEPTANCE_NOT_FULLY_MET. No accepted local gate was
contradicted by the new harness failures; corrected import-map/entrypoint/TLS/policy
attempts are preserved and the selected source-consistent Edge run passes. No ledger
omission, weight change or extra4 points for running an already credited path again.
New unweighted work: safe Docker recovery, reusable real-user-isolate harness,
signature-verifying local TLS auth path, and verified Beta role/config/migration
gap inventory. Overall UNKNOWN; provisional32.0%; engineering0.0pp; correction0.0pp.

Previous run `health-manual-ux-20260914-025012` added SQL sleep/steps/total expenditure,
training draft/navigation and body-date fixes, records history, decimal/null nutrition,
and bounded neighbor/snapshot regression repairs. Its25 per-leaf accounting records
are in `manual_ux_continuation` in the machine ledger; previous accounting is retained.
Eight local leaves remain ALREADY_CREDITED,17 ACCEPTANCE_NOT_FULLY_MET. New requested
observation/UX/preparation increments do not create weighted leaves. No ledger omission
or scope/weight adjustment: net engineering0.0pp, correction0.0pp,32/100 known scope.
The current-run PostgreSQL RED defects temporarily invalidated its4-weight acceptance;
credit is restored only after the new native/queue/publication regression passes, not
because an older report still hashes correctly. Overall scope remains UNKNOWN.

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
| Runtime | 4 / 8 | Portable core and direct official Edge passed; original CLI-platform leaf remains blocked |
| Existing Web | 4 / 8 | Full meal Browser passed; full overview/training/weekly acceptance unverified |
| Android | 0 / 8 | JVM/lint passed, but intended APK build and OEM device gates not accepted |
| iOS | 0 / 8 | Build/platform scope/device evidence still required |
| Photo / food | 0 / 12 | Model, benchmark and reference validation remain open |
| Release / Beta / privacy | 0 / 12 | Conditional Beta authority granted; prerequisites/security/distribution gates remain open |
| Remaining documented roadmap | 0 / 16 | LINE V4, recovery V2, guidance V3, personalization V5 retained |

The exact per-leaf acceptance conditions and hashed evidence are in
`project-progress.json`. Run `node scripts/calculate-project-progress.mjs --check`.
Only semantically accepted PASS with existing matching evidence gets credit. Missing
or changed evidence withdraws credit; BLOCKED/FAIL/UNKNOWN/IN_PROGRESS stays in the
denominator. Hash integrity alone is not semantic acceptance. Raw local evidence is
intentionally ignored by Git; another checkout without it must not inherit these PASS
credits merely from a cached report. Incomplete scope is never rounded to100%.

Required first-line reporting is now saved in effective root `AGENTS.md`.

## 2026-09-18 hosted PostgreSQL target discovery — unchanged denominator

Run `health-pg-target-20260918-125833` obtained new project-specific, read-only
Supabase Management API evidence. The Beta project is not eligible for an in-place
upgrade: current and latest are both `supabase-postgres-17.6.1.166`, with no offered
target. Free pause/restore still has no externally exposed project-specific target.
This closes the discovery question but does not close any weighted product leaf;
remote Beta remains blocked by the PostgreSQL 17.11 security floor. Overall remains
UNKNOWN and provisional known scope remains 32.0% (+0.0pp). No product code, remote
state, production state, OAuth state, or device state changed.

## 2026-09-19 vendor security resolution — unchanged denominator

Run `health-vendor-security-20260919-221146` canonically separated the required
PostgreSQL core security fixes from a version-label preference. Official Supabase
source maps build `17.6.1.166` to upstream PostgreSQL17.6 and supplies no required-fix
backport attestation. The current project still has no upgrade target. A Free project
slot appears available, but the new-project API does not expose a patch selector and
no official source guarantees a 17.11+ default, so replacement is not yet a safe
platform path. This is new unweighted evidence only: no remote mutation, weighted
leaf closure, denominator or weight change. Overall remains UNKNOWN; provisional
known scope remains32.0% (+0.0pp).

## Conditional Beta SQL-first continuation — same denominator

Run `health-beta-sql-first-20260914` exposed a real shared-worker counterexample to
`postgres_recompute` (weight4): while RED its credit was ineligible (28/100), even though
the older reports remained hash-valid. The additive generation guard, unified publication
and current-generation reads now pass fresh actual nativePG17 regression and the exact
legacy-first/revision/rollback/reconciliation tests. Restoring that4 yields32/100 again:
net engineering change0.0pp, ledger correction0.0pp, no new leaf or larger weight.
This is regression repair, not silently reusing the contradicted old PASS.

UI/API/DB source-state separation and manual Browser A/AB improvements support already
credited local acceptances. Package config fixes have no product weight. Conditional
Beta deployment authority is now granted, but actual Edge, hosted session/pool and
whole-Web coverage are still unaccepted; remote Beta receives0 credit. Complete product
scope is still unresolved, so OVERALL_PROJECT_PROGRESS remains UNKNOWN.

## 2026-09-14 overnight continuation — new engineering, unchanged acceptance weight

Run `health-overnight-20260914-0037` starts from `3ef6b61`, not a repeat of the previous
report. New manual Body-to-existing-engine/queue/SQL analysis, custom exercise creation/
category editing, actual provider UI state and post-commit recovery fixes have fresh
PG17/browser/parity evidence. PG17/18 lifecycle barriers now include both rename orders.
Android60 ran afresh without ADB. No formula, golden, dependency or original Android
source was changed by this work.

The25 original leaf acceptances/weights and previous accounting remain intact. New
evidence refreshes8 ALREADY_CREDITED leaves;17 remain ACCEPTANCE_NOT_FULLY_MET. Exercise
management remains OUTSIDE_CURRENT_BASELINE. No LEDGER_OMISSION was confirmed. The Body
adapter strengthens accepted local engine/SQL paths but does not itself complete the
broader overview/training/weekly acceptance. No double credit or denominator change:
engineering increment0.0pp; ledger correction0.0pp; provisional known scope32.0%.

Overall UNKNOWN still requires a confirmed delivery-version/scope decision; overnight
execution cannot invent one. Actual Docker/Edge, real OAuth/pool/Beta, intended APK/OEM,
iOS, photo/food validity and release gates remain in scope. Source packages and deferred
device-preparation tooling are not product release acceptance. No phone, C cleanup,
XiaoFei, production or remote Beta activity occurred. See the current test report and
new external REPORT/CHECKPOINT/manifest for precise selected execution evidence.

## 2026-09-13 Edge/PG17 closure — historical evidence, unchanged denominator

Run `health-edge-pg17-20260913-2210` continues `a8f7a1c`, not `efe83ed` again.
Native PG17.11 migration/core SQL, strict lifecycle barriers, actual default-handler
Browser regressions and a real hosted SQL factory were exercised with new synthetic
data. Review also reproduced and fixed hosted login/auth routing, inherited membership
guard and mixed-revision snapshot defects. Their fixed regression strengthens accepted
local gates; it does not grant a second weight or imply remote availability.

The current per-leaf accounting preserves all25 original acceptance conditions and
weights; previous accounting is retained in `continuation_history`. Eight local leaves
remain ALREADY_CREDITED,17 remain ACCEPTANCE_NOT_FULLY_MET. Added exercise management
remains OUTSIDE_CURRENT_BASELINE; LEDGER_OMISSION remains NONE_CONFIRMED. Engineering
increment0.0pp; ledger correction0.0pp. No scope change or new progress system.

Actual CLI Edge remains blocked by an inaccessible Docker startup socket. Ordinary
PG17 lacks the full Supabase platform extensions; true OAuth/pool/platform acceptance
is not credited. Connected POCO beta.12 and passive metadata are not the OEM ingestion
Gate. Phone online page has not changed. Same calculation:100 ×32/100 =32.0% known
scope; overall UNKNOWN. See the new external REPORT/manifest and current test report.

## 2026-09-13 release/exercise continuation — historical execution

Run `health-release-exercise-20260913-120836`, starting at `efe83ed`, produced new
real-handler, PostgreSQL18.6, verified Web-session mapping and exercise Browser
evidence. Fresh 10 integrated gates PASS; real Edge/OAuth remain unaccepted. The
per-leaf `continuation_accounting` in `project-progress.json` records every original
acceptance, original weight, new evidence and reason (25 leaves, no double counting).

- ALREADY_CREDITED: all8 accepted local leaves; new security/CRUD/parity strengthens
  their evidence but earns no duplicate weight. Fresh files are hash-linked in ledger.
- ACCEPTANCE_NOT_FULLY_MET:17 remaining leaves, including actual Edge, full confirmed
  overview/14-day/weekly UI, Beta/OAuth, release, devices and real-world validity.
- OUTSIDE_CURRENT_BASELINE: the newly requested exercise catalog management and
  package tooling do not create/expand weighted gates during this run.
- LEDGER_OMISSION: NONE_CONFIRMED; correction0.0pp, engineering increment0.0pp.

Calculation:100 × (8 ×4) /100 =32.0%; uncredited68. Full delivery scope still lacks
confirmed version/cutoff and iOS/charging decisions: overall UNKNOWN, not32% overall.
Photo model, food reference, score validity, Android/iOS and release remain visible.
This is real new work with +0.0pp under the unchanged baseline, not repeated closure.

## 2026-09-13 continuation

Git isolation/migration has no product weight. Manual body SQL and the added historical
meal/read-back/security regression do not complete the broader overview/training/weekly
leaf, and do not imply remote Beta, real OAuth, OEM device or clinical validity.
The same25 leaves and weights remain unchanged. Overall scope is still unconfirmed;
the known-scope32.0% must not be labeled a full-project percentage. C cleanup is deferred,
not accepted and not a prerequisite for the independent D checkout's local development.
