param(
  [ValidateSet("start", "stop", "status")]
  [string]$Action = "start",

  [string]$StateSlot = "current",

  [string]$AppDisplayName = "",

  [switch]$NoBuild,

  [switch]$FreshState,

  [switch]$DebugOpenExternal,

  [ValidateRange(0, 65535)]
  [int]$RemoteDebuggingPort = 0,

  [int]$WaitTimeoutSec = 90
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "wave-windows-common.ps1")

function Get-StateRoot {
  return Join-Path (Get-RepoRoot) ".tmp\dev-linked\$StateSlot"
}

function Get-StateFile {
  return Join-Path (Get-StateRoot) "launcher-state.json"
}

function Get-DevLogPath {
  return Join-Path (Get-StateRoot) "dev.log"
}

function Get-ElectronViteCliPath {
  $cliPath = Join-Path (Get-RepoRoot) "node_modules\electron-vite\bin\electron-vite.js"
  if (-not (Test-Path -LiteralPath $cliPath)) {
    throw "electron-vite CLI not found at $cliPath"
  }
  return $cliPath
}

function Get-RepoMarker {
  $repoRoot = Get-RepoRoot
  return $repoRoot.ToLowerInvariant()
}

function Get-ProcessTable {
  try {
    return @(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId, ParentProcessId, Name, CommandLine, ExecutablePath)
  } catch {
    return @(Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
      $procPath = ""
      try {
        $procPath = [string]$_.Path
      } catch {
        $procPath = ""
      }
      [pscustomobject]@{
        ProcessId = [int]$_.Id
        ParentProcessId = 0
        Name = if ([string]::IsNullOrWhiteSpace([string]$_.ProcessName)) { "" } else { "$([string]$_.ProcessName).exe" }
        CommandLine = $procPath
        ExecutablePath = $procPath
      }
    })
  }
}

function Get-ProcessLookup {
  $lookup = @{}
  foreach ($proc in Get-ProcessTable) {
    $lookup[[int]$proc.ProcessId] = $proc
  }
  return $lookup
}

function Normalize-ProcessText {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ""
  }
  return $Value.ToLowerInvariant().Replace('/', '\')
}

function Get-CurrentStatePaths {
  $stateRoot = [IO.Path]::GetFullPath((Get-StateRoot))
  $stateFile = [IO.Path]::GetFullPath((Get-StateFile))
  $logPath = [IO.Path]::GetFullPath((Get-DevLogPath))
  $dataDir = [IO.Path]::GetFullPath((Join-Path $stateRoot "data"))
  $electronDir = [IO.Path]::GetFullPath((Join-Path $stateRoot "electron-userdata"))
  $configDir = [IO.Path]::GetFullPath((Join-Path $stateRoot "config"))
  $repoRoot = [IO.Path]::GetFullPath((Get-RepoRoot))
  return [pscustomobject]@{
    StateRoot = (Normalize-ProcessText $stateRoot)
    StateFile = (Normalize-ProcessText $stateFile)
    LogPath = (Normalize-ProcessText $logPath)
    DataDir = (Normalize-ProcessText $dataDir)
    ElectronDir = (Normalize-ProcessText $electronDir)
    ConfigDir = (Normalize-ProcessText $configDir)
    RepoRoot = (Normalize-ProcessText $repoRoot)
  }
}

