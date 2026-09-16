# Delegated and system worker contract

USER_DELEGATED_WORKER: validate existing session ID + SHA256 bearer digest against
RLS-filtered existing session tables; require unrevoked, unexpired Beta grant and
ACTIVE canonical user. Platform is derived from grant. Payload user/platform must
match; it cannot authorize a request. No session write, account mapping write,
SUPERUSER/BYPASSRLS/membership or Web credential fallback.

scopedWorkerSql binds `health.worker.kind/session/digest` using set_config(...,true)
inside EVERY transaction, verifies effective/login role and all elevated flags,
and resolves private.delegated_worker_user(). Missing/invalid context has no rows.
AsyncLocalStorage isolates concurrent requests; pool reuse does not reuse identity.
Native mutation batch <=100; Shortcut <=250 split into100 within ONE transaction.
Per-user advisory transaction lock serializes source reconciliation. Existing
revision/tombstone/idempotency functions are reused as invokers, not redesigned.
Lock2s/statement10s/transaction15s failures are retryable; no fallback or partial
commit. Device may replay unchanged identity/source revision after unknown receipt.

SYSTEM_MAINTENANCE_WORKER: separate health_recompute_worker connection and trigger
secret. It may inspect/claim/update the existing cross-user queue (explicit system
privilege), but raw health/meal/body/observation inputs are SELECT-only and invisible
without exact active lease. `health.job.user/date/generation/token` is transaction
local; private.recompute_worker_user verifies PROCESSING and unexpired lease.
Outputs can only be published for that user/date; existing generation publication
guard and row lock remain. Expiry, newer generation and replaced token fail closed.
This is not a generic global SQL executor or unrestricted table owner. Possession
of the protected system DB credential grants queue maintenance, not end-user auth.

MIGRATION_ADMIN is separate and never bundled into frontend/normal request factory.
DB credentials remain backend-only. A database credential compromise is outside
the end-user request trust boundary; arbitrary client SQL/GUC setters are never
exposed. Hosted role flags/membership are checked on every transaction.

No new SECURITY DEFINER function. New helpers are invokers with empty search_path,
PUBLIC/anon/authenticated execute revoked. Existing ingestion/rolling functions
become invokers. Publication guards now early-return for non-COMPLETE transitions
before planning unrelated manual table queries, preserving COMPLETE guard semantics
without granting native ingestion access to manual meals/body. Historical migration
files remain unchanged; successor is a local proposal, not remotely applied.

Evidence: worker7/report.json (10 integration gates, not10 unit cases) under
D:/Dev/Evidence/health-worker-20260917-055400. Includes role flags,5 domains,
cross-user/expired/revoked/no-context, pooled A/B/failure reuse, duplicate concurrency,
atomic platform rejection, bounded lock/retry, rotated grant and exact lease expiry.
Initial worker1/worker2/worker6 failures retained; earlier successful repetitions are not
added to totals. Final worker ingress reuses the1MiB/10s streaming reader before
starting delegated SQL transaction; no slow request body can hold a DB transaction.
This does not prove Android WorkManager/OEM behavior or deployed scheduler transport.

The existing Android status payload omits environment; its validated session still
requires Beta. Explicit non-Beta environment is rejected. Success aliases preserve
the existing connector contract, failure does not clear previous successful sync
time, and JSON headers survive the bootstrap wrapper. A transaction advisory lock
serializes status read/update. worker6 detected the cleared timestamp; worker7
passes the added regression. Failed reports do not claim recompute was queued.
