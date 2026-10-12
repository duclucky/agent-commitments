param(
  [string]$RpcUrl = "https://rpc.testnet.arc.io",
  [string]$Owner = "0x2503A16442F21B3B01f04EFd5205EE8B04F9bb79",
  [string]$Vault = "0x0A1AbBf8b795e30F305C54C53A2404a595aF923a",
  [string]$Adapter = "0x18EF2ad61947800e9F3574b65cee4fd2b4361a4a",
  [string]$Escrow = "0x0747EEf0706327138c69792bF28Cd525089e4583",
  [string]$Usdc = "0x3600000000000000000000000000000000000000",
  [uint64]$Amount = 100000,
  [uint64]$RoleFundingTarget = 500000
)

$ErrorActionPreference = "Stop"
if ($env:ALLOW_SHARED_NETWORK_BROADCAST -ne "ARC-TESTNET") {
  throw "Set ALLOW_SHARED_NETWORK_BROADCAST=ARC-TESTNET to run the live multi-role flow."
}

$walletDirectory = Join-Path $env:USERPROFILE ".agent-commitments\arc-testnet"
$signers = [ordered]@{
  owner = [ordered]@{ address = $Owner; keystore = (Join-Path $walletDirectory "deployer"); encryptedPassword = (Join-Path $walletDirectory "deployer.password.dpapi") }
  provider = [ordered]@{ address = ""; keystore = (Join-Path $walletDirectory "provider"); encryptedPassword = (Join-Path $walletDirectory "provider.password.dpapi") }
  evaluator = [ordered]@{ address = ""; keystore = (Join-Path $walletDirectory "evaluator"); encryptedPassword = (Join-Path $walletDirectory "evaluator.password.dpapi") }
}

$passwordFiles = @{}
$transactions = [ordered]@{}

function Invoke-Cast([string[]]$CastArguments) {
  $output = & cast @CastArguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output -join [Environment]::NewLine) }
  return ($output -join "`n").Trim()
}

function Open-Signer([string]$Name) {
  $signer = $signers[$Name]
  if (!(Test-Path -LiteralPath $signer.keystore) -or !(Test-Path -LiteralPath $signer.encryptedPassword)) {
    throw "Missing encrypted $Name wallet. Run scripts/new-arc-testnet-role-wallet.ps1 for role wallets first."
  }
  $plainPassword = ((Get-Content -Raw -LiteralPath $signer.encryptedPassword).Trim() |
    ConvertTo-SecureString | ConvertFrom-SecureString -AsPlainText)
  $passwordFile = Join-Path $env:TEMP ("agent-commitments-" + [guid]::NewGuid().ToString("N") + ".pwd")
  [IO.File]::WriteAllText($passwordFile, $plainPassword, [Text.UTF8Encoding]::new($false))
  $plainPassword = $null
  $passwordFiles[$Name] = $passwordFile
  $address = Invoke-Cast @("wallet", "address", "--keystore", $signer.keystore, "--password-file", $passwordFile)
  if ($Name -eq "owner" -and $address.ToLowerInvariant() -ne $Owner.ToLowerInvariant()) {
    throw "Owner keystore does not match the configured owner"
  }
  $signer.address = $address
}

function Send-Transaction(
  [string]$Name,
  [string]$SignerName,
  [string]$To,
  [string]$Signature,
  [string[]]$CallArguments
) {
  $signer = $signers[$SignerName]
  $arguments = @("send", $To, $Signature) + $CallArguments + @(
    "--rpc-url", $RpcUrl,
    "--from", $signer.address,
    "--keystore", $signer.keystore,
    "--password-file", $passwordFiles[$SignerName],
    "--async"
  )
  $hash = Invoke-Cast $arguments
  $receipt = (Invoke-Cast @("receipt", $hash, "--rpc-url", $RpcUrl, "--json")) | ConvertFrom-Json
  if ($receipt.status -notin @("0x1", 1, "success")) { throw "$Name reverted: $hash" }
  $transactions[$Name] = [ordered]@{ hash = $hash; signer = $signer.address }
  return $hash
}

function Get-TokenBalance([string]$Address) {
  return [uint64](Invoke-Cast @("call", $Usdc, "balanceOf(address)(uint256)", $Address, "--rpc-url", $RpcUrl))
}

