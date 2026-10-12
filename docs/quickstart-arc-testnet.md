# Arc Testnet quickstart

Node >=22, pnpm 10.15.1 and Foundry 1.7.1 are required for the full local workflow. Read-only commands do not require funding or a signer.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm example:sdk
pnpm test:local-chain
pnpm example:testnet-readonly
pnpm verify:arc-testnet
```

`example:sdk` is prepare-only. `test:local-chain` runs the entire lifecycle on its own Anvil process with local MockUSDC and escrow fixtures, then stops it. The last two commands query the real Arc Testnet stack without signing or broadcasting.

Arc Testnet chain 5042002, RPC https://rpc.testnet.arc.io. The [manifest](../deployments/arc-testnet.json) records the vault, adapter and pinned reference escrow. ERC-20 USDC is 6 decimals; native gas is another 18-decimal interface to the same USDC.

Internal live testing covered settlement, reject/refund/reconciliation/withdrawal and distinct owner/provider/evaluator wallets. It is integration evidence, not customer traction. No budget is assumed available for a new task. Use your own authorized deployment/grant and verify parties, funds, expiry and fee scope before a shared-network write.

The Arc Testnet adapter pins the older reference ABI; do not use the mainnet Draft fund selector with it. See [integration](integration.md), [Circle executor](integrations/circle-wallets.md), [deployment evidence](deployments/arc-testnet-2026-10-11.md) and [threat model](threat-model.md).
