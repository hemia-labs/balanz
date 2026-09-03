[CmdletBinding()]
param(
  [ValidatePattern('^[a-z0-9][a-z0-9_-]{2,62}$')]
  [string]$ProjectName = "balanz-cfdi-p0-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))-$PID",

  [ValidateRange(0, 65535)] [int]$PostgresPort = 0,
  [ValidateRange(0, 65535)] [int]$RedisPort = 0,
  [ValidateRange(0, 65535)] [int]$MinioApiPort = 0,
  [ValidateRange(0, 65535)] [int]$MinioConsolePort = 0,
  [ValidateRange(0, 65535)] [int]$ClamAvPort = 0,
  [ValidateRange(0, 65535)] [int]$VaultPort = 0,
  [ValidateRange(0, 65535)] [int]$ApiPort = 0,
  [ValidateRange(0, 65535)] [int]$WorkerHealthPort = 0,

  [string]$StorageRoot = '',

  [ValidateSet('Full', 'RuntimeFocal', 'RedisOfflineFocal')]
  [string]$ValidationMode = 'Full',

  [switch]$PreserveEvidence
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$composeFile = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'compose.yaml'))
$prepareStorageScript = [IO.Path]::GetFullPath(
  (Join-Path $PSScriptRoot 'prepare-local-storage.ps1')
)
$isWindowsHost = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
$pathComparison = if ($isWindowsHost) {
  [StringComparison]::OrdinalIgnoreCase
} else {
  [StringComparison]::Ordinal
}
$validationRoot = [IO.Path]::GetFullPath(
  (Join-Path $workspace '.local/cfdi-phase0-validation')
)
$storageBase = [IO.Path]::GetFullPath((Join-Path $validationRoot 'storage'))
$vaultTlsBase = [IO.Path]::GetFullPath((Join-Path $validationRoot 'vault-tls'))
$runtimeEnvBase = [IO.Path]::GetFullPath((Join-Path $validationRoot 'runtime-env'))
$reportBase = [IO.Path]::GetFullPath(
  (Join-Path $workspace '.local/cfdi-phase0-validation-reports')
)
$reportTarget = [IO.Path]::GetFullPath(
  (Join-Path $reportBase "$ProjectName.json")
)
$vaultTlsRoot = [IO.Path]::GetFullPath((Join-Path $vaultTlsBase $ProjectName))
$runtimeEnvRoot = [IO.Path]::GetFullPath((Join-Path $runtimeEnvBase $ProjectName))
$databaseName = 'balanz_cfdi_phase0_test'
$databaseUser = 'balanz_cfdi_admin'
$apiDatabaseUser = 'balanz_phase0_api_login'
$workerDatabaseUser = 'balanz_phase0_worker_login'
$minioRootUser = 'balanz_phase0'
$minioAppUser = 'balanz_cfdi_app'
$minioBucket = 'balanz-cfdi-phase0-test'
$deploySmokeImage = "balanz/deploy-smoke:$ProjectName"
$minioValidationImage = "balanz/minio:cfdi-phase0-$ProjectName"
$startedAt = [DateTime]::UtcNow
$currentStep = 'preflight'
$failure = $null
$stackOwnedByThisRun = $false
$storageRootOwnedByThisRun = $false
$vaultTlsRootOwnedByThisRun = $false
$runtimeEnvRootOwnedByThisRun = $false
$localImageNamespaceOwnedByThisRun = $false
$deploySmokeImageId = $null
$minioValidationImageId = $null
$vaultContainerId = $null
$effectiveStorageRoot = $null
$originalLocation = (Get-Location).Path
$originalEnvironment = @{}
$trackedEnvironment = [Collections.Generic.HashSet[string]]::new(
  [StringComparer]::Ordinal
)
$secretValues = [Collections.Generic.List[string]]::new()
$composeArguments = @(
  '--project-name',
  $ProjectName,
  '--file',
  $composeFile,
  '--profile',
  'phase0-validation'
)

$summary = [ordered]@{
  status = 'FAIL'
  startedAt = $startedAt.ToString('o')
  completedAt = $null
  durationSeconds = $null
  projectName = $ProjectName
  composeFile = 'infra/cfdi-phase0/compose.yaml'
  reportPath = ".local/cfdi-phase0-validation-reports/$ProjectName.json"
  disposableCredentials = 'IN_MEMORY_NOT_REPORTED'
  preserveEvidence = [bool]$PreserveEvidence
  validationMode = $ValidationMode
  qualityGates = [ordered]@{
    apiLint = 'NOT_RUN'
    apiTypecheck = 'NOT_RUN'
    apiJest = 'NOT_RUN'
    apiBuild = 'NOT_RUN'
    webLint = 'NOT_RUN'
    webTypecheck = 'NOT_RUN'
    webTests = 'NOT_RUN'
    webBuild = 'NOT_RUN'
  }
  docker = 'NOT_RUN'
  compose = 'NOT_RUN'
  services = 'NOT_RUN'
  localStorage = 'NOT_RUN'
  vault = 'NOT_RUN'
  vaultPolicyIsolation = 'NOT_RUN'
  releaseProcessDefinition = 'NOT_RUN'
  deployRuntimeIsolationSmoke = 'NOT_RUN'
  deployRollbackSmoke = 'NOT_RUN'
  deployLegacyCutoverSmoke = 'NOT_RUN'
  localBuildImages = 'NOT_RUN'
  nonSuperMigratorNegative = 'NOT_RUN'
  runtimeLogins = 'NOT_RUN'
  postgresPhase0Qa = 'NOT_RUN'
  externalAdapters = 'NOT_RUN'
  redisRuntimeWakeupBeforeOutage = 'NOT_RUN'
  redisUnavailableColdStart = 'NOT_RUN'
  postgresPollingWithoutRedis = 'NOT_RUN'
  redisRuntimeRecovery = 'NOT_RUN'
  redisRuntimeWakeupAfterRecovery = 'NOT_RUN'
  apiRuntime = 'NOT_RUN'
  workerRuntime = 'NOT_RUN'
  runtimeSmoke = 'NOT_RUN'
  workerRuntimeSmoke = 'NOT_RUN'
  runtimeFiscalRls = 'NOT_RUN'
  environmentRouting = 'NOT_RUN'
  runtimeEnvFileRouting = 'NOT_RUN'
  runtimeMountRouting = 'NOT_RUN'
  runtimeNetworkRouting = 'NOT_RUN'
  runtimeShutdown = 'NOT_RUN'
  runtimeShutdownRedisAvailable = 'NOT_RUN'
  runtimeShutdownRedisUnavailable = 'NOT_RUN'
  logsRedacted = 'NOT_RUN'
  cleanupOwnership = 'NOT_RUN'
  composeDown = 'NOT_RUN'
  volumesDeleted = $false
  localBuildImagesDeleted = $false
  localResourcesDeleted = $false
  localReport = 'NOT_RUN'
  failedStep = $null
}

function New-RandomBase64Secret {
  param([ValidateRange(16, 128)][int]$ByteCount = 32)

  $bytes = New-Object byte[] $ByteCount
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  return [Convert]::ToBase64String($bytes)
}

function Add-SecretValue {
  param([AllowEmptyString()][Parameter(Mandatory = $true)][string]$Value)

  if ($Value.Length -ge 8 -and -not $script:secretValues.Contains($Value)) {
    $script:secretValues.Add($Value)
  }
}

function Set-TrackedEnvironment {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [AllowNull()][AllowEmptyString()][string]$Value
  )

  if ($script:trackedEnvironment.Add($Name)) {
    $script:originalEnvironment[$Name] = [Environment]::GetEnvironmentVariable(
      $Name,
      [EnvironmentVariableTarget]::Process
    )
  }
  [Environment]::SetEnvironmentVariable(
    $Name,
    $Value,
    [EnvironmentVariableTarget]::Process
  )
}

function Restore-TrackedEnvironment {
  foreach ($key in $script:trackedEnvironment) {
    [Environment]::SetEnvironmentVariable(
      $key,
      $script:originalEnvironment[$key],
      [EnvironmentVariableTarget]::Process
    )
  }
}

function Get-DynamicTcpPorts {
  param([ValidateRange(1, 16)][int]$Count)

  $listeners = @()
  $ports = @()
  try {
    for ($index = 0; $index -lt $Count; $index += 1) {
      $listener = [Net.Sockets.TcpListener]::new(
        [Net.IPAddress]::Loopback,
        0
      )
      $listener.Start()
      $listeners += $listener
      $ports += ([Net.IPEndPoint]$listener.LocalEndpoint).Port
    }
    return $ports
  } finally {
    foreach ($listener in $listeners) {
      $listener.Stop()
    }
  }
}

function Test-PathEqual {
  param(
    [Parameter(Mandatory = $true)][string]$Left,
    [Parameter(Mandatory = $true)][string]$Right
  )

  return [IO.Path]::GetFullPath($Left).TrimEnd('\', '/').Equals(
    [IO.Path]::GetFullPath($Right).TrimEnd('\', '/'),
    $script:pathComparison
  )
}

function Test-DockerBindSourceEqual {
  param(
    [Parameter(Mandatory = $true)][string]$Actual,
    [Parameter(Mandatory = $true)][string]$Expected
  )

  $candidate = $Actual
  if ($script:isWindowsHost) {
    $slashPath = $Actual.Replace('\', '/')
    $dockerDesktopMatch = [regex]::Match(
      $slashPath,
      '^/(?:run/desktop/mnt/host|host_mnt)/([A-Za-z])/(.+)$'
    )
    if ($dockerDesktopMatch.Success) {
      $drive = $dockerDesktopMatch.Groups[1].Value.ToUpperInvariant()
      $relative = $dockerDesktopMatch.Groups[2].Value.Replace('/', '\')
      $candidate = "${drive}:\$relative"
    }
  }
  return Test-PathEqual -Left $candidate -Right $Expected
}

function Test-PathWithin {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Root
  )

  $rootPrefix = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/') +
    [IO.Path]::DirectorySeparatorChar
  return [IO.Path]::GetFullPath($Path).StartsWith(
    $rootPrefix,
    $script:pathComparison
  )
}

function Assert-NoReparseAncestor {
  param([Parameter(Mandatory = $true)][string]$Path)

  $current = [IO.Path]::GetFullPath($Path)
  while ($current) {
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      if (
        ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        ($item.PSObject.Properties.Name -contains 'LinkType' -and $item.LinkType)
      ) {
        throw 'Refusing a path with a symlink, junction or reparse ancestor'
      }
    }
    $parent = [IO.Path]::GetDirectoryName($current)
    if (-not $parent -or (Test-PathEqual -Left $parent -Right $current)) {
      break
    }
    $current = $parent
  }
}

function Assert-NoReparseTree {
  param([Parameter(Mandatory = $true)][string]$Root)

  Assert-NoReparseAncestor -Path $Root
  if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
    return
  }
  foreach ($entry in Get-ChildItem -LiteralPath $Root -Force) {
    if (
      ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
      ($entry.PSObject.Properties.Name -contains 'LinkType' -and $entry.LinkType)
    ) {
      throw 'Refusing to traverse a symlink, junction or reparse point'
    }
    if ($entry.PSIsContainer) {
      Assert-NoReparseTree -Root $entry.FullName
    }
  }
}

function Assert-NonPublicPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  $segments = [IO.Path]::GetFullPath($Path).Split(
    [char[]]'\/',
    [StringSplitOptions]::RemoveEmptyEntries
  )
  foreach ($segment in $segments) {
    if ($segment.Equals('public', $script:pathComparison)) {
      throw 'The validation path must not be under a public directory'
    }
  }
}

function Initialize-SafeDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$AllowedBase,
    [switch]$RequireProjectLeaf
  )

  $target = [IO.Path]::GetFullPath($Path)
  $base = [IO.Path]::GetFullPath($AllowedBase)
  if (-not (Test-PathWithin -Path $target -Root $base)) {
    throw 'The isolated directory must remain inside its fixed validation root'
  }
  if (
    $RequireProjectLeaf -and
    -not ([IO.Path]::GetFileName($target).Equals(
      $script:ProjectName,
      $script:pathComparison
    ))
  ) {
    throw 'The isolated directory leaf must equal ProjectName'
  }
  Assert-NonPublicPath -Path $target
  Assert-NoReparseAncestor -Path $target
  if (-not (Test-Path -LiteralPath $target)) {
    [IO.Directory]::CreateDirectory($target) | Out-Null
  }
  $item = Get-Item -LiteralPath $target -Force
  if (-not $item.PSIsContainer) {
    throw 'The isolated validation path is not a directory'
  }
  Assert-NoReparseAncestor -Path $target
  return $target
}

function Remove-OwnedLocalDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$AllowedBase
  )

  $target = [IO.Path]::GetFullPath($Path)
  if (
    -not (Test-PathWithin -Path $target -Root $AllowedBase) -or
    -not ([IO.Path]::GetFileName($target).Equals(
      $script:ProjectName,
      $script:pathComparison
    ))
  ) {
    throw 'Refusing to delete a local directory outside the exact project root'
  }
  if (-not (Test-Path -LiteralPath $target)) {
    return
  }
  Assert-NoReparseTree -Root $target
  Get-ChildItem -LiteralPath $target -Force -Recurse | ForEach-Object {
    if ($_.Attributes -band [IO.FileAttributes]::ReadOnly) {
      $_.Attributes = $_.Attributes -bxor [IO.FileAttributes]::ReadOnly
    }
  }
  [IO.Directory]::Delete($target, $true)
}

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$Step,
    [Parameter(Mandatory = $true)][scriptblock]$Command
  )

  $script:currentStep = $Step
  $global:LASTEXITCODE = 0
  $captured = @()
  $commandFailure = $null
  $previousPreference = $ErrorActionPreference
  # Windows PowerShell promotes native stderr records to non-terminating
  # ErrorRecords. Passing test suites intentionally exercise logged failures,
  # so judge native commands by their exit code while still capturing output.
  $ErrorActionPreference = 'Continue'
  try {
    $captured = @(& $Command 2>&1)
    $exitCode = $LASTEXITCODE
  } catch {
    $commandFailure = $_
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  $capturedText = (($captured | ForEach-Object { [string]$_ }) -join [Environment]::NewLine)
  foreach ($secret in $script:secretValues) {
    if ($capturedText.IndexOf($secret, [StringComparison]::Ordinal) -ge 0) {
      throw "$Step exposed a disposable credential; captured output was suppressed"
    }
  }
  if (
    ($null -ne $commandFailure -or $exitCode -ne 0) -and
    $Step -eq 'runtime-entrypoints-up'
  ) {
    $safeCommandOutput = $capturedText.Replace($workspace, '<workspace>')
    $safeCommandOutput = [regex]::Replace(
      $safeCommandOutput,
      '(?i)(password|secret(?:_id)?|token|authorization|access[_-]?key)(\s*[:=]\s*)[^\s,;]+',
      '$1$2[REDACTED]'
    )
    foreach ($line in @($safeCommandOutput -split '\r?\n' | Select-Object -Last 20)) {
      if ($line.Length -gt 500) {
        $line = $line.Substring(0, 500) + '...'
      }
      [Console]::Error.WriteLine("SANITIZED_RUNTIME_STARTUP_COMMAND: $line")
    }
  }
  if ($null -ne $commandFailure) {
    throw "$Step failed; captured output was suppressed"
  }
  if ($exitCode -ne 0) {
    throw "$Step failed with exit code $exitCode; captured output was suppressed"
  }
}

