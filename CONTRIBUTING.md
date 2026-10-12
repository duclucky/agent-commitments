# Contributing

Focused improvements to reusable Arc payment primitives are welcome. Discuss custody, accounting, adapter or grant-model changes before implementation; these need an ADR and a security review plan.

Use Node >=22, pnpm 10.15.1 and Foundry 1.7.1. Install with `pnpm install --frozen-lockfile`. Keep lockfiles, compiler and reference interfaces pinned. See [local development](docs/runbooks/local-development.md).

Never commit keys, Circle credentials, customer documents or raw signed operator transactions. Fixed public Anvil keys belong only in loopback tests. Do not broadcast to shared networks while testing a contribution.

```sh
pnpm build
pnpm lint
pnpm test
pnpm test:invariants
pnpm test:failure
pnpm test:e2e
pnpm test:mainnet-console
pnpm test:sdk-package
pnpm check:docs
```

Run `pnpm test:integration` only with a dedicated disposable PostgreSQL test database; it drops/recreates public schema. For money, authority or recovery changes, add meaningful failure/regression coverage where practical. Preserve conservation, bigint money, stable IDs and on-chain authority. Update ABI/SDK/schema/docs together when interfaces change.

Explain concrete before/after behavior, validation and remaining risks. Keep product UI and primary builder docs in English. Do not claim full ERC-8183/AP2/x402 compliance without conformance evidence, or fabricate GitHub history, users or audits. Security reports follow [SECURITY.md](SECURITY.md). A PR does not guarantee acceptance or authorize deployment.
