# Beta remote inventory — 2026-09-16

Evidence: `D:/Dev/Evidence/health-beta-cutover-prep-20260916-192251`.
All remote operations were reads (catalog metadata, names/digests, source recovery,
SSLRequest/TLS negotiation). No health/session rows read, no credentials collected.

| Item | Fresh observation |
|---|---|
| Project | health-companion-beta / uavimjgccigpbwqmfkhh / ACTIVE_HEALTHY |
| Organization / region | pcfenospezigjlgwcbtg / ap-southeast-1 |
| Direct DB | db.uavimjgccigpbwqmfkhh.supabase.co:5432; DNS ENOTFOUND on this host |
| Management DB | 17.6.1.166; catalog SQL reports17.6; this is not a pool-auth probe |
| Other/production exclusion | vptqedxdxfoohbqctujf is distinct by project listing; no SQL/actions there |
| Pool | aws-0-ap-southeast-1.pooler.supabase.com:6543 transaction /5432 session; linked metadata, tenant binding still unverified |
| Pool DNS/TCP | PASS; IPv4 addresses resolved |
| TLS | FAIL SELF_SIGNED_CERT_IN_CHAIN with Node bundled CA and command-scoped system CA; no rejectUnauthorized bypass |
| Pool auth / effective role | NOT_RUN, no dedicated runtime credential in known project/process settings |
| Function | mobile-health-beta ACTIVE v14, verify_jwt=false (custom handler auth); digest unchanged from prior metadata |
| Migrations | 16 history rows through20260903130618; eight pending engine/manual migrations absent |
| Runtime role | health_manual_api absent; existing service_role has BYPASSRLS |
| Schema | Canonical baseline objects present; pending engine/manual objects absent; history/schema agree for this subset only |
| Settings | All original six HEALTH_MANUAL_* names absent; BETA_WEB_AUTH_VERIFY_URL name present, value/validity UNKNOWN |
| Auth | Existing Google/Apps Script opaque-session bridge remains; dedicated A/B test identity NOT_VERIFIED; no owner token extraction |
| Beta frontend | GitHub Pages legacy main:/ at https://d0252422-oss.github.io/health-companion-beta/; last built53736e644aaa79163d521daa44c7e87c82ad3126 |

## CLI/platform

Existing CLI2.115.0 reused, no download/upgrade. Help and services/config parsing pass.
CLI services still selects postgres17.6.1.166 / Edge1.74.3. Existing isolated overlay
points at canonical handler, disables seeds/migrations and uses57921/57922 ports.
`migration list --local` fails ECONNREFUSED57922; `functions serve` reports stack not
running. No bundle/build/invoke or config-validate subcommands exist in this CLI;
functions list is remote, not local. Actual CLI invoke therefore NOT_RUN.

The required PG17.11+ image is not in installed images. Latest10 official release
metadata inspected includes17.6/17.9 variants, not proof that no17.11 release exists
anywhere. Official upgrade PR2155 remains open/unmerged as observed. No downgrade,
new image pull, unsafe old server startup, plain-native substitution or Docker change.

Sources: [Supabase postgres PR2155](https://github.com/supabase/postgres/pull/2155),
[official releases](https://github.com/supabase/postgres/releases),
[SSL verification guidance](https://supabase.com/docs/guides/platform/ssl-enforcement).
Changelog index was downloaded read-only after web tool could not render Markdown.
No relevant instruction authorizes a global CA install or platform security downgrade.

## Readiness limitations

TLS probe sent no PostgreSQL StartupMessage/password; success at TCP is not database
authorization. Secret listing contains hashes, not plaintext values; presence never
proves validity. Catalog inspection used existing management access, not the proposed
runtime identity, and is not a hosted RLS acceptance test.

Original six settings (purpose/source/validation in BETA_REMOTE_ENABLEMENT_PLAN.md):
HEALTH_MANUAL_SQL_HOSTED_ENABLED, HEALTH_MANUAL_RELEASE, HEALTH_MANUAL_ALLOWED_ORIGIN,
HEALTH_MANUAL_EXPECTED_PROJECT_REF, HEALTH_MANUAL_EXPECTED_DB_HOST,
HEALTH_MANUAL_DATABASE_URL. All MISSING; runtime secret creation remains unauthorized.
