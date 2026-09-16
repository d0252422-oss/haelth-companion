# Exact Beta credential requirements — proposal, no credentials created

BETA_CREDENTIAL_SPEC=READY_SPEC_ONLY. Target uavimjgccigpbwqmfkhh only.
This is not HOSTED_AUTH PASS or permission to provision. No secret values in docs,
source, logs, frontend, chat or artifact. Roles are not interchangeable.

| Class / ROLE_NAME | PURPOSE / USED_BY | PRIVILEGES / RLS_EFFECT | SECRET_NAME |
|---|---|---|---|
| MANUAL_RUNTIME_ROLE / health_manual_api | verified Web session, own-user manual CRUD | exact20260916144345 grants; transaction subject/email mapping; RLS | HEALTH_MANUAL_DATABASE_URL |
| BACKGROUND_RUNTIME_ROLE / health_native_ingest | existing delegated Android/Shortcut grants | exact20260916215632 native grants; session digest/revocation/expiry; own-user RLS | HEALTH_NATIVE_DATABASE_URL |
| BACKGROUND_RUNTIME_ROLE / health_recompute_worker | queue/lease processor, not interactive user | exact20260916215632 worker grants; queue maintenance; lease-constrained input/output | HEALTH_RECOMPUTE_DATABASE_URL |
| MIGRATION_ROLE / existing approved platform migration authority | apply exact reviewed schema only | admin boundary; existing object ownership required; not runtime; do not invent a low-privilege role that cannot ALTER current objects | NONE_IN_EDGE; existing secure management channel |
| TEST_ROLE / Beta TestA and TestB normal sessions | user-scoped browser/API smoke | no SQL LOGIN or admin grants; distinct server-resolved canonical users | NONE; normal session only |

All three runtime roles: SUPERUSER=NO, BYPASSRLS=NO, CREATEDB=NO, CREATEROLE=NO,
REPLICATION=NO, INHERIT=NO, no memberships, no schema/table ownership. Initial SQL
creates NOLOGIN; enabling LOGIN/password is a separate explicitly approved step.
CONNECT postgres; USAGE public/private; no sequence grants (UUID keys); exact
table/column/function grants are the two hash-pinned migrations in the package.
Do not substitute broad ALL TABLES/ALL FUNCTIONS or grant service_role membership.

Migration authority flags/ownership must be verified before mutation; SUPERUSER=NO
and BYPASSRLS=NO are required for any newly proposed credential. No new migration
credential is requested now. Existing management authority is not represented as a
tested low-privilege runtime. If it cannot safely apply DDL, stop for exact review.

Host aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres, transaction pooling,
username role.uavimjgccigpbwqmfkhh; require strict officialCA and hostname verification.
No sslmode=disable, trust-all or arbitraryURL query overrides. Values delivered only
through approved secret storage. Revalidate actual pool/project before provisioning.

Other backend-only names: HEALTH_RECOMPUTE_TRIGGER_SECRET (separate random trigger
credential), existing BETA_WEB_AUTH_VERIFY_URL (verified bridge, not AuthJWT).
Flags/target/origin names are in BETA_REMOTE_ENABLEMENT_PACKAGE.md; not all settings
are secrets. No changes to production OAuth, scope, credentials or shared secrets.

ROTATION: approve individual runtime credential replacement, secure corresponding
setting update, drain old pooled connections, TLS/role/tenant smoke, revoke oldlogin.
REVOCATION: disable affected LOGIN/trigger and provider entry, retain committedSQL,
revoke A/B normally. Never fallback to an admin role or Sheets double-write.
ROLLBACK: verified code/config or approved forward-fix, preserve newSQL records.
HOSTED_AUTH=PENDING_CREDENTIAL; TEST_IDENTITIES=PENDING_OWNER; spec readiness is not
credential creation or validation.
