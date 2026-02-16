param(
    [string]$ExePath = "",
    [int]$WaitSeconds = 8,
    [switch]$KillExisting = $true
)

$ErrorActionPreference = "Stop"

function Resolve-DefaultExePath {
    $repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
    $defaultPath = Join-Path $repoRoot "make\\win-unpacked\\WAVE.exe"
    return $defaultPath
}

if ([string]::IsNullOrWhiteSpace($ExePath)) {
    $ExePath = Resolve-DefaultExePath
}

if (!(Test-Path -LiteralPath $ExePath)) {
    throw "WAVE executable not found: $ExePath"
}

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$tmpRoot = Join-Path $env:TEMP "wave-smoke\\$ts"
$configDir = Join-Path $tmpRoot "config"
$dataDir = Join-Path $tmpRoot "data"

New-Item -ItemType Directory -Force -Path $configDir | Out-Null
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

$env:WAVETERM_CONFIG_HOME = $configDir
$env:WAVETERM_DATA_HOME = $dataDir

Write-Host "Starting WAVE for smoke test..."
Write-Host "  Exe:    $ExePath"
Write-Host "  Config: $configDir"
Write-Host "  Data:   $dataDir"

$existing = @(Get-Process -Name "WAVE" -ErrorAction SilentlyContinue)
$existingPids = @($existing | ForEach-Object { $_.Id })

if ($KillExisting) {
    foreach ($p in $existing) {
        try {
            $null = $p.CloseMainWindow()
        } catch {
            # ignore
        }
    }
    Start-Sleep -Milliseconds 600
    foreach ($p in $existing) {
        try {
            if (!$p.HasExited) {
                Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
            }
        } catch {
            # ignore
        }
    }
    Start-Sleep -Milliseconds 300
}

$proc = Start-Process -FilePath $ExePath -PassThru

Start-Sleep -Seconds $WaitSeconds

$current = @(Get-Process -Name "WAVE" -ErrorAction SilentlyContinue)
$newPids = @($current | Where-Object { $existingPids -notcontains $_.Id } | ForEach-Object { $_.Id })

if ($proc.HasExited -and $newPids.Count -eq 0) {
    throw "WAVE exited early (exit code $($proc.ExitCode)) and no new WAVE process was detected."
}

$settingsPath = Join-Path $configDir "settings.json"
if (!(Test-Path -LiteralPath $settingsPath)) {
    Write-Warning "settings.json not found yet (may still be initializing): $settingsPath"
} else {
    Write-Host "Found settings.json: $settingsPath"
}

Write-Host "Stopping WAVE..."
foreach ($pid in $newPids) {
    try {
        $p = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($null -ne $p) {
            try {
                $null = $p.CloseMainWindow()
            } catch {
                # ignore
            }
        }
    } catch {
        # ignore
    }
}

Start-Sleep -Milliseconds 800

foreach ($pid in $newPids) {
    try {
        $p = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($null -ne $p -and !$p.HasExited) {
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    } catch {
        # ignore
    }
}

Write-Host "Smoke test OK."
