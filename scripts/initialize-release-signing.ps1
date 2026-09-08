#Requires -Version 7.0
param(
  [ValidateSet('private-test', 'production')][string]$Profile = 'private-test',
  [string]$SigningRoot = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.t1arc-release\signing')
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Local key custody uses Windows DPAPI. Configure CI secrets directly on other systems.' }
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\') + '\'
$directory = [IO.Path]::GetFullPath((Join-Path $SigningRoot $Profile))
if ($directory.StartsWith($repository, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Signing keys must be outside the repository.'
}
[IO.Directory]::CreateDirectory($directory) | Out-Null
$userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = [Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($userSid)
$acl.SetAccessRuleProtection($true, $false)
$rule = [Security.AccessControl.FileSystemAccessRule]::new(
  $userSid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $directory -AclObject $acl

$kinds = if ($Profile -eq 'production') { @('app', 'faces') } else { @('faces') }
foreach ($kind in $kinds) {
  $store = Join-Path $directory "$kind.p12"
  $credentials = Join-Path $directory "$kind.credentials.clixml"
  $certificate = Join-Path $directory "$kind.cer"
  if ((Test-Path -LiteralPath $store) -or (Test-Path -LiteralPath $credentials)) {
    if (-not ((Test-Path -LiteralPath $store) -and (Test-Path -LiteralPath $credentials))) {
      throw "Incomplete $kind key setup. Existing material was not overwritten."
    }
    Write-Output "Retaining existing $Profile $kind key."
    continue
  }
  $password = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
  $securePassword = ConvertTo-SecureString -String $password -AsPlainText -Force
  $credential = [Management.Automation.PSCredential]::new('t1arc', $securePassword)
  $previous = $env:T1ARC_TEMP_KEY_PASSWORD
  try {
    $env:T1ARC_TEMP_KEY_PASSWORD = $password
    $generationArguments = @('-genkeypair', '-keystore', $store, '-storetype', 'PKCS12',
      '-alias', 't1arc', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10950',
      '-dname', 'CN=T1 Arc', '-storepass:env', 'T1ARC_TEMP_KEY_PASSWORD',
      '-keypass:env', 'T1ARC_TEMP_KEY_PASSWORD', '-noprompt')
    & keytool @generationArguments 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not generate $kind key." }
    $credential | Export-Clixml -LiteralPath $credentials
    & keytool -exportcert -keystore $store -alias t1arc -storepass:env T1ARC_TEMP_KEY_PASSWORD -file $certificate 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not verify $kind certificate." }
    $hash = (Get-FileHash -LiteralPath $certificate -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Output "$Profile $kind certificate SHA256: $hash"
  } finally {
    $env:T1ARC_TEMP_KEY_PASSWORD = $previous
    $password = $null
    $credential = $null
    $securePassword.Dispose()
  }
}
Write-Output 'Passwords are DPAPI-protected for this Windows account. This is NOT an independent recovery backup.'
