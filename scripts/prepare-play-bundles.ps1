param(
    [Parameter(Mandatory = $true)][string]$BundletoolJar,
    [string]$OutputDirectory = '.qa/play-bundles'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    # Pinned upstream bundletool 1.18.3 release asset, not an arbitrary executable.
    $tool = (Resolve-Path -LiteralPath $BundletoolJar).Path
    $expectedTool = 'a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29'
    if ((Get-FileHash -LiteralPath $tool -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expectedTool) {
        throw 'Bundletool checksum mismatch. Use the documented upstream 1.18.3 asset.'
    }
    $source = node -e "console.log(JSON.stringify(require('./scripts/build-source.cjs').readBuildSource(process.cwd())))" | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $source.modified -ne $false) { throw 'Play candidates require a clean, committed source tree.' }
    if ($env:T1ARC_PRIVATE_TEST_BUILD -eq '1') { throw 'Private-test signing is not allowed for Play bundles.' }
    foreach ($prefix in @('T1ARC_RELEASE', 'T1ARC_FACE')) {
        foreach ($suffix in @('STORE_FILE', 'STORE_PASSWORD', 'KEY_ALIAS', 'KEY_PASSWORD')) {
            if (-not [Environment]::GetEnvironmentVariable("${prefix}_${suffix}")) { throw "Missing ${prefix}_${suffix}." }
        }
    }
    if (!(Test-Path android/gradlew.bat) -and !(Test-Path android/gradlew)) {
        throw 'Generate Android first with npx expo prebuild --platform android --no-install.'
    }
    if ($IsWindows) {
        $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($root))
        if ($drive.AvailableFreeSpace -lt 20GB) { throw 'Keep at least 20 GiB free before starting a production bundle build.' }
    }
    $app = Get-Content -Raw app.json | ConvertFrom-Json
    $artifacts = @(
        @{ Name='Android'; Module='app'; Path='android/app/build/outputs/bundle/release/app-release.aab'; Package=$app.expo.android.package; Signer='31babc04082806319b3eb1ed97f437c40d32b6e2eac4463eb485c4b681740f50' },
        @{ Name='Wear'; Module='wear'; Path='wear/companion/build/outputs/bundle/release/wear-release.aab'; Package=$app.expo.android.package; Signer='31babc04082806319b3eb1ed97f437c40d32b6e2eac4463eb485c4b681740f50' }
    )
    foreach ($face in @('meridian','chronograph','atelier','pace','summit')) {
        $artifacts += @{ Name=$face; Module="watchface-$face"; Path="wear/watchface-$face/build/outputs/bundle/release/watchface-$face-release.aab"; Package="io.github.gregorgregor25.t1arc.watchface.$face"; Signer='338368500cbb8bd5ce73ca5fd47586873f4c1fa6b10fcc9f491c61a345fffd83' }
    }
    $gradle = if ($IsWindows) { './android/gradlew.bat' } else { './android/gradlew' }
    $tasks = @($artifacts | ForEach-Object { ":$($_.Module):bundleRelease" })
    & $gradle -p ./android @tasks --console=plain --no-daemon --max-workers=4
    if ($LASTEXITCODE -ne 0) { throw 'Bundle build failed.' }
    $output = [IO.Path]::GetFullPath($OutputDirectory, $root)
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    $records = @()
    foreach ($artifact in $artifacts) {
        $bundle = (Resolve-Path -LiteralPath $artifact.Path).Path
        & java -jar $tool validate "--bundle=$bundle"
        if ($LASTEXITCODE -ne 0) { throw "Invalid $($artifact.Name) bundle." }
        $signature = & jarsigner '-J-Duser.language=en' -verify $bundle 2>&1
        if ($LASTEXITCODE -ne 0 -or ($signature -join "`n") -notmatch 'jar verified' -or ($signature -join "`n") -match 'contains unsigned entries') { throw 'Bundle JAR signature did not verify completely.' }
        $cert = (& keytool '-J-Duser.language=en' -printcert -jarfile $bundle 2>&1) -join "`n"
        if ($LASTEXITCODE -ne 0 -or $cert -notmatch 'SHA256:\s*([0-9A-Fa-f:]+)') { throw 'Cannot read bundle signing certificate.' }
        if ($Matches[1].Replace(':','').ToLowerInvariant() -cne $artifact.Signer) { throw 'Unexpected signing certificate. Do not upload.' }
        $xml = & java -jar $tool dump manifest "--bundle=$bundle" --module=base
        if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect bundle manifest.' }
        [xml]$manifest = $xml -join "`n"
        $ns = 'http://schemas.android.com/apk/res/android'
        $package = $manifest.DocumentElement.GetAttribute('package')
        $code = [int]$manifest.DocumentElement.GetAttribute('versionCode', $ns)
        $name = $manifest.DocumentElement.GetAttribute('versionName', $ns)
        if ($package -cne $artifact.Package -or $code -lt 1 -or !$name) { throw 'Unexpected bundle identity/version.' }
        if ($artifact.Name -eq 'Android' -and ($code -ne $app.expo.android.versionCode -or $name -cne $app.expo.version)) { throw 'Phone version mismatch.' }
        $expectedCode = if ($artifact.Name -eq 'Wear') { $app.expo.android.versionCode + 1 } else { $app.expo.android.versionCode }
        if ($code -ne $expectedCode -or $name -cne $app.expo.version) { throw 'Release family version mismatch.' }
        $application = $manifest.DocumentElement.SelectSingleNode('application')
        if (!$application -or $application.GetAttribute('debuggable', $ns) -eq 'true' -or $application.GetAttribute('testOnly', $ns) -eq 'true') { throw 'Debug or test-only bundle is not a production candidate.' }
        if ($manifest.DocumentElement.SelectSingleNode('instrumentation')) { throw 'Test instrumentation must not be shipped in a Play candidate.' }
        $filename = "T1-Arc-$($artifact.Name)-v$name-code$code.aab"
        $destination = Join-Path $output $filename
        if (Test-Path -LiteralPath $destination) { throw "Refusing to replace $destination. Use a new output directory." }
        Copy-Item -LiteralPath $bundle -Destination $destination
        $records += @{ file=$filename; package=$package; version=$name; versionCode=$code; signer=$artifact.Signer; sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
    if ($records[0].versionCode -eq $records[1].versionCode) { throw 'Phone and Wear need distinct Play version codes.' }
    $after = node -e "console.log(JSON.stringify(require('./scripts/build-source.cjs').readBuildSource(process.cwd())))" | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $after.modified -ne $false -or $after.commit -cne $source.commit) {
        throw 'Source changed during packaging. Discard these candidates; do not upload.'
    }
    @{ sourceCommit=$source.commit; acceptance='PACKAGING ONLY: device, Play signing and policy review still required'; artifacts=$records } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $output 'candidate-manifest.json')
    Write-Output "Prepared Play candidates in $output. Nothing uploaded or submitted."
} finally { Pop-Location }
