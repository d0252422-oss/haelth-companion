# Hosted manual adapter trace

## 2026-09-17 worker successor

The historical native/scheduled blocker below is superseded locally by
BACKGROUND_IDENTITY_INVENTORY.md and BACKGROUND_WORKER_IDENTITY_CONTRACT.md.
When SQL-first/manual or background flags are enabled, ingestion/Shortcut/status
POST and internal drain route BEFORE legacy admin paths to backgroundBootstrap.
Missing background configuration returns503, never privileged fallback. Separate
health_native_ingest/health_recompute_worker DB identities replace normal worker
admin use; install/link/session provisioning is still explicitly administrative.
Remote default flags stayOFF. Existing processHostedClaimedScoreJob is no longer
the opt-in scheduled route; do not invoke it without verified Web context.

Run `health-nonprivileged-20260916-224316`; successor to d037387 preparation.
No remote configuration or data changed. Historical direct-Docker PASS is not CLI PASS.

| Caller / entrypoint | Adapter / credential / target | DB role / RLS / tenant | Fallback / risk |
|---|---|---|---|
| Existing `scripts/local-engine-web.js` hosted SQL request → `index.ts` `/v1/engine/web` | `hostedManualBootstrap` → `createHostedManualRuntime`; six existing settings, DB URL is backend-only | `health_manual_api`; zero memberships; all effective-role flags checked each transaction; RLS | SQL errors surface, no Sheets retry |
| `LocalEngineRuntime.identity` | existing `verifyWebIdentity` HTTPS session bridge; opaque bearer, not Supabase JWT | verified subject/email → hashes → read-only existing alias + ACTIVE user; no account linking | missing/conflict/invalid/expired denied |
| `resolveVerifiedManualWebIdentity` → `manual-sql-context.ts` | postgres.js 3.4.8, max2, prepare=false; Supavisor transaction port6543 | per-request AsyncLocalStorage → transaction-local hashes; `manual_context_user()` SECURITY INVOKER | no body user_id trust; no mutable global tenant |
| CRUD stores / `LocalEngineRuntime` compute/drain | existing SQL, queue, receipts, portable engine; no PostgREST in this path | canonical owner policies and explicit SQL predicates; score functions now invoker | raw commit/analysis state remain separate |
| local rehearsal `localManualBootstrap` | isolated DB username health_manual_api reuses hosted factory; actual signed test authority | same nonprivileged module; no deployment marker allowed | only synthetic loopback/Docker host; not live OAuth |
| native ingress / authorized scheduled worker in `index.ts` | existing separate Supabase admin client and native auth/lease contract | pre-existing privileged native path, NOT certified as a nonprivileged manual runtime | no permission changes or credential fallback in this run |

SERVICE_ROLE_USED_AT: normal hosted manual DB path removed; retained in pre-existing
native/admin and explicitly isolated legacy test tooling. The SDK wrapper still uses
its existing backend environment client for native routes, not as manual SQL fallback.
No service-role key in frontend. Global native `service_role` elimination is NOT claimed.

`processHostedClaimedScoreJob` has no verified Web context when invoked by a native
scheduled worker. It cannot use the new manual role to read arbitrary tenants. This
separate worker integration is NOT READY: do not enable its hosted switch remotely
until a separately reviewed non-elevated worker scope exists. Request-owned manual
drain uses the verified request context and does not require that background path.
