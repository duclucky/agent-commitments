# ADR 0005: Versioned self-hosted Agentic Commerce escrow candidate

Date: 2026-10-12

## Context

Arc's official contract-address page currently publishes an AgenticCommerce reference implementation only for Arc Testnet. The published testnet address has no code on Arc Mainnet. Binding the mainnet `BudgetVault` to that address, to `LocalAgenticCommerce`, or to an unverified third-party deployment would violate the project's fixed-adapter and code-hash requirements.

ERC-8183 remains Draft. The normative text reviewed on 2026-10-12 describes `fund(jobId, expectedBudget, optParams)` and optional provider assignment, while the current Arc Testnet reference uses the older `fund(jobId, optParams)` ABI and provider-only budget setting. One adapter cannot safely infer which version it is calling.

## Decision

Keep `ERC8183Adapter` and `IAgenticCommerce` pinned to the deployed Arc Testnet ABI. Add a separate mainnet candidate pair:

- `AgenticCommerceEscrow`: non-upgradeable, one six-decimal payment token, zero fees, no hooks, permissionless expiry refund, explicit escrow accounting and owner recovery limited to token balance above active obligations;
- `ERC8183DraftAdapter`: pinned to the 2026-10-12 draft selectors, including expected-budget binding during funding.

Dispatch admission checks every grant ancestor for existence, revocation and expiry before creating an external job, and checks the reservation expiry. Fund admission remains authoritative in `BudgetVault.consumeReservation`. A funded job can still settle or refund after revocation. The first unbound adapter candidate did not enforce the grant checks at dispatch; it is superseded by candidate v2 and must never be bound.

The escrow pause blocks creating, pricing, assigning or funding new obligations. It does not block submission, completion, rejection or expiry refund for funded jobs. Direct token transfers do not create job credit and only the excess above `totalEscrowed` can be recovered.

The candidate may be deployed unbound and unfunded for bytecode verification. Binding it to the mainnet vault is irreversible and remains gated on independent review because `BudgetVault.setAdapter` can only succeed once.

### Explicit limited-pilot exception — 2026-10-12

After reviewing the Studio/self-review evidence, remaining limitations, pilot calldata and fee scope, the human owner explicitly authorized an exception to the independent-review gate for this internal pilot only. Scope: bind candidate v2 once, deposit a total of 0.01 USDC, use a newly created encrypted mainnet provider EOA and the Circle owner as evaluator, and cap the entire pilot's fees at 0.30 USDC. The owner then funded the wallet. This exception does not claim an independent audit occurred, authorize unrestricted production capital, or change any contract authority/accounting. See the deployment execution-scope record and persistent pilot journal for the actual outcome.

## Consequences

- Testnet integration remains reproducible against Circle's published reference without pretending its ABI is the current draft.
- Mainnet integration has a small, inspectable dependency without upgrade or fee-admin risk.
- The project must publish the exact draft date, ABI and code hash. It must not claim compatibility with future ERC-8183 revisions.
- Hooks, platform fees, evaluator fees, meta-transactions and upgradeability are out of scope for this pilot.
- A severe review finding requires a new escrow/adapter deployment before binding; a severe vault finding requires a new vault deployment.

Sources checked on 2026-10-12:

- https://docs.arc.io/arc/references/contract-addresses
- https://docs.arc.io/arc/tutorials/create-your-first-erc-8183-job
- https://eips.ethereum.org/EIPS/eip-8183
