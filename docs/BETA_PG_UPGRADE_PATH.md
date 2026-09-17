# Beta PostgreSQL upgrade feasibility — no operation authorized

Target health-companion-beta / uavimjgccigpbwqmfkhh only.
Observed platform17.6.1.166 and server17.6 on2026-09-17.
BETA_PG_UPGRADE_AVAILABLE=UNKNOWN_TARGET_ELIGIBILITY.
BETA_PG_UPGRADE_OWNER_ACTION=OFFICIAL_BUILD_ATTESTATION_OR_ELIGIBLE_TARGET_REVIEW.
BETA_PG_UPGRADE_COST=UNKNOWN; no paid action or upgrade performed.

The [official hosted upgrade guide](https://supabase.com/docs/guides/platform/upgrading)
provides Dashboard Infrastructure in-place upgrades and Free-tier-only pause/restore.
Both involve downtime; eligibility and offered target must be checked for this
project, not inferred from a generic guide. The guide does not prove17.11 is
available here. Failed in-place upgrade recovery is not a general post-upgrade
downgrade guarantee. Custom-role credentials and replication/extension compatibility
need explicit planning; restore can require custom-role password reset.

Before proposing execution: obtain offered target build and security coverage,
plan/cost confirmation, estimated maintenance window, independent recoverable backup
and role/config inventory, extension/replication compatibility, tested migration
and application acceptance on the target. Credential reset or destructive changes
require separate approval. Prefer a supported in-place path if eligible; do not
pause this project merely to discover a patch version.

Post-upgrade acceptance: fresh server/build/extension metadata, restricted-role RLS,
focused transaction/function/pool compatibility, then impacted application smoke.
Rollback must preserve writes accepted after cutover: stop writes, retain evidence,
use approved forward fix or data-preserving recovery. Never blindly downgrade data
directories, delete rows, reverse migration history or overwrite SQL with Sheets.

Next safe request is vendor build-specific evidence or readonly eligibility details,
not permission to install an arbitrary image in hosted Supabase. OAuth remains deferred.
