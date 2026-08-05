[CmdletBinding()]
param(
  [string]$Version
)

$ErrorActionPreference = 'Stop'

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDirectory '..'))
$packagePath = Join-Path $projectRoot 'package.json'

if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = (Get-Content -Raw -LiteralPath $packagePath | ConvertFrom-Json).version
}

if ($Version -notmatch '^[0-9A-Za-z][0-9A-Za-z._-]*$') {
  throw "Version contains unsupported characters: $Version"
}

function Assert-ChildPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Candidate,

    [Parameter(Mandatory = $true)]
    [string]$Root
  )

  $rootPath = [System.IO.Path]::GetFullPath($Root)
  $candidatePath = [System.IO.Path]::GetFullPath($Candidate)
  $rootPrefix = $rootPath.TrimEnd([char[]]'\/') + [System.IO.Path]::DirectorySeparatorChar

  if (-not $candidatePath.StartsWith(
      $rootPrefix,
      [System.StringComparison]::OrdinalIgnoreCase
    )) {
    throw "Refusing to use a path outside the expected root: $candidatePath"
  }

  return $candidatePath
}

$artifactRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'artifacts/open-source'))
$sourceDirectory = Assert-ChildPath `
  -Candidate (Join-Path $artifactRoot "Hexestra-$Version-source") `
  -Root $artifactRoot
$zipPath = Assert-ChildPath `
  -Candidate (Join-Path $artifactRoot "Hexestra-$Version-source.zip") `
  -Root $artifactRoot

New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null

if (Test-Path -LiteralPath $sourceDirectory) {
  Remove-Item -LiteralPath $sourceDirectory -Recurse -Force
}

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

$auditScript = Join-Path $scriptDirectory 'audit-public-boundary.mjs'
$publicPaths = @(& node $auditScript --list)
if ($LASTEXITCODE -ne 0) {
  throw 'Public source audit failed; no export was created.'
}

if ($publicPaths.Count -eq 0) {
  throw 'Public source audit returned an empty file list.'
}

New-Item -ItemType Directory -Force -Path $sourceDirectory | Out-Null

foreach ($publicPath in $publicPaths) {
  $platformPath = $publicPath.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
  $sourcePath = Assert-ChildPath -Candidate (Join-Path $projectRoot $platformPath) -Root $projectRoot
  $destinationPath = Assert-ChildPath `
    -Candidate (Join-Path $sourceDirectory $platformPath) `
    -Root $sourceDirectory

  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Audited source file no longer exists: $publicPath"
  }

  $destinationDirectory = Split-Path -Parent $destinationPath
  New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath
}

& node (Join-Path $sourceDirectory 'scripts/audit-public-boundary.mjs')
if ($LASTEXITCODE -ne 0) {
  throw 'Exported source failed its own public-boundary audit.'
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $sourceDirectory,
  $zipPath,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $false
)

$zipHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()

Write-Host "Exported $($publicPaths.Count) reviewed source files."
Write-Host "Source directory: $sourceDirectory"
Write-Host "Source ZIP:       $zipPath"
Write-Host "ZIP SHA-256:      $zipHash"
