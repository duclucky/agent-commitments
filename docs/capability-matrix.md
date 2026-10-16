# Capability matrix

Verified 2026-10-12 from official Arc and Circle documentation plus read-only RPC. This document records support claims; it does not authorize transactions.

| Capability | Arc mainnet | Arc testnet | Project decision |
|---|---|---|---|
| EVM JSON-RPC | Chain `5042`, `https://rpc.mainnet.arc.io` | Chain `5042002`, `https://rpc.testnet.arc.io` | Built-in `arc`/`arcTestnet` definitions from viem |
| Explorer | `https://explorer.arc.io` | `https://explorer.testnet.arc.io` | Link only after matching chain and receipt |
| USDC accounting | ERC-20 view at `0x3600000000000000000000000000000000000000`, 6 decimals; native gas view is 18 decimals | Same documented address and representation | Domain and contracts use 6-decimal atomic units; native view is gas only |
| ERC-8183 reference | No official reference address verified. Self-hosted escrow and draft adapter v2 are bound; limited internal pilot complete, budget empty | Reference proxy at `0x0747EEf0706327138c69792bF28Cd525089e4583`; implementation `0xa316fd02827242d537f84730f8a37d0ba5fd351a`, verified 2026-10-11 | Separate adapters pin Arc reference `fund(uint256,bytes)` and draft `fund(uint256,uint256,bytes)` reviewed 2026-10-12; see ADR 0005, no general or future draft conformance claim |
| Circle Developer-Controlled Wallets | No Arc mainnet support evidence found in the reviewed Wallets material | Official quickstart creates an EOA wallet on Arc Testnet; contract execution accepts raw calldata and idempotency key | SDK executor and pinned `9.2.0` quickstart; testnet only, credentials remain in the integrating app, no Circle broadcast performed |
| Circle Agent Wallet CLI | Mainnet session, balance, native transfers and raw contract execution verified. Experimental direct contract-deployment endpoint returned `INVALID_ARGUMENT` for `ARC`; BudgetVault canary was deployed through raw execution and a checked CREATE2 helper | Agent wallets and contract deployment are exposed by the CLI | Raw execution is evidenced for this canary; do not claim the direct deployment endpoint works until feedback `dcb47a85-b642-5f16-8588-87a2bf84012c` is resolved |
| Gateway / Nanopayments | Not verified for Arc mainnet in this release | Documented in Agent Stack materials | Out of local alpha; no compatibility claim |
| CCTP/App Kit Bridge | Route and contract addresses require a separate release check | Arc documentation exposes bridge workflows | M7 disabled until a route manifest and recovery test exist |
| AP2 | Off-chain protocol, no Arc-specific deployment needed | Same | Schema inspiration only; no AP2 compliance claim |
| ResolveSignal x402 v2 exact (2026-10-16) | Existing seller factory/escrow; SDK uses the existing Circle wallet; seller runtime and roles verified read-only | No deployed integration claim | Client locally tested through real V2 HTTP routes and seller escrow with simulated Circle custody/CLI, model and facilitator. No new contract or BudgetVault funding; live Circle paid testing pending. See ADR 0007 and integration guide |

Sources:

- https://docs.arc.io/arc/references/connect-to-arc
- https://docs.arc.io/arc/tutorials/create-your-first-erc-8183-job
- https://docs.arc.io/integrate/infrastructure/indexing-events
- https://developers.circle.com/llms.txt
- https://developers.circle.com/api-reference/wallets/developer-controlled-wallets/create-developer-transaction-contract-execution
- https://developers.circle.com/w3s/asynchronous-states-and-statuses
- https://eips.ethereum.org/EIPS/eip-8183

Skills may change over time. This release uses the documented network configuration and recorded read-only evidence rather than treating a skill snapshot as deployment authority.

The detailed 2026-10-12 checks are recorded in [`deployments/arc-mainnet-preflight-2026-10-12.md`](deployments/arc-mainnet-preflight-2026-10-12.md) and the resulting vault-only canary in [`deployments/arc-mainnet-2026-10-12.md`](deployments/arc-mainnet-2026-10-12.md).
