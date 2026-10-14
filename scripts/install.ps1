<#
.SYNOPSIS
Instala una versión verificada de Forge614 Engram en Windows.
.DESCRIPTION
Verifica la huella antes de instalar dependencias y publica la carpeta exacta de binarios en User Path.
.PARAMETER Version
Etiqueta semántica de la release; si se omite usa la última.
.PARAMETER BinDir
Carpeta de destino alternativa para el ejecutable.
.PARAMETER Force
Reemplaza explícitamente un ejecutable existente.
.PARAMETER Help
Muestra el uso sin modificar el equipo.
.EXAMPLE
.\install.ps1 -Version v1.9.0
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Version,
    [string]$BinDir,
    [switch]$Force,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

function Show-Usage {
    Write-Host "Install a verified Forge614 Engram release binary."
    Write-Host "Usage: .\install.ps1 [-Version TAG] [-BinDir PATH] [-Force] [-Help]"
}

function Fail([string]$Message) { throw $Message }

function Test-LoopbackFixtureUri([string]$Value) {
    # Exige loopback con puerto escrito para que un fixture no pueda redirigirse fuera de la prueba.
    if ($Value -notmatch '^http://(127\.0\.0\.1|localhost):([0-9]{1,5})(/|$)') { return $false }
    $uri = $null
    if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$uri)) { return $false }
    return $uri.Scheme -eq "http" -and [int]$Matches[2] -gt 0 -and [int]$Matches[2] -le 65535 -and ($uri.Host -eq "127.0.0.1" -or $uri.Host -eq "localhost")
}

function Assert-ReleaseUri([string]$Value) {
    # Acepta HTTPS de release o únicamente fixtures loopback bajo el centinela de prueba.
    $uri = [Uri]$Value
    if ($uri.Scheme -eq "https") { return }
    if ($env:FORGE614_ENGRAM_INSTALLER_TEST -eq "1" -and (Test-LoopbackFixtureUri $Value)) { return }
    Fail "Release assets must use HTTPS URLs."
}

function Get-TestOverride([string]$Name, [switch]$Loopback, [switch]$File) {
    # Limita las sustituciones de red a fixtures explícitos y seguros.
    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrEmpty($value)) { return $null }
    if ($env:FORGE614_ENGRAM_INSTALLER_TEST -ne "1") { Fail "$Name is reserved for test fixtures." }
    if ($Loopback -and -not (Test-LoopbackFixtureUri $value)) { Fail "$Name must be an HTTP loopback URL with an explicit port." }
    if ($File -and -not $value.StartsWith("file:///", [StringComparison]::OrdinalIgnoreCase)) { Fail "$Name must be a local file URL." }
    return $value
}

function Invoke-Download([string]$Uri, [string]$OutFile) {
    # Revalida la URL inmediatamente antes de cada descarga.
    Assert-ReleaseUri $Uri
    Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $OutFile
}

function Notify-EnvironmentChanged {
    # Avisa a Windows que User Path cambió sin fallar por un aviso no disponible.
    try {
        if (-not ("Forge614Installer.UserEnvironmentNotifier" -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace Forge614Installer {
  public static class UserEnvironmentNotifier {
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, string lParam, uint flags, uint timeout, out IntPtr result);
  }
}
'@ -ErrorAction SilentlyContinue
        }
        $result = [IntPtr]::Zero
        [Forge614Installer.UserEnvironmentNotifier]::SendMessageTimeout([IntPtr]0xffff, 0x001a, [IntPtr]::Zero, "Environment", 2, 5000, [ref]$result) | Out-Null
    } catch { }
}