function Test-IsDevMainProcess {
  param($Proc)
  if ($null -eq $Proc) { return $false }
  $name = [string]$Proc.Name
  if ($name -notin @("electron.exe", "WAVE.exe")) { return $false }
  $cmd = [string]$Proc.CommandLine
  $exePath = [string]$Proc.ExecutablePath
  if ([string]::IsNullOrWhiteSpace($cmd) -and [string]::IsNullOrWhiteSpace($exePath)) { return $false }
  if ($cmd -match '--type=') { return $false }
  $marker = Get-RepoMarker
  $normalizedSources = @()
  foreach ($value in @($cmd, $exePath)) {
    if ([string]::IsNullOrWhiteSpace([string]$value)) {
      continue
    }
    $normalizedSources += ([string]$value).ToLowerInvariant().Replace('/', '\')
  }
  if ($normalizedSources.Count -eq 0) { return $false }
  $inRepo = $false
  foreach ($value in $normalizedSources) {
    if ($value.Contains($marker)) {
      $inRepo = $true
      break
    }
  }
  if (-not $inRepo) { return $false }
  if ($name -eq "electron.exe") {
    foreach ($value in $normalizedSources) {
      if ($value.Contains('node_modules\electron\dist\electron.exe')) {
        return $true
      }
    }
    return $false
  }
  return $true
}

function Get-DevMainProcesses {
  return @(Get-ProcessTable | Where-Object { Test-IsDevMainProcess $_ })
}

function Get-DevMainCandidateInfo {
  param(
    [hashtable]$Lookup,
    $Proc
  )

  if ($null -eq $Proc) {
    return $null
  }

  $ancestorPids = New-Object System.Collections.Generic.List[int]
  $seen = New-Object System.Collections.Generic.HashSet[int]
  $cmdPid = 0
  $npmPid = 0
  $nodePid = 0
  $ancestorPid = [int]$Proc.ParentProcessId

  while ($ancestorPid -gt 0 -and $seen.Add($ancestorPid)) {
    $ancestorPids.Add($ancestorPid)
    $ancestor = Get-ProcessByIdSafe -Lookup $Lookup -ProcessId $ancestorPid
    if ($null -eq $ancestor) {
      break
    }

    $cmdline = [string]$ancestor.CommandLine
    $lower = $cmdline.ToLowerInvariant()
    switch -Regex ($ancestor.Name) {
      '^node\.exe$' {
        if ($nodePid -eq 0 -and $lower.Contains("electron-vite.js") -and $lower.Contains(" dev")) {
          $nodePid = [int]$ancestor.ProcessId
        } elseif ($npmPid -eq 0 -and $lower.Contains("npm-cli.js") -and $lower.Contains(" run dev")) {
          $npmPid = [int]$ancestor.ProcessId
        }
      }
      '^cmd\.exe$' {
        if ($cmdPid -eq 0 -and $lower.Contains("electron-vite") -and $lower.Contains(" dev")) {
          $cmdPid = [int]$ancestor.ProcessId
        }
      }
    }

    $ancestorPid = [int]$ancestor.ParentProcessId
  }

  return [pscustomobject]@{
    Process = $Proc
    AncestorPids = @($ancestorPids)
    CmdPid = $cmdPid
    NpmPid = $npmPid
    NodePid = $nodePid
  }
}

function Get-PreferredAncestorDepth {
  param(
    [int[]]$AncestorPids,
    [System.Collections.Generic.HashSet[int]]$PreferredAncestorSet
  )

  if ($null -eq $PreferredAncestorSet -or $PreferredAncestorSet.Count -eq 0) {
    return [int]::MaxValue
  }

  for ($i = 0; $i -lt $AncestorPids.Count; $i++) {
    if ($PreferredAncestorSet.Contains([int]$AncestorPids[$i])) {
      return $i
    }
  }

  return [int]::MaxValue
}

function Resolve-DevMainSelection {
  param(
    [int[]]$PreferredAncestorIds = @(),
    [int[]]$PreferredProcessIds = @(),
    [switch]$RequirePreference
  )

  $lookup = Get-ProcessLookup
  $preferredAncestorSet = New-Object System.Collections.Generic.HashSet[int]
  foreach ($candidatePid in @($PreferredAncestorIds)) {
    $id = [int]$candidatePid
    if ($id -gt 0) {
      [void]$preferredAncestorSet.Add($id)
    }
  }

  $preferredProcessSet = New-Object System.Collections.Generic.HashSet[int]
  foreach ($candidatePid in @($PreferredProcessIds)) {
    $id = [int]$candidatePid
    if ($id -gt 0) {
      [void]$preferredProcessSet.Add($id)
    }
  }

  $candidateInfos = @(
    $lookup.Values |
      Where-Object { Test-IsDevMainProcess $_ } |
      ForEach-Object { Get-DevMainCandidateInfo -Lookup $lookup -Proc $_ }
  )

  if ($candidateInfos.Count -eq 0) {
    return [pscustomobject]@{
      Lookup = $lookup
      MainProcess = $null
      MainInfo = $null
    }
  }

  $rankedCandidates = @(
    $candidateInfos |
    ForEach-Object {
      $procPid = [int]$_.Process.ProcessId
      $depth = Get-PreferredAncestorDepth -AncestorPids $_.AncestorPids -PreferredAncestorSet $preferredAncestorSet
      [pscustomobject]@{
        Info = $_
        HasPreferredAncestor = ($depth -ne [int]::MaxValue)
        PreferredAncestorDepth = $depth
        IsPreferredProcess = $preferredProcessSet.Contains($procPid)
        HasDevNode = ($_.NodePid -gt 0)
        HasNpmNode = ($_.NpmPid -gt 0)
        HasCmd = ($_.CmdPid -gt 0)
        NodePid = $_.NodePid
        NpmPid = $_.NpmPid
        CmdPid = $_.CmdPid
        ProcessId = $procPid
      }
    } |
    Sort-Object `
      @{ Expression = { $_.HasPreferredAncestor }; Descending = $true }, `
      @{ Expression = { $_.PreferredAncestorDepth }; Descending = $false }, `
      @{ Expression = { $_.IsPreferredProcess }; Descending = $true }, `
      @{ Expression = { $_.HasDevNode }; Descending = $true }, `
      @{ Expression = { $_.HasNpmNode }; Descending = $true }, `
      @{ Expression = { $_.HasCmd }; Descending = $true }, `
      @{ Expression = { $_.NodePid }; Descending = $true }, `
      @{ Expression = { $_.NpmPid }; Descending = $true }, `
      @{ Expression = { $_.CmdPid }; Descending = $true }, `
      @{ Expression = { $_.ProcessId }; Descending = $true }
  )

  if ($RequirePreference -and ($preferredAncestorSet.Count -gt 0 -or $preferredProcessSet.Count -gt 0)) {
    $preferredCandidates = @(
      $rankedCandidates | Where-Object { $_.HasPreferredAncestor -or $_.IsPreferredProcess }
    )
    if ($preferredCandidates.Count -eq 0) {
      return [pscustomobject]@{
        Lookup = $lookup
        MainProcess = $null
        MainInfo = $null
      }
    }
    $rankedCandidates = $preferredCandidates
  }

  $selected = $rankedCandidates | Select-Object -First 1

  return [pscustomobject]@{
    Lookup = $lookup
    MainProcess = $selected.Info.Process
    MainInfo = $selected.Info
  }
}

function Test-IsLauncherProcess {
  param($Proc)
  if ($null -eq $Proc) { return $false }
  $name = [string]$Proc.Name
  if ($name -notin @("node.exe", "cmd.exe", "powershell.exe")) { return $false }
  $cmd = [string]$Proc.CommandLine
  if ([string]::IsNullOrWhiteSpace($cmd)) { return $false }
  $lower = $cmd.ToLowerInvariant()
  $marker = Get-RepoMarker
  if ($lower.Contains($marker) -and ($lower.Contains("npm run dev") -or $lower.Contains("electron-vite") -or $lower.Contains("npm-cli.js run dev"))) {
    return $true
  }
  if ($lower.Contains("electron-vite.js") -and $lower.Contains(" dev")) {
    return $true
  }
  return $false
}

function Test-IsCurrentStateLauncherProcess {
  param(
    $Proc,
    [pscustomobject]$StatePaths
  )
  if ($null -eq $Proc) { return $false }
  if (-not (Test-IsLauncherProcess $Proc)) { return $false }
  $cmd = Normalize-ProcessText ([string]$Proc.CommandLine)
  if ([string]::IsNullOrWhiteSpace($cmd)) { return $false }
  if (-not $cmd.Contains($StatePaths.RepoRoot)) { return $false }
  if ($cmd.Contains($StatePaths.LogPath) -or $cmd.Contains($StatePaths.StateRoot)) {
    return $true
  }
  return $false
}

function Get-ProcessByIdSafe {
  param(
    [hashtable]$Lookup,
    [int]$ProcessId
  )
  if ($ProcessId -le 0) { return $null }
  if ($Lookup.ContainsKey($ProcessId)) {
    return $Lookup[$ProcessId]
  }
  return $null
}

function Stop-ProcessByIdSafe {
  param([int]$ProcessId)
  if ($ProcessId -le 0) {
    return
  }
  try {
    Stop-Process -Id $ProcessId -Force -ErrorAction Stop
  } catch {
    try {
      & taskkill /PID $ProcessId /T /F 2>$null | Out-Null
    } catch {
      # ignore already-stopped processes
    }
  }
}

function Get-DescendantProcessInfo {
  param(
    [hashtable]$Lookup,
    [int[]]$RootIds
  )

  $childrenByParent = @{}
  foreach ($proc in $Lookup.Values) {
    $parentPid = [int]$proc.ParentProcessId
    if (-not $childrenByParent.ContainsKey($parentPid)) {
      $childrenByParent[$parentPid] = New-Object System.Collections.Generic.List[object]
    }
    $childrenByParent[$parentPid].Add($proc)
  }

  $visited = New-Object System.Collections.Generic.HashSet[int]
  $queue = New-Object System.Collections.Generic.Queue[object]
  foreach ($rootId in @($RootIds)) {
    $id = [int]$rootId
    if ($id -le 0) { continue }
    if (-not $Lookup.ContainsKey($id)) { continue }
    if ($visited.Add($id)) {
      $queue.Enqueue([pscustomobject]@{
        Process = $Lookup[$id]
        Depth = 0
      })
    }
  }

  $result = New-Object System.Collections.Generic.List[object]
  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    $proc = $current.Process
    $depth = [int]$current.Depth
    $result.Add([pscustomobject]@{
      Process = $proc
      Depth = $depth
    })

    $procPid = [int]$proc.ProcessId
    if (-not $childrenByParent.ContainsKey($procPid)) {
      continue
    }
    foreach ($child in $childrenByParent[$procPid]) {
      $childPid = [int]$child.ProcessId
      if ($visited.Add($childPid)) {
        $queue.Enqueue([pscustomobject]@{
          Process = $child
          Depth = $depth + 1
        })
      }
    }
  }

  return $result.ToArray()
}

