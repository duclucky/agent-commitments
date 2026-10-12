# Threat model

## Assets and trust boundaries

Protected assets are prefunded USDC, grant authority, signed quotes, job deliverables and private tenant metadata. Smart contracts are authoritative for money. A configured evaluator is trusted only to decide the result described by the signed terms; it is not proof that the result is objectively correct.

## Required defenses

- Conservation: deposited funds equal available, reserved, in-escrow, settled and withdrawn totals.
- Delegation attenuation: a child cannot expand its parent's cap, expiry or allowlists.
- Exposure limits: immutable deposit, per-commitment and concurrent-obligation caps bound each vault deployment.
- Replay protection: signatures bind chain, verifying contract, budget, grant, provider, evaluator, token, amount, work commitment, nonce and expiry.
- Exactly-once economic effects: retries reuse one operation ID; a commitment maps to at most one escrow job and one terminal reconciliation.
- Fail-closed uncertainty: timeouts and missing receipts preserve the obligation.
- Restricted calls: agents cannot choose arbitrary adapter targets, calldata or unlimited allowances.
- Recovery: pause blocks new obligations while settlement, refund and reconciliation remain possible.
- Escrow backing: `totalEscrowed` cannot be withdrawn by the owner; only tokens sent directly above active obligations are recoverable as excess.
- Privacy: documents stay offchain; low-entropy metadata is committed with a random salt and logs are redacted.

## Explicit non-guarantees

- The protocol does not control payments made from unrelated wallets.
- A payment receipt does not prove service quality.
- A dishonest or unavailable evaluator can delay or decide a job according to the escrow's configured authority.
- Local and testnet evidence is not a security audit or mainnet-readiness claim.
- Cross-chain and hosted Circle capabilities are unsupported until their release gates are completed.
- ERC-8183 is Draft. Compatibility is limited to the explicitly pinned ABI/date; the Arc Testnet reference and mainnet candidate use separate adapters.
- Provider quote verification currently supports ECDSA EOAs only, not ERC-1271 contract wallets. Circle SCA transaction execution does not imply SCA quote-signature support.
- Issuer/network restrictions can block token transfers and refund liveness. Obligations remain outstanding while transfers fail; no promised unblock time or accounting bypass exists.
- Direct vault transfers are unassigned funds, not deposits; the current vault has no rescue for them. Orphan Open jobs can remain after cancellation without holding USDC.
