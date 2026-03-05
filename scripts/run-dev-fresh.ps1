param(
  [Parameter(Mandatory = $false)]
  [switch]$DebugOpenExternal,

  # By default, dev:fresh will seed the config directory from a stable local seed and persist changes back to it.
  # This prevents having to reconfigure things like "wall:url" on every run while still isolating your main profile.
  [Parameter(Mandatory = $false)]
  [switch]$NoSeed,

  # Use a per-run Electron userData directory while still seeding config.
  # This avoids single-instance-lock failures when the stable seed userData directory is still locked by a stale process.
  [Parameter(Mandatory = $false)]
  [switch]$FreshElectron,

  # Electron remote debugging port (CDP). Useful for smoke automation scripts.
  [Parameter(Mandatory = $false)]
  [int]$RemoteDebugPort = 0
)

$ErrorActionPreference = "Stop"

function Stop-StaleDevFreshProcesses {
  param([string]$RepoRoot)

  try {
    $electronExe = Join-Path $RepoRoot "node_modules\\electron\\dist\\electron.exe"
    $electronProcs = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.ExecutablePath -eq $electronExe }

    $nodeProcs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
      $_.CommandLine -and $_.CommandLine -like "*$RepoRoot*" -and $_.CommandLine -like "*electron-vite*dev*"
    }

    $wavesrvProcs = Get-CimInstance Win32_Process | Where-Object {
      $_.ExecutablePath -and $_.ExecutablePath -like "$RepoRoot\\.tmp\\dev-fresh\\*" -and $_.Name -like "wavesrv*.exe"
    }

    $all = @(@($electronProcs) + @($nodeProcs) + @($wavesrvProcs)) | Where-Object { $_ -ne $null } | Sort-Object ProcessId -Unique
    if ($all.Count -eq 0) {
      return
    }

    Write-Host "[dev:fresh] stopping stale dev processes: electron=$($electronProcs.Count) node=$($nodeProcs.Count) wavesrv=$($wavesrvProcs.Count)" -ForegroundColor Yellow
    foreach ($p in $all) {
      try {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
      } catch {
        # ignore
      }
    }
  } catch {
    Write-Host "[dev:fresh] warning: failed to stop stale dev processes: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

function Get-PackageVersion {
  $pkgPath = Join-Path $PSScriptRoot "..\\package.json"
  $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
  return [string]$pkg.version
}

function Get-NodeArchTag {
  $arch = $env:PROCESSOR_ARCHITECTURE
  if ($arch -eq $null) {
    $arch = ""
  }
  $arch = $arch.ToUpperInvariant()
  if ($arch -eq "ARM64") {
    return "arm64"
  }
  if ($arch -eq "X86") {
    return "ia32"
  }
  return "x64"
}

function Get-GoLdflagsLine {
  param([string]$ExePath)
  if (-not (Test-Path $ExePath)) {
    return ""
  }
  try {
    # We intentionally parse build info from the binary itself to avoid "dev runs with old dist/bin"
    # which makes Wave look like it has multiple inconsistent versions.
    $out = & go version -m $ExePath 2>$null
    if (-not $out) {
      return ""
    }
    $match = $out | Select-String -Pattern "main\\.WaveVersion|main\\.BuildTime" | Select-Object -First 1
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
  $raw = [string]$m.Groups[1].Value
  return $raw.Trim('"').Trim("'")
}

function Ensure-BackendBins {
  $repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
  $version = Get-PackageVersion
  $archTag = Get-NodeArchTag
  $distBinDir = Join-Path $repoRoot "dist\\bin"
  $wshPath = Join-Path $distBinDir "wsh-$version-windows.x64.exe"
  $wshLinuxPath = Join-Path $distBinDir "wsh-$version-linux.x64"

  # Build wavesrv into an isolated per-version directory so dev:fresh can run without touching dist/bin.
  # This avoids killing another running Wave instance that may still be using dist/bin/wavesrv.*.
  $isolatedBinDir = Join-Path $repoRoot ".tmp\\dev-fresh\\_backend-bin\\$version"
  $isolatedWavesrvPath = Join-Path $isolatedBinDir "wavesrv.$archTag.exe"
  if ($archTag -eq "x64") {
    $isolatedWavesrvPath = Join-Path $isolatedBinDir "wavesrv.x64.exe"
  }

  $needBuild = $false
  if (-not (Test-Path $isolatedWavesrvPath)) {
    $needBuild = $true
  }

  if (-not $needBuild) {
    $wavesrvLdflags = Get-GoLdflagsLine -ExePath $isolatedWavesrvPath
    $wavesrvVersion = Get-WaveVersionFromLdflags -LdflagsLine $wavesrvLdflags
    if ($wavesrvVersion -ne $version) {
      $needBuild = $true
    }
  }

  if ($needBuild) {
    Write-Host "[dev:fresh] isolated wavesrv missing/stale; building into $isolatedBinDir ..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force $isolatedBinDir | Out-Null
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build-backend-windows.ps1") -OutDir $isolatedBinDir | Out-Host
  } else {
    Write-Host "[dev:fresh] isolated wavesrv OK: $isolatedWavesrvPath" -ForegroundColor DarkGray
  }

  if (-not (Test-Path $wshPath) -or -not (Test-Path $wshLinuxPath)) {
    $buildTime = Get-Date -Format "yyyyMMddHHmm"
    New-Item -ItemType Directory -Force $distBinDir | Out-Null
    Write-Host "[dev:fresh] missing wsh bins; building dist/bin/wsh-$version-{windows/linux}.x64..." -ForegroundColor Yellow
    Push-Location $repoRoot
    try {
      $prevCgo = $env:CGO_ENABLED
      $prevGoos = $env:GOOS
      $prevGoarch = $env:GOARCH
      try {
        $env:CGO_ENABLED = "0"
        $env:GOARCH = "amd64"

        $env:GOOS = "windows"
        go build `
          -ldflags "-s -w -X main.BuildTime=$buildTime -X main.WaveVersion=$version" `
          -o $wshPath `
          "cmd\\wsh\\main-wsh.go"

        $env:GOOS = "linux"
        go build `
          -ldflags "-s -w -X main.BuildTime=$buildTime -X main.WaveVersion=$version" `
          -o $wshLinuxPath `
          "cmd\\wsh\\main-wsh.go"
      } finally {
        $env:CGO_ENABLED = $prevCgo
        $env:GOOS = $prevGoos
        $env:GOARCH = $prevGoarch
      }
    } finally {
      Pop-Location
    }
  }

  return $isolatedWavesrvPath
}

function New-RunId {
  return (Get-Date -Format "yyyyMMdd-HHmmss")
}

function Copy-DirContents {
  param(
    [Parameter(Mandatory = $true)][string]$SrcDir,
    [Parameter(Mandatory = $true)][string]$DstDir,
    [Parameter(Mandatory = $false)][string[]]$ExcludeNames = @()
  )
  if (-not (Test-Path $SrcDir)) {
    return
  }
  New-Item -ItemType Directory -Force $DstDir | Out-Null
  $items = Get-ChildItem -Force -LiteralPath $SrcDir -ErrorAction SilentlyContinue
  foreach ($item in $items) {
    if ($ExcludeNames -contains $item.Name) {
      continue
    }
    $dst = Join-Path $DstDir $item.Name
    Copy-Item -LiteralPath $item.FullName -Destination $dst -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $repoRoot
try {
  Stop-StaleDevFreshProcesses -RepoRoot $repoRoot

  $seedRoot = Join-Path $repoRoot ".tmp\\dev-fresh\\_seed"
  $seedConfigDir = Join-Path $seedRoot "config"
  $seedElectronDir = Join-Path $seedRoot "electron-userdata"
  $seedElectronDirExisted = Test-Path $seedElectronDir

  $runId = New-RunId
  $root = Join-Path $repoRoot ".tmp\\dev-fresh\\$runId"
  $configDir = Join-Path $root "config"
  $dataDir = Join-Path $root "data"
  New-Item -ItemType Directory -Force $configDir | Out-Null
  New-Item -ItemType Directory -Force $dataDir | Out-Null

  # Use a stable Electron userData directory for dev:fresh runs (unless -NoSeed is used) so that
  # safeStorage-based secret encryption remains decryptable across runs. This makes dev PVE auth persistent.
  # Use -FreshElectron to avoid lock conflicts while keeping config seeding enabled.
  if ($NoSeed -or $FreshElectron) {
    $electronDir = Join-Path $root "electron-userdata"
  } else {
    $electronDir = $seedElectronDir
  }
  New-Item -ItemType Directory -Force $electronDir | Out-Null

  # If this is the first run using a stable Electron userData directory, drop any previously persisted
  # secrets.enc from the seed. Old secrets may have been encrypted with a different userData key and
  # can cause decrypt failures.
  if (-not $NoSeed -and -not $FreshElectron -and -not $seedElectronDirExisted) {
    $seedSecretsPath = Join-Path $seedConfigDir "secrets.enc"
    if (Test-Path $seedSecretsPath) {
      Write-Host "[dev:fresh] first stable electron-userdata run; removing seed secrets.enc to avoid decrypt mismatch" -ForegroundColor Yellow
      Remove-Item -LiteralPath $seedSecretsPath -Force -ErrorAction SilentlyContinue
    }
  }

  Write-Host "[dev:fresh] runId=$runId" -ForegroundColor Cyan
  Write-Host "[dev:fresh] config=$configDir"
  Write-Host "[dev:fresh] data=$dataDir"

  if (-not $NoSeed -and (Test-Path $seedConfigDir)) {
    Write-Host "[dev:fresh] seeding config from $seedConfigDir" -ForegroundColor DarkGray
    Copy-DirContents -SrcDir $seedConfigDir -DstDir $configDir
  } elseif ($NoSeed) {
    Write-Host "[dev:fresh] config seeding disabled (-NoSeed)" -ForegroundColor DarkGray
  }

  $env:WAVETERM_PROFILE = "dev"
  $env:WAVETERM_CONFIG_HOME = $configDir
  $env:WAVETERM_DATA_HOME = $dataDir
  $env:WAVETERM_ELECTRON_USER_DATA_HOME = $electronDir

  $isolatedWaveSrvPath = Ensure-BackendBins
  if ($isolatedWaveSrvPath) {
    $env:WAVETERM_WAVESRV_PATH = $isolatedWaveSrvPath
    Write-Host "[dev:fresh] WAVETERM_WAVESRV_PATH=$isolatedWaveSrvPath" -ForegroundColor DarkGray
  }

  if ($DebugOpenExternal) {
    $env:WAVETERM_DEBUG_OPEN_EXTERNAL = "1"
  }

  $logPath = Join-Path $root "dev.log"
  Write-Host "[dev:fresh] log=$logPath"

  # Stream output to screen and log file.
  # NOTE: Electron may write warnings to stderr; do not treat those as fatal in dev:fresh.
  $prevEap = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    if ($RemoteDebugPort -gt 0) {
      npx electron-vite dev --remoteDebuggingPort $RemoteDebugPort 2>&1 | Tee-Object -FilePath $logPath
    } else {
      npm run dev 2>&1 | Tee-Object -FilePath $logPath
    }
  } finally {
    $ErrorActionPreference = $prevEap
  }

  if (-not $NoSeed) {
    try {
      New-Item -ItemType Directory -Force $seedRoot | Out-Null
      if (Test-Path $seedConfigDir) {
        Remove-Item -LiteralPath $seedConfigDir -Recurse -Force -ErrorAction SilentlyContinue
      }
      New-Item -ItemType Directory -Force $seedConfigDir | Out-Null
      Copy-DirContents -SrcDir $configDir -DstDir $seedConfigDir
      Write-Host "[dev:fresh] persisted config seed to $seedConfigDir" -ForegroundColor DarkGray
    } catch {
      Write-Host "[dev:fresh] warning: failed to persist config seed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
  }
} finally {
  Pop-Location
}