function Publish-UserPath([string]$Directory) {
    # Agrega exactamente una entrada de binarios para que uninstall retire esa misma entrada.
    $current = [Environment]::GetEnvironmentVariable("Path", "User")
    $normalized = $Directory.TrimEnd('\', '/')
    foreach ($entry in @($current -split ';')) {
        if (-not [string]::IsNullOrWhiteSpace($entry) -and $entry.TrimEnd('\', '/') -ieq $normalized) { return }
    }
    $newPath = if ([string]::IsNullOrWhiteSpace($current)) { $Directory } else { "$current;$Directory" }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Notify-EnvironmentChanged
}

function Assert-PlainDirectory([string]$Directory) {
    # Rechaza enlaces y puntos de reanálisis antes de crear o escribir dentro del destino.
    if (-not (Test-Path -LiteralPath $Directory)) { return }
    $item = Get-Item -LiteralPath $Directory -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { Fail "Refusing a linked or non-directory destination: $Directory" }
}

function Install-Dependency([string]$Name, [string]$CommandPath, [string]$OfficialUrl, [string]$OverrideName, [string]$Temporary) {
    # Instala dependencias antes de tocar Engram para evitar instalaciones parciales.
    if (Test-Path -LiteralPath $CommandPath -PathType Leaf) { return }
    $override = Get-TestOverride $OverrideName -File
    $url = if ($null -ne $override) { $override } else { $OfficialUrl }
    $installer = Join-Path $Temporary "$Name-install.ps1"
    if ($null -ne $override) {
        Copy-Item -LiteralPath ([Uri]$url).LocalPath -Destination $installer
    } else {
        Invoke-Download $url $installer
    }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -Latest
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $CommandPath -PathType Leaf)) { Fail "Forge614 $Name could not be installed; Engram was not changed." }
}

if ($Help) { Show-Usage; exit 0 }
if ($PSBoundParameters.ContainsKey("Version") -and $Version -notmatch '^v?[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z][0-9A-Za-z.-]*)?$') { Fail "Invalid release tag. Use a semantic version tag such as v1.2.3." }

$configuredHome = [Environment]::GetEnvironmentVariable("FORGE614_HOME")
if ($null -ne $configuredHome) {
    if ([string]::IsNullOrWhiteSpace($configuredHome) -or -not [IO.Path]::IsPathRooted($configuredHome)) { Fail "INVALID_FORGE614_HOME: FORGE614_HOME must be a non-empty absolute path." }
    $forgeHome = $configuredHome
} else {
    $forgeHome = Join-Path $env:USERPROFILE ".forge614"
}
$defaultBin = Join-Path (Join-Path $forgeHome "engram") "bin"
$bin = if ($PSBoundParameters.ContainsKey("BinDir")) { [IO.Path]::GetFullPath($BinDir) } else { $defaultBin }
$destination = Join-Path $bin "forge614-engram.exe"
if (Test-Path -LiteralPath $destination -PathType Container) { Fail "The destination is a directory; choose a different -BinDir." }
if (Test-Path -LiteralPath $destination) {
    $item = Get-Item -LiteralPath $destination -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { Fail "The destination must not be a link or reparse point." }
    if (-not $Force) { Fail "The command already exists. Use -Force to replace it explicitly." }
}
if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64") { Fail "Unsupported CPU architecture. Forge614 Engram for Windows supports x64 only." }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Forge614 Engram installs Forge614 Shell, which needs Node.js 22.19 or newer. Nothing was installed. Install Node.js from https://nodejs.org (or run: winget install OpenJS.NodeJS.LTS) and run this installer again." }
$nodeVersion = & node --version 2>$null
$nodeMatch = [regex]::Match($nodeVersion, '^v(\d+)\.(\d+)\.\d+$')
if ($LASTEXITCODE -ne 0 -or -not $nodeMatch.Success -or [int]$nodeMatch.Groups[1].Value -lt 22 -or ([int]$nodeMatch.Groups[1].Value -eq 22 -and [int]$nodeMatch.Groups[2].Value -lt 19)) { Fail "Forge614 Engram installs Forge614 Shell, which needs Node.js 22.19 or newer; found $nodeVersion. Nothing was installed. Update Node.js from https://nodejs.org (or run: winget install OpenJS.NodeJS.LTS) and run this installer again." }
if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) { Fail "Forge614 Engram installs Forge614 Shell, which needs tar. Nothing was installed. Install tar.exe and run this installer again." }

