param(
  [string]$BetaProjectRef = "uavimjgccigpbwqmfkhh",
  [string]$ProductionProjectRef = "vptqedxdxfoohbqctujf"
)

$ErrorActionPreference = "Stop"

if ($BetaProjectRef -eq $ProductionProjectRef) {
  throw "FAIL_CLOSED_TARGET_EQUALS_PRODUCTION"
}

$linked = supabase projects list --output json |
  ConvertFrom-Json |
  Where-Object { $_.linked -eq $true }
if (-not $linked -or $linked.id -ne $BetaProjectRef) {
  throw "FAIL_CLOSED_WRONG_LINKED_PROJECT"
}

function Get-Sha256([string]$Value) {
  return [Convert]::ToHexString(
    [Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Value))
  ).ToLowerInvariant()
}

function Invoke-BetaSql([string]$Sql) {
  $path = Join-Path $env:TEMP ("health-companion-beta-{0}.sql" -f [guid]::NewGuid())
  try {
    [IO.File]::WriteAllText($path, $Sql)
    return supabase db query --linked --file $path | ConvertFrom-Json
  } finally {
    Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  }
}

function New-TestToken {
  return [Convert]::ToHexString(
    [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
  ).ToLowerInvariant()
}

$endpoint = "https://$BetaProjectRef.supabase.co/functions/v1/mobile-health-beta"
$userA = [guid]::NewGuid().ToString()
$userB = [guid]::NewGuid().ToString()
$iosSession = [guid]::NewGuid().ToString()
$androidSession = [guid]::NewGuid().ToString()
$iosToken = New-TestToken
$androidToken = New-TestToken
$today = "2026-08-29"

try {
  $setup = @"
insert into public.users(id, external_subject_hash) values
  ('$userA', '$(Get-Sha256 "beta-live-user-a-$userA")'),
  ('$userB', '$(Get-Sha256 "beta-live-user-b-$userB")');
insert into private.beta_shortcut_sessions(id, canonical_user_id, access_token_digest, expires_at)
values ('$iosSession', '$userA', '$(Get-Sha256 $iosToken)', now() + interval '1 hour');
insert into private.mobile_app_sessions(
  id, canonical_user_id, platform, installation_key_fingerprint,
  installation_public_key_spki, access_token_digest, refresh_token_digest,
  access_expires_at, refresh_expires_at, environment
) values (
  '$androidSession', '$userA', 'android', '$(Get-Sha256 "installation-$androidSession")',
  decode(repeat('01', 65), 'hex'), '$(Get-Sha256 $androidToken)',
  '$(Get-Sha256 "refresh-$androidSession")', now() + interval '1 hour',
  now() + interval '2 hours', 'beta'
);
"@
  Invoke-BetaSql $setup | Out-Null

  $iosBody = @{
    environment = "beta"
    schema_version = "hdl-v2.connector-ingestion.v1"
    provider = "apple_health"
    connector_type = "ios_shortcut"
    canonical_user_id = $userA
    sync_window_start = "$today`T00:00:00+08:00"
    sync_window_end = "$today`T23:59:59+08:00"
    records = @(
      @{
        domain = "steps"; value = 6800; unit = "count"
        recorded_at = "$today`T12:00:00+08:00"; started_at = "$today`T00:00:00+08:00"
        ended_at = "$today`T12:00:00+08:00"; timezone = "Asia/Taipei"; local_date = $today
        source_app = "com.apple.health"; native_record_id = "beta-live-ios-steps"; source_revision = 1
      },
      @{
        domain = "sleep"; value = 420; unit = "minute"
        recorded_at = "$today`T07:00:00+08:00"; started_at = "$today`T00:00:00+08:00"
        ended_at = "$today`T07:00:00+08:00"; timezone = "Asia/Taipei"; local_date = $today
        source_app = "com.apple.health"; native_record_id = "beta-live-ios-sleep"; source_revision = 1
      }
    )
  } | ConvertTo-Json -Depth 8 -Compress
  $iosHeaders = @{ Authorization = "Bearer $iosToken"; "x-shortcut-session-id" = $iosSession }
  $iosFirst = Invoke-RestMethod -Uri "$endpoint/v1/connectors/ios-shortcut/ingest" -Method Post -Headers $iosHeaders -ContentType "application/json" -Body $iosBody
  $iosReplay = Invoke-RestMethod -Uri "$endpoint/v1/connectors/ios-shortcut/ingest" -Method Post -Headers $iosHeaders -ContentType "application/json" -Body $iosBody
  if ($iosFirst.accepted_idempotency_keys.Count -ne 2 -or $iosReplay.duplicate_idempotency_keys.Count -ne 2) {
    throw "IOS_CREATE_OR_REPLAY_FAILED"
  }

  $record = @{
    schema_version = "hdl-v2.health-ingestion.v1"; canonical_user_id = $userA
    platform = "android"; domain = "steps"; source_app = "com.google.android.apps.healthdata"
    source_record_id = "beta-live-android-steps"; recorded_at = "$today`T13:00:00+08:00"
    local_date = $today; timezone = "Asia/Taipei"; value = 1200; unit = "count"
  }
  $contentHash = Get-Sha256 (($record | ConvertTo-Json -Depth 6 -Compress))
  $androidBody = @{
    environment = "beta"; canonical_user_id = $userA
    mutations = @(@{
      canonical_user_id = $userA; platform = "android"; domain = "steps"
      source_app = "com.google.android.apps.healthdata"; source_record_id = "beta-live-android-steps"
      source_revision = 1; source_updated_at = "$today`T13:00:00+08:00"
      source_content_hash = $contentHash; operation = "UPSERT"
      idempotency_key = Get-Sha256 "android-$userA-$contentHash"; record = $record
      affected_local_dates = @($today)
    })
  } | ConvertTo-Json -Depth 8 -Compress
  $androidHeaders = @{ Authorization = "Bearer $androidToken"; "x-app-session-id" = $androidSession }
  $androidFirst = Invoke-RestMethod -Uri "$endpoint/v1/health/ingestion/batches" -Method Post -Headers $androidHeaders -ContentType "application/json" -Body $androidBody
  $androidReplay = Invoke-RestMethod -Uri "$endpoint/v1/health/ingestion/batches" -Method Post -Headers $androidHeaders -ContentType "application/json" -Body $androidBody
  if ($androidFirst.accepted_idempotency_keys.Count -ne 1 -or $androidReplay.duplicate_idempotency_keys.Count -ne 1) {
    throw "ANDROID_CREATE_OR_REPLAY_FAILED"
  }

  $crossUserBody = $androidBody | ConvertFrom-Json
  $crossUserBody.canonical_user_id = $userB
  $crossUserBody.mutations[0].canonical_user_id = $userB
  $crossUserRejected = $false
  try {
    Invoke-RestMethod -Uri "$endpoint/v1/health/ingestion/batches" -Method Post -Headers $androidHeaders -ContentType "application/json" -Body ($crossUserBody | ConvertTo-Json -Depth 8 -Compress) | Out-Null
  } catch {
    $crossUserRejected = $_.Exception.Response.StatusCode.value__ -eq 403
  }
  if (-not $crossUserRejected) { throw "CROSS_USER_REJECTION_FAILED" }

  $verificationSql = @"
select json_build_object(
  'record_count', (select count(*) from public.beta_health_records where canonical_user_id = '$userA'),
  'score_count', (select count(*) from public.beta_health_scores where canonical_user_id = '$userA' and score_date = '$today'),
  'distinct_score_types', (select count(distinct score_type) from public.beta_health_scores where canonical_user_id = '$userA' and score_date = '$today'),
  'activity_score', (select score from public.beta_health_scores where canonical_user_id = '$userA' and score_date = '$today' and score_type = 'activity'),
  'sleep_score', (select score from public.beta_health_scores where canonical_user_id = '$userA' and score_date = '$today' and score_type = 'sleep'),
  'unsupported_domain_scores', (select count(*) from public.beta_health_scores where canonical_user_id = '$userA' and score_date = '$today' and score_type in ('training','nutrition') and score is not null),
  'other_user_records', (select count(*) from public.beta_health_records where canonical_user_id = '$userB'),
  'algorithm_versions', (select array_agg(distinct algorithm_version) from public.beta_health_scores where canonical_user_id = '$userA')
) as evidence;
"@
  $query = Invoke-BetaSql $verificationSql
  $evidence = $query.rows[0].evidence
  if ($evidence.record_count -ne 3 -or $evidence.score_count -ne 8 -or $evidence.distinct_score_types -ne 8 -or $evidence.other_user_records -ne 0) {
    throw "BETA_SCORE_PERSISTENCE_EVIDENCE_FAILED"
  }
  if ($null -eq $evidence.activity_score -or $null -eq $evidence.sleep_score -or $evidence.unsupported_domain_scores -ne 0) {
    throw "BETA_SCORE_MISSING_DATA_SEMANTICS_FAILED"
  }
  if (@($evidence.algorithm_versions) -notcontains "health-score-v1.0") {
    throw "ALGORITHM_VERSION_MISMATCH"
  }

  Write-Output "TARGET_GUARD=PASS_BETA_ONLY"
  Write-Output "IOS_EDGE_CREATE_REPLAY=PASS"
  Write-Output "ANDROID_EDGE_CREATE_REPLAY=PASS"
  Write-Output "CROSS_USER_REJECTION=PASS"
  Write-Output "HDL_V2_TO_SCORE_PERSISTENCE=PASS"
  Write-Output "SCORE_ROWS=8"
  Write-Output "PARTIAL_EVIDENCE_SCORING=PASS"
  Write-Output "UNSUPPORTED_DOMAIN_DEFAULTS=NOT_FABRICATED"
  Write-Output "ALGORITHM_VERSION=health-score-v1.0"
} finally {
  $cleanup = @"
delete from public.users where id in ('$userA', '$userB');
"@
  try { Invoke-BetaSql $cleanup | Out-Null } catch { Write-Warning "BETA_TEST_CLEANUP_REQUIRES_REVIEW" }
  $iosToken = $null
  $androidToken = $null
  $iosHeaders = $null
  $androidHeaders = $null
}
