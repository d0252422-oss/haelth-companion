# Training engine inventory and contract — 2026-10-03

Status: **inventory PASS; recommendation model not specified or released**. This is a local contract review, not a new formula or Production change.

## Existing inputs

`public.manual_workout_sets` stores canonical owner, `record_id`, `exercise_id`, `session_id`, local date, positive revision, soft-deletion, JSON body and update time. The runtime validates one set's weight (0–1000) and reps (1–10000), derives `totalVolume = weight × reps`, and reads up to 5000 sets in a bounded range. Set order and duration are present in the manual read model. `manual_exercise_catalog` and `manual_exercise_body_parts` provide system/user exercise and body-part identities, including stable canonical system keys; user aliases and archive state are preferences, not new exercise identities. The API keeps owner scoping, mutation receipts and revisions.

The existing frozen score engine accepts optional `training_load`, `training_load_baseline`, `acute_load`, `chronic_load`, `consecutive_training_days` and `baseline_sample_count`; recovery score also accepts `training_recovery_score`. These inputs are **not** automatically equivalent to set volume. There is no validated conversion from manual sets, muscle distribution or duration into acute/chronic load in this inventory.

## Proposed input contract boundary (not yet implemented)

An engine input bundle must be owner-scoped and versioned, with `session_id`, `record_id`, `exercise_id`, body-part key, local date/timezone, set order, reps, load plus explicit load unit, duration (if source has it), source/revision and deletion state. Missing units, duration, muscle taxonomy, recovery inputs and baseline coverage remain null/unknown. Multiple sets in a session may contribute volume, but session duration is counted once, as the current read model does. Duplicate/replayed set revisions must not increase volume. Custom body parts retain user ownership; archived aliases do not erase historical records.

## Proposed output contract boundary (not yet implemented)

A future engine may emit dated per-exercise/per-body-part sets, reps and volume with provenance, coverage, calculation version and missing-input reasons. Any load trend, recovery estimate or recommendation must carry a separate algorithm version and validation status; it must not be presented as a final prescription based only on volume. Existing `score_training` remains frozen and is not silently retuned here. A no-data period is `NO_DATA`, never fabricated zero volume or a guessed score.

Versioning should distinguish input schema, source taxonomy, aggregation method and recommendation algorithm. Changing one must not silently overwrite old published outputs; preserve revision and input fingerprint for reproducibility. Cross-user isolation and soft-deleted set handling are mandatory acceptance checks before any live release.

Next phase: approve an engine input/output schema with representative unit-bearing fixtures, define measured load and recovery sources, then test deterministic aggregation and versioned replay. No production import, migration or deployment is authorized by this inventory.
