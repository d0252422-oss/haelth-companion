# Core release candidate 20260927-01

Status: local candidate; remote publication is not authorized.

## Purpose

Restore training create/read/edit/delete by making the Web, Edge runtime, and
database schema one reviewed contract. Keep durable manual writes independent
from optional derived analysis and preserve the existing wearable ingestion
contract.

## Verified incident root cause

The active Beta Edge v41 reads and inserts
`public.manual_workout_sets.set_order`, while the Beta database has only applied
migrations through `20260920223000` and does not have that column. The workout
transaction therefore fails before a receipt or any set is committed. The
generic runtime wrapper then reports the misleading `ENGINE_REQUEST_FAILED`.

This candidate:

- includes `20260920224000_manual_workout_set_order.sql`;
- maps PostgreSQL `42703`/`42P01` to `MANUAL_SCHEMA_OUT_OF_DATE` (HTTP 503,
  not an automatic client retry);
- keeps the training draft when the durable write is not confirmed;
- clears the draft and releases the UI only after a durable response;
- skips the optional workout recompute when `analysisJobScheduled` is false;
- uses background readback after commit without changing the raw-write result.

## Components

| Component | Candidate | Required order |
| --- | --- | --- |
| Beta DB | `20260920224000_manual_workout_set_order.sql` only | 1 |
| Beta Edge | `mobile-health-beta` from this commit | 2 |
| Beta Web | build `20260927-core-release-candidate-01` | 3 |
| Android ingestion | unchanged | none |
| Production | prohibited | none |

Do not run `supabase db push` from the repository root: two later migrations are
outside this release. The packaged `migration-workdir` contains the exact remote
history baseline plus only
`20260920224000_manual_workout_set_order.sql`. After explicit Beta migration
authorization, use reviewed Supabase CLI `2.115.0` executable
`C:/Users/D0252/scoop/apps/supabase/2.115.0/supabase.exe` (SHA-256
`691a3312584891204dc11893abcd12fa656dbcce186ef8d0a2782f137463f6d7`)
against that isolated workdir. First run `db push --dry-run --skip-vault --project-ref
uavimjgccigpbwqmfkhh --workdir <artifact>/migration-workdir` and stop unless the
only pending migration is `20260920224000`. The apply invocation is the same
without `--dry-run`. This preserves the repository timestamp in remote migration
history and cannot update Vault. Do not use the SQL editor, `apply_migration`,
`--include-all`, the linked default project, or a different CLI version for this
candidate.

Authentication must use the separately approved, explicitly named operator
profile plus the existing
database password supplied only through the unlogged `SUPABASE_DB_PASSWORD`
environment variable. Do not run `supabase login` or `supabase link`, do not pass
the password in argv, and do not allow the passwordless temporary-login-role
path. Stop without continuing if the CLI prints `Initialising login role`, asks
for interactive authentication/password input, or the existing credential is
unavailable. Migration/deploy approval does not authorize creation or rotation of
`cli_login_postgres` or any other credential/role.

## Preflight and stop conditions

Before the migration, record read-only counts and verify the target is exactly
Beta project `uavimjgccigpbwqmfkhh`, never production
`vptqedxdxfoohbqctujf`.

```sql
select count(*) as workout_set_count,
       max(updated_at) as latest_workout_update
from public.manual_workout_sets;

select exists (
  select 1 from information_schema.columns
  where table_schema = 'public'
    and table_name = 'manual_workout_sets'
    and column_name = 'set_order'
) as has_set_order;

select version, name
from supabase_migrations.schema_migrations
where version = '20260920223000'
   or name = 'manual_workout_set_order'
order by version;

select indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'manual_workout_sets'
  and indexname = 'manual_workout_set_order_unique';

select a.pid, a.state, a.wait_event_type, a.wait_event,
       a.xact_start, a.query_start, left(a.query, 160) as query_summary
from pg_stat_activity a
where a.datname = current_database()
  and a.pid <> pg_backend_pid()
  and (a.xact_start is not null or a.state <> 'idle')
order by coalesce(a.xact_start, a.query_start);

select l.pid, l.mode, l.granted, c.relname
from pg_locks l
left join pg_class c on c.oid = l.relation
where c.relname = 'manual_workout_sets'
order by l.granted, l.pid;
```

