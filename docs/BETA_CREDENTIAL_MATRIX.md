# Beta credential matrix — proposal only, no values

Target uavimjgccigpbwqmfkhh / health-companion-beta; reverify org/region/endpoints
before ANY later mutation. Roles and passwords have not been provisioned remotely.

| Identity | Used by / allowed scope | Secret name | LOGIN |
|---|---|---|---|
| health_manual_api | verified Web manual CRUD, own-user outputs/recompute | HEALTH_MANUAL_DATABASE_URL | separate approved runtime login |
| health_native_ingest | revocable device/Shortcut grant, own native records/status/queue | HEALTH_NATIVE_DATABASE_URL | separate approved runtime login |
| health_recompute_worker | existing queue maintenance, lease-scoped input read/output publication | HEALTH_RECOMPUTE_DATABASE_URL | separate approved runtime login |
| migration administrator | approved migration/grants only | existing admin delivery channel, NOT function env | existing approved admin |
| grant provisioning authority | existing install/session issuance/link/revoke only | pre-existing admin setting; requires separate review | not shared with normal runtime |
| Beta A/B | interactive dedicated tests, distinct canonical IDs | none committed; normal revocable session | not DB roles |

All three runtime roles: SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE/REPLICATION/INHERIT=NO,
no memberships, no schema ownership. Successor creates NOLOGIN roles locally; remote
LOGIN/password creation requires explicit approval and secure delivery, never chat.
Exact grants: migrations20260916144345 and20260916215632, not broad ALL schemas/tables.
No sequence privileges needed by current UUID keys.

Background additional config: HEALTH_BACKGROUND_SQL_ENABLED (defaultOFF),
HEALTH_RECOMPUTE_TRIGGER_SECRET (separate from DB passwords). Original six manual
settings stay documented in BETA_REMOTE_ENABLEMENT_PLAN.md; background reuses exact
expected project/pool/origin and bundled publicCA, never service_role fallback.
Local-only HEALTH_BACKGROUND_LOCAL_CONFIG is rejected when DENO_DEPLOYMENT_ID exists.

Hosted URLs: transaction pool aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres;
pool username role.uavimjgccigpbwqmfkhh. TLS verified hostname/officialCA,
prepare=false, poolmax2, connect5s. See BETA_HOSTED_POOL_TLS_CONTRACT.md.
HOSTED_DB_AUTH=PENDING_CREDENTIAL, transport readiness is not login acceptance.

Rotation: approve one role's replacement password, securely update only its secret,
drain old connections, verify role/TLS and scoped smoke, revoke previous credential.
Rollback: disable affected provider/drain trigger, retain SQL rows, restore verified
code/config. Never substitute admin credentials or destroy new data.
