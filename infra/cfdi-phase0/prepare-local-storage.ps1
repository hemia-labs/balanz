[CmdletBinding()]
param(
  [string]$Root = '.local/fiscal-object-storage'
)

$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$candidate = if ([IO.Path]::IsPathRooted($Root)) {
  $Root
} else {
  Join-Path $workspace $Root
}
$target = [IO.Path]::GetFullPath($candidate)
$workspacePrefix = $workspace.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
$markerName = '.balanz-fiscal-object-storage-root-v1'
$markerPath = Join-Path $target $markerName

if (-not $target.StartsWith($workspacePrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'The local-storage root must be a dedicated directory inside this workspace.'
}

$segments = $target.Split([char[]]'\/', [StringSplitOptions]::RemoveEmptyEntries)
if ($segments -contains 'public') {
  throw 'The local-storage root must not be under a public directory.'
}

if (Test-Path -LiteralPath $target) {
  $item = Get-Item -LiteralPath $target -Force
  if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'The local-storage root must be a real directory, not a file or reparse point.'
  }
  $unexpectedEntry = Get-ChildItem -LiteralPath $target -Force |
    Where-Object Name -ne $markerName |
    Select-Object -First 1
  if ($unexpectedEntry) {
    throw 'Refusing to replace ACLs on a non-empty local-storage root.'
  }
} else {
  New-Item -ItemType Directory -Path $target | Out-Null
}

$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$allow = [Security.AccessControl.AccessControlType]::Allow
$rights = [Security.AccessControl.FileSystemRights]::FullControl
$currentGrant = "*$($currentSid.Value):(OI)(CI)(F)"
$systemGrant = "*$($systemSid.Value):(OI)(CI)(F)"
$icaclsOutput = & icacls.exe $target /inheritance:r /grant:r $currentGrant $systemGrant 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Failed to apply the private NTFS DACL: $($icaclsOutput -join ' ')"
}

if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
  [IO.File]::WriteAllText(
    $markerPath,
    "balanz-fiscal-object-storage-v1`n",
    [Text.UTF8Encoding]::new($false)
  )
}

$verified = Get-Acl -LiteralPath $target
$verifiedOwnerSid = ([Security.Principal.NTAccount]$verified.Owner).Translate(
  [Security.Principal.SecurityIdentifier]
)
$rules = @($verified.GetAccessRules(
  $true,
  $false,
  [Security.Principal.SecurityIdentifier]
))
$allowedSids = @($currentSid.Value, $systemSid.Value)
$unsafeRule = $rules | Where-Object {
  $_.IsInherited -or
  $_.AccessControlType -ne $allow -or
  $_.IdentityReference.Value -notin $allowedSids -or
  ($_.FileSystemRights -band $rights) -ne $rights
}
if (
  $verifiedOwnerSid.Value -ne $currentSid.Value -or
  $rules.Count -ne 2 -or
  $unsafeRule
) {
  throw 'The resulting NTFS DACL did not match the private-root policy.'
}

$markerItem = Get-Item -LiteralPath $markerPath -Force
if ($markerItem.PSIsContainer -or ($markerItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
  throw 'The private-root marker must be a regular file.'
}
$markerRules = @((Get-Acl -LiteralPath $markerPath).GetAccessRules(
  $false,
  $true,
  [Security.Principal.SecurityIdentifier]
))
$unsafeMarkerRule = $markerRules | Where-Object {
  $_.AccessControlType -ne $allow -or
  $_.IdentityReference.Value -notin $allowedSids -or
  ($_.FileSystemRights -band $rights) -ne $rights
}
if ($markerRules.Count -ne 2 -or $unsafeMarkerRule) {
  throw 'The private-root marker did not inherit the expected private DACL.'
}

[ordered]@{
  root = $target
  ownerSid = $verified.Owner
  inheritedRules = @($rules | Where-Object IsInherited).Count
  explicitAllowRules = $rules.Count
  marker = $markerName
  status = 'private-root-ready'
} | ConvertTo-Json
