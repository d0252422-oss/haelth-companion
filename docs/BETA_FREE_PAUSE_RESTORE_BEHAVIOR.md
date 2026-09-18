# Beta Free-plan pause/restore behavior

Run: `health-pg-target-20260918-125833`

## Official behavior

Supabase documents that Free projects move to the "latest minor version" when a
paused project is restored. The same guide says the upgrade creates a new instance,
copies and upgrades data with `pg_upgrade`, involves downtime, and restores the
original database if an in-place upgrade fails.

The pause and restore Management API methods accept only the project ref; neither
method accepts a version target. The read-only restore-version endpoint is available
only while a project is paused. For this active Beta project it returned HTTP 400:
`This project is not in a paused state.`

## Target decision

`PAUSE_RESTORE_TARGET_KNOWN=NO`

`PAUSE_RESTORE_TARGET_VERSION=UNKNOWN`

The phrase "latest minor" is not mapped by the public documentation to a concrete
hosted Supabase build for this active project. In particular, it cannot be mapped to
PostgreSQL 17.11 without pausing the project or obtaining vendor confirmation. Pausing
or restoring is a remote mutation and was not authorized or performed.

Other constraints:

- Organization plan was read-only confirmed as `free`.
- Pause/restore has downtime and a one-year documented restore window.
- Supabase recommends an application-level post-upgrade validation.
- No fee was incurred and no paid plan was added.

Sources:

- https://supabase.com/docs/guides/platform/upgrading
- https://supabase.com/docs/guides/platform/free-project-pausing
- https://supabase.com/docs/reference/api/v1-pause-a-project
- https://supabase.com/docs/reference/api/v1-restore-a-project
- https://supabase.com/docs/reference/api/v1-list-available-restore-versions
