# Auth to database context

`verifyWebIdentity` verifies the existing opaque session with the configured HTTPS
bridge. Client canonical ID fields are rejected. `resolveVerifiedManualWebIdentity`
hashes verified subject and normalized email; only this backend-derived pair enters
`scopedManualSql.withWeb`. AsyncLocalStorage is per asynchronous request, not pool.

Every `begin` checks session/effective role and denies elevated flags or any membership.
It sets both hashes with `set_config(..., true)` **inside the transaction**, including
empty values for unbound operations. Every new transaction resets its own context;
COMMIT/ROLLBACK removes the binding. Connection max1 tests force physical reuse.
Direct runtime credentials remain trusted backend capabilities, not user credentials:
Postgres custom GUCs are not cryptographic session verification. Never expose that
credential, arbitrary SQL, or a caller-selectable `withWeb` endpoint to clients.

`private.manual_context_user()` is SECURITY INVOKER with empty search_path. It joins
the existing alias and ACTIVE user; hash mismatch, missing context or revoked mapping
does not grant a tenant. Policies apply USING and WITH CHECK; explicit grants still
deny identity updates, native ingestion writes and physical health/history deletes.
Derived data is writable only through the backend credential's server computation,
not authenticated/anon roles or a user-supplied score API.

Mapping lookup is read-only. No UPDATE permission is granted merely to acquire
`FOR SHARE` on identities. Authorization is at the transaction snapshot; revocation
fences subsequent transactions, not a promise to cancel already-authorized work.
Long-running snapshots retain standard PostgreSQL MVCC semantics. Repeatable-read
publication/receipt checks and bounded timeouts remain unchanged.

Successor migration: `20260916144345_manual_runtime_least_privilege.sql`.
LOGIN/password provisioning is separate and not remotely authorized. No new identity
store; no auth.uid equality assumption; no changes to health-score-v1.0.