Stop if the project ref is ambiguous, the baseline count cannot be read, or the
reviewed migration content differs from the candidate checksum. Also stop if
`20260920223000` is absent, if `set_order` or the named index already exists in
an unexpected/partial form, or if a migration history row with version
`20260920224000` or name `manual_workout_set_order` already exists. Refetch the
inventory and row count immediately before the authorized dry run. Stop if the
inventory changed, if active work is likely to conflict with the table lock, or
if the dry run lists anything except the one reviewed migration.

`ALTER TABLE ... ADD COLUMN`, the CHECK validation, and the non-concurrent
unique-index build may briefly lock this table. Supabase CLI 2.115 uses a
one-Sync pipelined implicit transaction that PostgreSQL does not treat as an
explicit transaction block for `SET LOCAL`, so the migration uses session
timeouts plus one atomic `DO` statement containing all schema DDL. The migration
uses a 5-second
`lock_timeout` and 30-second `statement_timeout`, intentionally leaves them set
through the CLI-appended migration-history insert, and then ends the dedicated
connection. The 60-second client process timeout is enforced by the disposable
local rehearsal only. The packaged remote `db push` command has no automatic
client timeout: the authorized operator must watch the command and stop the
controlled publication attempt at the approved 20-minute window. Stop sooner
on either database timeout, unexpected traffic/material drift, or a stalled
client. Interruption, client timeout, or lost network response is an ambiguous
result; inspect migration history and schema read-only before any retry. A retry
requires its own explicit authorization and is never automatic.

Packaging is blocked unless the exact candidate commit and migration SHA pass
the disposable PostgreSQL 17 CLI rehearsal. That rehearsal uses CLI 2.115.0 to
prove the successful history row, an in-`DO` failure rollback, and a locked
migration-ledger timeout that rolls back both schema and history. Its hash-bound
report is copied into `release-evidence` in the candidate artifact.
The last read-only Beta count observed while preparing this candidate was 45;
that is evidence, not a value to hardcode at execution time.

After the migration, verify:

```sql
select count(*) as workout_set_count,
       count(*) filter (where set_order is not null) as ordered_rows
from public.manual_workout_sets;

select indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'manual_workout_sets'
  and indexname = 'manual_workout_set_order_unique';

select data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'manual_workout_sets'
  and column_name = 'set_order';

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.manual_workout_sets'::regclass
  and conname = 'manual_workout_sets_set_order_positive';

select version, name
from supabase_migrations.schema_migrations
where version = '20260920224000'
   or name = 'manual_workout_set_order'
order by version desc;
```

Historical rows intentionally retain `NULL` because their original order cannot
be reconstructed. The exact row-count preservation check assumes no manual
workout write during the short DB checkpoint. The Owner has paused manual use;
before dry-run, verify that this remains true and that no other Beta writer can
insert into `manual_workout_sets` during this checkpoint. This does not stop the
service or wearable ingestion. If a concurrent write is possible or the count
changes, pause publication and use read-only row reconciliation to distinguish
new legitimate records from data loss; never delete or overwrite a new row to
make the counts match. Stop before Edge
publication if the column is not nullable `integer`, the positive CHECK or exact
partial unique index is absent, the exact single history row
`(20260920224000, manual_workout_set_order)` is missing, any other history row
appeared or disappeared relative to the baseline, or the row count changes.
Stop before Web publication if the Edge smoke does not return the expected
schema contract.

## Derived-analysis boundary

Raw SQL commit is authoritative for body, meal, workout-set, sleep, steps, and
total-energy records. A successful raw commit releases the form before optional
readback or derived-score refresh. Training-derived analysis remains explicitly
`DEFERRED_NOT_CONNECTED`; body status has no compatible SQL product contract in
this release. Total energy and partial-day observations remain raw/displayable
without pretending that a score was computed. Duration-only sleep continues to
feed the existing frozen duration score, while exact timing remains mandatory for
portable interval metrics; those two results are not conflated.

Browser-closed recovery is release-ready only after these Beta settings,
least-privilege database contracts, and the existing scheduler are verified at
publication time:

- `HEALTH_BACKGROUND_SQL_ENABLED=1`;
- `HEALTH_MANUAL_EXPECTED_PROJECT_REF=uavimjgccigpbwqmfkhh`;
- `SUPABASE_URL=https://uavimjgccigpbwqmfkhh.supabase.co`;
- `HEALTH_MANUAL_EXPECTED_DB_HOST` matches the approved Supabase pooler and both
  database URLs;
