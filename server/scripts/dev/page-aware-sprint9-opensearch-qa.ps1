param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('start', 'stop', 'status')]
  [string]$Action
)

$ErrorActionPreference = 'Stop'
$runtimeRoot = 'C:\proyecto triple\_recovery-work\galilei-page-aware-ocr-research-suite9\runtime\opensearch-qa'
$distribution = 'C:\proyecto triple\_recovery-work\jurisprudencia-collation-v4-implement1\runtime\distribution-tar\opensearch-2.19.6'
$configPath = Join-Path $runtimeRoot 'config'
$dataPath = Join-Path $runtimeRoot 'data'
$logsPath = Join-Path $runtimeRoot 'logs'
$pidPath = Join-Path $runtimeRoot 'opensearch-java.pid'
$ownershipMarkerPath = Join-Path $runtimeRoot 'suite9-runtime.marker'
$httpPort = 19284
$transportPort = 19384
$processMarker = 'galilei.suite9.pageaware.qa'
$expectedOwnershipMarker = "GALILEI-SUITE9-QA|OpenSearch|2.19.6|$dataPath"

function Assert-QaRuntimeOwnership {
  if (-not (Test-Path -LiteralPath $ownershipMarkerPath)) {
    throw 'Suite 9 OpenSearch runtime ownership marker is missing.'
  }
  if ((Get-Content -Raw -LiteralPath $ownershipMarkerPath).Trim() -cne $expectedOwnershipMarker) {
    throw 'Suite 9 OpenSearch runtime ownership marker does not match the exact data path.'
  }
  foreach ($path in @($runtimeRoot, $dataPath, $ownershipMarkerPath)) {
    if (Test-Path -LiteralPath $path) {
      $item = Get-Item -LiteralPath $path -Force
      if ($item.Attributes.ToString().Contains('ReparsePoint')) {
        throw 'Suite 9 OpenSearch runtime contains an unexpected reparse point.'
      }
    }
  }
}

function Get-QaListener {
  $connection = Get-NetTCPConnection -LocalPort $httpPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $connection) { return $null }
  return Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)"
}

function Get-QaRoot {
  try { return Invoke-RestMethod -Uri "http://127.0.0.1:$httpPort" -TimeoutSec 3 }
  catch { return $null }
}

if ($Action -eq 'status') {
  Assert-QaRuntimeOwnership
  $root = Get-QaRoot
  if (-not $root) { Write-Output 'SPRINT9_OPENSEARCH_QA=STOPPED'; exit 1 }
  $listener = Get-QaListener
  if (-not $listener -or $listener.Name -ne 'java.exe' -or $listener.CommandLine -notlike "*$processMarker*") {
    throw 'Refusing to report a listener not owned by the Suite 9 QA marker.'
  }
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$httpPort/_cluster/health" -TimeoutSec 5
  [pscustomobject]@{ status = 'RUNNING'; version = $root.version.number; health = $health.status; pid = $listener.ProcessId; http = "127.0.0.1:$httpPort"; transport = "127.0.0.1:$transportPort" } | ConvertTo-Json -Compress
  exit 0
}

if ($Action -eq 'stop') {
  if (-not (Test-Path -LiteralPath $pidPath)) { Write-Output 'SPRINT9_OPENSEARCH_QA=ALREADY_STOPPED'; exit 0 }
  Assert-QaRuntimeOwnership
  $id = [int](Get-Content -Raw -LiteralPath $pidPath)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $id" -ErrorAction SilentlyContinue
  if ($process) {
    if ($process.Name -ne 'java.exe' -or $process.CommandLine -notlike "*$processMarker*") {
      throw 'Refusing to stop a process without the exact Suite 9 QA marker.'
    }
    Stop-Process -Id $id -Force
    $deadline = (Get-Date).AddSeconds(25)
    do {
      Start-Sleep -Milliseconds 250
      $remaining = Get-NetTCPConnection -LocalPort $httpPort,$transportPort -State Listen -ErrorAction SilentlyContinue
    } while ($remaining -and (Get-Date) -lt $deadline)
    if ($remaining) { throw 'Suite 9 OpenSearch listener did not stop.' }
  }
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
  Write-Output 'SPRINT9_OPENSEARCH_QA=STOPPED'
  exit 0
}

$occupied = Get-NetTCPConnection -LocalPort $httpPort,$transportPort -State Listen -ErrorAction SilentlyContinue
if ($occupied) {
  $existing = Get-QaListener
  $root = Get-QaRoot
  if ($existing -and $existing.Name -eq 'java.exe' -and $existing.CommandLine -like "*$processMarker*" -and $root -and $root.version.number -eq '2.19.6') {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$httpPort/_cluster/health?wait_for_status=green&timeout=5s" -TimeoutSec 10
    if ($health.status -eq 'green') {
      Set-Content -LiteralPath $pidPath -Value $existing.ProcessId -Encoding ASCII
      [pscustomobject]@{ status = 'ALREADY_RUNNING'; version = $root.version.number; health = $health.status; pid = $existing.ProcessId; http = "127.0.0.1:$httpPort"; transport = "127.0.0.1:$transportPort" } | ConvertTo-Json -Compress
      exit 0
    }
  }
  throw 'Suite 9 OpenSearch QA ports are occupied by an unrecognized runtime; refusing to reuse it.'
}

