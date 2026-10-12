param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z0-9-]+$')]
  [string]$Role
)

$ErrorActionPreference = "Stop"

$walletDirectory = Join-Path $env:USERPROFILE ".agent-commitments\arc-testnet"
$keystore = Join-Path $walletDirectory $Role
$encryptedPassword = "$keystore.password.dpapi"

if ((Test-Path -LiteralPath $keystore) -or (Test-Path -LiteralPath $encryptedPassword)) {
  if ((Test-Path -LiteralPath $keystore) -and (Test-Path -LiteralPath $encryptedPassword)) {
    throw "Role wallet '$Role' already exists. Refusing to overwrite it."
  }
  throw "Role wallet '$Role' is only partially present. Repair it manually before retrying."
}

New-Item -ItemType Directory -Path $walletDirectory -Force | Out-Null

$passwordBytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(48)
$plainPassword = [Convert]::ToBase64String($passwordBytes)
$passwordBytes = $null

function Invoke-NodeKeystoreGenerator {
  $node = (Get-Command node -ErrorAction Stop).Source
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $node
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.Environment["AGENT_COMMITMENTS_KEYSTORE_PASSWORD"] = $plainPassword
  $startInfo.ArgumentList.Add((Join-Path $PSScriptRoot "create-encrypted-keystore.mjs"))
  $startInfo.ArgumentList.Add($keystore)

  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (!$process.Start()) { throw "Unable to start cast" }
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw (($stdout + [Environment]::NewLine + $stderr).Trim()) }
  return $stdout.Trim()
}

try {
  $generatedAddress = Invoke-NodeKeystoreGenerator
  if (!(Test-Path -LiteralPath $keystore)) { throw "keystore generator did not create the expected file" }

  $securePassword = ConvertTo-SecureString $plainPassword -AsPlainText -Force
  $protectedPassword = ConvertFrom-SecureString $securePassword
  [IO.File]::WriteAllText($encryptedPassword, $protectedPassword, [Text.UTF8Encoding]::new($false))

  $passwordFile = Join-Path $env:TEMP ("agent-commitments-" + [guid]::NewGuid().ToString("N") + ".pwd")
  [IO.File]::WriteAllText($passwordFile, $plainPassword, [Text.UTF8Encoding]::new($false))
  $addressOutput = & cast wallet address --keystore $keystore --password-file $passwordFile 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($addressOutput -join [Environment]::NewLine) }
  $address = ($addressOutput -join "`n").Trim()
  if ($address -notmatch '^0x[0-9a-fA-F]{40}$') { throw "cast returned an invalid wallet address" }
  if ($address.ToLowerInvariant() -ne $generatedAddress.ToLowerInvariant()) { throw "keystore verification returned a different address" }

  [ordered]@{
    role = $Role
    address = $address
    keystore = $keystore
    passwordStorage = "Windows DPAPI"
  } | ConvertTo-Json
} catch {
  if (Test-Path -LiteralPath $keystore) { Remove-Item -LiteralPath $keystore -Force }
  if (Test-Path -LiteralPath $encryptedPassword) { Remove-Item -LiteralPath $encryptedPassword -Force }
  throw
} finally {
  if ($passwordFile -and (Test-Path -LiteralPath $passwordFile)) {
    [IO.File]::WriteAllText($passwordFile, "")
    Remove-Item -LiteralPath $passwordFile -Force
  }
  $plainPassword = $null
  $securePassword = $null
  $protectedPassword = $null
}
