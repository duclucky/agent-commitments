param(
  [string]$RpcUrl = "https://rpc.testnet.arc.io",
  [string]$Owner = "0x2503A16442F21B3B01f04EFd5205EE8B04F9bb79",
  [string]$Vault = "0x0A1AbBf8b795e30F305C54C53A2404a595aF923a",
  [string]$Adapter = "0x18EF2ad61947800e9F3574b65cee4fd2b4361a4a",
  [string]$Escrow = "0x0747EEf0706327138c69792bF28Cd525089e4583",
  [string]$Usdc = "0x3600000000000000000000000000000000000000",
  [uint64]$Amount = 100000,
  [string]$ResumeCommitmentId = "",
  [ValidateSet("Complete", "Reject")]
  [string]$Outcome = "Complete"
)

$ErrorActionPreference = "Stop"
if ($env:ALLOW_SHARED_NETWORK_BROADCAST -ne "ARC-TESTNET") {
  throw "Set ALLOW_SHARED_NETWORK_BROADCAST=ARC-TESTNET to run the live smoke flow."
}

$keystore = Join-Path $env:USERPROFILE ".agent-commitments\arc-testnet\deployer"
$encryptedPassword = Join-Path $env:USERPROFILE ".agent-commitments\arc-testnet\deployer.password.dpapi"
if (!(Test-Path -LiteralPath $keystore) -or !(Test-Path -LiteralPath $encryptedPassword)) {
  throw "Arc Testnet deployer keystore is unavailable."
}

$passwordFile = Join-Path $env:TEMP ("agent-commitments-" + [guid]::NewGuid().ToString("N") + ".pwd")
$transactions = [ordered]@{}

function Invoke-Cast([string[]]$CastArguments) {
  $output = & cast @CastArguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output -join [Environment]::NewLine) }
  return ($output -join "`n").Trim()
}

function Send-Transaction([string]$Name, [string]$To, [string]$Signature, [string[]]$CallArguments) {
  $arguments = @("send", $To, $Signature) + $CallArguments + @(
    "--rpc-url", $RpcUrl,
    "--from", $Owner,
    "--keystore", $keystore,
    "--password-file", $passwordFile,
    "--async"
  )
  $hash = Invoke-Cast $arguments
  $receipt = (Invoke-Cast @("receipt", $hash, "--rpc-url", $RpcUrl, "--json")) | ConvertFrom-Json
  if ($receipt.status -notin @("0x1", 1, "success")) { throw "$Name reverted: $hash" }
  $transactions[$Name] = $hash
  return $hash
}

