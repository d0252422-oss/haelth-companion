# Health Data Layer v2 — M1 Isolated Staging Rehearsal

Date: 2026-08-25  
Status: **PLAN ONLY — NOT EXECUTED**

## Safety boundary

Use a disposable local database or isolated staging project with a project/ref/host that is explicitly different from production. A schema prefix inside the production database is not isolation and is prohibited. The disposable database must contain a controlled V1 schema clone because the draft intentionally extends existing `public` tables. Before any mutation, the runner must assert an approved staging environment marker and database identity; mismatch fails closed. Use de-identified or synthetic fixtures only. Production credentials, database links, Script Properties, Sheets and deployments are prohibited. Capture pre-run schema/data checksums and unrelated sentinel rows.

Each migration attempt receives a unique `ingestion_id`, immutable external run manifest, transformation version and dataset fingerprint. An exact transport retry reuses the same source idempotency key and must converge on the original ingestion event; a deliberate new migration attempt over the same dataset gets a new idempotency key and a new ingestion ID while deduplication prevents duplicate facts. Disposable M1 cleanup may remove the staging ingestion row to restore the exact pre-run checksum, but the external manifest retains its identity and checksum. A future production rollback must preserve the database ingestion event and move its lifecycle to `ROLLED_BACK` rather than erase audit evidence.

## Representative dataset

Minimum fixture window: 45 consecutive days spanning a UTC month boundary, local day boundary and wake-date boundary. Include:

- scalar health samples, sleep intervals/stages, daily activity and body measurements;
- nutrition, confirmed/unconfirmed meals, meal items, workouts, exercises and sets;
- DRAFT/ACTIVE/SUPERSEDED scores and AI-derived records with model/prompt/schema/input identities;
- active and soft-deleted facts;
- manual, legacy Sheet, Health Connect, wearable, import and AI/system-derived sources;
- explicit UTC/offset values, inferred local times, ambiguous times and date-only values;
- exact replay duplicates, source updates, same-time different-source samples and hash-version fixtures;
- one user with multiple verified identities, collision/quarantine candidates, legacy-only user, blank-owner records and cross-owner attack fixtures;
- user-declared device, source-attributed device, phone-only bridge identity and unknown device;
- late-arriving facts that cross summary watermarks.

Never use a fixed four-hour sleep cutoff. Include a valid very-short sleep record and prove it survives ingestion. Do not invent capacity limits or activate a second activity truth source.

## M1 stages

| Stage | Action | Required evidence / pass condition |
|---|---|---|
| M1-A | Create isolated V1 clone plus V2 schema in a disposable database | Environment assertions pass; production unreachable; draft compiles; every fixture UTC month plus the next operational month is pre-created and hardened; default partition count remains zero |
| M1-B | Import representative legacy dataset with dedicated `ingestion_id` | Every inserted batch row links to the run; rejects/ambiguities are retained in manifest/quarantine |
| M1-C | Validate identity mappings | Unique provider subjects; zero silent merge; collisions/blank owners quarantined; zero orphans |
| M1-D | Validate sample fingerprints/deduplication | Versioned SHA-256 golden fixtures pass; replay converges; no unexpected duplicate fingerprint |
| M1-E | Validate ownership | Composite FKs reject cross-user meal/workout/exercise/AI links; RLS and grants deny cross-user access |
| M1-E2 | Validate sync cursor isolation | The same user/record type retains independent cursors for two sources and two devices; compare-and-swap rejects an older cursor version; retry/error state on one cursor cannot overwrite another |
| M1-F | Recompute summaries via durable queue | Lease/retry/expiry/lost-worker tests pass; source-generation compare-and-swap rejects a late worker; watermark advances; stale becomes fresh only after success |
| M1-G | Recompute/import scores | Publication rules pass; one intended ACTIVE result per scoring context/version; evidence fingerprints match |
| M1-H | Validate dashboard | Selected metrics match approved legacy projection; deleted rows excluded; body/source/freshness explicit |
| M1-I | Roll back by `ingestion_id` | All run-created rows removed in dependency order; pre-run checksum restored; unrelated sentinels unchanged |
| M1-J | Re-run identical logical migration with a new run ID | Outputs/fingerprints converge; no unintended active duplicates; second rollback also succeeds |

## Machine-verifiable reconciliation

For every entity/domain, emit this manifest:

```text
source_count
migrated_count
skipped_count
deduplicated_count
invalid_count
ambiguous_count
explicitly_unresolved_count
```

Required invariant:

```text
source_count = migrated_count + skipped_count + deduplicated_count
             + invalid_count + ambiguous_count + explicitly_unresolved_count
```

Every source row has exactly one terminal classification. Any mismatch, double classification, untraceable target row or missing quarantine reason fails M1.

Additional assertions:

- Identity: zero orphan/cross-owner references; zero provider-subject collisions outside quarantine.
- Raw samples: no unexpected duplicate fingerprints; source updates remain traceable; short sleep is preserved.
- Time: no silent conversion; classification totals equal source time-bearing rows; original evidence retained.
- Soft delete: deleted facts never appear in normal dashboard reads but remain auditable.
- Scores: at most one intended ACTIVE score for `(user, date, scoring context/version)`.
- Freshness: affected summaries become stale on fact change and fresh only after successful matching-watermark recomputation.
- AI: the same model/prompt/schema/relevant-input identity cannot create unintended duplicate active results.
- Dashboard: field-level parity uses explicit tolerance rules; missing/ambiguous states are not coerced to zero.

## Rollback design

M1 records a target manifest of table, primary key, user and `ingestion_id`. In the isolated staging database only:

1. assert environment/database/run ID and freeze the rehearsal worker;
2. count and checksum all target rows for the run;
3. delete run-owned children before parents, always constrained by the exact `ingestion_id` (or manifest IDs for a table that cannot yet carry it);
4. delete the run's queue/quality/derived artifacts, then the ingestion event;
5. compare table counts/checksums with the pre-run snapshot and verify unrelated sentinels;
6. fail if any run-owned row remains or any unrelated row changed.

The implementation should run the destructive portion in a transaction where supported, first exercise it with `ROLLBACK`, then perform the isolated committed rollback and re-verify. This process is never valid against production.

## Go / No-Go after M1

Production migration remains `NO` unless every item passes and human approval is recorded:

- Phase 2C architecture approved; BLOCKER/HIGH = 0.
- Identity, timezone and Health Connect source-identity behavior validated.
- Sheet formula/range dependencies and Script Property key-name inventory complete.
- Plaintext secret logging remediated in the deployable source.
- Row reconciliation, dashboard parity, RLS/grants, ownership and freshness pass.
- Rollback and rerun idempotency pass.
- Zero orphan ownership and unintended duplicate samples.
- Human production approval is separately recorded.

Any failed or missing check sets `READY_FOR_PRODUCTION_MIGRATION=NO`.

## M1 entry gate

- Human architecture/M1 checklist completed: **PENDING**
- Disposable staging target created and independently verified: **PENDING**
- De-identified fixture manifest reviewed: **PENDING**
- Production credentials absent from runner: **PENDING**

`M1_STAGING_REHEARSAL_PLAN_READY=YES`
`READY_TO_EXECUTE_M1_STAGING_REHEARSAL=NO`
`READY_FOR_PRODUCTION_MIGRATION=NO`
