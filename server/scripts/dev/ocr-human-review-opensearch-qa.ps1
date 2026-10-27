param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('start', 'stop', 'status')]
  [string]$Action
)

$ErrorActionPreference = 'Stop'
$runtimeRoot = 'C:\proyecto triple\_recovery-work\galilei-ocr-human-review-suite8\runtime\opensearch-qa'
$distribution = 'C:\proyecto triple\_recovery-work\jurisprudencia-collation-v4-implement1\runtime\distribution-tar\opensearch-2.19.6'
$configPath = Join-Path $runtimeRoot 'config'
$dataPath = Join-Path $runtimeRoot 'data'
$logsPath = Join-Path $runtimeRoot 'logs'
$pidPath = Join-Path $runtimeRoot 'opensearch-java.pid'
$httpPort = 19284
$transportPort = 19384
$processMarker = 'galilei.suite8.ocr.qa'

function Get-QaListener {
  $connection = Get-NetTCPConnection -LocalPort $httpPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $connection) { return $null }
  return Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)"
}

function Test-QaHttp {
  try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$httpPort" -TimeoutSec 2
    return $response
  } catch { return $null }
}

if ($Action -eq 'status') {
  $response = Test-QaHttp
  if (-not $response) { Write-Output 'SPRINT8_OPENSEARCH_QA=STOPPED'; exit 1 }
  $listener = Get-QaListener
  if (-not $listener -or $listener.CommandLine -notlike "*$processMarker*") { throw 'Refusing to report a listener not owned by the Suite 8 QA marker.' }
  [pscustomobject]@{ status = 'RUNNING'; version = $response.version.number; pid = $listener.ProcessId; http = "127.0.0.1:$httpPort"; transport = "127.0.0.1:$transportPort" } | ConvertTo-Json -Compress
  exit 0
}

if ($Action -eq 'stop') {
  if (-not (Test-Path -LiteralPath $pidPath)) { Write-Output 'SPRINT8_OPENSEARCH_QA=ALREADY_STOPPED'; exit 0 }
  $id = [int](Get-Content -Raw -LiteralPath $pidPath)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $id" -ErrorAction SilentlyContinue
  if ($process) {
    if ($process.Name -ne 'java.exe' -or $process.CommandLine -notlike "*$processMarker*") { throw 'Refusing to stop a process without the exact Suite 8 QA marker.' }
    Stop-Process -Id $id -Force
    $deadline = (Get-Date).AddSeconds(20)
    do {
      Start-Sleep -Milliseconds 250
      $remaining = Get-NetTCPConnection -LocalPort $httpPort,$transportPort -State Listen -ErrorAction SilentlyContinue
    } while ($remaining -and (Get-Date) -lt $deadline)
    if ($remaining) { throw 'Suite 8 OpenSearch listener did not stop.' }
  }
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
  Write-Output 'SPRINT8_OPENSEARCH_QA=STOPPED'
  exit 0
}

if (Get-NetTCPConnection -LocalPort $httpPort,$transportPort -State Listen -ErrorAction SilentlyContinue) {
  $existing = Get-QaListener
  if ($existing -and $existing.Name -eq 'java.exe' -and $existing.CommandLine -like "*$processMarker*") {
    $response = Test-QaHttp
    if ($response -and $response.version.number -eq '2.19.6') {
      Set-Content -LiteralPath $pidPath -Value $existing.ProcessId -Encoding ASCII
      [pscustomobject]@{ status = 'ALREADY_RUNNING'; version = $response.version.number; pid = $existing.ProcessId; http = "127.0.0.1:$httpPort"; transport = "127.0.0.1:$transportPort" } | ConvertTo-Json -Compress
      exit 0
    }
  }
  throw 'Suite 8 OpenSearch QA ports are already occupied; refusing to reuse an unknown process.'
}
if (-not (Test-Path -LiteralPath (Join-Path $distribution 'bin\opensearch.bat')) -or
    -not (Test-Path -LiteralPath (Join-Path $distribution 'plugins\analysis-icu'))) {
  throw 'The verified local OpenSearch 2.19.6 distribution with analysis-icu is unavailable.'
}

New-Item -ItemType Directory -Path $configPath,$dataPath,$logsPath -Force | Out-Null
$yaml = @"
cluster.name: galilei-suite8-ocr-qa
node.name: suite8-ocr-qa
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
$response = $null
do {
  Start-Sleep -Seconds 2
  $response = Test-QaHttp
  if ($response) { break }
  $launcherProcess.Refresh()
  if ($launcherProcess.HasExited) {
    $stderr = Get-Content -Raw -LiteralPath (Join-Path $logsPath 'launcher.stderr.log') -ErrorAction SilentlyContinue
    throw "Suite 8 OpenSearch launcher exited before readiness. $stderr"
  }
} while ((Get-Date) -lt $deadline)
if (-not $response -or $response.version.number -ne '2.19.6') { throw 'Suite 8 OpenSearch did not become ready as version 2.19.6.' }
$health = Invoke-RestMethod -Uri "http://127.0.0.1:$httpPort/_cluster/health?wait_for_status=green&timeout=10s" -TimeoutSec 15
if ($health.status -ne 'green') { throw 'Suite 8 OpenSearch QA cluster is not GREEN.' }
$listener = Get-QaListener
if (-not $listener -or $listener.Name -ne 'java.exe' -or $listener.CommandLine -notlike "*$processMarker*") { throw 'Suite 8 listener identity could not be verified.' }
Set-Content -LiteralPath $pidPath -Value $listener.ProcessId -Encoding ASCII
[pscustomobject]@{ status = 'RUNNING'; version = $response.version.number; health = $health.status; pid = $listener.ProcessId; http = "127.0.0.1:$httpPort"; transport = "127.0.0.1:$transportPort"; data = $dataPath } | ConvertTo-Json -Compress
