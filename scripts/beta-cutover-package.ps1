param(
 [Parameter(Mandatory=$true)][string]$OutputDirectory,
 [ValidateSet('uavimjgccigpbwqmfkhh','dsdfacbjaicdcwayhhil')][string]$ProjectRef='dsdfacbjaicdcwayhhil'
)
$ErrorActionPreference='Stop'
# One-command offline package/dry-run; deliberately has no remote execution switch.
& node (Join-Path $PSScriptRoot 'beta-cutover-package.mjs') --output $OutputDirectory --target $ProjectRef
exit $LASTEXITCODE
