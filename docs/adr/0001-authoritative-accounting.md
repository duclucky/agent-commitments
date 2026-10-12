# ADR 0001: Authoritative budget accounting

Status: accepted for local alpha.

The vault contract is authoritative for `D = A + R + E + S + W`. Offchain storage is a rebuildable projection. Funding escrow moves `R -> E` atomically through the only approved adapter. A terminal completion moves `E -> S`; a verified refund moves `E -> A` without increasing `D`.

This design keeps uncertain or externally settled jobs conservative: they remain in `E` until onchain reconciliation. Direct token donations are surplus and do not credit a budget.