- `HEALTH_MANUAL_ALLOWED_ORIGIN` is the exact Beta Web HTTPS origin;
- `HEALTH_RECOMPUTE_DATABASE_URL` and `HEALTH_NATIVE_DATABASE_URL` each use
  `postgresql://<delegated-role>.uavimjgccigpbwqmfkhh@<approved-host>:6543/postgres`,
  with a nonempty password supplied through the secret store, no query or hash,
  and the approved pooler host matching `HEALTH_MANUAL_EXPECTED_DB_HOST`. The
  delegated roles are `health_recompute_worker` and `health_native_ingest`
  respectively; never log either URL or password;
- `HEALTH_RECOMPUTE_TRIGGER_SECRET` has at least 32 characters (never log it);
- both delegated roles retain the no-superuser, no-BYPASSRLS, no-INHERIT,
  no-CREATEDB, no-CREATEROLE, no-REPLICATION, no-membership attributes and the
  grants/policies reviewed in
  `20260916215632_delegated_worker_runtime_rls.sql`;
- the scheduler reaches the deployed Edge version and a functional smoke proves
  its `x-score-worker-secret` matches without logging either value;
- a leased job completes after the browser closes, published generation catches
  up, and bounded failure retry works;
- Android/shortcut ingestion and connector status still succeed without changing
  their schedule.

Any missing or mismatched prerequisite stops publication. Approval to publish
Edge or Web does not authorize a configuration, role, or secret change; those
require separate explicit authorization. Until that remote smoke passes,
browser-closed recovery is
`PREPARED_NOT_REMOTE_VERIFIED`, not PASS.

## Local candidate validation (not live Beta acceptance)

The following runs used synthetic fixtures or disposable local PostgreSQL 17.11;
they do not establish that the Owner's LIFF entry has been repaired.

| Check | Local result | Evidence |
| --- | --- | --- |
| Integrated Web/SQL browser release exercise after the final workout identity-switch fix | 31/31 PASS, zero errors, sequential run | `D:/Dev/Evidence/core-release-candidate-20260927/integrated-browser-final-ab-mutation/20260927-233944-e8e9b5dd9f374b46b2f78e73f8089e01/evidence/manual-sql-e2e-5e33129c-e91c-48e2-9400-d7b8e120278a/report.json` (SHA-256 `aba42f75346ce2048f095f03cec96664056fd6104b9cbb7e2be3cbde52d25ede`) |
| Browser interaction profiler | 10/10 samples, 220 flows, zero errors; visual median 50.51–83.95 ms and interactive median 54.01–90.44 ms across measured forms | `D:/Dev/Evidence/core-release-candidate-20260927/browser-performance-acceptance-fixed/20260927-231630-7b2f95d0914046cb898e94cc07e25d54/acceptance-2026-09-27T151630818Z-4cfd9a64-efa6-4f9e-9034-8517fb64cf29/performance-report.json` (SHA-256 `1686fb1d17d98863c6ccdd2b18b15ded1b7e4fb67db0e3f7f9adc76074d4c1f9`) |
| Workout identity-switch and manual SQL UI focused tests | 94/94 PASS after the final account-switch editor fix | Local test output, candidate source |
| Offline Node MJS | 111/111 PASS | Local test output, candidate source |
| Focused Deno release/domain tests, Deno check, project-configured Deno lint | 81/81 PASS; check/lint PASS | Local test output, candidate source |
| Python canonical suite | 154/154 PASS | `D:/Dev/Evidence/core-release-final-validation-20260927/python-20260927T151306870Z-18ab4167-5a1b-40bf-a7bd-8bf0e7093f86/summary.txt` |
| PostgreSQL observation publication / set-order upgrade | 10/10 and 7/7 invariants PASS | `D:/Dev/Evidence/core-release-final-validation-20260927/` |

The full CJS run had 323/328 passes: the five failures are confined to the
Android connector contract file, which expects unrelated Android changes not
included in this Web/Edge/SQL candidate. All 318 non-Android CJS tests passed
in that full run. A separate concurrent non-Android rerun hit three transient
Python worker startup timeouts; its persistent-runtime file then passed 17/17
in isolation. The first concurrent browser rerun also timed out at a login
click (30/31); the subsequent sequential run passed 31/31. These failed runs
remain recorded and are not reported as successful. Neither local browser
performance nor synthetic browser tests are a real-phone/LIFF measurement.

