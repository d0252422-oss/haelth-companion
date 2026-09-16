# Beta Edge rollback — PARTIAL, not deploy-ready

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
