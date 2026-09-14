# AI Pool v2 free Windows toolchain

Installed/reused 2026-09-14 in canonical Health Companion repo. No global install,
machine PATH/env edit, production/Beta write, Docker migration/reset/prune or paid
service. Original Android changes and runtime package-lock remain untouched.
Evidence: `D:/Dev/Evidence/ai-pool-v2-20260914-094638` (private, do not publish raw traces).

## Inventory / official provenance

| Tool | Version | License | Install / source |
|---|---|---|---|
| Playwright |1.62.1 reused|Apache-2.0|Existing Codex bundled Node framework, selected via ENGINE_PLAYWRIGHT_MODULE; no framework reinstall/devDependency change |
| Chromium |151.0.7922.34 / revision1234|Chromium/third-party notices bundled|D:/Dev/Tools/playwright-browsers; official cdn.playwright.dev download matching installed framework |
| Schemathesis |4.27.1|MIT|D:/Dev/Venvs/ai-pool-v2; official PyPI schemathesis |
| SQLFluff |4.3.0|MIT|Same independent Python3.12.14 venv; official PyPI sqlfluff |
| OSV-Scanner |2.5.1|Apache-2.0|D:/Dev/Tools/osv-scanner/v2.5.1; github.com/google/osv-scanner |
| Trivy |0.74.0|Apache-2.0|D:/Dev/Tools/trivy/v0.74.0; github.com/aquasecurity/trivy |
| actionlint |1.7.12|MIT|D:/Dev/Tools/actionlint/v1.7.12; github.com/rhysd/actionlint |
| act |0.2.89|MIT|D:/Dev/Tools/act/v0.2.89; github.com/nektos/act |
| zizmor |1.30.1|MIT|D:/Dev/Tools/zizmor/v1.30.1; github.com/zizmorcore/zizmor |
| Syft |1.51.1|Apache-2.0|D:/Dev/Tools/syft/v1.51.1; github.com/anchore/syft |

Standalone downloads were matched to official GitHub release asset SHA256 **before
execution**, then ZIP paths/symlinks checked before extracting into new version dirs.
No arbitrary installer script ran. `install-metadata.json` and `downloads.json`
retain release URL, license source, publisher digest and local archive hash; this is
checksum/provenance verification, not a separately verified signing attestation.
Python install used pinned top-level versions, `--only-binary=:all:` and official
https://pypi.org/simple, no sdists/build hooks. `pip-install.json` preserves every
resolved wheel URL/version/hash. Shared dependencies count once in the venv total.
No new subscriptions, cloud scanner project, global pip or package runtime dependency.

