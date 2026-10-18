param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('start', 'status', 'stop')]
  [string]$Action
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$artifactRoot = Join-Path $repoRoot '_recovery-work\search-engine-integration1\runtime'
$zipPath = Join-Path $artifactRoot 'opensearch-2.19.6-windows-x64.zip'
$extractRoot = Join-Path $artifactRoot 'extract'
$engineRoot = Join-Path $extractRoot 'opensearch-2.19.6'
$configRoot = Join-Path $artifactRoot 'config-local'
$dataRoot = Join-Path $artifactRoot 'data'
$logsRoot = Join-Path $artifactRoot 'logs'
$statePath = Join-Path $artifactRoot 'process.json'
$expectedSha512 = '42fa97660d0732684d28016ccc439bc45028133991058c6cc018c7babfccc1fd10a1b45683b252d93c49b6bc36679453cbbc990c02a44c569e2724e2e63d351e'
$downloadUrl = 'https://artifacts.opensearch.org/releases/bundle/opensearch/2.19.6/opensearch-2.19.6-windows-x64.zip'

function Get-Health {
  try {
    $response = Invoke-RestMethod -Uri 'http://127.0.0.1:9200' -TimeoutSec 3
    if ($response.version.number -ne '2.19.6') { throw 'OPENSEARCH_VERSION_MISMATCH' }
    return $response
  } catch { return $null }
}

