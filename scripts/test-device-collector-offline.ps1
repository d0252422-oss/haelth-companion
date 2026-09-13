#requires -Version 7.0
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot 'android-real-device-gate.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'COLLECTOR_PARSE_FAILED'}
$run=Join-Path (Split-Path $PSScriptRoot) ('.engine-artifacts/device-preparation/'+[guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $run | Out-Null
# No real ADB binary is passed or invoked in these tests.
$unavailable=Join-Path $run 'intentionally-nonexistent-adb.exe'
$noScope=Join-Path $run 'no-scope'
& $source -Adb $unavailable -OutputDirectory $noScope | Out-Null
if((Get-Content -Raw (Join-Path $noScope 'report.json')|ConvertFrom-Json).status -ne 'BLOCKED_EXPLICIT_ACCOUNT_SCOPE_REQUIRED'){throw 'SCOPE_GUARD_FAILED'}
$before=(Get-FileHash (Join-Path $noScope 'report.json')).Hash
$rejected=$false;try{& $source -Adb $unavailable -OutputDirectory $noScope | Out-Null}catch{$rejected=$true}
if(-not $rejected -or (Get-FileHash (Join-Path $noScope 'report.json')).Hash -ne $before){throw 'EVIDENCE_OVERWRITTEN'}
& $source -Adb $unavailable -ScopeHash 'aaaaaaaaaaaaaaaa' -OutputDirectory (Join-Path $run 'no-adb') | Out-Null
if((Get-Content -Raw (Join-Path $run 'no-adb/report.json')|ConvertFrom-Json).status -ne 'BLOCKED_EXTERNAL_DEVICE_NOT_CONNECTED'){throw 'MISSING_BINARY_GUARD_FAILED'}
# Extract only the owned-child timeout helper; use pwsh as a fake command, not ADB.
$function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-BoundedAdb'},$true)
. ([scriptblock]::Create($function.Extent.Text))
$Adb=(Get-Process -Id $PID).Path;$CommandTimeoutSeconds=2;$WindowSeconds=10;$timer=[Diagnostics.Stopwatch]::StartNew()
$answer=Invoke-BoundedAdb @('-NoProfile','-Command','Write-Output "SYNTHETIC_CHILD"')
if($answer.Trim() -ne 'SYNTHETIC_CHILD'){throw 'BOUNDED_CHILD_OUTPUT_FAILED'}
$timer=[Diagnostics.Stopwatch]::StartNew();$CommandTimeoutSeconds=1;$timedOut=$false
try{Invoke-BoundedAdb @('-NoProfile','-Command','Start-Sleep -Seconds 20') | Out-Null}catch{if($_.Exception.Message -eq 'ADB_COMMAND_TIMEOUT'){$timedOut=$true}else{throw}}
if(-not $timedOut -or $timer.ElapsedMilliseconds -gt 3500){throw 'BOUNDED_CHILD_TIMEOUT_FAILED'}
@{status='PASS_OFFLINE_ONLY';checks=5;adb_executions=0;device_gate='DEFERRED_NOT_VERIFIED';evidence=$run;timeout_elapsed_ms=$timer.ElapsedMilliseconds}|ConvertTo-Json
