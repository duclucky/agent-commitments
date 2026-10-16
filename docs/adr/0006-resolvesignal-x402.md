# ADR 0006: Rejected contract-based ResolveSignal integration

Date: 2026-10-16. Status: rejected; superseded by [ADR 0007](0007-resolvesignal-existing-wallet.md).

The original proposal added a fresh BudgetVault, adapter and restricted payer
for ResolveSignal calls. The user clarified that the existing Circle wallet
should simply call the existing x402 API. No new contract or deposit is needed.

The proposed contracts and deployment script were removed before any shared-network
deployment or financial transaction. Existing Agent Commitments and ResolveSignal
contracts remain unchanged. Current implementation and verification concern the
direct-wallet client documented in [the integration guide](../integrations/resolvesignal-x402.md).
