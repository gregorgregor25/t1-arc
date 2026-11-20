param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^emulator-[0-9]+$')]
  [string]$EmulatorSerial,
  [switch]$BuildOnly
)

$ErrorActionPreference = 'Stop'
$fixtureMarker = 't1arc-synthetic-qa'
$packageName = 'info.nightscout.androidaps'
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { $env:ANDROID_SDK_ROOT }
if (-not $sdk -or -not (Test-Path -LiteralPath $sdk -PathType Container)) {
  throw 'Set ANDROID_HOME or ANDROID_SDK_ROOT to the Android SDK directory.'
}
if (-not $env:JAVA_HOME -or -not (Test-Path -LiteralPath $env:JAVA_HOME -PathType Container)) {
  throw 'Set JAVA_HOME to a working JDK directory.'
}
$java = Join-Path $env:JAVA_HOME 'bin'
$adb = Join-Path $sdk 'platform-tools/adb.exe'
$buildTools = Get-ChildItem -LiteralPath (Join-Path $sdk 'build-tools') -Directory |
  Where-Object { $_.Name -match '^[0-9]+\.[0-9]+\.[0-9]+$' } |
  Sort-Object { [version]($_.Name) } -Descending |
  Select-Object -First 1
$platform = Get-ChildItem -LiteralPath (Join-Path $sdk 'platforms') -Directory |
  Where-Object { $_.Name -match '^android-[0-9]+$' } |
  Sort-Object { [int]($_.Name -replace '^android-', '') } -Descending |
  Select-Object -First 1
if (-not (Test-Path -LiteralPath $adb) -or -not $buildTools -or -not $platform) {
  throw 'Android SDK is missing adb, a stable build-tools version, or an Android platform.'
}
$androidJar = Join-Path $platform.FullName 'android.jar'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$keystore = Join-Path $repoRoot 'android/app/debug.keystore'
if (-not (Test-Path -LiteralPath $keystore)) { throw 'The project debug keystore is missing.' }

# The package name deliberately matches the AAPS production receiver protocol.
# Never replace a real AAPS installation, even on a test emulator.
if (-not $BuildOnly) {
  $deviceState = (& $adb -s $EmulatorSerial get-state 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $deviceState -ne 'device') { throw "Emulator $EmulatorSerial is not online." }
  $isEmulator = (& $adb -s $EmulatorSerial shell getprop ro.kernel.qemu | Out-String).Trim()
  $model = (& $adb -s $EmulatorSerial shell getprop ro.product.model | Out-String).Trim()
  $sdkLevel = (& $adb -s $EmulatorSerial shell getprop ro.build.version.sdk | Out-String).Trim()
  if ($isEmulator -ne '1' -or -not $model -or $sdkLevel -notmatch '^[0-9]+$' -or [int]$sdkLevel -lt 26) {
    throw "Refusing installation: ${EmulatorSerial} is not a supported Android emulator."
  }
  $existingPath = (& $adb -s $EmulatorSerial shell pm path $packageName 2>$null | Out-String).Trim()
  if ($existingPath -match '^package:') {
    $existingDetails = (& $adb -s $EmulatorSerial shell dumpsys package $packageName | Out-String)
    if ($existingDetails -notmatch "(?m)^\s*versionName=$([regex]::Escape($fixtureMarker))\s*$") {
      throw "Refusing to replace installed ${packageName}: it is not the T1 Arc synthetic QA fixture."
    }
  }
}

$output = Join-Path $repoRoot '.qa/aaps-sender'
$classes = Join-Path $output 'classes'
$dex = Join-Path $output 'dex'
New-Item -ItemType Directory -Force -Path $classes, $dex | Out-Null
$senderClass = Join-Path $classes 'info/nightscout/androidaps/QaSender.class'
$receiverClass = Join-Path $classes 'info/nightscout/androidaps/QaSenderReceiver.class'
$unsigned = Join-Path $output 'unsigned.apk'
$aligned = Join-Path $output 'aligned.apk'
$signed = Join-Path $output 'sender.apk'

& (Join-Path $java 'javac.exe') -source 8 -target 8 -classpath $androidJar -d $classes (Join-Path $PSScriptRoot 'QaSender.java') (Join-Path $PSScriptRoot 'QaSenderReceiver.java')
if ($LASTEXITCODE -ne 0) { throw 'Fixture Java compilation failed.' }
& (Join-Path $buildTools.FullName 'd8.bat') --lib $androidJar --output $dex $senderClass $receiverClass
if ($LASTEXITCODE -ne 0) { throw 'Fixture dex compilation failed.' }
& (Join-Path $buildTools.FullName 'aapt2.exe') link -o $unsigned --manifest (Join-Path $PSScriptRoot 'AndroidManifest.xml') -I $androidJar
if ($LASTEXITCODE -ne 0) { throw 'Fixture APK packaging failed.' }
& (Join-Path $java 'jar.exe') uf $unsigned -C $dex classes.dex
if ($LASTEXITCODE -ne 0) { throw 'Fixture dex packaging failed.' }
& (Join-Path $buildTools.FullName 'zipalign.exe') -f 4 $unsigned $aligned
if ($LASTEXITCODE -ne 0) { throw 'Fixture APK alignment failed.' }
& (Join-Path $buildTools.FullName 'apksigner.bat') sign --ks $keystore --ks-pass pass:android --key-pass pass:android --out $signed $aligned
if ($LASTEXITCODE -ne 0) { throw 'Fixture APK signing failed.' }

if ($BuildOnly) {
  Write-Host "Built T1 Arc synthetic AAPS fixture: $signed"
} else {
  Write-Host "Installing T1 Arc synthetic AAPS fixture on $EmulatorSerial ($model, API $sdkLevel)."
  & $adb -s $EmulatorSerial install -r $signed
  if ($LASTEXITCODE -ne 0) { throw 'Emulator fixture installation failed.' }
}