function Invoke-CapturedExternal {
  param(
    [Parameter(Mandatory = $true)][string]$Step,
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [AllowNull()][string]$InputText,
    [switch]$SanitizeFailureOutput
  )

  $script:currentStep = $Step
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $global:LASTEXITCODE = 0
    if ($null -ne $InputText) {
      $output = $InputText | & $FilePath @Arguments 2>&1
    } else {
      $output = & $FilePath @Arguments 2>&1
    }
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($exitCode -ne 0) {
    if ($SanitizeFailureOutput) {
      $safeOutput = (($output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine)
      foreach ($secret in $script:secretValues) {
        $safeOutput = $safeOutput.Replace($secret, '[REDACTED]')
      }
      $safeOutput = $safeOutput.Replace($workspace, '<workspace>')
      $safeOutput = [regex]::Replace(
        $safeOutput,
        '(?i)(password|secret(?:_id)?|token|authorization|access[_-]?key)(\s*[:=]\s*)[^\s,;]+',
        '$1$2[REDACTED]'
      )
      $safeOutput = [regex]::Replace(
        $safeOutput,
        '\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b',
        '[REDACTED_JWT]'
      )
      $safeOutput = [regex]::Replace(
        $safeOutput,
        '\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b',
        '<uuid>'
      )
      foreach ($line in @($safeOutput -split '\r?\n' | Select-Object -Last 20)) {
        if ($line.Length -gt 500) {
          $line = $line.Substring(0, 500) + '...'
        }
        [Console]::Error.WriteLine("SANITIZED_EXTERNAL_FAILURE[$Step]: $line")
      }
    }
    throw "$Step failed with exit code $exitCode; captured output was suppressed"
  }
  return (($output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine).Trim()
}

function Invoke-ExpectedFailureCaptured {
  param(
    [Parameter(Mandatory = $true)][string]$Step,
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$ExpectedText
  )

  $script:currentStep = $Step
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $global:LASTEXITCODE = 0
    $output = & $FilePath @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  $captured = (($output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine)
  foreach ($secret in $script:secretValues) {
    if ($captured.IndexOf($secret, [StringComparison]::Ordinal) -ge 0) {
      throw 'An expected-failure command exposed a disposable credential'
    }
  }
  if ($exitCode -eq 0) {
    throw "$Step unexpectedly succeeded"
  }
  if ($captured.IndexOf($ExpectedText, [StringComparison]::Ordinal) -lt 0) {
    throw "$Step failed for an unexpected reason; captured output was suppressed"
  }
}

function Get-ProjectResourceIds {
  param([ValidateSet('container', 'volume', 'network')][string]$Kind)

  $arguments = switch ($Kind) {
    'container' { @('ps', '-aq', '--filter', "label=com.docker.compose.project=$ProjectName") }
    'volume' { @('volume', 'ls', '-q', '--filter', "label=com.docker.compose.project=$ProjectName") }
    'network' { @('network', 'ls', '-q', '--filter', "label=com.docker.compose.project=$ProjectName") }
  }
  $output = Invoke-CapturedExternal `
    -Step "inspect-existing-$Kind-resources" `
    -FilePath 'docker' `
    -Arguments $arguments
  if (-not $output) {
    return @()
  }
  return @($output -split '\r?\n' | Where-Object { $_.Trim() })
}

function Get-ExactDockerImageIds {
  param([Parameter(Mandatory = $true)][string]$ImageTag)

  $output = Invoke-CapturedExternal `
    -Step 'inspect-local-build-image-tags' `
    -FilePath 'docker' `
    -Arguments @(
      'image',
      'ls',
      '--all',
      '--quiet',
      '--no-trunc',
      '--filter',
      "reference=$ImageTag"
    )
  if (-not $output) {
    return @()
  }
  return @(
    $output -split '\r?\n' |
      Where-Object { $_.Trim() } |
      Sort-Object -Unique
  )
}

function Assert-LocalBuildImageOwnership {
  param(
    [Parameter(Mandatory = $true)][string]$ImageTag,
    [Parameter(Mandatory = $true)][string]$Service
  )

  $imageJson = Invoke-CapturedExternal `
    -Step "inspect-$Service-image-ownership" `
    -FilePath 'docker' `
    -Arguments @('image', 'inspect', $ImageTag)
  $images = @($imageJson | ConvertFrom-Json)
  if ($images.Count -ne 1) {
    throw "Expected exactly one locally built image for $Service"
  }
  $image = $images[0]
  $labels = $image.Config.Labels
  if (
    $labels.'com.balanz.validation.run' -cne $ProjectName -or
    $labels.'com.balanz.validation.service' -cne $Service
  ) {
    throw "Refusing local image access because $Service ownership labels differ"
  }
  $repoTags = @($image.RepoTags)
  if (
    $repoTags.Count -ne 1 -or
    -not ([string]$repoTags[0]).Equals($ImageTag, [StringComparison]::Ordinal)
  ) {
    throw "Refusing local image access because $Service has unexpected tags"
  }
  $imageId = [string]$image.Id
  if (-not $imageId.StartsWith('sha256:', [StringComparison]::Ordinal)) {
    throw "Refusing local image access because $Service has an invalid image ID"
  }
  return $imageId
}

function Test-DockerImageExists {
  param([Parameter(Mandatory = $true)][string]$ImageReference)

  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $global:LASTEXITCODE = 0
    $null = & docker image inspect --format '{{.Id}}' $ImageReference 2>$null
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($exitCode -eq 0) {
    return $true
  }
  if ($exitCode -eq 1) {
    return $false
  }
  throw 'Docker image inspection failed with an unexpected exit code'
}

function Remove-OwnedLocalBuildImage {
  param(
    [Parameter(Mandatory = $true)][string]$ImageTag,
    [Parameter(Mandatory = $true)][string]$Service,
    [AllowNull()][string]$ExpectedImageId
  )

  $imageIds = @(Get-ExactDockerImageIds -ImageTag $ImageTag)
  if ($imageIds.Count -eq 0) {
    return
  }
  if ($imageIds.Count -ne 1) {
    throw "Refusing cleanup because $Service resolved to multiple image IDs"
  }
  $actualImageId = Assert-LocalBuildImageOwnership `
    -ImageTag $ImageTag `
    -Service $Service
  if ($ExpectedImageId -and $actualImageId -cne $ExpectedImageId) {
    throw "Refusing cleanup because $Service image identity changed"
  }
  $null = Invoke-CapturedExternal `
    -Step "remove-$Service-image" `
    -FilePath 'docker' `
    -Arguments @('image', 'rm', $ImageTag)
  if (
    @(Get-ExactDockerImageIds -ImageTag $ImageTag).Count -ne 0 -or
    (Test-DockerImageExists -ImageReference $actualImageId)
  ) {
    throw "$Service image remained after exact cleanup"
  }
}

function Assert-ComposeResourceOwnership {
  param(
    [ValidateSet('container', 'volume', 'network')][string]$Kind,
    [Parameter(Mandatory = $true)][string]$ResourceId
  )

  $inspectArguments = if ($Kind -eq 'container') {
    @('inspect', '--format', '{{json .Config.Labels}}', $ResourceId)
  } else {
    @($Kind, 'inspect', '--format', '{{json .Labels}}', $ResourceId)
  }
  $labelJson = Invoke-CapturedExternal `
    -Step "verify-$Kind-ownership" `
    -FilePath 'docker' `
    -Arguments $inspectArguments
  $labels = $labelJson | ConvertFrom-Json
  $actualProject = $labels.'com.docker.compose.project'
  if ($actualProject -cne $ProjectName) {
    throw "Refusing cleanup because a $Kind does not have the exact project label"
  }
  if ($Kind -eq 'container') {
    $workingDirectory = $labels.'com.docker.compose.project.working_dir'
    $configFiles = $labels.'com.docker.compose.project.config_files'
    if (
      -not $workingDirectory -or
      -not (Test-PathEqual -Left $workingDirectory -Right $PSScriptRoot)
    ) {
      throw "Refusing cleanup because a $Kind has an unexpected Compose working directory"
    }
    if (-not $configFiles) {
      throw "Refusing cleanup because a $Kind lacks the Compose config-files label"
    }
    $matchesCompose = $false
    foreach ($configFile in ([string]$configFiles -split ',')) {
      if (Test-PathEqual -Left $configFile.Trim() -Right $composeFile) {
        $matchesCompose = $true
      }
    }
    if (-not $matchesCompose) {
      throw "Refusing cleanup because a $Kind has an unexpected Compose file label"
    }
    $serviceName = $labels.'com.docker.compose.service'
    $allowedServices = @(
      'postgres',
      'redis',
      'minio',
      'minio-bootstrap',
      'clamav',
      'vault',
      'deploy-control-smoke',
      'runtime-storage-init',
      'api',
      'worker'
    )
    if ($serviceName -notin $allowedServices) {
      throw 'Refusing cleanup because a container has an unexpected Compose service label'
    }
    return
  }

  $resourceName = Invoke-CapturedExternal `
    -Step "verify-$Kind-name" `
    -FilePath 'docker' `
    -Arguments @($Kind, 'inspect', '--format', '{{.Name}}', $ResourceId)
  if (-not $resourceName.StartsWith("$ProjectName`_", [StringComparison]::Ordinal)) {
    throw "Refusing cleanup because a $Kind name is outside the exact project namespace"
  }
  if ($Kind -eq 'volume') {
    $volumeKey = $labels.'com.docker.compose.volume'
    $allowedVolumes = @(
      'cfdi_phase0_postgres',
      'cfdi_phase0_redis',
      'cfdi_phase0_minio',
      'cfdi_phase0_clamav_signatures',
      'cfdi_phase0_runtime_storage'
    )
    if ($volumeKey -notin $allowedVolumes) {
      throw 'Refusing cleanup because a volume has an unexpected Compose volume label'
    }
  } else {
    $networkKey = [string]$labels.'com.docker.compose.network'
    if ($networkKey -cne 'default' -and $networkKey -cne 'redis_wakeup') {
      throw 'Refusing cleanup because a network has an unexpected Compose network label'
    }
  }
}

function Assert-AllComposeResourcesOwned {
  foreach ($kind in @('container', 'volume', 'network')) {
    foreach ($resourceId in @(Get-ProjectResourceIds -Kind $kind)) {
      Assert-ComposeResourceOwnership -Kind $kind -ResourceId $resourceId
    }
  }
}

function Get-ComposeContainerId {
  param(
    [Parameter(Mandatory = $true)][string]$Service,
    [switch]$IncludeStopped
  )

  $psArguments = @('ps')
  if ($IncludeStopped) {
    $psArguments += '--all'
  }
  $psArguments += @('-q', $Service)
  $containerId = Invoke-CapturedExternal `
    -Step "locate-$Service-container" `
    -FilePath 'docker' `
    -Arguments (@('compose') + $script:composeArguments + $psArguments)
  if (-not $containerId -or $containerId -match '\r?\n') {
    throw "Expected exactly one container for service $Service"
  }
  return $containerId
}

function Assert-HealthyComposeService {
  param([Parameter(Mandatory = $true)][string]$Service)

  $containerId = Get-ComposeContainerId -Service $Service
  $state = Invoke-CapturedExternal `
    -Step "inspect-$Service-health" `
    -FilePath 'docker' `
    -Arguments @(
      'inspect',
      '--format',
      '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
      $containerId
    )
  if ($state -ne 'healthy') {
    throw "The $Service service did not reach healthy state"
  }
}

function Invoke-PostgresAdminSql {
  param(
    [Parameter(Mandatory = $true)][string]$Step,
    [Parameter(Mandatory = $true)][string]$Sql
  )

  $postgresContainerId = Get-ComposeContainerId -Service 'postgres'
  return Invoke-CapturedExternal `
    -Step $Step `
    -FilePath 'docker' `
    -Arguments @(
      'exec',
      '-i',
      $postgresContainerId,
      'psql',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      $databaseUser,
      '-d',
      $databaseName,
      '-At'
    ) `
    -InputText $Sql
}

function New-RuntimeSmokeFixture {
  $passwordMaterial = (New-RandomBase64Secret) -replace '[^A-Za-z0-9]', ''
  $password = 'Phase0!' + $passwordMaterial.Substring(0, 24)
  Add-SecretValue -Value $password
  $hashProgram = @'
const bcrypt = require('bcrypt');
let value = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { value += chunk; });
process.stdin.on('end', async () => {
  const password = value.trim();
  const hash = await bcrypt.hash(password, 10);
  process.stdout.write(hash);
});
'@
  $passwordHash = Invoke-CapturedExternal `
    -Step 'runtime-smoke-password-hash' `
    -FilePath 'node' `
    -Arguments @('-e', $hashProgram) `
    -InputText $password
  if (-not $passwordHash.StartsWith('$2')) {
    throw 'The runtime smoke password hash is invalid'
  }
  Add-SecretValue -Value $passwordHash

  $userId = [guid]::NewGuid().ToString()
  $organizationAId = [guid]::NewGuid().ToString()
  $membershipAId = [guid]::NewGuid().ToString()
  $organizationBId = [guid]::NewGuid().ToString()
  $membershipBId = [guid]::NewGuid().ToString()
  $clientAccountId = [guid]::NewGuid().ToString()
  $legalEntityId = [guid]::NewGuid().ToString()
  $objectId = [guid]::NewGuid().ToString()
  $fixtureTag = ([guid]::NewGuid().ToString('N')).Substring(0, 20)
  $email = "phase0-$fixtureTag@example.test"
  $sql = @"
BEGIN;
INSERT INTO public.users (
  id, first_name, last_name, email, email_verified_at, locale, timezone,
  status, password_hash, created_at, updated_at
) VALUES (
  '$userId', 'Phase Zero', 'Runtime Smoke', '$email', now(), 'es-MX',
  'America/Mexico_City', 'active', '$passwordHash', now(), now()
);
INSERT INTO public.organizations (
  id, name, slug, timezone, owner_user_id, status, created_at, updated_at
) VALUES
  ('$organizationAId', 'Phase Zero Tenant A', 'phase0-$fixtureTag-a',
   'America/Mexico_City', '$userId', 'active', now(), now()),
  ('$organizationBId', 'Phase Zero Tenant B', 'phase0-$fixtureTag-b',
   'America/Mexico_City', '$userId', 'active', now(), now());
INSERT INTO public.memberships (
  id, organization_id, user_id, role_id, status, joined_at, created_at, updated_at
) VALUES
  ('$membershipAId', '$organizationAId', '$userId',
   (SELECT id FROM public.roles WHERE key = 'admin'), 'active', now(), now(), now()),
  ('$membershipBId', '$organizationBId', '$userId',
   (SELECT id FROM public.roles WHERE key = 'admin'), 'active', now(), now(), now());
INSERT INTO public.client_accounts (
  id, organization_id, name, code, status, version, created_at, updated_at
) VALUES (
  '$clientAccountId', '$organizationAId', 'Synthetic RLS Account', 'SMOKE-A',
  'active', 1, now(), now()
);
INSERT INTO public.legal_entities (
  id, organization_id, client_account_id, rfc, legal_name, status, version,
  created_at, updated_at
) VALUES (
  '$legalEntityId', '$organizationAId', '$clientAccountId', 'AAA010101AAA',
  'Synthetic RLS Entity', 'active', 1, now(), now()
);
INSERT INTO public.stored_objects (
  id, organization_id, client_account_id, legal_entity_id, kind,
  storage_provider, storage_container, object_key, encryption_class
) VALUES (
  '$objectId', '$organizationAId', '$clientAccountId', '$legalEntityId',
  'manual_xml', 'local', 'phase0-smoke', 'objects/$objectId', 'fiscal'
);
COMMIT;
"@
  $null = Invoke-PostgresAdminSql `
    -Step 'runtime-smoke-fixture' `
    -Sql $sql

  return [ordered]@{
    email = $email
    password = $password
    organizationAId = $organizationAId
    membershipAId = $membershipAId
    organizationBId = $organizationBId
    membershipBId = $membershipBId
    objectId = $objectId
  }
}

function Invoke-PhaseZeroRuntimeSmoke {
  param([Parameter(Mandatory = $true)][Collections.IDictionary]$Fixture)

  $apiContainerId = Get-ComposeContainerId -Service 'api'
  $serialized = $Fixture | ConvertTo-Json -Compress
  $output = Invoke-CapturedExternal `
    -Step 'phase-zero-runtime-smoke' `
    -FilePath 'docker' `
    -Arguments @(
      'exec',
      '-i',
      '-e',
      'RUN_PHASE0_RUNTIME_SMOKE=true',
      $apiContainerId,
      'node',
      '-r',
      'ts-node/register/transpile-only',
      'test/validate-phase0-runtime-smoke.ts'
    ) `
    -InputText $serialized `
    -SanitizeFailureOutput
  foreach ($secret in $secretValues) {
    if ($output.IndexOf($secret, [StringComparison]::Ordinal) -ge 0) {
      throw 'The runtime smoke emitted a disposable credential'
    }
  }
  if ($output.IndexOf('"status":"PASS"', [StringComparison]::Ordinal) -lt 0) {
    throw 'The runtime smoke did not produce its sanitized PASS result'
  }
}

function Invoke-PhaseZeroWorkerRuntimeSmoke {
  param([switch]$ExpectRedisUnavailable)

  $workerContainerId = Get-ComposeContainerId -Service 'worker'
  $arguments = @('exec')
  if ($ExpectRedisUnavailable) {
    $arguments += @('-e', 'EXPECT_REDIS_UNAVAILABLE=true')
  }
  $arguments += @(
    '-e',
    'RUN_PHASE0_WORKER_RUNTIME_SMOKE=true',
    $workerContainerId,
    'node',
    '-r',
    'ts-node/register/transpile-only',
    'test/validate-phase0-worker-runtime-smoke.ts'
  )
  $output = Invoke-CapturedExternal `
    -Step 'phase-zero-worker-runtime-smoke' `
    -FilePath 'docker' `
    -Arguments $arguments `
    -SanitizeFailureOutput
  foreach ($secret in $secretValues) {
    if ($output.IndexOf($secret, [StringComparison]::Ordinal) -ge 0) {
      throw 'The worker runtime smoke emitted a disposable credential'
    }
  }
  if ($output.IndexOf('"status":"PASS"', [StringComparison]::Ordinal) -lt 0) {
    throw 'The worker runtime smoke did not produce its sanitized PASS result'
  }
}

function Invoke-RedisUnavailableHealthProbe {
  param(
    [ValidateSet('api', 'worker')][string]$Service,
    [Parameter(Mandatory = $true)][int]$InternalPort
  )

  $containerId = Get-ComposeContainerId -Service $Service
  $program = @'
const [baseUrl, expectedProcess] = process.argv.slice(1);
Promise.all([
  fetch(`${baseUrl}/liveness`).then(async response => ({ response, body: await response.json() })),
  fetch(`${baseUrl}/readiness`).then(async response => ({ response, body: await response.json() })),
]).then(([live, ready]) => {
  const redis = ready.body?.dependencies?.redisWakeup;
  const supervisor = ready.body?.dependencies?.workerSupervisor;
  const postgres = ready.body?.dependencies?.postgres;
  const storage = ready.body?.dependencies?.storage;
  const scanner = ready.body?.dependencies?.scanner;
  process.stdout.write(JSON.stringify({
    livenessHttp: live.response.status,
    livenessStatus: live.body?.status ?? null,
    livenessProcess: live.body?.process ?? null,
    readinessHttp: ready.response.status,
    readinessStatus: ready.body?.status ?? null,
    readinessProcess: ready.body?.process ?? null,
    redisStatus: redis?.status ?? null,
    redisRequired: redis?.required ?? null,
    postgresStatus: postgres?.status ?? null,
    postgresErrorCode: postgres?.errorCode ?? null,
    postgresDurationMs: postgres?.durationMs ?? null,
    storageStatus: storage?.status ?? null,
    storageErrorCode: storage?.errorCode ?? null,
    storageDurationMs: storage?.durationMs ?? null,
    scannerStatus: scanner?.status ?? null,
    scannerErrorCode: scanner?.errorCode ?? null,
    scannerDurationMs: scanner?.durationMs ?? null,
    supervisorStatus: supervisor?.status ?? null,
    supervisorState: supervisor?.state ?? null,
    supervisorAcceptingClaims: supervisor?.acceptingClaims ?? null,
    expectedProcess,
    requestCompleted: true,
  }));
}).catch(() => process.stdout.write(JSON.stringify({
  livenessHttp: null,
  livenessStatus: null,
  livenessProcess: null,
  readinessHttp: null,
  readinessStatus: null,
  readinessProcess: null,
  redisStatus: null,
  redisRequired: null,
  postgresStatus: null,
  postgresErrorCode: null,
  postgresDurationMs: null,
  storageStatus: null,
  storageErrorCode: null,
  storageDurationMs: null,
  scannerStatus: null,
  scannerErrorCode: null,
  scannerDurationMs: null,
  supervisorStatus: null,
  supervisorState: null,
  supervisorAcceptingClaims: null,
  expectedProcess,
  requestCompleted: false,
})));
'@
  $evidence = $null
  $valid = $false
  $attempt = 0
  for ($attempt = 1; $attempt -le 30; $attempt += 1) {
    $result = Invoke-CapturedExternal `
      -Step "$Service-redis-unavailable-health" `
      -FilePath 'docker' `
      -Arguments @(
        'exec',
        $containerId,
        'node',
        '-e',
        $program,
        "http://127.0.0.1:$InternalPort",
        $Service
      )
    $evidence = ConvertFrom-Json -InputObject $result
    $valid =
      [bool]$evidence.requestCompleted -and
      [int]$evidence.livenessHttp -eq 200 -and
      [string]$evidence.livenessStatus -ceq 'up' -and
      [string]$evidence.livenessProcess -ceq $Service -and
      [int]$evidence.readinessHttp -eq 200 -and
      [string]$evidence.readinessStatus -ceq 'degraded' -and
      [string]$evidence.readinessProcess -ceq $Service -and
      [string]$evidence.redisStatus -ceq 'down' -and
      $evidence.redisRequired -eq $false -and
      [string]$evidence.postgresStatus -ceq 'up' -and
      [string]$evidence.storageStatus -ceq 'up' -and
      [string]$evidence.scannerStatus -ceq 'up' -and
      (
        $Service -cne 'worker' -or
        (
          [string]$evidence.supervisorStatus -ceq 'up' -and
          [string]$evidence.supervisorState -ceq 'running' -and
          $evidence.supervisorAcceptingClaims -eq $true
        )
      )
    if ($valid) {
      break
    }
    Start-Sleep -Milliseconds 500
  }
  [Console]::Error.WriteLine(
    "SANITIZED_REDIS_UNAVAILABLE_HEALTH: $([ordered]@{ attempt = [math]::Min($attempt, 30); probe = $evidence } | ConvertTo-Json -Compress -Depth 3)"
  )
  if (-not $valid) {
    throw "$Service did not remain live/degraded with Redis unavailable"
  }
}

function Invoke-RedisRecoveredHealthProbe {
  param(
    [ValidateSet('api', 'worker')][string]$Service,
    [Parameter(Mandatory = $true)][int]$InternalPort
  )

  $containerId = Get-ComposeContainerId -Service $Service
  $program = @'
const [baseUrl, expectedProcess] = process.argv.slice(1);
fetch(`${baseUrl}/readiness`).then(async response => {
  const body = await response.json();
  const dependencies = body?.dependencies;
  const supervisor = dependencies?.workerSupervisor;
  process.stdout.write(JSON.stringify({
    readinessHttp: response.status,
    readinessStatus: body?.status ?? null,
    readinessProcess: body?.process ?? null,
    redisStatus: dependencies?.redisWakeup?.status ?? null,
    redisRequired: dependencies?.redisWakeup?.required ?? null,
    postgresStatus: dependencies?.postgres?.status ?? null,
    storageStatus: dependencies?.storage?.status ?? null,
    scannerStatus: dependencies?.scanner?.status ?? null,
    supervisorStatus: supervisor?.status ?? null,
    supervisorState: supervisor?.state ?? null,
    supervisorAcceptingClaims: supervisor?.acceptingClaims ?? null,
    expectedProcess,
    requestCompleted: true,
  }));
}).catch(() => process.stdout.write(JSON.stringify({
  readinessHttp: null,
  readinessStatus: null,
  readinessProcess: null,
  redisStatus: null,
  redisRequired: null,
  postgresStatus: null,
  storageStatus: null,
  scannerStatus: null,
  supervisorStatus: null,
  supervisorState: null,
  supervisorAcceptingClaims: null,
  expectedProcess,
  requestCompleted: false,
})));
'@
  $evidence = $null
  $valid = $false
  $attempt = 0
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  for ($attempt = 1; $attempt -le 180; $attempt += 1) {
    $result = Invoke-CapturedExternal `
      -Step "$Service-redis-recovery-health" `
      -FilePath 'docker' `
      -Arguments @(
        'exec',
        $containerId,
        'node',
        '-e',
        $program,
        "http://127.0.0.1:$InternalPort",
        $Service
      )
    $evidence = ConvertFrom-Json -InputObject $result
    $valid =
      [bool]$evidence.requestCompleted -and
      [int]$evidence.readinessHttp -eq 200 -and
      [string]$evidence.readinessStatus -ceq 'up' -and
      [string]$evidence.readinessProcess -ceq $Service -and
      [string]$evidence.redisStatus -ceq 'up' -and
      $evidence.redisRequired -eq $false -and
      [string]$evidence.postgresStatus -ceq 'up' -and
      [string]$evidence.storageStatus -ceq 'up' -and
      [string]$evidence.scannerStatus -ceq 'up' -and
      (
        $Service -cne 'worker' -or
        (
          [string]$evidence.supervisorStatus -ceq 'up' -and
          [string]$evidence.supervisorState -ceq 'running' -and
          $evidence.supervisorAcceptingClaims -eq $true
        )
      )
    if ($valid) { break }
    if ([DateTime]::UtcNow -ge $deadline) { break }
    Start-Sleep -Milliseconds 500
  }
  [Console]::Error.WriteLine(
    "SANITIZED_REDIS_RECOVERY_HEALTH: $([ordered]@{ attempt = [math]::Min($attempt, 180); probe = $evidence } | ConvertTo-Json -Compress -Depth 3)"
  )
  if (-not $valid) {
    throw "$Service did not recover Redis wakeup readiness"
  }
}

function Wait-HealthyComposeService {
  param(
    [Parameter(Mandatory = $true)][string]$Service,
    [ValidateRange(1, 180)][int]$TimeoutSeconds = 60
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $containerId = Get-ComposeContainerId -Service $Service
    $state = Invoke-CapturedExternal `
      -Step "wait-$Service-healthy" `
      -FilePath 'docker' `
      -Arguments @(
        'inspect',
        '--format',
        '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
        $containerId
      )
    if ($state -ceq 'healthy') { return }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "$Service did not become healthy within the bounded recovery window"
}

function Get-WorkerWakeupCounter {
  $workerContainerId = Get-ComposeContainerId -Service 'worker'
  $program = @'
fetch('http://127.0.0.1:3002/metrics').then(async response => {
  if (!response.ok) process.exit(2);
  const text = await response.text();
  const line = text.split(/\r?\n/).find(value => value.startsWith('redis_wakeup_received_total '));
  const value = line ? Number(line.split(/\s+/)[1]) : 0;
  if (!Number.isFinite(value) || value < 0) process.exit(3);
  process.stdout.write(String(value));
}).catch(() => process.exit(4));
'@
  $value = Invoke-CapturedExternal `
    -Step 'worker-wakeup-metric' `
    -FilePath 'docker' `
    -Arguments @('exec', $workerContainerId, 'node', '-e', $program)
  $parsed = 0.0
  if (-not [double]::TryParse(
    $value,
    [Globalization.NumberStyles]::Float,
    [Globalization.CultureInfo]::InvariantCulture,
    [ref]$parsed
  )) {
    throw 'Worker Redis wakeup metric was not a finite counter'
  }
  return $parsed
}

function Assert-RuntimeWakeupDelivery {
  param([ValidateSet('before-outage', 'after-recovery')][string]$Sequence)

  $before = Get-WorkerWakeupCounter
  $redisContainerId = Get-ComposeContainerId -Service 'redis'
  $channel = "balanz:cfdi:p0:$ProjectName`:test"
  $receiversText = Invoke-CapturedExternal `
    -Step "redis-runtime-wakeup-$Sequence" `
    -FilePath 'docker' `
    -Arguments @(
      'exec',
      $redisContainerId,
      'redis-cli',
      '--raw',
      'PUBLISH',
      $channel,
      '1'
    )
  $receivers = 0
  if (-not [int]::TryParse($receiversText, [ref]$receivers) -or $receivers -lt 1) {
    throw 'The real Redis wakeup did not reach the worker subscriber'
  }
  $after = $before
  for ($attempt = 1; $attempt -le 40; $attempt += 1) {
    $after = Get-WorkerWakeupCounter
    if ($after -gt $before) { break }
    Start-Sleep -Milliseconds 250
  }
  if ($after -le $before) {
    throw 'The worker did not record the real Redis wakeup signal'
  }
  [Console]::Error.WriteLine(
    "SANITIZED_RUNTIME_WAKEUP: sequence=$Sequence receiversPositive=true counterAdvanced=true payloadConstant=true"
  )
}

function Assert-WorkerPollingContinuesWithoutRedis {
  $workerContainerId = Get-ComposeContainerId -Service 'worker'
  $program = @'
const url = 'http://127.0.0.1:3002/liveness';
const readActivity = async () => {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || body?.status !== 'up' || body?.process !== 'worker') throw new Error();
  return Date.parse(body?.workerSupervisor?.lastActivityAt ?? '');
};
(async () => {
  const before = await readActivity();
  await new Promise(resolve => setTimeout(resolve, 1000));
  const after = await readActivity();
  if (!Number.isFinite(before) || !Number.isFinite(after) || after <= before) process.exit(2);
  process.stdout.write('PASS');
})().catch(() => process.exit(3));
'@
  $result = Invoke-CapturedExternal `
    -Step 'worker-postgres-polling-without-redis' `
    -FilePath 'docker' `
    -Arguments @('exec', $workerContainerId, 'node', '-e', $program)
  if ($result -ne 'PASS') {
    throw 'Worker polling activity did not continue while Redis was unavailable'
  }

  $reconciled = $false
  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    $workerLogs = Invoke-CapturedExternal `
      -Step 'worker-reconciliation-log-without-redis' `
      -FilePath 'docker' `
      -Arguments (@('compose') + $composeArguments + @(
        'logs',
        '--no-color',
        'worker'
      ))
    if ($workerLogs.IndexOf('ingestion_reconciliation_finished', [StringComparison]::Ordinal) -ge 0) {
      $reconciled = $true
      break
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $reconciled) {
    throw 'The cold-start worker did not reconcile against PostgreSQL'
  }
}

function Assert-ComposeServiceStopped {
  param([Parameter(Mandatory = $true)][string]$Service)

  $containerId = Get-ComposeContainerId -Service $Service -IncludeStopped
  $running = Invoke-CapturedExternal `
    -Step "verify-$Service-stopped" `
    -FilePath 'docker' `
    -Arguments @('inspect', '--format', '{{.State.Running}}', $containerId)
  if ($running -ne 'false') {
    throw "$Service was expected to be completely stopped"
  }
}

function Assert-ReleaseProcessDefinition {
  $program = @'
const path = require('node:path');
const configPath = path.resolve(process.argv[1]);
const repositoryRoot = path.dirname(configPath);
const config = require(configPath);
const api = config.apps?.find(({ name }) => name === 'balanz-api-dev');
const worker = config.apps?.find(({ name }) => name === 'balanz-worker-dev');
const valid =
  api && worker &&
  path.resolve(api.cwd) === repositoryRoot &&
  path.resolve(worker.cwd) === repositoryRoot &&
  api.script === 'scripts/deploy/run-isolated-runtime.sh' &&
  worker.script === 'scripts/deploy/run-isolated-runtime.sh' &&
  api.args === 'api' &&
  worker.args === 'worker' &&
  api.interpreter === '/bin/bash' &&
  worker.interpreter === '/bin/bash' &&
  !api.node_args &&
  !worker.node_args &&
  ![api.script, api.args, api.node_args, worker.script, worker.args, worker.node_args]
    .filter(Boolean)
    .some(value => /migrat|seed|release:prepare/i.test(String(value)));
if (!valid) process.exit(2);
process.stdout.write('PASS');
'@
  $result = Invoke-CapturedExternal `
    -Step 'release-process-definition' `
    -FilePath 'node' `
    -Arguments @('-e', $program, (Join-Path $workspace 'ecosystem.config.cjs'))
  if ($result -ne 'PASS') {
    throw 'The release process definition does not isolate API/worker env files'
  }
}

function Invoke-VaultRootCommand {
  param(
    [Parameter(Mandatory = $true)][string]$Step,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [AllowNull()][string]$InputText
  )

  if (-not $script:vaultContainerId) {
    throw 'The ephemeral Vault container is unavailable'
  }
  $dockerArguments = @('exec')
  if ($null -ne $InputText) {
    $dockerArguments += '-i'
  }
  $dockerArguments += @(
    $script:vaultContainerId,
    'sh',
    '-ec',
    'export VAULT_ADDR=https://127.0.0.1:8200; export VAULT_CACERT=/vault/tls/vault-ca.pem; export VAULT_TOKEN="$VAULT_DEV_ROOT_TOKEN_ID"; exec vault "$@"',
    'vault'
  )
  $dockerArguments += $Arguments
  return Invoke-CapturedExternal `
    -Step $Step `
    -FilePath 'docker' `
    -Arguments $dockerArguments `
    -InputText $InputText
}

function Write-VaultSecret {
  param(
    [Parameter(Mandatory = $true)][string]$LogicalPath,
    [Parameter(Mandatory = $true)][hashtable]$Data
  )

  $payload = @{ data = $Data } | ConvertTo-Json -Compress -Depth 5
  $null = Invoke-VaultRootCommand `
    -Step "vault-write-$($LogicalPath.Replace('/', '-'))" `
    -Arguments @('write', "kv-dev/data/internal/balanz/api/$LogicalPath", '-') `
    -InputText $payload
}

function Initialize-EphemeralVault {
  param(
    [Parameter(Mandatory = $true)][string]$ApiPassword,
    [Parameter(Mandatory = $true)][string]$WorkerPassword,
    [Parameter(Mandatory = $true)][int]$HostRedisPort,
    [Parameter(Mandatory = $true)][string]$JwtSecret,
    [Parameter(Mandatory = $true)][string]$JwtRefreshSecret,
    [Parameter(Mandatory = $true)][string]$EmailAccessKey,
    [Parameter(Mandatory = $true)][string]$EmailSecretKey
  )

  $null = Invoke-VaultRootCommand `
    -Step 'vault-enable-kv-v2' `
    -Arguments @('secrets', 'enable', '-path=kv-dev', '-version=2', 'kv')
  $null = Invoke-VaultRootCommand `
    -Step 'vault-enable-approle' `
    -Arguments @('auth', 'enable', '-path=approle', 'approle')

  $apiPolicy = @'
path "kv-dev/data/internal/balanz/api/database/postgres-api" { capabilities = ["read"] }
path "kv-dev/data/internal/balanz/api/cache/redis" { capabilities = ["read"] }
path "kv-dev/data/internal/balanz/api/auth/jwt" { capabilities = ["read"] }
path "kv-dev/data/internal/balanz/api/email/ses" { capabilities = ["read"] }
'@
  $workerPolicy = @'
path "kv-dev/data/internal/balanz/api/database/postgres-worker" { capabilities = ["read"] }
path "kv-dev/data/internal/balanz/api/cache/redis" { capabilities = ["read"] }
'@
  $null = Invoke-VaultRootCommand `
    -Step 'vault-api-policy' `
    -Arguments @('policy', 'write', 'balanz-phase0-api', '-') `
    -InputText $apiPolicy
  $null = Invoke-VaultRootCommand `
    -Step 'vault-worker-policy' `
    -Arguments @('policy', 'write', 'balanz-phase0-worker', '-') `
    -InputText $workerPolicy

  $roleSettings = @(
    'token_no_default_policy=true',
    'token_ttl=20m',
    'token_max_ttl=30m',
    'secret_id_ttl=30m',
    'secret_id_num_uses=20'
  )
  $null = Invoke-VaultRootCommand `
    -Step 'vault-api-approle' `
    -Arguments (@('write', 'auth/approle/role/balanz-phase0-api', 'token_policies=balanz-phase0-api') + $roleSettings)
  $null = Invoke-VaultRootCommand `
    -Step 'vault-worker-approle' `
    -Arguments (@('write', 'auth/approle/role/balanz-phase0-worker', 'token_policies=balanz-phase0-worker') + $roleSettings)

  Write-VaultSecret -LogicalPath 'database/postgres-api' -Data @{
    db_database = $databaseName
    db_host = 'postgres'
    db_logging = $false
    db_password = $ApiPassword
    db_port = 5432
    db_username = $apiDatabaseUser
  }
  Write-VaultSecret -LogicalPath 'database/postgres-worker' -Data @{
    db_database = $databaseName
    db_host = 'postgres'
    db_logging = $false
    db_password = $WorkerPassword
    db_port = 5432
    db_username = $workerDatabaseUser
  }
  Write-VaultSecret -LogicalPath 'cache/redis' -Data @{
    redis_host = '127.0.0.1'
    redis_port = $HostRedisPort
    redis_password = ''
    redis_db = 0
  }
  Write-VaultSecret -LogicalPath 'auth/jwt' -Data @{
    bcrypt_salt_rounds = 10
    cookie_secure = $false
    jwt_expires_in = '15m'
    jwt_refresh_expires_in = '7d'
    jwt_refresh_secret = $JwtRefreshSecret
    jwt_secret = $JwtSecret
  }
  Write-VaultSecret -LogicalPath 'email/ses' -Data @{
    aws_access_key = $EmailAccessKey
    aws_secret_key = $EmailSecretKey
    aws_region = 'us-east-2'
  }

  $apiRoleId = Invoke-VaultRootCommand `
    -Step 'vault-read-api-role-id' `
    -Arguments @('read', '-field=role_id', 'auth/approle/role/balanz-phase0-api/role-id')
  $apiSecretId = Invoke-VaultRootCommand `
    -Step 'vault-issue-api-secret-id' `
    -Arguments @('write', '-f', '-field=secret_id', 'auth/approle/role/balanz-phase0-api/secret-id')
  $workerRoleId = Invoke-VaultRootCommand `
    -Step 'vault-read-worker-role-id' `
    -Arguments @('read', '-field=role_id', 'auth/approle/role/balanz-phase0-worker/role-id')
  $workerSecretId = Invoke-VaultRootCommand `
    -Step 'vault-issue-worker-secret-id' `
    -Arguments @('write', '-f', '-field=secret_id', 'auth/approle/role/balanz-phase0-worker/secret-id')
  foreach ($value in @($apiRoleId, $apiSecretId, $workerRoleId, $workerSecretId)) {
    if (-not $value) {
      throw 'Vault returned an empty AppRole credential'
    }
    Add-SecretValue -Value $value
  }
  if ($apiRoleId -eq $workerRoleId -or $apiSecretId -eq $workerSecretId) {
    throw 'API and worker AppRole credentials must be distinct'
  }

  return [ordered]@{
    ApiRoleId = $apiRoleId
    ApiSecretId = $apiSecretId
    WorkerRoleId = $workerRoleId
    WorkerSecretId = $workerSecretId
  }
}

function Assert-RuntimeEnvironmentRouting {
  param(
    [Parameter(Mandatory = $true)][string]$ApiRoleId,
    [Parameter(Mandatory = $true)][string]$WorkerRoleId
  )

  $apiContainerId = Get-ComposeContainerId -Service 'api'
  $workerContainerId = Get-ComposeContainerId -Service 'worker'
  $apiRaw = Invoke-CapturedExternal `
    -Step 'inspect-api-environment' `
    -FilePath 'docker' `
    -Arguments @(
      'inspect',
      '--format',
      '{{range .Config.Env}}{{println .}}{{end}}',
      $apiContainerId
    )
  $workerRaw = Invoke-CapturedExternal `
    -Step 'inspect-worker-environment' `
    -FilePath 'docker' `
    -Arguments @(
      'inspect',
      '--format',
      '{{range .Config.Env}}{{println .}}{{end}}',
      $workerContainerId
    )
  $apiEnvironment = @{}
  foreach ($entry in @($apiRaw -split '\r?\n' | Where-Object { $_ })) {
    $parts = [string]$entry -split '=', 2
    $apiEnvironment[$parts[0]] = if ($parts.Count -eq 2) { $parts[1] } else { '' }
  }
  $workerEnvironment = @{}
  foreach ($entry in @($workerRaw -split '\r?\n' | Where-Object { $_ })) {
    $parts = [string]$entry -split '=', 2
    $workerEnvironment[$parts[0]] = if ($parts.Count -eq 2) { $parts[1] } else { '' }
  }

  foreach ($required in @('VAULT_ROLE_ID', 'VAULT_SECRET_ID', 'APP_PORT')) {
    if (-not $apiEnvironment.ContainsKey($required)) {
      throw "API runtime is missing required environment key $required"
    }
  }
  foreach ($forbidden in @('DB_USERNAME', 'DB_PASSWORD', 'DB_WORKER_USERNAME', 'DB_WORKER_PASSWORD')) {
    if ($apiEnvironment.ContainsKey($forbidden)) {
      throw "API runtime received forbidden environment key $forbidden"
    }
  }
  if ($apiEnvironment.ContainsKey('APP_GLOBAL_PREFIX')) {
    throw 'API profile-only configuration bypassed the native .env.api route'
  }
  foreach ($required in @('VAULT_ROLE_ID', 'VAULT_SECRET_ID')) {
    if (-not $workerEnvironment.ContainsKey($required)) {
      throw "Worker runtime is missing required environment key $required"
    }
  }
  foreach ($forbidden in @(
    'APP_PORT',
    'WORKER_HEALTH_PORT',
    'DB_USERNAME',
    'DB_PASSWORD',
    'DB_API_USERNAME',
    'DB_API_PASSWORD',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY'
  )) {
    if ($workerEnvironment.ContainsKey($forbidden)) {
      throw "Worker runtime received forbidden environment key $forbidden"
    }
  }
  if (
    $apiEnvironment.VAULT_ROLE_ID -cne $ApiRoleId -or
    $workerEnvironment.VAULT_ROLE_ID -cne $WorkerRoleId -or
    $apiEnvironment.VAULT_ROLE_ID -ceq $workerEnvironment.VAULT_ROLE_ID
  ) {
    throw 'API and worker AppRole environment routing is invalid'
  }

  $apiCommand = Invoke-CapturedExternal `
    -Step 'inspect-api-entrypoint' `
    -FilePath 'docker' `
    -Arguments @('inspect', '--format', '{{json .Config.Cmd}}', $apiContainerId)
  $workerCommand = Invoke-CapturedExternal `
    -Step 'inspect-worker-entrypoint' `
    -FilePath 'docker' `
    -Arguments @('inspect', '--format', '{{json .Config.Cmd}}', $workerContainerId)
  if ($apiCommand -ne '["node","dist/main.js"]') {
    throw 'The API container is not running the real dist/main.js entrypoint'
  }
  if ($workerCommand -ne '["node","dist/worker.js"]') {
    throw 'The worker container is not running the real dist/worker.js entrypoint'
  }
}

function Get-ComposeNetworkId {
  param([ValidateSet('default', 'redis_wakeup')][string]$NetworkKey)

  $networkId = Invoke-CapturedExternal `
    -Step "locate-$NetworkKey-network" `
    -FilePath 'docker' `
    -Arguments @(
      'network',
      'ls',
      '-q',
      '--filter',
      "label=com.docker.compose.project=$ProjectName",
      '--filter',
      "label=com.docker.compose.network=$NetworkKey"
    )
  if (-not $networkId -or $networkId -match '\r?\n') {
    throw "Expected exactly one $NetworkKey network for the validation project"
  }
  $fullId = Invoke-CapturedExternal `
    -Step "inspect-$NetworkKey-network-id" `
    -FilePath 'docker' `
    -Arguments @('network', 'inspect', '--format', '{{.Id}}', $networkId)
  return $fullId
}

function Get-ComposeNetworkState {
  param(
    [ValidateSet('api', 'worker', 'redis', 'clamav')][string]$Service,
    [Parameter(Mandatory = $true)][string]$NetworkId,
    [ValidateRange(1, 2)][int]$ExpectedNetworkCount
  )

  $containerId = Get-ComposeContainerId -Service $Service
  $networkJson = Invoke-CapturedExternal `
    -Step "inspect-$Service-network" `
    -FilePath 'docker' `
    -Arguments @(
      'inspect',
      '--format',
      '{{json .NetworkSettings.Networks}}',
      $containerId
    )
  $networks = ConvertFrom-Json -InputObject $networkJson
  $properties = @($networks.PSObject.Properties)
  if ($properties.Count -ne $ExpectedNetworkCount) {
    throw "$Service has an unexpected number of Compose network attachments"
  }
  $matches = @(
    $properties | Where-Object {
      [string]$_.Value.NetworkID -ceq $NetworkId
    }
  )
  if ($matches.Count -ne 1) {
    throw "$Service is missing an exact expected Compose network attachment"
  }
  $network = $matches[0].Value
  $address = [string]$network.IPAddress
  $parsedAddress = $null
  if (-not [Net.IPAddress]::TryParse($address, [ref]$parsedAddress)) {
    throw "$Service does not have a valid isolated network address"
  }
  return [pscustomobject]@{
    Service = $Service
    Address = $address
    Aliases = @($network.Aliases | ForEach-Object { [string]$_ })
  }
}

function Assert-NetworkStateGroup {
  param([Parameter(Mandatory = $true)][object[]]$States)

  $addresses = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::Ordinal
  )
  foreach ($state in $States) {
    if (-not $addresses.Add($state.Address)) {
      throw 'Runtime services must have unique addresses within each isolated Compose network'
    }
    $aliases = [Collections.Generic.HashSet[string]]::new(
      [StringComparer]::Ordinal
    )
    foreach ($alias in $state.Aliases) {
      $null = $aliases.Add([string]$alias)
    }
    if (-not $aliases.Contains($state.Service)) {
      throw "$($state.Service) is missing its exact Compose DNS alias"
    }
  }
}

function Assert-RuntimeNetworkRouting {
  param([switch]$RedisStopped)

  $defaultNetworkId = Get-ComposeNetworkId -NetworkKey 'default'
  $wakeupNetworkId = Get-ComposeNetworkId -NetworkKey 'redis_wakeup'
  $defaultStates = @(
    Get-ComposeNetworkState `
      -Service 'api' `
      -NetworkId $defaultNetworkId `
      -ExpectedNetworkCount 2
    Get-ComposeNetworkState `
      -Service 'worker' `
      -NetworkId $defaultNetworkId `
      -ExpectedNetworkCount 2
    Get-ComposeNetworkState `
      -Service 'clamav' `
      -NetworkId $defaultNetworkId `
      -ExpectedNetworkCount 1
  )
  $wakeupStates = @(
    Get-ComposeNetworkState `
      -Service 'api' `
      -NetworkId $wakeupNetworkId `
      -ExpectedNetworkCount 2
    Get-ComposeNetworkState `
      -Service 'worker' `
      -NetworkId $wakeupNetworkId `
      -ExpectedNetworkCount 2
  )
  if (-not $RedisStopped) {
    $wakeupStates += Get-ComposeNetworkState `
      -Service 'redis' `
      -NetworkId $wakeupNetworkId `
      -ExpectedNetworkCount 1
  }
  Assert-NetworkStateGroup -States $defaultStates
  Assert-NetworkStateGroup -States $wakeupStates
  [Console]::Error.WriteLine(
    "SANITIZED_RUNTIME_NETWORK: dependencyServices=$($defaultStates.Count) wakeupServices=$($wakeupStates.Count) topologyExact=true addressesUniquePerNetwork=true aliasesExact=true redisStopped=$([bool]$RedisStopped)"
  )
  $clamavState = $defaultStates | Where-Object { $_.Service -ceq 'clamav' }
  return [string]$clamavState.Address
}

function Write-StoppedRedisNetworkMetadata {
  $containerId = Get-ComposeContainerId -Service 'redis' -IncludeStopped
  $networkJson = Invoke-CapturedExternal `
    -Step 'inspect-stopped-redis-network' `
    -FilePath 'docker' `
    -Arguments @(
      'inspect',
      '--format',
      '{{json .NetworkSettings.Networks}}',
      $containerId
    )
  $networks = ConvertFrom-Json -InputObject $networkJson
  $addressMetadataPresent = $false
  foreach ($property in @($networks.PSObject.Properties)) {
    if ([string]$property.Value.IPAddress) {
      $addressMetadataPresent = $true
    }
  }
  [Console]::Error.WriteLine(
    "SANITIZED_STOPPED_REDIS_NETWORK: addressMetadataPresent=$addressMetadataPresent authoritative=false"
  )
}

function Assert-ClamAvTcpFromRuntime {
  param(
    [ValidateSet('api', 'worker')][string]$Service,
    [Parameter(Mandatory = $true)][string]$ExpectedAddress
  )

  $containerId = Get-ComposeContainerId -Service $Service
  $program = @'
const dns = require('node:dns').promises;
const net = require('node:net');
const expectedAddress = process.argv[1];
(async () => {
  const startedAt = Date.now();
  let dnsMatches = false;
  let connected = false;
  let pong = false;
  try {
    const resolved = await dns.lookup('clamav', { family: 4 });
    dnsMatches = resolved.address === expectedAddress;
    const result = await new Promise((resolve) => {
      const socket = net.createConnection({ host: 'clamav', port: 3310 });
      const chunks = [];
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(3000, () => finish(false));
      socket.once('connect', () => {
        connected = true;
        socket.write(Buffer.from('zPING\0', 'ascii'));
      });
      socket.on('data', (chunk) => {
        chunks.push(chunk);
        const response = Buffer.concat(chunks);
        const terminator = response.indexOf(0);
        if (terminator >= 0) {
          finish(response.subarray(0, terminator).toString('ascii').trim() === 'PONG');
        }
      });
      socket.once('error', () => finish(false));
      socket.once('close', () => finish(false));
    });
    pong = result === true;
  } catch {}
  process.stdout.write(JSON.stringify({
    dnsMatches,
    connected,
    pong,
    durationMs: Date.now() - startedAt,
  }));
})().catch(() => process.stdout.write(JSON.stringify({
  dnsMatches: false,
  connected: false,
  pong: false,
  durationMs: null,
})));
'@
  $evidence = $null
  $valid = $false
  $attempt = 0
  for ($attempt = 1; $attempt -le 15; $attempt += 1) {
    $result = Invoke-CapturedExternal `
      -Step "$Service-clamav-tcp-probe" `
      -FilePath 'docker' `
      -Arguments @(
        'exec',
        $containerId,
        'node',
        '-e',
        $program,
        $ExpectedAddress
      )
    $evidence = ConvertFrom-Json -InputObject $result
    $valid =
      $evidence.dnsMatches -eq $true -and
      $evidence.connected -eq $true -and
      $evidence.pong -eq $true
    if ($valid) {
      break
    }
    Start-Sleep -Milliseconds 500
  }
  [Console]::Error.WriteLine(
    "SANITIZED_CLAMAV_TCP: $([ordered]@{ service = $Service; attempt = [math]::Min($attempt, 15); dnsMatches = [bool]$evidence.dnsMatches; connected = [bool]$evidence.connected; pong = [bool]$evidence.pong; durationMs = $evidence.durationMs } | ConvertTo-Json -Compress)"
  )
  if (-not $valid) {
    throw "$Service could not reach the validated ClamAV TCP listener"
  }
}

function Assert-RuntimeMountRouting {
  param(
    [ValidateSet('api', 'worker')][string]$Service,
    [Parameter(Mandatory = $true)][string]$ProfileEnvFile
  )

  $containerId = Get-ComposeContainerId -Service $Service
  $mountJson = Invoke-CapturedExternal `
    -Step "inspect-$Service-mounts" `
    -FilePath 'docker' `
    -Arguments @('inspect', '--format', '{{json .Mounts}}', $containerId)
  $mounts = ConvertFrom-Json -InputObject $mountJson
  if (
    @($mounts | Where-Object {
      [string]$_.Destination -ceq '/workspace'
    }).Count -gt 0
  ) {
    throw "$Service must not receive a writable or monolithic workspace mount"
  }

  $expectedReadOnly = @(
    [pscustomobject]@{
      Destination = '/workspace/node_modules'
      Source = Join-Path $workspace 'node_modules'
    },
    [pscustomobject]@{
      Destination = '/workspace/apps/api/dist'
      Source = Join-Path $workspace 'apps/api/dist'
    },
    [pscustomobject]@{
      Destination = '/workspace/apps/api/src'
      Source = Join-Path $workspace 'apps/api/src'
    },
    [pscustomobject]@{
      Destination = '/workspace/apps/api/test'
      Source = Join-Path $workspace 'apps/api/test'
    },
    [pscustomobject]@{
      Destination = '/workspace/apps/api/tsconfig.json'
      Source = Join-Path $workspace 'apps/api/tsconfig.json'
    },
    [pscustomobject]@{
      Destination = '/workspace/apps/api/package.json'
      Source = Join-Path $workspace 'apps/api/package.json'
    },
    [pscustomobject]@{
      Destination = "/workspace/apps/api/.env.$Service"
      Source = $ProfileEnvFile
    },
    [pscustomobject]@{
      Destination = '/vault-ca/vault-ca.pem'
      Source = Join-Path $vaultTlsRoot 'vault-ca.pem'
    }
  )
  foreach ($expected in $expectedReadOnly) {
    $destination = $expected.Destination
    $source = $expected.Source
    $matches = @($mounts | Where-Object {
      [string]$_.Destination -ceq $destination
    })
    if (
      $matches.Count -ne 1 -or
      [string]$matches[0].Type -cne 'bind' -or
      [bool]$matches[0].RW -or
      -not (Test-DockerBindSourceEqual `
        -Actual ([string]$matches[0].Source) `
        -Expected $source)
    ) {
      throw "$Service runtime mount $destination is not the expected read-only bind"
    }
  }

  $storageMounts = @(
    $mounts | Where-Object {
      [string]$_.Destination -ceq '/var/lib/balanz/object-storage'
    }
  )
  if (
    $storageMounts.Count -ne 1 -or
    [string]$storageMounts[0].Type -cne 'volume' -or
    -not [bool]$storageMounts[0].RW
  ) {
    throw "$Service must receive exactly one writable private object-storage volume"
  }
  $unexpectedWritable = @(
    $mounts | Where-Object {
      [bool]$_.RW -and
      [string]$_.Destination -cne '/var/lib/balanz/object-storage'
    }
  )
  if ($unexpectedWritable.Count -gt 0) {
    throw "$Service received an unexpected writable mount"
  }
  $allowedDestinations = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::Ordinal
  )
  foreach ($expected in $expectedReadOnly) {
    $null = $allowedDestinations.Add([string]$expected.Destination)
  }
  $null = $allowedDestinations.Add('/var/lib/balanz/object-storage')
  $unexpectedMounts = @(
    $mounts | Where-Object {
      -not $allowedDestinations.Contains([string]$_.Destination)
    }
  )
  if (
    @($mounts).Count -ne $allowedDestinations.Count -or
    $unexpectedMounts.Count -gt 0
  ) {
    throw "$Service must receive exactly the allowlisted eight read-only binds and one storage volume"
  }
}

function Invoke-ContainerHealthProbe {
  param(
    [Parameter(Mandatory = $true)][string]$Service,
    [ValidateSet('liveness', 'readiness')][string]$Endpoint,
    [ValidateSet('api', 'worker')][string]$ExpectedProcess,
    [Parameter(Mandatory = $true)][int]$InternalPort
  )

  $containerId = Get-ComposeContainerId -Service $Service
  $nodeProgram = @'
const [url, expectedProcess] = process.argv.slice(1);
fetch(url).then(async (response) => {
  const body = await response.json();
  const valid = response.ok && body && body.process === expectedProcess && body.status === 'up';
  if (!valid) process.exit(2);
}).catch(() => process.exit(3));
'@
  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $null = & docker exec $containerId node -e $nodeProgram `
        "http://127.0.0.1:$InternalPort/$Endpoint" `
        $ExpectedProcess 2>&1
      $probeExitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousPreference
    }
    if ($probeExitCode -eq 0) {
      return
    }
    Start-Sleep -Milliseconds 500
  }
  throw "$Service $Endpoint did not report status=up for process=$ExpectedProcess"
}

