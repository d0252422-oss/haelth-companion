# Beta project upgrade behavior and current target

Run: `health-pg-target-20260918-125833`

## Supported flow

Supabase documents one managed upgrade process for major and minor upgrades. An
eligible project uses the Dashboard Upgrade project action, sees an estimated
downtime and blockers, is taken offline, and is moved to a newly created current
Supabase instance. The Management API equivalent requires an explicit
`target_version`; callers must select a value returned by the eligibility endpoint.

## Project-specific read-only discovery

For `uavimjgccigpbwqmfkhh`:

| Field | Value |
|---|---|
| Project status | `ACTIVE_HEALTHY` |
| Region / release channel | `ap-southeast-1` / `ga` |
| Current database build | `17.6.1.166` |
| Eligibility | `false` |
| Current app version | `supabase-postgres-17.6.1.166` |
| Latest app version | `supabase-postgres-17.6.1.166` |
| Offered targets | empty |
| Duration estimate | `0` hours |
| Validation errors / warnings | empty |

This is a project-specific official result, not an inference from the Dashboard.
There is currently no supported in-place target, including no target at 17.11 or
later. The absence of a Dashboard Upgrade button is consistent with this result.

## Gate result

`POSTGRES_TARGET_RESOLUTION=TARGET_CONFIRMED_BELOW_17_11`

`UPGRADE_PROJECT_TARGET_KNOWN=YES_NO_TARGET_AVAILABLE`

`UPGRADE_PROJECT_TARGET_VERSION=NONE_CURRENT_LATEST_17.6.1.166`

`PG_SECURITY_PLATFORM_GATE=BLOCKED_TARGET_BELOW_SECURITY_BASELINE`

No upgrade request, pause, restore, database write, role change, deployment, or paid
operation was performed.

Sources:

- https://supabase.com/docs/reference/api/v1-get-postgres-upgrade-eligibility
- https://supabase.com/docs/reference/api/v1-upgrade-postgres-version
- https://supabase.com/docs/guides/platform/upgrading
