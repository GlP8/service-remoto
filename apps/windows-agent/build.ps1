$ErrorActionPreference = 'Stop'
$compilerCandidates = @(
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) {
  throw 'The .NET Framework 4.8 C# compiler was not found. Install the .NET Framework 4.8 Developer Pack.'
}

$outputDirectory = Join-Path $PSScriptRoot 'dist'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$output = Join-Path $outputDirectory 'ServiceRemotoAgent.exe'
$references = @(
  '/reference:System.dll',
  '/reference:System.Core.dll',
  '/reference:System.Drawing.dll',
  '/reference:System.Net.Http.dll',
  '/reference:System.Net.WebSockets.Client.dll',
  '/reference:System.Security.dll',
  '/reference:System.Web.Extensions.dll',
  '/reference:System.Windows.Forms.dll'
)

& $compiler /nologo /target:winexe "/out:$output" $references (Join-Path $PSScriptRoot 'Program.cs')
if ($LASTEXITCODE -ne 0) {
  throw "Agent build failed with compiler exit code $LASTEXITCODE."
}
Write-Output "Built $output"
