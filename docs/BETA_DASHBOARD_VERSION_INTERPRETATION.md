# Beta dashboard PostgreSQL version interpretation

Run: `health-pg-target-20260918-125833`

Target project: `health-companion-beta` (`uavimjgccigpbwqmfkhh`)

## Decision

`DASHBOARD_LABEL=LATEST` is consistent with the project-specific Management API
result, but it is not evidence that the project is on PostgreSQL 17.11.

The read-only official endpoint
`GET /v1/projects/{ref}/upgrade/eligibility` returned:

- `current_app_version=supabase-postgres-17.6.1.166`
- `latest_app_version=supabase-postgres-17.6.1.166`
- `eligible=false`
- `target_upgrade_versions=[]`

For this project at the time of the request, the control plane therefore exposes no
in-place upgrade target and considers build 17.6.1.166 its latest application build.
The UI label must not be generalized to mean the latest upstream PostgreSQL 17 patch.

## Evidence boundary

The official UI documentation does not define the `LATEST` badge as an upstream
PostgreSQL patch guarantee. The Management API result is the authoritative
project-specific evidence used here. It proves that there is no currently offered
in-place target; it does not prove security backports or a pause/restore target.

Sources:

- https://supabase.com/docs/reference/api/v1-get-postgres-upgrade-eligibility
- https://supabase.com/docs/guides/platform/upgrading
