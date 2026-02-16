param(
    [string]$ExePath = "",
    [int]$DebugPort = 9223,
    [string]$Message = "你好",
    [int]$WaitSeconds = 10,
    [string]$Scenario = "settings",
    [switch]$LeaveRunning = $false
)

$ErrorActionPreference = "Stop"

function Resolve-DefaultExePath {
    $repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
    return (Join-Path $repoRoot "make\\win-unpacked\\WAVE.exe")
}

if ([string]::IsNullOrWhiteSpace($ExePath)) {
    $ExePath = Resolve-DefaultExePath
}

if (!(Test-Path -LiteralPath $ExePath)) {
    throw "WAVE executable not found: $ExePath"
}

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$tmpRoot = Join-Path $env:TEMP "wave-tts-smoke\\$ts"
$configDir = Join-Path $tmpRoot "config"
$dataDir = Join-Path $tmpRoot "data"
$electronDir = Join-Path $tmpRoot "electron-userdata"

New-Item -ItemType Directory -Force -Path $configDir | Out-Null
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
New-Item -ItemType Directory -Force -Path $electronDir | Out-Null

# Seed from your existing WAVE config/data so Wave AI + speech work without re-login/re-setup.
$stableConfig = Join-Path $env:USERPROFILE ".config\\wave"
$stableData = Join-Path $env:LOCALAPPDATA "wave\\Data"

if (Test-Path -LiteralPath $stableConfig) {
    Copy-Item -Recurse -Force -Path (Join-Path $stableConfig "*") -Destination $configDir -ErrorAction SilentlyContinue
}
if (Test-Path -LiteralPath $stableData) {
    Copy-Item -Recurse -Force -Path (Join-Path $stableData "*") -Destination $dataDir -ErrorAction SilentlyContinue
    # Never copy a live socket file.
    Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath (Join-Path $dataDir "wave.sock")
}

# Ensure speech autoplay is enabled for the smoke run.
$settingsPath = Join-Path $configDir "settings.json"
if (Test-Path -LiteralPath $settingsPath) {
    try {
        $json = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
        $json | Add-Member -NotePropertyName "speech:enabled" -NotePropertyValue $true -Force
        $json | Add-Member -NotePropertyName "speech:autoplay" -NotePropertyValue $true -Force
        # Windows PowerShell's `-Encoding UTF8` writes a BOM, which breaks our JSON parser.
        $jsonText = $json | ConvertTo-Json -Depth 50
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($settingsPath, $jsonText, $utf8NoBom)
    } catch {
        Write-Warning "Failed to update settings.json for speech autoplay: $($_.Exception.Message)"
    }
}

$env:WAVETERM_CONFIG_HOME = $configDir
$env:WAVETERM_DATA_HOME = $dataDir
$env:WAVETERM_ELECTRON_USER_DATA_HOME = $electronDir

Write-Host "Starting WAVE sidecar (no install) for WaveAI+TTS smoke..."
Write-Host "  Exe:     $ExePath"
Write-Host "  Port:    $DebugPort"
Write-Host "  Message: $Message"
Write-Host "  Config:  $configDir"
Write-Host "  Data:    $dataDir"
Write-Host "  Electron:$electronDir"

$existing = @(Get-Process -Name "WAVE" -ErrorAction SilentlyContinue)
$existingPids = @($existing | ForEach-Object { $_.Id })

$proc = Start-Process -FilePath $ExePath -ArgumentList @("--remote-debugging-port=$DebugPort") -PassThru
Start-Sleep -Seconds $WaitSeconds

$current = @(Get-Process -Name "WAVE" -ErrorAction SilentlyContinue)
$newPids = @($current | Where-Object { $existingPids -notcontains $_.Id } | ForEach-Object { $_.Id })

if ($proc.HasExited -and $newPids.Count -eq 0) {
    throw "Sidecar WAVE exited early (exit code $($proc.ExitCode)) and no new WAVE process was detected."
}

Write-Host "Detected new WAVE PIDs: $($newPids -join ', ')"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $repoRoot
$nodeExitCode = 0
try {
    node scripts/smoke-waveai-tts-cdp.mjs --port $DebugPort --message $Message --scenario $Scenario
    $nodeExitCode = $LASTEXITCODE
    if ($nodeExitCode -ne 0) {
        Write-Host "WaveAI+TTS smoke failed (node exit code $nodeExitCode)"
    } else {
        Write-Host "WaveAI+TTS smoke OK."
    }
} finally {
    Pop-Location
}

if ($LeaveRunning) {
    Write-Host "Leaving sidecar running."
    exit $nodeExitCode
}

Write-Host "Stopping sidecar WAVE..."
foreach ($procId in $newPids) {
    try {
        $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($null -ne $p) {
            try { $null = $p.CloseMainWindow() } catch {}
        }
    } catch {}
}
Start-Sleep -Milliseconds 800
foreach ($procId in $newPids) {
    try {
        $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($null -ne $p -and !$p.HasExited) {
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
    } catch {}
}

Write-Host "Sidecar stopped."

exit $nodeExitCode
