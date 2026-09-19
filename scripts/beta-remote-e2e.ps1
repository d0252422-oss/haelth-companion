param([Parameter(Mandatory=$true)][string]$ProjectRef,[Parameter(Mandatory=$true)][string]$OutputFile)
$ErrorActionPreference='Stop'
# Local/static only in this phase. No browser/session, SQL connection or credential read.
& node (Join-Path $PSScriptRoot 'beta-remote-e2e-plan.mjs') --target $ProjectRef --output $OutputFile
exit $LASTEXITCODE
