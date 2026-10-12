$ErrorActionPreference = "Stop"
if ($env:ALLOW_SOURCE_PUBLICATION -ne "ARC-TESTNET") {
  throw "Set ALLOW_SOURCE_PUBLICATION=ARC-TESTNET only after source publication is authorized."
}

& pnpm prepare:arc-testnet-verification
if ($LASTEXITCODE -ne 0) { throw "Source verification package preparation failed" }

$items = @(
  @{
    Address = "0x0A1AbBf8b795e30F305C54C53A2404a595aF923a"
    Contract = "src/BudgetVault.sol:BudgetVault"
    Args = "verification\arc-testnet\BudgetVault.constructor-args.txt"
  },
  @{
    Address = "0x18EF2ad61947800e9F3574b65cee4fd2b4361a4a"
    Contract = "src/ERC8183Adapter.sol:ERC8183Adapter"
    Args = "verification\arc-testnet\ERC8183Adapter.constructor-args.txt"
  }
)

foreach ($item in $items) {
  $constructorArgs = (Get-Content -Raw -LiteralPath $item.Args).Trim()
  & forge verify-contract $item.Address $item.Contract `
    --root contracts `
    --chain 5042002 `
    --compiler-version 0.8.30 `
    --num-of-optimizations 200 `
    --evm-version cancun `
    --constructor-args $constructorArgs `
    --verifier blockscout `
    --verifier-url https://explorer.testnet.arc.io/api/ `
    --watch
  if ($LASTEXITCODE -ne 0) { throw "Source verification failed for $($item.Contract)" }
}
