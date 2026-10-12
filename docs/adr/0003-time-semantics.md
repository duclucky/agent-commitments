# ADR 0003: Time and expiry semantics

- Status: accepted for local alpha
- Date: 2026-10-09

## Decision

Quote, grant, reservation and escrow deadlines use EVM `block.timestamp`. Terms must use minutes/hours/days of tolerance, not second-level precision. A deadline determines whether a new obligation can be created and when escrow refund becomes claimable; it never proves service quality or network finality.

Validators can influence timestamps within consensus limits, so integrations must not depend on an exact second or use timestamps for randomness. UI and workers treat the onchain value as authoritative and display an approximate wall-clock time. A transaction near the boundary may validly revert and must be reconciled from its receipt/state.

## Consequences

Foundry lint reports `block-timestamp` at intentional deadline checks. These warnings are accepted for this design; any change to shorter, economically sensitive windows requires a new review. Internal worker timeouts cannot release escrow or replace these onchain deadlines.