The clean-commit Supabase CLI migration rehearsal, manifest checksum and
release-bundle verification are generated after the candidate commit. The
rehearsal report is copied into `release-evidence` by the packager.

## Authorized Beta smoke acceptance

Steps that create, edit, or delete Beta rows require a separate explicit Beta
test-write authorization naming the test identity, record scope, and cleanup.
Database migration authorization and deploy authorization do not grant these
writes. Without that separate authorization, run only read-only catalog, build,
route, configuration, and schema checks and mark write acceptance pending.

1. Read catalog and existing workout history.
2. Create one dedicated Beta-only workout with multiple exercises and sets.
3. Confirm set order `1..N`, stable session ID, receipt, and read-after-write.
4. Replay the same request ID and confirm zero duplicate rows.
5. Edit a set and batch-edit a session; confirm revision checks and unchanged
   set order.
6. Delete only the dedicated test rows through the existing same-run cleanup
   path, if separately authorized.
7. Open the exact LIFF entry
   `https://liff.line.me/2011116657-9SpSnQlN?range=30d` and confirm the loaded
   build ID is `20260927-core-release-candidate-01`; complete one Owner workout
   only when the Owner chooses to perform the real-account acceptance.
8. Confirm body, meal, sleep, steps, and total-energy manual records still open,
   save, edit, delete where supported, and reload.
9. Confirm Android/wearable records continue to ingest; this release does not
   change the connector contract or schedule.

## Rollback

- The database change is additive. Do not drop the column or index during an
  incident; leaving them in place is compatible with older runtimes.
- If Edge publication fails, restore active Edge v41. Once the migration exists,
  v41 is schema-compatible and restores the original training path.
- If Web publication fails, restore Pages build
  `20260926-health-state-resilience-06` using the hash-verified byte manifest in
  the release artifact. Its Git commit provenance is unverified and is not used
  as rollback evidence.
- Never restore an old database snapshot and never overwrite wearable or manual
  records created during the window.

The Edge rollback payload is the hash-verified ACTIVE v41 export captured in the
artifact. Redeploy slug `mobile-health-beta` with entrypoint
`supabase/functions/mobile-health-beta/index.ts`, import map
`supabase/functions/mobile-health-beta/deno.json`, and `verify_jwt=false`, while
preserving the existing configuration and secret values. Its support lockfile is
separately provenance-labelled because the remote export did not include a
lockfile; candidate and rollback `deno.json` bytes must match, and both bundles
must pass frozen/cached Deno validation before publication. The artifact is a
hash-manifested write-once-at-creation snapshot, not an intrinsically immutable
store. Immediately before use, compare it to the manifest SHA-256 recorded
outside the artifact in the authorization request/final handoff:

```powershell
node <artifact>/candidate/scripts/verify-core-release-artifact.mjs `
  <absolute-artifact-directory> <externally-approved-manifest-sha256>
```

Do not take the expected hash from `artifact-result.json` inside the directory;
that sibling file is only a convenience copy and is not independent provenance.

## Minimal authorization request

- TARGET: Beta project `uavimjgccigpbwqmfkhh` and Beta Pages only.
- CANDIDATE_VERSION: `20260927-core-release-candidate-01` plus the candidate Git
  commit and artifact hash reported after packaging.
- DEPLOY_COMPONENTS: one exact DB migration, `mobile-health-beta`, Beta Web.
  Approvals are component-specific and sequential: DB approval authorizes only
  one exact dry-run/apply attempt; Edge approval applies only after DB postflight;
  Web approval applies only after Edge smoke. Each approval binds the Beta
  target, candidate commit, externally recorded artifact-manifest SHA-256,
  exact command, approved operator/profile, and window. No component approval
  authorizes configuration/secret changes, Beta test writes, production, or a
  retry after an ambiguous result.
- MIGRATIONS: exact bytes of
  `20260920224000_manual_workout_set_order.sql` only, applied from the isolated
  workdir with reviewed CLI `2.115.0`; dry run must list only source version
  `20260920224000`, and postflight must preserve that exact history version/name.
- TEST_WRITE_SCOPE: none unless a separately identified dedicated Beta test
  account and cleanup manifest are explicitly authorized.
- MAINTENANCE_SCOPE: no service shutdown; preserve Android ingestion; maximum
  proposed controlled publication window is 20 minutes, with a stop checkpoint
  after DB, Edge, and Web respectively.
- ROLLBACK_PLAN: keep additive schema, restore Edge v41 and Web v06 as needed.
