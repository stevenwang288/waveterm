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

function Get-RepoEsbuildBinaryPath {
  $repoRoot = Get-RepoRoot
  $src = Join-Path $repoRoot "node_modules\@esbuild\win32-x64\esbuild.exe"
  if (-not (Test-Path -LiteralPath $src)) {
    return ""
  }

  $toolsDir = Join-Path $repoRoot ".tmp\tools"
  Ensure-Directory -Path $toolsDir
  $dst = Join-Path $toolsDir "esbuild.exe"

  $copyRequired = -not (Test-Path -LiteralPath $dst)
  if (-not $copyRequired) {
    $srcItem = Get-Item -LiteralPath $src
    $dstItem = Get-Item -LiteralPath $dst
    if ($srcItem.Length -ne $dstItem.Length -or $srcItem.LastWriteTimeUtc -gt $dstItem.LastWriteTimeUtc) {
      $copyRequired = $true
    }
  }

  if ($copyRequired) {
    Copy-Item -Force -LiteralPath $src -Destination $dst
  }

  return $dst
}

function Enable-RepoEsbuildExecutionWorkaround {
  $esbuildPath = Get-RepoEsbuildBinaryPath
  if ([string]::IsNullOrWhiteSpace($esbuildPath)) {
    return ""
  }

  $env:ESBUILD_BINARY_PATH = $esbuildPath
  return $esbuildPath
}

function Invoke-NpmCmd {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Args
  )

  Enable-RepoEsbuildExecutionWorkaround | Out-Null
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
