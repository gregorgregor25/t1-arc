param(
  [Parameter(Mandatory = $true)]
  [string]$ApkPath,

  [Alias('MappingFile')]
  [string]$MappingPath,

  [string]$ExpectedApplicationId,

  [string]$ExpectedSourceCommit,

  [switch]$RequireCleanSource
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$resolvedApk = (Resolve-Path -LiteralPath $ApkPath).Path
$resolvedMapping = if ($MappingPath) {
  (Resolve-Path -LiteralPath $MappingPath).Path
} else {
  $null
}
$projectRoot = Split-Path -Parent $PSScriptRoot
$appConfig = Get-Content -LiteralPath (Join-Path $projectRoot 'app.json') -Raw |
  ConvertFrom-Json
if (-not $ExpectedApplicationId) {
  $ExpectedApplicationId = [string]$appConfig.expo.android.package
}
if (
  $ExpectedApplicationId -cnotmatch
    '^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$'
) {
  throw "Invalid expected application ID: $ExpectedApplicationId"
}
$androidSdk = if ($env:ANDROID_HOME) {
  $env:ANDROID_HOME
} else {
  Join-Path $env:LOCALAPPDATA 'Android\Sdk'
}
$toolSuffix = if (
  [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT
) { '.bat' } else { '' }
$analyzer = Join-Path $androidSdk "cmdline-tools\latest\bin\apkanalyzer$toolSuffix"
$latestBuildTools = Get-ChildItem -LiteralPath (Join-Path $androidSdk 'build-tools') -Directory |
  Sort-Object Name -Descending |
  Select-Object -First 1
$apkSigner = if ($latestBuildTools) {
  Join-Path $latestBuildTools.FullName "apksigner$toolSuffix"
}

if (-not (Test-Path -LiteralPath $analyzer)) {
  throw "apkanalyzer was not found at $analyzer"
}
if (-not $apkSigner -or -not (Test-Path -LiteralPath $apkSigner)) {
  throw 'apksigner was not found in the Android SDK build tools.'
}

$packageName = (& $analyzer manifest application-id $resolvedApk).Trim()
if ($packageName -cne $ExpectedApplicationId) {
  throw (
    "Unexpected application ID: $packageName; expected " +
    "$ExpectedApplicationId."
  )
}

$versionName = (& $analyzer manifest version-name $resolvedApk).Trim()
$versionCode = [int](& $analyzer manifest version-code $resolvedApk).Trim()
$minSdk = [int](& $analyzer manifest min-sdk $resolvedApk).Trim()
$targetSdk = [int](& $analyzer manifest target-sdk $resolvedApk).Trim()
$debuggable = (& $analyzer manifest debuggable $resolvedApk).Trim()
if ($versionName -ne $appConfig.expo.version) {
  throw "APK version $versionName does not match app.json $($appConfig.expo.version)."
}
if ($versionCode -ne $appConfig.expo.android.versionCode) {
  throw "APK version code $versionCode does not match app.json $($appConfig.expo.android.versionCode)."
}
if ($minSdk -ne 26 -or $targetSdk -ne 36) {
  throw "Unexpected SDK range: min $minSdk, target $targetSdk."
}
if ($debuggable -ne 'false') {
  throw 'The release APK is debuggable.'
}

$headlessLoaderMetadata = 'org.unimodules.core.AppLoader#react-native-headless'
$headlessLoaderClass =
  'expo.modules.adapters.react.apploader.RNHeadlessAppLoader'
try {
  [xml]$manifestXml = @(& $analyzer manifest print $resolvedApk) -join "`n"
} catch {
  throw "apkanalyzer returned an unreadable manifest: $($_.Exception.Message)"
}
$androidNamespace = 'http://schemas.android.com/apk/res/android'
$headlessLoaderEntries = @(
  $manifestXml.SelectNodes('/manifest/application/meta-data') |
    Where-Object {
      $_.GetAttribute('name', $androidNamespace) -ceq $headlessLoaderMetadata
    }
)
if (
  $headlessLoaderEntries.Count -ne 1 -or
  $headlessLoaderEntries[0].GetAttribute('value', $androidNamespace) -cne
    $headlessLoaderClass
) {
  throw (
    "APK manifest metadata $headlessLoaderMetadata must name " +
    "$headlessLoaderClass exactly."
  )
}

$definedDexClasses = [System.Collections.Generic.HashSet[string]]::new(
  [System.StringComparer]::Ordinal
)
foreach ($line in @(& $analyzer dex packages --defined-only $resolvedApk)) {
  $classRecord = [regex]::Match(
    $line,
    '^C\s+(?:\S+\s+){4}(?<class>\S+)\s*$'
  )
  if ($classRecord.Success) {
    [void]$definedDexClasses.Add($classRecord.Groups['class'].Value)
  }
}
if ($definedDexClasses.Count -eq 0) {
  throw 'apkanalyzer returned no defined DEX class records.'
}
$requiredClasses = @(
  'expo.modules.ExpoModulesPackageList',
  $headlessLoaderClass,
  'io.github.gregorgregor25.t1arc.backup.T1ArcBackupCryptoModule',
  'io.github.gregorgregor25.t1arc.glooko.T1ArcGlookoExportModule',
  'io.github.gregorgregor25.t1arc.glucosedisplay.T1ArcGlucoseDisplayModule',
  'io.github.gregorgregor25.t1arc.healthconnect.T1ArcHealthConnectModule',
  'io.github.gregorgregor25.t1arc.notificationsource.T1ArcNotificationSourceModule'
)
$mappedClasses = [System.Collections.Generic.Dictionary[string, string]]::new(
  [System.StringComparer]::Ordinal
)

if ($resolvedMapping) {
  foreach ($line in Get-Content -LiteralPath $resolvedMapping) {
    $classMapping = [regex]::Match(
      $line,
      '^(?<original>\S.*?) -> (?<obfuscated>\S+):$'
    )
    if ($classMapping.Success) {
      $mappedClasses[$classMapping.Groups['original'].Value] =
        $classMapping.Groups['obfuscated'].Value
    }
  }
}

$runtimeNameStableClasses = @(
  $headlessLoaderClass
)
foreach ($runtimeNameStableClass in $runtimeNameStableClasses) {
  if (
    $mappedClasses.ContainsKey($runtimeNameStableClass) -and
    $mappedClasses[$runtimeNameStableClass] -cne $runtimeNameStableClass
  ) {
    throw (
      "APK is unsafe: $runtimeNameStableClass must keep its runtime name " +
      'because Expo loads it from manifest metadata.'
    )
  }
}

foreach ($requiredClass in $requiredClasses) {
  if ($mappedClasses.ContainsKey($requiredClass)) {
    $mappedClass = [string]$mappedClasses[$requiredClass]
    if (-not $definedDexClasses.Contains($mappedClass)) {
      throw (
        "R8 mapping does not match APK: $requiredClass maps to $mappedClass, " +
        'but that class is absent from the final DEX files.'
      )
    }
  } elseif (-not $definedDexClasses.Contains($requiredClass)) {
    throw "APK is incomplete: $requiredClass is absent from the final DEX files."
  }
}

$permissions = @(& $analyzer manifest permissions $resolvedApk)
$requiredPermissions = @(
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.CAMERA',
  'android.permission.VIBRATE',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.health.READ_STEPS',
  'android.permission.health.READ_EXERCISE',
  'android.permission.health.READ_SLEEP',
  'android.permission.health.READ_NUTRITION',
  'android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND',
  'android.permission.health.READ_HEALTH_DATA_HISTORY'
)
$forbiddenPermissions = @(
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.SYSTEM_ALERT_WINDOW'
)
foreach ($requiredPermission in $requiredPermissions) {
  if ($permissions -notcontains $requiredPermission) {
    throw "APK is incomplete: $requiredPermission is absent."
  }
}
foreach ($forbiddenPermission in $forbiddenPermissions) {
  if ($permissions -contains $forbiddenPermission) {
    throw "APK has forbidden permission: $forbiddenPermission."
  }
}

$archive = [System.IO.Compression.ZipFile]::OpenRead($resolvedApk)
try {
  $bundle = $archive.GetEntry('assets/index.android.bundle')
  if (-not $bundle -or $bundle.Length -lt 100KB) {
    throw 'APK has no usable embedded React Native bundle.'
  }
  if (-not $archive.GetEntry('lib/arm64-v8a/libreactnative.so')) {
    throw 'APK has no ARM64 React Native runtime for the Pixel.'
  }
  if ($ExpectedSourceCommit -or $RequireCleanSource) {
    $configEntry = $archive.GetEntry('assets/app.config')
    if (-not $configEntry) { throw 'APK has no embedded source metadata.' }
    $configReader = [System.IO.StreamReader]::new($configEntry.Open())
    try { $embeddedConfig = $configReader.ReadToEnd() | ConvertFrom-Json }
    finally { $configReader.Dispose() }
    $buildSource = $embeddedConfig.extra.t1arcBuild
    if ($ExpectedSourceCommit -and $buildSource.commit -cne $ExpectedSourceCommit) {
      throw 'Embedded APK source commit does not match the expected release source.'
    }
    if ($RequireCleanSource -and $buildSource.modified -ne $false) {
      throw 'APK source is modified or unknown.'
    }
  }
} finally {
  $archive.Dispose()
}

& $apkSigner verify --verbose $resolvedApk | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'APK signature verification failed.'
}

$apk = Get-Item -LiteralPath $resolvedApk
Write-Output "Verified $($apk.Name)"
Write-Output "Application ID: $packageName"
Write-Output "Version: $versionName ($versionCode)"
Write-Output "SDK: $minSdk-$targetSdk"
Write-Output "Size: $($apk.Length) bytes"
if ($resolvedMapping) {
  Write-Output "R8 mapping: $([System.IO.Path]::GetFileName($resolvedMapping))"
}
Write-Output 'Embedded bundle, native integrations, permissions, ARM64 runtime and signature are valid.'
