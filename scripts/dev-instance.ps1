param(
  [ValidateSet("start", "stop", "status")]
  [string]$Action = "start",

  [switch]$NoBuild,

  [switch]$DebugOpenExternal,

  [int]$WaitTimeoutSec = 90
)

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Get-PackageVersion {
  $pkgPath = Join-Path (Get-RepoRoot) "package.json"
  $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
  return [string]$pkg.version
}

function Get-NodeArchTag {
  $arch = [string]$env:PROCESSOR_ARCHITECTURE
  if ($null -eq $arch) {
    $arch = ""
  }
  $arch = $arch.ToUpperInvariant()
  if ($arch -eq "ARM64") { return "arm64" }
  if ($arch -eq "X86") { return "ia32" }
  return "x64"
}

function Get-GoLdflagsLine {
  param([string]$ExePath)
  if (-not (Test-Path -LiteralPath $ExePath)) {
    return ""
  }
  try {
    $out = & go version -m $ExePath 2>$null
    if (-not $out) {
      return ""
    }
    $match = $out | Select-String -Pattern "main\.WaveVersion|main\.BuildTime" | Select-Object -First 1
    if (-not $match) {
      return ""
    }
    return [string]$match.Line
  } catch {
    return ""
  }
}

function Get-WaveVersionFromLdflags {
  param([string]$LdflagsLine)
  if (-not $LdflagsLine) {
    return ""
  }
  $m = [regex]::Match($LdflagsLine, 'main\.WaveVersion=([^\s]+)')
  if (-not $m.Success) {
    return ""
  }
  return ([string]$m.Groups[1].Value).Trim('"').Trim("'")
}

function Ensure-BackendBins {
  $repoRoot = Get-RepoRoot
  $version = Get-PackageVersion
  $archTag = Get-NodeArchTag
  $wavesrvPath = Join-Path $repoRoot "dist\bin\wavesrv.$archTag.exe"
  $wshPath = Join-Path $repoRoot "dist\bin\wsh-$version-windows.x64.exe"

  $needBuild = $false
  if (-not (Test-Path -LiteralPath $wavesrvPath)) { $needBuild = $true }
  if (-not (Test-Path -LiteralPath $wshPath)) { $needBuild = $true }

  if (-not $needBuild) {
    $wavesrvLdflags = Get-GoLdflagsLine -ExePath $wavesrvPath
    $wavesrvVersion = Get-WaveVersionFromLdflags -LdflagsLine $wavesrvLdflags
    if ($wavesrvVersion -ne $version) {
      $needBuild = $true
    }
  }

  if ($needBuild) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build-backend-windows.ps1")
  }
}

function Get-StateRoot {
  return Join-Path (Get-RepoRoot) ".tmp\dev-linked\current"
}

function Get-StateFile {
  return Join-Path (Get-StateRoot) "launcher-state.json"
}

function Get-DevLogPath {
  return Join-Path (Get-StateRoot) "dev.log"
}

function Get-RepoMarker {
  $repoRoot = Get-RepoRoot
  return $repoRoot.ToLowerInvariant()
}

function Get-ProcessTable {
  return @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine)
}

function Get-ProcessLookup {
  $lookup = @{}
  foreach ($proc in Get-ProcessTable) {
    $lookup[[int]$proc.ProcessId] = $proc
  }
  return $lookup
}

function Test-IsDevMainProcess {
  param($Proc)
  if ($null -eq $Proc) { return $false }
  if ($Proc.Name -ne "electron.exe") { return $false }
  $cmd = [string]$Proc.CommandLine
  if ([string]::IsNullOrWhiteSpace($cmd)) { return $false }
  if ($cmd -match '--type=') { return $false }
  $marker = Get-RepoMarker
  return $cmd.ToLowerInvariant().Contains($marker) -and $cmd.ToLowerInvariant().Contains('node_modules\electron\dist\electron.exe')
}

