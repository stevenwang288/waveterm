param(
  [switch]$DebugOpenExternal
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "wave-windows-common.ps1")

$repoRoot = Get-RepoRoot
$version = Get-PackageVersion
$exePath = Join-Path $repoRoot ("make\{0}\win-unpacked\WAVE.exe" -f $version)

if (-not (Test-Path -LiteralPath $exePath)) {
  throw "Built dev sidecar exe not found: $exePath"
}

$root = Join-Path $env:TEMP "wave-built-dev-sidecar"
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

Write-Host "Launching built WAVE sidecar (dev profile)..." -ForegroundColor Cyan
Write-Host "  Exe:      $exePath"
Write-Host "  userData: $electronUserData"
Write-Host "  config:   $configHome"
Write-Host "  data:     $dataHome"
Write-Host "  logs:     $(Join-Path $dataHome 'logs')"

Start-Process -FilePath $exePath -ArgumentList @("--profile", "dev")