if (Test-Path -LiteralPath $dataPath) {
  $existingData = Get-ChildItem -LiteralPath $dataPath -Force -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($existingData) { Assert-QaRuntimeOwnership }
}
if (-not (Test-Path -LiteralPath (Join-Path $distribution 'bin\opensearch.bat')) -or
    -not (Test-Path -LiteralPath (Join-Path $distribution 'plugins\analysis-icu'))) {
  throw 'Verified OpenSearch 2.19.6 with analysis-icu is unavailable.'
}

New-Item -ItemType Directory -Path $configPath,$dataPath,$logsPath -Force | Out-Null
if (-not (Test-Path -LiteralPath $ownershipMarkerPath)) {
  Set-Content -LiteralPath $ownershipMarkerPath -Value $expectedOwnershipMarker -Encoding ASCII
}
$yaml = @"
cluster.name: galilei-suite9-page-aware-qa
node.name: suite9-page-aware-qa
path.data: "$($dataPath.Replace('\','/'))"
path.logs: "$($logsPath.Replace('\','/'))"
network.host: 127.0.0.1
http.port: $httpPort
transport.port: $transportPort
discovery.type: single-node
plugins.security.disabled: true
"@
Set-Content -LiteralPath (Join-Path $configPath 'opensearch.yml') -Value $yaml -Encoding UTF8
Set-Content -LiteralPath (Join-Path $configPath 'jvm.options') -Value "-Xms512m`r`n-Xmx512m" -Encoding ASCII
Copy-Item -LiteralPath (Join-Path $distribution 'config\log4j2.properties') -Destination (Join-Path $configPath 'log4j2.properties') -Force

$launcher = Join-Path $distribution 'bin\opensearch.bat'
$previousPathConf = $env:OPENSEARCH_PATH_CONF
$previousHome = $env:OPENSEARCH_HOME
$previousJavaOpts = $env:OPENSEARCH_JAVA_OPTS
$env:OPENSEARCH_PATH_CONF = $configPath
$env:OPENSEARCH_HOME = $distribution
$env:OPENSEARCH_JAVA_OPTS = "-D$processMarker=true"
try {
  $cmdArguments = "/d /c `"`"$launcher`"`""
  $launcherProcess = Start-Process -FilePath $env:ComSpec -ArgumentList $cmdArguments -WorkingDirectory $distribution -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logsPath 'launcher.stdout.log') -RedirectStandardError (Join-Path $logsPath 'launcher.stderr.log')
} finally {
  if ($null -eq $previousPathConf) { Remove-Item Env:OPENSEARCH_PATH_CONF -ErrorAction SilentlyContinue } else { $env:OPENSEARCH_PATH_CONF = $previousPathConf }
  if ($null -eq $previousHome) { Remove-Item Env:OPENSEARCH_HOME -ErrorAction SilentlyContinue } else { $env:OPENSEARCH_HOME = $previousHome }
  if ($null -eq $previousJavaOpts) { Remove-Item Env:OPENSEARCH_JAVA_OPTS -ErrorAction SilentlyContinue } else { $env:OPENSEARCH_JAVA_OPTS = $previousJavaOpts }
}

$deadline = (Get-Date).AddMinutes(4)
$root = $null
do {
  Start-Sleep -Seconds 2
  $root = Get-QaRoot
  if ($root) { break }
  $launcherProcess.Refresh()
  if ($launcherProcess.HasExited) {
    $stderr = Get-Content -Raw -LiteralPath (Join-Path $logsPath 'launcher.stderr.log') -ErrorAction SilentlyContinue
    throw "Suite 9 OpenSearch launcher exited before readiness. $stderr"
  }
} while ((Get-Date) -lt $deadline)
if (-not $root -or $root.version.number -ne '2.19.6') { throw 'Suite 9 OpenSearch did not become ready as version 2.19.6.' }
$health = Invoke-RestMethod -Uri "http://127.0.0.1:$httpPort/_cluster/health?wait_for_status=green&timeout=10s" -TimeoutSec 15
if ($health.status -ne 'green') { throw 'Suite 9 OpenSearch QA cluster is not GREEN.' }
$listener = Get-QaListener
if (-not $listener -or $listener.Name -ne 'java.exe' -or $listener.CommandLine -notlike "*$processMarker*") { throw 'Suite 9 OpenSearch listener identity could not be verified.' }
Set-Content -LiteralPath $pidPath -Value $listener.ProcessId -Encoding ASCII
[pscustomobject]@{ status = 'RUNNING'; version = $root.version.number; health = $health.status; pid = $listener.ProcessId; http = "127.0.0.1:$httpPort"; transport = "127.0.0.1:$transportPort"; data = $dataPath } | ConvertTo-Json -Compress
