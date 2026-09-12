param([Parameter(Mandatory)][string]$Name,[Parameter(Mandatory)][string]$Command,[ValidateSet('runtime-e2e','blocker-closure')][string]$EvidenceDirectory='runtime-e2e')
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
$folder=Join-Path $root ".engine-artifacts/$EvidenceDirectory"
New-Item -ItemType Directory -Force -Path $folder | Out-Null
if($Name -notmatch '^[a-z0-9-]+$'){throw 'Invalid evidence name'}
$started=[DateTime]::UtcNow.ToString('o')
$revision=git rev-parse HEAD
$changes=@(git status --porcelain)
$hashes=@(git ls-files --cached --others --exclude-standard | Where-Object { $_ -notmatch '__pycache__|egg-info|deno.lock$' } | ForEach-Object { if(Test-Path -LiteralPath $_ -PathType Leaf){[ordered]@{path=$_;sha256=(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash}} })
$path=Join-Path $folder "$Name.log"
& pwsh -NoProfile -Command $Command > $path 2>&1
$code=$LASTEXITCODE
$evidence=[ordered]@{name=$Name;command=$Command;source_revision=$revision;working_tree=$changes;source_hashes=$hashes;started_at=$started;ended_at=[DateTime]::UtcNow.ToString('o');exit_code=$code;execution='FRESH_COMMAND';report_path=$path}
$evidence | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $folder "$Name.manifest.json")
Get-Content -LiteralPath $path -Tail 15
exit $code
