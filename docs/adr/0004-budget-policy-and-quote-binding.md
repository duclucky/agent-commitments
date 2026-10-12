# ADR 0004: Immutable budget policy and explicit quote token binding

- Status: accepted for local alpha hardening
- Date: 2026-10-11

## Context

The local alpha enforced aggregate grant caps and expiry, but a grant could still select any provider or evaluator. Deployment also lacked explicit deposit, per-commitment and concurrent-obligation limits. The quote was bound to the vault, whose token is immutable, but did not carry the token address as an explicit signed field. These gaps make an integration harder to review and do not satisfy the documented delegation and pilot-cap policy.

An exact retry could also fail after pause or quote expiry even when the reservation already existed. That behavior did not create a duplicate payment, but it prevented a caller from obtaining the stable commitment ID for the same economic operation.

## Decision

Each vault receives immutable non-zero `depositCap`, `maxCommitmentAmount` and `maxConcurrentCommitments` constructor values. The root grant cap equals the deposit cap. `activeCommitments` counts reservations and funded jobs, then decreases only on cancellation, settlement or verified refund.

Each non-root grant is created with provider and evaluator allowlists. An empty list means unrestricted only when the parent is unrestricted. A restricted child list must be non-empty and a subset of its parent's list. Every reservation checks the effective restrictions at all grant levels.

The EIP-712 quote includes the immutable token and one-time-bound adapter addresses. The vault rejects a quote whose token or adapter differs from its configured path, and rejects new reservations before an adapter is bound.

For an existing commitment, the vault first checks the caller's grant authority and exact terms hash. An exact retry returns the existing ID even after pause, revocation or expiry; a different payload with the same operation ID always conflicts. This retry path changes no accounting state.

## Consequences

This is a breaking local-alpha ABI and deployment-constructor change. Contract ABI, SDK, examples, deployment scripts and tests must move together. Existing undeployed fixtures have no migration requirement. Any future change to caps or allowlist semantics requires a new deployment and ADR; the contract remains non-upgradeable.

The allowlists are onchain authorization controls, not provider quality or compliance claims. Circle Wallets remains a transaction/custody integration and does not override these vault policies.
