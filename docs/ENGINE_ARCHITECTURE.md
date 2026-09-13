# Multi-domain engine architecture (non-production)

## 2026-09-14 — manual observations / original UI continuation (current)

RUN_ID=`health-manual-ux-20260914-025012`, START_HEAD=`7779dcdd`. Expanded Beta
authorization is conditional on **all** Owner preconditions, now including sleep,
steps and total-energy CRUD. Actual Docker named pipe is absent in the fresh check;
ordinary Deno/PG17 remains distinct. No remote mutation/cutover is permitted yet.

| Domain | Original form / read | Actual handler / SQL | Analysis boundary |
|---|---|---|---|
| Body | weight/body-fat form, body detail, Dashboard | `upsert/deleteBodyRecord`, `getBodyRecords`; `engine_manual_body_records` | existing portable Body adapter/queue; insufficient baseline stays null; not a new frozen overall input |
| Nutrition | meal form, selected-date grouped history | `upsert/deleteMealRecord`, `getNutritionRecords`; `engine_meals` | confirmed label arithmetic; unknown meal saved, no invented kcal |
| Training | original workout draft/detail | `addWorkoutRecord/updateWorkoutSet/deleteWorkoutSet/getWorkoutRecords`; `manual_workout_sets` | raw sets/volume/sessions; training score adapter NOT_ENABLED |
| Exercise library | original manager | `manageExercise/getExerciseDatabase`; catalog + user preferences | stable IDs, aliases, archive/restore, referenced-delete restriction |
| Sleep | quick-add duration/optional interval, sleep detail | observation actions; `engine_manual_observations` | duration-only can feed frozen sleep-minutes input; portable interval engine requires actual exact timing; no stages/efficiency invented |
| Steps | daily cumulative form, activity detail | same observation actions/table, domain=steps | full day to existing step adapter; partial day remains raw, no full-day score |
| Total expenditure | daily cumulative form, activity detail | same observation actions/table, domain=total_energy | raw total kcal only, no BMR/workout/intake addition or invented score |
| Scores | Dashboard / original score detail | `getDashboardData/getHealthTimeline`, published SQL score/head/queue | only current generations; frozen health-score-v1.0 unchanged |
| Weekly / check-in | retained existing pages/forms | SQL actions currently unsupported, fail closed | no silent Sheets fallback; not full legacy equivalence |

All implemented manual writes and reads share `local-engine-web.js` → existing
`index.ts` gateway → verified native-local or verified Web session → canonical mapping
→ `LocalEngineRuntime` stores → SQL. No body-provided user ID, default tenant, new
auth bypass, dual write or Windows-host production dependency. Hosted construction
is real but actual Edge/pool/TLS/OAuth still need target verification. SQL mode does
not send an Apps Script session as a Supabase Auth JWT. Android/iOS native ingress
retains existing canonical tables; no manual record impersonates those devices.

`20260913190152_manual_observation_canonical_sql.sql` extends canonical storage with
manual domain records, natural daily uniqueness for steps/total-energy, revision,
tombstone, private receipt and the **existing** bounded queue. It is consumed by the
real handler and original Web, not a second isolated store/queue. Raw/receipt/enqueue
are atomic. Native authenticated reads use non-owner, non-BYPASSRLS; backend writes
add verified tenant authorization. Native PG17 rehearsal includes the original schema,
the additive migration, SQL grants/RLS and transactional failure recovery; it does
not emulate unavailable Supabase platform extensions.

Sleep uses wake-date for explicit cross-midnight sessions, duration-only remains
self-reported duration. Multiple sessions without enough timing are
OVERLAP_UNRESOLVED; overlapping intervals are OVERLAP_CONFLICT. Manual/native same-day
inputs are SOURCE_CONFLICT, never max/latest/sum. A bounded versioned internal
`manual-source-exclusion-v1` day mask leaves original native interval/value/provenance
intact and suppresses only conflicted dates. Python reference and portable TS use
the same rule; proration on other dates and old formulas are unchanged. Frozen
in-memory projections include the retained-date mask in their hash. SQL originals
are never rewritten. Total energy does not enter the generic energy adapter.

Timed sleep context includes at most one additional wake-day on either side because
the accepted interval is <=24h. That context detects actual overlap across midnight;
single-day APIs still return only the requested date. Mutation invalidation includes
old/new wake-dates plus exact overlapping neighbors, followed by the same bounded28-day
queue expansion. Exact endpoint adjacency is not overlap. Tombstones remove conflicts
and restore valid prior-day publication without changing surviving raw records. The
observation trigger preserves engine_required=true on insert and update, including
pre-existing non-manual queue entries. Frozen/raw/daily timeline reads share one
repeatable-read snapshot; generation fences still protect publication.

The original UI now uses one training view controller, an explicit continue/discard
draft dialog, date/user-bound form reads and persistent inline retry/error states.
Records selection is user/provider scoped; Dashboard drill-down carries the metric
and preserves range. New raw data can display while analysis is missing/disabled;
actual durable queue/publication evidence controls pending/updated states.

Evidence and first failures are retained under the run's external evidence root.
Read its final report/manifest for executed acceptance; this architecture description
is not execution proof. Photo open-data preparation is in
`PHOTO_NUTRITION_OPEN_DATA_BOOTSTRAP.md`; no model or food snapshot was acquired.

### Expanded Beta enablement delta and exact continuation boundary

The previous conditional target/rollback plan below remains applicable. Add
`20260913190152_manual_observation_canonical_sql.sql` **after** the already reviewed
missing additive subset, only if a fresh Beta inventory confirms it is missing and
all expanded preconditions pass. It contains no data import or destructive rewrite.
Rehearsal does not authorize replaying the full historical migration directory.
All new manual observation paths are in Release A and AB; catalog/category tables
and training actions remain B-specific. Fresh A-only tests prove separation instead
of merely hiding the B controls. Global SQL-first acceptance still cannot skip the
unimplemented weekly/check-in contracts or real hosted login/pool verification.

The next target remains exactly project `health-companion-beta`, expected ref
`uavimjgccigpbwqmfkhh`, function `mobile-health-beta`, existing frontend
`https://d0252422-oss.github.io/health-companion-beta/`. These are documented prior
read-only facts, not a new remote inventory. Before any eligible write, re-match
project ID/name and migration hashes; preserve deployed function source/revision,
frontend artifact, schema/grants/policies and flag/config before-state without secrets.

Operational order after actual Edge and remaining prerequisites are accepted:

1. Use the pinned CLI's inspected commands against a new isolated local Edge/PG17
   project and the real handler/provider, including the new observation paths.
2. Confirm the existing server-side verified Web-session endpoint, distinct canonical
   mapping, dedicated SQL role and TLS/pool transaction behavior. Missing settings
   fail closed; no local test issuer may enter the deployment. OAuth login or new
   credential/role/permission changes require the separately applicable human action.
3. Recheck and apply only the allowlisted missing additive Beta migration hashes;
   verify schema, constraints, RLS, grants, functions/triggers and migration versions.
4. Deploy the reviewed function tree with `supabase functions deploy mobile-health-beta
   --project-ref uavimjgccigpbwqmfkhh` only after the preceding prerequisites, with existing
   approved server config. This is a pending command, not executed evidence. Verify
   dedicated A/B synthetic sessions, SQL CRUD/receipts, bounded publication and errors.
5. Only after backend smoke passes, publish the reviewed frontend artifact to the
   existing Beta-only delivery target and switch its manual SQL config to enabled with
   the verified Beta Web endpoint/release. The actual GitHub Pages deployment mechanism
   and old artifact must first be inventoried; do not invent a push/workflow command,
   use the main production entry or claim source packaging is publication.
6. Run deployed original-form body/nutrition/training/sleep/steps/total-energy/exercise
   CRUD, new browser session read-back, A/B/cache isolation, replay and analysis checks.
   Maintain a synthetic record-ID manifest; only its authorized test rows may be deleted.

Any auth/RLS/tenant/read-write mismatch or migration/function regression stops the
sequence. Restore the last verified Beta frontend/flag/function if compatible; retain
new SQL records, revisions, receipts and tombstones. Prefer additive forward-fix, not a
destructive down migration, bulk requeue or Sheets overwrite. Sheets/Apps Script source
and old real data remain untouched. Current prerequisite failures mean **none of these
remote operations is enabled by this local package**; Owner's conditional Beta authority
is already recorded and must not be requested again merely to repeat it.

## 2026-09-14 — conditional Beta SQL-first continuation (historical)

Run `health-beta-sql-first-20260914`, start `32767b7`. Owner now authorizes necessary
non-destructive **existing Beta-only** migration/function/frontend/flags and dedicated
synthetic Beta CRUD, conditional on every required local/target Gate passing. The
older no-remote-write/proposed-preview approval instructions below are historical;
do not ask for this same conditional authority again. Production, destructive migration,
real-data import, credential/permission changes, push/merge and paid services remain out
of scope. Current actual Edge is still BLOCKED, so no conditional write was executed.

### Shared-queue publication correction

Actual PG17 reproduced four cases where the legacy scheduled worker completed body/
meal work without portable heads (or with older heads); two opposite-order controls
passed. The original RED evidence is retained, not relabeled as acceptance.

