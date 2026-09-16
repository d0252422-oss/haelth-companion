# CLI platform requirement — 2026-09-17

REQUIRED_CLI_VERSION = NO_EXPLICIT_REPO_VERSION_PIN
REQUIRED_POSTGRES_PLATFORM_VERSION = PostgreSQL17.11+ on compatibility track
REQUIRED_EDGE_RUNTIME_VERSION = compatible actual official runtime; tested v1.74.3
REQUIRED_CONFIG_FORMAT = checked-in supabase/config.toml, db.major_version=17
SOURCE_OF_REQUIREMENT = AGENTS.md Local runtime and evidence safety;
scripts/local-engine-postgres.mjs minimum patch guard; earlier patch-security review.
The requirement is NOT satisfied by choosing any CLI newer than a guessed version.

Existing CLI2.115.0 and official2.117.0 both select postgres17.6.1.166. On this run
2.117 config/services parse succeeded; Edge selection is1.74.3. Local migration
list/db lint returned ECONNREFUSED127.0.0.1:57922 in the existing owned overlay.
That stack was not started because its selected database is below the approved
patch baseline. No image pull, global upgrade, linked-project update or downgrade.
Functions help exposes serve/list/download/deploy, not invented local
bundle/build/invoke subcommands. Actual CLI serve/invoke remains NOT_RUN_BLOCKED.
Direct official Docker Edge + nativePG17.11 evidence remains a different gate.

Selected project-scoped executable:
`D:/Dev/Tools/supabase/2.117.0/bin/supabase.exe` (no global PATH change).
Official [v2.117.0 release](https://github.com/supabase/cli/releases/tag/v2.117.0),
asset supabase_2.117.0_windows_amd64.zip57,064,316 bytes; GitHub release SHA256 and
download agree: `ac8d9d23f5ce08ea521a4064e01b0018f8eb5d75cac664ea7b5ce246f8d559c5`.
Safe archive contained only supabase.exe and supabase-go.exe. No shell installer.

[Official config reference](https://supabase.com/docs/guides/local-development/cli/config)
documents major version; no supported patch override was established. Upstream
[postgres PR2155](https://github.com/supabase/postgres/pull/2155) remained open/unmerged
at this run's read-only check. Do not replace vendor images with unverified images,
lower the guard, patch CLI internals or claim ordinary Deno is CLI acceptance.

SUPABASE_CLI_PLATFORM_GATE = BLOCKED_UPSTREAM_PATCH_BASELINE
Next: when an official supported CLI/platform selects17.11+, verify its provenance,
services/config, isolated local stack, migration lint/history and actual handler
invoke. No Owner permission is requested to run an unsafe older platform.
Evidence: D:/Dev/Evidence/health-worker-20260917-055400/commands/cli2117-services,
upstream-cli, pg-upstream, cli-local-migrations, cli-local-lint.
