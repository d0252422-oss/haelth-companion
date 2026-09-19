param([Parameter(Mandatory=$true)][string]$At,[Parameter(Mandatory=$true)][string]$OutputFile)
$ErrorActionPreference='Stop'
$resolved=[IO.Path]::GetFullPath($OutputFile)
if($resolved -notlike 'D:\Dev\Evidence\*'){throw 'D_EVIDENCE_REQUIRED'}
$parent=Get-Item -LiteralPath (Split-Path -Parent $resolved)
while($parent){if($parent.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'REPARSE_PATH_NOT_ALLOWED'};$parent=$parent.Parent}
$result=& node (Join-Path $PSScriptRoot 'ios-shortcut-real-device-gate.cjs') --prepare --at $At
if($LASTEXITCODE -ne 0){throw 'IOS_PREPARATION_FAILED'}
$parsed=($result -join "`n")|ConvertFrom-Json
if($parsed.network_operations -ne 0 -or $parsed.device_execution -ne 'NOT_RUN'){throw 'OFFLINE_CONTRACT_REQUIRED'}
$stream=[IO.File]::Open($resolved,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try{$bytes=[Text.Encoding]::UTF8.GetBytes(($result -join "`n"));$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
$result