`20260913180000_engine_queue_publication_guard.sql` adds sticky `engine_required` and
`engine_published_generation` to the existing queue. Manual enqueue keeps old/new28d
invalidation and marks required work. A BEFORE COMPLETE guard rejects a missing
current-generation publication, including tombstones and existing input/head-backed
dates. No second queue, full-history requeue, bulk rewrite or formula change.

The authenticated scheduled/opportunistic `index.ts:processScoreQueue` now dispatches
the already-claimed canonical/date/generation/token to the configured hosted runtime
when enabled; invalid config never falls back to the old finalizer. Direct Shortcut
recompute likewise uses the bounded shared queue when enabled. Authentication remains
before claim. `LocalEngineRuntime.processClaimedJob` computes outside the transaction,
then verifies/locks the live exact lease and commits portable heads/history, generation
marker, unchanged frozen8 scores and COMPLETE together. A REPLAYED frozen fingerprint
still publishes changed manual outputs. Old workers cannot falsely acknowledge required
work; normal bounded retry/FAILED visibility is retained.

Body and snapshot reads also verify the publication generation. Old COMPLETE rows with
marker0 are UNKNOWN/UNAVAILABLE or STALE, not silently current and not a scheduled job.
The additive migration does **not** repair old COMPLETE data. Before any later scoped
reconciliation, inventory affected synthetic/authorized user+date+generation+head counts;
explicitly bound and record those dates, requeue through the reviewed writer, and verify
new generations without deleting rows or overwriting newer inputs. No remote backfill
has run. Normal future writes already use the new bounded enqueue.

### Cutover target facts and remaining real wiring

Read-only Management metadata independently matched `health-companion-beta` to
`uavimjgccigpbwqmfkhh`, Edge `mobile-health-beta` version14, DB17.6.1.166 and16 migrations
through20260903130618. Native17.11 is not exact hosted patch/extensions/pool proof.
This inventory is **not** a rollback snapshot: previous frontend/source artifact,
deployed Edge source, before-schema/grants/config/flags still need verified preservation.

The reviewed missing additive subset, in order, is20260912032458,20260912041126,
20260912182042,20260913041844 (AB),20260913164024,20260913164026 (AB),20260913180000.
Recheck exact remote versions and hashes immediately before any eligible apply; review
every statement and stop for destructive operations. Never `db push` the whole packaged
history: already-applied durable cron and failed-queue repair migrations have unrelated
side effects. The new guard changes shared worker completion, so B button hiding alone
cannot establish A's backend safety; both releases require its regression.

Current manual provider covers body, meal, workout and exercise CRUD, receipts and
bounded reads. The existing sleep/activity pages now read published SQL daily metrics
through `manual-daily-read.ts:readPublishedDaily`, selected by the actual handler and
explicit hosted A/AB action allowlist. One repeatable-read transaction verifies the
canonical mapping, queue generation and current versioned head; native reads additionally
use authenticated RLS. At most366 dates and367 rows (overflow rejected), no raw-history
scan, recompute-on-read or new aggregation. Valid zero is preserved. STALE/unverified
publication returns null metrics with an explicit stale notice; old account/range replies
cannot overwrite current UI. Raw metric connectivity does not prove a calculated score.
Legacy `sleepScore` stays null rather than substituting experimental `sleepSystemScore`.
Energy active/total classification and active-minutes ingestion are not currently
supported by the canonical native domain contract; calories and absent minutes stay null.
The reference core's ability to calculate generic energy does not make it an ingestion API.

Weekly reports, check-ins and complete dashboard semantics are **not yet equivalent SQL
adapters**. `getNutritionTargets`/`getUserProfile` are unused wrappers in this Web revision,
not active render dependencies; they remain unverified, not silently counted complete.
Full legacy API source `evidence/apps-script-production/head/程式碼.js` is absent here.
Weekly boundary/reduction/recommendation/native-vs-manual precedence and check-in
primary/upsert/delete/replay semantics cannot be validated against the current source.
The only check-in schema draft has different fields/scales from the existing ordinal UI.
No fabricated weekly score, new check-in scale or personal target was introduced.
Their unsupported actions fail closed; that is not whole-site SQL-first acceptance.
Existing Apps Script session verification remains an auth dependency, not a Supabase
JWT or Sheets data fallback. Real Google/LINE login return-path and canonical mapping
remain unverified. Documented existing Beta entry is
`https://d0252422-oss.github.io/health-companion-beta/`; the older proposed manual-preview
path is not proof of the actual login/publication target. Same GitHub Pages origin does
not isolate production by URL path: verify exact artifact, route and cache namespace.
The offline package now names that existing Beta root rather than proposing another
preview entry. It explicitly marks current remote artifact/config snapshot NOT_CAPTURED.

Once prerequisites pass: preserve rollback snapshots; apply only the verified missing
Beta subset; verify schema/RLS/grants; deploy only `mobile-health-beta`; smoke its
worker and manual contracts with dedicated accounts; **only then** update the existing
Beta frontend/provider. Validate a new browser session's SQL reads, A/B separation,
CRUD/receipt/analysis and no fallback. An Edge smoke failure stops frontend switch.
Rollback restores last verified Beta frontend/flag/function while retaining new SQL
rows/receipts/tombstones and compatible read/export; never reverse data into Sheets.
Pinned CLI2.115.0 `functions deploy --help` also exposes `--use-api` server-side bundling.
It was not used: a remote deploy is not an alternative proof of the required actual
local Edge Gate, and the Owner explicitly blocks cutover until that prerequisite passes.

Sheets remains untouched. After successful future cutover it is legacy/read-only,
export/migration source only, never dual-write canonical storage. Historical migration
requires separate authority: verified source-subject mapping (no email/name guessing),
original row ID + revision/provenance, explicit kg/percent/nutrition units, source timezone
and date-only distinction, deterministic duplicate keys, conflict quarantine (not mtime),
bounded dry-run counts/checksums and user-scoped report. Preserve source and destination;
rollback disables the importer, not bulk deletes or overwrites newer SQL records.

## 2026-09-14 — overnight manual input closure (historical)

Run `health-overnight-20260914-0037`, starting canonical HEAD `3ef6b61`. This is new
local work, not a claim that the earlier Docker/Edge/OAuth gates passed. No ADB,
phone, remote writes, deployment, push, new dependency or frozen formula changes.

### Actual supported contract / call graph

All SQL rows use the verified canonical identity, not a frontend user ID. Local
signed test sessions and real OAuth acceptance remain distinct. Default flags OFF
retain the original Apps Script login/data provider; SQL enabled reads and writes
share `index.html:sessionPost` -> `local-engine-web.js:localEngineRequest` -> actual
`mobile-health-beta/index.ts:default.fetch` -> `LocalEngineRuntime.handle/identity`
-> `manual-web-identity.ts` -> PostgreSQL. There is no SQL-error-to-Sheets fallback.

| Domain | Existing form / actions | Real storage/read-back | Update/delete/idempotency | Analysis / UI |
|---|---|---|---|---|
| BODY / WEIGHT | `#weight-form`; upsertBodyRecord/getBodyRecords/deleteBodyRecord | ManualBodyLocalStore; engine_manual_body_records | revision, unique live user/date, tombstone; private.engine_body_mutation_receipts | atomic bounded queue trigger -> compute -> original Body engine -> output heads -> body note; raw CRUD independent of score availability |
| NUTRITION | `#meal-form`; upsertMealRecord/getNutritionRecords/deleteMealRecord | engine_meals; snapshot joins output heads/history | revision/tombstone; private.engine_mutation_receipts | existing portable Nutrition engine; explicit label/grams, incomplete values remain null; original meal UI |
| TRAINING | original workout session/set editor; addWorkoutRecord/getWorkoutRecords/updateWorkoutSet/deleteWorkoutSet | ManualTrainingLocalStore; manual_workout_sets | stable record/exercise IDs, revisions, tombstones; private.manual_training_receipts | actual SQL daily volume/set/session aggregates; manual training **score adapter NOT_CONNECTED**, no job; records saved, analysis not enabled |
| EXERCISE_LIBRARY | original training page manager; manageExercise/getExerciseDatabase | manual_exercise_catalog + user preferences | create/rename/classify/archive/restore/delete, stable server UUID, revision/receipt | custom owner names/categories; system personal alias; history snapshots retained, RESTRICT FKs, no score mutation |

Custom creation accepts duplicate names as distinct UUIDs, never merges them. Category
already existed in the model; only its owner can edit it. Shared system categories are
read-only. Names/categories normalize NFC, reject controls and have80/40-character
bounds; the UI uses literal DOM values/text. The catalog is bounded1000 visible entries.
All lifecycle writes share the canonical advisory lock and preference lock, then check
revision/active state. Both rename/reference orders now join the previous four barrier
orders across READ COMMITTED/REPEATABLE READ/SERIALIZABLE; history retains the name and
category at the time of reference. Soft-deleted history still prohibits permanent delete.

### Body adapter, not a new engine or health-score formula

`manual-body-engine.ts:manualBodyEngineRecords` emits MANUAL_WEB weight(kg), optional
body_fat(percent), and same-observation fat_mass(kg = weight × percent /100). Null body
fat is absent, not zero; an explicit zero remains zero. Date-only data uses a deterministic
Taipei midnight anchor, not a claimed measurement timestamp. No height, personal target,
calories, sex or accuracy estimate is synthesized. Existing multi-source ambiguity policy
is preserved: manual and device observations are not silently averaged or merged.

