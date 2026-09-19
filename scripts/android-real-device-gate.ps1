#requires -Version 7.0
param(
    [string]$Adb = 'D:\Dev\Android\Sdk\platform-tools\adb.exe',
    [string]$Package = 'app.healthcompanion.sync.beta.debug',
    [ValidateRange(1,600)][int]$WindowSeconds = 90,
    [ValidateRange(1,30)][int]$CommandTimeoutSeconds = 10,
    [string]$ScopeHash = '',
    [switch]$StartApp,
    [string]$OutputDirectory = '.engine-artifacts\android-device-gate'
)
$ErrorActionPreference = 'Stop'
if ($Package -notmatch '^[a-zA-Z0-9_.]+$') { throw 'INVALID_PACKAGE_NAME' }
$timer=[Diagnostics.Stopwatch]::StartNew()
function Invoke-BoundedAdb([string[]]$Arguments) {
    $remaining=[Math]::Min($CommandTimeoutSeconds * 1000, $WindowSeconds * 1000 - $timer.ElapsedMilliseconds)
    if ($remaining -le 0) { throw 'OBSERVATION_DEADLINE' }
    $commandDeadline=$timer.ElapsedMilliseconds+$remaining
    $info=[Diagnostics.ProcessStartInfo]::new()
    $info.FileName=$Adb; $info.UseShellExecute=$false; $info.CreateNoWindow=$true
    $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
    foreach ($arg in $Arguments) { $info.ArgumentList.Add($arg) }
    $process=[Diagnostics.Process]::new(); $process.StartInfo=$info
    try {
        [void]$process.Start()
        $stdout=$process.StandardOutput.ReadToEndAsync(); $stderr=$process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit([int]$remaining)) {
            $process.Kill() # Only this owned client, never kill-server/shared ADB/IDE.
            throw 'ADB_COMMAND_TIMEOUT'
        }
        if ($process.ExitCode -ne 0) { throw 'ADB_COMMAND_FAILED' }
        foreach ($task in @($stdout,$stderr)) {
            $readBudget=[Math]::Max(0,$commandDeadline-$timer.ElapsedMilliseconds)
            if (-not $task.Wait([int]$readBudget)) { throw 'ADB_OUTPUT_INCOMPLETE' }
        }
        return $stdout.Result
    } finally { $process.Dispose() }
}
# Deferred real-device utility. Run only when explicitly starting the physical-device track.
# It does not install, clear data, alter the network, force a job or synthesize HTTP evidence.
$report = [ordered]@{
    schema_version='ANDROID_ENGINE_GATE_V2'; synthetic=$false
    status='UNVERIFIED_REAL_DEVICE'; production_writes=0
    trigger='NONE'; workmanager='UNKNOWN'; http_per_request='UNVERIFIED'
    checkpoint='UNKNOWN'; ingestion='UNVERIFIED'; domain_recompute='UNVERIFIED'
    score_update='UNVERIFIED'; samples=@()
    scope_hash=$ScopeHash
    request_count_semantics='MIXED_WORKMANAGER_ATTEMPT_OR_COMPLETED_BATCH_PROGRESS_NOT_HTTP_COUNT'
    retry_evidence='REQUIRES_CORRELATED_WORKINFO_AND_PER_REQUEST_RECEIPTS; COUNTER_ALONE_IS_NOT_RETRY_PROOF'
    acceptance='METADATA_ONLY_NEVER_END_TO_END_PASS'
    command_timeout_seconds=$CommandTimeoutSeconds
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$reportStream=[IO.File]::Open((Join-Path $OutputDirectory 'report.json'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try {
if ($ScopeHash -notmatch '^[a-f0-9]{16}$') {
    $report.status='BLOCKED_EXPLICIT_ACCOUNT_SCOPE_REQUIRED'
} elseif (-not (Test-Path -LiteralPath $Adb)) {
    $report.status='BLOCKED_EXTERNAL_DEVICE_NOT_CONNECTED'
} else {
  try {
    $devices = @((Invoke-BoundedAdb @('devices')) -split "`n" | Where-Object {$_ -match '^\S+\s+device\s*$'})
    if ($devices.Count -ne 1) {
        $report.status='BLOCKED_EXTERNAL_DEVICE_NOT_CONNECTED_OR_AMBIGUOUS'
    } else {
        $deviceId=($devices[0] -split '\s+')[0]
        $packageInfo=(Invoke-BoundedAdb @('-s',$deviceId,'shell','dumpsys','package',$Package)) -split "`n"
        $report['package_version']=@($packageInfo | Select-String 'versionCode=|versionName=' |
            ForEach-Object {$_.ToString().Trim()})
        if (-not $report.package_version) { $report.status='BLOCKED_BETA_APP_NOT_INSTALLED' }
        else {
            if ($StartApp) {
                Invoke-BoundedAdb @('-s',$deviceId,'shell','am','start','-n',"$Package/app.healthcompanion.sync.MainActivity") | Out-Null
                $report.trigger='EXPLICIT_STARTUP_REQUEST_NOT_PROOF_OF_NEW_WORK'
            }
            do {
                $sample=[ordered]@{observed_at=[DateTime]::UtcNow.ToString('o'); elapsed_ms=$timer.ElapsedMilliseconds}
                try {
                    [xml]$xml=Invoke-BoundedAdb @('-s',$deviceId,'shell','run-as',$Package,'cat','shared_prefs/sync_runtime_state.xml')
                    foreach($entry in $xml.map.ChildNodes) {
                        if($entry.name -match ('^'+$ScopeHash+'_background_(work_id|result|stage|started_at|terminal_at|last_progress_at|request_count)$')) {
                            $name=$entry.name -replace ('^'+$ScopeHash+'_'),''
                            $sample[$name]=$entry.InnerText+$entry.value
                        }
                    }
                    # Global checkpoint presence cannot be attributed to this account.
                    $report.checkpoint='NOT_COLLECTED_UNTIL_ACCOUNT_OWNERSHIP_CAN_BE_VERIFIED'
                    if ($sample.Count -eq 2) { $sample['read_status']='NO_MATCHING_SCOPE_METADATA' }
                } catch { $sample['read_status']='UNAVAILABLE_OR_BOUNDED_TIMEOUT' }
                $report.samples += $sample
                $remaining=$WindowSeconds * 1000 - $timer.ElapsedMilliseconds
                if($remaining -gt 0){Start-Sleep -Milliseconds ([int][Math]::Min(2000,$remaining))}
            } while($timer.Elapsed.TotalSeconds -lt $WindowSeconds)
            $report.workmanager='METADATA_ONLY_WORKINFO_REQUIRES_DB_OR_LOG_CORRELATION'
            $report.status='EVIDENCE_CAPTURED_GATE_UNVERIFIED'
        }
    }
  } catch { $report.status='BLOCKED_ADB_COMMAND_OR_OBSERVATION_DEADLINE' }
}
$report['elapsed_ms']=$timer.ElapsedMilliseconds
} finally {
    try {
        $bytes=[Text.Encoding]::UTF8.GetBytes(($report | ConvertTo-Json -Depth 8))
        $reportStream.Write($bytes,0,$bytes.Length)
    } finally { $reportStream.Dispose() }
}
$report | ConvertTo-Json -Depth 8
