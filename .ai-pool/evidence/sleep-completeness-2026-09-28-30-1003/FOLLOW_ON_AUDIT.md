# Autonomous offline queue: bounded follow-on audit

## 1. Background sync finalization — OPEN

The 2026-10-03 07:54 UTC `PERIODIC_WORKER` receipt persisted one 100-record batch, but the Beta connector `last_success_at` stayed at 2026-10-02 14:05:55.735 UTC. A batch receipt is not whole-run completion.

Code path in `BackgroundHealthSync.kt`: read all domains -> upload all batches -> check `read.isPartial` and `uploadSummary.reconciliationPending` -> report `SYNCED` or `SYNCED_PARTIAL` -> only after a durable complete result save the local last-success cursor and clear the checkpoint. `IngestionClient.kt` advances a batch checkpoint only after a successful HTTP upload. This is correct failure safety, but server-side receipts alone cannot determine whether the 10/03 worker then hit a capped/failed read, a later batch error, a retry, deadline, or status-report error. There is no correlated worker terminal state available without post-window device diagnostics. The empty-page-token and bounded sleep replay fixes address plausible completeness risks, not a proven finalization root cause. Do not mark PASS.

Next evidence needed: worker ID/flow ID, `WORK_STATE`, per-domain read `failedDomains`/`cappedDomains`, batch index/total, terminal result, checkpoint and last-success before/after. Use existing diagnostics; do not re-open the closed 401 investigation. If a future full periodic run succeeds, require exactly one cursor advance. A failed run must leave the full-run cursor unchanged; only accepted batches may move the batch checkpoint.

## 2. Health Score recompute — OPEN

Read-only Beta queue showed `FAILED / WORKER_RECOMPUTE_FAILED` for 09/27, 09/28, 10/02 and 10/03; 09/29 had a published available score. The failed dates have `engine_published_generation` behind their queue generation. `WORKER_RECOMPUTE_FAILED` is a deliberately generic allowlisted fallback: it does not identify input assembler, engine compute, portable publication, frozen score, or persistence. Current `scoreErrorCode` already recognizes stage-specific codes, but the actual worker exception was not available from read-only logs. The first failing stage and exact root cause remain **UNKNOWN**. No formula was changed.

Next safe check: obtain scoped worker log/diagnostic or reproduce in an isolated supported PostgreSQL database with synthetic inputs, then add an allowlisted stage marker without raw exception, SQL text, credentials, or health payload. Do not label missing sleep as the cause of these generic errors; 09/30 lacked raw sleep but its queue completed.

2026-10-03 offline follow-on: the current Android candidate branch now tags
input assembly, portable engine computation, engine publication, and frozen
score bridge failures without changing the original exception or score formula.
The scheduled worker emits only `failure_stage`, an allowlisted `reason_code`,
allowlisted `exception_class`, and `input_date`; it never prints the raw cause.
The existing `STALE_SCORE_INPUT` lease behavior remains intact. Three targeted
Deno tests passed, including secret-like error text absence from serialized
diagnostics. This diagnostic code has **not** been deployed, and the four live
date-specific root causes remain UNKNOWN. Full local PostgreSQL worker
integration was not rerun because its dedicated 57484 test cluster is not
available in this task; the sleep replay cluster on 57485 is a separate scope.

## 3. Authenticated Web acceptance preparation — READY, live step BLOCKED_HUMAN

Checklist: `docs/BETA_SLEEP_WEB_ACCEPTANCE_20261003.md`. The local readback fixture verifies metric availability remains separate from score failure. No current authenticated login was performed and no live Beta Web acceptance was claimed.

## 4. Performance baseline — OPEN by stated prerequisites

The requested baseline is gated on offline sleep root cause confirmation, background finalization correction and Health Score first-stage identification. Those conditions are not all met. No speculative UX rewrite or performance optimization was started.

## 5. Food engine Phase 1 — OPEN

The exact requested `FOOD_DATA_SOURCE_MANIFEST_v0.1.md` and `food_data_sources_v0.1.yaml` are absent from this checkout. Existing `docs/PHOTO_NUTRITION_OPEN_DATA_BOOTSTRAP.md` contains a metadata-only primary-source inventory for TFDA, USDA, Open Food Facts and Nutrition5k, with snapshot hashes/versions unverified. Existing `health_companion_algorithms/nutrition.py` has `FoodReference` and deterministic per-100g arithmetic; the Edge portable runtime has an empty catalog. Before adapters can be called PASS, define immutable source snapshot/version/provenance and synthetic fixtures, then validate each source's units and license boundary. No remote data import or invented nutrient values occurred.

## 6. Training engine inventory — see standalone contract

`docs/TRAINING_ENGINE_INPUT_OUTPUT_CONTRACT_20261003.md` records existing manual sets, exercise taxonomy, current score inputs and versioning boundary. It is not a new recommendation formula.
