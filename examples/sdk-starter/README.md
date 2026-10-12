# Standalone SDK starter

Copy `index.mjs` into a new directory **outside** the monorepo. Node >=22 is required.

```sh
npm init -y
npm install https://github.com/duclucky/agent-commitments/releases/download/v0.1.0-alpha.1/agent-commitments-sdk-0.1.0-alpha.1.tgz
node index.mjs
```

This offline example only prepares calldata. Its IDs are illustrative, not existing on-chain grants. Preparing a call is not authorization to submit it. No database, Circle credentials, LLM, UI or signer is needed.

For the complete on-chain lifecycle with local fixtures, clone the monorepo, install dependencies and Foundry, then run `pnpm test:local-chain`. It starts and stops its own Anvil instance: deposit → grant → signed reserve → dispatch → provider setBudget → fund → submit → complete → reconcile. It verifies the ledger and provider payout and never broadcasts to Arc. MockUSDC/LocalAgenticCommerce are explicitly local fixtures. See [integration](../../docs/integration.md) for role and retry semantics.

`pnpm test:sdk-package` checks a fresh npm consumer, ESM import and TypeScript declarations. Use the [mainnet read-only quickstart](../../docs/quickstart-arc-mainnet.md) to inspect real evidence without sending a transaction.
