param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('preflight', 'start', 'status', 'stop')]
  [string]$Action,
  [string]$RuntimeRoot = $env:BJC_SEARCH_FRESH_RUNTIME_ROOT,
  [int]$HttpPort = 19200,
  [int]$TransportPort = 19300
)

$ErrorActionPreference = 'Stop'
$expectedVersion = '2.19.6'
$expectedIcu = '2.19.6'
$expectedIcu4j = '75.1'
$expectedHeap = 2147483648

function Resolve-RequiredPath([string]$Name, [string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { throw "FRESH_RUNTIME_${Name}_REQUIRED" }
  try { return (Resolve-Path -LiteralPath $Value).Path }
  catch { throw "FRESH_RUNTIME_${Name}_PATH_MISSING" }
}

function Get-RuntimeConfig {
  if ([string]::IsNullOrWhiteSpace($RuntimeRoot) -or -not [IO.Path]::IsPathRooted($RuntimeRoot)) {
    throw 'FRESH_RUNTIME_ROOT_ABSOLUTE_PATH_REQUIRED'
  }
  $opensearchHome = Resolve-RequiredPath 'HOME' $env:OPENSEARCH_HOME
  if (-not (Test-Path -LiteralPath (Join-Path $opensearchHome 'bin\opensearch.bat'))) { throw 'FRESH_RUNTIME_HOME_INVALID' }
  $pluginRoot = Join-Path $opensearchHome 'plugins\analysis-icu'
  $descriptor = Join-Path $pluginRoot 'plugin-descriptor.properties'
  $jar = Join-Path $pluginRoot "icu4j-$expectedIcu4j.jar"
  if (-not (Test-Path -LiteralPath $descriptor)) { throw 'FRESH_RUNTIME_ICU_MISSING' }
  $pluginText = Get-Content -LiteralPath $descriptor
  $pluginName = (($pluginText | Where-Object { $_ -match '^name=' } | Select-Object -First 1) -replace '^name=', '').Trim()
  $pluginVersion = (($pluginText | Where-Object { $_ -match '^version=' } | Select-Object -First 1) -replace '^version=', '').Trim()
  if ($pluginName -ne 'analysis-icu' -or $pluginVersion -ne $expectedIcu -or -not (Test-Path -LiteralPath $jar)) {
    throw 'FRESH_RUNTIME_ICU_VERSION_MISMATCH'
  }
  $root = [IO.Path]::GetFullPath($RuntimeRoot).TrimEnd('\','/')
  if ([string]::Equals($root, $opensearchHome, [StringComparison]::OrdinalIgnoreCase)) { throw 'FRESH_RUNTIME_PATH_COLLISION' }
  return [pscustomobject]@{
    Home = $opensearchHome
    Root = $root
    Config = Join-Path $root 'config'
    Data = Join-Path $root 'data'
    Logs = Join-Path $root 'logs'
    Temp = Join-Path $root 'tmp'
    Marker = Join-Path $root 'fresh-runtime.json'
    HttpPort = $HttpPort
    TransportPort = $TransportPort
  }
}

function Test-PortAvailable([int]$Port) {
  $listener = $null
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), $Port)
    $listener.Start()
    return $true
  } catch { return $false }
  finally { if ($listener) { $listener.Stop() } }
}

function Get-FreePort([int]$Start, [int]$End, [int]$Except) {
  for ($port = $Start; $port -le $End; $port++) {
    if ($port -ne $Except -and (Test-PortAvailable $port)) { return $port }
  }
  throw 'FRESH_RUNTIME_NO_FREE_LOOPBACK_PORT'
}

function Get-Marker($Paths) {
  if (-not (Test-Path -LiteralPath $Paths.Marker)) { throw 'FRESH_RUNTIME_MARKER_MISSING' }
  $marker = Get-Content -LiteralPath $Paths.Marker -Raw | ConvertFrom-Json
  if (
    $marker.version -ne 1 -or
    [IO.Path]::GetFullPath([string]$marker.home) -ne $Paths.Home -or
    [IO.Path]::GetFullPath([string]$marker.configPath) -ne $Paths.Config -or
    [IO.Path]::GetFullPath([string]$marker.dataPath) -ne $Paths.Data -or
    [IO.Path]::GetFullPath([string]$marker.logsPath) -ne $Paths.Logs -or
    [int]$marker.httpPort -lt 1024 -or
    [int]$marker.transportPort -lt 1024 -or
    $marker.httpPort -eq $marker.transportPort
  ) { throw 'FRESH_RUNTIME_MARKER_IDENTITY_MISMATCH' }
  return $marker
}

