param(
  [Parameter(Mandatory = $true)][string]$StagingDirectory,
  [Parameter(Mandatory = $true)][string]$OutputFile
)

$ErrorActionPreference = 'Stop'
$stage = [IO.Path]::GetFullPath($StagingDirectory)
$output = [IO.Path]::GetFullPath($OutputFile)
$stageInfo = Get-Item -LiteralPath $stage -Force
if (-not $stageInfo.PSIsContainer -or ($stageInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
  throw 'Release staging must be a regular directory.'
}
if ((Split-Path -Leaf $stage) + '.zip' -ne (Split-Path -Leaf $output)) {
  throw 'The deterministic release artifact name does not match staging.'
}
if (Test-Path -LiteralPath $output) {
  throw 'The immutable release artifact already exists.'
}
$outputDirectory = Split-Path -Parent $output
if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
  throw 'The release output directory does not exist.'
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [IO.File]::Open($output, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
try {
  $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
  try {
    $parent = Split-Path -Parent $stage
    $files = Get-ChildItem -LiteralPath $stage -Recurse -File -Force | Sort-Object {
      $_.FullName.Substring($parent.Length + 1).Replace('\', '/')
    }
    foreach ($file in $files) {
      if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Release staging contains a reparse point.'
      }
      if (-not $file.FullName.StartsWith($parent + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Release staging escaped its validated parent.'
      }
      $entryName = $file.FullName.Substring($parent.Length + 1).Replace('\', '/')
      $entry = $archive.CreateEntry($entryName, [IO.Compression.CompressionLevel]::Optimal)
      $entry.LastWriteTime = [DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
      $input = [IO.File]::OpenRead($file.FullName)
      try {
        $destination = $entry.Open()
        try { $input.CopyTo($destination) } finally { $destination.Dispose() }
      } finally { $input.Dispose() }
    }
  } finally { $archive.Dispose() }
} catch {
  $stream.Dispose()
  Remove-Item -LiteralPath $output -Force -ErrorAction SilentlyContinue
  throw
} finally {
  $stream.Dispose()
}
