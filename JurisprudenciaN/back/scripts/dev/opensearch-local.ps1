param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('preflight', 'start', 'status', 'stop')]
  [string]$Action
)

$ErrorActionPreference = 'Stop'
$baseUri = 'http://127.0.0.1:9200'
$expectedVersion = '2.19.6'
$expectedIcuVersion = '2.19.6'
$expectedIcu4jVersion = '75.1'
$expectedV3 = if ($env:BJC_OPENSEARCH_EXPECTED_V3) { $env:BJC_OPENSEARCH_EXPECTED_V3 } else { 'galilei-search-v003-20261017t232432555z-a6af18cb' }
$expectedV4 = if ($env:BJC_OPENSEARCH_EXPECTED_V4) { $env:BJC_OPENSEARCH_EXPECTED_V4 } else { 'galilei-search-v004-20261020t094732495z-6015e394' }
$expectedActiveTarget = if ($env:BJC_OPENSEARCH_EXPECTED_ACTIVE_TARGET) { $env:BJC_OPENSEARCH_EXPECTED_ACTIVE_TARGET } else { $expectedV3 }
$expectedDocuments = if ($env:BJC_OPENSEARCH_EXPECTED_DOCUMENT_COUNT) { [int]$env:BJC_OPENSEARCH_EXPECTED_DOCUMENT_COUNT } else { 69313 }
if ($expectedActiveTarget -notin @($expectedV3, $expectedV4)) { throw 'OPENSEARCH_EXPECTED_ACTIVE_TARGET_INVALID' }

