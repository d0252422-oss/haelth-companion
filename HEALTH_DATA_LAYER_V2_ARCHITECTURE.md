# Health Data Layer v2 Architecture

Date: 2026-08-25  
Phase: AI Pool 2C-1  
Status: **DESIGN ONLY — NOT APPROVED FOR PRODUCTION**

## Decision summary

Health Data Layer v2 is a shared, user-isolated health-data platform for the existing Web App, LINE MINI App, future MINI Apps, Health Connect, wearables, GPT Action/AI services, reminders, notifications, and historical analytics. It is not a 1:1 conversion of Google Sheets.

The design keeps normalized facts, immutable ingestion evidence, daily aggregates, and derived/AI outputs separate:

```text
Sources
  Web / LINE / GPT / Health Connect / Wearable / Import
        |
        v
ingestion_events + source identity + idempotency
        |
        v
RAW health_samples / source payload references
        |
        v
CANONICAL domain facts
  meals, body_measurements, workouts, sleep_sessions, activity_daily
        |
        v
DAILY_AGGREGATE
  nutrition_daily_summary, sleep_daily_summary, daily_health_summary
        |
        v
DERIVED
  health_scores, health_score_components, ai_derived_metrics
        |
        v
Dashboard RPC/read model, analytics, reminder predicates
```

Canonical fact writes and an upsert into `summary_recompute_queue` occur in the same database transaction. The queue is the durable, deduplicated handoff to summary workers; it is not optional polling metadata.

## Baselines and boundaries

| Baseline | Meaning |
|---|---|
| `PRODUCTION_BASELINE` | Apps Script v21 = production HEAD = Git `b084d7384093e983eec75b427682f0db4abdde35` |
| `CURRENT_LOCAL_FUTURE_WORK` | Current `codex/fix-meal-save-daily-nutrition` checkout; differs from production and contains experimental shadow-write work |
| Current source of truth | Google Sheet `健身APP`, written/read by production Apps Script |
| Current Supabase role | Linked benchmark/target project; not a verified production writer |
| Architecture gate | `READY_FOR_ARCHITECTURE_DESIGN=YES` |
| Migration gate | `READY_FOR_PRODUCTION_MIGRATION=NO` |

No current-local file is assumed to be deployed merely because it exists locally. Mapping and tests must preserve production behavior from `b084d73` while reconciling selected future work explicitly.

## Architectural principles

1. **One primary identity:** `auth.users.id` is the authentication identity; `public.users.id` remains the stable application `user_id` for compatibility. Google, LINE and legacy identifiers resolve through service-only `user_identities`; email is never an automatic merge key.
2. **Facts before summaries:** source facts are retained independently from daily summaries and scores.
3. **Provenance is mandatory:** every health fact or derived output records who/what produced it, when it was observed, and through which ingestion event.
4. **Raw and derived semantics never mix:** raw measurements live in raw/canonical tables; AI output lives in `ai_derived_metrics` and references its inputs/run.
5. **Idempotent ingestion:** duplicate source records converge through source-system IDs/hashes and deterministic unique constraints.
6. **Incremental recomputation:** a changed fact marks only the affected `(user_id, local_date, domain)` stale.
7. **Fast dashboard reads:** dashboard requests read bounded daily rows or a single RPC; they never scan full history or raw samples.
8. **RLS by ownership:** direct `user_id = (select auth.uid())` policies are preferred; parent-only ownership lookups are removed from hot child tables by adding `user_id` plus integrity constraints.
9. **Compatibility before cutover:** existing Apps Script routes remain available while individual domains move through shadow write/read gates.
10. **No implicit exposure:** table grants and RLS are separate decisions. New tables are not assumed to be Data API-accessible.

## Canonical domain model

### Identity and devices

- `users` (canonical profile entity): stable UUID, timezone and status.
- `user_identities` (service-only link registry): one canonical user may have multiple verified Google/LINE/legacy links; provider subjects and email hints are stored as SHA-256 hashes, and collisions remain quarantined until human resolution.
- `user_devices`: many historical devices per user; manufacturer, model, category, capabilities, first/last seen, status, confidence and accuracy profile.

One user may own multiple simultaneous or historical devices. Device identity is never reduced to a single profile string.

### Nutrition

- `meals`, `meal_items`: confirmed/source meal facts and item-level nutrients.
- `nutrition_daily_summary`: materialized daily totals, meal coverage, completeness and summary version.
- Existing food reference/memory/evidence tables remain reusable: `foods`, `food_aliases`, `nutrition_sources`, `user_food_memory`, `food_feedback`, `food_images`.

### Body

- `body_measurements`: canonical measurements with units normalized to kg/percent and source provenance preserved.

### Activity and training