function Assert-NoSecretsInComposeLogs {
  $logText = Invoke-CapturedExternal `
    -Step 'capture-runtime-logs-for-secret-scan' `
    -FilePath 'docker' `
    -Arguments (@('compose') + $script:composeArguments + @(
      'logs',
      '--no-color',
      'postgres',
      'redis',
      'minio',
      'clamav',
      'api',
      'worker'
    ))
  foreach ($secret in $script:secretValues) {
    if ($logText.IndexOf($secret, [StringComparison]::Ordinal) -ge 0) {
      throw 'A disposable credential was detected in Compose logs'
    }
  }
}

function Write-SanitizedRuntimeStartupDiagnostic {
  $stateParts = [Collections.Generic.List[string]]::new()
  foreach ($service in @('api', 'worker')) {
    try {
      $containerId = Invoke-CapturedExternal `
        -Step "diagnose-$service-container" `
        -FilePath 'docker' `
        -Arguments @(
          'ps', '-aq',
          '--filter', "label=com.docker.compose.project=$ProjectName",
          '--filter', "label=com.docker.compose.service=$service"
        )
      if (-not $containerId -or $containerId -match '\r?\n') {
        $stateParts.Add("$service=missing")
        continue
      }
      $stateJson = Invoke-CapturedExternal `
        -Step "diagnose-$service-state" `
        -FilePath 'docker' `
        -Arguments @(
          'inspect',
          '--format',
          '{{json .State}}',
          $containerId
        )
      $state = $stateJson | ConvertFrom-Json
      $hasHealth = $state.PSObject.Properties.Name -contains 'Health'
      $health = if ($hasHealth -and $state.Health) {
        [string]$state.Health.Status
      } else {
        'none'
      }
      $stateParts.Add(
        "$service=$($state.Status)/health=$health/exit=$($state.ExitCode)/oom=$($state.OOMKilled)"
      )
    } catch {
      $stateParts.Add("$service=diagnostic-unavailable")
    }
  }
  [Console]::Error.WriteLine(
    "SANITIZED_RUNTIME_STARTUP_STATE: $($stateParts -join '; ')"
  )

  try {
    $logText = Invoke-CapturedExternal `
      -Step 'diagnose-runtime-startup-logs' `
      -FilePath 'docker' `
      -Arguments (@('compose') + $script:composeArguments + @(
        'logs',
        '--no-color',
        '--tail',
        '160',
        'api',
        'worker'
      ))
    $secretLeak = $false
    foreach ($secret in $script:secretValues) {
      if ($logText.IndexOf($secret, [StringComparison]::Ordinal) -ge 0) {
        $secretLeak = $true
        $logText = $logText.Replace($secret, '[REDACTED]')
      }
    }
    $safeText = $logText.Replace($workspace, '<workspace>')
    $safeText = [regex]::Replace(
      $safeText,
      '(?i)(password|secret(?:_id)?|token|authorization|access[_-]?key)(\s*[:=]\s*)[^\s,;]+',
      '$1$2[REDACTED]'
    )
    $safeText = [regex]::Replace(
      $safeText,
      '\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b',
      '[REDACTED_JWT]'
    )
    $safeText = [regex]::Replace(
      $safeText,
      '\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b',
      '<uuid>'
    )
    $safeLines = @(
      $safeText -split '\r?\n' |
        Where-Object {
          $_ -match '(?i)\b(error|fatal|exception|fail(?:ed|ure)?|invalid|required|denied|unsafe|ECONN|timeout|not found|cannot)\b'
        } |
        Select-Object -Last 16
    )
    if ($safeLines.Count -eq 0) {
      $safeLines = @($safeText -split '\r?\n' | Select-Object -Last 8)
    }
    if ($secretLeak) {
      [Console]::Error.WriteLine(
        'SANITIZED_RUNTIME_STARTUP_LOGS: credential material was detected and redacted'
      )
    }
    foreach ($line in $safeLines) {
      if ($line.Length -gt 500) {
        $line = $line.Substring(0, 500) + '...'
      }
      [Console]::Error.WriteLine("SANITIZED_RUNTIME_STARTUP_LOG: $line")
    }
  } catch {
    [Console]::Error.WriteLine(
      'SANITIZED_RUNTIME_STARTUP_LOGS: diagnostic unavailable'
    )
  }
}

