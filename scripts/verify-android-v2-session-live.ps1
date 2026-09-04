param(
  [string]$BetaProjectRef = "uavimjgccigpbwqmfkhh",
  [string]$ProductionProjectRef = "vptqedxdxfoohbqctujf"
)

$ErrorActionPreference = "Stop"
if ($BetaProjectRef -eq $ProductionProjectRef) { throw "FAIL_CLOSED_TARGET_EQUALS_PRODUCTION" }
$linked = supabase projects list --output json | ConvertFrom-Json | Where-Object { $_.linked -eq $true }
if (-not $linked -or $linked.id -ne $BetaProjectRef) { throw "FAIL_CLOSED_WRONG_LINKED_PROJECT" }

function Get-Sha256([string]$Value) {
  [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Value))).ToLowerInvariant()
}
function Invoke-BetaSql([string]$Sql) {
  $path = Join-Path $env:TEMP ("health-companion-android-v2-{0}.sql" -f [guid]::NewGuid())
  try {
    [IO.File]::WriteAllText($path, $Sql)
    supabase db query --linked --file $path | ConvertFrom-Json
  } finally { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
}
function New-Token([int]$Bytes) {
  [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes($Bytes)).ToLowerInvariant()
}

$endpoint = "https://$BetaProjectRef.supabase.co/functions/v1/mobile-health-beta"
$user = [guid]::NewGuid().ToString()
$sessionId = [guid]::NewGuid().ToString()
$access = New-Token 32
$refresh = New-Token 48
$key = [Security.Cryptography.ECDsa]::Create()
$key.GenerateKey([Security.Cryptography.ECCurve]::CreateFromFriendlyName("nistP256"))
$publicDer = $key.ExportSubjectPublicKeyInfo()
$publicHex = [Convert]::ToHexString($publicDer).ToLowerInvariant()
$fingerprint = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($publicDer)).ToLowerInvariant()

try {
  Invoke-BetaSql @"
insert into public.users(id, external_subject_hash) values ('$user', '$(Get-Sha256 "android-v2-$user")');
insert into private.mobile_app_sessions(
 id, canonical_user_id, platform, installation_key_fingerprint, installation_public_key_spki,
 access_token_digest, refresh_token_digest, access_expires_at, refresh_expires_at, environment
) values (
 '$sessionId', '$user', 'android', '$fingerprint', decode('$publicHex','hex'),
 '$(Get-Sha256 $access)', '$(Get-Sha256 $refresh)', now() + interval '1 minute', now() + interval '1 day', 'beta'
);
"@ | Out-Null

  $message = [Text.Encoding]::UTF8.GetBytes("$sessionId$([char]0x1f)$refresh")
  $signature = $key.SignData($message, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.DSASignatureFormat]::Rfc3279DerSequence)
  $refreshBody = @{ session_id = $sessionId; refresh_token = $refresh; signature = [Convert]::ToBase64String($signature) } | ConvertTo-Json -Compress
  $rotated = Invoke-RestMethod -Uri "$endpoint/v1/mobile/sessions/refresh" -Method Post -ContentType "application/json" -Body $refreshBody
  if (-not $rotated.access_token -or -not $rotated.refresh_token -or $rotated.canonical_user_id -ne $user) { throw "SESSION_REFRESH_FAILED" }

  $statusBody = @{
    canonical_user_id = $user; platform = "android"; connector_type = "android_helper"
    connector_version = "0.1.0-beta.3"; last_attempt_at = [DateTimeOffset]::UtcNow.ToString("o")
    last_success_at = $null; last_result = "SESSION_LIFECYCLE_TEST"; available_domains = @()
    permission_state_if_known = "UNKNOWN"
  } | ConvertTo-Json -Compress
  $headers = @{ Authorization = "Bearer $($rotated.access_token)"; "x-app-session-id" = $sessionId }
  Invoke-RestMethod -Uri "$endpoint/v1/mobile/connectors/status" -Method Post -Headers $headers -ContentType "application/json" -Body $statusBody | Out-Null
  Invoke-RestMethod -Uri "$endpoint/v1/mobile/sessions/current" -Method Delete -Headers $headers | Out-Null

  $revokedRejected = $false
  try { Invoke-RestMethod -Uri "$endpoint/v1/mobile/connectors/status" -Method Post -Headers $headers -ContentType "application/json" -Body $statusBody | Out-Null }
  catch { $revokedRejected = $_.Exception.Response.StatusCode.value__ -eq 401 }
  if (-not $revokedRejected) { throw "REVOKED_SESSION_NOT_REJECTED" }

  Write-Output "TARGET_GUARD=PASS_BETA_ONLY"
  Write-Output "SESSION_REFRESH=PASS"
  Write-Output "SESSION_AUTHORIZATION=PASS"
  Write-Output "SESSION_LOGOUT_REVOCATION=PASS"
  Write-Output "REVOKED_SESSION_FAIL_CLOSED=PASS"
} finally {
  try { Invoke-BetaSql "delete from public.users where id = '$user';" | Out-Null } catch { Write-Warning "BETA_TEST_CLEANUP_REQUIRES_REVIEW" }
  $access = $null; $refresh = $null; $rotated = $null; $headers = $null
  $key.Dispose()
}
