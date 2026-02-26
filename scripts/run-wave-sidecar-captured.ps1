param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$ExePath,

  [Parameter(Mandatory = $false)]
  [string]$Root = "",

  [Parameter(Mandatory = $false)]
  [switch]$DebugOpenExternal,

  [Parameter(Mandatory = $false)]
  [switch]$KeepRunning
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $ExePath)) {
  throw "Exe not found: $ExePath"
}

if ([string]::IsNullOrWhiteSpace($Root)) {
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $Root = Join-Path $env:TEMP "wave-sidecar-captured-$timestamp"
}

$electronUserData = Join-Path $Root "electron"
$configHome = Join-Path $Root "config"
$dataHome = Join-Path $Root "data"
$logsDir = Join-Path $dataHome "logs"
$stdoutPath = Join-Path $Root "wave.stdout.log"
$stderrPath = Join-Path $Root "wave.stderr.log"

New-Item -ItemType Directory -Force $electronUserData, $configHome, $dataHome, $logsDir | Out-Null

$env:WAVETERM_ELECTRON_USER_DATA_HOME = $electronUserData
$env:WAVETERM_CONFIG_HOME = $configHome
$env:WAVETERM_DATA_HOME = $dataHome
$env:WAVETERM_PROFILE = "dev"

if ($DebugOpenExternal) {
  $env:WAVETERM_DEBUG_OPEN_EXTERNAL = "1"
}

Write-Host "Launching Wave sidecar (captured logs, dev profile)..." -ForegroundColor Cyan
Write-Host "  Exe:      $ExePath"
Write-Host "  Root:     $Root"
Write-Host "  userData: $electronUserData"
Write-Host "  config:   $configHome"
Write-Host "  data:     $dataHome"
Write-Host "  logs:     $logsDir"
Write-Host "  stdout:   $stdoutPath"
Write-Host "  stderr:   $stderrPath"

$proc = Start-Process `
  -FilePath $ExePath `
  -ArgumentList @("--profile", "dev") `
  -PassThru `
  -WindowStyle Normal `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath

Write-Host "Started PID $($proc.Id)" -ForegroundColor Green

if (-not $KeepRunning) {
  Write-Host "Tip: use -KeepRunning to keep the app open while you inspect logs." -ForegroundColor DarkGray
}
