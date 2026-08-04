param(
  [string]$ReleaseDirectory = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$expectedReleaseRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'release'))
$resolvedReleaseRoot = if ($ReleaseDirectory) {
  [System.IO.Path]::GetFullPath($ReleaseDirectory)
} else {
  $expectedReleaseRoot
}

if (-not $resolvedReleaseRoot.Equals($expectedReleaseRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "ReleaseDirectory must resolve to the project's release directory: $expectedReleaseRoot"
}
if (-not (Test-Path -LiteralPath $resolvedReleaseRoot -PathType Container)) {
  throw "Release directory was not found: $resolvedReleaseRoot"
}

$assets = Get-ChildItem -LiteralPath $resolvedReleaseRoot -File |
  Where-Object { $_.Name -like 'Hexestra Setup *.exe' } |
  Sort-Object Name
if (-not $assets) { throw 'No Hexestra installer was found in the release directory.' }

$lines = foreach ($asset in $assets) {
  $hash = (Get-FileHash -LiteralPath $asset.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $($asset.Name)"
}

$outputPath = Join-Path $resolvedReleaseRoot 'SHA256SUMS.txt'
$lines | Set-Content -LiteralPath $outputPath -Encoding ascii
Write-Host "Wrote $outputPath"
$lines | ForEach-Object { Write-Host $_ }
