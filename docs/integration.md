# Integration guide

## Select the deployment

Use `createArcTestnetClient(reader)` for the pinned testnet stack or `createArcMainnetPilotClient(reader)` for the bound internal mainnet pilot. The historical canary export is unbound, not current operational configuration. Verify chain ID, token/decimals, code hashes, binding and signer authority against the [capability matrix](capability-matrix.md) and deployment manifest before using a shared network.

Money is bigint in TypeScript and integer strings in HTTP: 1 USDC = 1_000_000 ERC-20 units. Native 18-decimal gas is another interface to the same asset, not another balance.

## Roles and quote binding

The budget owner deposits and delegates. A grant authorizes its grantee within caps, expiry and provider/evaluator allowlists; child permissions cannot exceed the parent. The provider signs an EIP-712 quote binding chain, BudgetVault, grant, operation, provider, evaluator, token, adapter, amount, work hash, nonce and quote/job expiry. Provider quotes currently require ECDSA EOAs; ERC-1271 is unsupported.

Use `quoteTypedData(chainId, vault, quote)` and `deriveCommitmentId(chainId, vault, grantId, operationId)`. Keep one operation ID for retries. The same economic ID with different terms must be rejected. Use salted work commitments; do not put source documents or private job contents on-chain.

## Prepare, then submit through your signer

```typescript
import {createArcTestnetClient} from "@agent-commitments/sdk";
const client=createArcTestnetClient();
const approval=client.prepareDepositApproval(1_000_000n);
const deposit=client.prepareDeposit(1_000_000n);
// Send approval through an authorized external signer, wait for receipt,
// then send deposit. Preparing either call does not authorize spending.
```

The SDK holds no key. `submit(call, signer)` checks the prepared chain and returns SUBMITTED, not payment success. The integrating app owns signer permissions, credentials and fee policy. No shared-network transaction is sent by the starter, install or build.

## Lifecycle

| Step | Caller | Economic effect |
|---|---|---|
| approve exact amount → deposit | Owner | D and A increase only after deposit |
| createGrant | Authorized grant administrator | Constrained delegated authority |
| reserve signed quote | Authorized grantee/owner according to contract | A → R; ancestor capacity consumed |
| dispatch commitment | Authorized contract caller | Create one Open job; funds remain R |
| setBudget exact signed amount | Quote provider | Set job price; funds remain R |
| fund commitment | Authorized contract caller | R → E atomically with escrow funding |
| submit deliverable commitment | Provider | Escrow moves to Submitted |
| complete / reject | Evaluator or escrow-authorized role | Payout or refund under escrow terms |
| claimRefund after expiry | Escrow-authorized caller | Retrieve eligible expired funds |
| reconcile same commitment | Permissionless caller | Record authoritative terminal result once |
| withdrawAvailable | Owner | A → W; funded work is not withdrawable |

Use `prepareGrant`, `prepareReserve`, `prepareDispatch`, `prepareProviderBudget`, `prepareFund`, `prepareSubmit`, `prepareComplete`, `prepareReject`, `prepareClaimRefund`, `prepareReconcile` and `prepareWithdrawAvailable`. Contract roles are authoritative; a prepare method is not a permission check. Check [SDK API](sdk-api.md) for arguments.

Adapters pin separate testnet reference and ERC-8183 Draft fund selectors. Do not interchange their escrow ABIs or advertise general future Draft compliance. Read [ADR 0005](adr/0005-mainnet-agentic-commerce-escrow.md).

## Inspect and recover

```javascript
import {createViemChainReader,createArcMainnetPilotClient} from "@agent-commitments/sdk";
const reader=createViemChainReader({
  readContract:request=>publicClient.readContract(request),
  getTransactionReceipt:request=>publicClient.getTransactionReceipt(request),
  getBlockNumber:()=>publicClient.getBlockNumber(),
  simulateContract:request=>publicClient.simulateContract(request),
});
const client=createArcMainnetPilotClient(reader);
const inspection=await client.inspect(commitmentId,previousTxHash);
const backing=await client.inspectVaultFunding();
const recovery=await client.inspectRefundRecovery(commitmentId,previousTxHash);
if(recovery.state==="READY") {
  const prepared=await client.prepareRefundReconciliation(commitmentId,previousTxHash);
  // Fresh simulation and calldata only. No automatic broadcast.
}
```

`economicStatus` comes from the vault; `transportState` describes the queried transaction attempt. A hash alone is not success. UNKNOWN preserves the obligation; do not release funds or make another payment. The basic SDK reader does not independently establish receipt canonicality; the console reader performs that check. Pin multiple reads to one block when building a combined snapshot.

Refund states are AWAITING_ESCROW, READY, BLOCKED, UNKNOWN, REFUNDED and NOT_APPLICABLE. READY is simulation evidence, not returned money. Missing simulation/snapshot/RPC evidence prevents preparation. `physicalBalance` versus `recordedBacking=A+R` detects unassigned funds or shortfall separately from ledger conservation. E is outside the vault. Direct transfers never credit A. See [recovery](runbooks/recovery.md).

## Optional integrations

[Circle Developer-Controlled Wallets](integrations/circle-wallets.md) executor preserves calldata and requires persisted idempotency keys. It is testnet-only in this release and distinct from the Agent Wallet CLI used in the mainnet pilot.

The reference API has audience-bound, one-time wallet challenges and tenant-scoped sessions/operation intent. With DATABASE_URL it persists challenge/session hashes/idempotency in PostgreSQL; without it the memory development store is explicitly labelled. Public hosting still needs ingress limits, TLS, rotation, cleanup, backups and monitoring.

CCTP helpers (`createInboundFunding`, `advanceInboundFunding`, `nextInboundFundingAction`, `budgetCreditableAmount`) model burn → attestation → mint → deposit and reject conflicting evidence or credit before deposit. They do not implement a live executor/route. See [bridge recovery](runbooks/bridge-recovery.md).