function Stop-And-AssertRuntimeShutdown {
  $apiContainerId = Get-ComposeContainerId -Service 'api'
  $workerContainerId = Get-ComposeContainerId -Service 'worker'
  $shutdownStartedAt = [DateTime]::UtcNow
  Invoke-CheckedCommand -Step 'runtime-sigterm-stop' -Command {
    docker compose @composeArguments stop --timeout 15 api worker
  }
  $elapsed = ([DateTime]::UtcNow - $shutdownStartedAt).TotalSeconds
  if ($elapsed -gt 30) {
    throw 'API/worker shutdown exceeded the bounded grace period'
  }
  foreach ($container in @(
    @{ Name = 'api'; Id = $apiContainerId },
    @{ Name = 'worker'; Id = $workerContainerId }
  )) {
    $stateJson = Invoke-CapturedExternal `
      -Step "inspect-$($container.Name)-shutdown" `
      -FilePath 'docker' `
      -Arguments @('inspect', '--format', '{{json .State}}', $container.Id)
    $state = $stateJson | ConvertFrom-Json
    $restartPolicy = Invoke-CapturedExternal `
      -Step "inspect-$($container.Name)-restart-policy" `
      -FilePath 'docker' `
      -Arguments @(
        'inspect',
        '--format',
        '{{.HostConfig.RestartPolicy.Name}}',
        $container.Id
      )
    $restartCount = Invoke-CapturedExternal `
      -Step "inspect-$($container.Name)-restart-count" `
      -FilePath 'docker' `
      -Arguments @(
        'inspect',
        '--format',
        '{{.RestartCount}}',
        $container.Id
      )
    $shutdownEvidence = [ordered]@{
      service = $container.Name
      running = [bool]$state.Running
      exitCode = [int]$state.ExitCode
      oomKilled = [bool]$state.OOMKilled
      restartCount = [int]$restartCount
      restartPolicy = [string]$restartPolicy
      elapsedSeconds = [math]::Round($elapsed, 3)
    }
    [Console]::Error.WriteLine(
      "SANITIZED_RUNTIME_SHUTDOWN: $($shutdownEvidence | ConvertTo-Json -Compress)"
    )
    $script:currentStep = "assert-$($container.Name)-clean-shutdown"
    # Nest completes its shutdown hooks and deliberately re-emits SIGTERM.
    # Docker therefore records either 0 (explicit exit) or 128 + SIGTERM (143).
    # Exit 137 remains a hard failure because it indicates the grace period
    # expired and Docker escalated to SIGKILL.
    $acceptedExitCode = $shutdownEvidence.exitCode -in @(0, 143)
    if (
      $shutdownEvidence.running -or
      -not $acceptedExitCode -or
      $shutdownEvidence.oomKilled -or
      $shutdownEvidence.restartCount -ne 0 -or
      $shutdownEvidence.restartPolicy -cne 'no'
    ) {
      throw "$($container.Name) did not complete a clean, non-restarting SIGTERM shutdown"
    }
  }
}

function Initialize-PrivateStorageRoot {
  param([Parameter(Mandatory = $true)][string]$RequestedRoot)

  $target = Initialize-SafeDirectory `
    -Path $RequestedRoot `
    -AllowedBase $storageBase `
    -RequireProjectLeaf
  $unexpected = Get-ChildItem -LiteralPath $target -Force | Select-Object -First 1
  if ($unexpected) {
    throw 'Refusing to reuse a non-empty local-storage validation root'
  }
  if ($isWindowsHost) {
    $script:currentStep = 'prepare-local-storage-ntfs'
    $null = & $prepareStorageScript -Root $target
    if (-not $?) {
      throw 'The NTFS local-storage preflight failed'
    }
    $script:currentStep = 'verify-local-storage-ntfs'
    Assert-NoReparseTree -Root $target
    return $target
  }

  $markerPath = Join-Path $target '.balanz-fiscal-object-storage-root-v1'
  [IO.File]::WriteAllText(
    $markerPath,
    "balanz-fiscal-object-storage-v1`n",
    [Text.UTF8Encoding]::new($false)
  )
  & chmod 700 $target
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not apply mode 0700 to the local-storage validation root'
  }
  & chmod 600 $markerPath
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not apply mode 0600 to the local-storage marker'
  }
  Assert-NoReparseTree -Root $target
  return $target
}