`LocalEngineRuntime.compute` reads meals/mobile/body in a bounded repeatable-read
snapshot, supplies the unchanged PortableEngineRuntime, then retains existing atomic
generation-checked output publication. `engine_manual_body_dirty` reuses the existing
queue invalidation trigger: old/new dates plus at most27 following days, capped at today.
Receipt replay does not enqueue again. A late40-day-old record does not recompute all
history; shifting its date by one affects29 distinct dates, not the whole timeline.

Seven prior valid observation days allow the existing Body stability/fat-mass trend
components; otherwise missing baseline/target is INSUFFICIENT_DATA. No BMI without an
existing supplied height. `engine_output_history/heads` keep body-score-v1.0 version and
fingerprints; the body panel explicitly says Experimental/UNVALIDATED. The separate
legacy/mobile `score-bridge.ts` and original28 vectors remain byte-identical: manual
body is **not** inserted into beta_health_records, and experimental output is not silently
substituted for the old dashboard's frozen mobile-score input contract. Experimental
portable overall continues to use its already-existing frozen orchestration/weights.

Raw stored body JSON/immutable receipts contain their original queued snapshot. Reads
hydrate current analysis from queue and output heads in one repeatable-read transaction.
Queue DIRTY/PROCESSING = pending; FAILED = ERROR/no scheduled job; absent history and
queue = ANALYSIS_NOT_ENABLED (no fabricated backfill); insufficient engine output stays
INSUFFICIENT_DATA. A post-commit optional analysis failure preserves SAVED/receipt and
reports ANALYSIS_UNAVAILABLE with jobScheduled=null. Review reproduced the prior503
misreport using a scoped analysis rejection after real SQL commit, then verified the fix.

Provider UI now distinguishes configured local/hosted PostgreSQL or Apps Script and
the actual last-request result/action/timestamp. Account reset discards this observation
along with data caches. A failed SQL request says no provider switch; analysis states
are separately displayed. It is not a hardcoded claim of a live database connection.

### New migration / release separation

- Release A additionally needs `20260913164024_manual_body_engine_recompute.sql`,
  after existing body/engine/queue migrations. Additive trigger, no new data imports.
- Release B additionally needs `20260913164026_manual_exercise_category_update.sql`,
  after `20260913041844_manual_exercise_catalog_sql.sql`. Only muscle_group UPDATE grant.
- Both files were created by pinned CLI2.115.0 `migration new` after help inspection;
  only fresh synthetic local databases rehearse them. No existing database is reset.
- A-only native/browser/package excludes both B migrations and denies B API actions;
  hiding buttons alone is not claimed to establish Release A isolation.

### Enablement checklist, still no remote execution

Exact intended target remains `health-companion-beta` / `uavimjgccigpbwqmfkhh`, function
`mobile-health-beta`, route `/functions/v1/mobile-health-beta/v1/engine/web`; proposed
isolated Web path `/health-companion-beta/manual-preview/` at the documented GitHub
Pages origin. It is not deployed or an approved replacement for the current root page.

1. Resolve existing Docker `sailor-ingest.sock` Windows1920 using an operator-reviewed,
   non-reset fix. Fresh diagnostics show no redirect, no daemon, unchanged reparse
   error; no additional startup was justified. Do not delete socket/volumes or change
   ACLs based on an assumed cause. Then execute actual CLI Edge+PG17+Web on unique
   local project/ports/dataset, including pool/TLS and platform resource boundaries.
2. Obtain named Beta **read-only inventory** authority for actual migration revisions,
   PG patch/extensions, custom DB role/pool host, Web verifier and canonical mappings.
   Diff against the packaged migration hashes; do not blindly apply every historical file.
3. Authorize only the reviewed missing additive A migrations (including body trigger),
   role/membership and secret/config operations. B migration/category grant is a separate
   release decision. Preserve current login and canonical IDs; no alias backfill/merge.
4. After prerequisite acceptance, authorize deployment of only the named function and
   isolated frontend artifact at its reported source revision/hash. Proposed CLI operation:
   `supabase functions deploy mobile-health-beta --project-ref uavimjgccigpbwqmfkhh`
   from the reviewed source package. Do not use all-functions deploy, push or CI implicitly.
   Frontend publication must target the approved preview path, not overwrite root Pages.
5. Review backend `HEALTH_MANUAL_SQL_HOSTED_ENABLED`, `HEALTH_MANUAL_RELEASE=A`,
   `HEALTH_MANUAL_ALLOWED_ORIGIN`, expected project/pool host, DB connection secret and
   `BETA_WEB_AUTH_VERIFY_URL`. Match frontend `manual-sql-config.js` project/endpoint/
   schema/release. Enable both sides only after real Google/LINE verified-session tests;
   no local test issuer, fixed account, service secret or localhost in the public client.
6. Separately authorize synthetic user-scoped remote smoke writes: one body row and one
   labeled meal, update/replay/read in fresh browser context, tombstone delete and A/B
   denial. Record exactly approved accounts/request IDs/dates; no real health import.
7. Stop rollout for identity/provider mismatch, unauthorized access, unbounded work,
   missing receipt, partial SQL result or formula regression. Roll back frontend/function
   and disable new writes; preserve newly written rows/receipts/tombstones and compatible
   read/export access. No DROP, destructive down migration or silent Sheets fallback.

