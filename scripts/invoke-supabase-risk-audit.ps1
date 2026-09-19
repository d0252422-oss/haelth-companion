param(
  [ValidatePattern('^[a-z]{20}$')][string]$ProjectRef='uavimjgccigpbwqmfkhh',
  [Parameter(Mandatory=$true)][ValidatePattern('^D:\\Dev\\Evidence\\')][string]$OutputFile,
  [string]$SupabaseCli='D:/Dev/Tools/supabase/2.117.0/bin/supabase.exe',
  [string]$Psql='D:/Dev/Evidence/health-edge-pg17-20260913-2210/pg17-tools/postgresql-17.11-3-reviewed/bin/psql.exe',
  [string]$CaFile='D:/Dev/Evidence/health-nonprivileged-20260916-224316/official-public-ca.crt'
)
$ErrorActionPreference='Stop'
if($ProjectRef -eq 'vptqedxdxfoohbqctujf'){throw 'PRODUCTION_TARGET_DENIED'}
if($ProjectRef -ne 'uavimjgccigpbwqmfkhh'){throw 'BETA_TARGET_NOT_ALLOWLISTED'}
foreach($required in @($SupabaseCli,$Psql,$CaFile,(Join-Path $PSScriptRoot 'supabase-internal-beta-risk-audit.sql'))){if(!(Test-Path -LiteralPath $required -PathType Leaf)){throw "MISSING_REQUIRED_FILE:$required"}}
$parent=Split-Path -Parent $OutputFile
New-Item -ItemType Directory -Force -Path $parent | Out-Null
$secretDirectory=Join-Path $parent '.private'
New-Item -ItemType Directory -Force -Path $secretDirectory | Out-Null
$bootstrap=Join-Path $secretDirectory ('cli-login-'+[guid]::NewGuid().ToString('N')+'.sh')
$old=@{PGHOST=$env:PGHOST;PGPORT=$env:PGPORT;PGUSER=$env:PGUSER;PGPASSWORD=$env:PGPASSWORD;PGDATABASE=$env:PGDATABASE;PGSSLMODE=$env:PGSSLMODE;PGSSLROOTCERT=$env:PGSSLROOTCERT}
try{
  & $SupabaseCli db dump --linked --dry-run *> $bootstrap
  if($LASTEXITCODE -ne 0){throw 'SUPABASE_TEMP_LOGIN_FAILED'}
  $text=Get-Content -LiteralPath $bootstrap -Raw
  $values=@{}
  foreach($name in @('PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE')){
    $match=[regex]::Match($text,"export $name=`"([^`"]+)`"")
    if(!$match.Success){throw "TEMP_LOGIN_FIELD_MISSING:$name"}
    $values[$name]=$match.Groups[1].Value
  }
  if($values.PGHOST -ne 'aws-0-ap-southeast-1.pooler.supabase.com' -or $values.PGDATABASE -ne 'postgres' -or $values.PGUSER -notmatch "^cli_login_postgres\.$ProjectRef$"){throw 'REMOTE_TARGET_IDENTITY_MISMATCH'}
  $env:PGHOST=$values.PGHOST;$env:PGPORT=$values.PGPORT;$env:PGUSER=$values.PGUSER;$env:PGPASSWORD=$values.PGPASSWORD;$env:PGDATABASE=$values.PGDATABASE
  $env:PGSSLMODE='verify-full';$env:PGSSLROOTCERT=$CaFile
  & $Psql -X --no-psqlrc --tuples-only --no-align --set=ON_ERROR_STOP=1 --file (Join-Path $PSScriptRoot 'supabase-internal-beta-risk-audit.sql') | Set-Content -LiteralPath $OutputFile -Encoding utf8NoBOM
  if($LASTEXITCODE -ne 0){throw 'RISK_AUDIT_QUERY_FAILED'}
  & $Psql -X --no-psqlrc --command '\conninfo' | Set-Content -LiteralPath ($OutputFile+'.tls.txt') -Encoding utf8NoBOM
  if($LASTEXITCODE -ne 0){throw 'TLS_CONNECTION_EVIDENCE_FAILED'}
} finally {
  foreach($name in $old.Keys){Set-Item -Path "Env:$name" -Value $old[$name] -ErrorAction SilentlyContinue}
  if(Test-Path -LiteralPath $bootstrap){Remove-Item -LiteralPath $bootstrap -Force}
}
Write-Output $OutputFile