function Write-SanitizedReport {
  Assert-NoReparseAncestor -Path $reportBase
  if (-not (Test-Path -LiteralPath $reportBase)) {
    [IO.Directory]::CreateDirectory($reportBase) | Out-Null
  }
  Assert-NoReparseAncestor -Path $reportTarget
  if (-not (Test-PathWithin -Path $reportTarget -Root $reportBase)) {
    throw 'The report must stay under the fixed validation report root'
  }
  if (-not ([IO.Path]::GetFileNameWithoutExtension($reportTarget).Equals(
    $ProjectName,
    $pathComparison
  ))) {
    throw 'The report filename must equal ProjectName'
  }
  $reportJson = $summary | ConvertTo-Json -Depth 5
  foreach ($secret in $secretValues) {
    if ($reportJson.IndexOf($secret, [StringComparison]::Ordinal) -ge 0) {
      throw 'Refusing to write a report containing a disposable credential'
    }
  }
  $encoding = [Text.UTF8Encoding]::new($false)
  $bytes = $encoding.GetBytes($reportJson + [Environment]::NewLine)
  $stream = [IO.FileStream]::new(
    $reportTarget,
    [IO.FileMode]::CreateNew,
    [IO.FileAccess]::Write,
    [IO.FileShare]::None
  )
  try {
    $stream.Write($bytes, 0, $bytes.Length)
  } finally {
    $stream.Dispose()
  }
}

