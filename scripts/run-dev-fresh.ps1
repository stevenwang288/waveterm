param(
  [Parameter(Mandatory = $false)]
  [switch]$DebugOpenExternal
)

$ErrorActionPreference = "Stop"

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
  $wavesrvPath = Join-Path $repoRoot "dist\\bin\\wavesrv.$archTag.exe"
  $wshPath = Join-Path $repoRoot "dist\\bin\\wsh-$version-windows.x64.exe"

  $needBuild = $false
  if (-not (Test-Path $wavesrvPath)) {
    $needBuild = $true
  }
  if (-not (Test-Path $wshPath)) {
    $needBuild = $true
  }

  if (-not $needBuild) {
    $wavesrvLdflags = Get-GoLdflagsLine -ExePath $wavesrvPath
    $wavesrvVersion = Get-WaveVersionFromLdflags -LdflagsLine $wavesrvLdflags
    if ($wavesrvVersion -ne $version) {
      $needBuild = $true
    }
  }

  if ($needBuild) {
    Write-Host "[dev:fresh] backend bins missing/stale; rebuilding wavesrv + wsh..." -ForegroundColor Yellow
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build-backend-windows.ps1")
  } else {
    Write-Host "[dev:fresh] backend bins OK: dist/bin matches package.json version $version" -ForegroundColor DarkGray
  }
}

function New-RunId {
  return (Get-Date -Format "yyyyMMdd-HHmmss")
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $repoRoot
try {
  Ensure-BackendBins

  $runId = New-RunId
  $root = Join-Path $repoRoot ".tmp\\dev-fresh\\$runId"
  $configDir = Join-Path $root "config"
  $dataDir = Join-Path $root "data"
  $electronDir = Join-Path $root "electron-userdata"
  New-Item -ItemType Directory -Force $configDir | Out-Null
  New-Item -ItemType Directory -Force $dataDir | Out-Null
  New-Item -ItemType Directory -Force $electronDir | Out-Null

  Write-Host "[dev:fresh] runId=$runId" -ForegroundColor Cyan
  Write-Host "[dev:fresh] config=$configDir"
  Write-Host "[dev:fresh] data=$dataDir"

  $env:WAVETERM_PROFILE = "dev"
  $env:WAVETERM_CONFIG_HOME = $configDir
  $env:WAVETERM_DATA_HOME = $dataDir
  $env:WAVETERM_ELECTRON_USER_DATA_HOME = $electronDir

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
    npm run dev 2>&1 | Tee-Object -FilePath $logPath
  } finally {
    $ErrorActionPreference = $prevEap
  }
} finally {
  Pop-Location
}
