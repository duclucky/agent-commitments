# SDK API reference

Published archive: `0.1.0-alpha.1`. Source candidate: `0.1.0-alpha.2`, adding the
locally verified ResolveSignal x402 integration described below.

Import from `@agent-commitments/sdk` after installing the GitHub release archive. TypeScript declarations ship in the archive; runtime uses viem 2.57.4. No UI, hosted API, database or Circle credentials are needed for prepare/read operations.

## Entry points

| Export | Purpose |
|---|---|
| createArcTestnetClient(reader?) | Pinned Arc Testnet vault/reference adapter |
| createArcMainnetPilotClient(reader?) | Bound v2 internal mainnet pilot |
| AgentCommitmentsClient(chainId, vault, adapter, reader?, escrow?) | Configure a supported Arc deployment |
| createViemChainReader(client) | Adapt readContract/getTransactionReceipt/getBlockNumber/simulateContract |
| quoteTypedData(chainId, vault, quote) | EIP-712 signing payload; does not sign |
| deriveCommitmentId(chainId, vault, grantId, operationId) | Stable economic identity |
| arcTestnetDeployment / arcMainnetPilotDeployment | Public deployment addresses |
| arcMainnetCanaryDeployment | Historical unbound snapshot; not current pilot |

## Prepared calls

Every prepare method returns `{chainId, to, data, value:0n}`. It does not query authority, sign, broadcast or guarantee success. Monetary arguments are bigint atomic ERC-20 units; IDs and hashes are 0x-prefixed bytes32 values.

| Method | Arguments |
|---|---|
| prepareDepositApproval / prepareDeposit | amount: bigint |
| prepareGrant | object: grantId, parentId, grantee, cap, expiresAt, providers?, evaluators? |
| prepareRevoke | grantId |
| prepareSetPaused | boolean |
| prepareReserve | Quote, providerSignature |
| prepareDispatch / prepareFund / prepareReconcile / prepareCancelReservation | commitmentId |
| prepareProviderBudget | jobId, amount, escrow? |
| prepareSubmit | jobId, deliverableHash, escrow? |
| prepareComplete / prepareReject | jobId, reasonHash, escrow? |
| prepareClaimRefund | jobId, escrow? |
| prepareWithdrawAvailable | recipient, amount |

`submit(preparedCall, externalSigner)` invokes the injected signer's `sendTransaction(call)` and returns `{hash,state:"SUBMITTED"}`. No key or credential is stored by the SDK. The caller must obtain spending authorization and verify the resulting receipt/state.

## Inspection

- `inspect(commitmentId, transactionHash?)`: economicState/economicStatus, transportState, ledger, reservation, jobId, escrowStatus, escrowJob, recoveryActions and observation metadata. Reader getBlockNumber pins contract getters when supplied.
- `inspectPolicy({grantId,provider,evaluator})`: immutable caps, active commitments and effective party permissions read from chain.
- `inspectVaultFunding()`: physicalBalance, recordedBacking, unassignedBalance and backingShortfall. Requires a pinned block, correct token/6 decimals and conserving ledger.
- `inspectRefundRecovery(commitmentId,previousHash?)`: state, reason code, amount and inspection. Requires pinned simulation to return READY.
- `prepareRefundReconciliation(commitmentId,previousHash?)`: fresh recovery check; returns calldata only if READY, otherwise throws.

Read-only failure is not proof that a transaction failed. A missing receipt is UNKNOWN; other RPC failures propagate. Receipt canonicality belongs to the reader/application. Refund simulation success does not credit the budget.

`CircleWalletsExecutor` accepts an injected Circle Developer-Controlled Wallets client, walletId and optional feeLevel. `submit`, `inspect` and `waitForFinality` preserve the existing transaction identity. This executor permits only ARC-TESTNET; Circle COMPLETE is transport finality, not an economic acceptance decision.

Use the [integration guide](integration.md) and [standalone starter](../examples/sdk-starter/README.md). The current provider signature path is ECDSA EOA only; full ERC-8183 conformance and live bridge routes remain unsupported.

## ResolveSignal x402 source candidate

`ResolveSignalX402Session({payer,operationId,wallet,store,reader,seller?,baseUrl?,fetch?,now?})`
uses an existing wallet to call the existing x402 API. It requires no new contract,
BudgetVault funding or grant. Methods:

- `call(request,{salt,maxFeeAtomic,confirmPaidCall,resumeQuote?})`: admits, validates,
  inspects and pays once under explicit scope. The caller owns business-result storage.
- `recover()`: read-only original-call and seller-escrow inspection. Never signs,
  pays, deploys or credits a budget.

`resolveSignalWorkHash(request,salt)` binds a canonical JSON request to a private
32-byte salt. `validateResolveSignalQuote(quote,binding,policy)` verifies x402 v2
exact against independent chain data and a bigint spending cap.

`verifyResolveSignalSeller(reader,seller)` and
`readResolveSignalBinding(reader,seller,escrow)` pin Arc chain 5042, existing
seller code/roles, USDC decimals and factory lookup. These functions only read.

`CircleCliResolveSignalWallet` and `FileResolveSignalSessionStore(directory)` are
Node-only exports from `@agent-commitments/sdk/resolvesignal-node`. The wallet uses
an already installed/authenticated Circle CLI; the private store implements atomic
create/CAS. The store-only subpath `./resolvesignal-node-store` is also available.
Browser consumers supply their own `ResolveSignalWallet` and store.

Direct wallet spending bypasses BudgetVault and does not inherit its accounting
or grant guarantees. All existing contracts/deployments and provider-signature
support remain unchanged. See the [full guide](integrations/resolvesignal-x402.md)
for lifecycle, recovery and local verification scope.
