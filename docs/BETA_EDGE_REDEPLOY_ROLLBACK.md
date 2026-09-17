# Beta Edge exact-source rollback — prepared, not executed

ROLLBACK_MODE=EXACT_DEPLOYED_SOURCE_REDEPLOY.
SOURCE_REVISION=a69cb3322f0cfc09a9d2c720e85aff92ec84bcfb.
TOOL_VERSION=Supabase CLI2.117.0 or official Supabase deploy connector, revalidated
before authorized execution. FUNCTIONS=mobile-health-beta only.

Artifact root:
`D:/Dev/Evidence/health-external-20260917-081934/edge-v14-export/source`.
Manifest/checksums are adjacent. Four files,74555bytes; platform v14 bundle digest
is recorded separately. Do not omit the external frozen fixture or deno.json.

Validated CLI syntax, not run:
`supabase functions deploy mobile-health-beta --project-ref uavimjgccigpbwqmfkhh
--workdir <artifact-source-root> --no-verify-jwt
--import-map supabase/functions/mobile-health-beta/deno.json`

`--no-verify-jwt` preserves deployed v14 metadata only because its handler performs
the existing custom session check; it is not authorization bypass. Before execution,
recheck CLI help, project/function identity, exact manifest hashes and secure setting
names. Never add `--prune`. The official connector is an alternative supported path
using exactly the four manifest files, matching entrypoint/import-map paths and
verify_jwt=false; remote mutation still requires explicit Beta authorization.

CONFIG_NAMES=verify_jwt, import_map, entrypoint.
SECRET_NAMES_ONLY=BETA_WEB_AUTH_VERIFY_URL plus the v14 handler's documented Beta
configuration names; retrieve values only through approved secret storage. Do not
infer current values from source or logs.

POST_DEPLOY_SMOKE=health/CORS; valid/invalid/expired custom session; correct canonical
user; body/native contract; score read/recompute; failure format. Confirm function
metadata increments and exact environment. Stop frontend cutover on failure.

DATA_SAFETY=CODE_CONFIG_ONLY_NO_SQL_REWIND_NO_ROW_DELETE. Preserve migrations and
all valid SQL writes. If restoring old code would require privileged runtime or break
current schema/auth, keep the provider OFF and use an approved forward fix instead.
This document authorizes no deployment.
