[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$BackupManifestPath,
  [Parameter(Mandatory = $true)][string]$ServiceStartScript,
  [Parameter(Mandatory = $true)][string]$ReleaseManifestPath
)

$ErrorActionPreference = 'Stop'
$backRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$projectRoot = (Resolve-Path (Join-Path $backRoot '..\..')).Path
$frontRoot = Join-Path $projectRoot 'JurisprudenciaN\front'

function Invoke-Checked([string]$Label, [scriptblock]$Command) {
  Write-Host "== $Label =="
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE" }
}

function Test-LocalHost([string]$Value) {
  $hostName = $Value.Trim().TrimStart([char]'[').TrimEnd([char]']').TrimEnd('.').ToLowerInvariant()
  if ($hostName -eq 'localhost' -or $hostName.EndsWith('.localhost')) { return $true }
  $address = $null
  if (-not [System.Net.IPAddress]::TryParse($hostName, [ref]$address)) { return $false }
  if ($address.IsIPv4MappedToIPv6) { $address = $address.MapToIPv4() }
  if ([System.Net.IPAddress]::IsLoopback($address)) { return $true }
  if ($address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) {
    $bytes = $address.GetAddressBytes()
    return $bytes[0] -eq 0 -or $bytes[0] -eq 127
  }
  return $address.Equals([System.Net.IPAddress]::IPv6Any)
}

$requiredEnvironment = @(
  'NODE_ENV','BJC_DEPLOYMENT_ENV','BJC_PREPROD_DATABASE_APPROVED','BJC_PREPROD_DB_HOST','BJC_PREPROD_DB_PORT',
  'BJC_PREPROD_DB_NAME','BJC_PREPROD_DB_USER','BJC_PREPROD_DB_CA_PATH','DATABASE_URL','JWT_SECRET','BJC_CORPUS_STORAGE_PATH','BJC_DEV_CORPUS_STORAGE_PATH','FRONTEND_URL',
  'BJC_PREPROD_API_ORIGIN','BJC_PREPROD_FRONTEND_ORIGIN','BJC_PREPROD_SMOKE_EMAIL','BJC_PREPROD_SMOKE_PASSWORD',
  'BJC_PREPROD_SMOKE_DOCUMENT_ID','BJC_RELEASE_ID','BJC_BACKEND_BUILD_ID','BJC_FRONTEND_BUILD_ID','BJC_PREPROD_REPORT_PATH',
  'GIT_COMMIT_SHA','NEXT_PUBLIC_API_URL'
)
foreach ($key in $requiredEnvironment) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($key))) { throw "Missing required process environment variable: $key" }
}
if ($env:NODE_ENV -ne 'production' -or $env:BJC_DEPLOYMENT_ENV -ne 'preprod' -or $env:BJC_PREPROD_DATABASE_APPROVED -ne 'true') {
  throw 'Deployment stopped: explicit production-runtime/preprod/DB approval markers are required.'
}
if ($env:GIT_COMMIT_SHA -notmatch '^[0-9a-fA-F]{40}$') { throw 'GIT_COMMIT_SHA must be the approved full 40-hex source commit.' }
$sourceCommit = (& git -C $projectRoot rev-parse HEAD 2>$null)
if ($LASTEXITCODE -ne 0 -or $sourceCommit.Trim() -ne $env:GIT_COMMIT_SHA.ToLowerInvariant()) {
  throw 'Checked-out source SHA does not match GIT_COMMIT_SHA; refusing to deploy an unidentified build.'
}
$sourceStatus = & git -C $projectRoot status --porcelain
if ($LASTEXITCODE -ne 0 -or $sourceStatus) { throw 'Deployment source worktree must be clean.' }
if ($env:FRONTEND_URL.TrimEnd('/') -ne $env:BJC_PREPROD_FRONTEND_ORIGIN.TrimEnd('/')) {
  throw 'BJC_PREPROD_FRONTEND_ORIGIN must match FRONTEND_URL used by the backend CORS allowlist.'
}
Push-Location $frontRoot
try { Invoke-Checked 'Validate frontend preproduction API target' { node scripts/preprod-build-env.mjs } } finally { Pop-Location }
if ($env:BJC_PREPROD_DB_NAME -eq 'buscador_juridico_civil_dev' -or $env:BJC_PREPROD_DB_USER -eq 'bjc_dev' -or (Test-LocalHost $env:BJC_PREPROD_DB_HOST)) {
  throw 'Deployment stopped: the configured database is not an isolated preproduction target.'
}
if (-not [IO.Path]::IsPathRooted($env:BJC_CORPUS_STORAGE_PATH) -or $env:BJC_CORPUS_STORAGE_PATH -match '_dev-corpus-storage') {
  throw 'Deployment stopped: corpus storage must be an existing independent absolute path.'
}
if (-not (Test-Path -LiteralPath $env:BJC_CORPUS_STORAGE_PATH -PathType Container)) { throw 'Preproduction storage path does not exist.' }
$reportPath = [IO.Path]::GetFullPath($env:BJC_PREPROD_REPORT_PATH)
if (-not [IO.Path]::IsPathRooted($env:BJC_PREPROD_REPORT_PATH) -or (Test-Path -LiteralPath $reportPath)) { throw 'Acceptance report path must be absolute and unused.' }
$manifestPath = [IO.Path]::GetFullPath($ReleaseManifestPath)
if (Test-Path -LiteralPath $manifestPath) { throw 'Release manifest path already exists; refusing to overwrite.' }
if ($reportPath -eq $manifestPath) { throw 'Acceptance report and release manifest require separate output paths.' }
foreach ($key in @('BJC_PREPROD_API_ORIGIN','BJC_PREPROD_FRONTEND_ORIGIN')) {
  $originValue = [Environment]::GetEnvironmentVariable($key)
  $originUri = [Uri]$originValue
  if (-not $originUri.IsAbsoluteUri -or $originUri.Scheme -ne 'https' -or $originUri.AbsolutePath -ne '/' -or (Test-LocalHost $originUri.DnsSafeHost)) {
    throw "$key must be an explicit HTTPS preproduction origin outside loopback."
  }
}
$serviceScriptPath = (Resolve-Path -LiteralPath $ServiceStartScript).Path
if ([IO.Path]::GetExtension($serviceScriptPath) -ne '.ps1') { throw 'ServiceStartScript must be an infrastructure-approved PowerShell script.' }

