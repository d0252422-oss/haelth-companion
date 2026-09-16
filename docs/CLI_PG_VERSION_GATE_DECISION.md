# CLI / PostgreSQL Gate decision — 2026-09-17

Evidence: `D:/Dev/Evidence/health-critical-20260917-065444`.
No runtime/source/migration/security floor changed. Prior local10/10 and28/28 remain accepted.

CLI_PG_17_6_SOURCE = B: checkout `supabase/.temp/postgres-version` contains17.6.1.166.
CLI2.117.0 `services` reports that exact local/remote tag. A new unlinked D-only
config with major17 selects17.6.1.167, not166. Thus the previous assertion that
CLI2.117 unconditionally hardcodes166 was too broad. No pin/cache was changed.

CLI_PATCH_VERSION_CONFIGURABLE = YES_WITH_SUPPORTED_SERVICE_VERSION_INPUTS.
Official tagged source documents `local-versions.json` / one-run `--service-version`
and linked version cache; legacy resolver also reads `.temp/postgres-version`.
This proves selection behavior, not availability/security of an arbitrary image.
No invented image tag, direct-native replacement or manual CLI internals patch.

PROJECT_REALLY_REQUIRES_CLI_17_11 = NOT_LITERAL_PATCH_EQUALITY; SECURITY_FLOOR_APPLIES.
AGENTS.md introduced the patched17.11+ native compatibility rule in3ef6b61.
`local-engine-postgres.mjs` enforces it; BETA_REMOTE_ENABLEMENT_PLAN cites
CVE-2026-16239. This was not an arbitrary equality assertion, nor a Web-only rule.
The current request's proposed17.6 execution conflicts with that retained security
rule. Do not weaken it by re-labeling old binaries or bypassing the guard.

HOSTED_TARGET_PG_VERSION =17.6, server_version_num170006; platform17.6.1.166.
Fresh metadata-only SQL confirmed this, so the issue is not merely local CLI drift.
Target is health-companion-beta/uavimjgccigpbwqmfkhh, organization
pcfenospezigjlgwcbtg, region ap-southeast-1. No health rows or secret values read.

PATCH_LEVEL_COMPATIBILITY_RISK = FUNCTIONAL_UNMEASURED_AND_SECURITY_RELEVANT.
Upstream17.11 fixes portal/cursor memory safety and role-dependent cached-plan/RLS
invalidation. Functional CRUD/RLS success cannot prove these vulnerabilities absent.
The inspected vendor166 Nix config builds upstream17.6; its listed patches concern
paths/runtime directories, not demonstrated backports of those fixes. Hosted binary
backport status remains UNKNOWN, not a claim that this metadata proves exploitability.
Official upgradePR2155 is still open/unmerged; latest20 release metadata reviewed
contains17.6/17.9 families, no verified17.11 platform candidate. This bounded search
does not prove that no candidate exists anywhere.

## Revised acceptance definition

1. Supported CLI config/services/handler execution must be demonstrated independently.
2. Major must match target; exact patch equality alone is neither PASS nor FAIL.
3. Require reviewed patched binary OR official build-specific equivalent-backport
   evidence covering the security floor. A tag label/HTTP200/test pass is insufficient.
4. On an approved differing patch, run focused same-migration/extensions/functions/
   RLS/transaction/lock/queue/publication comparison. No full Web rerun by default.
5. PASS_WITH_DOCUMENTED_PATCH_VARIANCE requires both security equivalence and that
   focused comparison plus actual CLI execution, not just a paper exception.

CLASSIFICATION = B_SELECTION_IS_CONFIGURABLE; A/D_ACCEPTABILITY_NOT_ESTABLISHED.
PATCH_LEVEL_COMPATIBILITY = NOT_RUN_SECURITY_FLOOR_CONFLICT.
SUPABASE_CLI_PLATFORM_GATE = BLOCKED_VERSION_INCOMPATIBILITY_SECURITY_EVIDENCE.
No freshPG17.11-only run is counted as two-version parity. No oldDB/image started,
no images pulled, no Docker/WSL changes. Current platform cannot be cleared simply
by approval to deploy. Next evidence needed: vendor166 security backport attestation
or supported patched platform and its safe local equivalent. Then run focused suite.

## Primary sources

- [Tagged CLI service-versioning](https://github.com/supabase/cli/blob/v2.117.0/packages/stack/docs/service-versioning.md)
- [Tagged legacy image resolver](https://github.com/supabase/cli/blob/v2.117.0/apps/cli/src/command-internal/legacy-db-image.ts)
- [Tagged service catalog](https://github.com/supabase/cli/blob/v2.117.0/packages/stack/src/ServiceCatalog.ts)
- [Vendor166 build config](https://github.com/supabase/postgres/blob/17.6.1.166/nix/config.nix)
- [Vendor166 patch list](https://github.com/supabase/postgres/blob/17.6.1.166/nix/postgresql/generic.nix)
- [PostgreSQL17.11 changes](https://www.postgresql.org/docs/17/release-17-11.html)
- [Supabase Postgres upgradePR2155](https://github.com/supabase/postgres/pull/2155)

The166 amd64 registry manifest is
`sha256:d5424e9f4d0c21d63991c3f3dd77881f23f722c3a212452a61bc91924b79e8c8`.
Manifest inspection is not a binary security attestation. Existing155 cache is not
the selected166 image; cache presence does not determine the project selection.
