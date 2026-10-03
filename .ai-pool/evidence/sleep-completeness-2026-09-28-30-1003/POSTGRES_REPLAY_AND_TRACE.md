# Sleep preparation: isolated revision replay and source-ID trace

2026-10-03 UTC. This is local, synthetic-only evidence. No Beta or Production write,
phone action, APK update, or deployment was performed.

## Isolated PostgreSQL replay

- Official EDB PostgreSQL 17.11 portable ZIP, SHA-256
  `b9424ee7bc60b52450ff910a3630225df32e633f3cb29c1d126d9299d59aea28`.
  Its ZIP paths were checked for traversal before extraction.
- New dedicated data directory: `D:/Dev/Caches/health-sleep-pg17-20261003/sleep-replay-data`;
  new database: `health_sleep_replay_20261003`; loopback `127.0.0.1:57485`.
  This is not the legacy bundled PostgreSQL 18.4 or an existing user database.
- Applied the repository's canonical bootstrap, source-record reconciliation,
  Beta ingestion RPC, and total-energy canonical migrations to this synthetic
  database, with only the minimal queue/trigger stubs needed by those migrations.
  PostgreSQL compatibility here does not prove every Supabase platform extension.
- Test: `LOCAL_ENGINE_PG_MAJOR=17` and `LOCAL_ENGINE_PG_BIN` set to the dedicated
  extracted `pgsql/bin`, then `node scripts/test-sleep-revision-replay-pg.mjs`.
  Test script SHA-256: `618bf16a82f6161af8a04caa61f45fce5986ed204ce51933e5ad9e93c8d881ce`.
- Result: **PASS, 15 checks, 0 persisted synthetic health rows after verified
  transaction rollback**. Authenticated role could not invoke the privileged
  ingestion RPC. Old child stage arrived before parent and remained raw-only;
  no parent daily duration was produced. Higher microsecond revision updated
  the same source identity and wake date. Older revision was rejected; exact
  replay was idempotent; equal revision with different content was rejected
  without overwrite. Late child and parent updates were accepted. The eventual
  parent interval produced 310 synthetic minutes; no stage duration was added.
  Other-user rows remained zero; source identities were unique.
- A first test attempt failed only because PostgreSQL returned loopback address
  `127.0.0.1/32` instead of `127.0.0.1`; the guard now accepts either form.
  The failed attempt did not reach test data mutation. Raw server log and cluster
  were preserved in the dedicated cache directory.

## Target-date source-ID trace boundary

| Wake date (Asia/Taipei) | Google Health display | Health Connect source IDs | Android reader/payload IDs | Beta raw parent/stage IDs | First missing identity layer |
|---|---|---|---|---|---|
| 2026-09-28 | Present per user | UNKNOWN | UNKNOWN | 0 / 0 | At or before raw SQL; exact earlier layer UNKNOWN |
| 2026-09-30 | Present per user | UNKNOWN | UNKNOWN | 0 / 0 | At or before raw SQL; exact earlier layer UNKNOWN |
| 2026-10-03 | Present per user | UNKNOWN | UNKNOWN | 0 / 3 orphan stages | Parent missing at or before raw SQL; exact earlier layer UNKNOWN |

The current Android mapper reads `SleepSessionRecord`, emits a `sleep` parent
with Health Connect `metadata.id`, then `sleep_stage` children with that ID plus
stage start/end/type. It preserves source package and last-modified time. The
upload serializes each `source_record_id` and revision; Edge accepts the native
identity and the ingestion RPC reconciles by user/platform/domain/source/ID.
This static contract is **not** a live record-ID trace. Health Connect IDs and
per-record Edge receipt identities are unavailable without a permitted device
read or correlated safe diagnostics; do not infer them from matching counts.

## Safe Beta build path

`android-helper/app/build.gradle.kts` fixes the Beta package
`app.healthcompanion.sync.beta.debug` for debug and version `0.1.0-beta.30-debug`.
It requires the known Beta project ref `uavimjgccigpbwqmfkhh`, a publishable
key, and Google Web client ID before packaging. The existing GitHub workflow
injects the two latter values from repository variables but does not provide
the documented Beta auth-setup URL or verified App Link host. This local process
has no matching `HEALTH_COMPANION_BETA_*` or Google Web client ID environment
names. No credentials or private values were printed or invented.

Thus the **code path is identified but a usable, securely configured local
Beta APK build is BLOCKED**. The candidate must not be packaged with the
`beta.invalid` auth/app-link defaults or deployed from an unverified workflow.
Existing installed beta.25 remains unchanged. No signing-compatibility or
overwrite-install claim is made.

Sleep preparation is not a live recovery: target-date raw/canonical/Web gaps
remain. A future separately authorized deployment needs verified Beta-only
runtime config, source-ID trace on the device, and bounded replay/readback.
