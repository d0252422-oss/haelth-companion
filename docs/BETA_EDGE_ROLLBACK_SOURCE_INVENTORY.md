# Beta Edge rollback provenance — not yet trusted for redeploy

Superseded by health-external-20260917-081934: the official platform connector
returned all deployed v14 source files and each exactly matches a69cb33. Current
status is PASS_EXACT_OR_REPRODUCIBLE; see BETA_EDGE_PROVENANCE_UPDATE.md. The content
below is retained as the honest pre-export investigation and must not be read as the
current decision.

Run health-security-20260917-075734. EDGE_ROLLBACK_READY=BLOCKED_NO_TRUSTED_SOURCE.
ROLLBACK_MODE=UNRESOLVED. ROLLBACK_OFFLINE_REHEARSAL=NOT_RUN_UNTRUSTED_SOURCE.
ROLLBACK_DATA_POLICY=CODE_ONLY_NO_DATA_DESTRUCTION.

| Candidate/source | Revision/hash | Trust / remote match | Restorable |
|---|---|---|---|
| Platform bundle metadata | v14 ezbr a40beb78e41f0a969af44b72a66efa0c31fed8234d794e51770284952749ed07 | EXACT metadata, no recovered bytes | NOT_PROVEN |
| Repository source | a69cb3322f0cfc09a9d2c720e85aff92ec84bcfb | PROBABLE; identity fix/docs claim deployment, but no digest binding | NOT_REHEARSED |
| Prior source | f716d2501170c84d167be5441bd6ad752866122f | PARTIAL; earlier durable-recompute source | NOT_PROVEN_TO_BE_V14 |
| Existing forward candidate | d7a00d527d7486ccbfadfaec5225b3fa604600db;56 previously verified files | NOT_OLD_DEPLOYMENT | candidate only |
| GitHub CI artifacts | runs33761625958/33761625963 | no algorithm artifact; expired Android APK, not Edge | NO_EDGE_ARTIFACT |
| Local .engine-artifacts and D evidence inventories | later local verification packages | no independently bound v14 source found in reviewed manifests | UNVERIFIED |

The a69cb33 commit time is2026-09-03T13:31:02Z, about10minutes after deployment.
Deploying an uncommitted worktree could explain this, but timing/docs do not prove
which bytes were deployed. f716d25 was committed06:28:19Z. Do not select by mtime.
GitHub's ten Sep3 pull-request runs are algorithm/Android workflows. The inspected
repository deployment list contains Pages entries, not an Edge source mapping.
This bounded inventory is not proof that an external archive can never exist.

## Preserved download failure, no bypass

Prior officialCLI2.117.0 download --use-api rejected:
UnsafeFunctionDownloadPathError for
source/fixtures/algorithm-golden/apps-script-health-score-v1.0.snapshot.js.
The tagged official download implementation enforces functions-root containment;
this external frozen-fixture path resolves outside that permitted subtree. It is
not evidence of malicious code, a confirmed symlink attack or corrupt source.
No alternate extractor/older CLI/path rewrite/validation patch was used. Repeating
the same rejected download adds no evidence, so it was not repeated this run.

## Why normalization/build/rehearsal did not run

No exact deployed Git revision or complete trusted exported source has been bound
to the remote digest. Therefore normalization prerequisite B4 is unmet. Hashing a
new checkout proves only its own integrity; it cannot transform PROBABLE to EXACT.
No fictitious checksums, normalized artifact or candidate→old→candidate PASS issued.

Next: a supported vendor export that safely represents external imports, OR an
original deploy receipt/CI archive binding source revision and config to v14.
Once available, verify containment/symlinks and content provenance; freeze tool,
config-name list, file count and hashes; build with the supported tool; rehearse
candidate→old→candidate on local actual Edge with explicitly labeled synthetic
configuration. Capture routes/auth/errors/DB compatibility. No remote deploy needed.

Do not reactivate the historical privileged manual path. If the previous release
cannot honor the current nonprivileged policy, keep that provider OFF and review a
forward fix; an arbitrary current redeploy is not recovery of old code.
Restore code/config only. Retain valid SQL rows and migration history throughout.
