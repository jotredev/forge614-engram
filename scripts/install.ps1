[CmdletBinding()]
param(
  [string] $Version,
  [string] $BinDir,
  [switch] $Force,
  [switch] $Help,
  [string] $ReleaseBaseUrl,
  [switch] $SkipInstall
)

$ErrorActionPreference = 'Stop'

function Show-Usage {
  @(
    'Install a verified Forge614 Engram release binary.',
    'Usage: powershell -File scripts/install.ps1 [-Version TAG] [-BinDir PATH] [-Force]',
    'Default destination: $env:LOCALAPPDATA\Forge614\bin\forge614-engram.exe',
    '-Force explicitly replaces an existing installation.'
  ) | ForEach-Object { Write-Output $_ }
}

function Stop-Install([string] $Message) {
  [Console]::Error.WriteLine($Message)
  exit 1
}

function Test-LoopbackFixtureUri([string] $Uri) {
  $parsed = [System.Uri]$Uri
  if (
    $parsed.Scheme -ne 'http' -or
    $parsed.Host -notin @('127.0.0.1', 'localhost') -or
    $parsed.UserInfo -ne '' -or
    $parsed.IsDefaultPort -or
    $parsed.Port -lt 1 -or
    $parsed.Port -gt 65535
  ) { throw 'Test fixture URLs must be loopback HTTP URLs with an explicit numeric port.' }
}

function Test-ReleaseUri([string] $Uri, [bool] $AllowLocalHttp) {
  if ($AllowLocalHttp) { Test-LoopbackFixtureUri $Uri; return }
  $parsed = [System.Uri]$Uri
  if ($parsed.Scheme -eq 'https') { return }
  throw 'Release URL must use HTTPS.'
}

function Write-TestAssetSelectionFailure([string] $AssetName, [int] $AssetCount) {
  if (-not $testEndpoint) { return }
  [Console]::Error.WriteLine("Test fixture asset selection failed: expected one $AssetName asset; received $AssetCount.")
}

