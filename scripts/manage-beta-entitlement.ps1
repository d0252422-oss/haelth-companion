[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('Inspect','Grant','Revoke')]
  [string]$Mode,
  [Parameter(Mandatory=$true)]
  [ValidatePattern('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$')]
  [string]$CanonicalUserId,
  [string]$ProjectRef='uavimjgccigpbwqmfkhh',
  [Nullable[datetime]]$ExpiresAt,
  [string]$EvidenceRoot='D:/Dev/Evidence/health-entitlement-admin'
)
$ErrorActionPreference='Stop'
$betaRef='uavimjgccigpbwqmfkhh'
$productionRef='vptqedxdxfoohbqctujf'
if($ProjectRef -ne $betaRef -or $ProjectRef -eq $productionRef){throw 'ENTITLEMENT_TARGET_DENIED'}
if(-not ([System.IO.Path]::GetFullPath($EvidenceRoot)).StartsWith('D:\Dev\Evidence\',[System.StringComparison]::OrdinalIgnoreCase)){throw 'EVIDENCE_ROOT_DENIED'}
$serviceKey=[Environment]::GetEnvironmentVariable('BETA_SERVICE_ROLE_KEY','Process')
if([string]::IsNullOrWhiteSpace($serviceKey) -or $serviceKey.Length -lt 40){throw 'BETA_SERVICE_ROLE_KEY_REQUIRED'}
if($Mode -ne 'Grant' -and $ExpiresAt.HasValue){throw 'EXPIRY_ONLY_ALLOWED_FOR_GRANT'}
if($ExpiresAt.HasValue -and $ExpiresAt.Value.ToUniversalTime() -le [datetime]::UtcNow){throw 'ENTITLEMENT_EXPIRY_INVALID'}
$headers=@{apikey=$serviceKey;authorization="Bearer $serviceKey";'content-type'='application/json'}
$base="https://$ProjectRef.supabase.co/rest/v1/rpc/"
function Invoke-AdminRpc([string]$Name,[hashtable]$Body){
  try{return @(Invoke-RestMethod -Method Post -Uri ($base+$Name) -Headers $headers -Body ($Body|ConvertTo-Json -Compress) -TimeoutSec 20)}
  catch{throw "ENTITLEMENT_ADMIN_RPC_FAILED:$Name"}
}
if($Mode -eq 'Grant'){
  [void](Invoke-AdminRpc 'beta_admin_set_entitlement' @{p_user_id=$CanonicalUserId;p_access_status='BETA';p_expires_at=if($ExpiresAt.HasValue){$ExpiresAt.Value.ToUniversalTime().ToString('o')}else{$null}})
}elseif($Mode -eq 'Revoke'){
  [void](Invoke-AdminRpc 'beta_admin_set_entitlement' @{p_user_id=$CanonicalUserId;p_access_status='REVOKED';p_expires_at=$null})
}
$rows=Invoke-AdminRpc 'beta_admin_get_entitlement' @{p_user_id=$CanonicalUserId}
$row=$rows|Select-Object -First 1
if($Mode -eq 'Grant' -and $row.access_status -ne 'BETA'){throw 'ENTITLEMENT_READ_AFTER_WRITE_FAILED'}
if($Mode -eq 'Revoke' -and $row.access_status -ne 'REVOKED'){throw 'ENTITLEMENT_READ_AFTER_WRITE_FAILED'}
New-Item -ItemType Directory -Force -Path $EvidenceRoot|Out-Null
$userHash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($CanonicalUserId))).ToLowerInvariant()
$result=[ordered]@{status='PASS';mode=$Mode;project_ref=$ProjectRef;canonical_user_sha256=$userHash;entitlement=if($row){[ordered]@{access_status=$row.access_status;plan_code=$row.plan_code;starts_at=$row.starts_at;expires_at=$row.expires_at;grace_until=$row.grace_until;source=$row.source;updated_at=$row.updated_at}}else{$null};checked_at=[datetime]::UtcNow.ToString('o')}
$path=Join-Path $EvidenceRoot ("entitlement-{0}-{1}.json" -f $Mode.ToLowerInvariant(),[datetime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))
$result|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $path -Encoding utf8
$result|ConvertTo-Json -Depth 5
