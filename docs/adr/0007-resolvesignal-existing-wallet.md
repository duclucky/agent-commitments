# ADR 0007: ResolveSignal through the existing Circle wallet

Date: 2026-10-16. Status: accepted user scope; supersedes ADR 0006.

The caller uses its existing Circle wallet to sign a request-bound admission
proof and pay the existing ResolveSignal x402 v2 exact endpoint on Arc. The
current service fee is 0.06 USDC. No new contract, allowance, grant, budget
deposit, Gateway balance or shared-network deployment is required.

The SDK owns input/quote validation and durable operation recovery. The Node
Circle CLI adapter invokes only admission signing, services inspect and services
pay with explicit POST, ARC, and an exact per-quote spending ceiling. Wallet
custody and policy remain with Circle. The existing seller factory/escrow handles
settlement and refund; SDK chain access is read-only.

The caller supplies a stable operation ID and private persistent storage. The
session records payment intent atomically before invoking the wallet. After a
lost paid response, recovery inspects the original call and escrow without
creating another purchase. A new operation ID is a new economic operation and
must not be used as a retry. Input/result data stay with the caller.

This direct wallet flow does not use BudgetVault and must not claim its D/A/R/E/S/W
accounting or hierarchical shared-budget enforcement. Circle wallet limits and
the SDK's per-call cap have their own scope. No production backend payment change
is needed. Public publication and real paid testing remain separate actions.
