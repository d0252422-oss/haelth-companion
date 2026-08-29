# Beta score bridge and tester entry

## Safety boundary

- Production project ref: `vptqedxdxfoohbqctujf` (identification only).
- Beta project ref: `uavimjgccigpbwqmfkhh` (the only migration/function/data target).
- Beta HTTPS runtime: `https://uavimjgccigpbwqmfkhh.supabase.co/functions/v1/mobile-health-beta`.
- Beta tester entry: `https://d0252422-oss.github.io/health-companion-beta/`.
- Production Pages, Supabase, Apps Script code, and production data are not deployment targets for this gate.

The Beta entry uses the existing Apps Script session endpoint only to verify an existing user identity. It contains no production mutation UI. Health connector claims, health evidence, connector status, and scores are routed exclusively to the Beta Supabase project.

## Frozen score runtime

The Beta Edge function executes the exact formula snapshot in
`fixtures/algorithm-golden/apps-script-health-score-v1.0.snapshot.js`. The added
`HEALTH_SCORE_V1_RUNTIME` export is transport wiring only; formula bodies,
weights, missing-data behavior, completeness, and confidence semantics remain
unchanged.

Pipeline:

```text
Android Health Connect / iOS Shortcut
  -> authenticated mobile-health-beta Edge function
  -> active HDL v2 beta_health_records
  -> bounded daily input assembler
  -> frozen health-score-v1.0
  -> beta_health_scores
  -> authenticated GET /v1/scores/daily
  -> isolated Beta tester entry
```

The assembler does not convert missing evidence to zero. Training and nutrition
remain `NO_DATA` until canonical evidence is supported. Current personal
baseline preparation is limited to the frozen contract's existing 28-day
resting-heart-rate, HRV, and weight inputs. There is no self-learning, weight
mutation, or model training.

## Recompute and storage

- A record create, update, or tombstone increments the affected date's
  recompute generation. A source update that moves dates marks both its old and
  new dates dirty.
- The Edge function recomputes at most 31 dates per request and reads at most
  5,000 active rows over the current/prior window.
- A deterministic input fingerprint covers the user, date, algorithm version,
  and active source identities/revisions/content hashes.
- The unique identity is user + date + score type + algorithm version.
- An unchanged fingerprint produces no score-row update.
- A stale generation cannot persist over newer input.

## Access model

- Direct `anon` access to health records, derived scores, and connector status
  is denied by grants plus RLS default deny.
- Edge reads derive canonical user ownership from the verified web session.
- Helper/Shortcut ingestion derives user ownership from a hashed, revocable,
  Beta-scoped app session. Client-supplied cross-user IDs are rejected.
- Public site configuration includes URLs and versions only. It includes no
  service-role key, refresh token, bearer token, or claim.

## Evidence

- 28/28 frozen score fixtures execute through the Beta Edge runtime export with
  exact expected results.
- Beta-only remote SQL transaction validates dirty generation, 8-domain bundle
  persistence, idempotency, and cross-user isolation, then rolls back.
- A live sanitized Beta smoke test validates Android and iOS Edge ingestion,
  replay rejection/deduplication, cross-user rejection, automatic score
  persistence, and test-data cleanup.
- Direct anonymous REST reads/writes and unauthenticated score API reads are
  rejected.

This is integration evidence, not real-device health evidence. Android is ready
for the next real-device gate once the published Beta page is verified live.
iOS remains blocked only on creation of the human-generated iCloud Shortcut
share link.