function Get-RequiredPath([string]$Name, [string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { throw "OPENSEARCH_${Name}_REQUIRED" }
  try { return (Resolve-Path -LiteralPath $Value).Path }
  catch { throw "OPENSEARCH_${Name}_PATH_MISSING" }
}

function Normalize-Path([string]$Path) {
  $value = [Environment]::ExpandEnvironmentVariables($Path.Trim().Trim('"', "'"))
  return [IO.Path]::GetFullPath($value).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}

function Get-RuntimePaths {
  $opensearchHome = Get-RequiredPath 'HOME' $env:OPENSEARCH_HOME
  $conf = Get-RequiredPath 'CONFIG_PATH' $env:OPENSEARCH_PATH_CONF
  $data = Get-RequiredPath 'DATA_PATH' $env:BJC_OPENSEARCH_DATA_PATH
  if (-not (Test-Path -LiteralPath (Join-Path $opensearchHome 'bin\opensearch.bat'))) { throw 'OPENSEARCH_HOME_INVALID' }
  if (-not (Test-Path -LiteralPath (Join-Path $conf 'opensearch.yml'))) { throw 'OPENSEARCH_CONFIG_INVALID' }
  if (-not (Test-Path -LiteralPath (Join-Path $conf 'jvm.options'))) { throw 'OPENSEARCH_JVM_OPTIONS_MISSING' }
  if (-not (Test-Path -LiteralPath (Join-Path $data 'nodes\0'))) { throw 'OPENSEARCH_EXISTING_DATA_PATH_REQUIRED' }
  $yaml = Get-Content -LiteralPath (Join-Path $conf 'opensearch.yml') -Raw
  $dataLine = [regex]::Match($yaml, '(?m)^\s*path\.data\s*:\s*(.+?)\s*$')
  if (-not $dataLine.Success) { throw 'OPENSEARCH_CONFIG_DATA_PATH_MISSING' }
  $configuredData = Normalize-Path $dataLine.Groups[1].Value
  if (-not [string]::Equals($configuredData, (Normalize-Path $data), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'OPENSEARCH_CONFIG_DATA_PATH_MISMATCH'
  }
  return [pscustomobject]@{ Home = $opensearchHome; Config = $conf; Data = $data }
}

function Assert-PluginAndHeap($Paths) {
  $pluginRoot = Join-Path $Paths.Home 'plugins\analysis-icu'
  $descriptorPath = Join-Path $pluginRoot 'plugin-descriptor.properties'
  if (-not (Test-Path -LiteralPath $descriptorPath)) { throw 'OPENSEARCH_ANALYSIS_ICU_MISSING' }
  $descriptor = Get-Content -LiteralPath $descriptorPath
  $pluginName = (($descriptor | Where-Object { $_ -match '^name=' } | Select-Object -First 1) -replace '^name=', '').Trim()
  $pluginVersion = (($descriptor | Where-Object { $_ -match '^version=' } | Select-Object -First 1) -replace '^version=', '').Trim()
  $icuJar = Join-Path $pluginRoot "icu4j-$expectedIcu4jVersion.jar"
  if ($pluginName -ne 'analysis-icu' -or $pluginVersion -ne $expectedIcuVersion -or -not (Test-Path -LiteralPath $icuJar)) {
    throw 'OPENSEARCH_ANALYSIS_ICU_VERSION_MISMATCH'
  }

  $activeHeap = @(Get-Content -LiteralPath (Join-Path $Paths.Config 'jvm.options') | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^-Xm[sx]' })
  if (($activeHeap -notcontains '-Xms2g') -or ($activeHeap -notcontains '-Xmx2g') -or @($activeHeap | Where-Object { $_ -notin @('-Xms2g', '-Xmx2g') }).Count -gt 0) {
    throw 'OPENSEARCH_JVM_OPTIONS_MUST_BE_EXACTLY_2G'
  }
  if (-not [string]::IsNullOrWhiteSpace($env:OPENSEARCH_JAVA_OPTS)) {
    $specifiedHeap = @($env:OPENSEARCH_JAVA_OPTS -split '\s+' | Where-Object { $_ -match '^-Xm[sx]' })
    if (($specifiedHeap -notcontains '-Xms2g') -or ($specifiedHeap -notcontains '-Xmx2g') -or @($specifiedHeap | Where-Object { $_ -notin @('-Xms2g', '-Xmx2g') }).Count -gt 0) {
      throw 'OPENSEARCH_JAVA_OPTS_MUST_BE_EXACTLY_2G'
    }
  }
}

function Get-OpenSearchProcesses {
  return @(Get-CimInstance Win32_Process -Filter "Name='java.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'org\.opensearch\.bootstrap\.OpenSearch' })
}

function Ensure-ConsoleControlType {
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
}

function Get-ClusterSummary {
  $root = Invoke-RestMethod -Uri $baseUri -TimeoutSec 5
  if ($root.version.number -ne $expectedVersion) { throw 'OPENSEARCH_VERSION_MISMATCH' }

  $health = Invoke-RestMethod -Uri "$baseUri/_cluster/health" -TimeoutSec 5
  if ($health.status -ne 'green') { throw 'OPENSEARCH_CLUSTER_NOT_GREEN' }
  if ($health.initializing_shards -ne 0 -or $health.unassigned_shards -ne 0) { throw 'OPENSEARCH_SHARDS_NOT_READY' }

  $nodes = Invoke-RestMethod -Uri "$baseUri/_nodes/_local?filter_path=nodes.*.settings.path.data,nodes.*.version,nodes.*.build_hash" -TimeoutSec 5
  $jvm = Invoke-RestMethod -Uri "$baseUri/_nodes/_local/jvm" -TimeoutSec 5
  $node = $nodes.nodes.PSObject.Properties.Value | Select-Object -First 1
  $jvmNode = $jvm.nodes.PSObject.Properties.Value | Select-Object -First 1
  if (-not $node -or -not $jvmNode) { throw 'OPENSEARCH_LOCAL_NODE_NOT_FOUND' }
  $dataPaths = @($node.settings.path.data | ForEach-Object { Normalize-Path $_ })
  if ($dataPaths.Count -ne 1 -or -not [string]::Equals($dataPaths[0], (Normalize-Path $env:BJC_OPENSEARCH_DATA_PATH), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'OPENSEARCH_RUNTIME_DATA_PATH_MISMATCH'
  }
  if ($jvmNode.jvm.mem.heap_init_in_bytes -ne 2147483648 -or $jvmNode.jvm.mem.heap_max_in_bytes -ne 2147483648 -or $jvmNode.jvm.input_arguments -notcontains '-Xms2g' -or $jvmNode.jvm.input_arguments -notcontains '-Xmx2g') {
    throw 'OPENSEARCH_RUNTIME_HEAP_MISMATCH'
  }
  $homeArgument = "-Dopensearch.path.home=$(Normalize-Path $env:OPENSEARCH_HOME)"
  $configArgument = "-Dopensearch.path.conf=$(Normalize-Path $env:OPENSEARCH_PATH_CONF)"
  if (-not (@($jvmNode.jvm.input_arguments | Where-Object { [string]::Equals($_, $homeArgument, [StringComparison]::OrdinalIgnoreCase) }).Count -eq 1) -or -not (@($jvmNode.jvm.input_arguments | Where-Object { [string]::Equals($_, $configArgument, [StringComparison]::OrdinalIgnoreCase) }).Count -eq 1)) {
    throw 'OPENSEARCH_RUNTIME_HOME_OR_CONFIG_MISMATCH'
  }

  $plugins = Invoke-RestMethod -Uri "$baseUri/_cat/plugins?format=json" -TimeoutSec 5
  $icu = @($plugins | Where-Object { $_.component -eq 'analysis-icu' -and $_.version -eq $expectedIcuVersion })
  if ($icu.Count -ne 1) { throw 'OPENSEARCH_RUNTIME_ANALYSIS_ICU_MISSING_OR_MISMATCH' }

  $indices = Invoke-RestMethod -Uri "$baseUri/_cat/indices/${expectedV3},${expectedV4}?format=json&h=index,status,health,docs.count" -TimeoutSec 5
  $v3 = @($indices | Where-Object { $_.index -eq $expectedV3 -and $_.status -eq 'open' -and $_.health -eq 'green' })
  $v4 = @($indices | Where-Object { $_.index -eq $expectedV4 -and $_.status -eq 'open' -and $_.health -eq 'green' })
  if ($v3.Count -ne 1 -or $v4.Count -ne 1) { throw 'OPENSEARCH_V3_V4_IDENTITY_MISMATCH' }
  if ([long]$v3[0].'docs.count' -ne $expectedDocuments -or [long]$v4[0].'docs.count' -ne $expectedDocuments) {
    throw 'OPENSEARCH_V3_V4_DOCUMENT_COUNT_MISMATCH'
  }

  $aliases = @(Invoke-RestMethod -Uri "$baseUri/_cat/aliases?format=json&h=alias,index,is_write_index" -TimeoutSec 5 | Where-Object { $_.alias -eq 'galilei-search-active' })
  if ($aliases.Count -ne 1 -or $aliases[0].index -ne $expectedActiveTarget -or $aliases[0].is_write_index -ne 'true') {
    throw 'OPENSEARCH_ACTIVE_ALIAS_TARGET_MISMATCH'
  }

  return [pscustomobject]@{
    version = $root.version.number
    build = $root.version.build_hash
    health = $health.status
    heapInitBytes = $jvmNode.jvm.mem.heap_init_in_bytes
    heapMaxBytes = $jvmNode.jvm.mem.heap_max_in_bytes
    heapArgs = @($jvmNode.jvm.input_arguments | Where-Object { $_ -match '^-Xm[sx]' })
    analysisIcu = $icu[0].version
    icu4j = $expectedIcu4jVersion
    dataPath = $dataPaths[0]
    v3 = $expectedV3
    v3Documents = [long]$v3[0].'docs.count'
    v4 = $expectedV4
    v4Documents = [long]$v4[0].'docs.count'
    activeTarget = $expectedActiveTarget
    alias = "$($aliases[0].alias) -> $($aliases[0].index)"
  }
}

function Test-Endpoint {
  try { $null = Invoke-RestMethod -Uri $baseUri -TimeoutSec 2; return $true }
  catch { return $false }
}

function Stop-OpenSearchSafely($Paths) {
  $processes = @(Get-OpenSearchProcesses)
  if (-not (Test-Endpoint)) {
    if ($processes.Count -gt 0) { throw 'OPENSEARCH_RUNNING_IDENTITY_UNVERIFIED' }
    $listeners = @(Get-NetTCPConnection -LocalPort 9200,9300 -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) { throw 'OPENSEARCH_PORT_CONFLICT' }
    Write-Output 'OPENSEARCH=STOPPED'
    return
  }
  $null = Get-ClusterSummary
  $expectedHome = [regex]::Escape($Paths.Home)
  $expectedConf = [regex]::Escape($Paths.Config)
  $matchingProcesses = @($processes | Where-Object { $_.CommandLine -match $expectedHome -and $_.CommandLine -match $expectedConf })
  if ($matchingProcesses.Count -ne 1 -or $processes.Count -ne 1) {
    throw "OPENSEARCH_PROCESS_IDENTITY_UNVERIFIED; discovered=$($processes.Count); matching=$($matchingProcesses.Count)"
  }
  $process = $matchingProcesses[0]

  Ensure-ConsoleControlType
  $null = [OpenSearchLocalConsoleControl]::FreeConsole()
  if (-not [OpenSearchLocalConsoleControl]::AttachConsole([uint32]$process.ProcessId)) { throw 'OPENSEARCH_GRACEFUL_SIGNAL_ATTACH_FAILED' }
  $ignoreCtrlC = [OpenSearchLocalConsoleControl]::SetConsoleCtrlHandler([IntPtr]::Zero, $true)
  $sent = [OpenSearchLocalConsoleControl]::GenerateConsoleCtrlEvent(0, 0)
  $null = [OpenSearchLocalConsoleControl]::FreeConsole()
  if ($ignoreCtrlC) { $null = [OpenSearchLocalConsoleControl]::SetConsoleCtrlHandler([IntPtr]::Zero, $false) }
  if (-not $sent) { throw 'OPENSEARCH_GRACEFUL_SIGNAL_FAILED' }
  $deadline = (Get-Date).AddSeconds(60)
  do {
    Start-Sleep -Milliseconds 500
    $stillRunning = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ProcessId)" -ErrorAction SilentlyContinue
  } while ($stillRunning -and (Get-Date) -lt $deadline)
  if ($stillRunning -or (Test-Endpoint)) { throw 'OPENSEARCH_STOP_TIMEOUT' }
  Write-Output "OPENSEARCH=STOPPED_GRACEFULLY pid=$($process.ProcessId)"
}

function Start-OpenSearchSafely($Paths) {
  if (Test-Endpoint) {
    $summary = Get-ClusterSummary
    Write-Output "OPENSEARCH=ALREADY_READY version=$($summary.version) health=$($summary.health) dataPath=$($summary.dataPath)"
    return
  }
  $processes = Get-OpenSearchProcesses
  if ($processes.Count -gt 0) { throw 'OPENSEARCH_COMPETING_PROCESS_PRESENT' }
  $listeners = @(Get-NetTCPConnection -LocalPort 9200,9300 -State Listen -ErrorAction SilentlyContinue)
  if ($listeners.Count -gt 0) { throw 'OPENSEARCH_PORT_CONFLICT' }

  Assert-PluginAndHeap $Paths
  Write-Output "OPENSEARCH_DATA_PATH=$($Paths.Data)"
  $env:OPENSEARCH_JAVA_HOME = Join-Path $Paths.Home 'jdk'
  $env:OPENSEARCH_PATH_CONF = $Paths.Config
  $env:OPENSEARCH_JAVA_OPTS = '-Xms2g -Xmx2g'
  if (-not $env:OPENSEARCH_TMPDIR) { $env:OPENSEARCH_TMPDIR = Join-Path $env:TEMP 'opensearch' }
  New-Item -ItemType Directory -Force -Path $env:OPENSEARCH_TMPDIR | Out-Null
  $null = Start-Process -FilePath (Join-Path $Paths.Home 'bin\opensearch.bat') -WorkingDirectory $Paths.Home -WindowStyle Hidden -PassThru
  $deadline = (Get-Date).AddSeconds(180)
  do {
    try {
      $health = Invoke-RestMethod -Uri "$baseUri/_cluster/health" -TimeoutSec 3
      if ($health.status -eq 'green' -and $health.initializing_shards -eq 0 -and $health.unassigned_shards -eq 0) {
        $summary = Get-ClusterSummary
      Write-Output "OPENSEARCH=STARTED version=$($summary.version) health=$($summary.health) heap=2GiB ICU=$($summary.analysisIcu)/ICU4J-$($summary.icu4j) dataPath=$($summary.dataPath) alias=$($summary.alias)"
        return
      }
    } catch {
      if ($_.Exception.Message -match '^OPENSEARCH_(?:VERSION|RUNTIME|ACTIVE|V3|ANALYSIS|CLUSTER|SHARDS)') { throw }
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw 'OPENSEARCH_START_TIMEOUT; inspect the configured runtime logs.'
}

try {
  $paths = Get-RuntimePaths
  switch ($Action) {
    'preflight' {
      Assert-PluginAndHeap $paths
      Write-Output "OPENSEARCH_PREFLIGHT=PASS version=$expectedVersion ICU=$expectedIcuVersion/ICU4J-$expectedIcu4jVersion heap=2GiB dataPath=$($paths.Data)"
    }
    'status' {
      $summary = Get-ClusterSummary
      Write-Output ("OPENSEARCH=SAFE version={0} build={1} health={2} ICU={3}/ICU4J-{4} heap=2GiB dataPath={5} V3={6}:{7} V4={8}:{9} activeTarget={10} alias={11}" -f $summary.version,$summary.build,$summary.health,$summary.analysisIcu,$summary.icu4j,$summary.dataPath,$summary.v3,$summary.v3Documents,$summary.v4,$summary.v4Documents,$summary.activeTarget,$summary.alias)
    }
    'stop' { Stop-OpenSearchSafely $paths }
    'start' { Start-OpenSearchSafely $paths }
  }
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
