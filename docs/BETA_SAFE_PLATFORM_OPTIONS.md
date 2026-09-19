# Beta safe-platform options

Run `health-vendor-security-20260919-221146`; read-only decision only.

| Option | Official support | Free | Downtime | Data migration | Rollback | Decision |
|---|---|---|---|---|---|---|
| A. Wait for a vendor 17.11+ target | Yes | Yes | None until action | None | Current Beta unchanged | RECOMMENDED_CURRENT_SAFE_ACTION; timeline unknown |
| B. Pause/restore current Free project | Yes | Yes | Yes | Platform-managed restore | Support/recovery dependent | NOT_READY: exact target is not exposed or selectable |
| C. New Free Beta project plus logical schema/test-data migration | Yes, generic project creation and CLI backup/restore | Slot appears available from current read-only inventory | Cutover only | Yes | Keep old Beta intact | NOT_READY: new-project PG patch cannot be selected or proven before creation |
| D. Restore/clone to another project | Yes | No; official physical clone requires paid plan/backups | Yes | Platform-managed clone | Source retained | REJECTED_PAID |
| E. Transfer or region move | Transfer supported, but it does not change infrastructure/region | Conditional | Possible | Separate migration for region | Project-specific | NOT_A_PATCH_UPGRADE_PATH |

## Free-slot evidence

Official billing documentation grants two active Free projects and states paused
projects do not count. Current read-only inventory contains one `ACTIVE_HEALTHY`
project and one `INACTIVE` project in the Free organization. Therefore
`FREE_PROJECT_SLOT_AVAILABLE=YES_BY_CURRENT_ACTIVE_COUNT`, subject to the platform's
final cost/quota confirmation and the account-wide Owner/Admin quota rule.

Sources:

- https://supabase.com/docs/guides/platform/billing-on-supabase
- https://supabase.com/docs/guides/platform/billing-faq

## Why a replacement is not yet executable

The official project-creation contract accepts organization, name and region but
does not expose a PostgreSQL patch target. No official documentation or changelog
found in this bounded review guarantees that a new hosted project is provisioned on
17.11 or later. Creating a project merely to discover the patch is a remote mutation,
requires cost confirmation, and is outside the current authorization.

The official logical backup/restore guide supports migration to a new project, but
it does not establish the target project's patch level. Physical restore-to-new is
paid-only. Consequently:

`NEW_PROJECT_DEFAULT_PG_VERSION=UNKNOWN_NOT_EXPOSED`

`SAFE_PLATFORM_REPLACEMENT_AVAILABLE=NO_TARGET_NOT_PROVEN`

Sources:

- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- https://supabase.com/docs/guides/platform/clone-project
- https://supabase.com/docs/guides/platform/backups

## Re-evaluation trigger

Re-open this gate only when one of these changes:

1. The existing project's official eligibility metadata offers 17.11+.
2. Supabase publishes build-specific backport coverage for 17.6.1.166.
3. Supabase documents or exposes a selectable new-project target of 17.11+.
4. Supabase Support confirms one of the above in writing.

Until then, do not pause, restore, create a replacement project, apply migrations or
deploy Edge/Web.
