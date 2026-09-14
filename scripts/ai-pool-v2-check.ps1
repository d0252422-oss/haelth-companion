param(
 [ValidateSet('fast','security','full','release','tools','regression','all')][string]$Mode='fast',
 [string]$ReportRoot,
 [switch]$RefreshSecurityDb
)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$runnerArgs=@((Join-Path $PSScriptRoot 'ai-pool-v2-check.mjs'),'--mode',$Mode)
if($ReportRoot){$runnerArgs+=@('--report-root',$ReportRoot)}
if($RefreshSecurityDb){$runnerArgs+='--refresh-security-db'}
Push-Location -LiteralPath $projectRoot
try { & node @runnerArgs; $result=$LASTEXITCODE } finally { Pop-Location }
exit $result