Official usage references: [OSV installation](https://google.github.io/osv-scanner/installation/),
[Trivy](https://trivy.dev/docs/latest/getting-started/installation/),
[zizmor](https://docs.zizmor.sh/installation/),
[Syft](https://oss.anchore.com/docs/installation/syft/).
Local saved --help output, not guessed flags, defines the pinned command interface.

## D-only child-process environment

`config/ai-pool-v2.tools.json` contains versioned non-secret paths. The runner applies
only child-process settings; leaving the task does not mutate other applications:

| Setting | Value |
|---|---|
| PLAYWRIGHT_BROWSERS_PATH | D:/Dev/Tools/playwright-browsers |
| NPM_CONFIG_CACHE | D:/Dev/Caches/npm (already configured, reused) |
| npm_config_store_dir | D:/Dev/Caches/pnpm (existing pnpm store already D) |
| PIP_CACHE_DIR | D:/Dev/Caches/pip (already D) |
| TRIVY_CACHE_DIR | D:/Dev/Caches/trivy |
| OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY | D:/Dev/Caches/osv |
| XDG_CACHE_HOME | D:/Dev/Caches, only scanner/test child processes |
| TEMP / TMP | D:/Dev/Caches/ai-pool-temp |
| PYTHONPYCACHEPREFIX | D:/Dev/Caches/python |

GITHUB_TOKEN/GH_TOKEN and secret/password/API-key-named inherited variables are removed
from tool child processes. No credential values are printed or bundled. Native test
fixtures create their own isolated synthetic credentials; do not pass real environment
secrets to local tests. No machine-wide variables or Docker context switching.

Existing Gradle D:/Dev/Gradle and Android SDK D:/Dev/Android/Sdk were inventoried only.
Docker's engine reports /var/lib/docker inside its existing VHDX; Windows Docker/WSL
VHDX remains in the existing C profile. It was not relocated, compacted or removed.
Existing Python/Node/launcher/framework executables on C are reused, not duplicated
just to claim C-free operation. No C cache or old project was deleted.

## Runner

From the canonical repository (PowerShell wrapper resolves its own repo):

```powershell
./scripts/ai-pool-v2-check.ps1 -Mode tools -RefreshSecurityDb -ReportRoot D:/Dev/Evidence/<new-unique-run>/tools
```

Subsequent offline runs omit `-RefreshSecurityDb`. No download occurs automatically
inside ordinary scan mode. The explicit refresh downloads only public vulnerability
data, not Docker runner images. OSV offline/no-resolve avoids querying private package
resolution; zizmor offline does not call GitHub; Trivy offline dependency identification
uses its local DB and builtin config checks; Syft update check is disabled. No source,
SBOM, trace, photo or health data upload. No gitleaks duplicate installation: Trivy
provides scoped secret scanning. No production settings directory is scanned.

`-Mode all` order: actionlint -> zizmor -> SQLFluff -> existing static/Node/Python/build
and PG/browser regression -> Schemathesis decision -> act list -> OSV -> Trivy -> Syft.
`-Mode regression` skips scanner work. To enable the existing native E2E, provide
`LOCAL_ENGINE_PG_BIN` pointing to the already reviewed17.11+ binary,
`LOCAL_ENGINE_PG_MAJOR=17`, `ENGINE_PLAYWRIGHT_MODULE` pointing to the existing bundled
Playwright index.mjs, and the existing dedicated DENO_DIR. The runner does not install
PG, restart Docker, create a new permanent service or use a remote database URL.
Missing settings are BLOCKED. It creates a new synthetic native cluster and preserves
the database/trace evidence, stopping only owned processes through the existing harness.

Each step gets command/start/end/exit/raw stdout/stderr and status in `summary.json`.
Optional findings do not prevent the next step. Required failures return a nonzero
runner exit; a successful tools-only exit is **not full product/release acceptance**.
Reports live below the selected root in `security/`, `sbom/`, `commands/`; repository
default root is ignored `reports/ai-pool-v2/<timestamp>`. Never commit scanner source
snapshots, SBOMs with private package names, or raw synthetic session traces.

## Scope and triage

Scanners use a local tracked-source allowlist snapshot: JS/TS/Python, package lock,
requirements, Gradle configuration, workflows and versioned SQL. No .git history,
untracked .env/private local config, DB dumps, APKs, node_modules or Docker images.
Report `scan-scope.json` hashes every copied file; changing source needs a fresh scan.
This avoids accidentally reading production credentials or traversing package stores.
Trivy secret matches/code are redacted in retained reports. Unknown licenses stay unknown.

Schemathesis installs successfully, but no OpenAPI/Swagger schema was found:
SCHEMATHESIS_INTEGRATION=PREPARED_NO_OPENAPI_SCHEMA. Do not construct an inaccurate
schema or fuzz a remote Beta URL. Its installation/version check is not an API test.

act discovers3 jobs only. `--list`, explicit empty env/secret/var files and no cache
server are used; no container/job/image was launched. Future simulations require
separate safe workflow selection. Android credentials/SDK and unsupported macOS/iOS
jobs cannot be reported PASS by this list operation.

SQLFluff postgres lint returns1179 findings: LT01 498, LT02 453, LT05 219, RF04 9;
no PRS/LXR parser findings. No auto-fix. Native migration tests remain authoritative
for executable SQL/PLpgSQL. actionlint PASS, shellcheck and pyflakes unavailable and
explicitly not counted. zizmor14 findings:11 High/High unpinned action references;
3 Medium/Low artifact credential-persistence warnings. These are review items, not
proof credentials were exposed. No workflow behavior/permissions changed.

OSV extracted4 npm +4 pinned Python packages and found no known vulnerabilities;
Trivy's reported dependency/license targets were package-lock.json, no reported
secret/vulnerability. Coverage is limited: Gradle without lock resolution, dynamic
Python dependencies, embedded native PG binary CVEs and vendor patches are not proven
safe. Syft produced16 components, not a full deployed-runtime inventory. Existing
prohibition on legacy PG18.4 and pending Beta security/auth gates remains unchanged.

## Storage accounting / recovery

`storage-before.json` / `storage-after.json` inventory C/D free space, logical bytes
for each Tools/Caches child, shared venv and Docker VHDX lengths. Totals do not double
count shared dependencies/browser directory. OSV caches individual vulnerability files;
inventory can take time. File sizes are not NTFS allocated/compressed sizes. Disk deltas
include unrelated machine activity and are never claimed as space freed by this task.
If C usage increases500MB+, inspect only; never delete or compact automatically.

Rollback is stop using these scripts and leave original application tool paths intact.
No uninstall/delete is automatic. Removing dedicated version directories/cache/venv
later requires scoped confirmation; do not touch common stores or Docker data.
