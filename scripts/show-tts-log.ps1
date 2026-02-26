param(
  [Parameter(Mandatory = $false)]
  [string]$DataHome = "",

  [Parameter(Mandatory = $false)]
  [int]$Tail = 30
)

$ErrorActionPreference = "Stop"

function Get-LatestSpeechLog {
  param([string]$LogsDir)
  if (-not (Test-Path $LogsDir)) {
    return $null
  }
  return Get-ChildItem -LiteralPath $LogsDir -Filter "tts-speech-*.ndjson" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
}

if ([string]::IsNullOrWhiteSpace($DataHome)) {
  $defaultLogs = Join-Path (Join-Path $env:LOCALAPPDATA "wave") "data\\logs"
  $defaultLogsDev = Join-Path (Join-Path $env:LOCALAPPDATA "wave-dev") "data\\logs"
  $file = Get-LatestSpeechLog -LogsDir $defaultLogsDev
  if (-not $file) {
    $file = Get-LatestSpeechLog -LogsDir $defaultLogs
  }
  if (-not $file) {
    Write-Host "No tts-speech logs found under:" -ForegroundColor Yellow
    Write-Host "  $defaultLogsDev"
    Write-Host "  $defaultLogs"
    exit 1
  }
} else {
  $logsDir = Join-Path $DataHome "logs"
  $file = Get-LatestSpeechLog -LogsDir $logsDir
  if (-not $file) {
    Write-Host "No tts-speech logs found under: $logsDir" -ForegroundColor Yellow
    exit 1
  }
}

Write-Host "TTS speech log: $($file.FullName)" -ForegroundColor Cyan
Get-Content -LiteralPath $file.FullName -Tail $Tail

