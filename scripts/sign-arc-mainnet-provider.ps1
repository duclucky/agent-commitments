param(
  [Parameter(Mandatory = $true)][ValidateSet("quote", "transaction")][string]$Mode,
  [string]$Digest,
  [string]$To,
  [string]$Data,
  [string]$Nonce,
  [string]$GasLimit,
  [string]$GasPriceWei
)
$ErrorActionPreference = "Stop"
$walletDirectory = Join-Path $env:USERPROFILE ".agent-commitments\arc-mainnet"
$keystore = Join-Path $walletDirectory "pilot-provider"
$metadata = Get-Content -LiteralPath "$keystore.public.json" -Raw | ConvertFrom-Json
$temporaryPasswordPath = Join-Path $walletDirectory ("sign-" + [guid]::NewGuid().ToString("N") + ".pwd")
try {
  if ($metadata.chainId -ne 5042) { throw "Signer network mismatch" }
  $plainPassword = (Get-Content -LiteralPath "$keystore.password.dpapi" -Raw).Trim() | ConvertTo-SecureString | ConvertFrom-SecureString -AsPlainText
  [IO.File]::WriteAllText($temporaryPasswordPath, $plainPassword, [Text.UTF8Encoding]::new($false))
  $plainPassword = $null
  $fileAcl = Get-Acl -LiteralPath $temporaryPasswordPath
  $fileAcl.SetAccessRuleProtection($true, $false)
  $fileAcl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.WindowsIdentity]::GetCurrent().User, "FullControl", "Allow"))
  Set-Acl -LiteralPath $temporaryPasswordPath -AclObject $fileAcl
  $common = @("--keystore", $keystore, "--password-file", $temporaryPasswordPath)
  if ($Mode -eq "quote") {
    if ($Digest -notmatch '^0x[0-9a-fA-F]{64}$') { throw "Invalid quote digest" }
    $castArgs = @("wallet", "sign", $Digest, "--no-hash") + $common
  } else {
    if ($To.ToLowerInvariant() -ne '0x19e14a1006d106882d4c24584aaa6ce1771e4151' -or $Data -notmatch '^0x[0-9a-fA-F]+$') { throw "Unsupported provider contract call" }
    foreach ($value in @($Nonce, $GasLimit, $GasPriceWei)) { if ($value -notmatch '^\d+$') { throw "Invalid transaction quantity" } }
    # setBudget(uint256,uint256,bytes), submit(uint256,bytes32,bytes) only.
    $budgetSelector = (& cast sig 'setBudget(uint256,uint256,bytes)').Trim()
    $submitSelector = (& cast sig 'submit(uint256,bytes32,bytes)').Trim()
    if (!$Data.StartsWith($budgetSelector) -and !$Data.StartsWith($submitSelector)) { throw "Provider action not authorized" }
    if ([bigint]$GasLimit -gt 500000 -or [bigint]$GasPriceWei -gt 100000000000) { throw "Provider transaction cap exceeded" }
    $castArgs = @("mktx", $To, $Data, "--chain", "5042", "--rpc-url", "https://rpc.mainnet.arc.io", "--from", $metadata.address,
      "--nonce", $Nonce, "--gas-limit", $GasLimit, "--gas-price", $GasPriceWei, "--value", "0", "--legacy") + $common
  }
  $output = & cast @castArgs 2>&1
  if ($LASTEXITCODE -ne 0) { throw "External signer failed; no secret output included" }
  $result = ($output -join "`n").Trim()
  if ($result -notmatch '^0x[0-9a-fA-F]+$') { throw "External signer returned invalid data" }
  Write-Output $result
} finally {
  $plainPassword = $null
  if (Test-Path -LiteralPath $temporaryPasswordPath) {
    [IO.File]::WriteAllText($temporaryPasswordPath, "")
    Remove-Item -LiteralPath $temporaryPasswordPath
  }
}
