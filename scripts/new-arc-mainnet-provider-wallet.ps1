$ErrorActionPreference = "Stop"

# Mainnet provider signer creation only. No RPC, transaction or private-key output.
$walletDirectory = Join-Path $env:USERPROFILE ".agent-commitments\arc-mainnet"
$keystore = Join-Path $walletDirectory "pilot-provider"
$encryptedPassword = "$keystore.password.dpapi"
$metadata = "$keystore.public.json"
$present = @($keystore, $encryptedPassword, $metadata | Where-Object { Test-Path -LiteralPath $_ })
if ($present.Count -ne 0) {
  if ($present.Count -ne 3) { throw "Provider signer partially exists. Preserve and repair it; do not overwrite." }
  $existing = Get-Content -LiteralPath $metadata -Raw | ConvertFrom-Json
  if ($existing.chainId -ne 5042 -or $existing.address -notmatch '^0x[0-9a-fA-F]{40}$') { throw "Provider metadata invalid" }
  $existing | ConvertTo-Json
  exit 0
}
New-Item -ItemType Directory -Path $walletDirectory -Force | Out-Null
$passwordBytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(48)
$plainPassword = [Convert]::ToBase64String($passwordBytes)
[Array]::Clear($passwordBytes)
$passwordBytes = $null
try {
  # Persist the protected password first so a later failure cannot orphan an encrypted key.
  $protected = ConvertFrom-SecureString (ConvertTo-SecureString $plainPassword -AsPlainText -Force)
  [IO.File]::WriteAllText($encryptedPassword, $protected, [Text.UTF8Encoding]::new($false))
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = (Get-Command node -ErrorAction Stop).Source
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.Environment["AGENT_COMMITMENTS_KEYSTORE_PASSWORD"] = $plainPassword
  $startInfo.ArgumentList.Add((Join-Path $PSScriptRoot "create-encrypted-keystore.mjs"))
  $startInfo.ArgumentList.Add($keystore)
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (!$process.Start()) { throw "Keystore generator did not start" }
  $stdout = $process.StandardOutput.ReadToEnd().Trim()
  $null = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  $startInfo.Environment.Remove("AGENT_COMMITMENTS_KEYSTORE_PASSWORD") | Out-Null
  if ($process.ExitCode -ne 0) { throw "Keystore generator failed; partial encrypted files preserved for repair" }
  if ($stdout -notmatch '^0x[0-9a-fA-F]{40}$') { throw "Provider address invalid" }
  $record = [ordered]@{
    chainId = 5042
    role = "pilot-provider"
    address = $stdout
    generatedAt = [DateTimeOffset]::UtcNow.ToString("o")
    keyStorage = "Encrypted V3 keystore outside repository; password protected with Windows DPAPI"
    sharedNetworkTransactions = 0
  }
  [IO.File]::WriteAllText($metadata, ($record | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
  $record | ConvertTo-Json
} finally {
  $plainPassword = $null
  $protected = $null
  if ($startInfo) { $startInfo.Environment.Remove("AGENT_COMMITMENTS_KEYSTORE_PASSWORD") | Out-Null }
}
