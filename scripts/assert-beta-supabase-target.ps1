param(
  [Parameter(Mandatory = $true)][string]$TargetProjectRef,
  [Parameter(Mandatory = $true)][string]$BetaProjectRef,
  [Parameter(Mandatory = $true)][string]$ProductionProjectRef
)

$ErrorActionPreference = 'Stop'
if ($TargetProjectRef -ne $BetaProjectRef) {
  throw 'TARGET_PROJECT_REF_MUST_EQUAL_BETA_PROJECT_REF'
}
if ($TargetProjectRef -eq $ProductionProjectRef) {
  throw 'TARGET_PROJECT_REF_MUST_NOT_EQUAL_PRODUCTION_PROJECT_REF'
}
if ($TargetProjectRef -notmatch '^[a-z]{20}$') {
  throw 'INVALID_SUPABASE_PROJECT_REF'
}
Write-Output 'BETA_TARGET_ISOLATION=PASS'
