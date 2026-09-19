$ErrorActionPreference = 'Stop'

$installer = Join-Path $PSScriptRoot '..\install.ps1'
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("forge614-installer-" + [Guid]::NewGuid().ToString('N'))
$fixtureHome = Join-Path $temporaryRoot 'empty-home'
$fixtureFile = Join-Path $temporaryRoot 'fixture-binary.exe'
$diagnosticFile = Join-Path $temporaryRoot 'fixture-server.log'
$fixtureBytes = [System.Text.Encoding]::UTF8.GetBytes("fixture release binary`n")
$serverJob = $null

function Assert-That([bool] $Condition, [string] $Message) {
  if (-not $Condition) { throw $Message }
}

function Get-FixtureDiagnostics {
  if (-not [System.IO.File]::Exists($diagnosticFile)) { return '<fixture server wrote no diagnostics>' }
  return [System.IO.File]::ReadAllText($diagnosticFile)
}

function Invoke-Installer([string] $Architecture, [string[]] $Arguments) {
  $previousArchitecture = $env:PROCESSOR_ARCHITECTURE
  $env:PROCESSOR_ARCHITECTURE = $Architecture
  try {
    $output = & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File $installer @Arguments 2>&1
    return @{ ExitCode = $LASTEXITCODE; Output = ($output | Out-String) }
  } finally {
    if ($null -eq $previousArchitecture) { Remove-Item Env:PROCESSOR_ARCHITECTURE }
    else { $env:PROCESSOR_ARCHITECTURE = $previousArchitecture }
  }
}

# Load the installer helpers without starting an installation. These fixtures use
# an in-memory reader/writer so they never modify the Windows runner user's PATH.
. $installer -SkipInstall

$pathStore = [pscustomobject]@{ Value = 'C:\Tools;C:\Existing' }
$pathReader = { $pathStore.Value }
$pathWriter = { param([string] $Value) $pathStore.Value = $Value }
Publish-UserPath -Directory 'c:\tools\Forge614\bin' -PathReader $pathReader -PathWriter $pathWriter -EnvironmentChangeNotifier {}
Assert-That ($pathStore.Value -eq 'C:\Tools;C:\Existing;c:\tools\Forge614\bin') 'User PATH publication did not preserve existing entries and append the bin directory.'
Publish-UserPath -Directory 'C:\TOOLS\forge614\BIN\' -PathReader $pathReader -PathWriter $pathWriter -EnvironmentChangeNotifier {}
Assert-That ($pathStore.Value -eq 'C:\Tools;C:\Existing;c:\tools\Forge614\bin') 'User PATH publication duplicated an existing bin directory.'

$retainedBinary = Join-Path $temporaryRoot 'path-publication-failure.exe'
New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
[System.IO.File]::WriteAllBytes($retainedBinary, $fixtureBytes)
$failingPathWriter = { param([string] $Value) throw 'fixture user PATH write failure' }
try {
  Publish-UserPath -Directory 'C:\Tools\Forge614\bin' -PathReader $pathReader -PathWriter $failingPathWriter -EnvironmentChangeNotifier {}
  throw 'User PATH publication failure unexpectedly succeeded.'
} catch {
  Assert-That ($_.Exception.Message -eq 'fixture user PATH write failure') "User PATH publication threw the wrong error: $($_.Exception.Message)"
}
Assert-That ([System.IO.File]::Exists($retainedBinary)) 'A failed user PATH write removed a previously installed binary.'