$backup = Get-Content -Raw -LiteralPath (Resolve-Path -LiteralPath $BackupManifestPath) | ConvertFrom-Json
if ($backup.verification -ne 'PASS' -or $backup.target.database -ne $env:BJC_PREPROD_DB_NAME -or
    $backup.target.host -ne $env:BJC_PREPROD_DB_HOST -or [int]$backup.target.port -ne [int]$env:BJC_PREPROD_DB_PORT -or
    $backup.target.role -ne $env:BJC_PREPROD_DB_USER) {
  throw 'Backup manifest target does not match this approved preproduction database identity.'
}
foreach ($kind in @('databaseBackup','storageBackup')) {
  $item = $backup.$kind
  if (-not $item.path -or -not $item.sha256 -or -not (Test-Path -LiteralPath $item.path -PathType Leaf)) { throw "Verified $kind artifact is missing." }
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $item.path).Hash.ToLowerInvariant()
  if ($actual -ne $item.sha256.ToLowerInvariant()) { throw "$kind SHA-256 does not match its manifest." }
}

Push-Location $backRoot
try {
  # Compile the validator used by the guard, then validate without a DB connection.
  Invoke-Checked 'Compile backend preflight' { pnpm exec nest build }
  Invoke-Checked 'Validate preproduction target' { node scripts/with-preprod-db-guard.cjs check }
  Invoke-Checked 'Check migration state' { node scripts/with-preprod-db-guard.cjs migrate-status }
  Invoke-Checked 'Apply reviewed migrations' { node scripts/with-preprod-db-guard.cjs migrate-deploy }
  Invoke-Checked 'Build backend release' { pnpm build }
} finally { Pop-Location }

Push-Location $frontRoot
try { Invoke-Checked 'Build frontend release' { pnpm build } } finally { Pop-Location }

Write-Host '== Start preproduction services through approved host service manager =='
& $serviceScriptPath
if (-not $?) { throw 'Service start script failed.' }

$apiOrigin = $env:BJC_PREPROD_API_ORIGIN
if ([string]::IsNullOrWhiteSpace($apiOrigin)) { throw 'BJC_PREPROD_API_ORIGIN is required for readiness verification.' }
$readyUri = "$($apiOrigin.TrimEnd('/'))/api/health/ready"
$healthy = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  try {
    $response = Invoke-WebRequest -Uri $readyUri -Method Get -TimeoutSec 5 -UseBasicParsing
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) { $healthy = $true; break }
  } catch { Start-Sleep -Seconds 2 }
}
if (-not $healthy) { throw 'Preproduction readiness endpoint did not become healthy.' }

Push-Location $backRoot
try { Invoke-Checked 'Verify Search projection' { node scripts/with-preprod-db-guard.cjs projection-verify } } finally { Pop-Location }

Push-Location $frontRoot
try { Invoke-Checked 'Run preproduction bootstrap smoke' { pnpm exec playwright test --config=playwright.preprod.config.ts } } finally { Pop-Location }

Push-Location $backRoot
try {
  $dbReportLines = & node scripts/with-preprod-db-guard.cjs db-report
  if ($LASTEXITCODE -ne 0) { throw 'Final guarded database acceptance report failed.' }
  $dbReportLine = $dbReportLines | Where-Object { $_ -match '^\{' } | Select-Object -Last 1
  if (-not $dbReportLine) { throw 'Final database report JSON is missing.' }
  $dbReport = $dbReportLine | ConvertFrom-Json
} finally { Pop-Location }

if ($dbReport.pendingMigrations -ne 0 -or $dbReport.projectionReady -ne $true -or $dbReport.staleDocuments -ne 0) {
  throw 'Final preproduction DB/projection acceptance state is not clean.'
}

$manifest = [ordered]@{
  version = $env:BJC_RELEASE_ID
  releaseId = $env:BJC_RELEASE_ID
  date = (Get-Date).ToUniversalTime().ToString('o')
  backendBuildId = $env:BJC_BACKEND_BUILD_ID
  frontendBuildId = $env:BJC_FRONTEND_BUILD_ID
  commitSha = if ($env:GIT_COMMIT_SHA) { $env:GIT_COMMIT_SHA } else { $null }
  migrationCount = $dbReport.appliedMigrations
  migrationStatus = 'DEPLOYED_AND_VERIFIED'
  searchProjectionVersion = (@($dbReport.projectionMigrations) -join '+')
  searchProjectionStatus = 'VERIFIED'
  acceptanceReport = $env:BJC_PREPROD_REPORT_PATH
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $manifestPath) | Out-Null
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
Write-Host "PREPROD_DEPLOY=PASS; release manifest created at $manifestPath"
