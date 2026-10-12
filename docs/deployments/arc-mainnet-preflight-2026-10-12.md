# Arc mainnet deployment preflight — 2026-10-12

This document records the checks made before broadcast. The resulting BudgetVault-only canary deployment is recorded in [`arc-mainnet-2026-10-12.md`](arc-mainnet-2026-10-12.md).

## Verified network inputs

- Arc mainnet RPC: `https://rpc.mainnet.arc.io`
- Chain ID from live RPC: `5042`
- Explorer: `https://explorer.arc.io`
- USDC ERC-20 interface: `0x3600000000000000000000000000000000000000`
- USDC `decimals()` from live RPC: `6`
- Circle Agent Wallet selected as intended owner: `0x7329d0f937daa2f16ff0869c5e05a907a4c17dc2`
- Wallet balance at preflight: `0.02 USDC`. Arc exposes this same balance through the native 18-decimal gas view and ERC-20 6-decimal interface; it must not be double-counted.

The network and token values agree with the official Arc contract-address and connection documentation and with `circle blockchain list` / `circle contract address --chain ARC`.

## Candidate build evidence

- Forge `1.7.1`, Solidity `0.8.30`, optimizer 200 runs, EVM Cancun.
- `BudgetVault` creation bytecode: 14,529 bytes.
- `BudgetVault` runtime bytecode: 12,420 bytes.
- `BudgetVault` local runtime hash: `0xcd154d267e442cb115e1ed72ea6c272ad561ad796753e9a0acff53e9ca967e64`.
- Build, typecheck/lint, 14 domain tests, 23 SDK tests, 23 Foundry tests, 512 invariant fuzz runs, 6 failure-injection tests, 9 PostgreSQL integration tests, local-chain E2E, 375px keyboard browser E2E, deployment rehearsal, documentation checks and production dependency audit passed in the preflight run.

## Gates identified before broadcast

1. Arc documentation publishes an ERC-8183 reference only for Arc Testnet. The published testnet address `0x0747EEf0706327138c69792bF28Cd525089e4583` has zero code on Arc mainnet. `ERC8183Adapter` must not be deployed with that address or with the local test contract.
2. The independent review required by [`mainnet-readiness.md`](../runbooks/mainnet-readiness.md) has not been completed. The current review is a self-review and does not close this gate.
3. The initial wallet balance was insufficient for the estimated deployment. The fund owner subsequently authorized consolidation from the other four Agent Wallets and mainnet deployment.
4. Circle CLI `1.1.4` lists Arc mainnet and supports wallet balance plus contract-execution estimation, but the experimental `circle contract deploy --chain ARC --estimate` endpoint returned `INVALID_ARGUMENT` with “blockchain unsupported or deprecated.” Circle feedback reference: `dcb47a85-b642-5f16-8588-87a2bf84012c`.
5. A read-only fallback estimate through the deployed ERC-2470 Singleton Factory estimated `0.04967074775 USDC`, above the initial wallet balance of `0.02 USDC`. The first direct factory broadcast later failed inside `CREATE2`; the final deployment used a checked helper so this failure could not be silent.

## Deployment outcome

- Four source wallets transferred a total of `0.032 USDC` to the selected owner wallet.
- `BudgetVault` deployed at `0x2415a87B0b9280C1989F03ceA9DC1c3644777862` with a 1 USDC deposit cap, 0,1 USDC per-commitment cap, one concurrent commitment and root expiry `2027-01-10T00:00:00Z`.
- The vault is unfunded, has a zero ledger and has no adapter. No payment lifecycle can be dispatched.

Independent review and a verified Arc mainnet escrow remain gates for deploying/binding an adapter and funding the vault. Source publication and any mainnet smoke lifecycle are separate actions.

Later update on 2026-10-12: a self-hosted escrow and versioned draft adapter v2 were deployed unbound/unfunded after user authorization. The technical design is recorded in ADR 0005 and the actual transactions in `arc-mainnet-2026-10-12.md`. An official reference address remains unavailable; independent review still gates one-time binding and funding.
