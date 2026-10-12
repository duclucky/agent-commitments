# Architecture

Agent Commitments separates authoritative money state from operational projections.

```text
owner / agent signer
        |
        v
  SDK (prepare + inspect)
        |
        +----> BudgetVault ----> versioned adapter ----> AgenticCommerce escrow
        |          |                    |
        |          +-- D/A/R/E/S/W      +-- commitment <-> external job
        |
        +----> API / outbox / worker / indexer
                         |
                         +----> PostgreSQL projection
```

`BudgetVault` owns deposits, grants, reservations and conservation accounting. The adapter is the only allowed route from a reservation to a job. The escrow owns the funded work lifecycle. The database stores requests and projections for recovery and queries; it cannot release money. `PostgresProjectionStore` deduplicates `(chainId, txHash, logIndex)`, persists canonical block hashes/checkpoints and replaces an affected block range atomically when the indexer detects a reorg.

The SDK exposes semantic operations and a prepare-only mode. A signer may be a browser wallet, hardware-backed signer or another approved implementation. Neither the SDK nor runtime stores an owner private key.

`ERC8183Adapter` pins the older ABI deployed by the official Arc Testnet reference. `ERC8183DraftAdapter` pins the ERC-8183 Draft interface reviewed on 2026-10-12 and pairs with the non-upgradeable `AgenticCommerceEscrow` candidate. The two adapters remain separate because silently probing a fund selector could move money through the wrong semantics.

Economic and transaction states are deliberately separate. A broadcast timeout produces `UNKNOWN`; it never restores available funds or creates a replacement operation. Broadcast and receipt reconciliation use separate leases; a missing receipt schedules a later poll and never triggers another broadcast. Reconciliation reads the vault and escrow before updating the projection.
