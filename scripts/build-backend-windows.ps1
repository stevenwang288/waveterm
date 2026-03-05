param(
  [Parameter(Mandatory = $false)]
  [string]$ZigVersion = "0.14.0",

  # Output directory for built binaries. Defaults to dist/bin for normal development builds.
  # dev:fresh may pass a temp directory to avoid disrupting a running Wave instance.
  [Parameter(Mandatory = $false)]
  [string]$OutDir = "dist\\bin"
)

$ErrorActionPreference = "Stop"

function Stop-ProcessesUsingExe {
  param([string]$ExePath)

  if (-not $ExePath) {
    return
  }

  $fullPath = $ExePath
  try {
    $fullPath = (Resolve-Path $ExePath).Path
  } catch {
    # ignore
  }

  try {
    $lockedProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $fullPath })
  } catch {
    $lockedProcesses = @()
  }

  foreach ($proc in $lockedProcesses) {
    try {
      Write-Host "[backend] stopping locked process pid=$($proc.ProcessId) path=$fullPath" -ForegroundColor Yellow
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    } catch {
      # ignore
    }
  }

  if ($lockedProcesses.Count -gt 0) {
    Start-Sleep -Milliseconds 250
  }
}

function Ensure-Zig {
  param([string]$Version)

  $toolsRoot = Join-Path $PSScriptRoot "..\\.tmp\\tools"
  $zigRoot = Join-Path $toolsRoot "zig"
  $versionRoot = Join-Path $zigRoot $Version
  $expectedDir = Join-Path $versionRoot "zig-windows-x86_64-$Version"
  $zigExe = Join-Path $expectedDir "zig.exe"

  if (Test-Path $zigExe) {
    return $zigExe
  }

  New-Item -ItemType Directory -Force $versionRoot | Out-Null

  $zipName = "zig-windows-x86_64-$Version.zip"
  $url = "https://ziglang.org/download/$Version/$zipName"
  $zipPath = Join-Path $versionRoot $zipName

  Write-Host "[backend] downloading zig $Version..." -ForegroundColor Cyan
  Write-Host "  $url"

  Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing

  Write-Host "[backend] extracting zig..." -ForegroundColor Cyan
  Expand-Archive -Path $zipPath -DestinationPath $versionRoot -Force
  Remove-Item -Force $zipPath -ErrorAction SilentlyContinue

  if (-not (Test-Path $zigExe)) {
    throw "Failed to find zig.exe at $zigExe"
  }

  return $zigExe
}

function Get-PackageVersion {
  $pkgPath = Join-Path $PSScriptRoot "..\\package.json"
  $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
  return [string]$pkg.version
}

$zigExe = Ensure-Zig -Version $ZigVersion
$version = Get-PackageVersion
$buildTime = Get-Date -Format "yyyyMMddHHmm"

Write-Host "[backend] building wavesrv + wsh..." -ForegroundColor Cyan
Write-Host "  zig:     $zigExe"
Write-Host "  version: $version"
Write-Host "  time:    $buildTime"

  $repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
  Push-Location $repoRoot
  try {
  $outDirPath = $OutDir
  if (-not [System.IO.Path]::IsPathRooted($outDirPath)) {
    $outDirPath = Join-Path $repoRoot $outDirPath
  }
  New-Item -ItemType Directory -Force $outDirPath | Out-Null

  $wavesrvOut = Join-Path $outDirPath "wavesrv.x64.exe"
  $wshOut = Join-Path $outDirPath "wsh-$version-windows.x64.exe"
  $wshLinuxOut = Join-Path $outDirPath "wsh-$version-linux.x64"

  if (Test-Path $wavesrvOut) {
    try {
      Remove-Item -Force $wavesrvOut
    } catch {
      # wavesrv may still be running (dev instance). Stop only the process that uses this exact exe path.
      Stop-ProcessesUsingExe -ExePath $wavesrvOut
      Remove-Item -Force $wavesrvOut
    }
  }

  $env:CGO_ENABLED = "1"
  $env:GOARCH = "amd64"
  $env:CC = "$zigExe cc -target x86_64-windows-gnu"

  go build `
    -tags "osusergo,sqlite_omit_load_extension" `
    -ldflags " -X main.BuildTime=$buildTime -X main.WaveVersion=$version" `
    -o $wavesrvOut `
    "cmd\\server\\main-server.go"

  $env:CGO_ENABLED = "0"
  $env:GOARCH = "amd64"

  go build `
    -ldflags "-s -w -X main.BuildTime=$buildTime -X main.WaveVersion=$version" `
    -o $wshOut `
    "cmd\\wsh\\main-wsh.go"

  # Dev builds on Windows frequently connect to Linux remotes. We need the Linux wsh
  # binary locally so Wave can install/upgrade wsh on the remote host.
  $env:GOOS = "linux"
  $env:GOARCH = "amd64"

  go build `
    -ldflags "-s -w -X main.BuildTime=$buildTime -X main.WaveVersion=$version" `
    -o $wshLinuxOut `
    "cmd\\wsh\\main-wsh.go"

  Write-Host "[backend] done." -ForegroundColor Green
} finally {
  Pop-Location
}
