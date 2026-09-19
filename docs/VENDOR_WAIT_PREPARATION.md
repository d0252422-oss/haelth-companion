# Vendor-wait preparation

Phase: `VENDOR_WAIT_PARALLEL_PREPARATION`. No remote operation is part of this run.
Both existing Beta and empty probe remain below the approved hosted PG floor.
Previously accepted local SQL/RLS/worker gates remain accepted; no vendor searches
or full product suites are repeated.

## One-command cutover package and dry-run

From the canonical D repository:

```powershell
./scripts/beta-cutover-package.ps1 -OutputDirectory D:/Dev/Evidence/<new-unique-directory> -ProjectRef dsdfacbjaicdcwayhhil
```

The command prepares a hash-verified AB source candidate, exact migration inventory,
roles/settings names, deployment argument templates, proposed Web config overlay,
rollback decisions and a fail-closed preflight report. It uses no credentials or
network. It refuses an existing output directory and unapproved targets. The source
candidate stays OFF; the proposed SQL-first overlay is separate and unapplied.
Regenerate after committing reviewed source so its revision and bytes agree.

This is **one-command offline preparation**, not a live deployment executor.
`PREPARED_DRY_RUN_ONLY` does not mean remote-ready. No `-Execute` switch is provided.
Attestation templates intentionally contain NOT_ATTESTED; they do not revoke prior
PASS evidence or conditional Owner authorization. Import verified evidence into an
operation-specific review before mutation, never replace UNKNOWN with assumed PASS.

The old preflight omitted the delegated-worker successor and only accepted old Beta.
It now distinguishes ten incremental migrations from all26 fresh-project migrations,
requires fresh-schema rehearsal for the probe, rejects the observed17.6 version even
if other status strings claim PASS, and explicitly requires PG security/Edge rollback.
Unknown targets, production and inherited JavaScript object keys fail closed.

Migration inventory is not a SQL safety parser. Historical statements/function bodies
need review; never `db push` the whole directory because it is present in the package.
The native PG harness omits unavailable pg_cron/pg_net/vault scheduler sections, so
its previous PASS is not exact full Supabase fresh-project rehearsal. A supported
platform rehearsal and current missing-version/schema comparison remain required.

## Deployment and rollback commands

Pinned D CLI2.117.0 `functions deploy --help` and `secrets set --help` confirm the
generated argument names. Commands were checked as syntax only, never executed.
The deployment command includes the exact function and project ref, no `--prune`.
Secrets use a private reviewed env file outside the package; no values are bundled.
The existing custom-session handler requires its reviewed verify_jwt=false config;
this does not remove the auth smoke requirement.

Old Beta Edge exact-source rollback remains accepted from prior official export.
The new empty probe has no previous Edge deployment: its rollback command is null,
not an old-project redeploy accidentally pointed at the probe. On first-deploy failure,
keep the current Web entry/provider unchanged and retain new SQL data. Frontend
recovery source53736e6 exists, but its live deployed artifact/recovery has not been
verified; this remains explicit. No DB down migration or data destruction is allowed.

## A/B and remote E2E review

The four-step `BETA_AB_OAUTH_OWNER_RUNBOOK.md` remains valid after platform/config
gates: separate normal A/B contexts, no token/password export, normal logout/revoke.
Do not activate OAuth now. Confirm the current Beta entry and candidate API target
before either session is used.

`beta-remote-read-smoke.mjs` provides an importable normal-browser-session adapter:

```javascript
await runReadSmoke({pages: {A: pageA, B: pageB}, projectRef: verifiedBetaRef, date});
```

It rechecks exact frontend path and hosted SQL endpoint before requests, uses the
existing in-page transport without extracting credentials, checks separate canonical
identities and12 critical read response shapes, and requires the exact identity-
forgery denial. Network/service errors are not accepted as isolation evidence.
It performs no writes/cleanup and does not prove row isolation, CRUD or persistence.
The module was boundary-tested locally; no hosted request/session was run here.

The full manual CRUD/SQL/browser runners intentionally enforce loopback synthetic
PG. They MUST NOT be repointed at hosted Beta. Legacy `verify-beta-score-live.ps1`
uses fixed connector record IDs and is not a seven-domain manual CRUD executor.
The generated remote E2E contract lists all seven domains, <=24 raw rows, <=80
mutations, same-run UUID/ownership manifest, A/B isolation, reload and cache checks.
The live write adapter/receipt-backed cleanup must be bound to actual dedicated
sessions and reviewed schema before remote execution. This remains preparation,
not a claimed completed remote E2E script or a promise of zero further validation.

## Connector preparation

Android's existing bounded collector now describes its counter as mixed WorkManager
attempt/completed-batch progress. Retry acceptance requires correlated WorkInfo and
per-request receipts; the counter alone cannot prove automatic retry. Existing dirty
Kotlin/Gradle changes are preserved. Offline collector tests use fake child processes,
never ADB. Device execution stays DEFERRED.

iOS manifest now declares the old Beta project ref explicitly; the offline validator
rejects arbitrary/prod/probe hosts, ports and ref mismatches. Spec/gate output includes
the exact endpoint and NOT_REVALIDATED/DEFERRED state. The frozen five-window spec,
partial/empty/retry fixtures are reused. No importable Shortcut or real-device PASS
is inferred. Web cutover must not silently retarget either connector.

## Product hardening and deferred items

Body-date clearing/invalid/future values now invalidate old record bindings before
returning. Delete checks the current user/date/record and locks conflicting controls.
Late save/delete completion cannot close or unlock a subsequently opened editor.
An acknowledged same-account write still invalidates body/dashboard caches even
after the editor changes; late failures and account/epoch changes do not invalidate
the new user's cache. Background refresh rechecks identity across awaits.
Shared overlays move/contain/restore keyboard focus, handle Escape, and preserve
the original opener when switching quick-sheet views. Focused browser tests cover
quick sheet, date range and trend settings at393x852; native training-dialog/nested
overlay interactions were reviewed but are not new browser acceptance claims.

Static query review found existing user/date bounds and indexes for manual domains.
Connector-scale `affected_local_dates && ...` scans may need a GIN index, but no
EXPLAIN evidence exists yet. Defer that decision to a representative synthetic
connector-history benchmark; no speculative migration or performance claim here.

`PHOTO_NUTRITION_OPEN_DATA_BOOTSTRAP.md` already covers the requested sources,
licenses/provenance, normalization, nulls, Taiwan aliases, portion uncertainty and
benchmark boundaries. Reuse it; no dataset download, model training or rollout.

Progress denominator/weights unchanged: overallUNKNOWN, provisional32.0%, +0.0pp.
