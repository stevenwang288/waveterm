param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$ExePath,

  [Parameter(Mandatory = $false)]
  [switch]$DebugOpenExternal
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $ExePath)) {
  throw "Exe not found: $ExePath"
}

$root = Join-Path $env:TEMP "wave-sidecar"
$electronUserData = Join-Path $root "electron"
$configHome = Join-Path $root "config"
$dataHome = Join-Path $root "data"

New-Item -ItemType Directory -Force $electronUserData, $configHome, $dataHome | Out-Null

$env:WAVETERM_ELECTRON_USER_DATA_HOME = $electronUserData
$env:WAVETERM_CONFIG_HOME = $configHome
$env:WAVETERM_DATA_HOME = $dataHome
$env:WAVETERM_PROFILE = "dev"

if ($DebugOpenExternal) {
  $env:WAVETERM_DEBUG_OPEN_EXTERNAL = "1"
}

Write-Host "Launching Wave sidecar (dev profile)..." -ForegroundColor Cyan
Write-Host "  Exe: $ExePath"
Write-Host "  userData: $electronUserData"
Write-Host "  config:   $configHome"
Write-Host "  data:     $dataHome"
Write-Host "  logs:     $(Join-Path $dataHome 'logs')"

Start-Process -FilePath $ExePath -ArgumentList @("--profile", "dev")
