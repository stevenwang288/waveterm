$ErrorActionPreference = "Stop"

function Get-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Get-PackageVersion {
  $pkgPath = Join-Path (Get-RepoRoot) "package.json"
  $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
  return [string]$pkg.version
}

function Get-NodeArchTag {
  $arch = [string]$env:PROCESSOR_ARCHITECTURE
  if ($null -eq $arch) {
    $arch = ""
  }
  $arch = $arch.ToUpperInvariant()
  if ($arch -eq "ARM64") { return "arm64" }
  if ($arch -eq "X86") { return "ia32" }
  return "x64"
}

function Get-GoLdflagsLine {
  param([string]$ExePath)
  if (-not (Test-Path -LiteralPath $ExePath)) {
    return ""
  }
  try {
    $out = & go version -m $ExePath 2>$null
    if (-not $out) {
      return ""
    }
    $match = $out | Select-String -Pattern "main\.WaveVersion|main\.BuildTime" | Select-Object -First 1
    if (-not $match) {
      return ""
    }
    return [string]$match.Line
  } catch {
    return ""
  }
}

function Get-WaveVersionFromLdflags {
  param([string]$LdflagsLine)
  if (-not $LdflagsLine) {
    return ""
  }
  $m = [regex]::Match($LdflagsLine, 'main\.WaveVersion=([^\s]+)')
  if (-not $m.Success) {
    return ""
  }
  return ([string]$m.Groups[1].Value).Trim('"').Trim("'")
}

function Invoke-WaveBackendBuild {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build-backend-windows.ps1")
}

function Ensure-WaveBackendBins {
  param(
    [string]$LogPrefix = ""
  )

  $repoRoot = Get-RepoRoot
  $version = Get-PackageVersion
  $archTag = Get-NodeArchTag
  $wavesrvPath = Join-Path $repoRoot "dist\bin\wavesrv.$archTag.exe"
  $wshPath = Join-Path $repoRoot "dist\bin\wsh-$version-windows.x64.exe"

  $needBuild = $false
  if (-not (Test-Path -LiteralPath $wavesrvPath)) { $needBuild = $true }
  if (-not (Test-Path -LiteralPath $wshPath)) { $needBuild = $true }

  if (-not $needBuild) {
    $wavesrvLdflags = Get-GoLdflagsLine -ExePath $wavesrvPath
    $wavesrvVersion = Get-WaveVersionFromLdflags -LdflagsLine $wavesrvLdflags
    if ($wavesrvVersion -ne $version) {
      $needBuild = $true
    }
  }

  $prefix = if ([string]::IsNullOrWhiteSpace($LogPrefix)) { "" } else { "$LogPrefix " }

  if ($needBuild) {
    if ($prefix -ne "") {
      Write-Host "${prefix}backend bins missing/stale; rebuilding wavesrv + wsh..." -ForegroundColor Yellow
    }
    Invoke-WaveBackendBuild
    return
  }

  if ($prefix -ne "") {
    Write-Host "${prefix}backend bins OK: dist/bin matches package.json version $version" -ForegroundColor DarkGray
  }
}

function Ensure-Directory {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
  }
}

function Invoke-NpmCmd {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Args
  )

  & npm.cmd @Args
}

function Get-FileSha256 {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $hashCmd = Get-Command Get-FileHash -ErrorAction SilentlyContinue
  if ($null -ne $hashCmd) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash
  }

  $certutilOutput = & certutil.exe -hashfile $Path SHA256 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $certutilOutput) {
    throw "failed to compute SHA256 for $Path"
  }

  $hashLine = @($certutilOutput | Where-Object { $_ -match '^[0-9A-Fa-f ]+$' } | Select-Object -First 1)
  if ($hashLine.Count -eq 0) {
    throw "failed to parse SHA256 output for $Path"
  }

  return (($hashLine[0] -replace '\s+', '').Trim()).ToUpperInvariant()
}
