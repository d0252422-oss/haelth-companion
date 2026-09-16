# Background identity inventory

Local successor only; all new hosted flags OFF by default. No phone/remote runs.

| Worker / trigger | Canonical identity / token | DB/RLS | Retry / revocation | Status |
|---|---|---|---|---|
| Android WorkManager / Health Connect batch | existing mobile_app_sessions; validated session UUID + access-token digest; server row chooses canonical user/platform | health_native_ingest; transaction-local session selector | existing revision/idempotency/checkpoint; server expiry/revoked_at/rotated digest denied | local actual Edge rehearsal |
| iOS Shortcut POST | existing beta_shortcut_sessions; existing revocable grant, never arbitrary payload ID | same delegated role, ios grant platform | existing source mutation semantics; expiry/revocation | adapter prepared; Shortcut/device flow not verified this run |
| connector status POST | same device grant, platform checked | delegated owner policy on beta_connector_status | idempotent status upsert | implemented; separate from device UI |
| score queue / scheduled drain | protected independent trigger secret, then exact claimed user/date/generation/token lease | health_recompute_worker; no raw input writes; output RLS limited to leased date/user | existing claim/fail/backoff/expiry; max5 jobs | actual Edge local rehearsal |
| inline manual recompute | verified Web request, same user's affected dates | existing health_manual_api context | existing bounded queue | unchanged scoped regression |
| claim/exchange/link/refresh/revoke provisioning | existing verified identity/install proof; dedicated administrative trust boundary | legacy administrative adapter, not normal ingestion fallback | existing grant lifecycle | elevated provisioning remains explicit; remote provisioning review required |
| migration administrator | human-authorized schema workflow | separate admin identity | transactions / forward fix | never runtime |

Locations: index.ts route switch; background-bootstrap.ts config/trigger validation;
background-runtime.ts createDelegatedIngestion/createRecomputeWorker;
worker-sql-context.ts scopedWorkerSql; existing Android BackgroundHealthSync.kt and
IngestionClient.kt unchanged. Existing install/exchange/refresh contracts remain in
index.ts; no second credential store or permanent interactive Web token introduced.

BACKGROUND_SERVICE_ROLE_RUNTIME_USAGE = 0 in opt-in SQL-first ingestion/status/drain.
ADMIN_ONLY_EXPLICITLY_SCOPED for pre-existing issuance/link/refresh tooling.
Legacy provider OFF-mode code is retained, not silently invoked on SQL-first error.
Migration-local synthetic fixture setup uses engine_owner, never acceptance identity.
