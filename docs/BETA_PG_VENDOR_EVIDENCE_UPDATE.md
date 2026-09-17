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
