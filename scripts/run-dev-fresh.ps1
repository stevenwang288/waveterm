param(
  [Parameter(Mandatory = $false)]
  [switch]$DebugOpenExternal
)

$ErrorActionPreference = "Stop"

function New-RunId {
  return (Get-Date -Format "yyyyMMdd-HHmmss")
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $repoRoot
try {
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
  npm run dev 2>&1 | Tee-Object -FilePath $logPath
} finally {
  Pop-Location
}
