param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$ExePath,

  [Parameter(Mandatory = $false)]
  [string]$Text = "Wave local TTS smoke test",

  [Parameter(Mandatory = $false)]
  [int]$TimeoutSec = 120,

  [Parameter(Mandatory = $false)]
  [string]$OutPath = "",

  [Parameter(Mandatory = $false)]
  [switch]$KeepRunning,

  [Parameter(Mandatory = $false)]
  [switch]$DebugOpenExternal
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $ExePath)) {
  throw "Exe not found: $ExePath"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$root = Join-Path $env:TEMP "wave-sidecar-smoke-$timestamp"
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

if ([string]::IsNullOrWhiteSpace($OutPath)) {
  $OutPath = Join-Path $root "tts-smoke.wav"
}

$edgePort = 5050
$endpoint = "http://127.0.0.1:$edgePort/v1/audio/speech"

Write-Host "Launching Wave sidecar (dev profile)..." -ForegroundColor Cyan
Write-Host "  Exe: $ExePath"
Write-Host "  userData: $electronUserData"
Write-Host "  config:   $configHome"
Write-Host "  data:     $dataHome"
Write-Host "  logs:     $(Join-Path $dataHome 'logs')"
Write-Host "  endpoint: $endpoint"
Write-Host "  out:      $OutPath"

$proc = Start-Process -FilePath $ExePath -ArgumentList @("--profile", "dev") -PassThru

try {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $body = @{ input = $Text; voice = "zh-CN-XiaoxiaoNeural"; speed = 1 } | ConvertTo-Json

  while ($true) {
    try {
      Invoke-WebRequest -Method Post -Uri $endpoint -ContentType "application/json" -Body $body -OutFile $OutPath -UseBasicParsing | Out-Null
      break
    } catch {
      if ((Get-Date) -ge $deadline) {
        throw "Timed out waiting for local TTS server on $endpoint ($TimeoutSec sec)"
      }
      Write-Host -NoNewline "."
      Start-Sleep -Milliseconds 250
    }
  }
  Write-Host ""

  $size = (Get-Item $OutPath).Length
  Write-Host "OK: wrote wav ($size bytes)" -ForegroundColor Green
} finally {
  if (-not $KeepRunning) {
    try {
      Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    } catch {}
  } else {
    Write-Host "Keeping Wave running (PID $($proc.Id))." -ForegroundColor Yellow
  }
}