function Save-State([int]$ProcessId) {
  $state = [ordered]@{
    pid = $ProcessId
    version = '2.19.6'
    http = '127.0.0.1:9200'
    transport = '127.0.0.1:9300'
    loopbackOnly = $true
    securityDisabled = $true
    dataPath = $dataRoot
    logsPath = $logsRoot
  }
  [IO.File]::WriteAllText($statePath, ($state | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
}

switch ($Action) {
  'status' {
    $health = Get-Health
    if (-not $health) { Write-Output 'OPENSEARCH=STOPPED'; exit 1 }
    Write-Output "OPENSEARCH=READY version=$($health.version.number) cluster=$($health.cluster_name) endpoint=127.0.0.1:9200"
  }
  'stop' {
    $state = if (Test-Path $statePath) { Get-Content -Raw $statePath | ConvertFrom-Json } else { $null }
    $pidToStop = if ($state) { [int]$state.pid } else { 0 }
    $process = if ($pidToStop -gt 0) { Get-CimInstance Win32_Process -Filter "ProcessId=$pidToStop" -ErrorAction SilentlyContinue } else { $null }
    if (-not $process -or $process.Name -ne 'java.exe' -or $process.CommandLine -notlike '*opensearch.path.home*') {
      $expectedHome = [regex]::Escape($engineRoot)
      $process = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'java.exe' -and $_.CommandLine -match $expectedHome } | Select-Object -First 1
      if (-not $process) {
        if (Get-Health) { throw 'OPENSEARCH_PROCESS_IDENTITY_UNVERIFIED' }
        Write-Output 'OPENSEARCH=STOPPED'
        exit 0
      }
    }
    if (-not ('OpenSearchLocalConsoleControl' -as [type])) {
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OpenSearchLocalConsoleControl {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint processId);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GenerateConsoleCtrlEvent(uint eventCode, uint processGroupId);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
}
'@
    }
    $null = [OpenSearchLocalConsoleControl]::FreeConsole()
    $attached = [OpenSearchLocalConsoleControl]::AttachConsole([uint32]$process.ProcessId)
    if (-not $attached) { throw 'OPENSEARCH_GRACEFUL_SIGNAL_ATTACH_FAILED' }
    $ignoreCtrlC = [OpenSearchLocalConsoleControl]::SetConsoleCtrlHandler([IntPtr]::Zero, $true)
    $sent = [OpenSearchLocalConsoleControl]::GenerateConsoleCtrlEvent(0, 0)
    $null = [OpenSearchLocalConsoleControl]::FreeConsole()
    if ($ignoreCtrlC) { $null = [OpenSearchLocalConsoleControl]::SetConsoleCtrlHandler([IntPtr]::Zero, $false) }
    if (-not $sent) { throw 'OPENSEARCH_GRACEFUL_SIGNAL_FAILED' }
    $deadline = (Get-Date).AddSeconds(30)
    do { Start-Sleep -Milliseconds 500 } while ((Get-Health) -and (Get-Date) -lt $deadline)
    if (Get-Health) { throw 'OPENSEARCH_STOP_TIMEOUT' }
    Write-Output "OPENSEARCH=STOPPED_GRACEFULLY pid=$($process.ProcessId)"
  }
  'start' {
    if (Get-Health) { Write-Output 'OPENSEARCH=ALREADY_READY version=2.19.6 endpoint=127.0.0.1:9200'; exit 0 }
    New-Item -ItemType Directory -Force -Path $artifactRoot,$dataRoot,$logsRoot | Out-Null
    if (-not (Test-Path $zipPath)) { Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath }
    $sha512 = [System.Security.Cryptography.SHA512]::Create()
    $zipStream = [System.IO.File]::OpenRead($zipPath)
    try {
      $hashBytes = $sha512.ComputeHash($zipStream)
      $actualSha512 = -join ($hashBytes | ForEach-Object { $_.ToString('x2') })
    } finally {
      $zipStream.Dispose()
      $sha512.Dispose()
    }
    if ($actualSha512 -ne $expectedSha512) { throw 'OPENSEARCH_SHA512_MISMATCH' }
    if (-not (Test-Path (Join-Path $engineRoot 'bin\opensearch.bat'))) {
      New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
      Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force
    }
    if (-not (Test-Path $configRoot)) {
      New-Item -ItemType Directory -Force -Path $configRoot | Out-Null
      Copy-Item -Path (Join-Path $engineRoot 'config\*') -Destination $configRoot -Recurse -Force
    }
    $yaml = @"
cluster.name: galilei-integration-local
node.name: galilei-integration-local-1
network.host: 127.0.0.1
http.host: 127.0.0.1
http.port: 9200
transport.host: 127.0.0.1
transport.port: 9300
discovery.type: single-node
path.data: '$($dataRoot.Replace('\','/'))'
path.logs: '$($logsRoot.Replace('\','/'))'
node.pidfile: '$((Join-Path $artifactRoot 'opensearch.pid').Replace('\','/'))'
bootstrap.ctrlhandler: true
plugins.security.disabled: true
"@
    [IO.File]::WriteAllText((Join-Path $configRoot 'opensearch.yml'), $yaml, [Text.UTF8Encoding]::new($false))
    $env:OPENSEARCH_JAVA_HOME = Join-Path $engineRoot 'jdk'
    $env:OPENSEARCH_PATH_CONF = $configRoot
    $env:OPENSEARCH_JAVA_OPTS = '-Xms1g -Xmx1g'
    $null = Start-Process -FilePath (Join-Path $engineRoot 'bin\opensearch.bat') -WorkingDirectory $engineRoot -WindowStyle Hidden -PassThru
    $deadline = (Get-Date).AddSeconds(120)
    $health = $null
    do {
      $health = Get-Health
      if ($health) { break }
      Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    if (-not $health) { throw 'OPENSEARCH_START_TIMEOUT; inspect runtime/logs' }
    $expectedHome = [regex]::Escape($engineRoot)
    $java = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'java.exe' -and $_.CommandLine -match $expectedHome } | Select-Object -First 1
    if (-not $java) { throw 'OPENSEARCH_JAVA_PROCESS_NOT_FOUND' }
    Save-State -ProcessId $java.ProcessId
    Write-Output "OPENSEARCH=STARTED version=$($health.version.number) endpoint=127.0.0.1:9200 pid=$($java.ProcessId) sha512=PASS"
  }
}
