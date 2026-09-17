# Beta Edge provenance update — exact deployed source found

Run health-external-20260917-081934.
NEW_TRUSTED_ROLLBACK_PROVENANCE=YES.
DEPLOYMENT_PROVENANCE=OFFICIAL_PLATFORM_EXPORT_PLUS_ALL_FILE_GIT_MATCH.
OFFICIAL_EDGE_EXPORT=AVAILABLE_VIA_SUPABASE_GET_EDGE_FUNCTION.
EDGE_ROLLBACK_READY=PASS_EXACT_OR_REPRODUCIBLE.

The official readonly Supabase connector returned mobile-health-beta v14 metadata,
bundle digest a40beb78e41f0a969af44b72a66efa0c31fed8234d794e51770284952749ed07
and four deployed source files. All names are relative, contain no parent component,
absolute drive/root or NUL. The export was preserved under
D:/Dev/Evidence/health-external-20260917-081934/edge-v14-export/.

Every exported file's Git blob exactly matches revision
a69cb3322f0cfc09a9d2c720e85aff92ec84bcfb. This converts the former time-based
PROBABLE inference to exact source provenance. It does not claim deterministic
binary eszip reproduction: the platform digest binds the official response metadata,
while file hashes and Git blobs bind the exported source to the revision.

Scoped `deno check` passed with the exported deno.json and D-scoped dependency cache.
This is a dependency/type smoke, not remote acceptance. No deploy or secret read.
The prior CLI containment refusal remains valid and was not retried or bypassed.
The official connector supplied the files through a supported read operation.

The official [backup/restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
also documents CLI/Dashboard function downloads but notes import map/deno.json gaps;
this export includes deno.json. The official deploy guide supports source redeploy.
No built-in previous-version switch was found in current official documentation.
