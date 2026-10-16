# Changelog

## 0.1.0-alpha.2 candidate, unpublished

- ResolveSignal x402 v2 exact client using an existing Circle wallet, with no new contracts or budget deposit.
- SDK quote/chain validation, request binding, private durable session state and no automatic purchase retry.
- Circle CLI adapter pins POST, ARC and the exact quote amount; recovery inspects the original call and seller escrow.
- Node-only wallet/file-store exports and local HTTP/chain integration harness.

Locally verified on Anvil with simulated Circle custody/CLI, model and facilitator.
No live Circle paid verification or independent review for this client. Direct
wallet payments bypass BudgetVault accounting and do not inherit its guarantees.

## 0.1.0-alpha.1 — 2026-10-12

First public experimental builder release; no fabricated earlier release history.

- BudgetVault: hierarchical grants, signed quotes, provider/evaluator restrictions and immutable exposure caps.
- Separate testnet reference/mainnet ERC-8183 Draft adapters and non-upgradeable escrow candidate.
- Prepare-only SDK, typed inspection, refund simulations and physical backing checks.
- Standalone SDK archive with embedded network configuration and isolated npm-consumer validation.
- PostgreSQL outbox/projection, reference auth API, provider/document examples and English console.
- Internal testnet and limited mainnet evidence, excluded from customer traction.
- English public onboarding, integration/security guidance and standalone starter.

Independent review, full ERC-8183 conformance, ERC-1271 providers, live CCTP routes and hosted production operation remain pending.