function Get-DevInstanceProcessSnapshot {
  param([int[]]$PreferredRootIds = @())

  $statePaths = Get-CurrentStatePaths
  $lookup = Get-ProcessLookup
  $rootIds = New-Object System.Collections.Generic.HashSet[int]

  foreach ($rootPid in @($PreferredRootIds)) {
    $id = [int]$rootPid
    if ($id -le 0) { continue }
    if ($lookup.ContainsKey($id)) {
      [void]$rootIds.Add($id)
    }
  }

  foreach ($proc in $lookup.Values) {
    if (Test-IsCurrentStateLauncherProcess -Proc $proc -StatePaths $statePaths) {
      [void]$rootIds.Add([int]$proc.ProcessId)
    }
  }

  if ($rootIds.Count -eq 0) {
    foreach ($proc in $lookup.Values) {
      if ((Test-IsLauncherProcess $proc) -or (Test-IsDevMainProcess $proc)) {
        [void]$rootIds.Add([int]$proc.ProcessId)
      }
    }
  }

  $descendants = Get-DescendantProcessInfo -Lookup $lookup -RootIds @($rootIds)
  return [pscustomobject]@{
    Lookup = $lookup
    RootIds = @($rootIds)
    Processes = @($descendants)
  }
}

function Format-DevProcessSummary {
  param([object[]]$ProcessInfos)
  if ($null -eq $ProcessInfos -or $ProcessInfos.Count -eq 0) {
    return ""
  }
  return (
    $ProcessInfos |
      Sort-Object @{ Expression = { $_.Depth }; Descending = $false }, @{ Expression = { [int]$_.Process.ProcessId }; Descending = $false } |
      ForEach-Object {
        $proc = $_.Process
        $cmd = [string]$proc.CommandLine
        if ($cmd.Length -gt 220) {
          $cmd = $cmd.Substring(0, 220) + "..."
        }
        "pid=$([int]$proc.ProcessId) parent=$([int]$proc.ParentProcessId) depth=$([int]$_.Depth) name=$([string]$proc.Name) cmd=$cmd"
      }
  ) -join "`n"
}

