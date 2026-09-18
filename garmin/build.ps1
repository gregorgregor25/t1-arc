param(
  [Parameter(Mandatory=$true)][string]$Sdk,
  [Parameter(Mandatory=$true)][string]$Key,
  [string]$Output = '.local/garmin-beta',
  [switch]$Tests
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$compiler = Join-Path (Resolve-Path $Sdk) 'bin/monkeyc.bat'
$signingKey = (Resolve-Path $Key).Path
New-Item -ItemType Directory -Force $Output | Out-Null
$outPath = (Resolve-Path $Output).Path
[xml]$manifest = Get-Content (Join-Path $PSScriptRoot 'manifest.xml')
$products = $manifest.manifest.application.products.product.id
$results = foreach ($device in $products) {
  $file = Join-Path $outPath ("T1Arc-$device" + $(if ($Tests) { '-tests' }) + '.prg')
  $arguments = @('-f', (Join-Path $PSScriptRoot 'monkey.jungle'), '-d', $device, '-y', $signingKey, '-o', $file, '-l', '0')
  if ($Tests) { $arguments += '-t' }
  & $compiler @arguments | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Garmin build failed for $device" }
  [pscustomobject]@{ Device=$device; Compiled=$true; Sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash }
}
$report = if ($Tests) { 'test-build-results.json' } else { 'build-results.json' }
$results | ConvertTo-Json | Set-Content (Join-Path $outPath $report)
$results | Format-Table
