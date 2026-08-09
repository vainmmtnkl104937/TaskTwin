param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('extract', 'compare')]
  [string]$Operation,
  [Parameter(Mandatory = $true)][string]$Artifact,
  [Parameter(Mandatory = $true)][string]$Destination
)

$ErrorActionPreference = 'Stop'
$maximumEntryCount = 10000
[long]$maximumEntryBytes = 1GB
[long]$maximumTotalBytes = 4GB
[double]$maximumCompressionRatio = 1000
$bufferSize = 1024 * 1024
$reservedDeviceName = '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$'

function Convert-ToExtendedPath([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  if ($full.StartsWith('\\?\', [StringComparison]::Ordinal)) { return $full }
  if ($full.StartsWith('\\', [StringComparison]::Ordinal)) {
    return '\\?\UNC\' + $full.Substring(2)
  }
  return '\\?\' + $full
}

function Assert-RegularFile([string]$Path) {
  $ioPath = Convert-ToExtendedPath $Path
  if (-not [IO.File]::Exists($ioPath)) {
    throw 'The release archive must be a regular file.'
  }
  $attributes = [IO.File]::GetAttributes($ioPath)
  if (
    ($attributes -band [IO.FileAttributes]::Directory) -or
    ($attributes -band [IO.FileAttributes]::ReparsePoint)
  ) {
    throw 'The release archive must be a regular file.'
  }
}

function Assert-SafeSegment([string]$Segment) {
  if (
    $Segment.Length -eq 0 -or
    $Segment -eq '.' -or
    $Segment -eq '..' -or
    $Segment.Contains(':') -or
    $Segment.Contains([char]0) -or
    $Segment.EndsWith('.') -or
    $Segment.EndsWith(' ') -or
    $Segment -match $reservedDeviceName -or
    $Segment.Normalize([Text.NormalizationForm]::FormC) -cne $Segment
  ) {
    throw 'The release archive contains an unsafe path segment.'
  }
}

function Resolve-ContainedEntryPath(
  [string]$DestinationRoot,
  [string]$EntryName
) {
  if (
    $EntryName.StartsWith('/') -or
    $EntryName.StartsWith('\') -or
    $EntryName.Contains('\') -or
    $EntryName.Contains('//')
  ) {
    throw 'The release archive contains a non-canonical path.'
  }
  $segments = $EntryName.Split('/')
  foreach ($segment in $segments) { Assert-SafeSegment $segment }
  $candidate = $DestinationRoot
  foreach ($segment in $segments) { $candidate = [IO.Path]::Combine($candidate, $segment) }
  $resolved = [IO.Path]::GetFullPath($candidate)
  $prefix = $DestinationRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The release archive entry escapes the staging root.'
  }
  return $resolved
}

function Assert-NoReparseAncestors([string]$Root, [string]$Path) {
  $current = [IO.Path]::GetDirectoryName($Path)
  $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)
  while ($current -and $current.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
    $ioCurrent = Convert-ToExtendedPath $current
    if ([IO.Directory]::Exists($ioCurrent)) {
      $attributes = [IO.File]::GetAttributes($ioCurrent)
      if ($attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'The release staging tree contains a reparse point.'
      }
    }
    if ($current.Equals($rootFull, [StringComparison]::OrdinalIgnoreCase)) { break }
    $current = [IO.Path]::GetDirectoryName($current)
  }
}

function Assert-NoReparseExistingAncestors([string]$Path) {
  $current = [IO.Path]::GetFullPath($Path)
  while ($current) {
    $ioCurrent = Convert-ToExtendedPath $current
    if ([IO.File]::Exists($ioCurrent) -or [IO.Directory]::Exists($ioCurrent)) {
      $attributes = [IO.File]::GetAttributes($ioCurrent)
      if ($attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'The release staging path contains a reparse point.'
      }
    }
    $parent = [IO.Path]::GetDirectoryName($current)
    if (-not $parent -or $parent -eq $current) { break }
    $current = $parent
  }
}

function Compare-Streams([IO.Stream]$Expected, [IO.Stream]$Actual, [long]$MaximumBytes) {
  $expectedBuffer = New-Object byte[] $bufferSize
  $actualBuffer = New-Object byte[] $bufferSize
  [long]$total = 0
  while (($expectedRead = $Expected.Read($expectedBuffer, 0, $expectedBuffer.Length)) -gt 0) {
    $total += $expectedRead
    if ($total -gt $MaximumBytes) { throw 'An archive entry exceeded its byte limit.' }
    $actualRead = $Actual.Read($actualBuffer, 0, $expectedRead)
    if ($actualRead -ne $expectedRead) { throw 'The installed release payload size is invalid.' }
    for ($index = 0; $index -lt $expectedRead; $index += 1) {
      if ($expectedBuffer[$index] -ne $actualBuffer[$index]) {
        throw 'The installed release payload does not match the verified archive.'
      }
    }
  }
  if ($Actual.ReadByte() -ne -1) { throw 'The installed release payload size is invalid.' }
  return $total
}

$artifactPath = [IO.Path]::GetFullPath($Artifact)
$artifactIoPath = Convert-ToExtendedPath $artifactPath
Assert-RegularFile $artifactPath
$artifactName = [IO.Path]::GetFileName($artifactPath)
if ($artifactName -notmatch '^tasktwin-runner-(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?-windows-x64\.zip$') {
  throw 'The release artifact name is invalid.'
}
$expectedRoot = [IO.Path]::GetFileNameWithoutExtension($artifactName)
$destinationRoot = [IO.Path]::GetFullPath($Destination)
$destinationIoRoot = Convert-ToExtendedPath $destinationRoot
if ($destinationRoot.StartsWith('\\', [StringComparison]::Ordinal)) {
  throw 'UNC release staging destinations are not supported.'
}
if ($Operation -eq 'extract') {
  if ([IO.File]::Exists($destinationIoRoot) -or [IO.Directory]::Exists($destinationIoRoot)) {
    throw 'The immutable release staging directory already exists.'
  }
} elseif (-not [IO.Directory]::Exists($destinationIoRoot)) {
  throw 'The installed release payload is unavailable.'
}
Assert-NoReparseExistingAncestors $destinationRoot

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [IO.File]::Open($artifactIoPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try {
  $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Read, $false)
  try {
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $expectedFiles = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $validatedEntries = [Collections.Generic.List[object]]::new()
    [long]$declaredTotal = 0
    $entryCount = 0

    # Validate every central-directory entry before creating the destination or
    # writing a byte. The second pass performs only bounded extraction/compare.
    foreach ($entry in $archive.Entries) {
      $entryCount += 1
      if ($entryCount -gt $maximumEntryCount) { throw 'The release archive contains too many entries.' }
      $name = $entry.FullName
      if ($entry.Name.Length -eq 0) { throw 'Explicit archive directory entries are not supported.' }
      if (-not $name.StartsWith($expectedRoot + '/', [StringComparison]::Ordinal)) {
        throw 'The release archive root is invalid.'
      }
      if (-not $seen.Add($name)) { throw 'The release archive contains duplicate or case-colliding entries.' }
      $unixType = (($entry.ExternalAttributes -shr 16) -band 0xF000)
      if ($unixType -ne 0 -and $unixType -ne 0x8000) { throw 'The release archive contains a non-file entry.' }
      $windowsAttributes = ($entry.ExternalAttributes -band 0xFFFF)
      if ($windowsAttributes -band [int][IO.FileAttributes]::ReparsePoint) {
        throw 'The release archive contains a reparse-point entry.'
      }
      if ($entry.Length -lt 0 -or $entry.Length -gt $maximumEntryBytes) {
        throw 'The release archive contains an oversized entry.'
      }
      if ($entry.CompressedLength -lt 0) { throw 'The release archive contains invalid compressed metadata.' }
      if ($entry.Length -gt 0 -and $entry.CompressedLength -eq 0) {
        throw 'The release archive contains an invalid compression ratio.'
      }
      if ($entry.CompressedLength -gt 0 -and ($entry.Length / $entry.CompressedLength) -gt $maximumCompressionRatio) {
        throw 'The release archive contains an excessive compression ratio.'
      }
      $declaredTotal += $entry.Length
      if ($declaredTotal -gt $maximumTotalBytes) { throw 'The release archive is too large.' }
      $targetPath = Resolve-ContainedEntryPath $destinationRoot $name
      [void]$expectedFiles.Add($name)
      Assert-NoReparseAncestors $destinationRoot $targetPath
      $validatedEntries.Add([pscustomobject]@{ Entry = $entry; TargetPath = $targetPath })
    }
    if ($entryCount -eq 0) { throw 'The release archive is empty.' }

    if ($Operation -eq 'extract') {
      [void][IO.Directory]::CreateDirectory($destinationIoRoot)
      Assert-NoReparseExistingAncestors $destinationRoot
    }

    foreach ($validatedEntry in $validatedEntries) {
      $entry = $validatedEntry.Entry
      $targetPath = $validatedEntry.TargetPath
      if ($Operation -eq 'extract') {
        $parent = [IO.Path]::GetDirectoryName($targetPath)
        [void][IO.Directory]::CreateDirectory((Convert-ToExtendedPath $parent))
        Assert-NoReparseAncestors $destinationRoot $targetPath
        $inputStream = $entry.Open()
        try {
          $outputStream = [IO.File]::Open((Convert-ToExtendedPath $targetPath), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
          try {
            $buffer = New-Object byte[] $bufferSize
            [long]$written = 0
            while (($read = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
              $written += $read
              if ($written -gt $entry.Length -or $written -gt $maximumEntryBytes) {
                throw 'An archive entry exceeded its declared byte size.'
              }
              $outputStream.Write($buffer, 0, $read)
            }
            if ($written -ne $entry.Length) { throw 'An archive entry byte size is invalid.' }
            $outputStream.Flush($true)
          } finally { $outputStream.Dispose() }
        } finally { $inputStream.Dispose() }
      } else {
        $targetIoPath = Convert-ToExtendedPath $targetPath
        if (-not [IO.File]::Exists($targetIoPath)) {
          throw 'The installed release payload is incomplete.'
        }
        $targetAttributes = [IO.File]::GetAttributes($targetIoPath)
        if (
          ($targetAttributes -band [IO.FileAttributes]::Directory) -or
          ($targetAttributes -band [IO.FileAttributes]::ReparsePoint)
        ) {
          throw 'The installed release payload contains a non-regular file.'
        }
        $inputStream = $entry.Open()
        try {
          $actualStream = [IO.File]::Open($targetIoPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
          try { [void](Compare-Streams $inputStream $actualStream $maximumEntryBytes) }
          finally { $actualStream.Dispose() }
        } finally { $inputStream.Dispose() }
      }
    }
    $actualCount = 0
    $directories = [Collections.Generic.Stack[object]]::new()
    $directories.Push([pscustomobject]@{ IoPath = $destinationIoRoot; Relative = '' })
    while ($directories.Count -gt 0) {
      $directory = $directories.Pop()
      foreach ($actualPath in [IO.Directory]::EnumerateFileSystemEntries($directory.IoPath)) {
        $actualAttributes = [IO.File]::GetAttributes($actualPath)
        if ($actualAttributes -band [IO.FileAttributes]::ReparsePoint) {
          throw 'The release payload contains a reparse point.'
        }
        $leaf = [IO.Path]::GetFileName($actualPath)
        $relativeName = if ($directory.Relative.Length -eq 0) {
          $leaf
        } else {
          $directory.Relative + '/' + $leaf
        }
        if ($actualAttributes -band [IO.FileAttributes]::Directory) {
          $directories.Push([pscustomobject]@{ IoPath = $actualPath; Relative = $relativeName })
          continue
        }
        $actualCount += 1
        if (-not $expectedFiles.Contains($relativeName)) {
          throw 'The release payload contains an unexpected file.'
        }
      }
    }
    if ($actualCount -ne $expectedFiles.Count) { throw 'The release payload file set is incomplete.' }
    [pscustomobject]@{
      ok = $true
      fileCount = $expectedFiles.Count
      totalBytes = $declaredTotal
      rootDirectoryName = $expectedRoot
    } | ConvertTo-Json -Compress
  } finally { $archive.Dispose() }
} finally { $stream.Dispose() }
