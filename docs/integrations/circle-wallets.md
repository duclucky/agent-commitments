# Circle Developer-Controlled Wallets integration

Circle handles wallet custody/submission; Agent Commitments handles budget authority, reservations, economic IDs and reconciliation. This executor is distinct from the Agent Wallet CLI used in the mainnet pilot.

## Verified scope

- Optional example pins `@circle-fin/developer-controlled-wallets@9.2.0`.
- Contract execution accepts walletId, contractAddress, raw callData, fee and idempotencyKey.
- Executor is limited to chain 5042002 / ARC-TESTNET. Arc mainnet support was not verified for this integration in the reviewed material.
- Applications create and inject the Circle client; SDK does not own, log or persist API keys/entity secrets.
- Unit tests and compile-time quickstart are complete; this executor has not been broadcast-verified.

Sources: [contract execution API](https://developers.circle.com/api-reference/wallets/developer-controlled-wallets/create-developer-transaction-contract-execution), [transaction states](https://developers.circle.com/w3s/asynchronous-states-and-statuses), [confirmations](https://developers.circle.com/w3s/blockchain-confirmations).

## Prepare-only example

```sh
pnpm example:circle-wallets
```

By default it prepares a reviewable request, without reading credentials or sending a transaction. For integration into an authorized application:

```typescript
import {CircleWalletsExecutor} from "@agent-commitments/sdk";
const executor=new CircleWalletsExecutor(circleClient,walletId);
const call=commitments.prepareDispatch(commitmentId);
const submission=await executor.submit(call,{
  idempotencyKey:persistedCircleIdempotencyKey,
  refId:`dispatch:${operationId}`,
});
const transport=await executor.waitForFinality(submission.transactionId);
```

Create each idempotency key once and persist it before submission. Use different stable keys for dispatch, provider setBudget and fund; do not reuse one key with different payloads. The signed provider sets the exact budget before the orchestrating wallet funds the job.

| Circle state | SDK phase | Meaning |
|---|---|---|
| INITIATED / QUEUED / CLEARED / SENT | PENDING | Not final |
| CONFIRMED | MINED | Mined according to Circle, not final threshold |
| COMPLETE | FINALIZED | Circle confirmation threshold reached |
| FAILED / DENIED / CANCELLED | TERMINAL_FAILURE | Not necessarily an EVM revert |
| STUCK | UNKNOWN | Reconcile existing identity; no replacement payment |

`inspect` and `waitForFinality` poll an existing Circle transaction ID across restart; they never resubmit. Even FINALIZED describes transport only. Read the authoritative vault/escrow state before showing payment success.

The optional example's submit branch requires `ALLOW_SHARED_NETWORK_BROADCAST=ARC-TESTNET` plus Circle credentials, wallet/deployment inputs and a persisted idempotency key. Do not enable it merely to test installation. The [example environment template](../../examples/circle-wallets/.env.example) documents these variables; keep real values in an external secret store.

## EOA versus SCA quote providers

BudgetVault uses ECDSA.recover, not ERC-1271. A provider must be the EOA matching the signed EIP-712 quote. Signing with an SCA backing EOA while claiming the SCA address as provider is invalid. SCA owner/grantee/evaluator transaction authority does not imply provider quote-signature support. Adding ERC-1271 needs a reviewed design and a new non-upgradeable vault deployment.