- `activity_daily`: canonical daily steps, active calories, distance and active minutes.
- `workouts`: session-level activity.
- `workout_exercises`: ordered exercises within a workout.
- `workout_sets`: individual sets; gains direct `user_id` and optional exercise linkage for fast RLS and queries.

### Sleep

- `sleep_sessions`: interval facts with optional stage detail and provenance.
- `sleep_daily_summary`: sleep-day aggregate with timezone boundary, stage minutes, HR/HRV and completeness.

### Wearable/raw observations

- `user_devices`: source device registry.
- `ingestion_events`: immutable ingestion envelope and idempotency outcome.
- `health_samples`: high-volume raw/canonical samples such as heart rate, HRV and future sensor metrics.
- `sync_cursors_v2`: service-only per source/device/record-type cursor and retry checkpoint. Legacy `sync_state` remains transition-only.
- `summary_recompute_queue`: one durable work item per affected `(user_id, domain, local_date)` with retry/lease state.

Existing `heart_rate_samples` transitions to `health_samples` after parity; it is not dropped during migration.

### Scoring and read models

- `health_scores`: versioned overall/domain score per user/date.
- `health_score_components`: evidence-level score components separated from the score header.
- `daily_health_summary`: cross-domain dashboard read model, not an authoritative fact store.
- `benchmark_daily_summary`: no new persistent table. Benchmark behavior is represented by service-only recomputation into isolated/test data or by read-only comparison queries.

### AI

- `ai_analysis_runs`: model/provider/prompt-version lifecycle, status, latency, token metadata and input fingerprint without secret material.
- `ai_derived_metrics`: derived value, unit, confidence and links to the producing run and source facts.
- Food feedback/image tables remain domain-specific evidence.

### System and quality

- `ingestion_events`: request/event audit without plaintext secrets or unrestricted payload retention.
- `sync_cursors_v2`: monotonic per-source/device cursors and last success/error metadata; V1 `sync_state` is compatibility-only until cutover.
- `data_quality_issues`: validation findings, severity, affected record/date, lifecycle and remediation metadata.
- `daily_checkins`: subjective status/readiness inputs recovered from the legacy `DailyStatus` contract.

Reminder and notification delivery remains a separate application subsystem. Health Data Layer v2 supports it through indexed daily read models, health-score changes, and quality/freshness signals; it does not mix delivery state into clinical/health facts.

## Provenance contract

Every canonical health fact implements these fields directly or through an immutable parent:

| Field | Contract |
|---|---|
| `user_id` | UUID owner; RLS anchor |
| `observed_at` | When the health event occurred |
| `recorded_at` | When the source recorded/committed it |
| `observed_timezone` | IANA timezone at observation when known |
| `observed_utc_offset_minutes` | Original numeric offset, including travel/DST evidence |
| `source_type` | Required values: `MANUAL`, `LEGACY_SHEET`, `HEALTH_CONNECT`, `WEARABLE`, `AI_DERIVED`, `IMPORT`, `OTHER_APP`; v2 adds `SYSTEM_DERIVED` for deterministic summaries/scores |
| `source_system` | Stable source namespace, e.g. `health_connect.android` |
| `source_device_id` | Nullable FK to `user_devices` |
| `source_record_id` | Stable source identifier; not assumed globally unique |
| `ingestion_id` | Nullable FK to `ingestion_events` |
| `confidence` | Numeric 0..1; nullable when source has no estimate |
| `data_quality` | Versioned JSON object for flags only, not primary domain values |
| `created_at` / `updated_at` | Server timestamps |

Deduplication scope is normally `(user_id, source_system, source_record_id)`. When the source has no stable ID, an ingestion-specific deterministic fingerprint is used and documented per domain. Source IDs are never reused as user identity.

For `health_samples`, `source_fingerprint` is mandatory. Adapters compute versioned SHA-256 over a canonical tuple that includes source system, source device identity, metric type, UTC `observed_at`, unit and normalized value when an upstream stable ID is unavailable. The original nullable upstream ID remains `source_record_id`; fingerprint algorithm/version is recorded so changing canonicalization cannot silently alter dedup behavior.

`AI_DERIVED` records must also reference `ai_analysis_run_id`; they cannot overwrite raw/canonical measurements. Human confirmation creates or updates a canonical record while retaining the AI proposal as evidence.

## Wearable device contract

`user_devices` supports:

- `manufacturer`, `model`, `device_category`
- `capabilities jsonb` with a versioned schema
- `accuracy_profile jsonb`, scoped by metric when known
- `first_seen_at`, `last_seen_at`, `status` (`ACTIVE`, `INACTIVE`, `REVOKED`)
- `confidence` for uncertain legacy-device attribution
- stable source device ID unique within `(user_id, source_system)`

Device reassignment is not inferred automatically. If a legacy row cannot identify a device, `source_device_id` remains null and the record receives a quality flag.

