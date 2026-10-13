[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$OutputDirectory)

$ErrorActionPreference = 'Stop'
$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
$storagePath = [IO.Path]::GetFullPath($env:BJC_CORPUS_STORAGE_PATH)
$pgPassFile = [Environment]::GetEnvironmentVariable('PGPASSFILE')

foreach ($key in @('NODE_ENV','BJC_DEPLOYMENT_ENV','BJC_PREPROD_DATABASE_APPROVED','BJC_PREPROD_DB_HOST','BJC_PREPROD_DB_PORT','BJC_PREPROD_DB_NAME','BJC_PREPROD_DB_USER','DATABASE_URL','BJC_CORPUS_STORAGE_PATH')) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($key))) { throw "Missing required process environment variable: $key" }
}
if ($env:NODE_ENV -ne 'production' -or $env:BJC_DEPLOYMENT_ENV -ne 'preprod' -or $env:BJC_PREPROD_DATABASE_APPROVED -ne 'true') {
  throw 'Backup stopped: explicit preproduction approval markers are required.'
}
if (-not [IO.Path]::IsPathRooted($storagePath) -or $storagePath -match '_dev-corpus-storage' -or -not (Test-Path -LiteralPath $storagePath -PathType Container)) {
  throw 'Backup stopped: storage must be an existing independent absolute preproduction directory.'
}
if ([string]::IsNullOrWhiteSpace($pgPassFile) -or -not (Test-Path -LiteralPath $pgPassFile -PathType Leaf)) {
  throw 'PGPASSFILE must point to the access-controlled credential file provisioned by the institutional vault.'
}
if (Test-Path -LiteralPath $outputPath) { throw 'Backup output directory already exists; refusing to overwrite.' }
$separator = [IO.Path]::DirectorySeparatorChar
$storagePrefix = $storagePath.TrimEnd('\','/') + $separator
$outputPrefix = $outputPath.TrimEnd('\','/') + $separator
if ($outputPath.StartsWith($storagePrefix, [StringComparison]::OrdinalIgnoreCase) -or $storagePath.StartsWith($outputPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Backup output and Corpus storage must be separate trees.'
}

$backRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $backRoot
try {
  & node scripts/with-preprod-db-guard.cjs check
  if ($LASTEXITCODE -ne 0) { throw 'Preproduction configuration check failed.' }
  & node scripts/with-preprod-db-guard.cjs target-verify
  if ($LASTEXITCODE -ne 0) { throw 'Effective preproduction database identity check failed.' }
} finally { Pop-Location }

$pgDump = Get-Command pg_dump -ErrorAction Stop
$pgRestore = Get-Command pg_restore -ErrorAction Stop
$tar = Get-Command tar.exe -ErrorAction Stop
New-Item -ItemType Directory -Path $outputPath | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$databaseFile = Join-Path $outputPath "bjc-preprod-$stamp.dump"
$storageFile = Join-Path $outputPath "bjc-preprod-storage-$stamp.tar.gz"
$manifestFile = Join-Path $outputPath 'backup-manifest.json'

$env:PGPASSFILE = $pgPassFile
& $pgDump.Source --no-password --host $env:BJC_PREPROD_DB_HOST --port $env:BJC_PREPROD_DB_PORT --username $env:BJC_PREPROD_DB_USER --format=custom --no-owner --file $databaseFile $env:BJC_PREPROD_DB_NAME
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed; do not deploy.' }
& $pgRestore.Source --list $databaseFile | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'pg_restore archive verification failed; do not deploy.' }

$storageParent = Split-Path -Parent $storagePath
$storageLeaf = Split-Path -Leaf $storagePath
& $tar.Source -czf $storageFile -C $storageParent $storageLeaf
if ($LASTEXITCODE -ne 0) { throw 'Corpus storage archive failed; do not deploy.' }
& $tar.Source -tzf $storageFile | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Corpus storage archive verification failed; do not deploy.' }

$databaseHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $databaseFile).Hash.ToLowerInvariant()
$storageHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $storageFile).Hash.ToLowerInvariant()
$manifest = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  verification = 'PASS'
  target = [ordered]@{ database = $env:BJC_PREPROD_DB_NAME; host = $env:BJC_PREPROD_DB_HOST; port = [int]$env:BJC_PREPROD_DB_PORT; role = $env:BJC_PREPROD_DB_USER }
  databaseBackup = [ordered]@{ path = $databaseFile; sha256 = $databaseHash; format = 'pg_dump custom; pg_restore --list PASS' }
  storageBackup = [ordered]@{ path = $storageFile; sha256 = $storageHash; format = 'tar.gz; archive listing PASS' }
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestFile -Encoding UTF8
Write-Host "PREPROD_BACKUP=PASS; database_sha256=$databaseHash; storage_sha256=$storageHash; manifest=$manifestFile"