function Get-DevMainProcesses {
  return @(Get-ProcessTable | Where-Object { Test-IsDevMainProcess $_ })
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

function Stop-ProcessTreeSafe {
  param([int]$ProcessId)
  if ($ProcessId -le 0) {
    return
  }
  try {
    & taskkill /PID $ProcessId /T /F | Out-Null
  } catch {
    # ignore already-stopped processes
  }
}

function Stop-ExistingDevInstance {
  $stopped = New-Object System.Collections.Generic.HashSet[int]
  $lookup = Get-ProcessLookup

  $stateFile = Get-StateFile
  if (Test-Path -LiteralPath $stateFile) {
    try {
      $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
      foreach ($pid in @($state.main_pid, $state.launcher_pid, $state.npm_pid, $state.cmd_pid)) {
        $id = [int]$pid
        if ($id -gt 0 -and $stopped.Add($id)) {
          Stop-ProcessTreeSafe -ProcessId $id
        }
      }
    } catch {
      # ignore unreadable state
    }
  }

  Start-Sleep -Milliseconds 400
  $lookup = Get-ProcessLookup
  $roots = Get-DevMainProcesses
  foreach ($root in $roots) {
    $rootPid = [int]$root.ProcessId
    if ($stopped.Add($rootPid)) {
      Stop-ProcessTreeSafe -ProcessId $rootPid
    }

    $parentPid = [int]$root.ParentProcessId
    while ($parentPid -gt 0) {
      $parent = Get-ProcessByIdSafe -Lookup $lookup -ProcessId $parentPid
      if ($null -eq $parent) {
        break
      }
      if (-not (Test-IsLauncherProcess $parent)) {
        break
      }
      if ($stopped.Add($parentPid)) {
        Stop-ProcessTreeSafe -ProcessId $parentPid
      }
      $parentPid = [int]$parent.ParentProcessId
    }
  }

  Start-Sleep -Milliseconds 600
  if (Test-Path -LiteralPath $stateFile) {
    Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue
  }
}

function Start-DevInstance {
  if (-not $NoBuild) {
    Ensure-BackendBins
  }

  Stop-ExistingDevInstance

  $stateRoot = Get-StateRoot
  $dataDir = Join-Path $stateRoot "data"
  $electronDir = Join-Path $stateRoot "electron-userdata"
  $logPath = Get-DevLogPath
  $configDir = "C:\Users\baba1\.config\wave"

  New-Item -ItemType Directory -Force -Path $stateRoot, $dataDir, $electronDir | Out-Null
  if (Test-Path -LiteralPath $logPath) {
    Remove-Item -LiteralPath $logPath -Force -ErrorAction SilentlyContinue
  }

  $repoRoot = Get-RepoRoot
  $repoRootEsc = $repoRoot.Replace("'", "''")
  $configEsc = $configDir.Replace("'", "''")
  $dataEsc = $dataDir.Replace("'", "''")
  $electronEsc = $electronDir.Replace("'", "''")
  $logEsc = $logPath.Replace("'", "''")

  $debugFlag = if ($DebugOpenExternal) { '$env:WAVETERM_DEBUG_OPEN_EXTERNAL = "1"' } else { 'Remove-Item Env:WAVETERM_DEBUG_OPEN_EXTERNAL -ErrorAction SilentlyContinue' }

  $inner = @"
`$ErrorActionPreference = 'Stop'
`$env:WAVETERM_PROFILE = 'dev'
`$env:WAVETERM_CONFIG_HOME = '$configEsc'
`$env:WAVETERM_DATA_HOME = '$dataEsc'
`$env:WAVETERM_ELECTRON_USER_DATA_HOME = '$electronEsc'
$debugFlag
Set-Location '$repoRootEsc'
npm run dev *>> '$logEsc'
"@

  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($inner))
  $launcher = Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-EncodedCommand", $encoded) `
    -WindowStyle Hidden `
    -PassThru

  $deadline = (Get-Date).AddSeconds([Math]::Max(15, $WaitTimeoutSec))
  $mainProc = $null
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 800
    $mainProc = Get-DevMainProcesses | Sort-Object ProcessId | Select-Object -First 1
    if ($null -ne $mainProc) {
      break
    }
    try {
      $launcher.Refresh()
      if ($launcher.HasExited) {
        break
      }
    } catch {
      break
    }
  }

  if ($null -eq $mainProc) {
    $logTail = ""
    if (Test-Path -LiteralPath $logPath) {
      $logTail = (Get-Content -LiteralPath $logPath -Tail 80 -ErrorAction SilentlyContinue) -join "`n"
    }
    throw "dev instance did not appear within $WaitTimeoutSec seconds.`n$logTail"
  }

  $lookup = Get-ProcessLookup
  $nodePid = 0
  $cmdPid = 0
  $npmPid = 0
  $ancestorPid = [int]$mainProc.ParentProcessId
  while ($ancestorPid -gt 0) {
    $ancestor = Get-ProcessByIdSafe -Lookup $lookup -ProcessId $ancestorPid
    if ($null -eq $ancestor) {
      break
    }
    switch -Regex ($ancestor.Name) {
      '^node\.exe$' {
        $cmdline = [string]$ancestor.CommandLine
        if ($cmdline.ToLowerInvariant().Contains("electron-vite.js")) {
          $nodePid = [int]$ancestor.ProcessId
        } elseif ($cmdline.ToLowerInvariant().Contains("npm-cli.js run dev")) {
          $npmPid = [int]$ancestor.ProcessId
        }
      }
      '^cmd\.exe$' {
        if ($cmdPid -eq 0) {
          $cmdPid = [int]$ancestor.ProcessId
        }
      }
    }
    $ancestorPid = [int]$ancestor.ParentProcessId
  }

  $state = [ordered]@{
    started_at = (Get-Date).ToString("o")
    repo_root = $repoRoot
    launcher_pid = [int]$launcher.Id
    main_pid = [int]$mainProc.ProcessId
    npm_pid = $npmPid
    cmd_pid = $cmdPid
    node_pid = $nodePid
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

  $main = Get-DevMainProcesses | Sort-Object ProcessId | Select-Object -First 1
  return [ordered]@{
    has_state_file = [bool](Test-Path -LiteralPath $stateFile)
    state = $savedState
    running = [bool]($null -ne $main)
    main_pid = if ($null -ne $main) { [int]$main.ProcessId } else { 0 }
    main_command = if ($null -ne $main) { [string]$main.CommandLine } else { "" }
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
