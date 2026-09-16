# Beta hosted pool / TLS / credential contract

Target only `uavimjgccigpbwqmfkhh`, organization `pcfenospezigjlgwcbtg`, ap-southeast-1.
Last management identity inventory is the prior run; revalidate before any mutation.

| Field | Contract |
|---|---|
| pool host | aws-0-ap-southeast-1.pooler.supabase.com |
| runtime port/mode | 6543 transaction pooling; prepare=false; no session SET dependency |
| diagnostic alternative | 5432 session pool; not accepted by hosted config |
| direct DB | db.uavimjgccigpbwqmfkhh.supabase.co:5432; prior DNS ENOTFOUND, not assumed equivalent to pool |
| DB/role | postgres / health_manual_api; pool username health_manual_api.uavimjgccigpbwqmfkhh |
| TLS | rejectUnauthorized=true, public pinned CA, normal hostname/expiry verification; verify-full semantics |
| limits | connect5s; transaction lock2s, statement10s, idle-in-transaction10s, transaction15s; pool max2/idle20s |

Official source: Supabase Studio's
[`custom-content.json`](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json),
verified Git blob `0f094e3788cfc6de65aa2fedf7383b721f127507`, key `ssl:certificate_url`.
It identifies [the public production CA download](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt).
The word prod is the vendor's shared public CA filename, NOT authorization to access
our production project. Only the Beta pool was probed.

Downloaded PEM SHA256 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`.
OpenSSL-verified DER fingerprint
`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.
Expiry 2031-04-26. Public CA bundled in `hosted-database-ca.ts`, no new secret setting.
Both pool ports passed strict chain/hostname TLS1.3 using Node; this does **not**
prove PostgreSQL authentication, runtime grants or Supavisor tenant selection.
No PostgreSQL StartupMessage/password/health query was sent; no system CA store changed.

Official [SSL guidance](https://supabase.com/docs/guides/platform/ssl-enforcement)
distinguishes encryption-only require from verify-full. Never disable checks, trust a
peer-supplied certificate as root, use an unsecured pool, or add credentials to URL logs.

## BETA_RUNTIME_CREDENTIAL_SPEC

ROLE_NAME=health_manual_api; LOGIN only after explicit remote provisioning approval.
SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE/REPLICATION/INHERIT=NO; role membership=NONE.
MIN_PRIVILEGE=exact successor grants/policies; no object ownership, schema CREATE,
identity writes, sequence grants, native-health writes or physical health deletion.
SECRET_NAMES=HEALTH_MANUAL_DATABASE_URL (existing); other five settings are nonsecret.
Supply a securely stored URL, never paste it into chat or frontend. No credential
created in this run. ROTATION_PLAN=Owner-approved replacement of this dedicated
credential, drain old connections, revalidate effective role/TLS; not a shared-key
rotation. ROLLBACK_PLAN=provider OFF/disable dedicated login while retaining all SQL
rows and schemas; do not return to privileged runtime to make an error disappear.
