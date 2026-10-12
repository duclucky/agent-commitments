# Local development

## PostgreSQL

Integration tests need a **dedicated disposable** database. The runner drops/recreates public schema; never point TEST_DATABASE_URL at useful data.

On the original Windows workspace the native PostgreSQL 17 service uses port 55432 and database agent_commitments_test. Without that service, the runner starts Docker Compose PostgreSQL on loopback port 5432. Public local fixture credentials are agent_commitments/agent_commitments, not production credentials.

```sh
docker compose up -d postgres
pnpm test:integration
docker compose stop postgres
```

Do not delete the Compose volume if you need its data. For another dedicated test database, set TEST_DATABASE_URL explicitly.

## Local contracts

```sh
pnpm test:contracts
pnpm test:local-chain
pnpm test:browser-local-chain
pnpm test:deployment-rehearsal
```

Forge isolates its own chain. Local-chain/browser/rehearsal runners start and stop their own Anvil instances. Browser E2E verifies 375px layout, Tab/Enter flow, settlement, ledger conservation and receipt evidence. Fixed public keys are local-only; never copy them into shared-network configuration.

## Package validation

```sh
pnpm test:sdk-package
```

This creates an SDK tarball under `.release`, installs it into a separate npm project, runs the offline starter and checks TypeScript declarations. Release staging and consumer directories are ignored by Git. No npm publication, wallet access or shared-network broadcast occurs.
