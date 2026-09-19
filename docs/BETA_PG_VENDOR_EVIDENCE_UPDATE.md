# Beta PostgreSQL vendor evidence update — new evidence only

Run health-external-20260917-081934. Prior CVE matrix was not repeated.

NEW_VENDOR_EVIDENCE=YES_UPGRADE_PATH_ONLY.
REMOTE_BUILD_SECURITY_MAPPING=NOT_FOUND.
SUPPORTED_PG_UPGRADE_PATH=OFFICIAL_FREE_PLAN_PAUSE_RESTORE_TO_LATEST_MINOR,
conditional on Dashboard showing a target satisfying the17.11 security floor.
PG_SECURITY_PLATFORM_GATE=READY_FOR_UPGRADE_AUTHORIZATION.

## New official evidence

- [Supabase Upgrading](https://supabase.com/docs/guides/platform/upgrading) now
  explicitly describes one managed process for major/minor upgrades. The Dashboard
  shows eligibility warnings and estimated downtime; an in-place failure restores
  the original database. Free projects move to the latest minor on pause/restore.
- Fresh readonly organization metadata reports plan=free and release channels ga,
  preview for organization pcfenospezigjlgwcbtg. This proves eligibility for the
  documented Free-only pause/restore class, not the exact offered target build.
- Official supabase/postgres issue
  [#2083](https://github.com/supabase/postgres/issues/2083) acknowledges that stock
  versions before17.8 need CVE-2026-2005/2006 fixes. It closed without a linked
  development branch/PR/build166 mapping. It is not backport proof.

No official build changelog maps17.6.1.166 to the required17.7–17.11 fixes.
Therefore official security equivalence remains unproven. The safe alternative is
the supported managed upgrade path, not an inferred backport.

## Authorization boundary

Do not call pause/restore yet. First open the Beta project's upgrade UI read-only and
record the offered target. Continue only if it is PG17.11+ or an officially attested
equivalent. Obtain an owner-approved downtime window and recoverable backup status;
review warnings for custom-role SCRAM reset, logical replication slots, deprecated
extensions and pg_cron history. Reconnect pool clients and run focused post-upgrade
metadata/RLS/Edge checks. No production target is included.

PAID_COST_REQUIRED=NO_FOR_DOCUMENTED_FREE_PAUSE_RESTORE; other paths UNKNOWN.
An upgrade changes hosted data/runtime availability and needs explicit authorization.
This readiness decision is not an upgrade PASS and does not make Beta cutover ready.

## 2026-09-18 project-specific target discovery

Run `health-pg-target-20260918-125833` used the official read-only Management API
eligibility endpoint. It returned current and latest app version
`supabase-postgres-17.6.1.166`, `eligible=false`, and an empty target list. This is
new project-specific evidence: the supported in-place path currently offers no target
at all, and therefore no 17.11+ target. The prior conditional
`READY_FOR_UPGRADE_AUTHORIZATION` decision is superseded by
`BLOCKED_TARGET_BELOW_SECURITY_BASELINE`.

The official Free pause/restore guide says "latest minor", but neither the pause nor
restore request accepts a target. The restore-version GET rejected this active project
with HTTP 400 (`This project is not in a paused state.`), so its exact pause/restore
target remains unknown. No mutation was used to discover it. Vendor confirmation is
now the safe next action; see `SUPABASE_SUPPORT_PG_TARGET_QUESTION.md`.

## 2026-09-19 bounded vendor-source decision

Run `health-vendor-security-20260919-221146` found no build-level backport
attestation. It did confirm from the official `17.6.1.166` tag that the Nix source
input is upstream PostgreSQL `17.6`, while the AMI/package label is independently
`17.6.1.166`. The official repository describes the core as unmodified upstream
PostgreSQL. This strengthens the version mapping but does not prove a hosted binary
exploit or replace a vendor attestation.

Official billing docs and fresh read-only inventory show one active project in a
Free account that permits two active projects. A replacement slot therefore appears
available, but the official create-project contract has no PostgreSQL patch selector
and no official source found here guarantees that a new project lands on 17.11+.
The paid physical clone path is excluded; logical restore is supported but cannot
solve an unknown target version.

Final bounded decision:

- `OFFICIAL_BACKPORT_EVIDENCE=NOT_FOUND`
- `FREE_PROJECT_SLOT_AVAILABLE=YES_BY_CURRENT_ACTIVE_COUNT`
- `NEW_PROJECT_DEFAULT_PG_VERSION=UNKNOWN_NOT_EXPOSED`
- `SAFE_PLATFORM_REPLACEMENT_AVAILABLE=NO_TARGET_NOT_PROVEN`
- `PG_SECURITY_PLATFORM_GATE=BLOCKED_VENDOR_SECURITY_EVIDENCE`

See `PG_SECURITY_REQUIREMENT_CANONICAL.md` and `BETA_SAFE_PLATFORM_OPTIONS.md`.
