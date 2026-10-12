# Recovery runbook

## UNKNOWN transaction

1. Stop replacement broadcasts for the operation.
2. Recover expectedHash from the signed transaction persisted before broadcast.
3. Query its receipt on the correct chain and verify the canonical block.
4. If success, read vault/adapter/escrow state directly before marking transport CONFIRMED.
5. If reverted, mark REVERTED; retain economic state according to chain.
6. If absent, preserve UNKNOWN and poll with backoff. Never create another payment ID.

Broadcast and receipt reconciliation have separate leases. A missing receipt or RPC failure schedules another read, not another broadcast. After a worker dies in SENDING, query expectedHash once its lease expires; the reference runtime conservatively avoids automatic rebroadcast.

## Projection mismatch or reorg

Block write orchestration that relies on an incorrect projection without blocking on-chain reconciliation. Preserve a database copy for investigation. Replay ordered events from a canonical checkpoint, deduplicate `(chainId,txHash,logIndex)` and compare all ledger fields with the vault.

PostgresProjectionStore persists checkpoints and can rebuild. `replaceFromBlock` atomically replaces a changed range; conflicting payloads for the same identity are rejected. Open writes only after authoritative state matches.

## Revoke/pause

Revoke/pause block new reserve/dispatch/fund actions. They cannot seize funded provider obligations. Complete/refund/reconcile remain available under contract rules; owners withdraw only A.

## Blocked or unknown refund

Read reservation/job at one block. A Rejected/Expired job with FUNDED reservation remains E; it is not available budget. Check any previous unknown transaction hash before a retry.

Use `inspectRefundRecovery` with getBlockNumber and simulateContract. BLOCKED/SIMULATION_REVERTED proves a simulation failure, not its issuer-blocklist cause. Missing snapshot/simulation or RPC failure is UNKNOWN. Check authoritative token/contract restrictions; no local bypass or unblock-time guarantee exists.

After the cause is resolved, obtain fresh evidence. `prepareRefundReconciliation` returns calldata only for READY and the same commitment ID. Record returned funds only after receipt and vault state confirm REFUNDED. Simulation at one block does not guarantee future success. HTTP callbacks, database flags and donated tokens are not refund evidence.

## Direct vault transfers and backing

Supported funding is exact approval → confirmed receipt → deposit → confirmed receipt and ledger. `inspectVaultFunding` verifies 6-decimal token/binding/conservation and balanceOf(vault) against A+R at one block. E has left the vault and must not be subtracted again.

Excess physical tokens are unassigned, not automatically budget credit or proof of a particular sender. The current vault has no rescue for direct transfers. If backing is below A+R, stop new obligations and investigate; do not alter database balances to hide the shortfall.

## Orphan Open job

An unfunded reservation can be cancelled by its authorized caller while an already-dispatched Open job remains. claimRefund applies to funded/submitted jobs, not Open jobs. The current adapter cannot reject Open on behalf of its client. Such orphan jobs hold no USDC and funding after cancellation is blocked; label them rather than creating another payment.
