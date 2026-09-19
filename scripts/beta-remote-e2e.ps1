param([Parameter(Mandatory=$true)][string]$ProjectRef,[Parameter(Mandatory=$true)][string]$OutputFile,[string]$SyntheticDate)
$ErrorActionPreference='Stop'
# Local/static only in this phase. No browser/session, SQL connection or credential read.
if($SyntheticDate){
 & node (Join-Path $PSScriptRoot 'beta-e2e-prepare.mjs') --target $ProjectRef --date $SyntheticDate --output $OutputFile
}else{
 & node (Join-Path $PSScriptRoot 'beta-remote-e2e-plan.mjs') --target $ProjectRef --output $OutputFile
}
exit $LASTEXITCODE