try {
  $plainPassword = ((Get-Content -Raw -LiteralPath $encryptedPassword).Trim() |
    ConvertTo-SecureString | ConvertFrom-SecureString -AsPlainText)
  [IO.File]::WriteAllText($passwordFile, $plainPassword, [Text.UTF8Encoding]::new($false))
  $plainPassword = $null

  $chainId = Invoke-Cast @("chain-id", "--rpc-url", $RpcUrl)
  if ($chainId -ne "5042002") { throw "Unexpected chain ID $chainId" }
  $ledgerStart = (Invoke-Cast @(
    "call", $Vault, "ledger()((uint256,uint256,uint256,uint256,uint256,uint256))", "--rpc-url", $RpcUrl, "--json"
  )) | ConvertFrom-Json
  $activeStart = [uint64](Invoke-Cast @("call", $Vault, "activeCommitments()(uint256)", "--rpc-url", $RpcUrl))

  if ($ResumeCommitmentId) {
    if ($ResumeCommitmentId -notmatch '^0x[0-9a-fA-F]{64}$') { throw "ResumeCommitmentId must be bytes32 hex" }
    $commitmentId = $ResumeCommitmentId
    $reservationBefore = (Invoke-Cast @(
      "call", $Vault,
      "reservations(bytes32)((bytes32,address,address,uint256,uint256,bytes32,bytes32,uint8))",
      $commitmentId, "--rpc-url", $RpcUrl, "--json"
    )) | ConvertFrom-Json
    if ([string]$reservationBefore[7] -ne "1") { throw "Resume requires a RESERVED commitment" }
    $workHash = [string]$reservationBefore[5]
    $jobId = [string](((Invoke-Cast @(
      "call", $Adapter, "jobs(bytes32)(uint256)", $commitmentId, "--rpc-url", $RpcUrl, "--json"
    )) | ConvertFrom-Json)[0])
    $suffix = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()
    $expectedActive = $activeStart - 1
  } else {
    if ([uint64]$ledgerStart[2] -ne 0 -or [uint64]$ledgerStart[3] -ne 0 -or $activeStart -ne 0) {
      throw "Live smoke requires no existing reserved or in-escrow commitments"
    }
    $expectedActive = 0

    $block = (Invoke-Cast @("block", "latest", "--rpc-url", $RpcUrl, "--json")) | ConvertFrom-Json
    $timestamp = if ($block.timestamp -is [string] -and $block.timestamp.StartsWith("0x")) {
      [Convert]::ToInt64($block.timestamp.Substring(2), 16)
    } else { [int64]$block.timestamp }
    $grantExpiresAt = $timestamp + 86400
    $quoteExpiresAt = $timestamp + 1800
    $jobExpiresAt = $timestamp + 7200
    $suffix = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()
    $grantId = Invoke-Cast @("keccak", "agent-commitments-live-smoke-grant-$suffix")
    $operationId = Invoke-Cast @("keccak", "agent-commitments-live-smoke-operation-$suffix")
    $workHash = Invoke-Cast @("keccak", "agent-commitments-live-smoke-deliverable-$suffix")
    $nonce = Invoke-Cast @("keccak", "agent-commitments-live-smoke-nonce-$suffix")
    $rootGrantId = Invoke-Cast @("call", $Vault, "ROOT_GRANT_ID()(bytes32)", "--rpc-url", $RpcUrl)

    Send-Transaction "approve" $Usdc "approve(address,uint256)" @($Vault, $Amount.ToString()) | Out-Null
    Send-Transaction "deposit" $Vault "deposit(uint256)" @($Amount.ToString()) | Out-Null
    Send-Transaction "createGrant" $Vault "createGrant(bytes32,bytes32,address,uint256,uint256,address[],address[])" @(
      $grantId, $rootGrantId, $Owner, $Amount.ToString(), $grantExpiresAt.ToString(), "[$Owner]", "[$Owner]"
    ) | Out-Null

    $quoteTuple = "($grantId,$operationId,$Owner,$Owner,$Usdc,$Adapter,$Amount,$quoteExpiresAt,$jobExpiresAt,$workHash,$nonce)"
    $quoteDigest = Invoke-Cast @(
      "call", $Vault,
      "quoteDigest((bytes32,bytes32,address,address,address,address,uint256,uint256,uint256,bytes32,bytes32))(bytes32)",
      $quoteTuple, "--rpc-url", $RpcUrl
    )
    $providerSignature = Invoke-Cast @(
      "wallet", "sign", $quoteDigest, "--no-hash", "--keystore", $keystore, "--password-file", $passwordFile
    )
    Send-Transaction "reserve" $Vault "reserve((bytes32,bytes32,address,address,address,address,uint256,uint256,uint256,bytes32,bytes32),bytes)" @(
      $quoteTuple, $providerSignature
    ) | Out-Null

    $commitmentId = Invoke-Cast @(
      "call", $Vault, "commitmentId(bytes32,bytes32)(bytes32)", $grantId, $operationId, "--rpc-url", $RpcUrl
    )
    Send-Transaction "dispatch" $Adapter "dispatch(bytes32)" @($commitmentId) | Out-Null
    $jobId = [string](((Invoke-Cast @(
      "call", $Adapter, "jobs(bytes32)(uint256)", $commitmentId, "--rpc-url", $RpcUrl, "--json"
    )) | ConvertFrom-Json)[0])
  }
  if ($jobId -eq "0") { throw "Adapter did not bind an ERC-8183 job" }

  Send-Transaction "setBudget" $Escrow "setBudget(uint256,uint256,bytes)" @($jobId, $Amount.ToString(), "0x") | Out-Null
  Send-Transaction "fund" $Adapter "fund(bytes32)" @($commitmentId) | Out-Null
  if ($Outcome -eq "Complete") {
    Send-Transaction "submit" $Escrow "submit(uint256,bytes32,bytes)" @($jobId, $workHash, "0x") | Out-Null
    $reasonHash = Invoke-Cast @("keccak", "agent-commitments-live-smoke-accepted-$suffix")
    Send-Transaction "complete" $Escrow "complete(uint256,bytes32,bytes)" @($jobId, $reasonHash, "0x") | Out-Null
    Send-Transaction "reconcile" $Adapter "reconcile(bytes32)" @($commitmentId) | Out-Null
  } else {
    $reasonHash = Invoke-Cast @("keccak", "agent-commitments-live-smoke-rejected-$suffix")
    Send-Transaction "reject" $Escrow "reject(uint256,bytes32,bytes)" @($jobId, $reasonHash, "0x") | Out-Null
    Send-Transaction "reconcile" $Adapter "reconcile(bytes32)" @($commitmentId) | Out-Null
    Send-Transaction "withdrawRefund" $Vault "withdrawAvailable(address,uint256)" @($Owner, $Amount.ToString()) | Out-Null
  }

  $depositedExpected = [uint64]$ledgerStart[0] + $(if ($ResumeCommitmentId) { 0 } else { $Amount })
  $reservedExpected = [uint64]$ledgerStart[2] - $(if ($ResumeCommitmentId) { $Amount } else { 0 })
  if ($Outcome -eq "Complete") {
    $expectedLedger = @(
      $depositedExpected, [uint64]$ledgerStart[1], $reservedExpected, [uint64]$ledgerStart[3],
      ([uint64]$ledgerStart[4] + $Amount), [uint64]$ledgerStart[5]
    )
  } else {
    $expectedLedger = @(
      $depositedExpected, [uint64]$ledgerStart[1], $reservedExpected, [uint64]$ledgerStart[3],
      [uint64]$ledgerStart[4], ([uint64]$ledgerStart[5] + $Amount)
    )
  }

  $ledgerAfter = (Invoke-Cast @(
    "call", $Vault, "ledger()((uint256,uint256,uint256,uint256,uint256,uint256))", "--rpc-url", $RpcUrl, "--json"
  )) | ConvertFrom-Json
  $reservation = Invoke-Cast @(
    "call", $Vault,
    "reservations(bytes32)((bytes32,address,address,uint256,uint256,bytes32,bytes32,uint8))",
    $commitmentId, "--rpc-url", $RpcUrl
  )
  $job = Invoke-Cast @(
    "call", $Escrow,
    "getJob(uint256)((uint256,address,address,address,string,uint256,uint256,uint8,address))",
    $jobId, "--rpc-url", $RpcUrl
  )
  $activeCommitments = Invoke-Cast @("call", $Vault, "activeCommitments()(uint256)", "--rpc-url", $RpcUrl)
  if ((($ledgerAfter | ForEach-Object { [string]$_ }) -join ",") -ne (($expectedLedger | ForEach-Object { [string]$_ }) -join ",")) {
    throw "Final ledger mismatch: $($ledgerAfter -join ',')"
  }
  if ([uint64]$activeCommitments -ne $expectedActive) { throw "Active commitment was not released" }

  [ordered]@{
    chainId = [int]$chainId
    amountAtomic = $Amount.ToString()
    outcome = $Outcome
    commitmentId = $commitmentId
    jobId = $jobId
    ledger = @($ledgerAfter | ForEach-Object { [string]$_ })
    reservation = $reservation
    job = $job
    transactions = $transactions
  } | ConvertTo-Json -Depth 5
} finally {
  $plainPassword = $null
  if (Test-Path -LiteralPath $passwordFile) {
    [IO.File]::WriteAllText($passwordFile, "")
    Remove-Item -LiteralPath $passwordFile -Force
  }
}
