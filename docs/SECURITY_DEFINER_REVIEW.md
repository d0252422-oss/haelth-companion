# Manual runtime privilege review

Scope: successor `20260916144345_manual_runtime_least_privilege.sql`; local PG17.11
rehearsal, not remote role/owner verification. Evidence run health-nonprivileged-20260916-224316.

The manual role has no role memberships, table ownership, SUPERUSER or BYPASSRLS.
The successor adds no schema CREATE or PUBLIC grants. This is not a claim that all
inherited PostgreSQL PUBLIC defaults (for example database TEMP) were eliminated.
All normal manual operations execute as the login; the tested sensitive functions
are not executable through direct or PUBLIC permissions.

| Changed function | Input/caller and protection |
|---|---|
| beta_claim_score_recompute | Request-scoped canonical ID and bounded batch; invoker RLS only sees that tenant's queue |
| beta_fail_score_recompute | Tenant/date/generation/lease; invoker RLS plus exact lease check |
| beta_get_score_generation | Tenant/date; invoker RLS rejects other contexts |
| beta_persist_score_bundle | Tenant/date/generation/version/bundle; invoker permissions and RLS; existing generation/lease/publication guards unchanged |
| engine_enqueue_meal / engine_enqueue_observation | Row trigger context, bounded existing affected dates; invoker queue privileges |
| engine_require_complete_publication / engine_require_observation_publication | Publication trigger guard, invoker; no new elevated owner |
| manual_exercise_owner_guard | Row trigger uses immutable owner check; plain SELECT supports shared catalog, FK supplies reference-key protection; invoker |

All retain explicit empty search_path; no new SECURITY DEFINER function or dynamic
client SQL is introduced. The migration's finite table-name format loop is
deployment-time literal SQL, not request-controlled dynamic SQL. Ownership is not
rewritten. Existing native/admin functions are not granted to the manual role.

The attempt3 catalog query identified20 remaining SECURITY DEFINER functions,
all with explicit empty search_path and **zero EXECUTE-accessible functions for
health_manual_api**. These include native linking/ingestion/session lifecycle,
freshness/queue-summary, canonical identity resolver and native rolling trigger.
That is containment evidence, not an independent security certification of every
unchanged native/admin function. Remote owners and actual grants remain unverified.

Exact remaining catalog inventory (all `search_path=""`, manual EXECUTE=false):

| Schema | Function | Existing boundary / residual review |
|---|---|---|
| public | beta_authorize_app_session | Native session validation; not manual |
| public | beta_exchange_install_claim | Native one-time claim; not manual |
| public | beta_ingest_health_mutation | Native ingestion tenant/session checks; privileged path retained |
| public | beta_report_connector_status | Native connector status; not manual |
| public | beta_exchange_shortcut_claim | Shortcut claim; not manual |
| public | beta_authorize_shortcut_session | Shortcut session; not manual |
| public | beta_issue_install_claim | Authorized claim issuance; not manual |
| public | beta_get_app_session_refresh_material | Native refresh material; not manual |
| public | beta_rotate_app_session | Native rotation; not manual |
| public | beta_revoke_app_session | Native revocation; not manual |
| public | beta_link_native_auth_identity | Identity mutation; never granted to manual |
| public | beta_resolve_native_auth_identity | Native identity resolution; not manual |
| public | beta_ingest_health_mutation_batch | Native bulk ingestion; privileged path retained |
| public | beta_list_dirty_score_dates | Native worker queue discovery; separate worker scope needed |
| public | beta_link_native_auth_identity_v2 | Identity mutation; never granted to manual |
| public | beta_get_health_freshness | Native freshness lookup; not manual |
| public | beta_get_score_queue_summary | Native queue lookup; not manual |
| private | engine_current_canonical_user | Previous authenticated-JWT resolver, not new Web context helper |
| private | engine_enqueue_health_rolling | Native health-row trigger; runtime cannot write its input table |
| public | beta_resolve_web_canonical_identity | Previous privileged resolver; new adapter uses invoker RLS lookup |

Function owners/input-by-input native authorization are not newly certified by this
containment check; exact remote ownership remains UNKNOWN. Do not promote this list
to a global least-privileged native-worker security audit or remote grant acceptance.

Custom GUC context assumes a protected backend DB credential; it does not
cryptographically authenticate a direct SQL client. Credential compromise is outside
the tenant isolation guarantee. Arbitrary SQL must never be exposed through the API.

Do not enable the separate native scheduled hosted worker with this manual
credential: it has no verified Web context, and must fail closed. Its required
worker identity/scope is a separate unresolved integration gate.
