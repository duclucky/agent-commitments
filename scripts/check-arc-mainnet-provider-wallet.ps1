$ErrorActionPreference = "Stop"
$walletDirectory = Join-Path $env:USERPROFILE ".agent-commitments\arc-mainnet"
$keystore = Join-Path $walletDirectory "pilot-provider"
$encryptedPassword = "$keystore.password.dpapi"
$metadata = Get-Content -LiteralPath "$keystore.public.json" -Raw | ConvertFrom-Json
$temporaryPasswordPath = Join-Path $walletDirectory ("verify-" + [guid]::NewGuid().ToString("N") + ".pwd")
try {
  $plainPassword = (Get-Content -LiteralPath $encryptedPassword -Raw).Trim() |
    ConvertTo-SecureString | ConvertFrom-SecureString -AsPlainText
  [IO.File]::WriteAllText($temporaryPasswordPath, $plainPassword, [Text.UTF8Encoding]::new($false))
  $plainPassword = $null
  $fileAcl = Get-Acl -LiteralPath $temporaryPasswordPath
  $fileAcl.SetAccessRuleProtection($true, $false)
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $fileAcl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, "FullControl", "Allow"))
  Set-Acl -LiteralPath $temporaryPasswordPath -AclObject $fileAcl
  $output = & cast wallet address --keystore $keystore --password-file $temporaryPasswordPath 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Cannot decrypt provider keystore; no secret output included" }
  $address = ($output -join "`n").Trim()
  if ($address -notmatch '^0x[0-9a-fA-F]{40}$' -or $address.ToLowerInvariant() -ne $metadata.address.ToLowerInvariant()) {
    throw "Provider keystore address mismatch"
  }
  [ordered]@{ verifiedAt = [DateTimeOffset]::UtcNow.ToString("o"); chainId = 5042; address = $address; encryptedKeystoreVerified = $true; broadcast = $false } | ConvertTo-Json
} finally {
  $plainPassword = $null
  if (Test-Path -LiteralPath $temporaryPasswordPath) {
    [IO.File]::WriteAllText($temporaryPasswordPath, "")
    Remove-Item -LiteralPath $temporaryPasswordPath
  }
}
