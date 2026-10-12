# ADR 0002: ERC-8183-compatible adapter boundary

Status: accepted for Arc testnet reference integration; broader ERC-8183 conformance pending.

The project does not reimplement job semantics inside the budget vault. A dedicated adapter binds one commitment to one ERC-8183-style escrow job and acts as the client/refund recipient. Local tests use a pinned-compatible contract in this repository so accounting and recovery can be verified without a network transaction.

The Arc reference requires the provider, rather than the client, to call `setBudget`. Funding therefore uses a three-transaction handshake with the provider's explicit price confirmation:

1. `dispatch(commitmentId)` creates an open job whose provider, evaluator, expiry and description hash are bound to the signed reservation. No funds move and the reservation stays reserved.
2. The quoted provider calls `setBudget(jobId, signedAmount, "")` directly on the pinned escrow.
3. `fund(commitmentId)` verifies every binding and the exact budget, atomically consumes the reservation, grants only the exact temporary allowance, funds escrow and clears the allowance.

This preserves the provider-controlled pricing rule without trusting an off-chain status. A cancelled reservation can leave an unfunded open reference job, but it cannot be funded through the adapter and does not affect vault accounting.

The Arc testnet adapter pins the ABI exposed by Circle's deployed reference at `0x0747EEf0706327138c69792bF28Cd525089e4583`, verified 2026-10-11. In particular, that deployment lets only the provider set the budget, uses `fund(uint256,bytes)` and returns a nine-field `Job` tuple from `getJob(uint256)`. This differs from the current ERC-8183 draft text, which describes an `expectedBudget` parameter. The adapter therefore claims compatibility only with this Arc reference deployment/version.

No AP2 or general ERC-8183 conformance claim is made. Before targeting another deployment, pin its address, implementation code hash and ABI, then rerun the integration suite.