function Invoke-QualityGates {
  Invoke-CheckedCommand -Step 'quality-api-lint' -Command {
    Push-Location -LiteralPath (Join-Path $workspace 'apps/api')
    try {
      npm exec -- eslint 'src/**/*.ts' 'test/**/*.ts'
    } finally {
      Pop-Location
    }
  }
  $summary.qualityGates.apiLint = 'PASS'
  Invoke-CheckedCommand -Step 'quality-api-typecheck' -Command {
    Push-Location -LiteralPath (Join-Path $workspace 'apps/api')
    try {
      npm exec -- tsc --noEmit
    } finally {
      Pop-Location
    }
  }
  $summary.qualityGates.apiTypecheck = 'PASS'
  Invoke-CheckedCommand -Step 'quality-api-jest' -Command {
    npm --prefix apps/api test -- --runInBand
  }
  $summary.qualityGates.apiJest = 'PASS'
  Invoke-CheckedCommand -Step 'quality-api-build' -Command {
    npm --prefix apps/api run build
  }
  $summary.qualityGates.apiBuild = 'PASS'
  Invoke-CheckedCommand -Step 'quality-web-lint' -Command {
    npm --prefix apps/web run lint
  }
  $summary.qualityGates.webLint = 'PASS'
  Invoke-CheckedCommand -Step 'quality-web-typecheck' -Command {
    npm --prefix apps/web run typecheck
  }
  $summary.qualityGates.webTypecheck = 'PASS'
  Invoke-CheckedCommand -Step 'quality-web-tests' -Command {
    npm --prefix apps/web test
  }
  $summary.qualityGates.webTests = 'PASS'
  Invoke-CheckedCommand -Step 'quality-web-build' -Command {
    Set-TrackedEnvironment -Name 'NODE_ENV' -Value 'production'
    try {
      npm --prefix apps/web run build
    } finally {
      Set-TrackedEnvironment -Name 'NODE_ENV' -Value 'test'
    }
  }
  $summary.qualityGates.webBuild = 'PASS'
}