function Invoke-JsonApi([string]$Uri) {
  $response = Invoke-WebRequest -Uri $Uri -TimeoutSec 5 -UseBasicParsing
  if ([string]::IsNullOrWhiteSpace($response.Content)) { return }
  $value = ConvertFrom-Json -InputObject $response.Content
  if ($value -is [Array]) { foreach ($item in $value) { $item } }
  else { $value }
}

function Get-ClusterSummary($Paths, $Marker) {
  $baseUri = [string]$Marker.endpoint
  $root = Invoke-JsonApi $baseUri
  $health = Invoke-JsonApi "$baseUri/_cluster/health"
  $plugins = @(Invoke-JsonApi "$baseUri/_cat/plugins?format=json")
  $nodes = Invoke-JsonApi "$baseUri/_nodes/_local/jvm,settings?flat_settings=true"
  $settings = Invoke-JsonApi "$baseUri/_cluster/settings?include_defaults=true&flat_settings=true"
  $clusterState = Invoke-JsonApi "$baseUri/_cluster/state/metadata"
  $indices = @(Invoke-JsonApi "$baseUri/_cat/indices?format=json&h=index")
  $aliases = @(Invoke-JsonApi "$baseUri/_cat/aliases?format=json&h=alias,index")
  $node = $nodes.nodes.PSObject.Properties.Value | Select-Object -First 1
  $jvmArguments = if ($node.jvm.input_arguments -is [string]) {
    @($node.jvm.input_arguments -split '\s+')
  } else {
    @($node.jvm.input_arguments | ForEach-Object { [string]$_ })
  }
  $flat = @{}
  foreach ($set in @($settings.defaults, $settings.persistent, $settings.transient)) {
    if ($set) { foreach ($prop in $set.PSObject.Properties) { $flat[$prop.Name] = $prop.Value } }
  }
  $icu = @($plugins | Where-Object { $_.component -eq 'analysis-icu' -and $_.version -eq $expectedIcu })
  $dataPath = [string]$node.settings.'path.data'
  $applicationIndices = @($indices | ForEach-Object { $_.index } | Where-Object { $_ -and $_ -notmatch '^\.' -and $_ -notmatch '^top_queries-' })
  if ([string]::IsNullOrWhiteSpace($dataPath)) { throw 'FRESH_RUNTIME_DATA_PATH_UNVERIFIED' }
  if (
    $root.version.number -ne $expectedVersion -or
    $root.version.build_hash -ne '97d3c13bf22a4a72ac11dc503fe44c97662b9161' -or
    $health.status -ne 'green' -or
    $health.number_of_nodes -ne 1 -or
    $health.unassigned_shards -ne 0 -or
    $flat['cluster.name'] -ne $Marker.clusterName -or
    $clusterState.cluster_uuid -ne $Marker.clusterUuid -or
    $icu.Count -ne 1 -or
    $node.jvm.mem.heap_init_in_bytes -ne $expectedHeap -or
    $node.jvm.mem.heap_max_in_bytes -ne $expectedHeap -or
    $jvmArguments -notcontains '-Xms2g' -or
    $jvmArguments -notcontains '-Xmx2g' -or
    [IO.Path]::GetFullPath($dataPath) -ne $Paths.Data -or
    [int]$node.settings.'http.port' -ne [int]$Marker.httpPort -or
    [int]$node.settings.'transport.port' -ne [int]$Marker.transportPort
  ) { throw 'FRESH_RUNTIME_CERTIFICATION_FAILED' }
  return [pscustomobject]@{
    version = $root.version.number
    build = $root.version.build_hash
    health = $health.status
    heapInitBytes = $node.jvm.mem.heap_init_in_bytes
    heapMaxBytes = $node.jvm.mem.heap_max_in_bytes
    analysisIcu = $icu[0].version
    icu4j = $expectedIcu4j
    endpoint = $Marker.endpoint
    clusterName = $Marker.clusterName
    clusterUuid = $clusterState.cluster_uuid
    dataPath = $Paths.Data
    logsPath = $Paths.Logs
    configPath = $Paths.Config
    physicalIndices = @($indices | ForEach-Object { $_.index })
    applicationIndices = $applicationIndices
    aliases = @($aliases | ForEach-Object { "$($_.alias)->$($_.index)" })
  }
}

