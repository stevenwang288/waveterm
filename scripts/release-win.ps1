param(
  [Parameter(Mandatory = $false)]
  [switch]$AllowDirty,

  [Parameter(Mandatory = $false)]
  [string]$DeskDir = "D:\\DeSK"
)

$ErrorActionPreference = "Stop"

function Get-PackageVersion {
  $pkgPath = Join-Path $PSScriptRoot "..\\package.json"
  $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
  return [string]$pkg.version
}

function Ensure-DeskDir {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
  }
}

function Invoke-Npm {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Args
  )

  & npm.cmd @Args
}

function Assert-CleanGit {
  param([switch]$AllowDirty)
  if ($AllowDirty) {
    return
  }
  $dirty = & git status --porcelain
  if ($LASTEXITCODE -ne 0) {
    throw "git status failed"
  }
  if ($dirty) {
    throw "Working tree is dirty. Commit/stash changes or re-run with -AllowDirty."
  }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $repoRoot
try {
  Assert-CleanGit -AllowDirty:$AllowDirty

  $version = Get-PackageVersion
  $sha = (& git rev-parse --short HEAD).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "git rev-parse failed"
  }

  Write-Host "[release:win] version=$version sha=$sha"

  Write-Host "[release:win] build:prod"
  Invoke-Npm -Args @("run", "build:prod")
  if ($LASTEXITCODE -ne 0) {
    throw "npm run build:prod failed"
  }

  if ($AllowDirty) {
    Write-Host "[release:win] package:win (allow dirty)"
    Invoke-Npm -Args @("run", "package:win:allow-dirty")
  } else {
    Write-Host "[release:win] package:win"
    Invoke-Npm -Args @("run", "package:win")
  }
  if ($LASTEXITCODE -ne 0) {
    throw "npm run package:win failed"
  }

  $src = Join-Path $repoRoot ("make\\{0}\\WAVE-win32-x64-{0}.exe" -f $version)
  if (-not (Test-Path $src)) {
    throw "installer not found: $src"
  }

  Ensure-DeskDir -Path $DeskDir
  $dst = Join-Path $DeskDir ("WAVE-win32-x64-{0}-fix-{1}.exe" -f $version, $sha)
  Copy-Item -Force $src $dst

  $hash = (Get-FileHash -Algorithm SHA256 $dst).Hash
  Write-Host "[release:win] out=$dst"
  Write-Host "[release:win] sha256=$hash"
} finally {
  Pop-Location
}
