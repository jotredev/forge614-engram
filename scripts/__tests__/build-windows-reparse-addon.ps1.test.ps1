$ErrorActionPreference = 'Stop'

$builder = Join-Path $PSScriptRoot '..\build-windows-reparse-addon.ps1'
$tokens = $null
$parseErrors = $null
$scriptAst = [System.Management.Automation.Language.Parser]::ParseFile($builder, [ref] $tokens, [ref] $parseErrors)
if ($parseErrors.Count -ne 0) {
  throw "Could not parse the Windows addon build script: $($parseErrors[0].Message)"
}

$resolver = $scriptAst.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Resolve-NodeExecutable'
}, $true)
if ($null -eq $resolver) {
  throw 'The build script must expose Resolve-NodeExecutable so node command discovery is testable.'
}

. ([scriptblock]::Create($resolver.Extent.Text))

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  Write-Output 'SKIP build-windows-reparse-addon.ps1 candidate tests require Windows command discovery'
  exit 0
}

$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("forge614-node-candidates-" + [Guid]::NewGuid().ToString('N'))
$previousPath = $env:PATH
try {
  $firstDirectory = Join-Path $temporaryRoot 'first'
  $secondDirectory = Join-Path $temporaryRoot 'second'
  New-Item -ItemType Directory -Path $firstDirectory, $secondDirectory -Force | Out-Null
  $firstNode = Join-Path $firstDirectory 'node.cmd'
  $secondNode = Join-Path $secondDirectory 'node.cmd'
  Set-Content -LiteralPath $firstNode -Value '@exit /b 0' -NoNewline
  Set-Content -LiteralPath $secondNode -Value '@exit /b 0' -NoNewline

  $env:PATH = "$firstDirectory;$secondDirectory;$previousPath"
  $candidates = @(Get-Command node -CommandType Application -ErrorAction Stop)
  if ($candidates.Count -lt 2) {
    throw 'The fixture did not produce multiple node command candidates.'
  }

  $resolved = Resolve-NodeExecutable
  if ($resolved -ne $firstNode) {
    throw "Expected the first valid node candidate '$firstNode', received '$resolved'."
  }
} finally {
  $env:PATH = $previousPath
  Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output 'PASS build-windows-reparse-addon.ps1 node candidate tests'
