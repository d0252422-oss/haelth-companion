param(
    [string]$Adb = 'D:\Dev\Android\Sdk\platform-tools\adb.exe',
    [string]$Package = 'app.healthcompanion.sync.beta.debug',
    [ValidateRange(1,600)][int]$WindowSeconds = 90,
    [switch]$StartApp,
    [string]$OutputDirectory = '.engine-artifacts\android-device-gate'
)
$ErrorActionPreference = 'Stop'
# Deferred real-device utility. Run only when explicitly starting the physical-device track.
# It does not install, clear data, alter the network, force a job or synthesize HTTP evidence.
$report = [ordered]@{
    schema_version='ANDROID_ENGINE_GATE_V1'; synthetic=$false
    status='UNVERIFIED_REAL_DEVICE'; production_writes=0
    trigger='NONE'; workmanager='UNKNOWN'; http_per_request='UNVERIFIED'
    checkpoint='UNKNOWN'; ingestion='UNVERIFIED'; domain_recompute='UNVERIFIED'
    score_update='UNVERIFIED'; samples=@()
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
if (-not (Test-Path -LiteralPath $Adb)) {
    $report.status='BLOCKED_EXTERNAL_DEVICE_NOT_CONNECTED'
} else {
    $devices = @(& $Adb devices | Where-Object {$_ -match '^\S+\s+device$'})
    if ($devices.Count -ne 1) {
        $report.status='BLOCKED_EXTERNAL_DEVICE_NOT_CONNECTED_OR_AMBIGUOUS'
    } else {
        $deviceId=($devices[0] -split '\s+')[0]
        $packageInfo=& $Adb -s $deviceId shell dumpsys package $Package
        $report['package_version']=@($packageInfo | Select-String 'versionCode=|versionName=' |
            ForEach-Object {$_.ToString().Trim()})
        if (-not $report.package_version) { $report.status='BLOCKED_BETA_APP_NOT_INSTALLED' }
        else {
            if ($StartApp) {
                & $Adb -s $deviceId shell am start -n "$Package/app.healthcompanion.sync.MainActivity" | Out-Null
                $report.trigger='EXPLICIT_STARTUP_REQUEST_NOT_PROOF_OF_NEW_WORK'
            }
            $timer=[Diagnostics.Stopwatch]::StartNew()
            do {
                $raw=& $Adb -s $deviceId shell run-as $Package cat shared_prefs/sync_runtime_state.xml 2>$null
                $sample=[ordered]@{observed_at=[DateTime]::UtcNow.ToString('o'); elapsed_ms=$timer.ElapsedMilliseconds}
                try {
                    [xml]$xml=$raw -join "`n"
                    foreach($entry in $xml.map.ChildNodes) {
                        if($entry.name -match 'background_(work_id|result|stage|started_at|terminal_at|last_progress_at|request_count)$') {
                            $name=$entry.name -replace '^[a-f0-9]{16}_',''
                            $sample[$name]=$entry.InnerText+$entry.value
                        }
                    }
                    $checkpoint=& $Adb -s $deviceId shell run-as $Package cat shared_prefs/sync_checkpoint.xml 2>$null
                    [xml]$cp=$checkpoint -join "`n"
                    $sample['checkpoint_present']=@($cp.map.ChildNodes | Where-Object {$_.name -eq 'plan_fingerprint'}).Count -gt 0
                    $report.checkpoint='OBSERVED_NOT_PROOF_OF_INGESTION'
                } catch { $sample['read_status']='UNAVAILABLE' }
                $report.samples += $sample
                if($timer.Elapsed.TotalSeconds -lt $WindowSeconds){Start-Sleep -Seconds 2}
            } while($timer.Elapsed.TotalSeconds -lt $WindowSeconds)
            $report.workmanager='METADATA_ONLY_WORKINFO_REQUIRES_DB_OR_LOG_CORRELATION'
            $report.status='EVIDENCE_CAPTURED_GATE_UNVERIFIED'
        }
    }
}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'report.json') -Encoding utf8
$report | ConvertTo-Json -Depth 8