try {
  if (-not (Test-Path -LiteralPath $composeFile -PathType Leaf)) {
    throw 'The Phase 0 Compose manifest was not found'
  }
  if (-not (Test-Path -LiteralPath $prepareStorageScript -PathType Leaf)) {
    throw 'The local-storage preparation script was not found'
  }
  Assert-NoReparseAncestor -Path $workspace
  Assert-NoReparseAncestor -Path $composeFile
  Assert-NoReparseAncestor -Path $prepareStorageScript

  $requestedStorageRoot = if ($StorageRoot) {
    if ([IO.Path]::IsPathRooted($StorageRoot)) {
      [IO.Path]::GetFullPath($StorageRoot)
    } else {
      [IO.Path]::GetFullPath((Join-Path $workspace $StorageRoot))
    }
  } else {
    [IO.Path]::GetFullPath((Join-Path $storageBase $ProjectName))
  }
  if (
    -not (Test-PathWithin -Path $requestedStorageRoot -Root $storageBase) -or
    -not ([IO.Path]::GetFileName($requestedStorageRoot).Equals(
      $ProjectName,
      $pathComparison
    ))
  ) {
    throw 'StorageRoot must be the ProjectName leaf under the fixed storage validation root'
  }
  Assert-NoReparseAncestor -Path $requestedStorageRoot
  Assert-NoReparseAncestor -Path $vaultTlsRoot
  Assert-NoReparseAncestor -Path $runtimeEnvRoot
  Assert-NoReparseAncestor -Path $reportTarget
  if (Test-Path -LiteralPath $reportTarget) {
    throw 'Refusing to overwrite an existing validation report'
  }

  $ports = [ordered]@{
    POSTGRES_PORT = $PostgresPort
    REDIS_PORT = $RedisPort
    MINIO_API_PORT = $MinioApiPort
    MINIO_CONSOLE_PORT = $MinioConsolePort
    CLAMAV_PORT = $ClamAvPort
    VAULT_PORT = $VaultPort
    API_PORT = $ApiPort
    WORKER_HEALTH_PORT = $WorkerHealthPort
    REDIS_OFFLINE_PORT = 0
    CLAMAV_OFFLINE_PORT = 0
  }
  $dynamicPortCount = @($ports.Values | Where-Object { $_ -eq 0 }).Count
  $dynamicPorts = @(Get-DynamicTcpPorts -Count $dynamicPortCount)
  $dynamicIndex = 0
  foreach ($key in @($ports.Keys)) {
    if ($ports[$key] -eq 0) {
      $ports[$key] = $dynamicPorts[$dynamicIndex]
      $dynamicIndex += 1
    }
  }
  if (@($ports.Values | Sort-Object -Unique).Count -ne $ports.Count) {
    throw 'Every validation endpoint must use a distinct loopback port'
  }

  $postgresPassword = New-RandomBase64Secret
  $apiDatabasePassword = New-RandomBase64Secret
  $workerDatabasePassword = New-RandomBase64Secret
  $minioRootPassword = New-RandomBase64Secret
  $minioAppPassword = New-RandomBase64Secret
  $minioKmsKey = 'balanz-phase0:' + (New-RandomBase64Secret)
  $vaultRootToken = New-RandomBase64Secret
  $jwtSecret = New-RandomBase64Secret
  $jwtRefreshSecret = New-RandomBase64Secret
  $negativeMigratorPassword = New-RandomBase64Secret
  $emailAccessStem = (New-RandomBase64Secret) -replace '[^A-Za-z0-9]', ''
  $emailAccessKey = 'AKIA' + $emailAccessStem.Substring(0, 16).ToUpperInvariant()
  $emailSecretKey = New-RandomBase64Secret
  foreach ($secret in @(
    $postgresPassword,
    $apiDatabasePassword,
    $workerDatabasePassword,
    $minioRootPassword,
    $minioAppPassword,
    $minioKmsKey,
    $vaultRootToken,
    $jwtSecret,
    $jwtRefreshSecret,
    $negativeMigratorPassword,
    $emailAccessKey,
    $emailSecretKey
  )) {
    Add-SecretValue -Value $secret
  }
  $uniqueDisposableCredentials = @(
    $postgresPassword,
    $apiDatabasePassword,
    $workerDatabasePassword,
    $minioRootPassword,
    $minioAppPassword,
    $vaultRootToken,
    $jwtSecret,
    $jwtRefreshSecret,
    $negativeMigratorPassword,
    $emailSecretKey
  ) | Sort-Object -Unique
  if (@($uniqueDisposableCredentials).Count -ne 10) {
    throw 'Disposable credentials unexpectedly collided'
  }

  $effectiveStorageRoot = $requestedStorageRoot

  $settings = [ordered]@{
    NODE_ENV = 'test'
    SECRETS_ENABLED = 'false'
    DB_HOST = '127.0.0.1'
    DB_PORT = [string]$ports.POSTGRES_PORT
    DB_USERNAME = $databaseUser
    DB_PASSWORD = $postgresPassword
    DB_DATABASE = $databaseName
    DB_API_USERNAME = $apiDatabaseUser
    DB_API_PASSWORD = $apiDatabasePassword
    DB_WORKER_USERNAME = $workerDatabaseUser
    DB_WORKER_PASSWORD = $workerDatabasePassword
    JWT_SECRET = $jwtSecret
    JWT_REFRESH_SECRET = $jwtRefreshSecret
    BCRYPT_SALT_ROUNDS = '10'
    POSTGRES_DB = $databaseName
    POSTGRES_USER = $databaseUser
    POSTGRES_PASSWORD = $postgresPassword
    POSTGRES_PORT = [string]$ports.POSTGRES_PORT
    REDIS_ENABLED = 'true'
    REDIS_HOST = '127.0.0.1'
    REDIS_PORT = [string]$ports.REDIS_PORT
    REDIS_URL = "redis://127.0.0.1:$($ports.REDIS_PORT)"
    REDIS_OFFLINE_PORT = [string]$ports.REDIS_OFFLINE_PORT
    REDIS_WAKEUP_PREFIX = "balanz:cfdi:p0:$ProjectName"
    MINIO_ROOT_USER = $minioRootUser
    MINIO_ROOT_PASSWORD = $minioRootPassword
    MINIO_KMS_SECRET_KEY = $minioKmsKey
    MINIO_APP_USER = $minioAppUser
    MINIO_APP_PASSWORD = $minioAppPassword
    CFDI_MINIO_IMAGE = $minioValidationImage
    MINIO_API_PORT = [string]$ports.MINIO_API_PORT
    MINIO_CONSOLE_PORT = [string]$ports.MINIO_CONSOLE_PORT
    S3_ENDPOINT = "http://127.0.0.1:$($ports.MINIO_API_PORT)"
    S3_REGION = 'us-east-1'
    S3_BUCKET = $minioBucket
    S3_ACCESS_KEY_ID = $minioAppUser
    S3_SECRET_ACCESS_KEY = $minioAppPassword
    S3_SSE_MODE = 'AES256'
    S3_ALLOW_INSECURE = 'true'
    S3_FORCE_PATH_STYLE = 'true'
    CLAMAV_HOST = '127.0.0.1'
    CLAMAV_PORT = [string]$ports.CLAMAV_PORT
    CLAMAV_OFFLINE_PORT = [string]$ports.CLAMAV_OFFLINE_PORT
    # Only the disposable digest-pinned validation project disables the
    # long-running updater daemon. Persistent development stacks keep updates.
    CLAMAV_NO_FRESHCLAMD = 'true'
    OBJECT_STORAGE_LOCAL_ROOT = $effectiveStorageRoot
    OBJECT_STORAGE_LOCAL_WINDOWS_PRESECURED = if ($isWindowsHost) { 'true' } else { 'false' }
    CFDI_PHASE0_TEST_DATABASE = $databaseName
    CFDI_PHASE0_USE_TEST_DATABASE = 'true'
    CFDI_PROVISION_RUNTIME_LOGINS = 'false'
    QA_ALLOW_TRANSACTIONAL_MIGRATION_DOWN_UP = 'true'
    QA_ALLOW_FISCAL_RUNTIME_VALIDATION = 'true'
    RUN_LOCAL_STORAGE_INTEGRATION = 'true'
    RUN_MINIO_INTEGRATION = 'true'
    RUN_CLAMAV_INTEGRATION = 'true'
    RUN_REDIS_INTEGRATION = 'true'
    RUN_EPHEMERAL_VAULT_INTEGRATION = 'false'
    VAULT_PORT = [string]$ports.VAULT_PORT
    VAULT_TLS_DIR = $vaultTlsRoot
    API_PORT = [string]$ports.API_PORT
    WORKER_HEALTH_PORT = [string]$ports.WORKER_HEALTH_PORT
    CFDI_WORKSPACE_ROOT = $workspace
    CFDI_VALIDATION_RUN_ID = $ProjectName
    CFDI_DEPLOY_SMOKE_IMAGE = $deploySmokeImage
    RUNTIME_API_ENV_FILE = (Join-Path $runtimeEnvRoot '.env.api')
    RUNTIME_WORKER_ENV_FILE = (Join-Path $runtimeEnvRoot '.env.worker')
  }
  foreach ($entry in $settings.GetEnumerator()) {
    Set-TrackedEnvironment -Name $entry.Key -Value ([string]$entry.Value)
  }

  Set-Location -LiteralPath $workspace
  if ($ValidationMode -eq 'Full') {
    Invoke-QualityGates
  } else {
    foreach ($gate in @($summary.qualityGates.Keys)) {
      $summary.qualityGates[$gate] = 'SKIPPED_FOCAL'
    }
  }

  Assert-ReleaseProcessDefinition
  $summary.releaseProcessDefinition = 'PASS'

  Invoke-CheckedCommand -Step 'docker-engine' -Command {
    docker info --format '{{.ServerVersion}}'
  }
  $summary.docker = 'PASS'
  Invoke-CheckedCommand -Step 'docker-compose' -Command {
    docker compose version --short
  }
  $summary.compose = 'PASS'
  foreach ($kind in @('container', 'volume', 'network')) {
    if (@(Get-ProjectResourceIds -Kind $kind).Count -gt 0) {
      throw "The selected ProjectName already owns Docker $kind resources"
    }
  }
  foreach ($imageTag in @($deploySmokeImage, $minioValidationImage)) {
    if (@(Get-ExactDockerImageIds -ImageTag $imageTag).Count -gt 0) {
      throw 'The selected ProjectName already owns a local validation image'
    }
  }
  $localImageNamespaceOwnedByThisRun = $true

  if (
    (Test-Path -LiteralPath $vaultTlsRoot) -or
    (Test-Path -LiteralPath $runtimeEnvRoot) -or
    (Test-Path -LiteralPath $requestedStorageRoot)
  ) {
    throw 'The selected ProjectName already owns a local validation directory'
  }

  $vaultTlsRootOwnedByThisRun = $true
  $vaultTlsRoot = Initialize-SafeDirectory `
    -Path $vaultTlsRoot `
    -AllowedBase $vaultTlsBase `
    -RequireProjectLeaf
  if (Get-ChildItem -LiteralPath $vaultTlsRoot -Force | Select-Object -First 1) {
    throw 'Refusing to reuse a non-empty Vault TLS validation root'
  }
  $storageRootOwnedByThisRun = $true
  $effectiveStorageRoot = Initialize-PrivateStorageRoot `
    -RequestedRoot $requestedStorageRoot
  $summary.localStorage = 'PASS'

  $currentStep = 'prepare-runtime-profile-files'
  $runtimeEnvRootOwnedByThisRun = $true
  $runtimeEnvRoot = Initialize-SafeDirectory `
    -Path $runtimeEnvRoot `
    -AllowedBase $runtimeEnvBase `
    -RequireProjectLeaf
  $runtimeApiEnvFile = Join-Path $runtimeEnvRoot '.env.api'
  $runtimeWorkerEnvFile = Join-Path $runtimeEnvRoot '.env.worker'
  $utf8NoBom = [Text.UTF8Encoding]::new($false)
  [IO.File]::WriteAllText(
    $runtimeApiEnvFile,
    "BALANZ_RUNTIME_PROFILE=api`nAPP_GLOBAL_PREFIX=api/v1`n",
    $utf8NoBom
  )
  [IO.File]::WriteAllText(
    $runtimeWorkerEnvFile,
    "BALANZ_RUNTIME_PROFILE=worker`nWORKER_HEALTH_PORT=3002`n",
    $utf8NoBom
  )
  if (-not $isWindowsHost) {
    & chmod 600 $runtimeApiEnvFile $runtimeWorkerEnvFile
    if ($LASTEXITCODE -ne 0) {
      throw 'Could not apply private mode to runtime marker env files'
    }
  }
  Assert-NoReparseTree -Root $runtimeEnvRoot

  Set-TrackedEnvironment -Name 'VAULT_DEV_ROOT_TOKEN_ID' -Value $vaultRootToken
  Invoke-CheckedCommand -Step 'compose-config' -Command {
    docker compose @composeArguments config --quiet
  }
  $stackOwnedByThisRun = $true
  if ($ValidationMode -eq 'Full') {
    $null = Invoke-CapturedExternal `
      -Step 'deploy-control-smoke-build' `
      -FilePath 'docker' `
      -Arguments (@('compose') + $composeArguments + @(
        'build',
        'deploy-control-smoke'
      )) `
      -SanitizeFailureOutput
    $deploySmokeImageId = Assert-LocalBuildImageOwnership `
      -ImageTag $deploySmokeImage `
      -Service 'deploy-control-smoke'
    $null = Invoke-CapturedExternal `
      -Step 'deploy-runtime-isolation-smoke' `
      -FilePath 'docker' `
      -Arguments (@('compose') + $composeArguments + @(
        'run',
        '--rm',
        '--no-deps',
        'deploy-control-smoke',
        'bash',
        'scripts/deploy/smoke-runtime-isolation.sh'
      )) `
      -SanitizeFailureOutput
    $summary.deployRuntimeIsolationSmoke = 'PASS'
    $null = Invoke-CapturedExternal `
      -Step 'deploy-rollback-smoke' `
      -FilePath 'docker' `
      -Arguments (@('compose') + $composeArguments + @(
        'run',
        '--rm',
        '--no-deps',
        'deploy-control-smoke',
        'bash',
        'scripts/deploy/smoke-rollback.sh'
      )) `
      -SanitizeFailureOutput
    $summary.deployRollbackSmoke = 'PASS'
    $null = Invoke-CapturedExternal `
      -Step 'deploy-legacy-cutover-smoke' `
      -FilePath 'docker' `
      -Arguments (@('compose') + $composeArguments + @(
        'run',
        '--rm',
        '--no-deps',
        'deploy-control-smoke',
        'bash',
        'scripts/deploy/smoke-legacy-cutover.sh'
      )) `
      -SanitizeFailureOutput
    $summary.deployLegacyCutoverSmoke = 'PASS'
  } else {
    $summary.deployRuntimeIsolationSmoke = 'SKIPPED_FOCAL'
    $summary.deployRollbackSmoke = 'SKIPPED_FOCAL'
    $summary.deployLegacyCutoverSmoke = 'SKIPPED_FOCAL'
  }
  Invoke-CheckedCommand -Step 'compose-infrastructure-up' -Command {
    docker compose @composeArguments up --build -d --wait --wait-timeout 420 `
      postgres redis minio clamav vault
  }
  $minioValidationImageId = Assert-LocalBuildImageOwnership `
    -ImageTag $minioValidationImage `
    -Service 'minio'
  if ($ValidationMode -eq 'Full' -and -not $deploySmokeImageId) {
    throw 'The Full validator did not record its deploy smoke image'
  }
  $summary.localBuildImages = 'PASS'
  foreach ($service in @('postgres', 'redis', 'minio', 'clamav', 'vault')) {
    Assert-HealthyComposeService -Service $service
  }
  Invoke-CheckedCommand -Step 'minio-bootstrap' -Command {
    docker compose @composeArguments run --rm --no-deps minio-bootstrap
  }
  $summary.services = 'PASS'

  $negativeMigrator = 'balanz_phase0_negative_migrator'
  $null = Invoke-PostgresAdminSql `
    -Step 'create-negative-migrator' `
    -Sql "CREATE ROLE $negativeMigrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '$negativeMigratorPassword';"
  try {
    Set-TrackedEnvironment -Name 'DB_USERNAME' -Value $negativeMigrator
    Set-TrackedEnvironment -Name 'DB_PASSWORD' -Value $negativeMigratorPassword
    Invoke-ExpectedFailureCaptured `
      -Step 'non-super-migrator-negative' `
      -FilePath 'npm' `
      -Arguments @('--prefix', 'apps/api', 'run', 'migration:run') `
      -ExpectedText 'Pending CFDI Phase 0 migrations require the dedicated ephemeral PostgreSQL superuser/migrator'
    $migrationCatalogMissing = Invoke-PostgresAdminSql `
      -Step 'verify-negative-migrator-no-mutation' `
      -Sql "SELECT (to_regclass('public.migrations') IS NULL)::text;"
    if ($migrationCatalogMissing -ne 'true') {
      throw 'The rejected non-superuser migration attempt mutated the fresh database'
    }
    $summary.nonSuperMigratorNegative = 'PASS'
  } finally {
    Set-TrackedEnvironment -Name 'DB_USERNAME' -Value $databaseUser
    Set-TrackedEnvironment -Name 'DB_PASSWORD' -Value $postgresPassword
    $null = Invoke-PostgresAdminSql `
      -Step 'drop-negative-migrator' `
      -Sql "DROP ROLE IF EXISTS $negativeMigrator;"
  }

  $vaultContainerId = Get-ComposeContainerId -Service 'vault'
  $vaultCredentials = Initialize-EphemeralVault `
    -ApiPassword $apiDatabasePassword `
    -WorkerPassword $workerDatabasePassword `
    -HostRedisPort $ports.REDIS_PORT `
    -JwtSecret $jwtSecret `
    -JwtRefreshSecret $jwtRefreshSecret `
    -EmailAccessKey $emailAccessKey `
    -EmailSecretKey $emailSecretKey
  $summary.vault = 'PASS'

  Invoke-CheckedCommand -Step 'migration-show-before-provisioning' -Command {
    npm --prefix apps/api run migration:show
  }
  Invoke-CheckedCommand -Step 'migration-preflight-before-provisioning' -Command {
    npm --prefix apps/api run migration:preflight
  }
  Invoke-CheckedCommand -Step 'migration-run-before-provisioning' -Command {
    npm --prefix apps/api run migration:run
  }
  Set-TrackedEnvironment -Name 'CFDI_PROVISION_RUNTIME_LOGINS' -Value 'true'
  try {
    Invoke-CheckedCommand -Step 'provision-isolated-runtime-logins' -Command {
      npm --prefix apps/api run db:runtime:provision
    }
  } finally {
    Set-TrackedEnvironment -Name 'CFDI_PROVISION_RUNTIME_LOGINS' -Value 'false'
  }
  $summary.runtimeLogins = 'PASS'

  Invoke-CheckedCommand -Step 'postgres-phase0-qa' -Command {
    npm --prefix apps/api run qa:cfdi:postgres
  }
  $summary.postgresPhase0Qa = 'PASS'

  $hostVaultUrl = "https://127.0.0.1:$($ports.VAULT_PORT)"
  Set-TrackedEnvironment -Name 'NODE_EXTRA_CA_CERTS' -Value (
    Join-Path $vaultTlsRoot 'vault-ca.pem'
  )
  Set-TrackedEnvironment -Name 'RUN_EPHEMERAL_VAULT_INTEGRATION' -Value 'true'
  Set-TrackedEnvironment -Name 'EPHEMERAL_VAULT_BASE_URL' -Value $hostVaultUrl
  Set-TrackedEnvironment -Name 'EPHEMERAL_VAULT_API_ROLE_ID' -Value $vaultCredentials.ApiRoleId
  Set-TrackedEnvironment -Name 'EPHEMERAL_VAULT_API_SECRET_ID' -Value $vaultCredentials.ApiSecretId
  Set-TrackedEnvironment -Name 'EPHEMERAL_VAULT_WORKER_ROLE_ID' -Value $vaultCredentials.WorkerRoleId
  Set-TrackedEnvironment -Name 'EPHEMERAL_VAULT_WORKER_SECRET_ID' -Value $vaultCredentials.WorkerSecretId
  Invoke-CheckedCommand -Step 'ephemeral-vault-policy-validation' -Command {
    Push-Location -LiteralPath (Join-Path $workspace 'apps/api')
    try {
      npm exec -- ts-node --transpile-only test/validate-ephemeral-vault.ts
    } finally {
      Pop-Location
    }
  }
  $summary.vaultPolicyIsolation = 'PASS'

  Set-TrackedEnvironment -Name 'SECRETS_ENABLED' -Value 'true'
  Set-TrackedEnvironment -Name 'SECRETS_ENVIRONMENT' -Value 'dev'
  Set-TrackedEnvironment -Name 'SECRETS_CATEGORY' -Value 'internal'
  Set-TrackedEnvironment -Name 'SECRETS_OWNER' -Value 'balanz'
  Set-TrackedEnvironment -Name 'SECRETS_SYSTEM' -Value 'api'
  Set-TrackedEnvironment -Name 'VAULT_BASE_URL' -Value $hostVaultUrl
  Set-TrackedEnvironment -Name 'VAULT_AUTH_PATH' -Value 'approle'
  Set-TrackedEnvironment -Name 'VAULT_MOUNT_PREFIX' -Value 'kv-'
  Set-TrackedEnvironment -Name 'VAULT_ROLE_ID' -Value $vaultCredentials.ApiRoleId
  Set-TrackedEnvironment -Name 'VAULT_SECRET_ID' -Value $vaultCredentials.ApiSecretId
  Set-TrackedEnvironment -Name 'REDIS_URL' -Value ' '
  Invoke-CheckedCommand -Step 'external-adapters-with-vault-redis' -Command {
    npm --prefix apps/api run test:external:fiscal
  }
  $summary.externalAdapters = 'PASS'
  Set-TrackedEnvironment -Name 'SECRETS_ENABLED' -Value 'false'
  Set-TrackedEnvironment -Name 'REDIS_URL' -Value "redis://127.0.0.1:$($ports.REDIS_PORT)"

  Write-VaultSecret -LogicalPath 'cache/redis' -Data @{
    redis_host = 'redis'
    redis_port = 6379
    redis_password = ''
    redis_db = 0
  }
  $runtimeSmokeFixture = New-RuntimeSmokeFixture

  Set-TrackedEnvironment -Name 'API_VAULT_ROLE_ID' -Value $vaultCredentials.ApiRoleId
  Set-TrackedEnvironment -Name 'API_VAULT_SECRET_ID' -Value $vaultCredentials.ApiSecretId
  Set-TrackedEnvironment -Name 'WORKER_VAULT_ROLE_ID' -Value $vaultCredentials.WorkerRoleId
  Set-TrackedEnvironment -Name 'WORKER_VAULT_SECRET_ID' -Value $vaultCredentials.WorkerSecretId
  Invoke-CheckedCommand -Step 'runtime-storage-init' -Command {
    docker compose @composeArguments run --rm --no-deps runtime-storage-init
  }
  try {
    Invoke-CheckedCommand -Step 'runtime-entrypoints-up' -Command {
      docker compose @composeArguments up -d --wait --wait-timeout 180 api worker
    }
  } catch {
    $runtimeStartupFailure = $_
    Write-SanitizedRuntimeStartupDiagnostic
    $currentStep = 'runtime-entrypoints-up'
    throw $runtimeStartupFailure
  }
  Assert-HealthyComposeService -Service 'api'
  Assert-HealthyComposeService -Service 'worker'
  $clamavAddress = Assert-RuntimeNetworkRouting
  Assert-ClamAvTcpFromRuntime -Service 'api' -ExpectedAddress $clamavAddress
  Assert-ClamAvTcpFromRuntime -Service 'worker' -ExpectedAddress $clamavAddress
  $summary.runtimeNetworkRouting = 'PASS'
  Invoke-ContainerHealthProbe -Service 'api' -Endpoint 'liveness' -ExpectedProcess 'api' -InternalPort 3021
  Invoke-ContainerHealthProbe -Service 'api' -Endpoint 'readiness' -ExpectedProcess 'api' -InternalPort 3021
  $summary.apiRuntime = 'PASS'
  Invoke-ContainerHealthProbe -Service 'worker' -Endpoint 'liveness' -ExpectedProcess 'worker' -InternalPort 3002
  Invoke-ContainerHealthProbe -Service 'worker' -Endpoint 'readiness' -ExpectedProcess 'worker' -InternalPort 3002
  $summary.workerRuntime = 'PASS'
  Assert-RuntimeEnvironmentRouting `
    -ApiRoleId $vaultCredentials.ApiRoleId `
    -WorkerRoleId $vaultCredentials.WorkerRoleId
  $summary.environmentRouting = 'PASS'
  $summary.runtimeEnvFileRouting = 'PASS'
  Assert-RuntimeMountRouting -Service 'api' -ProfileEnvFile $runtimeApiEnvFile
  Assert-RuntimeMountRouting -Service 'worker' -ProfileEnvFile $runtimeWorkerEnvFile
  $summary.runtimeMountRouting = 'PASS'
  try {
    Invoke-PhaseZeroRuntimeSmoke -Fixture $runtimeSmokeFixture
  } catch {
    $runtimeSmokeFailure = $_
    Write-SanitizedRuntimeStartupDiagnostic
    $currentStep = 'phase-zero-runtime-smoke'
    throw $runtimeSmokeFailure
  }
  $summary.runtimeSmoke = 'PASS'
  $summary.runtimeFiscalRls = 'PASS'
  Invoke-PhaseZeroWorkerRuntimeSmoke
  $summary.workerRuntimeSmoke = 'PASS'
  Assert-RuntimeWakeupDelivery -Sequence 'before-outage'
  $summary.redisRuntimeWakeupBeforeOutage = 'PASS'
  Stop-And-AssertRuntimeShutdown
  $summary.runtimeShutdownRedisAvailable = 'PASS'

  Assert-NoSecretsInComposeLogs
  $summary.logsRedacted = 'PASS'
  if ($ValidationMode -in @('Full', 'RedisOfflineFocal')) {
    Assert-AllComposeResourcesOwned
    Invoke-CheckedCommand -Step 'remove-stopped-runtime-containers' -Command {
      docker compose @composeArguments rm --force api worker
    }
    Invoke-CheckedCommand -Step 'redis-completely-stop' -Command {
      docker compose @composeArguments stop --timeout 15 redis
    }
    Assert-ComposeServiceStopped -Service 'redis'
    Invoke-CheckedCommand -Step 'runtime-cold-start-without-redis' -Command {
      docker compose @composeArguments up -d --wait --wait-timeout 180 api worker
    }
    Set-TrackedEnvironment -Name 'VAULT_DEV_ROOT_TOKEN_ID' -Value $null
    Assert-ComposeServiceStopped -Service 'redis'
    Write-StoppedRedisNetworkMetadata
    Assert-HealthyComposeService -Service 'api'
    Assert-HealthyComposeService -Service 'worker'
    $offlineClamavAddress = Assert-RuntimeNetworkRouting -RedisStopped
    Assert-ClamAvTcpFromRuntime `
      -Service 'worker' `
      -ExpectedAddress $offlineClamavAddress
    Assert-ClamAvTcpFromRuntime `
      -Service 'api' `
      -ExpectedAddress $offlineClamavAddress
    Invoke-RedisUnavailableHealthProbe -Service 'worker' -InternalPort 3002
    Invoke-RedisUnavailableHealthProbe -Service 'api' -InternalPort 3021
    # Recheck the worker after the API probe so a transient early result cannot
    # hide a supervisor or required-dependency degradation.
    Invoke-RedisUnavailableHealthProbe -Service 'worker' -InternalPort 3002
    $summary.redisUnavailableColdStart = 'PASS'
    Assert-RuntimeEnvironmentRouting `
      -ApiRoleId $vaultCredentials.ApiRoleId `
      -WorkerRoleId $vaultCredentials.WorkerRoleId
    Invoke-PhaseZeroWorkerRuntimeSmoke -ExpectRedisUnavailable
    Assert-WorkerPollingContinuesWithoutRedis
    $summary.postgresPollingWithoutRedis = 'PASS'
    $offlineApiContainerId = Get-ComposeContainerId -Service 'api'
    $offlineWorkerContainerId = Get-ComposeContainerId -Service 'worker'
    Invoke-CheckedCommand -Step 'redis-recovery-start' -Command {
      docker compose @composeArguments start redis
    }
    Wait-HealthyComposeService -Service 'redis' -TimeoutSeconds 90
    if (
      (Get-ComposeContainerId -Service 'api') -cne $offlineApiContainerId -or
      (Get-ComposeContainerId -Service 'worker') -cne $offlineWorkerContainerId
    ) {
      $currentStep = 'runtime-continuity-after-redis-recovery'
      throw 'API/worker containers restarted during Redis recovery'
    }
    Invoke-RedisRecoveredHealthProbe -Service 'worker' -InternalPort 3002
    Invoke-RedisRecoveredHealthProbe -Service 'api' -InternalPort 3021
    $summary.redisRuntimeRecovery = 'PASS'
    Assert-RuntimeWakeupDelivery -Sequence 'after-recovery'
    $summary.redisRuntimeWakeupAfterRecovery = 'PASS'
    Invoke-PhaseZeroWorkerRuntimeSmoke
    Invoke-CheckedCommand -Step 'redis-stop-before-runtime-shutdown' -Command {
      docker compose @composeArguments stop --timeout 15 redis
    }
    Assert-ComposeServiceStopped -Service 'redis'
    Invoke-RedisUnavailableHealthProbe -Service 'worker' -InternalPort 3002
    Invoke-RedisUnavailableHealthProbe -Service 'api' -InternalPort 3021
    Assert-NoSecretsInComposeLogs
    Stop-And-AssertRuntimeShutdown
    $summary.runtimeShutdownRedisUnavailable = 'PASS'
  } else {
    $summary.redisUnavailableColdStart = 'SKIPPED_FOCAL'
    $summary.postgresPollingWithoutRedis = 'SKIPPED_FOCAL'
    $summary.redisRuntimeRecovery = 'SKIPPED_FOCAL'
    $summary.redisRuntimeWakeupAfterRecovery = 'SKIPPED_FOCAL'
    $summary.runtimeShutdownRedisUnavailable = 'SKIPPED_FOCAL'
  }
  $summary.runtimeShutdown = 'PASS'

  $null = Invoke-VaultRootCommand `
    -Step 'vault-revoke-bootstrap-token' `
    -Arguments @('token', 'revoke', '-self')
  $summary.status = if ($ValidationMode -eq 'Full') { 'PASS' } else { 'FOCAL_PASS' }
} catch {
  $failure = $_
  $summary.failedStep = $currentStep
} finally {
  if ($stackOwnedByThisRun) {
    try {
      $currentStep = 'cleanup-ownership-verification'
      Assert-AllComposeResourcesOwned
      $summary.cleanupOwnership = 'PASS'
      $currentStep = 'compose-down'
      $downArguments = @('compose') + $composeArguments + @('down', '--remove-orphans')
      if (-not $PreserveEvidence) {
        $downArguments += '--volumes'
      }
      $null = Invoke-CapturedExternal `
        -Step 'compose-down' `
        -FilePath 'docker' `
        -Arguments $downArguments
      $remainingContainers = @(Get-ProjectResourceIds -Kind 'container')
      $remainingNetworks = @(Get-ProjectResourceIds -Kind 'network')
      $remainingVolumes = @(Get-ProjectResourceIds -Kind 'volume')
      if ($remainingContainers.Count -gt 0 -or $remainingNetworks.Count -gt 0) {
        throw 'Project containers or networks remained after Compose cleanup'
      }
      if (-not $PreserveEvidence -and $remainingVolumes.Count -gt 0) {
        throw 'Project volumes remained after the default cleanup'
      }
      if ($localImageNamespaceOwnedByThisRun) {
        Remove-OwnedLocalBuildImage `
          -ImageTag $deploySmokeImage `
          -Service 'deploy-control-smoke' `
          -ExpectedImageId $deploySmokeImageId
        Remove-OwnedLocalBuildImage `
          -ImageTag $minioValidationImage `
          -Service 'minio' `
          -ExpectedImageId $minioValidationImageId
        if (
          @(Get-ExactDockerImageIds -ImageTag $deploySmokeImage).Count -ne 0 -or
          @(Get-ExactDockerImageIds -ImageTag $minioValidationImage).Count -ne 0
        ) {
          throw 'A project-local validation image remained after cleanup'
        }
        $summary.localBuildImagesDeleted = $true
      }
      $summary.composeDown = 'PASS'
      $summary.volumesDeleted = -not [bool]$PreserveEvidence
    } catch {
      $summary.status = 'FAIL'
      $summary.composeDown = 'FAIL'
      if ($null -eq $failure) {
        $failure = $_
        $summary.failedStep = $currentStep
      }
    }
  }
  if (-not $PreserveEvidence) {
    try {
      if ($storageRootOwnedByThisRun -and $effectiveStorageRoot) {
        Remove-OwnedLocalDirectory -Path $effectiveStorageRoot -AllowedBase $storageBase
      }
      if ($vaultTlsRootOwnedByThisRun) {
        Remove-OwnedLocalDirectory -Path $vaultTlsRoot -AllowedBase $vaultTlsBase
      }
      if ($runtimeEnvRootOwnedByThisRun) {
        Remove-OwnedLocalDirectory -Path $runtimeEnvRoot -AllowedBase $runtimeEnvBase
      }
      $summary.localResourcesDeleted = $true
    } catch {
      $summary.status = 'FAIL'
      if ($null -eq $failure) {
        $failure = $_
        $summary.failedStep = 'local-resource-cleanup'
      }
    }
  }
  Set-Location -LiteralPath $originalLocation
  Restore-TrackedEnvironment
}

$completedAt = [DateTime]::UtcNow
$summary.completedAt = $completedAt.ToString('o')
$summary.durationSeconds = [Math]::Round(
  ($completedAt - $startedAt).TotalSeconds,
  3
)
try {
  $currentStep = 'local-report'
  $summary.localReport = 'PASS'
  Write-SanitizedReport
} catch {
  $summary.status = 'FAIL'
  $summary.localReport = 'FAIL'
  if ($null -eq $failure) {
    $failure = $_
    $summary.failedStep = 'local-report'
  }
}

$summary | ConvertTo-Json -Depth 5
if ($null -ne $failure) {
  [Console]::Error.WriteLine(
    "CFDI Phase 0 validation failed at step '$($summary.failedStep)'. Captured output and disposable credentials were not reported."
  )
  exit 1
}