function Set-JvmProfile($Paths) {
  $source = Join-Path $Paths.Home 'config\jvm.options'
  if (-not (Test-Path -LiteralPath $source)) { throw 'FRESH_RUNTIME_JVM_PROFILE_MISSING' }
  $lines = @(Get-Content -LiteralPath $source | Where-Object { $_ -notmatch '^\s*(?:\d+-)?-Xm[sx]\S+' })
  foreach ($required in @('11-:-XX:+UseG1GC', '11-:-XX:G1ReservePercent=25', '11-:-XX:InitiatingHeapOccupancyPercent=30')) {
    if ($lines -notcontains $required) { throw 'FRESH_RUNTIME_JVM_PROFILE_INCOMPLETE' }
  }
  $lines += @('-Xms2g', '-Xmx2g')
  $destination = Join-Path $Paths.Config 'jvm.options'
  $text = [string]::Join("`r`n", [string[]]$lines) + "`r`n"
  [IO.File]::WriteAllText($destination, $text, (New-Object System.Text.UTF8Encoding($false)))
  $written = Get-Content -LiteralPath $destination
  if (
    @($written | Where-Object { $_ -eq '-Xms2g' }).Count -ne 1 -or
    @($written | Where-Object { $_ -eq '-Xmx2g' }).Count -ne 1 -or
    @($written | Where-Object { $_ -eq '11-:-XX:G1ReservePercent=25' }).Count -ne 1 -or
    @($written | Where-Object { $_ -eq '11-:-XX:InitiatingHeapOccupancyPercent=30' }).Count -ne 1
  ) { throw 'FRESH_RUNTIME_JVM_PROFILE_WRITE_FAILED' }
}

function Get-JavaTempPath([string]$RuntimeId) {
  $base = $env:TEMP
  if ([string]::IsNullOrWhiteSpace($base) -or $base.Contains(' ')) {
    $base = Join-Path $env:SystemRoot 'Temp'
  }
  if ([string]::IsNullOrWhiteSpace($base) -or $base.Contains(' ')) { throw 'FRESH_RUNTIME_TEMP_PATH_WITH_SPACES' }
  $temporary = Join-Path $base "opensearch-fresh-v4-$RuntimeId"
  if ($temporary.Contains(' ')) { throw 'FRESH_RUNTIME_TEMP_PATH_WITH_SPACES' }
  return $temporary
}

function Get-SearchProcesses($Paths) {
  $homePattern = [regex]::Escape($Paths.Home)
  $confPattern = [regex]::Escape($Paths.Config)
  return @(Get-CimInstance Win32_Process -Filter "Name='java.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -match 'org\.opensearch\.bootstrap\.OpenSearch' -and
    $_.CommandLine -match $homePattern -and
    $_.CommandLine -match $confPattern
  })
}

function Ensure-ConsoleControlType {
  if (-not ('FreshOpenSearchConsoleControl' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FreshOpenSearchConsoleControl {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint processId);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GenerateConsoleCtrlEvent(uint eventCode, uint processGroupId);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
}
'@
  }
}

function Stop-FreshRuntime($Paths, $Marker) {
  $processes = @(Get-SearchProcesses $Paths)
  if ($processes.Count -ne 1) { throw "FRESH_RUNTIME_PROCESS_IDENTITY_UNVERIFIED; matching=$($processes.Count)" }
  $null = Get-ClusterSummary $Paths $Marker
  $process = $processes[0]
  Ensure-ConsoleControlType
  $null = [FreshOpenSearchConsoleControl]::FreeConsole()
  if (-not [FreshOpenSearchConsoleControl]::AttachConsole([uint32]$process.ProcessId)) { throw 'FRESH_RUNTIME_GRACEFUL_SIGNAL_ATTACH_FAILED' }
  $ignoreCtrlC = [FreshOpenSearchConsoleControl]::SetConsoleCtrlHandler([IntPtr]::Zero, $true)
  if (-not $ignoreCtrlC) { throw 'FRESH_RUNTIME_CTRL_C_HANDLER_FAILED' }
  $sent = [FreshOpenSearchConsoleControl]::GenerateConsoleCtrlEvent(0, 0)
  $null = [FreshOpenSearchConsoleControl]::FreeConsole()
  if (-not $sent) { throw 'FRESH_RUNTIME_GRACEFUL_SIGNAL_FAILED' }
  $deadline = (Get-Date).AddSeconds(60)
  do {
    Start-Sleep -Milliseconds 500
    $stillRunning = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ProcessId)" -ErrorAction SilentlyContinue
  } while ($stillRunning -and (Get-Date) -lt $deadline)
  if ($ignoreCtrlC) { $null = [FreshOpenSearchConsoleControl]::SetConsoleCtrlHandler([IntPtr]::Zero, $false) }
  if ($stillRunning) { throw 'FRESH_RUNTIME_STOP_TIMEOUT' }
  Write-Output "FRESH_SEARCH=STOPPED_GRACEFULLY pid=$($process.ProcessId)"
}

