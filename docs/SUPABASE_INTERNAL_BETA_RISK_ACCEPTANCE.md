# Supabase Internal Beta risk acceptance

Decision date: 2026-09-20. Target: `health-companion-beta` (`uavimjgccigpbwqmfkhh`). Production (`vptqedxdxfoohbqctujf`) remains denied.

## Decision

`INTERNAL_BETA_SECURITY_GATE = CONDITIONAL_PASS`

PostgreSQL `17.6.1.166` is a known outdated minor and is not declared security-equivalent to 17.11. For a closed Internal Beta, the patch number is not an automatic failure because the deployed boundary does not expose PostgreSQL credentials or arbitrary SQL to app users, runtime roles are non-superuser/no-BYPASSRLS/no-CREATEROLE/no-CREATEDB/no-replication, the pool connection uses TLS hostname verification, and all normal data operations remain entitlement-gated and tenant-scoped by RLS. This acceptance is limited to the Owner and a small allowlist of known testers. It is not production approval.

## Observed remote controls

- Server reports PostgreSQL `17.6`, `password_encryption=scram-sha-256`.
- Client-to-Supavisor connection verified TLS 1.3 with hostname verification and the official public CA. `pg_stat_ssl=false` behind the pooler reflects TLS termination and is not used as the client TLS assertion.
- `health_manual_api`, `health_native_ingest`, and `health_recompute_worker` are `NOLOGIN`, `NOINHERIT`, non-superuser, no `BYPASSRLS`, `CREATEDB`, `CREATEROLE`, or replication. A dedicated LOGIN credential is still required before SQL-first can activate.
- App tables have RLS enabled; the most sensitive manual/entitlement tables force RLS. The entitlement table grants normal runtime only the self-scoped columns needed by the resolver and grants no mutation.
- SECURITY DEFINER functions have fixed empty `search_path`; none are executable by `public` or `anon`. The entitlement administrator function is restricted to the existing trusted `service_role` administrative path and is not used by normal runtime.
- Frontend/source inspection found no database password, service-role secret, or arbitrary SQL route. Request ingress is capped at 1 MiB; native batches are capped at 250; field/range validation and parameterized SQL are used.

Evidence: `D:/Dev/Evidence/health-supabase-risk-requal-20260920/remote-risk-audit-post-migration.json` and adjacent `.tls.txt`.

## Bounded CVE reachability

The reviewed 17.7–17.11 server-side issues are tracked by prerequisite, not version alone:

| Advisory | App-user prerequisite | Reachability / mitigation | Residual |
|---|---|---|---|
| [CVE-2026-14666](https://www.postgresql.org/support/security/CVE-2026-14666/) | role/ownership changes plus cached RLS plans | runtime cannot change role, own objects, or prepare statements | Low |
| [CVE-2026-16239](https://www.postgresql.org/support/security/CVE-2026-16239/) | crafted portals/cursors by a database query author | no client DB credential or arbitrary SQL; driver uses `prepare:false` | Low |
| [CVE-2026-2006](https://www.postgresql.org/support/security/CVE-2026-2006/) | crafted multibyte query text | values are parameterized; UTF-8 decode is fatal; ingress capped | Low |
| [CVE-2026-14662](https://www.postgresql.org/support/security/CVE-2026-14662/) / [CVE-2026-6473](https://www.postgresql.org/support/security/CVE-2026-6473/) | huge tsvector/tsquery or allocation inputs | app does not use text-search types and caps requests/batches | Low |
| [CVE-2026-14664](https://www.postgresql.org/support/security/CVE-2026-14664/) | invalid-encoding regex controlled by query author | no arbitrary query; fixed application expressions | Low |
| [CVE-2026-14668](https://www.postgresql.org/support/security/CVE-2026-14668/), [CVE-2026-14679](https://www.postgresql.org/support/security/CVE-2026-14679/), [CVE-2026-15741](https://www.postgresql.org/support/security/CVE-2026-15741/) | object creation/ownership | runtime cannot create or own database objects | Low |
| [CVE-2026-14669](https://www.postgresql.org/support/security/CVE-2026-14669/) | attacker-chosen long POSIX timezone | application timezone is fixed and no SQL dispatch exists | Low |
| [CVE-2026-14680](https://www.postgresql.org/support/security/CVE-2026-14680/) | direct invocation of internal-argument functions | no DB credential or arbitrary function dispatch | Low |
| [CVE-2026-6479](https://www.postgresql.org/support/security/CVE-2026-6479/) | AF_UNIX access, or TCP with SSL and GSS both disabled | hosted path is remote TCP with verified TLS | Low |

No confirmed high/critical vulnerability is reachable through the reviewed normal app boundary. This is a bounded architecture judgment, not vendor backport proof.

## Conditions and remaining blocker

- Controlled Beta only; no public self-signup, broad invitation, or commercial use.
- No entitlement means deny. Valid `BETA` is the only currently enabled full-access state.
- Production remains blocked until a current secure minor or vendor-confirmed backports plus full production regression.
- SQL-first remains inactive until a dedicated `health_manual_api` LOGIN password is created without storing it in migration history, and the matching Beta Edge secret is set. The current CLI temporary role cannot alter the custom role. Do not substitute `service_role` or the project `postgres` credential as runtime.
- Edge/code rollback remains code/config only; valid SQL data is preserved.