function Publish-UserPath {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string] $Directory,
    [scriptblock] $PathReader = { [Environment]::GetEnvironmentVariable('Path', 'User') },
    [scriptblock] $PathWriter = { param([string] $Value) [Environment]::SetEnvironmentVariable('Path', $Value, 'User') },
    [scriptblock] $EnvironmentChangeNotifier = {
      if (-not ('Forge614Installer.UserEnvironmentNotifier' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace Forge614Installer {
  public static class UserEnvironmentNotifier {
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern IntPtr SendMessageTimeout(
      IntPtr hWnd, uint msg, IntPtr wParam, string lParam,
      uint flags, uint timeout, out IntPtr result);
  }
}
'@
      }
      $result = [IntPtr]::Zero
      [Forge614Installer.UserEnvironmentNotifier]::SendMessageTimeout(
        [IntPtr]0xffff, 0x001a, [IntPtr]::Zero, 'Environment', 2, 5000, [ref] $result) | Out-Null
    }
  )

  $currentPath = [string](& $PathReader)
  $normalizedDirectory = $Directory.TrimEnd([char[]]@('\', '/'))
  $hasDirectory = @($currentPath -split ';' | Where-Object {
    $_.TrimEnd([char[]]@('\', '/')) -ieq $normalizedDirectory
  }).Count -gt 0
  if ($hasDirectory) { return }

  $newPath = if ($currentPath) { "$currentPath;$Directory" } else { $Directory }
  & $PathWriter $newPath
  & $EnvironmentChangeNotifier
}

if ($SkipInstall) { return }

if ($Help) { Show-Usage; exit 0 }
if ($Version -and $Version -notmatch '^v?[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z][0-9A-Za-z.-]*)?$') {
  Stop-Install 'Invalid release tag. Use a semantic version tag such as v1.2.3.'
}

$repository = 'jotredev/forge614-engram'
$selector = if ($Version) { "tags/$Version" } else { 'latest' }
$testEndpoint = $false
if ($ReleaseBaseUrl) {
  try {
    Test-LoopbackFixtureUri $ReleaseBaseUrl
    $testEndpoint = $true
    $releaseJsonUrl = "$($ReleaseBaseUrl.TrimEnd('/'))/repos/$repository/releases/$selector"
  } catch {
    Stop-Install '-ReleaseBaseUrl is reserved for local test fixtures.'
  }
} else {
  $releaseJsonUrl = "https://api.github.com/repos/$repository/releases/$selector"
}

$architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
switch ($architecture.ToUpperInvariant()) {
  'AMD64' { $artifact = 'forge614-engram-windows-x64.exe' }
  'ARM64' { $artifact = 'forge614-engram-windows-arm64.exe' }
  default { Stop-Install 'Unsupported Windows architecture. Supported: AMD64 and ARM64.' }
}

if (-not $BinDir) {
  if (-not $env:LOCALAPPDATA) { Stop-Install 'LOCALAPPDATA must be set when -BinDir is not provided.' }
  $BinDir = Join-Path $env:LOCALAPPDATA 'Forge614\bin'
}
$resolvedBinDir = [System.IO.Path]::GetFullPath($BinDir)
$destination = Join-Path $resolvedBinDir 'forge614-engram.exe'
if ([System.IO.Directory]::Exists($destination)) { Stop-Install 'The destination is a directory; choose a different -BinDir.' }
if ([System.IO.File]::Exists($destination) -and -not $Force) { Stop-Install 'The command already exists. Use -Force to replace it explicitly.' }

$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("forge614-engram-release-" + [Guid]::NewGuid().ToString('N'))
$stagingPath = $null
try {
  [System.IO.Directory]::CreateDirectory($temporaryDirectory) | Out-Null
  Test-ReleaseUri $releaseJsonUrl $testEndpoint
  try {
    $releaseResponse = Invoke-WebRequest -Uri $releaseJsonUrl -UseBasicParsing
    $releaseRawContent = $releaseResponse.Content
    $releaseJson = if ($releaseRawContent -is [byte[]]) {
      [System.Text.Encoding]::UTF8.GetString($releaseRawContent)
    } else {
      [string]$releaseRawContent
    }
    $release = ConvertFrom-Json -InputObject $releaseJson
  } catch {
    Stop-Install 'Could not download release metadata.'
  }
  $manifestAsset = @($release.assets | Where-Object { $_.name -eq 'SHA256SUMS' })
  $binaryAsset = @($release.assets | Where-Object { $_.name -eq $artifact })
  if ($manifestAsset.Count -ne 1) {
    Write-TestAssetSelectionFailure 'SHA256SUMS' $manifestAsset.Count
    Stop-Install 'The release is missing SHA256SUMS.'
  }
  if ($binaryAsset.Count -ne 1) {
    Write-TestAssetSelectionFailure $artifact $binaryAsset.Count
    Stop-Install "The release is missing the $artifact binary."
  }
  Test-ReleaseUri $manifestAsset[0].browser_download_url $testEndpoint
  Test-ReleaseUri $binaryAsset[0].browser_download_url $testEndpoint

  $manifestPath = Join-Path $temporaryDirectory 'SHA256SUMS'
  $binaryPath = Join-Path $temporaryDirectory $artifact
  try {
    Invoke-WebRequest -Uri $manifestAsset[0].browser_download_url -OutFile $manifestPath -UseBasicParsing
    Invoke-WebRequest -Uri $binaryAsset[0].browser_download_url -OutFile $binaryPath -UseBasicParsing
  } catch {
    Stop-Install 'Could not download the release files.'
  }
  $matchingEntries = @(
    Get-Content -LiteralPath $manifestPath | Where-Object {
      $_ -match '^(?<digest>[a-f0-9]{64})  (?<name>\S+)$' -and $Matches.name -eq $artifact
    }
  )
  if ($matchingEntries.Count -ne 1) { Stop-Install "SHA256SUMS does not contain one valid digest for $artifact." }
  $expectedDigest = [regex]::Match($matchingEntries[0], '^[a-f0-9]{64}').Value
  $actualDigest = (Get-FileHash -Algorithm SHA256 -LiteralPath $binaryPath).Hash.ToLowerInvariant()
  if ($expectedDigest -ne $actualDigest) { Stop-Install "Checksum verification failed for $artifact." }

  [System.IO.Directory]::CreateDirectory($resolvedBinDir) | Out-Null
  if ([System.IO.Directory]::Exists($destination)) { Stop-Install 'The destination is a directory; choose a different -BinDir.' }
  if ([System.IO.File]::Exists($destination) -and -not $Force) { Stop-Install 'The command already exists. Use -Force to replace it explicitly.' }
  $stagingPath = Join-Path $resolvedBinDir ('.' + [Guid]::NewGuid().ToString('N') + '.tmp')
  [System.IO.File]::Copy($binaryPath, $stagingPath, $false)
  [System.IO.File]::Move($stagingPath, $destination, [bool]$Force)
  $stagingPath = $null
  Write-Output "Installed: $destination"
  try {
    if ($testEndpoint) {
      $pathReader = { '' }
      $pathWriter = if ($env:FORGE614_INSTALLER_TEST_PATH_WRITE_FAILURE -eq '1') {
        { param([string] $Value) throw 'Test fixture user PATH write failure.' }
      } else {
        { param([string] $Value) }
      }
      Publish-UserPath -Directory $resolvedBinDir -PathReader $pathReader -PathWriter $pathWriter -EnvironmentChangeNotifier {}
    } else {
      Publish-UserPath -Directory $resolvedBinDir
    }
    Write-Output "Added $resolvedBinDir to your user PATH. Open a new terminal to use forge614-engram.exe."
  } catch {
    Write-Warning "The binary was installed, but Forge614 Engram could not add $resolvedBinDir to your user PATH. Add it manually to use forge614-engram.exe from new terminals."
  }
  Write-Output 'forge614-engram setup'
} catch {
  if ($_.Exception.Message) { Stop-Install $_.Exception.Message }
  Stop-Install 'Installation failed.'
} finally {
  if ($stagingPath) { Remove-Item -LiteralPath $stagingPath -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