function Start-FreshRuntime($Paths) {
  $markerExists = Test-Path -LiteralPath $Paths.Marker
  $knownClusterUuid = ''
  if ($markerExists) {
    $marker = Get-Marker $Paths
    $knownClusterUuid = [string]$marker.clusterUuid
    try {
      $summary = Get-ClusterSummary $Paths $marker
      Write-Output ("FRESH_SEARCH=ALREADY_READY version={0} health={1} endpoint={2} dataPath={3} indices={4} aliases={5}" -f $summary.version,$summary.health,$summary.endpoint, $summary.dataPath,($summary.physicalIndices -join ','),($summary.aliases -join ','))
      return
    } catch {
      if ((Get-SearchProcesses $Paths).Count -gt 0) { throw 'FRESH_RUNTIME_RUNNING_BUT_NOT_READY' }
    }
    if ((Get-SearchProcesses $Paths).Count -gt 0) { throw 'FRESH_RUNTIME_COMPETING_PROCESS_PRESENT' }
  } else {
    if (Test-Path -LiteralPath $Paths.Root) {
      $existing = @(Get-ChildItem -LiteralPath $Paths.Root -Force -ErrorAction SilentlyContinue)
      if ($existing.Count -gt 0) { throw 'FRESH_RUNTIME_UNMARKED_ROOT_NOT_EMPTY' }
    }
    if ((Test-Path -LiteralPath $Paths.Data) -and @(Get-ChildItem -LiteralPath $Paths.Data -Force).Count -gt 0) { throw 'FRESH_RUNTIME_UNMARKED_DATA_NOT_EMPTY' }
    if ((Test-Path -LiteralPath $Paths.Config) -or (Test-Path -LiteralPath $Paths.Logs)) { throw 'FRESH_RUNTIME_UNMARKED_CONFIG_OR_LOGS_EXIST' }
    if (-not (Test-PortAvailable $Paths.HttpPort)) { $Paths.HttpPort = Get-FreePort 19201 19999 0 }
    if (-not (Test-PortAvailable $Paths.TransportPort) -or $Paths.TransportPort -eq $Paths.HttpPort) { $Paths.TransportPort = Get-FreePort 19301 19999 $Paths.HttpPort }
    New-Item -ItemType Directory -Force -Path $Paths.Config,$Paths.Data,$Paths.Logs | Out-Null
    $runtimeId = [guid]::NewGuid().ToString('N')
    $clusterName = "bjc-search-fresh-v4-$runtimeId"
    $endpoint = "http://127.0.0.1:$($Paths.HttpPort)"
    $yamlData = $Paths.Data.Replace('\','/')
    $yamlLogs = $Paths.Logs.Replace('\','/')
    $yaml = @"
cluster.name: $clusterName
node.name: bjc-fresh-v4-node
network.host: 127.0.0.1
http.bind_host: 127.0.0.1
transport.bind_host: 127.0.0.1
http.port: $($Paths.HttpPort)
transport.port: $($Paths.TransportPort)
discovery.type: single-node
path.data: "$yamlData"
path.logs: "$yamlLogs"
plugins.security.disabled: true
plugins.security.ssl.http.enabled: false
action.auto_create_index: false
"@
    [IO.File]::WriteAllText((Join-Path $Paths.Config 'opensearch.yml'), $yaml, (New-Object System.Text.UTF8Encoding($false)))
    Set-JvmProfile $Paths
    Copy-Item -LiteralPath (Join-Path $Paths.Home 'config\log4j2.properties') -Destination (Join-Path $Paths.Config 'log4j2.properties')
    $marker = [pscustomobject]@{
      version = 1
      runtimeId = $runtimeId
      clusterName = $clusterName
      clusterUuid = ''
      endpoint = $endpoint
      home = $Paths.Home
      configPath = $Paths.Config
      dataPath = $Paths.Data
      logsPath = $Paths.Logs
      httpPort = $Paths.HttpPort
      transportPort = $Paths.TransportPort
      createdAt = (Get-Date).ToUniversalTime().ToString('o')
    }
    [IO.File]::WriteAllText($Paths.Marker, ($marker | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
  }

  $marker = Get-Marker $Paths
  $Paths.Temp = Get-JavaTempPath ([string]$marker.runtimeId)
  New-Item -ItemType Directory -Force -Path $Paths.Temp | Out-Null
  $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @([int]$marker.httpPort,[int]$marker.transportPort) })
  if ($listeners.Count -gt 0) { throw 'FRESH_RUNTIME_PORT_CONFLICT' }
  $env:OPENSEARCH_HOME = $Paths.Home
  $env:OPENSEARCH_JAVA_HOME = Join-Path $Paths.Home 'jdk'
  $env:OPENSEARCH_PATH_CONF = $Paths.Config
  Set-JvmProfile $Paths
  $env:OPENSEARCH_TMPDIR = $Paths.Temp
  # The isolated runtime takes its exact 2 GiB heap only from this config profile.
  $env:OPENSEARCH_JAVA_OPTS = ''
  $startupId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
  $stdout = Join-Path $Paths.Logs "startup-$startupId.stdout.log"
  $stderr = Join-Path $Paths.Logs "startup-$startupId.stderr.log"
  $null = Start-Process -FilePath (Join-Path $Paths.Home 'bin\opensearch.bat') -WorkingDirectory $Paths.Home -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  $deadline = (Get-Date).AddSeconds(180)
  do {
    try {
      $health = Invoke-RestMethod -Uri "$($marker.endpoint)/_cluster/health" -TimeoutSec 3
      if ($health.status -eq 'green' -and $health.unassigned_shards -eq 0) {
        $currentClusterUuid = (Invoke-RestMethod -Uri "$($marker.endpoint)/_cluster/state/metadata" -TimeoutSec 5).cluster_uuid
        if ($knownClusterUuid -and $knownClusterUuid -ne $currentClusterUuid) { throw 'FRESH_RUNTIME_CLUSTER_UUID_CHANGED' }
        if (-not $knownClusterUuid) {
          $marker.clusterUuid = $currentClusterUuid
          [IO.File]::WriteAllText($Paths.Marker, ($marker | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
        }
        $summary = Get-ClusterSummary $Paths $marker
        if (-not $markerExists -and ($summary.applicationIndices.Count -ne 0 -or $summary.aliases.Count -ne 0)) { throw 'FRESH_RUNTIME_MUST_START_EMPTY' }
        $state = if ($markerExists) { 'RESTARTED' } else { 'STARTED_EMPTY' }
        Write-Output ("FRESH_SEARCH={0} version={1} health={2} ICU={3}/ICU4J-{4} heap=2GiB endpoint={5} cluster={6} clusterUuid={7} dataPath={8} logsPath={9} indices={10} aliases={11} httpPort={12} transportPort={13}" -f $state,$summary.version,$summary.health,$summary.analysisIcu,$summary.icu4j,$summary.endpoint,$summary.clusterName,$summary.clusterUuid,$summary.dataPath,$summary.logsPath,($summary.applicationIndices -join ','),($summary.aliases -join ','),$marker.httpPort,$marker.transportPort)
        return
      }
    } catch {
      if ($_.Exception.Message -match '^FRESH_RUNTIME_|^FRESH_SEARCH=') { throw }
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw "FRESH_RUNTIME_START_TIMEOUT; inspect startup logs $stdout and $stderr."
}

try {
  $paths = Get-RuntimeConfig
  if ($Action -eq 'preflight') {
    if (-not (Test-PortAvailable $paths.HttpPort) -or -not (Test-PortAvailable $paths.TransportPort)) { throw 'FRESH_RUNTIME_PORT_CONFLICT' }
    Write-Output ("FRESH_RUNTIME_PREFLIGHT=PASS version={0} ICU={1}/ICU4J-{2} heap=2GiB home={3} runtimeRoot={4} httpPort={5} transportPort={6}" -f $expectedVersion,$expectedIcu,$expectedIcu4j,$paths.Home,$paths.Root,$paths.HttpPort,$paths.TransportPort)
  } elseif ($Action -eq 'start') {
    Start-FreshRuntime $paths
  } elseif ($Action -eq 'status') {
    $marker = Get-Marker $paths
    $summary = Get-ClusterSummary $paths $marker
    Write-Output ($summary | ConvertTo-Json -Depth 6)
  } else {
    $marker = Get-Marker $paths
    Stop-FreshRuntime $paths $marker
  }
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
