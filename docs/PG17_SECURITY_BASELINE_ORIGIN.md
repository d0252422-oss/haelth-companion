# PG17 security baseline origin

Run: health-security-20260917-075734. SOURCE_HEAD=9e50b5020e18fede5f16a8325ba40fd6cab987fd.

BASELINE_VERSION=PostgreSQL17.11+ (native compatibility track),18.6+ (primary native).
DATE_ESTABLISHED=2026-09-14T00:01:06+08:00; commit
3ef6b61668ac1465418cc489770830a39f715afd contains the explicit AGENTS.md floor.
Sources: AGENTS.md Local runtime and evidence safety; scripts/local-engine-postgres.mjs
guard/comment; docs/ENGINE_VERSION_MATRIX.md security rationale; prior checkpoint.

SECURITY_REASON: the portable18.4 predecessor was intentionally retained but not
executed because of CVE-2026-16239. The authorized PG17 compatibility track selected
the corresponding fixed branch17.11+, not exact string equality with every CLI.
The [official advisory](https://www.postgresql.org/support/security/CVE-2026-16239/)
identifies cursor/portal type confusion and a fixed17.11 release (CVSS8.8).

SECURITY_REQUIRED_PATCHES: preserve the established portal fix and assess intervening
core/installed-extension fixes, particularly RLS cached-policy invalidation after
role changes ([CVE-2026-14666](https://www.postgresql.org/support/security/CVE-2026-14666/)).
See the advisory-level matrix; client/optional/PG18-only issues are separated.
This is a platform assurance requirement, not a claim the application's API exposes
an exploit. Owner has not accepted unknown managed backport coverage as equivalent.

PATCH_VERSION_PREFERENCE: exact CLI image patch equality alone is not required.
An official equivalent patched vendor build could satisfy the security requirement.
FUNCTIONAL_REASON: PG17 compatibility/extension/RLS rehearsal remains distinct from
security. Existing PG17.11 results do not prove PG17.6 parity or patch coverage.
OWNER_DECISION_IF_ANY: PG17 track authorized; no decision waiving security floor found.

PATCH_FUNCTIONAL_COMPATIBILITY=NOT_RUN_SECURITY_PREREQUISITE_UNMET.
No17.6 server started, guard weakened, image downloaded or existing cluster modified.
No need to repeat the accepted17.11-only suite while its comparison target is not
approved. After official coverage is established, run focused migrations/extensions/
transactions/locking/RLS/functions/publications/prepared statements/pool tests on
isolated instances with identical fixtures. Functional parity never clears this Gate.