## Time-series strategy

| Metric | RAW | CANONICAL | DAILY_AGGREGATE | DERIVED |
|---|---|---|---|---|
| Heart rate / HRV | partitioned `health_samples` with controlled metric types | validated sample stream | `sleep_daily_summary` / `daily_health_summary` | zone/load/score components |
| Steps | optional device samples or ingestion envelope | `activity_daily` | `daily_health_summary` | goal/completeness/score |
| Sleep | stage/sample payload evidence | `sleep_sessions` | `sleep_daily_summary` | sleep score/components |
| Calories in | meal item evidence | `meals`, `meal_items` | `nutrition_daily_summary` | balance/score components |
| Calories out | source samples/events | `activity_daily` | `daily_health_summary` | energy balance |
| Weight/body fat | source observation | `body_measurements` | latest/day rollup in read model | trend/rate metrics |
| Workout volume | set evidence | workouts/exercises/sets | `daily_health_summary` | training load/readiness |

Raw sample retention is policy-driven by source and metric. Canonical facts and daily aggregates have longer retention. `health_samples` is range-partitioned by UTC `observed_at` from its first approved high-rate load. Monthly partitions are pre-created by a reviewed service job, indexed by `(user_id, metric_type, observed_at desc)`, and retired only through a separately approved retention operation. A monitored default partition is a quarantine/fail-safe and must remain empty under normal operation. Raw samples are immutable; correction creates a new source version or quality disposition rather than soft deletion. BRIN is not part of the default plan because out-of-order backfills weaken physical locality.

Every partition is hardened in the same creation transaction: RLS enabled, `PUBLIC`/`anon`/`authenticated` revoked, any inherited or pre-existing `service_role` UPDATE/DELETE privilege explicitly revoked, runtime service access granted only SELECT/INSERT, then indexes attached. No partition is exposed between creation and hardening. Runtime roles cannot UPDATE/DELETE raw samples; isolated rehearsal rollback runs as the staging database owner and is never a production ingestion capability.

`health_samples.metric_type` is a controlled enum/catalog for scalar sensor metrics only and every row has one required numeric value. Arbitrary structured values are prohibited. Meals, body measurements, activity days, workouts, sleep sessions, summaries and AI-derived values remain in typed domain tables; complex observations require a domain-specific schema.

## Timestamp and timezone contract

1. All instants are stored as UTC `timestamptz`; input offsets are never discarded.
2. `observed_timezone` records the IANA zone supplied by the source. `observed_utc_offset_minutes` preserves the original offset. If the source supplies neither, the user's timezone at ingestion is a fallback and the record receives a quality flag.
3. `local_date` is derived once from `observed_at` using the observation timezone/offset, not the user's current timezone. Later travel/profile changes do not rewrite historical dates.
4. Sleep policy `WAKE_DATE_V1`: `sleep_daily_summary.summary_date` is the local calendar date of `sleep_sessions.ended_at` in the effective observation timezone. Daytime naps follow the same end-date rule. No undocumented four-hour or noon cutoff is assumed.
5. Any future sleep-day policy changes require a new `algorithm_version`, historical comparison and explicit product/domain approval.

## Performance architecture

### Major indexes

- All owner/time facts: `(user_id, observed_at desc)` or `(user_id, local_date desc)`.
- Source idempotency: unique partial `(user_id, source_system, source_record_id)` where ID is non-null.
- `health_samples`: partition-local `(user_id, metric_type, observed_at desc)`; no default BRIN index because out-of-order backfills weaken physical locality.
- Summaries use unique `(user_id, summary_date)`. Scores retain revisions with `(user_id, score_date, algorithm_version, input_fingerprint)` and enforce one intended ACTIVE score per user/date.
- Workouts: `(user_id, workout_date desc)`; sets: `(user_id, workout_id, set_number)`.
- Ingestion: unique `(user_id, source_system, idempotency_key)` and retry/status partial indexes.
- Quality issues: `(user_id, status, severity, detected_at desc)`.

Indexes are proposals; `EXPLAIN (ANALYZE, BUFFERS)` on realistic local/staging volumes is required before production approval. Large production index builds must use separately reviewed concurrent operations where supported.

### Incremental summaries and recomputation

1. Ingestion upsert and a deduplicating `summary_recompute_queue` upsert occur atomically for the affected user/domain/date.
2. A bounded worker recomputes only that user/date/domain.
3. Domain summaries update first.
4. `daily_health_summary` recomputes from domain summaries/facts.
5. Health scores recompute only when their input fingerprint changes.
6. Late-arriving data reopens the affected day and increments `summary_version`.
7. Workers lease bounded queue batches with the current source generation, retry idempotently, and retain failed work for operator review. Successful recomputation uses compare-and-swap semantics and clears `is_stale` only when both the leased generation and input watermark/fingerprint still match.