function Stop-ExistingDevInstance {
  $stateFile = Get-StateFile
  $preferredRootIds = @()
  if (Test-Path -LiteralPath $stateFile) {
    try {
      $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
      $preferredRootIds = @($state.main_pid, $state.node_pid, $state.npm_pid, $state.cmd_pid, $state.launcher_pid)
    } catch {
      # ignore unreadable state
    }
  }

  $maxAttempts = 8
  for ($attempt = 0; $attempt -lt $maxAttempts; $attempt++) {
    $snapshot = Get-DevInstanceProcessSnapshot -PreferredRootIds $preferredRootIds
    if ($snapshot.Processes.Count -eq 0) {
      break
    }

    $ordered = @(
      $snapshot.Processes |
        Sort-Object @{ Expression = { $_.Depth }; Descending = $true }, @{ Expression = { [int]$_.Process.ProcessId }; Descending = $true }
    )
    foreach ($procInfo in $ordered) {
      Stop-ProcessByIdSafe -ProcessId ([int]$procInfo.Process.ProcessId)
    }
    Start-Sleep -Milliseconds 700
  }

  $remaining = Get-DevInstanceProcessSnapshot -PreferredRootIds $preferredRootIds
  if ($remaining.Processes.Count -gt 0) {
    $summary = Format-DevProcessSummary -ProcessInfos $remaining.Processes
    throw "Failed to stop dev-linked instance cleanly. Remaining processes:`n$summary"
  }

  if (Test-Path -LiteralPath $stateFile) {
    Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 150
  if (Test-Path -LiteralPath $stateFile) {
    throw "Failed to remove stale dev-linked state file: $stateFile"
  }
}

function Sync-ConfigSnapshot {
  param(
    [string]$SourceDir,
    [string]$DestinationDir
  )

  if (Test-Path -LiteralPath $DestinationDir) {
    Remove-Item -LiteralPath $DestinationDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  New-Item -ItemType Directory -Force -Path $DestinationDir | Out-Null

  if (-not (Test-Path -LiteralPath $SourceDir)) {
    return
  }

  Get-ChildItem -LiteralPath $SourceDir -Force -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $DestinationDir -Recurse -Force
  }
}

function Get-DevStartupFailureMessage {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Reason,
    [string]$LogPath,
    [System.Diagnostics.Process]$Launcher = $null
  )

  $details = New-Object System.Collections.Generic.List[string]
  $details.Add($Reason)

  if ($null -ne $Launcher) {
    try {
      $Launcher.Refresh()
      if ($Launcher.HasExited) {
        $details.Add("launcher_exit_code=$($Launcher.ExitCode)")
      }
    } catch {
      # ignore process refresh failures while composing the startup error
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($LogPath) -and (Test-Path -LiteralPath $LogPath)) {
    $logTail = (Get-Content -LiteralPath $LogPath -Tail 80 -ErrorAction SilentlyContinue) -join "`n"
    if (-not [string]::IsNullOrWhiteSpace($logTail)) {
      $details.Add("dev.log tail:`n$logTail")
    }
  }

  return ($details -join "`n")
}

function Wait-ForRunningInstance {
  param(
    [int[]]$PreferredAncestorIds = @(),
    [int[]]$PreferredProcessIds = @(),
    [int]$TimeoutSec = 15
  )

  $deadline = (Get-Date).AddSeconds([Math]::Max(1, $TimeoutSec))
  do {
    $selection = Resolve-DevMainSelection -PreferredAncestorIds $PreferredAncestorIds -PreferredProcessIds $PreferredProcessIds
    if ($null -ne $selection.MainProcess) {
      return $selection
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  return [pscustomobject]@{
    Lookup = $null
    MainProcess = $null
    MainInfo = $null
  }
}

function Start-DevInstance {
  if (-not $NoBuild) {
    Ensure-WaveBackendBins
  }

  Stop-ExistingDevInstance

  $stateRoot = Get-StateRoot
  $dataDir = Join-Path $stateRoot "data"
  $electronDir = Join-Path $stateRoot "electron-userdata"
  $configDir = Join-Path $stateRoot "config"
  $logPath = Get-DevLogPath
  $hostConfigDir = "C:\Users\baba1\.config\wave"

  if ($FreshState) {
    if (Test-Path -LiteralPath $dataDir) {
      Remove-Item -LiteralPath $dataDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $electronDir) {
      Remove-Item -LiteralPath $electronDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  New-Item -ItemType Directory -Force -Path $stateRoot, $dataDir, $electronDir | Out-Null
  Sync-ConfigSnapshot -SourceDir $hostConfigDir -DestinationDir $configDir
  if (Test-Path -LiteralPath $logPath) {
    Remove-Item -LiteralPath $logPath -Force -ErrorAction SilentlyContinue
  }

  $repoRoot = Get-RepoRoot
  $esbuildPath = Enable-RepoEsbuildExecutionWorkaround
  $devNpm = Get-DevNpmToolchainInfo
  $electronViteCliPath = Get-ElectronViteCliPath
  $devNodeDir = Split-Path -Parent $devNpm.NodeExePath
  if (-not [string]::IsNullOrWhiteSpace($devNodeDir) -and -not ([string]$env:PATH).StartsWith("$devNodeDir;", [System.StringComparison]::OrdinalIgnoreCase)) {
    $env:PATH = "$devNodeDir;$($env:PATH)"
  }

  $env:WAVETERM_PROFILE = "dev"
  $env:WAVETERM_CONFIG_HOME = $configDir
  $env:WAVETERM_DATA_HOME = $dataDir
  $env:WAVETERM_ELECTRON_USER_DATA_HOME = $electronDir
  if ([string]::IsNullOrWhiteSpace($esbuildPath)) {
    Remove-Item Env:ESBUILD_BINARY_PATH -ErrorAction SilentlyContinue
  } else {
    $env:ESBUILD_BINARY_PATH = $esbuildPath
  }
  if ($DebugOpenExternal) {
    $env:WAVETERM_DEBUG_OPEN_EXTERNAL = "1"
  } else {
    Remove-Item Env:WAVETERM_DEBUG_OPEN_EXTERNAL -ErrorAction SilentlyContinue
  }
  if ([string]::IsNullOrWhiteSpace($AppDisplayName)) {
    Remove-Item Env:WAVETERM_APP_DISPLAY_NAME -ErrorAction SilentlyContinue
  } else {
    $env:WAVETERM_APP_DISPLAY_NAME = $AppDisplayName
  }

  $devCommand = "`"$($devNpm.NodeExePath)`" `"$electronViteCliPath`" dev"
  if ($RemoteDebuggingPort -gt 0) {
    $devCommand += " --remoteDebuggingPort=$RemoteDebuggingPort"
  }
  $cmdArgument = "`"$devCommand >> `"$logPath`" 2>&1`""

  # Keep a single dev.log stream while removing the hidden PowerShell -> npm wrapper chain.
  $launcher = Start-Process `
    -FilePath "cmd.exe" `
    -WorkingDirectory $repoRoot `
    -ArgumentList @("/d", "/s", "/c", $cmdArgument) `
    -WindowStyle Hidden `
    -PassThru

  $deadline = (Get-Date).AddSeconds([Math]::Max(15, $WaitTimeoutSec))
  $mainProc = $null
  $mainInfo = $null
  $lookup = $null
  $launcherExitedObserved = $false
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 800
    $selection = Resolve-DevMainSelection -PreferredAncestorIds @([int]$launcher.Id) -RequirePreference
    $mainProc = $selection.MainProcess
    $mainInfo = $selection.MainInfo
    $lookup = $selection.Lookup
    if ($null -ne $mainProc -and $null -ne $mainInfo) {
      break
    }
    try {
      $launcher.Refresh()
      $launcherExitedObserved = $launcherExitedObserved -or $launcher.HasExited
    } catch {
      $launcherExitedObserved = $true
    }
  }

  if ($null -eq $mainProc -or $null -eq $mainInfo) {
    $failureReason =
      if ($launcherExitedObserved) {
        "dev launcher exited before the main Electron process became ready."
      } else {
        "dev instance did not appear within $WaitTimeoutSec seconds."
      }
    throw (Get-DevStartupFailureMessage -Reason $failureReason -LogPath $logPath -Launcher $launcher)
  }

  $state = [ordered]@{
    started_at = (Get-Date).ToString("o")
    repo_root = $repoRoot
    launcher_pid = [int]$launcher.Id
    main_pid = [int]$mainProc.ProcessId
    npm_pid = [int]$mainInfo.NpmPid
    cmd_pid = [int]$mainInfo.CmdPid
    node_pid = [int]$mainInfo.NodePid
    remote_debugging_port = if ($RemoteDebuggingPort -gt 0) { [int]$RemoteDebuggingPort } else { 0 }
    state_slot = $StateSlot
    app_display_name = $AppDisplayName
    config_home = $configDir
    data_home = $dataDir
    electron_user_data_home = $electronDir
    log_path = $logPath
  }
  $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Get-StateFile) -Encoding UTF8

  return $state
}

function Get-Status {
  $stateFile = Get-StateFile
  $savedState = $null
  if (Test-Path -LiteralPath $stateFile) {
    try {
      $savedState = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    } catch {
      $savedState = $null
    }
  }

  $preferredAncestorIds = @()
  $preferredProcessIds = @()
  if ($null -ne $savedState) {
    $preferredAncestorIds = @($savedState.node_pid, $savedState.npm_pid, $savedState.cmd_pid, $savedState.launcher_pid)
    $preferredProcessIds = @($savedState.main_pid)
  }

  $snapshot = Get-DevInstanceProcessSnapshot -PreferredRootIds @($preferredProcessIds + $preferredAncestorIds)

  $selection =
    if ($null -ne $savedState) {
      Resolve-DevMainSelection -PreferredAncestorIds $preferredAncestorIds -PreferredProcessIds $preferredProcessIds -RequirePreference
    } else {
      Resolve-DevMainSelection
    }
  $main = $selection.MainProcess
  if ($null -eq $main -and $snapshot.Processes.Count -gt 0) {
    $fallbackMain = @(
      $snapshot.Processes |
        Where-Object {
          $proc = $_.Process
          (Test-IsDevMainProcess $proc) -and -not ([string]$proc.CommandLine -match '--type=')
        } |
        Sort-Object @{ Expression = { $_.Depth }; Descending = $false }, @{ Expression = { [int]$_.Process.ProcessId }; Descending = $false } |
        Select-Object -First 1
    )
    if ($fallbackMain.Count -gt 0) {
      $main = $fallbackMain[0].Process
    }
  }
  return [ordered]@{
    has_state_file = [bool](Test-Path -LiteralPath $stateFile)
    state = $savedState
    running = [bool](($null -ne $main) -or $snapshot.Processes.Count -gt 0)
    main_pid = if ($null -ne $main) { [int]$main.ProcessId } else { 0 }
    main_command = if ($null -ne $main) { [string]$main.CommandLine } else { "" }
    matching_process_count = $snapshot.Processes.Count
    matching_process_preview = @(
      $snapshot.Processes |
        Sort-Object @{ Expression = { $_.Depth }; Descending = $false }, @{ Expression = { [int]$_.Process.ProcessId }; Descending = $false } |
        Select-Object -First 8 |
        ForEach-Object {
          $proc = $_.Process
          [ordered]@{
            pid = [int]$proc.ProcessId
            parent_pid = [int]$proc.ParentProcessId
            depth = [int]$_.Depth
            name = [string]$proc.Name
            command = [string]$proc.CommandLine
          }
        }
    )
    stale_state_file = [bool]((Test-Path -LiteralPath $stateFile) -and $snapshot.Processes.Count -eq 0)
    log_path = Get-DevLogPath
  }
}

switch ($Action) {
  "stop" {
    Stop-ExistingDevInstance
    Get-Status | ConvertTo-Json -Depth 6
    break
  }
  "status" {
    Get-Status | ConvertTo-Json -Depth 6
    break
  }
  default {
    Start-DevInstance | ConvertTo-Json -Depth 6
    break
  }
}
