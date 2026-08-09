param(
  [Parameter(Mandatory = $true)][string]$Artifact
)

$ErrorActionPreference = 'Stop'
$artifactPath = [IO.Path]::GetFullPath($Artifact)
$artifactInfo = Get-Item -LiteralPath $artifactPath -Force
if ($artifactInfo.PSIsContainer -or ($artifactInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
  throw 'The release artifact must be a regular file.'
}
$expectedRoot = [IO.Path]::GetFileNameWithoutExtension($artifactInfo.Name)
if ($artifactInfo.Name -notmatch '^tasktwin-runner-(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?-windows-x64\.zip$') {
  throw 'The release artifact name is invalid.'
}
$forbiddenNames = @(
  '(^|/)\.env(?:\.[^/]*)?$',
  '(^|/)\.tasktwin(/|$)',
  '(^|/)local-secret-vault(?:\.[^/]*)?\.json$',
  'runner-credential\.json$',
  'runner-encryption-key\.json$',
  'runner-service(?:\.[^/]*)?\.json$',
  'private[-_.]?key',
  'signing[-_.]?key',
  '\.pem$',
  '\.key$',
  '(^|/)(src|test|tests|fixtures|browser-profile|storage-state|user-data)(/|$)',
  '\.map$'
)
$sentinels = @(
  'UPDATE_SECRET_LEAK_32',
  'UPDATE_CREDENTIAL_LEAK_32',
  'UPDATE_PROTECTED_KEY_LEAK_32',
  'LOCAL_SECRET_STORE_LEAK_31',
  'RUNNER_CREDENTIAL_LEAK_31',
  'RELEASE_PRIVATE_KEY_LEAK_31',
  'CLI_RECOGNIZABLE_SECRET_29',
  'SESSION_29_RECOGNIZABLE_PASSWORD',
  'API_RECOGNIZABLE_SECRET_29',
  'fixture-secret-30',
  'server-only-access-token',
  'password-plaintext',
  '-----BEGIN PRIVATE KEY-----'
)
$maximumSentinelLength = ($sentinels | ForEach-Object { $_.Length } | Measure-Object -Maximum).Maximum
$allowedRootFiles = @('package.json', 'runner.cmd')
$allowedRootDirectories = @('browsers', 'dist', 'node_modules', 'runtime', 'windows')
$requiredEntries = @(
  'runner.cmd',
  'package.json',
  'dist/index.js',
  'dist/release/build-identity.json',
  'dist/platform/windows/windows-native-bridge.ps1',
  'dist/platform/windows/windows-runner-installation-acl.ps1',
  'dist/update/windows-release-archive.ps1',
  'runtime/node.exe',
  'runtime/LICENSE',
  'windows/vendor/winsw-2.12.0/WinSW.NET461.exe'
)
$maximumEntryCount = 100000
$maximumEntryBytes = 2GB
$maximumTotalBytes = 4GB

function Test-ProhibitedContent([IO.Stream]$InputStream) {
  $buffer = New-Object byte[] (1024 * 1024)
  $tail = New-Object byte[] 0
  while (($read = $InputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
    $combined = New-Object byte[] ($tail.Length + $read)
    if ($tail.Length -gt 0) { [Array]::Copy($tail, 0, $combined, 0, $tail.Length) }
    [Array]::Copy($buffer, 0, $combined, $tail.Length, $read)
    $text = [Text.Encoding]::ASCII.GetString($combined)
    foreach ($sentinel in $sentinels) {
      if ($text.IndexOf($sentinel, [StringComparison]::Ordinal) -ge 0) { return $true }
    }
    $tailLength = [Math]::Min($maximumSentinelLength - 1, $combined.Length)
    $tail = New-Object byte[] $tailLength
    if ($tailLength -gt 0) {
      [Array]::Copy($combined, $combined.Length - $tailLength, $tail, 0, $tailLength)
    }
  }
  return $false
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [IO.File]::OpenRead($artifactPath)
try {
  $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Read, $false)
  try {
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $relativeEntries = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    [long]$totalBytes = 0
    $entryCount = 0
    foreach ($entry in $archive.Entries) {
      $entryCount += 1
      if ($entryCount -gt $maximumEntryCount) { throw 'The release archive contains too many entries.' }
      if ($entry.FullName.Contains('\')) { throw 'The release archive contains a non-canonical path.' }
      $name = $entry.FullName
      if ($name.StartsWith('/') -or $name.Contains('//') -or $name.Contains('../') -or $name.Contains('/./') -or -not $name.StartsWith($expectedRoot + '/', [StringComparison]::Ordinal)) {
        throw 'The release archive contains an invalid entry path.'
      }
      if (-not $seen.Add($name)) { throw 'The release archive contains duplicate or case-colliding entries.' }
      $relativeName = $name.Substring($expectedRoot.Length + 1)
      if ($relativeName.Length -eq 0) { throw 'The release archive contains an empty relative path.' }
      [void]$relativeEntries.Add($relativeName)
      $segments = $relativeName.Split('/')
      $rootEntry = $segments[0].ToLowerInvariant()
      if ($segments.Length -eq 1) {
        if ($entry.Name.Length -eq 0) {
          if ($allowedRootDirectories -notcontains $rootEntry) { throw "The release archive contains a non-allowlisted root: $name" }
        } elseif ($allowedRootFiles -notcontains $rootEntry) {
          throw "The release archive contains a non-allowlisted root file: $name"
        }
      } elseif ($allowedRootDirectories -notcontains $rootEntry) {
        throw "The release archive contains a non-allowlisted root: $name"
      }
      foreach ($pattern in $forbiddenNames) {
        if ($name -match $pattern) { throw "The release archive contains prohibited entry: $name" }
      }
      $unixType = (($entry.ExternalAttributes -shr 16) -band 0xF000)
      if ($unixType -eq 0xA000) { throw "The release archive contains a symbolic link: $name" }
      if ($entry.Name.Length -eq 0) { continue }
      if ($entry.Length -lt 0 -or $entry.Length -gt $maximumEntryBytes) { throw 'The release archive contains an oversized entry.' }
      $totalBytes += $entry.Length
      if ($totalBytes -gt $maximumTotalBytes) { throw 'The release archive uncompressed size is too large.' }
      $entryStream = $entry.Open()
      try {
        if (Test-ProhibitedContent $entryStream) { throw "The release archive contains prohibited content: $name" }
      } finally { $entryStream.Dispose() }
    }
    if ($seen.Count -eq 0) { throw 'The release archive is empty.' }
    foreach ($required in $requiredEntries) {
      if (-not $relativeEntries.Contains($required)) { throw "The release archive is missing required runtime file: $required" }
    }
    if (-not ($relativeEntries | Where-Object { $_.StartsWith('browsers/chromium-', [StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1)) {
      throw 'The release archive is missing packaged Chromium.'
    }
  } finally { $archive.Dispose() }
} finally { $stream.Dispose() }