Recomputation functions are idempotent. They accept an explicit `user_id` and date, write only that scope, record algorithm/input versions, and are service-only unless a user-scoped SECURITY INVOKER design is proven necessary.

### Dashboard query paths

| Dashboard request | Expected path |
|---|---|
| Today overview | One `get_dashboard_v2(date)` RPC reading daily summaries, latest body and score; activity is the source-selected activity projection in `daily_health_summary` |
| 7/30/90-day trends | Indexed daily summary range, bounded by user/date; no raw sample scan |
| Workout detail | Workout by `(user_id,id)` then exercises/sets by indexed parent ID |
| Meal history | `(user_id,eaten_at desc)` plus batched item query |
| Raw heart-rate chart | Explicit short time window on `(user_id,metric_type,observed_at)`; downsample server-side for long ranges |
| AI insight | Read stored `ai_derived_metrics`; schedule recomputation when fingerprint/version is stale |

Target dashboard behavior is one bounded RPC/read-model request instead of repeated Apps Script calls and full Sheet scans. Cache keys include `user_id`, date range, locale/timezone and read-model version. User-specific data is never shared across cache keys.

## RLS v2 design

- RLS remains enabled on every exposed table.
- Owner tables receive separate SELECT/INSERT/UPDATE/DELETE policies.
- SELECT/DELETE use `using ((select auth.uid()) = user_id)`.
- INSERT uses `with check ((select auth.uid()) = user_id)`.
- UPDATE uses both `using` and `with check`.
- Child hot tables gain direct `user_id` so policies avoid parent joins; composite FKs protect ownership consistency.
- Shared lookup tables grant authenticated SELECT only; writes are service/admin workflows.
- `anon` receives no health-data grants.
- Views exposed to clients must use `security_invoker = true` or remain in an unexposed schema.

This design directly addresses all 13 existing `auth_rls_initplan` warnings without weakening ownership checks.

## RPC, worker and cache boundaries

- `get_dashboard_v2`: SECURITY INVOKER, stable/read-only, authenticated only, explicit search path and fully qualified objects. It returns latest body explicitly plus read-model freshness (`is_stale`, `computed_at`, input watermark/version); it never recomputes synchronously.
- Summary refresh: service-only, idempotent, explicit scope, no generic arbitrary-SQL input.
- External ingestion: authenticated Edge Function or existing Apps Script gateway verifies source credentials, writes an ingestion envelope and uses scoped database operations.
- Secrets stay in platform secret storage/Script Properties; they are never copied into rows, logs, reports or handoffs.
- No SECURITY DEFINER function is placed in an exposed schema unless unavoidable, reviewed, search path locked, grants revoked from PUBLIC/anon/authenticated, and explicit user isolation tests pass.

## Compatibility strategy

| Client | Transitional behavior |
|---|---|
| Existing Web App | Continues Apps Script contract; domain-by-domain adapter can read v2 behind feature flags |
| LINE MINI App | Uses the same canonical user ID mapping and versioned API; does not require immediate Web App retirement |
| GPT Action | Keeps current endpoint/contract until meal write parity and idempotency gates pass |
| Health Connect | Continues current signed gateway; shadow writes canonical ingestion/device/sample records after approval |
| Future MINI Apps/wearables | Use the same ingestion/provenance contract and cannot bypass user isolation |

No client is required to cut over at the same time. Each domain has separate shadow-write, shadow-read, rollback and human-approval gates.

## Current Supabase table direction

- Reuse/extend the 15 structurally useful tables.
- Replace `heart_rate_samples` only after `health_samples` parity and compatibility validation.
- Refactor `daily_health_summary` into a read model with provenance/version/freshness semantics.
- Do not drop, rename, or truncate any v1 table in Phase 2C-1.

Detailed decisions are in `SUPABASE_V1_TO_V2_TABLE_DECISIONS.md`.

## Official guidance incorporated

- Supabase RLS patterns and init-plan optimization: `https://supabase.com/docs/guides/database/postgres/row-level-security`
- Function security and privileges: `https://supabase.com/docs/guides/database/functions`
- Index design: `https://supabase.com/docs/guides/database/postgres/indexes`
- Data API grants are separate from RLS: `https://supabase.com/docs/guides/api/securing-your-api`
- Vector belongs under the extensions schema for the target design: `https://supabase.com/docs/guides/ai/semantic-search`

## Architecture gate

- `ARCHITECTURE_DESIGN=PASS`
- `PROVENANCE_MODEL=PASS`
- `DEVICE_MODEL=PASS`
- `RLS_V2_DESIGN=PASS`
- `READY_FOR_ARCHITECTURE_REVIEW=YES`
- `READY_FOR_PRODUCTION_MIGRATION=NO`