try {
  New-Item -ItemType Directory -Path $fixtureHome -Force | Out-Null
  [System.IO.File]::WriteAllBytes($fixtureFile, $fixtureBytes)
  $sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $fixtureFile).Hash.ToLowerInvariant()
  $serverJob = Start-Job -ArgumentList $fixtureFile, $sha256, $diagnosticFile -ScriptBlock {
    param([string] $Fixture, [string] $Digest, [string] $Diagnostics)
    $listener = $null
    $port = $null
    for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
      $candidate = Get-Random -Minimum 49152 -Maximum 65535
      $candidateListener = [System.Net.HttpListener]::new()
      $candidateListener.Prefixes.Add("http://127.0.0.1:$candidate/")
      try {
        $candidateListener.Start()
        $listener = $candidateListener
        $port = $candidate
        break
      } catch {
        $candidateListener.Close()
      }
    }
    if ($null -eq $listener) { throw 'Could not bind a loopback fixture server.' }
    [pscustomobject]@{ State = 'Ready'; Port = $port } | Write-Output
    try {
      while ($true) {
        $context = $listener.GetContext()
        $path = $context.Request.Url.AbsolutePath
        [System.IO.File]::AppendAllText($Diagnostics, "request-path=$path`n")
        if ($path -eq '/stop') { $context.Response.StatusCode = 204; $context.Response.Close(); break }
        $mismatch = $path.StartsWith('/mismatch/')
        $missingManifest = $path.StartsWith('/missing-manifest/')
        $prefix = if ($mismatch) { "/mismatch" } elseif ($missingManifest) { "/missing-manifest" } else { "/good" }
        $base = "http://127.0.0.1:$Port$prefix"
        if ($path.EndsWith('/releases/tags/v1.2.3')) {
          $assets = @(
            @{ name = 'forge614-engram-windows-x64.exe'; browser_download_url = "$base/download/forge614-engram-windows-x64.exe" },
            @{ name = 'forge614-engram-windows-arm64.exe'; browser_download_url = "$base/download/forge614-engram-windows-arm64.exe" }
          )
          if (-not $missingManifest) {
            $assets = @(@{ name = 'SHA256SUMS'; browser_download_url = "$base/download/SHA256SUMS" }) + $assets
          }
          $payload = @{ assets = $assets } | ConvertTo-Json -Compress
          $assetNames = ($assets | ForEach-Object { $_.name }) -join ','
          [System.IO.File]::AppendAllText($Diagnostics, "release-asset-names=$assetNames`nrelease-json=$payload`n")
          $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
          $context.Response.ContentType = 'application/octet-stream'
        } elseif ($path.EndsWith('/download/SHA256SUMS')) {
          $sum = if ($mismatch) { '0' * 64 } else { $Digest }
          $bytes = [Text.Encoding]::UTF8.GetBytes("$sum  forge614-engram-windows-x64.exe`n$sum  forge614-engram-windows-arm64.exe`n")
        } elseif ($path.EndsWith('.exe')) {
          $bytes = [System.IO.File]::ReadAllBytes($Fixture)
        } else {
          $context.Response.StatusCode = 404
          $bytes = [Text.Encoding]::UTF8.GetBytes('not found')
        }
        $context.Response.ContentLength64 = $bytes.Length
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $context.Response.Close()
      }
    } finally { $listener.Close() }
  }
  $serverPort = $null
  $readyDeadline = [DateTime]::UtcNow.AddSeconds(10)
  while ($null -eq $serverPort -and [DateTime]::UtcNow -lt $readyDeadline) {
    foreach ($message in @(Receive-Job $serverJob)) {
      if ($message.State -eq 'Ready') { $serverPort = [int]$message.Port }
    }
    if ($serverJob.State -in @('Failed', 'Stopped')) { throw "Fixture server stopped before readiness: $($serverJob.State)" }
    if ($null -eq $serverPort) { Start-Sleep -Milliseconds 50 }
  }
  if ($null -eq $serverPort) { throw 'Fixture server did not become ready within 10 seconds.' }
  $releaseBaseUrl = "http://127.0.0.1:$serverPort"

  $previousHome = $env:HOME
  $env:HOME = $fixtureHome
  try {
    $amd64Destination = Join-Path $temporaryRoot 'amd64-bin'
    $amd64 = Invoke-Installer 'AMD64' @('-ReleaseBaseUrl', "$releaseBaseUrl/good", '-Version', 'v1.2.3', '-BinDir', $amd64Destination)
    $amd64Diagnostics = Get-FixtureDiagnostics
    Assert-That ($amd64Diagnostics.Contains('/good/repos/jotredev/forge614-engram/releases/tags/v1.2.3')) "AMD64 fixture route mismatch: $amd64Diagnostics"
    Assert-That ($amd64Diagnostics.Contains('release-asset-names=SHA256SUMS,forge614-engram-windows-x64.exe,forge614-engram-windows-arm64.exe')) "AMD64 fixture asset names mismatch: $amd64Diagnostics"
    Assert-That ($amd64.ExitCode -eq 0) "AMD64 installer failed to parse the fixture UTF-8 byte response: $($amd64.Output) Fixture diagnostics: $amd64Diagnostics"
    Assert-That ([System.IO.File]::Exists((Join-Path $amd64Destination 'forge614-engram.exe'))) 'AMD64 binary was not installed.'
    Assert-That ([Convert]::ToBase64String([System.IO.File]::ReadAllBytes((Join-Path $amd64Destination 'forge614-engram.exe'))) -eq [Convert]::ToBase64String($fixtureBytes)) 'AMD64 binary bytes changed.'

    $arm64Destination = Join-Path $temporaryRoot 'arm64-bin'
    $arm64 = Invoke-Installer 'ARM64' @('-ReleaseBaseUrl', "$releaseBaseUrl/good", '-Version', 'v1.2.3', '-BinDir', $arm64Destination)
    Assert-That ($arm64.ExitCode -eq 0) "ARM64 installer failed: $($arm64.Output)"
    Assert-That ([System.IO.File]::Exists((Join-Path $arm64Destination 'forge614-engram.exe'))) 'ARM64 binary was not installed.'

    $missingManifestDestination = Join-Path $temporaryRoot 'missing-manifest-bin'
    $missingManifestResult = Invoke-Installer 'AMD64' @('-ReleaseBaseUrl', "$releaseBaseUrl/missing-manifest", '-Version', 'v1.2.3', '-BinDir', $missingManifestDestination)
    Assert-That ($missingManifestResult.ExitCode -ne 0) 'Missing SHA256SUMS unexpectedly succeeded.'
    Assert-That ($missingManifestResult.Output.Contains('The release is missing SHA256SUMS.')) "Missing SHA256SUMS lost the normal error contract: $($missingManifestResult.Output)"
    Assert-That ($missingManifestResult.Output.Contains('Test fixture asset selection failed: expected one SHA256SUMS asset; received 0.')) "Missing SHA256SUMS omitted concise fixture diagnostics: $($missingManifestResult.Output)"
    Assert-That (-not [System.IO.File]::Exists((Join-Path $missingManifestDestination 'forge614-engram.exe'))) 'Missing SHA256SUMS created an output binary.'

    $mismatchDestination = Join-Path $temporaryRoot 'mismatch-bin'
    $mismatch = Invoke-Installer 'AMD64' @('-ReleaseBaseUrl', "$releaseBaseUrl/mismatch", '-Version', 'v1.2.3', '-BinDir', $mismatchDestination)
    Assert-That ($mismatch.ExitCode -ne 0) 'Checksum mismatch unexpectedly succeeded.'
    Assert-That (-not [System.IO.File]::Exists((Join-Path $mismatchDestination 'forge614-engram.exe'))) 'Checksum mismatch created an output binary.'

    $existingDestination = Join-Path $temporaryRoot 'existing-bin'
    New-Item -ItemType Directory -Path $existingDestination -Force | Out-Null
    $existingBinary = Join-Path $existingDestination 'forge614-engram.exe'
    [System.IO.File]::WriteAllText($existingBinary, 'existing binary')
    $withoutForce = Invoke-Installer 'AMD64' @('-ReleaseBaseUrl', "$releaseBaseUrl/good", '-Version', 'v1.2.3', '-BinDir', $existingDestination)
    Assert-That ($withoutForce.ExitCode -ne 0) 'Existing destination was replaced without -Force.'
    Assert-That ([System.IO.File]::ReadAllText($existingBinary) -eq 'existing binary') 'Existing destination changed without -Force.'

    $pathFailureDestination = Join-Path $temporaryRoot 'path-failure-bin'
    $previousPathWriteFailure = $env:FORGE614_INSTALLER_TEST_PATH_WRITE_FAILURE
    $env:FORGE614_INSTALLER_TEST_PATH_WRITE_FAILURE = '1'
    try {
      $pathFailure = Invoke-Installer 'AMD64' @('-ReleaseBaseUrl', "$releaseBaseUrl/good", '-Version', 'v1.2.3', '-BinDir', $pathFailureDestination)
    } finally {
      if ($null -eq $previousPathWriteFailure) { Remove-Item Env:FORGE614_INSTALLER_TEST_PATH_WRITE_FAILURE }
      else { $env:FORGE614_INSTALLER_TEST_PATH_WRITE_FAILURE = $previousPathWriteFailure }
    }
    Assert-That ($pathFailure.ExitCode -eq 0) "Installer failed after a user PATH write error: $($pathFailure.Output)"
    Assert-That ([System.IO.File]::Exists((Join-Path $pathFailureDestination 'forge614-engram.exe'))) 'A user PATH write error removed the installed binary.'
    Assert-That ($pathFailure.Output.Contains('could not add')) "User PATH write error omitted manual guidance: $($pathFailure.Output)"

    Assert-That (-not [System.IO.Directory]::Exists((Join-Path $fixtureHome '.forge614'))) 'Installer created .forge614.'
  } finally {
    if ($null -eq $previousHome) { Remove-Item Env:HOME }
    else { $env:HOME = $previousHome }
  }
} finally {
  if ($null -ne $serverJob) {
    try { Invoke-WebRequest -UseBasicParsing "$releaseBaseUrl/stop" | Out-Null } catch {}
    Wait-Job $serverJob -Timeout 5 | Out-Null
    Remove-Job $serverJob -Force
  }
  Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output 'PASS install.ps1 fixture tests'
