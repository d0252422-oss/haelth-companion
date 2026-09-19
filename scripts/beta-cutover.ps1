param(
 [ValidateSet('preflight','dryrun','deploy-edge','deploy-web','e2e','rollback','full')][string]$Mode='dryrun',
 [Parameter(Mandatory=$true)][string]$ProjectRef,
 [Parameter(Mandatory=$true)][string]$PackageDirectory,
 [Parameter(Mandatory=$true)][string]$EvidenceDirectory,
 [switch]$Resume
)
$ErrorActionPreference='Stop'
$arguments=@((Join-Path $PSScriptRoot 'beta-cutover-driver.mjs'),'--mode',$Mode,'--projectRef',$ProjectRef,'--packageDirectory',$PackageDirectory,'--output',$EvidenceDirectory)
if($Resume){$arguments+='--resume'}
& node @arguments
exit $LASTEXITCODE
