param(
  [Parameter(Mandatory = $false)]
  [string]$ZigVersion = "0.14.0"
)

$ErrorActionPreference = "Stop"

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
  New-Item -ItemType Directory -Force "dist\\bin" | Out-Null

  if (Test-Path "dist\\bin\\wavesrv.x64.exe") {
    Remove-Item -Force "dist\\bin\\wavesrv.x64.exe"
  }

  $env:CGO_ENABLED = "1"
  $env:GOARCH = "amd64"
  $env:CC = "$zigExe cc -target x86_64-windows-gnu"

  go build `
    -tags "osusergo,sqlite_omit_load_extension" `
    -ldflags " -X main.BuildTime=$buildTime -X main.WaveVersion=$version" `
    -o "dist\\bin\\wavesrv.x64.exe" `
    "cmd\\server\\main-server.go"

  $env:CGO_ENABLED = "0"
  $env:GOARCH = "amd64"

  go build `
    -ldflags "-s -w -X main.BuildTime=$buildTime -X main.WaveVersion=$version" `
    -o "dist\\bin\\wsh-$version-windows.x64.exe" `
    "cmd\\wsh\\main-wsh.go"

  Write-Host "[backend] done." -ForegroundColor Green
} finally {
  Pop-Location
}
