# Supabase support question: Beta PostgreSQL target

No secret, credential, health data, or production identifier is included.

Project ref: `uavimjgccigpbwqmfkhh`

New empty Free probe ref: `dsdfacbjaicdcwayhhil` (`health-companion-beta-v2`).
Created on2026-09-19 in the same region; actual project build17.6.1.166 and SQL
server_version17.6 / server_version_num170006. No application migration or deployment
was applied. This confirms that the observed new-project path also provisions17.6.
New-project upgrade eligibility has not been retrieved; the following eligibility
fields belong only to the original Beta.

Current project metadata:

- Plan: Free
- Region / release channel: `ap-southeast-1` / `ga`
- PostgreSQL build: `17.6.1.166`
- Dashboard: `LATEST`, no Upgrade project action shown
- Upgrade eligibility API: `eligible=false`,
  `latest_app_version=supabase-postgres-17.6.1.166`, no target versions

Questions:

1. What exact Supabase PostgreSQL build would this Free project receive if it were
   paused and restored today?
2. Is PostgreSQL 17.11 or later available for this project, region, and release
   channel through any supported no-cost path?
3. Does build `17.6.1.166` include vendor backports for the PostgreSQL security fixes
   released in 17.7 through 17.11? If yes, where is the official build-to-fix mapping?
4. If neither backport equivalence nor 17.11+ is currently available, what supported
   upgrade path and expected availability apply?

Please identify the exact target build or official release/build documentation. Do
not initiate an upgrade, pause, restore, or any other project mutation in response.