try {
  Open-Signer "owner"
  Open-Signer "provider"
  Open-Signer "evaluator"

  if ($signers.provider.address.ToLowerInvariant() -eq $signers.evaluator.address.ToLowerInvariant() -or
      $signers.provider.address.ToLowerInvariant() -eq $Owner.ToLowerInvariant() -or
      $signers.evaluator.address.ToLowerInvariant() -eq $Owner.ToLowerInvariant()) {
    throw "Owner, provider and evaluator wallets must be distinct"
  }

  $chainId = Invoke-Cast @("chain-id", "--rpc-url", $RpcUrl)
  if ($chainId -ne "5042002") { throw "Unexpected chain ID $chainId" }

  foreach ($role in @("provider", "evaluator")) {
    $balance = Get-TokenBalance $signers[$role].address
    if ($balance -lt $RoleFundingTarget) {
      $topUp = $RoleFundingTarget - $balance
      Send-Transaction "fund-$role-wallet" "owner" $Usdc "transfer(address,uint256)" @(
        $signers[$role].address, $topUp.ToString()
      ) | Out-Null
    }
  }

  $ledgerStart = (Invoke-Cast @(
    "call", $Vault, "ledger()((uint256,uint256,uint256,uint256,uint256,uint256))", "--rpc-url", $RpcUrl, "--json"
  )) | ConvertFrom-Json
  $activeStart = [uint64](Invoke-Cast @("call", $Vault, "activeCommitments()(uint256)", "--rpc-url", $RpcUrl))
  if ([uint64]$ledgerStart[2] -ne 0 -or [uint64]$ledgerStart[3] -ne 0 -or $activeStart -ne 0) {
    throw "Multi-role smoke requires no existing reserved or in-escrow commitments"
  }

  $block = (Invoke-Cast @("block", "latest", "--rpc-url", $RpcUrl, "--json")) | ConvertFrom-Json
  $timestamp = if ($block.timestamp -is [string] -and $block.timestamp.StartsWith("0x")) {
    [Convert]::ToInt64($block.timestamp.Substring(2), 16)
  } else { [int64]$block.timestamp }
  $grantExpiresAt = $timestamp + 86400
  $quoteExpiresAt = $timestamp + 1800
  $jobExpiresAt = $timestamp + 7200
  $suffix = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()
  $grantId = Invoke-Cast @("keccak", "agent-commitments-multi-role-grant-$suffix")
  $operationId = Invoke-Cast @("keccak", "agent-commitments-multi-role-operation-$suffix")
  $workHash = Invoke-Cast @("keccak", "agent-commitments-multi-role-deliverable-$suffix")
  $nonce = Invoke-Cast @("keccak", "agent-commitments-multi-role-nonce-$suffix")
  $rootGrantId = Invoke-Cast @("call", $Vault, "ROOT_GRANT_ID()(bytes32)", "--rpc-url", $RpcUrl)

  Send-Transaction "approve" "owner" $Usdc "approve(address,uint256)" @($Vault, $Amount.ToString()) | Out-Null
  Send-Transaction "deposit" "owner" $Vault "deposit(uint256)" @($Amount.ToString()) | Out-Null
  Send-Transaction "createGrant" "owner" $Vault "createGrant(bytes32,bytes32,address,uint256,uint256,address[],address[])" @(
    $grantId, $rootGrantId, $Owner, $Amount.ToString(), $grantExpiresAt.ToString(),
    "[$($signers.provider.address)]", "[$($signers.evaluator.address)]"
  ) | Out-Null

  $quoteTuple = "($grantId,$operationId,$($signers.provider.address),$($signers.evaluator.address),$Usdc,$Adapter,$Amount,$quoteExpiresAt,$jobExpiresAt,$workHash,$nonce)"
  $quoteDigest = Invoke-Cast @(
    "call", $Vault,
    "quoteDigest((bytes32,bytes32,address,address,address,address,uint256,uint256,uint256,bytes32,bytes32))(bytes32)",
    $quoteTuple, "--rpc-url", $RpcUrl
  )
  $providerSignature = Invoke-Cast @(
    "wallet", "sign", $quoteDigest, "--no-hash", "--keystore", $signers.provider.keystore,
    "--password-file", $passwordFiles.provider
  )
  Send-Transaction "reserve" "owner" $Vault "reserve((bytes32,bytes32,address,address,address,address,uint256,uint256,uint256,bytes32,bytes32),bytes)" @(
    $quoteTuple, $providerSignature
  ) | Out-Null

  $commitmentId = Invoke-Cast @(
    "call", $Vault, "commitmentId(bytes32,bytes32)(bytes32)", $grantId, $operationId, "--rpc-url", $RpcUrl
  )
  Send-Transaction "dispatch" "owner" $Adapter "dispatch(bytes32)" @($commitmentId) | Out-Null
  $jobId = [string](((Invoke-Cast @(
    "call", $Adapter, "jobs(bytes32)(uint256)", $commitmentId, "--rpc-url", $RpcUrl, "--json"
  )) | ConvertFrom-Json)[0])
  if ($jobId -eq "0") { throw "Adapter did not bind an ERC-8183 job" }

  Send-Transaction "setBudget" "provider" $Escrow "setBudget(uint256,uint256,bytes)" @(
    $jobId, $Amount.ToString(), "0x"
  ) | Out-Null
  Send-Transaction "fund" "owner" $Adapter "fund(bytes32)" @($commitmentId) | Out-Null
  Send-Transaction "submit" "provider" $Escrow "submit(uint256,bytes32,bytes)" @($jobId, $workHash, "0x") | Out-Null
  $reasonHash = Invoke-Cast @("keccak", "agent-commitments-multi-role-accepted-$suffix")
  Send-Transaction "complete" "evaluator" $Escrow "complete(uint256,bytes32,bytes)" @(
    $jobId, $reasonHash, "0x"
  ) | Out-Null
  Send-Transaction "reconcile" "owner" $Adapter "reconcile(bytes32)" @($commitmentId) | Out-Null

  $ledgerAfter = (Invoke-Cast @(
    "call", $Vault, "ledger()((uint256,uint256,uint256,uint256,uint256,uint256))", "--rpc-url", $RpcUrl, "--json"
  )) | ConvertFrom-Json
  $expectedLedger = @(
    ([uint64]$ledgerStart[0] + $Amount), [uint64]$ledgerStart[1], [uint64]$ledgerStart[2],
    [uint64]$ledgerStart[3], ([uint64]$ledgerStart[4] + $Amount), [uint64]$ledgerStart[5]
  )
  if ((($ledgerAfter | ForEach-Object { [string]$_ }) -join ",") -ne (($expectedLedger | ForEach-Object { [string]$_ }) -join ",")) {
    throw "Final ledger mismatch: $($ledgerAfter -join ',')"
  }

  $reservation = (Invoke-Cast @(
    "call", $Vault,
    "reservations(bytes32)((bytes32,address,address,uint256,uint256,bytes32,bytes32,uint8))",
    $commitmentId, "--rpc-url", $RpcUrl, "--json"
  )) | ConvertFrom-Json
  $job = (Invoke-Cast @(
    "call", $Escrow,
    "getJob(uint256)((uint256,address,address,address,string,uint256,uint256,uint8,address))",
    $jobId, "--rpc-url", $RpcUrl, "--json"
  )) | ConvertFrom-Json
  $activeAfter = [uint64](Invoke-Cast @("call", $Vault, "activeCommitments()(uint256)", "--rpc-url", $RpcUrl))
  if ([uint64]$reservation[7] -ne 3) { throw "Reservation did not reach Settled" }
  if ([uint64]$job[7] -ne 3) { throw "ERC-8183 job did not reach Completed" }
  if ($job[1].ToLowerInvariant() -ne $Adapter.ToLowerInvariant() -or
      $job[2].ToLowerInvariant() -ne $signers.provider.address.ToLowerInvariant() -or
      $job[3].ToLowerInvariant() -ne $signers.evaluator.address.ToLowerInvariant()) {
    throw "ERC-8183 job roles do not match the independent signers"
  }
  if ($activeAfter -ne 0) { throw "Active commitment was not released" }

  [ordered]@{
    chainId = [int]$chainId
    amountAtomic = $Amount.ToString()
    commitmentId = $commitmentId
    jobId = $jobId
    roles = [ordered]@{
      budgetOwner = $Owner
      escrowClient = $Adapter
      provider = $signers.provider.address
      evaluator = $signers.evaluator.address
    }
    ledger = @($ledgerAfter | ForEach-Object { [string]$_ })
    reservationStatus = [uint64]$reservation[7]
    jobStatus = [uint64]$job[7]
    roleBalances = [ordered]@{
      provider = (Get-TokenBalance $signers.provider.address).ToString()
      evaluator = (Get-TokenBalance $signers.evaluator.address).ToString()
    }
    transactions = $transactions
  } | ConvertTo-Json -Depth 6
} finally {
  foreach ($passwordFile in $passwordFiles.Values) {
    if ($passwordFile -and (Test-Path -LiteralPath $passwordFile)) {
      [IO.File]::WriteAllText($passwordFile, "")
      Remove-Item -LiteralPath $passwordFile -Force
    }
  }
}
