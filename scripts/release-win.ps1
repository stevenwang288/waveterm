param(
  [Parameter(Mandatory = $false)]
  [switch]$AllowDirty,

  [Parameter(Mandatory = $false)]
  [string]$DeskDir = "D:\\DeSK"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "wave-windows-common.ps1")

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

$repoRoot = Get-RepoRoot
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
  Invoke-NpmCmd -Args @("run", "build:prod")
  if ($LASTEXITCODE -ne 0) {
    throw "npm run build:prod failed"
  }

  if ($AllowDirty) {
    Write-Host "[release:win] package:win (allow dirty)"
    Invoke-NpmCmd -Args @("run", "package:win:allow-dirty")
  } else {
    Write-Host "[release:win] package:win"
    Invoke-NpmCmd -Args @("run", "package:win")
  }
  if ($LASTEXITCODE -ne 0) {
    throw "npm run package:win failed"
  }

  $src = Join-Path $repoRoot ("make\\{0}\\WAVE-win32-x64-{0}.exe" -f $version)
  if (-not (Test-Path $src)) {
    throw "installer not found: $src"
  }

  Ensure-Directory -Path $DeskDir
  $dst = Join-Path $DeskDir ("WAVE-win32-x64-{0}-fix-{1}.exe" -f $version, $sha)
  Copy-Item -Force $src $dst

  $hash = Get-FileSha256 -Path $dst
  Write-Host "[release:win] out=$dst"
  Write-Host "[release:win] sha256=$hash"
} finally {
  Pop-Location
}