$testBase = Get-TestOverride "FORGE614_ENGRAM_TEST_RELEASE_BASE_URL" -Loopback
$selector = if ($PSBoundParameters.ContainsKey("Version")) { "tags/$Version" } else { "latest" }
$releaseUri = if ($null -ne $testBase) { "$testBase/repos/jotredev/forge614-engram/releases/$selector" } else { "https://api.github.com/repos/jotredev/forge614-engram/releases/$selector" }
$temporary = Join-Path ([IO.Path]::GetTempPath()) ("forge614-engram-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
    $releasePath = Join-Path $temporary "release.json"
    Invoke-Download $releaseUri $releasePath
    $bytes = [IO.File]::ReadAllBytes($releasePath)
    $release = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
    $assetName = "forge614-engram-windows-x64.exe"
    $binaryAssets = @($release.assets | Where-Object { $_.name -ceq $assetName })
    $checksumAssets = @($release.assets | Where-Object { $_.name -ceq "SHA256SUMS" })
    if ($binaryAssets.Count -ne 1 -or $checksumAssets.Count -ne 1) { Fail "Release is missing a unique Windows x64 asset or SHA256SUMS." }
    $binaryUrl = [string]$binaryAssets[0].browser_download_url
    $checksumUrl = [string]$checksumAssets[0].browser_download_url
    Assert-ReleaseUri $binaryUrl; Assert-ReleaseUri $checksumUrl
    $download = Join-Path $temporary $assetName; $sums = Join-Path $temporary "SHA256SUMS"
    Invoke-Download $binaryUrl $download; Invoke-Download $checksumUrl $sums
    $lines = @((Get-Content -LiteralPath $sums -Raw) -split "`r?`n" | Where-Object { $_ -ne "" })
    $checksumLines = @($lines | Where-Object { $_ -match '^([a-fA-F0-9]{64})  forge614-engram-windows-x64\.exe$' })
    if ($checksumLines.Count -ne 1) { Fail "Release checksum is invalid." }
    $expected = ([regex]::Match($checksumLines[0], '^([a-fA-F0-9]{64})')).Groups[1].Value.ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expected -cne $actual) { Fail "Release checksum verification failed." }

    Install-Dependency "Shell" (Join-Path (Join-Path (Join-Path $forgeHome "shell") "bin") "forge614-shell.cmd") "https://github.com/jotredev/forge614-shell/releases/latest/download/install.ps1" "FORGE614_SHELL_INSTALLER_TEST_URL" $temporary
    Install-Dependency "Engines" (Join-Path (Join-Path (Join-Path $forgeHome "engines") "bin") "forge614-engines.exe") "https://github.com/jotredev/forge614-engines/releases/latest/download/install.ps1" "FORGE614_ENGINES_INSTALLER_TEST_URL" $temporary
    Assert-PlainDirectory $forgeHome
    Assert-PlainDirectory (Join-Path $forgeHome "engram")
    Assert-PlainDirectory $bin
    New-Item -ItemType Directory -Force -Path $bin | Out-Null
    $temporaryDestination = Join-Path $bin (".forge614-engram-" + [Guid]::NewGuid() + ".tmp")
    try {
        Copy-Item -LiteralPath $download -Destination $temporaryDestination
        if (Test-Path -LiteralPath $destination) {
            try {
                # Replace es atómico; un exe en uso falla y conserva la instalación activa.
                [IO.File]::Replace($temporaryDestination, $destination, $null)
            } catch {
                Fail "Could not replace an in-use Forge614 Engram executable. Use forge614-engram update or close open sessions."
            }
        } else {
            [IO.File]::Move($temporaryDestination, $destination)
        }
    } finally {
        Remove-Item -LiteralPath $temporaryDestination -Force -ErrorAction SilentlyContinue
    }
    Publish-UserPath $bin
    Write-Host "Installed: $destination"
    Write-Host "Next step: open a new terminal and run & `"$(Join-Path (Join-Path (Join-Path $forgeHome 'shell') 'bin') 'forge614-shell.cmd')`" init --product engram"
} finally {
    Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
}