The package is a source deploy tree with real hosted SQL wiring, not an Edge-executed
bundle. Actual pool/TLS, extensions, OAuth, publication and live phone page remain open.
Current official Edge limits include2s CPU/request,256MB memory and20MB CLI bundle;
source byte size and native timings are not measured Edge usage. See
[Edge limits](https://supabase.com/docs/guides/functions/limits) and
[pooled PostgreSQL](https://supabase.com/docs/guides/functions/connect-to-postgres).
Changelog was rechecked: extension VERSION clauses are no longer honored on hosted
platform; actual extversion inventory is required (our new migrations add none).
[Official change](https://supabase.com/changelog/extension-version-pinning-ignored).

### Deferred device preparation

No ADB executed. The existing collector now requires an explicit account scope hash,
bounds each owned command and the full observation window, preserves output atomically,
and never conflates completed-batch progress with HTTP attempt count. Offline tests use
an intentionally absent binary and a pwsh child for timeout mechanics, not a device.
It remains METADATA_ONLY: actual WorkInfo, APK/source binding, per-request timing,
account-owned checkpoint, ingestion/score correlation and OEM scenarios are still needed.
Global checkpoint presence is not falsely attributed to the requested account. The
one-click future full gate is therefore not claimed complete; no sync trigger is added.

## 2026-09-13 — Edge/PG17/concurrency release closure (historical)

Run `health-edge-pg17-20260913-2210`, baseline `a8f7a1c`, same canonical D checkout.
This section supersedes the older inert/local-only provider descriptions, **not**
the historical execution evidence. No Git isolation, relocation, engine rewrite,
formula change, production/Beta write or new application dependency was performed.

### New hosted connection, still OFF by default

| Edge in the call path | Actual file / function |
|---|---|
| Original forms, immutable retry envelopes and render guards | `index.html:sessionPost`; `scripts/local-engine-web.js:localEngineRequest` |
| Public default-OFF environment binding | `scripts/manual-sql-config.js`; `hostedManualConfig/hostedManualNamespace` |
| Existing verified-session transport, no Sheets data fallback | `hostedManualFetch/ensureHostedManualIdentity`; HTTPS Edge endpoint, bearer header, credentials omitted |
| Real function and SDK middleware | `mobile-health-beta/index.ts:default.fetch`, exact `/v1/engine/web` route before unrelated mobile callback config |
| Separate hosted configuration and SQL factory | `hosted-manual-bootstrap.ts:validateHostedManualConfig/hostedManualBootstrap/createHostedManualRuntime/scopedManualSql` |
| Verified Web subject/email to existing canonical ID | `index.ts:verifyWebIdentity` then `manual-web-identity.ts:resolveVerifiedManualWebIdentity/checkManualWebMapping` |
| Shared semantics / real SQL / portable calculation | `LocalEngineRuntime`, `ManualBodyLocalStore`, optional `ManualTrainingLocalStore`, `PortableEngineRuntime` |
| Return / recovery | persisted records and receipts -> same provider -> original Web; cache namespace includes endpoint/release/schema/canonical ID |

Hosted and synthetic-local environments are different constructors, not an allowRemote
override. All original local target guards remain. Hosted manual identity is Web-only;
missing/native session-kind is denied. Existing Apps Script login/profile/logout stays
in that explicit auth path; its token is **not** asserted to be a Supabase Auth JWT.
Manual data actions never fall back to Apps Script on error or unsupported action.
The server never accepts a client user ID and never calls the account-linking RPC.
Mapping changes are rechecked inside every data transaction; write mapping rows are
locked. Missing/conflicting/inactive mappings fail closed. No production test issuer
or synthetic account is imported by the hosted path.

Hosted configuration requires exact project-bound Supabase URL, reviewed transaction
pool host, port6543/postgres and `health_manual_api.<project_ref>` username, verified TLS,
an exact HTTPS Web origin and Apps Script verifier URL. No query-string URI overrides,
localhost target, alternate credential role or disabled TLS is accepted. Configuration
fingerprint changes fail closed. This validates a proposed connection contract, not the
existence of a remote login or permission to use it. No secret is in frontend/artifacts.

Reuse postgres3.4.8 with `prepare:false`, max2, connect5s. Every tag, unsafe, begin,
RPC and compute query uses a transaction-scoped facade. The dedicated proposed login
is `NOINHERIT NOSUPERUSER NOBYPASSRLS`, explicitly allowed SET ROLE service_role;
the facade verifies these properties and sets role and bounds locally per transaction.
Lock2s, statement10s, idle-in-transaction10s, transaction15s; admission remains bounded.
The role check also has SQL timeouts. This is **privileged service_role execution**,
not least-privilege Web RLS. Server canonical authorization is separately tested;
native authenticated NOBYPASSRLS tests remain distinct. No Data API service key is
treated as a SQL password. Actual Supavisor pooling/TLS remains a separate unrun Gate.

Final read-only review found and reproduced additional connection defects. Hosted
first-login now retains the original Google renderer (only local mode shows synthetic
A/B login); actual `completeLineGoogleLink` and `linkLineIdentity` actions stay on the
existing verified-session auth provider, never the SQL data action list. Those route
unit tests do not execute OAuth or account linking. The SQL guard now rejects effective
service_role inheritance via `pg_has_role(...,'USAGE')`, even when the login's
`rolinherit` is false: PG17 membership options are independently checked. No remote
role was changed. See [PG17 privilege inquiry](https://www.postgresql.org/docs/17/functions-info.html).

Snapshot queue/input/head/history reads now share one bounded REPEATABLE READ,
READ ONLY transaction. Native data reads still SET LOCAL ROLE authenticated and
use RLS; verified Web mapping remains checked. A deterministic test pauses after the
real queue SELECT, commits a real meal revision on another connection, then releases
the reader. The in-flight result must retain the old consistent snapshot; the next
read must show the new revision with STALE outputs until recomputed. This fixes a
reproduced mixed-revision response without changing scores, tolerances or migrations.
See [PG17 transaction isolation](https://www.postgresql.org/docs/17/sql-set-transaction.html).

New ingress helper `manual-request-body.ts` limits input to1MiB and10s, cancelling a
stalled reader so it cannot hold admission forever. PostgreSQL40001/40P01 now return
503 `DB_CONFLICT_RETRYABLE` instead of non-retryable400. Stable request IDs may be
retried in a new transaction. No lock model, golden result or numerical tolerance changed.

### PG17, concurrency and platform boundary

Native PostgreSQL17.11-3 was obtained from official EDB HTTPS using a separate reviewed
portable directory, verified archive multipart ETag, SHA256, extraction bounds and
three binary version probes. No installer/service/admin change or PG18 data-directory
reuse. It is unsigned and no publisher ZIP SHA was found: this is not signature/SBOM
or zero-vulnerability certification. `pgcrypto1.3` and `plpgsql1.0` are real extensions.
Native synthetic auth contract tables are explicitly fixtures, not Supabase Auth.
Unavailable pg_cron/pg_net/vault and outbound scheduler are omitted, never replaced
with fake functions. Native PG17 core SQL PASS cannot prove full-platform extension parity.

`test-exercise-lifecycle-barriers.ts` uses independent connections and explicit Promise
barriers; pg_backend_pid/pg_blocking_pids prove who blocked whom before COMMIT. Four
orders run at READ COMMITTED, REPEATABLE READ and SERIALIZABLE on PG17 and PG18:
archive->reference rejects, reference->archive preserves/editable history, reference->
delete rejects, delete->reference rejects. Receipt replay, new-request lifecycle checks,
foreign-key final state, personal archive scope and retry after40001 are covered.
Initial PG18 higher-isolation API failure remains evidence; final status is in REPORT.

Upstream `ri_ReportViolation` emits FK23503 for RESTRICT in PG17 and a distinct23001
in PG18. The existing browser harness now declares the exact per-major contract and
checks history remains. This is not relaxed acceptance: see the official source
[PG17](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/utils/adt/ri_triggers.c)
and [PG18](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/utils/adt/ri_triggers.c).
The older harness's alleged independent race used one pooled connection; its new SQL
race uses two explicitly separate clients with bounds. Strict four-order evidence is
the dedicated barrier runner, not this supplementary browser-harness race.

Release A excludes the B migration entirely and denies all B actions plus workout
refresh before B SQL. Shared B store construction has no SQL side effects. A-only
factory/database/browser tests assert absent B tables, genuine body/meal persistence
and new-context verified synthetic Web read-back. Release B requires its own additive
migration/capability and acceptance; hiding UI alone is not isolation. Raw body/workout
still say records saved, analysis not enabled/no scheduled job. No new score or formula.

### Deliverable and remaining activation wiring

`prepare-manual-beta-package.mjs <new-output> --release=A` now packages the actual
frontend, hosted backend source graph, versioned migrations, effective locked function
config and byte-identical frozen score implementation at its real relative import path.
It checks every literal relative backend import. The frozen JS under fixtures is runtime
calculation code, not fixture responses; synthetic issuer/identity fixtures are excluded.
The package also derives a single-function `supabase/config.toml` from the checked-in
function block, preserving custom-session gateway settings, PG17 major and seeds OFF.
It does not copy unrelated local service settings. Actual local startup still requires
a separate new unique project/ports configuration and the blocked Edge acceptance.
All flags remain OFF. Isolated offline Deno check is **not** an actual CLI Edge compiled
bundle, nor proof of paid/public production capability. CLI serve/deploy help was checked
at pinned2.115.0; its upgrade suggestion was not followed.

Real local Docker startup failed on `sailor-ingest.sock` (Windows1920); one normal start
and one normal stop failed. No socket/ACL manipulation, runtime reset, image pull,
new service or remote fallback. Actual CLI Edge + Supavisor + Web and platform resource
measurements remain blocked. Docker's existing error dialog must be Quit normally;
further diagnosis/repair of the exact socket requires separate operator authorization,
not speculative reset commands. See the external run's Docker report.

The documented Beta target remains project `health-companion-beta`, ref
`uavimjgccigpbwqmfkhh`, function `mobile-health-beta`; proposed isolated Web entry
`https://d0252422-oss.github.io/health-companion-beta/manual-preview/` (not authorized or
freshly verified remote state). Backend manual origin would be
`https://d0252422-oss.github.io`, not the full subpath. Preserve current root/production
and all old manual data. Do not deploy just because a source package now exists.

Required separate authorization, in dependency order:

1. Resolve existing Docker socket access after a reviewed non-reset diagnosis. Then
   inventory image/storage requirements and run a new isolated actual CLI Edge + PG17
   + verified local auth + original Web acceptance; real pool/TLS and extension tests.
2. Read-only target schema/major/patch/extensions/role/identity/provider inventory and
   compare migration hashes. Remote patch, pool host, approved verifier and role are
   currently UNKNOWN; no automatic `db push`, default migration replay or identity backfill.
3. Authorize only missing additive A schema and reviewed custom SQL login/membership,
   secret placement and backend manual settings for the named Beta project. Role DDL
   proposal: health_manual_api LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS with explicit
   service_role SET membership, INHERIT FALSE; credential supplied through approved secret
   management, never generated/pasted in a report. Broad privilege risk needs review.
4. After required checks, separately authorize deployment of that single function and
   proposed Web subpath. Prepared syntax (NOT RUN): `supabase functions deploy
   mobile-health-beta --project-ref uavimjgccigpbwqmfkhh`. Do not use --prune, --use-api
   as a way around the local Gate, deploy all functions, or change existing gateway auth
   without reviewing the custom verifier path. Existing JWT verification settings must
   match this function's custom verified-session contract; no naked auth bypass.
5. Authorize named Beta synthetic accounts and a bounded data manifest for remote
   create/read/update/replay/delete acceptance; real Google/LINE login and mapping
   performed by the account owner, not extracted browser tokens. Then enable the A
   public configuration/backend flags together. No automatic account linking/import,
   dual-write or Sheets fallback. B remains disabled until separately accepted.
6. Owner's later message permits physical-device checks, but does not explicitly revoke
   the no-remote-write boundary. ADB/beta.12/passive metadata were checked without Sync.
   A true POCO network/retry/ingestion Gate additionally needs explicit user-scoped Beta
   ingestion authorization and a legitimate pending work trigger; never repeat manual
   Sync to contaminate evidence or claim old PARTIAL metadata is a new PASS.

Stop rollout on cross-user access, identity mismatch, unbounded requests, lost receipts,
partial SQL transactions, changed frozen scores or unexplained stale output. Rollback
first stops new SQL writes (backend flag OFF) and disables the new preview entry; restore
last reviewed frontend/function without dropping schema, clearing receipts or deleting
new records. Preserve a compatible SQL read/export path and all new rows/tombstones;
never silently redirect new SQL data to Sheets. Snapshot/retention access must be approved.
Hosting/pool resource and cost impact remains UNKNOWN until the authorized target review;
no new paid service was introduced or presumed free.

References reviewed via the Supabase skill:
[connection/pool modes](https://supabase.com/docs/guides/database/connecting-to-postgres),
[Edge Postgres driver](https://supabase.com/docs/guides/functions/connect-to-postgres),
[custom auth](https://supabase.com/docs/guides/functions/auth), and current changelog
entries on grants, extension pins and self-hosted PG17. No tool upgrade or remote mutation.

## 2026-09-13 — manual release readiness and exercise management (current)

Run `health-release-exercise-20260913-120836`, continuing `efe83ed` in the
canonical D checkout documented below; no migration/Git isolation was repeated. This section
supersedes older dispatch-only/manual-auth descriptions below, not their evidence.

### Actual execution and identity boundary

| Node | Actual file / function |
|---|---|
| Original body/meal/workout forms and catalog manager | `index.html` existing submit/edit handlers; `scripts/local-engine-web.js:setupLocalExerciseManagement/localEngineRequest` |
| HTTP, gateway-prefix routing, CORS and SDK middleware | `scripts/local-engine-server.ts` calls `mobile-health-beta/index.ts` **default.fetch**, not dispatch-only |
| Native local identity | Distinct ES256 authority -> `authenticateNativeUser/resolveNativeIdentity` -> existing canonical mapping |
| Web session local identity | Separate signed issuer -> verified subject/email -> `manual-web-identity.ts:resolveVerifiedManualWebIdentity`; existing `private.beta_web_identity_aliases` SELECT only |
| Body / catalog / workout SQL | `ManualBodyLocalStore` / `ManualTrainingLocalStore`, same canonical PG provider for CRUD, receipts and read-back |
| Meals / analysis | Existing `LocalEngineRuntime.mutate/compute/snapshot`, portable engine, existing durable recompute queue and versioned PostgreSQL outputs |
| Target CLI-local bootstrap | `local-manual-bootstrap.ts:localManualBootstrap`; actual SDK admin verified auth or existing `verifyWebIdentity`, no local issuer in this module |
| Return | PG rows/receipts -> same original Web UI; new context re-authentication sees durable results |

Native tests use non-owner `authenticated NOSUPERUSER NOBYPASSRLS` for RLS reads;
anonymous reads and authenticated direct writes are denied. Backend writes use
`service_role NOSUPERUSER BYPASSRLS`, with separately tested canonical predicates,
owner/FK guards and narrow column UPDATE grants. Web sessions **do not impersonate
native JWTs** and do not set `auth.uid()` to the canonical UUID. Their existing
alias subject and exact normalized verified email must BOTH match one ACTIVE Beta
mapping. Missing/conflicting/revoked mapping fails closed. All Web reads, including
receipts/queue/timeline, recheck mapping within their transaction; writes lock mapping
rows before mutation. No alias/account creation, timestamp update or merge occurs.
Web isolation evidence is server tenant authorization, **not Web RLS PASS**.

Native SQL is PostgreSQL18.6, driver postgres3.4.8. Actual local handler runs in
Deno2.9.6/TS6.0.3 with @supabase/server1.4.1. Existing intended deployment is Supabase
Edge Runtime; CLI2.115.0 is installed, but its local Docker API pipe is absent.
Actual Edge version/execution/resource/bundle acceptance remains BLOCKED/UNKNOWN.
The repo CLI config selects PG17, which was NOT tested by the PG18.6 rehearsal.
Do not promote ordinary Deno or skills/documentation to Edge evidence.

The new CLI-local bootstrap is opt-in, rejects deployed-worker markers, remote/non-root
auth URLs, wrong DB/role/port, credentials in local config and changed DB/auth environment
after bootstrap. It has no required Python subprocess or remote worker. SDK auth fetch
and existing Web verifier have a 10-second deadline through response body consumption;
transport failure returns503 retryable, not an invalid-login401. Admission is released.
Actual runtime code/handler tests pass, but enabling this **local-only** bootstrap on
a remote deployment remains prohibited. It is not a production auth bypass.

### Raw data and exercise semantics

Body returns `ANALYSIS_PENDING / ALGORITHM_NOT_CONNECTED / analysisJobScheduled=false`.
The Web explains that only the SQL record was saved and no job exists. Raw workout
sets similarly use `MANUAL_WORKOUT_ADAPTER_NOT_CONNECTED`, not imaginary queue work.
Meal analysis continues the existing queue/experimental nutrition path. No body/workout
manual rows are disguised as mobile ingestion or injected into health-score-v1.0.

New additive proposal `20260913041844_manual_exercise_catalog_sql.sql` extends the
existing exerciseId/workout contracts: shared definitions, owned custom definitions,
per-user alias/archive/revision preferences, stable-ID manual sets and write receipts.
Own names may change; system names only receive personal aliases. Historical set JSON
keeps its original name/ID/weight/reps; rename never merges same-name movements.
Archive hides only new selection, restores reversibly, and allows same-ID historical
set edits. Permanent deletion is own-unused-only, with native confirmation and
RESTRICT FKs, never CASCADE. Soft-deleted historical sets still block physical deletion.
There is no existing runtime template store in this repo: template integration is
NOT_IMPLEMENTED, not a tested promise. Any future template store MUST use a normalized
RESTRICT FK before referencing IDs; no name/JSON-only pre-check is sufficient.

Canonical advisory locks, preference row locks and FK key locks arbitrate writes.
API replay/concurrency and an independent SQL reference/delete race passed. Direct
archived inserts are rejected; archived history stays editable. Both separately
barrier-controlled archive/reference orderings were not measured, so are not claimed.
Raw set old/new dates are returned for view invalidation; no unconnected score job is
fabricated. Existing meal bounded recompute is reused, not replaced with a new queue.

Uncertain workout writes keep a deep immutable envelope/request ID. Back/start and
draft edits are locked while retry remains accessible. Settings/Training and mobile
quick-navigation restore the same draft, not a new one. Account reset unlocks and
clears draft/catalog/state. Provider/database/user namespaces isolate caches; late
catalog/range reads cannot revive an older revision. Zero remains zero, null remains
missing. Names render as text/escaped HTML; control/bidi/blank/overlength names reject.

### Conditional body/meal Beta package — NOT enablement

Build locally with `node scripts/prepare-manual-beta-package.mjs <new-absolute-output>`.
It copies only the original `index.html` and its relative
`scripts/local-engine-web.js`, checks inline/linked JS syntax and records SHA256/source
revision. No synthetic issuer, secret, DB, fixture, Android or source-map is shipped.
This is an **inert static review artifact**, not a working remote manual-SQL release.
Local/manual/exercise flags are OFF; the existing Apps Script default is unchanged.
Uploading it alone cannot enable SQL. Existing external fonts/Tailwind/Lucide/LIFF and
real Google login are not validated by the offline browser harness that strips CDNs.

Documented future Beta target (not fresh remote-state verification):
project `health-companion-beta` / `uavimjgccigpbwqmfkhh`,
function `mobile-health-beta`, Supabase Edge.
Proposed frontend entry:
`https://d0252422-oss.github.io/health-companion-beta/manual-preview/`.
The new subpath is a proposal, not an approved deployment target; preserve current
Beta root, production root, legacy manual data and login. No import, dual-write or
Sheets fallback is permitted on the SQL path.

Body/meal package dependency proposals: existing canonical/identity/queue baseline
plus `20260912032458_multi_domain_engine_versioned_outputs.sql`,
`20260912041126_engine_local_runtime_integration.sql`,
`20260912182042_manual_body_local_sql.sql`. Exercise migration is optional/separate
and MUST NOT hold the body/meal package hostage. Web mapping migration in this run:
NONE; the read-only adapter reuses existing aliases. All20 migration files were rehearsed
in a new UUID synthetic local PG18.6 cluster; the outbound cron/net/vault scheduler
portion of `20260903021109_durable_beta_score_processor.sql` is intentionally omitted.
This is not the complete remote migration or hosted Auth stack rehearsal.

Before enablement: healthy authorized CLI Edge resource; patched target-major PG
compatibility; actual Edge handler/browser/bundle/CPU/memory acceptance; real existing
Web-session verification and user-scoped OAuth mapping; reviewed hosted connection,
non-local provider/route activation design with default-OFF flags; current remote
schema/config diff and explicit migration hash allowlist. Do NOT change the local
guard into an unrestricted remote switch. No remote server may depend on this Windows
host staying awake. Real production/Beta flags/settings are not altered by this run.

Minimum separate authorization request, only after those local prerequisites:
1. Read-only verify named Beta schema/config and exact frontend source/path.
2. Apply only reviewed missing additive migration hashes to the named Beta project;
   no bulk import/delete, account backfill or production schema change.
3. Deploy the reviewed function revision and isolated candidate path, then enable
   the approved user-scoped provider flag; no current-root overwrite.
4. Use designated synthetic Beta A/B identities for body/meal CRUD, canceled/confirmed
   delete, replay/conflict/timeout/reload, anonymous and real-login isolation smoke.
   Approve test write/delete scope explicitly; never touch real health records.
Risks: auth mapping, provider mismatch, unsupported target/runtime, retained-data
availability. Rollback closes new writes and disables the candidate provider/path,
restores prior function/UI revision, but keeps all new tables/records/receipts and
a read-only export path for authorized recovery. Do not DROP tables or redirect an
unsettled SQL mutation into Sheets. Existing legacy records are preserved throughout.
Incremental remote cost/resources UNKNOWN pending target measurements; added paid
services0. The package is ready for **conditional review**, not activation.

## 2026-09-13 — canonical D workspace and manual SQL continuation

Canonical local development entry:
`D:/Dev/Projects/health-companion-canonical-20260913-020110`.
It is an independent, snapshot-derived repository retaining baseline
`423da056b0ee544bb5aac3b19346542e2e2a5003`, refs, history and original dirty work.
The two original D folders still have duplicate linked-worktree identity; they were
not repaired in place, deleted or overwritten. No Git objects/metadata in the new
checkout depend on the C project. The Codex task's original workspace root was not
automatically changed; explicitly select this D entry for subsequent development.
Recovery and detailed topology evidence are in the matching
`D:/MigrationReports/dual-project/20260912-2035/git-manual-sql-20260913-020110` run.

### Actual local manual call graph

| Node | File / function |
|---|---|
| Existing body editor | `index.html:openWeightEditor/loadWeightFormDate`, weight form submit/delete |
| Same local provider for reads/writes | `scripts/local-engine-web.js:localEngineRequest`; explicit loopback flag only |
| Authenticated HTTP | `scripts/local-engine-server.ts` -> existing `dispatchLocalEngine` -> `LocalEngineRuntime.handle` |
| Trusted identity | Existing verified ES256 synthetic subject -> `authenticateNativeUser/resolveNativeIdentity` -> canonical user; no body user ID |
| Body SQL | `manual-body-local.ts:ManualBodyLocalStore.write/read/status`; receipt and record in one PostgreSQL transaction |
| Body read-back | `getBodyRecords` under authenticated non-BYPASSRLS role -> existing body record/chart/editor |
| Meal SQL / engine | Existing `LocalEngineRuntime.mutate` receipt+meal transaction -> existing queue/portable compute -> history/head -> bounded snapshot |
| Meal read-back | Existing nutrition range/list/editor in `index.html`; same provider, historical dates editable |

Manual body uses `engine_manual_body_records`, not `beta_health_records`.
`source=MANUAL_WEB` and `analysisStatus=ANALYSIS_PENDING` explicitly distinguish raw
saved measurements from analysis. Weight and body-fat zero/null semantics are retained.
Body data is **not** injected into unsupported mobile domains or the frozen score
bridge; no synthetic goal, fat mass or score is fabricated. No new score is added.
Nutrition continues confirmed-label arithmetic and existing experimental engines;
unknown/partial nutrients stay null in the local UI, while actual measured zero stays zero.
Labels are synthetic fixtures/user supplied provenance, not a verified food database.

Reads accept explicit real-calendar dates, at most366 inclusive days; the old implicit
28-day restriction is not silently imposed on a selected historical window. Existing
per-table5000-row guard remains; body allows one active user/day and at most366 rows.
Today summary cards retain today's meaning while the meal list labels its chosen range.
User/session/range/sequence guards prevent late body/nutrition responses from replacing
the current view. Default/remote legacy provider, UI and login remain unchanged.

Body receipts bind a stable UUID to the original request hash and canonical owner.
Replay is idempotent, mismatched payload rejects, stale revision rejects, tombstones
do not revive. After response loss the browser queries the actual receipt before
reporting failure; unresolved/retryable requests retain the original envelope.
Service-role SQL still has explicit tenant predicates; authenticated reads exercise
the canonical resolver through RLS, not owner/superuser-only acceptance.

Local PostgreSQL limits: lock2s, statement10s, idle transaction10s, transaction15s,
connect5s. These are engineering test bounds, **not** a production SLA. HTTP admits
at most8 active requests; slots are released only when server work actually ends.
Background polling is non-overlapping. Recognized SQL/connection timeout errors return
503 with a retryable state. Saved meal rows remain saved when analysis fails;
analysis is returned as pending and the durable queue remains the source of recovery.

### Future activation package — preparation only

- Additive migration proposal: `20260912182042_manual_body_local_sql.sql`; two tables,
  owner/date indexes, body SELECT RLS, narrow authenticated/service-role grants.
  It is rehearsed only in new UUID-named loopback synthetic PostgreSQL18.6 clusters;
  no existing database is reset. Old tables/columns and mobile ingestion are untouched.
- Keep `window.HEALTH_ENGINE_LOCAL_CONFIG.enabled` absent/OFF in shipped Web;
  `HEALTH_ENGINE_LOCAL_ONLY=1` is a local host guard, not a production rollout switch.
  Never deploy the synthetic login issuer or put privileged credentials in the Web.
- Before any remote action, separately authorize the exact Supabase project/environment,
  the specific migration file/hash, real verified-auth/canonical mapping adapter,
  API deployment and Web flag target, and synthetic-only smoke write/delete identities.
  Current target identity is unspecified: remote execution remains unauthorized.
- Require actual Edge/runtime execution and real OAuth integration gates before activation.
  Windows/Python is not a product server dependency; ordinary local Deno is not Edge.
- Smoke scope: A/B/anonymous, expired/forged subject, raw body and meal CRUD/read-back,
  revision/replay/timeout, cancellation/tombstone, and no old score after deleted inputs.
  Rollback first disables the new route/flag and restores old UI/provider; retain new
  tables/receipts/data for investigation. No destructive table rollback is automated.
- No paid resources or external service added. Remote resource/cost expectations are
  UNKNOWN until the target runtime/environment is approved.

Photo model, food reference validity, new score validity, real Google OAuth, remote
Beta, Android OEM, iOS and production release remain independent open gates.

## 2026-09-12 blocker closure — current execution path

This section supersedes the earlier Python-host limitation below, without erasing its
historical evidence. Baseline `884ffa280e660f0bb749528bbcae7eeaea1151eb`; no original
score formula, golden fixture, CURRENT routing or pre-existing Android edit changed.

| Actual node | File / function |
|---|---|
| Existing meal UI | `index.html` meal handlers -> `scripts/local-engine-web.js:localEngineRequest` (local flag only) |
| HTTP | `scripts/local-engine-server.ts` -> `mobile-health-beta/index.ts:dispatchLocalEngine` -> `LocalEngineRuntime.handle` |
| Verified identity | `scripts/local-engine-auth.ts:createSyntheticAuthority` -> existing `authenticateNativeUser` / `resolveNativeIdentity` -> `beta_resolve_native_auth_identity` |
| Input / queue | `local-engine-runtime.ts:mutate` -> existing receipt/meal transaction / `engine_enqueue_meal`; canonical ingestion uses existing `beta_ingest_health_mutation` |
| Computation | `LocalEngineRuntime.compute` -> `engine-portable.ts:PortableEngineRuntime.execute` -> `computeDomainRequest` -> `aggregate`, `derive`, `domainOutputs` |
| Frozen formulas | Existing `fixtures/algorithm-golden/apps-script-health-score-v1.0.snapshot.js` functions; no duplicate formula implementation |
| Storage / return | Existing claim/generation/lease checks -> atomic history/head + original score bundle -> PG snapshot -> existing Web panel/meal form |
| Python | Reference/test-only `domain_runtime.py`, original package and differential fixture generator; no necessary application-path import or subprocess |
| Supabase CLI Edge execution | **BLOCKED / NOT EXECUTED** before handler startup: Docker engine pipe unavailable after backend socket-access failure |

Only aggregation, empty-catalog confirmed nutrition normalization, exact Python-style
mean/rounding and domain glue were ported. All score functions are reused. The parity
contract was written before differential execution; explicitly versioned JS JSON
fingerprints differ lexically from Python, with immutable history retained. Native PG
tests separately verify replay, revision sensitivity, tombstones and generation safety.

### Edge preparation is not an Edge PASS

CLI2.115.0 and host Deno2.9.6/V8 15.0/TS6.0.3 were recorded; no upgrade performed.
Actual Edge Runtime version is UNKNOWN because it never started. `functions serve
--help` was inspected before a bounded isolated-project serve attempt. No original
Supabase stack, migrations, outbound cron or remote worker was started. Docker4.88.1
reported `sailor-ingest.sock` system-access failure then shut down its engines. No
factory reset, socket removal, permission change, alternate daemon/tunnel or
substitute `deno run` evidence was used to claim Edge execution.

[Supabase local-runtime documentation](https://supabase.com/docs/guides/functions/development-environment)
distinguishes CLI Edge Runtime from ordinary Deno. [Official resource limits](https://supabase.com/docs/guides/functions/limits)
currently list256MB memory,2s CPU/request,150s/400s free/paid wall limits,150s request
idle limit and20MB CLI bundle (5MB server-created bundle). These are requirements,
not acceptance results. The frozen+portable source is57,684 raw bytes, not a built
Edge bundle. Host benchmark5000 synthetic records/28days measured215.70ms wall and
11,620,488-byte heap delta; neither is actual Edge CPU or peak-memory evidence.
Actual Edge bundle, resource, connection and Browser tests remain NOT_RUN.

### Reproduce / future enablement package

1. Use a reviewed official PostgreSQL18.6+ portable server. Set only the current
   shell's `LOCAL_ENGINE_PG_BIN`; harness verifies18.x>=18.6 before initdb, binds
   loopback and creates a new UUID cluster/database. Original18.4 and DBs stay intact.
2. Generate Python reference fixtures, run `deno test --config config/engine-local.deno.json
   --allow-read tests/engine-portable.test.ts`; then `node scripts/test-local-engine-native.mjs`
   and `node scripts/test-local-engine-http-run.mjs`. No Deno `--allow-run` is granted.
3. Browser runner requires existing `ENGINE_PLAYWRIGHT_MODULE` and
   `ENGINE_BROWSER_EXECUTABLE` absolute paths; run `node scripts/test-local-engine-browser.mjs`.
   It owns a fresh DB, once-only expected native dialogs, trace redaction and cleanup.
4. After Docker is repaired through authorized host administration, first run
   `node scripts/check-local-edge-resource.mjs`. This is a resource preflight only.
   Prepare/verify an isolated CLI function host with a dedicated local PG connection,
   same canonical identity adapter and portable engine; current loopback DB guard must
   not be broadened to arbitrary hosts. Run actual handler/auth/PG/resource tests and
   rerun the Browser workflow through that Edge host. Do not promote resource preflight
   or host Deno success into Edge PASS.
5. Any remote Beta enablement needs separate authorization for the named Beta project,
   additive migrations, server-side canonical mapping/grants, feature flags and deploy.
   No identity backfill, production auth merge or remote settings change is authorized.

Existing remote/default feature flags stay OFF. Rollback is disabling the local feature
flag and returning to existing Web routing; persisted versioned history remains intact.
No new cloud service/dependency is introduced. Future hosted resource/cost impact is
UNKNOWN until Edge measurement and current-plan review. Beta smoke must include real
OAuth, A/B/anonymous isolation, actual persistence/recompute and cancel/delete/reload;
synthetic signatures cannot establish real Google login. No remote operations performed.

## 2026-09-12 existing-runtime closure (supersedes activation claims below)

Source baseline: reachable ancestors `a3f02ea`, `64aeb3a`, `9cbd260` on
`codex/multi-domain-engine`, worktree `D:/Dev/Projects/web-health-companion-phase4a`.
The audit reads the actual commit diffs, not their reported test totals. The original
five tracked Android changes and untracked timeout test remain outside this track.
No checkout, cherry-pick, remote CI, push, deployment, account linking or backfill was performed.

### Before / after call graph

| Node | Baseline reality | Explicit local path now |
|---|---|---|
| Existing Web | `index.html:sessionPost`, `apiService`, meal form -> existing Apps Script API; new domains MISSING | same `index.html` form -> `scripts/local-engine-web.js:localEngineRequest`; loopback feature flag only |
| API | Python `engine_api.py:create_app` WSGI was test-callable, not mounted in existing app | `scripts/local-engine-server.ts` -> `mobile-health-beta/index.ts:dispatchLocalEngine` -> `local-engine-runtime.ts:LocalEngineRuntime.handle` |
| Verification | Beta `authenticateNativeUser` uses admin auth.getUser; Python callback was injected by tests | same native authentication function, backed locally by `local-engine-auth.ts:createSyntheticAuthority` ES256 signature/issuer/audience/expiry verification |
| Canonical mapping | `resolveNativeIdentity` -> `beta_resolve_native_auth_identity`; already exists | same function and SQL, seeded synthetic auth subject != canonical ID; absent mapping fails closed |
| Input / invalidation | engine_store.py SQLite path, no real app call | `LocalEngineRuntime.mutate` -> native PG `engine_meals` + receipt transaction -> `private.engine_enqueue_meal`; native health ingestion -> existing mutation function + opt-in rolling trigger |
| Worker | existing persistent Python JSONL infrastructure; new domains not connected | actual `beta_claim_score_recompute` -> `LocalEngineRuntime.compute` -> `PersistentPythonRuntimeAdapter.execute` -> `python-algorithm-worker.py` -> `domain_runtime.py:compute_domain_request` -> existing `aggregate_day`, `derived_metrics`, `DomainEngines.calculate` |
| Storage | proposed engine history/head schema; PGlite test only | native PG output history/head and original `beta_persist_score_bundle` in the same transaction, generation/lease checked before publish |
| Original scores | `score-bridge.ts:recomputeBetaScore` frozen eight-score bridge | unchanged computation, unchanged missing nutrition/training inputs; separate original `beta_health_scores` |
| Response / UI | new outputs MISSING from app | real PG snapshot -> existing meal list + experimental panel; `legacyTimeline` reads original persisted scores for existing overview; request receipts reconcile writes |
| Photo | perception adapter / fixtures only | MISSING model/weights/inference; local photo/handoff controls hidden, no fake success |

The local HTTP host calls the exported shared route dispatch, **not the production
`withSupabase` HTTP middleware**. It reuses the real native verification/mapping contract
and frozen queue/score functions. It does not claim a full local Supabase Auth stack.
The synthetic issuer verifies real signed tokens; it is not Google OAuth. No production
session, key or account is used. A/B isolation tests include the privileged write path
and low-privilege `authenticated` RLS reads. `service_role` has BYPASSRLS and is never a
frontend credential; its server SQL scopes exclusively to the verified canonical ID.

### Runtime choice and hard boundary

Actual local runtime: Deno 2.9.6 host + existing Python 3.12 persistent JSONL adapter +
native PostgreSQL 18.4. There is no second scoring implementation. Deno also executes
the unchanged JS score snapshot and compares all 28 original golden vectors against
the persistent Python worker exactly. Reference orchestration tests compare complete
domain bundles, including nulls, metrics, versions and timezone cases.

**SUPABASE_EDGE_DEPLOYABILITY = NOT_SUPPORTED_BY_THIS_HOST_ADAPTER.** A constrained
Edge worker cannot spawn this Python process. The Windows test host is not a formal
service dependency. Existing CURRENT policy is unchanged. Future options are a
runtime-compatible core port with exact differential tests, or an independently hosted
Python worker with explicit operations/security/cost review. Neither service nor public
tunnel has been enabled. This local proof does not close the remote target-runtime gate.

### Local database and migration rehearsal

`scripts/local-engine-postgres.mjs:createLocalPostgres` creates a unique
`health_engine_<uuid>` database in a new native cluster bound to 127.0.0.1 on 57483
(Web) or 57484 (tests). It never reads DATABASE_URL, existing secrets or tunnel config.
Each database manifest records server version/address/name and SHA256 of every migration.
Only synthetic accounts/records are seeded. The minimal `auth.users`, `auth.identities`
and `auth.uid()` compatibility schema is explicitly local; no OAuth server is imitated.

The migration chain is applied in filename order. The durable processor migration's
outbound pg_net/cron/vault authorizer/scheduler sections are omitted; real queue, lease,
generation and retry SQL is retained. Therefore this is **native PostgreSQL schema and
repository rehearsal**, not a complete Supabase deployment rehearsal. PGlite results
remain a separate legacy regression and are not evidence for native PostgreSQL Gate 3.

New proposal: `20260912041126_engine_local_runtime_integration.sql`, after existing
`20260912032458_multi_domain_engine_versioned_outputs.sql`. It adds meals, idempotent
receipts, mapped read policies, and bounded invalidation. No identity table replacement
or account merge exists. Health rolling invalidation needs the session setting
`health.engine.experimental=on`; absence leaves existing remote behavior unchanged.
Meal changes invalidate old/new dates and their necessary forward 27-day windows,
capped at current Asia/Taipei date. Snapshot/input limits are 28 days and 5,000 rows;
this is not an unbounded historical reporting service. Generic/DST attribution is tested
in the Python reference adapter; the local Web meal form is explicitly Asia/Taipei only.

Publish checks generation and lease inside the same transaction as both score stores.
Replay receipts cannot resurrect tombstones; stale revisions fail. Pending or failed
recompute surfaces STALE without rewriting historical payloads. Delete-all produces
INSUFFICIENT_DATA rather than promoting old valid scores. A job failure retains actual
queue retry state; test-only clock acceleration is disclosed separately from live HTTP.

### Enablement preparation — do not execute remotely

1. Local reproduction: `npm ci --ignore-scripts` (native PG binary optional, Windows x64
   harness); existing Python environment; `node scripts/start-local-engine-e2e.mjs`.
   Deno config/lock is isolated in `config/engine-local.deno.*` so the pre-existing
   untracked Beta `deno.lock` is not included in this delivery. Browser URL is
   `http://127.0.0.1:57841/`, synthetic A/B only. No external CDN/OAuth requests allowed.
2. Native tests: `node scripts/test-local-engine-native.mjs`; HTTP tests require that
   local host: `node --test tests/local-engine-http.test.mjs`. Logs are captured by
   `scripts/run-engine-evidence.ps1`, including command, source hash, UTC start/end and exit.
3. Defaults: Web flag absent/OFF; `HEALTH_ENGINE_LOCAL_ONLY` absent/OFF; registration
   rejects nonlocal settings/hosts. Disable flags and stop the dedicated host to restore
   the original Web/API route. Do not delete remote tables as a rollback shortcut.
4. Future Beta requires separately approving the exact target project/environment,
   runtime architecture, provider/token verification path, staged migration apply,
   feature flag enablement, smoke accounts and rollback plan. **None approved here.**
   Production requires another independent authorization and data/backup review.
5. Native smoke: A create -> receipt replay -> stored nutrition version -> frozen score
   unchanged -> B denied -> update -> stale revision denied -> delete -> null latest.
   Browser smoke must also complete the blocked confirmation/reload path before claiming
   the complete Web Gate. See ENGINE_TEST_REPORT.md.
6. Paid resources added: 0. Local processes use existing CPU/RAM/disk; no remote service
   estimate is justified before architecture choice. Expected remote cost = UNKNOWN.
   No permanent power, sleep, security-policy, permission or secret changes were made.

Independent gates remain: PHOTO_MODEL_IMPLEMENTATION, PHOTO_REFERENCE_DATA_VALIDATION,
DOMAIN_SCORE_VALIDITY, REMOTE_BETA_INTEGRATION, ANDROID_REAL_DEVICE_E2E,
IOS_BUILD_AND_DEVICE, PRODUCTION_RELEASE. None is removed or counted as complete.

## Stage 0 audit

Audit base: `codex/phase-4a-tester-access`, HEAD `64bf2e33e4889d4fedd91de429ddb7da09bac411`.
The pre-existing five tracked Android beta.12 changes and untracked timeout test are outside this engine track. They must not be committed with engine work.

| Area | State before this track | Existing implementation / extension point |
|---|---|---|
| NUTRITION_MODEL | PARTIAL | HDL v2 `meals`, `meal_items` proposal; legacy confirmed meal flow |
| NUTRITION_ENGINE | PARTIAL | Python `HealthScoreEngine.score_nutrition` scores provided nutrients, does not resolve food references |
| FOOD_DATABASE | PARTIAL | `foods`, `food_aliases`, `nutrition_sources` in schema design; no verified offline catalog bundled |
| PHOTO_FOOD_FLOW | EXISTS | Web ChatGPT handoff + user confirmation; not an authoritative nutrient reference |
| SLEEP_ENGINE | EXISTS | Frozen Python / Apps Script duration, stages, continuity, regularity components |
| ACTIVITY_ENGINE | EXISTS | Frozen steps + energy/baseline formula |
| CARDIO_ENGINE | PARTIAL | RHR/HRV inputs in recovery; no independent cardiovascular contract |
| BODY_ENGINE | EXISTS | Frozen weight/fat mass/goal/baseline components |
| RECOVERY_ENGINE | EXISTS | Frozen HRV/RHR/sleep/training/subjective components |
| HEALTH_SCORE_V1 | EXISTS | Frozen Python engine + Apps Script snapshot; 28 golden fixtures |
| AGGREGATION | PARTIAL | Beta `score-bridge.ts` bounded assembly; no common materialized daily contract |
| RECOMPUTE | EXISTS | Beta dirty queue, lease/generation, bounded input reads and atomic score bundles |
| ENGINE_VERSIONING | PARTIAL | Existing outputs carry health-score-v1.0; independent domain history not integrated |
| DATA_COMPLETENESS | EXISTS | AlgorithmResult completeness 0..1; missing != measured zero |
| CONFIDENCE | PARTIAL | LOW/MEDIUM/HIGH coverage categories, unknown device quality |
| TEST_FIXTURES | EXISTS | 28 Apps Script/Python golden cases; Node runtime/Beta/queue contracts |

STAGE_0_AUDIT = PASS. Existing formulas and CURRENT routing remain frozen. This track extends the same Python package with normalization, aggregation, versioned orchestration and local storage; it does not fork the frozen formula implementation.

## Execution boundary

Canonical records → indexed daily aggregates → derived metrics → domain adapters → domain outputs → existing overall formula. Recovery consumes sleep/activity evidence, never overall. Cardiovascular is an explanatory personal-baseline adapter, not a diagnosis and not a new weight in health-score-v1.0.

No production activation, cloud deployment, paid model, or production migration is authorized. New score versions are development policies validated on synthetic fixtures only. Food reference coverage and real-world accuracy remain unvalidated. The existing Android runtime failure remains a separate outstanding real-device gate.

## Contracts and responsibilities

`domain_contracts.py` provides strict typed canonical records, daily aggregates and domain outputs. Completeness is always 0..1, scores/components 0..100. Missing scores remain null; measured zero remains zero. VALID, PARTIAL_DATA, INSUFFICIENT_DATA, STALE and ERROR are distinct. Every output includes version, confidence, missing fields, source quality, metrics, explanations, recompute reason, timestamp and input fingerprint. Staleness is an explicit caller policy, not inferred merely because a historical date is old.

`nutrition.py` separates perception from arithmetic. The perception protocol returns candidates, portions and uncertainty, never authoritative calories. The supplied fixture adapter is synthetic, not a deployed vision model. Caller-supplied food references carry preparation, aliases, units, provenance and version. Matching requires unambiguous identity and exact preparation; there are no invented cooking conversion factors. Confirmed manual totals may be used. Model-provided nutrient totals are ignored. Reference values scale by measured/estimated grams; serving sizes must be supplied. Ranges propagate and reduce quality. Unknown items make affected daily totals null while known subtotals remain separately available. There is no verified food catalog or micronutrient reference coverage bundled with this change.

`aggregation.py` reconciles revisions and tombstones by user/source/domain/record ID, rejects conflicting equal revisions and splits additive intervals across timezone-aware days. Sleep uses interval union and wake-date attribution, not a longest-session assumption. DST day length is respected. Incompatible units, invalid values and ambiguous overlapping vendors are flagged/excluded, not fabricated. Prorated interval data is marked estimated. Device/source quality is conservative and is not a calibrated clinical probability.

Derived metrics use observed daily values, not missing-as-zero. Windows include 7/28-day means, counts, trends, previous-only baselines, nutrition nutrient averages, active-day frequency and circular bedtime variability. Sleep efficiency/stages, subjective readiness, VO2 max and additional body metrics are unavailable unless supported by actual input; their absence is not repaired by invented values.

`domain_engines.py` adapts these contracts to the existing frozen `HealthScoreEngine`. Generic nutrition label targets are a scoring policy, not personal dietary advice. Fiber/sodium are explanatory components and do not change the frozen nutrition weighting. Cardiovascular is a personal RHR/HRV baseline indicator, not a clinical cardiovascular-risk score. Overall uses exactly the existing six inputs and weights; cardio receives no additional weight. Missing training remains missing. Legacy raw components that can exceed 100 are retained in metrics; displayed components are bounded without changing the frozen score.

## Storage and bounded recomputation

`engine_store.py` is the executable local SQLite integration. Canonical updates, record/date projection, daily/derived outputs, versioned score history and heads are committed in one transaction. Equal replay makes no changes; older revisions are ignored; a failure rolls back canonical data and output writes together. Subject timezone is persisted and cannot silently change: a future explicit projection migration is required for timezone changes.

Create/update/delete/moved-date corrections invalidate old and new affected dates and their following 27 days, capped by the requested through-date. The dependency DAG is cycle checked. The implementation conservatively regenerates the complete seven-score bundle for each affected date, rather than attempting component-level selective recomputation. It does not rescan all users or full raw history. Ingest accepts at most 5,000 records; intervals are bounded to 32 local dates; explicit recompute accepts at most 366 dates and fails closed if the required aggregate read exceeds its 425-day bound. Domain API reads are limited to 28 days and use one indexed join. Initial historical import still scales with imported days; it is not a constant-time operation.

History keys are `(user, date, kind, version, fingerprint)`; heads point to an immutable output. Version changes append alongside old versions, not overwrite their meaning. Repeated identical computation reuses the same history identity. Caller-provided references/targets are fingerprinted with the input evidence.

Read-only Beta inspection found existing `public.beta_health_records`, `public.beta_health_scores` and `private.beta_score_recompute_queue`. No new remote tables were created. The SQL migration is an additive proposal for history/heads only. PostgreSQL RLS defaults to deny for authenticated users until the existing canonical identity resolver is explicitly wired; `auth.uid()` is NOT assumed to equal the application user ID. Service-role history is insert/read only. Production transactions, identity policies and rollout remain subject to a separate authorized integration gate. PGlite tests cover the actual proposal, but are not evidence of deployed Supabase compatibility.

## API and frontend boundary

`engine_api.py` is an opt-in WSGI handler with a mandatory injected authentication callback. It does not open a listener or trust a client-supplied user ID. GET `/v1/engine/domain-scores/{domain}?start=YYYY-MM-DD&end=YYYY-MM-DD&version=...` returns score, status, confidence, completeness, version, component scores, missing fields and updated time. Invalid/unbounded ranges and duplicate parameters are rejected. Responses are private/no-store. The host must validate sessions and provide its trusted canonical subject; no default authentication is supplied.

`scripts/domain-score-response.cjs` is the frontend response adapter: zero renders as zero, null as an em dash, with distinct stale/error states. Neither this API nor adapter is mounted into existing Beta/Web CURRENT routing. End-to-end deployed ingestion → engine → UI remains a separate activation gate, not claimed complete here.

## Deferred physical-device utility

`scripts/android-real-device-gate.ps1` provides a bounded observation window with structured JSON. It does not install an APK, clear data, press Sync, force WorkManager or toggle networks. Default invocation never starts the app; `-StartApp` explicitly requests startup, which is not proof of a new work request. It reads only allowlisted runtime metadata and checkpoint presence and does not print credential stores.

The utility deliberately cannot declare HTTP, ingestion, engine recompute or score-update PASS from metadata alone. Full WorkInfo correlation, HTTP duration, backend ingestion and app score presentation need actual device/backend evidence plus the outstanding Android runtime/instrumentation work. This is an evidence-capture foundation, not a completed one-command end-to-end physical gate. Testing a nonexistent ADB path only verifies its fail-closed branch and does not establish whether a phone is currently connected.

## Reproduction

Use Python 3.12 with the project dev dependencies. Run `python -m pytest tests_python -q`, `node --test tests/*.test.cjs` (set `ALGORITHM_PYTHON` to that interpreter), `npm ci --ignore-scripts`, `npm run test:engine-db`, and `python -m scripts.benchmark_domain_engines`. The new GitHub workflow reproduces the targeted domain/property/frozen-formula, PostgreSQL and frontend gates; remote CI execution itself is not claimed. See ENGINE_TEST_REPORT.md and ENGINE_VERSION_MATRIX.md for measured scope and policy versions.
