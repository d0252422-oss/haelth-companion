# Beta Edge rollback — PARTIAL, not deploy-ready

## Security/provenance decision — health-security-20260917-075734

Current authoritative status: EDGE_ROLLBACK_READY=BLOCKED_NO_TRUSTED_SOURCE.
Fresh v14 metadata matches the prior digest. Independent Git/CI inventory found a
probable Sep3 source revision but no binding to deployed bytes; no Edge CI artifact.
See BETA_EDGE_DEPLOYED_STATE.md and BETA_EDGE_ROLLBACK_SOURCE_INVENTORY.md.
ROLLBACK_MODE=UNRESOLVED; OFFLINE_REHEARSAL=NOT_RUN_UNTRUSTED_SOURCE.
The older statuses below are historical, not concurrent PASS claims. No download
security bypass, normalized artifact, remote deployment or database change occurred.

## Critical-path revalidation — 2026-09-17

Fresh remote metadata still reports mobile-health-beta v14 ACTIVE and the same
ezbr digest below. CLI2.117.0 documented `functions download --use-api` was tried
once in a new D-only root; it again refused the external frozen-fixture path.
Tagged CLI source confirms the containment check. No alternate extractor, unsafe
path flag or legacy implementation was used to evade this security refusal.

`D:/Dev/Evidence/beta-edge-rollback/health-critical-20260917-065444/manifest.json`,
`checksums.txt`, `ROLLBACK.md` record old artifact as null, platform digest separately,
and a hash-verified forward candidate from d7a00d5. Candidate file hashes do not prove
old deployed source equivalence. Forward-redeploy strategy is prepared but not
accepted: it still needs supportedCLI/platform acceptance, secure config before-state,
and authorized hosted identity/smoke. It cannot repair missing DB grants/credential.

EDGE_ROLLBACK_ARTIFACT=PARTIAL_PLATFORM_LIMITATION_SECURITY_CONTAINMENT
EDGE_ROLLBACK_READY=BLOCKED
FORWARD_REDEPLOY_STRATEGY=PREPARED_NOT_REHEARSED
Do not promote a plan or offline hash check to PASS_WITH_REDEPLOY_STRATEGY.

2026-09-17 continuation: CLI2.117.0 was provenance-verified onD, but this does not
prove that its safe download can recover the refused previous artifact. No bypass
extractor, new remote download or deployment was performed. Target worker successor
adds HEALTH_BACKGROUND_SQL_ENABLED/HEALTH_NATIVE_DATABASE_URL/
HEALTH_RECOMPUTE_DATABASE_URL/HEALTH_RECOMPUTE_TRIGGER_SECRET names; preserve their
secure before-state before later deployment. Current source/package is not the old
deployed artifact. Supported safe recovery plus local rollback serve/smoke still
required; EDGE_ROLLBACK_READY remains PARTIAL_REMOTE_ARTIFACT_REQUIRED.

Last readonly inventory: mobile-health-beta v14 ACTIVE, verify_jwt=false (existing
custom verified-session handler), bundle digest
`a40beb78e41f0a969af44b72a66efa0c31fed8234d794e51770284952749ed07`.
Source revision cannot be inferred from that digest. The preceding run's CLI download
refused an out-of-subtree frozen fixture (`UnsafeFunctionDownloadPathError`). This
security refusal is retained; no alternate extractor or unsafe path override used.

Required before deployment: recover previous deployable artifact through a supported
safe upstream download/packaging route; verify every entry stays under its intended
root, hashes match known deployment, config/settings names and previous values are
retained securely, and locally serve/rehearse rollback. Do not claim a source checkout
is the exact deployed bundle without evidence.

Conditional future command (NOT RUN): `supabase functions deploy mobile-health-beta
--project-ref uavimjgccigpbwqmfkhh --workdir <verified-previous-artifact-root>` using
the reviewed pinned CLI and freshly checked help/config. Validation must include auth
denials, correct dedicated user's SQL row/readback, CORS and errors, not just HTTP200.
Six manual settings were absent at last snapshot; BETA_WEB_AUTH_VERIFY_URL name was
present but its value was not read. Re-snapshot before mutation; never print values.

Rollback is code/config only, never SQL deletion/reverse migration. The former manual
privileged adapter is not an acceptable fallback under the new runtime policy: keep
manual provider OFF if the safe previous release cannot meet that boundary.
EDGE_ROLLBACK_READY=PARTIAL_SUPPORTED_ARTIFACT_RECOVERY_REQUIRED.
