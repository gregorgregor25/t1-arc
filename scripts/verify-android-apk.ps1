param(
  [Parameter(Mandatory = $true)]
  [string]$ApkPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$resolvedApk = (Resolve-Path -LiteralPath $ApkPath).Path
$projectRoot = Split-Path -Parent $PSScriptRoot
$appConfig = Get-Content -LiteralPath (Join-Path $projectRoot 'app.json') -Raw |
  ConvertFrom-Json
$androidSdk = if ($env:ANDROID_HOME) {
  $env:ANDROID_HOME
} else {
  Join-Path $env:LOCALAPPDATA 'Android\Sdk'
}
$analyzer = Join-Path $androidSdk 'cmdline-tools\latest\bin\apkanalyzer.bat'
$latestBuildTools = Get-ChildItem -LiteralPath (Join-Path $androidSdk 'build-tools') -Directory |
  Sort-Object Name -Descending |
  Select-Object -First 1
$apkSigner = if ($latestBuildTools) {
  Join-Path $latestBuildTools.FullName 'apksigner.bat'
}

if (-not (Test-Path -LiteralPath $analyzer)) {
  throw "apkanalyzer was not found at $analyzer"
}
if (-not $apkSigner -or -not (Test-Path -LiteralPath $apkSigner)) {
  throw 'apksigner was not found in the Android SDK build tools.'
}

$packageName = (& $analyzer manifest application-id $resolvedApk).Trim()
if ($packageName -ne 'app.daymark.personal') {
  throw "Unexpected application ID: $packageName"
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

$definedDex = & $analyzer dex packages --defined-only $resolvedApk
$requiredClasses = @(
  'expo.modules.ExpoModulesPackageList',
  'app.daymark.backup.DaymarkBackupCryptoModule',
  'app.daymark.glooko.DaymarkGlookoExportModule',
  'app.daymark.glucosedisplay.DaymarkGlucoseDisplayModule',
  'app.daymark.healthconnect.DaymarkHealthConnectModule',
  'app.daymark.notificationsource.DaymarkNotificationSourceModule'
)

foreach ($requiredClass in $requiredClasses) {
  if (-not ($definedDex -match [regex]::Escape($requiredClass))) {
    throw "APK is incomplete: $requiredClass is absent from the final DEX files."
  }
}

$permissions = @(& $analyzer manifest permissions $resolvedApk)
$requiredPermissions = @(
  'android.permission.INTERNET',
  'android.permission.CAMERA',
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
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.VIBRATE'
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
Write-Output 'Embedded bundle, native integrations, permissions, ARM64 runtime and signature are valid.'
