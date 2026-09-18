param(
  [ValidateSet('x64', 'arm64')]
  [string] $Architecture = 'x64'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Resolve-NodeExecutable {
  $candidates = @(
    Get-Command node -CommandType Application -ErrorAction Stop |
      Where-Object {
        $_ -is [System.Management.Automation.ApplicationInfo] -and
          -not [string]::IsNullOrWhiteSpace($_.Source) -and
          (Test-Path -LiteralPath $_.Source -PathType Leaf)
      }
  )
  if ($candidates.Count -eq 0) {
    throw 'Could not find a valid Node.js executable in PATH.'
  }
  return [string] $candidates[0].Source
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'The Windows reparse addon must be built on Windows with Visual Studio 2022 C++ build tools.'
}

# Node.js, Python, node-gyp, and MSVC are build-time tools only. The application
# loads this Node-API addon with Bun, including from the standalone executable.
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$addonDirectory = Join-Path $repositoryRoot 'native/windows-reparse-guard'
$nodeGyp = Join-Path $repositoryRoot 'node_modules/node-gyp/bin/node-gyp.js'
$node = Resolve-NodeExecutable
if (-not (Test-Path -LiteralPath $nodeGyp -PathType Leaf)) {
  throw 'Install the locked build dependencies first: bun install --frozen-lockfile --ignore-scripts'
}

# Rebuild removes stale output, downloads the pinned Node-API headers/import
# library, and uses MSBuild from the runner's preinstalled Visual Studio 2022.
& $node $nodeGyp rebuild "--directory=$addonDirectory" "--arch=$Architecture" --target=22.14.0 --msvs_version=2022 --release
if ($LASTEXITCODE -ne 0) {
  throw "Windows reparse addon build failed with exit code $LASTEXITCODE."
}

$addon = Get-Item -LiteralPath (Join-Path $addonDirectory 'build/Release/windows_reparse_guard.node')
if ($addon.Length -le 0) {
  throw 'Windows reparse addon build produced an empty file.'
}
Write-Host "Built Windows $Architecture reparse addon: $($addon.FullName) ($($addon.Length) bytes)"
