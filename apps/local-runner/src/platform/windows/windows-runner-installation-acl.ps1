param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('protect', 'validate')]
  [string]$Operation,

  [Parameter(Mandatory = $true)]
  [string]$Root,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^S-1-5-80-(?:[0-9]+-){4}[0-9]+$')]
  [string]$ServiceSid
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

$systemSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$administratorsSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
$runnerServiceSid = [System.Security.Principal.SecurityIdentifier]::new($ServiceSid)
$resolvedRoot = [System.IO.Path]::GetFullPath($Root)
$runtimeRoot = [System.IO.Path]::Combine($resolvedRoot, 'runtime')
$locksRoot = [System.IO.Path]::Combine($resolvedRoot, 'locks')
$activeReleasePath = [System.IO.Path]::Combine($resolvedRoot, 'active-release.v1.json')
$updateJournalPath = [System.IO.Path]::Combine($resolvedRoot, 'update-journal.v1.json')
$directoryFlags = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
$noFlags = [System.Security.AccessControl.InheritanceFlags]::None
$noPropagation = [System.Security.AccessControl.PropagationFlags]::None
$allow = [System.Security.AccessControl.AccessControlType]::Allow
$maximumEntries = 20000

function Get-ControlledItems {
  $rootItem = Get-Item -LiteralPath $resolvedRoot -Force
  if (-not $rootItem.PSIsContainer -or (($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
    throw 'The Runner installation root is not a controlled directory.'
  }
  $items = [System.Collections.Generic.List[System.IO.FileSystemInfo]]::new()
  $pending = [System.Collections.Generic.Stack[System.IO.DirectoryInfo]]::new()
  $items.Add($rootItem)
  $pending.Push($rootItem)
  while ($pending.Count -gt 0) {
    $directory = $pending.Pop()
    foreach ($entry in $directory.EnumerateFileSystemInfos()) {
      if (($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'The Runner installation tree contains a reparse point.'
      }
      $items.Add($entry)
      if ($items.Count -gt $maximumEntries) {
        throw 'The Runner installation tree exceeds the ACL validation limit.'
      }
      if ($entry -is [System.IO.DirectoryInfo]) {
        $pending.Push($entry)
      }
    }
  }
  return $items
}

function Test-IsRuntimePath([string]$Path) {
  return $Path.Equals($runtimeRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
    $Path.StartsWith($runtimeRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-IsRuntimeDescendant([string]$Path) {
  return $Path.StartsWith($runtimeRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-IsMutableEntry([string]$Path) {
  return (Test-IsRuntimeDescendant $Path) -or
    $Path.StartsWith($locksRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase) -or
    $Path.Equals($activeReleasePath, [System.StringComparison]::OrdinalIgnoreCase) -or
    $Path.Equals($updateJournalPath, [System.StringComparison]::OrdinalIgnoreCase)
}

function New-ExpectedSecurity([System.IO.FileSystemInfo]$Item) {
  $isDirectory = $Item -is [System.IO.DirectoryInfo]
  $security = if ($isDirectory) {
    [System.Security.AccessControl.DirectorySecurity]::new()
  } else {
    [System.Security.AccessControl.FileSecurity]::new()
  }
  if (Test-IsMutableEntry $Item.FullName) {
    # Startup-status atomic replacements and WinSW logs are created by the
    # service after installation. They inherit the exact runtime-root DACL.
    $security.SetAccessRuleProtection($false, $false)
    $security.SetOwner($systemSid)
    return $security
  }
  $security.SetAccessRuleProtection($true, $false)
  $security.SetOwner($systemSid)
  $flags = if ($isDirectory) { $directoryFlags } else { $noFlags }
  $serviceRights = if (Test-IsRuntimePath $Item.FullName) {
    [System.Security.AccessControl.FileSystemRights]::Modify
  } else {
    [System.Security.AccessControl.FileSystemRights]::ReadAndExecute
  }
  foreach ($rule in @(
    [System.Security.AccessControl.FileSystemAccessRule]::new($systemSid, [System.Security.AccessControl.FileSystemRights]::FullControl, $flags, $noPropagation, $allow),
    [System.Security.AccessControl.FileSystemAccessRule]::new($administratorsSid, [System.Security.AccessControl.FileSystemRights]::FullControl, $flags, $noPropagation, $allow),
    [System.Security.AccessControl.FileSystemAccessRule]::new($runnerServiceSid, $serviceRights, $flags, $noPropagation, $allow)
  )) {
    [void]$security.AddAccessRule($rule)
  }
  return $security
}

function Get-RuleSignature([System.Security.AccessControl.FileSystemSecurity]$Security) {
  $rules = $Security.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier])
  return @($rules | ForEach-Object {
    '{0}|{1}|{2}|{3}|{4}' -f $_.IdentityReference.Value, [int]$_.FileSystemRights, [int]$_.InheritanceFlags, [int]$_.PropagationFlags, [int]$_.AccessControlType
  } | Sort-Object)
}

function Assert-ExpectedSecurity([System.IO.FileSystemInfo]$Item) {
  $actual = $Item.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Owner -bor [System.Security.AccessControl.AccessControlSections]::Access)
  if (Test-IsMutableEntry $Item.FullName) {
    $actualOwner = $actual.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    if ($actual.AreAccessRulesProtected -or [string]::IsNullOrWhiteSpace($actualOwner)) {
      throw 'The Runner mutable ACL owner or inheritance boundary is invalid.'
    }
    $explicitRules = @($actual.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]))
    if ($explicitRules.Count -ne 0) {
      throw 'The Runner runtime ACL contains an unexpected explicit rule.'
    }
    $effectiveRules = @($actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
    $allowedSids = @($systemSid.Value, $administratorsSid.Value, $runnerServiceSid.Value)
    foreach ($rule in $effectiveRules) {
      if ($rule.AccessControlType -ne $allow -or $allowedSids -notcontains $rule.IdentityReference.Value) {
        throw 'The Runner runtime ACL contains an unexpected effective principal.'
      }
    }
    foreach ($requiredSid in $allowedSids) {
      $principalRules = @($effectiveRules | Where-Object { $_.IdentityReference.Value -eq $requiredSid })
      if ($principalRules.Count -eq 0) {
        throw 'The Runner runtime ACL is missing a required principal.'
      }
      $combinedRights = 0
      foreach ($rule in $principalRules) {
        $combinedRights = $combinedRights -bor [int]$rule.FileSystemRights
      }
      $requiredRights = if ($requiredSid -eq $runnerServiceSid.Value -and (Test-IsRuntimeDescendant $Item.FullName)) {
        [int][System.Security.AccessControl.FileSystemRights]::Modify
      } elseif ($requiredSid -eq $runnerServiceSid.Value) {
        [int][System.Security.AccessControl.FileSystemRights]::ReadAndExecute
      } else {
        [int][System.Security.AccessControl.FileSystemRights]::FullControl
      }
      if (($combinedRights -band $requiredRights) -ne $requiredRights) {
        throw 'The Runner runtime ACL grants insufficient effective access.'
      }
    }
    return
  }
  $expected = New-ExpectedSecurity $Item
  $actualOwner = $actual.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  if ($actualOwner -ne $systemSid.Value -or -not $actual.AreAccessRulesProtected) {
    throw 'The Runner installation ACL owner or inheritance boundary is invalid.'
  }
  $actualRules = @(Get-RuleSignature $actual)
  $expectedRules = @(Get-RuleSignature $expected)
  if ($actualRules.Count -ne $expectedRules.Count) {
    throw 'The Runner installation ACL contains an unexpected principal.'
  }
  for ($index = 0; $index -lt $actualRules.Count; $index += 1) {
    if ($actualRules[$index] -ne $expectedRules[$index]) {
      throw 'The Runner installation ACL does not match the required access boundary.'
    }
  }
}

$controlledItems = @(Get-ControlledItems)
if ($Operation -eq 'protect') {
  foreach ($item in $controlledItems) {
    $item.SetAccessControl((New-ExpectedSecurity $item))
  }
}
foreach ($item in $controlledItems) {
  Assert-ExpectedSecurity $item
}

[Console]::Out.Write('TASKTWIN_RUNNER_INSTALLATION_ACL_OK')
