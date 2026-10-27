param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('start', 'status', 'stop')]
  [string]$Action
)

$ErrorActionPreference = 'Stop'
$runtimeRoot = 'C:\proyecto triple\_recovery-work\galilei-page-aware-ocr-research-suite9\runtime\postgres-qa'
$dataPath = Join-Path $runtimeRoot 'data'
$logPath = Join-Path $runtimeRoot 'postgres.log'
$qaEnvPath = 'C:\proyecto triple\_recovery-work\galilei-page-aware-ocr-research-suite9\qa.env'
$port = 55435
$bin = 'C:\Program Files\PostgreSQL\16\bin'
$initdb = Join-Path $bin 'initdb.exe'
$pgCtl = Join-Path $bin 'pg_ctl.exe'
$psql = Join-Path $bin 'psql.exe'
$createdb = Join-Path $bin 'createdb.exe'
$databaseNames = @(
  'galilei_page_aware_suite9_fresh',
  'galilei_page_aware_suite9_from37',
  'galilei_page_aware_suite9_from38',
  'galilei_page_aware_suite9_from39'
)

function Assert-QaDataPath {
  if (-not (Test-Path -LiteralPath $runtimeRoot)) { throw 'Suite 9 PostgreSQL QA runtime is absent.' }
  $root = (Resolve-Path -LiteralPath $runtimeRoot).Path
  if ($root -ne $runtimeRoot -or (Get-Item -LiteralPath $root).Attributes.ToString().Contains('ReparsePoint')) {
    throw 'Suite 9 PostgreSQL QA runtime path failed the exact-path/reparse-point check.'
  }
  if (-not (Test-Path -LiteralPath $dataPath)) { throw 'Suite 9 PostgreSQL QA data path is absent.' }
}

if ($Action -eq 'start') {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    throw 'PostgreSQL QA port 55435 is already occupied; refusing to reuse it.'
  }
  if (-not (Test-Path -LiteralPath $initdb) -or -not (Test-Path -LiteralPath $pgCtl) -or -not (Test-Path -LiteralPath $psql) -or -not (Test-Path -LiteralPath $createdb)) {
    throw 'PostgreSQL 16 native tools are unavailable at the verified installation path.'
  }
  if (Test-Path -LiteralPath $dataPath) {
    $existingData = Get-ChildItem -LiteralPath $dataPath -Force -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existingData) { throw 'Suite 9 PostgreSQL QA data path already contains data; refusing to reuse it.' }
  }
  New-Item -ItemType Directory -Path $runtimeRoot,$dataPath -Force | Out-Null
  & $initdb --pgdata=$dataPath --username=postgres --encoding=UTF8 --auth-local=trust --auth-host=trust
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL initdb failed with exit $LASTEXITCODE." }
  & $pgCtl -D $dataPath -l $logPath -o "-h 127.0.0.1 -p $port -c listen_addresses=127.0.0.1" -w start
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL QA failed to start with exit $LASTEXITCODE." }

  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
  }
  finally { $rng.Dispose() }
  $password = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  $roleSql = "CREATE ROLE bjc_dev WITH LOGIN SUPERUSER PASSWORD '$password';"
  & $psql -h 127.0.0.1 -p $port -U postgres -d postgres -X -v ON_ERROR_STOP=1 -c $roleSql
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL QA role creation failed with exit $LASTEXITCODE." }
  foreach ($database in $databaseNames) {
    & $createdb -h 127.0.0.1 -p $port -U postgres -O bjc_dev $database
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL QA database creation failed for $database with exit $LASTEXITCODE." }
  }
  $url = "postgresql://bjc_dev:$password@127.0.0.1:$port/galilei_page_aware_suite9_fresh"
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($qaEnvPath, "DATABASE_URL=$url`n", $utf8)
  [pscustomobject]@{ status = 'RUNNING'; version = '16'; host = '127.0.0.1'; port = $port; data = $dataPath; databases = $databaseNames; role = 'bjc_dev'; credentials = 'stored in isolated qa.env; not emitted' } | ConvertTo-Json -Compress
  exit 0
}

Assert-QaDataPath
if ($Action -eq 'status') {
  & $pgCtl -D $dataPath status
  if ($LASTEXITCODE -ne 0) { throw 'Suite 9 PostgreSQL QA cluster is not running.' }
  $serverPid = [int](Get-Content -LiteralPath (Join-Path $dataPath 'postmaster.pid') -TotalCount 1)
  $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $listener -or $listener.OwningProcess -ne $serverPid) { throw 'Suite 9 PostgreSQL QA listener identity did not match its data-directory PID.' }
  $identity = (& $psql -h 127.0.0.1 -p $port -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc "select current_setting('server_version'), current_setting('port'), current_setting('data_directory')") -join ''
  if ($LASTEXITCODE -ne 0) { throw 'Suite 9 PostgreSQL QA read-only identity query failed.' }
  $identityParts = $identity.Trim() -split '\|'
  $expectedDataPath = $dataPath.Replace('\', '/')
  if ($identityParts.Count -ne 3 -or $identityParts[0] -notmatch '^16\.' -or $identityParts[1] -ne '55435' -or $identityParts[2].TrimEnd('/') -ine $expectedDataPath.TrimEnd('/')) {
    throw 'Suite 9 PostgreSQL QA server version, port, or data path did not match the isolated target.'
  }
  Write-Output "POSTGRES_QA_IDENTITY=$($identityParts -join '|')"
  exit 0
}

$postmasterPidPath = Join-Path $dataPath 'postmaster.pid'
if (-not (Test-Path -LiteralPath $postmasterPidPath)) { Write-Output 'SPRINT9_POSTGRES_QA=ALREADY_STOPPED'; exit 0 }
$expectedPid = [int](Get-Content -LiteralPath $postmasterPidPath -TotalCount 1)
$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener -and $listener.OwningProcess -ne $expectedPid) { throw 'Port 55435 is owned by a process outside this exact QA data directory; refusing to stop it.' }
& $pgCtl -D $dataPath -m fast -w stop
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL QA stop failed with exit $LASTEXITCODE." }
if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw 'Suite 9 PostgreSQL QA listener remains active after stop.' }
Write-Output 'SPRINT9_POSTGRES_QA=STOPPED'
