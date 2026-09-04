param(
  [string]$PhoneApkPath,
  [string]$CompanionApkPath,
  [string]$MeridianApkPath,
  [string]$ChronographApkPath,
  [string]$OrbitApkPath,
  [string]$ApplicationIdBase = 'io.github.gregorgregor25.t1arc',
  [string]$ApplicationIdSuffix = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

function ProjectPath([string]$relativePath) {
  return Join-Path $projectRoot $relativePath
}

if (-not $PhoneApkPath) {
  $PhoneApkPath = ProjectPath 'android\app\build\outputs\apk\release\app-release.apk'
}
if (-not $CompanionApkPath) {
  $CompanionApkPath = ProjectPath 'wear\companion\build\outputs\apk\release\wear-release.apk'
}
if (-not $MeridianApkPath) {
  $MeridianApkPath = ProjectPath 'wear\watchface-meridian\build\outputs\apk\release\watchface-meridian-release.apk'
}
if (-not $ChronographApkPath) {
  $ChronographApkPath = ProjectPath 'wear\watchface-chronograph\build\outputs\apk\release\watchface-chronograph-release.apk'
}
if (-not $OrbitApkPath) {
  $OrbitApkPath = ProjectPath 'wear\watchface-orbit\build\outputs\apk\release\watchface-orbit-release.apk'
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
if (
  $ApplicationIdBase -cnotmatch
    '^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$'
) {
  throw "Invalid application ID base: $ApplicationIdBase"
}
if ($ApplicationIdSuffix -notin @('', '.sideload')) {
  throw "Unexpected release application ID suffix: $ApplicationIdSuffix"
}

function CertificateDigest([string]$path) {
  $output = & $apkSigner verify --print-certs $path
  if ($LASTEXITCODE -ne 0) {
    throw "Signature verification failed for $path."
  }
  $line = $output |
    Select-String -Pattern 'certificate SHA-256 digest:' |
    Select-Object -First 1
  if (-not $line) {
    throw "No signing certificate was found for $path."
  }
  return ($line.Line -split ':')[-1].Trim()
}

function VerifyWearApk(
  [string]$path,
  [string]$expectedPackage,
  [int]$expectedMinSdk,
  [bool]$resourceOnly
) {
  $resolved = (Resolve-Path -LiteralPath $path).Path
  $packageName = (& $analyzer manifest application-id $resolved).Trim()
  $minSdk = [int](& $analyzer manifest min-sdk $resolved).Trim()
  $targetSdk = [int](& $analyzer manifest target-sdk $resolved).Trim()
  $debuggable = (& $analyzer manifest debuggable $resolved).Trim()
  $manifest = & $analyzer manifest print $resolved

  if ($packageName -ne $expectedPackage) {
    throw "Unexpected package $packageName in $resolved."
  }
  if ($minSdk -ne $expectedMinSdk -or $targetSdk -ne 36) {
    throw "Unexpected SDK range $minSdk-$targetSdk in $resolved."
  }
  if ($debuggable -ne 'false') {
    throw "Release APK is debuggable: $resolved."
  }
  if (-not ($manifest -match 'android\.hardware\.type\.watch')) {
    throw "Wear hardware requirement is absent from $resolved."
  }

  $permissions = @(& $analyzer manifest permissions $resolved)
  $forbiddenPermissions = @(
    'android.permission.CAMERA',
    'android.permission.INTERNET',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE'
  )
  foreach ($permission in $forbiddenPermissions) {
    if ($permissions -contains $permission) {
      throw "Wear APK has unnecessary permission $permission in $resolved."
    }
  }

  if ($resourceOnly) {
    if (-not ($manifest -match 'android:hasCode="false"')) {
      throw "Watch face is not resource-only: $resolved."
    }
    if (
      -not ($manifest -match 'com\.google\.wear\.watchface\.format\.version') -or
      -not ($manifest -match 'android:value="T1 Arc"')
    ) {
      throw "Watch Face Format metadata is incomplete in $resolved."
    }
  }

  [pscustomobject]@{
    Path = $resolved
    Package = $packageName
    Version = (& $analyzer manifest version-name $resolved).Trim()
    VersionCode = [int](& $analyzer manifest version-code $resolved).Trim()
    Certificate = CertificateDigest $resolved
  }
}

$phone = (Resolve-Path -LiteralPath $PhoneApkPath).Path
$phoneCertificate = CertificateDigest $phone
$companion = VerifyWearApk $CompanionApkPath "$ApplicationIdBase$ApplicationIdSuffix" 30 $false
$faces = @(
  VerifyWearApk $MeridianApkPath "$ApplicationIdBase.watchface.meridian$ApplicationIdSuffix" 33 $true
  VerifyWearApk $ChronographApkPath "$ApplicationIdBase.watchface.chronograph$ApplicationIdSuffix" 33 $true
  VerifyWearApk $OrbitApkPath "$ApplicationIdBase.watchface.orbit$ApplicationIdSuffix" 33 $true
)

if ($companion.Certificate -ne $phoneCertificate) {
  throw 'Phone and Wear companion certificates differ, so Data Layer sync would fail.'
}
foreach ($face in $faces) {
  if ($face.Certificate -ne $phoneCertificate) {
    throw "Watch-face certificate differs from the test release set: $($face.Path)."
  }
}

$companionDex = & $analyzer dex packages --defined-only $companion.Path
$requiredCompanionClasses = @(
  'io.github.gregorgregor25.t1arc.wear.data.T1ArcDataLayerService',
  'io.github.gregorgregor25.t1arc.wear.data.T1ArcWearRepository',
  'io.github.gregorgregor25.t1arc.wear.complication.T1ArcGraphComplicationService',
  'io.github.gregorgregor25.t1arc.wear.tile.T1ArcGlucoseTileService'
)
foreach ($requiredClass in $requiredCompanionClasses) {
  if (-not ($companionDex -match [regex]::Escape($requiredClass))) {
    throw "Wear companion is incomplete: $requiredClass is absent."
  }
}

Write-Output "Verified Wear companion $($companion.Version) ($($companion.VersionCode))"
foreach ($face in $faces) {
  Write-Output "Verified $($face.Package) $($face.Version) ($($face.VersionCode))"
}
Write-Output 'All Wear APKs are signed, non-debuggable, watch-only and certificate-compatible with the phone.'
