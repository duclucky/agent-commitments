# Call ResolveSignal with an existing Circle wallet

The SDK calls ResolveSignal's existing x402 v2 exact service on Arc using the
caller's existing Circle wallet. The current fee is **0.06 USDC**, or `60_000n`
ERC-20 atomic units. No new contract, BudgetVault deposit, adapter, approval or
Gateway balance is required. The existing ResolveSignal escrow remains in use.

**Status, 2026-10-16:** SDK `0.1.0-alpha.2` is an unpublished source candidate.
The real V2 HTTP application and seller escrow have been tested locally on Anvil,
with simulated Circle custody/CLI, model and facilitator. Live Circle paid testing
for this client and independent review remain pending. No user funds were spent.

## How it works

1. Prepare a normal structured ResolveSignal request. No LLM is required in the
   calling application. The caller retains authority to execute the recommendation.
2. Use the existing Circle wallet to sign a request-bound admission proof. This
   proof admits the request for pre-payment validation and does not spend USDC.
3. Receive HTTP 402 after admission. Validate x402 v2 exact, Arc chain 5042,
   USDC, fee cap, original request hash, resource URL and expiry. Independent chain
   reads verify the existing seller factory, code hash, roles and per-call escrow.
4. Inspect the paid endpoint with Circle CLI, then call `services pay` once with
   explicit POST, `--chain ARC` and a maximum equal to the exact quoted amount.
   Circle handles the payment authorization and the existing x402 payment flow.
5. Save the returned business result privately. Use `recover()` to inspect the
   original service call and escrow when interrupted. It never purchases again.

The integration spends directly from the wallet. It **does not use BudgetVault**,
update its ledger or inherit its grant/shared-budget enforcement. Circle wallet
limits remain separate. SDK spending caps apply to each call through this client.

## Install and use

Build this checkout with `pnpm pack:sdk`, then install the generated
`.release/agent-commitments-sdk-0.1.0-alpha.2.tgz` in your application. The earlier
published alpha.1 archive does not include this integration. Node.js >=22 and
an already installed/authenticated Circle CLI are required for the Node adapter.
The SDK does not install the CLI, accept terms, log in, create/fund a wallet or
change wallet policy.

```typescript
import {createPublicClient,http,keccak256,stringToHex,type Address,type Hex} from "viem";
import {arc} from "viem/chains";
import {ResolveSignalX402Session} from "@agent-commitments/sdk";
import {CircleCliResolveSignalWallet,FileResolveSignalSessionStore}
  from "@agent-commitments/sdk/resolvesignal-node";

declare const payer:Address; // Your existing Circle wallet on Arc.
declare const request:unknown; // A current, valid V2 request.
declare const salt:Hex; // Private random bytes32, persisted with the operation.
const operationId=keccak256(stringToHex("your-stable-business-operation-id"));
const session=new ResolveSignalX402Session({
  payer,operationId,
  wallet:new CircleCliResolveSignalWallet(),
  store:new FileResolveSignalSessionStore("/private/resolvesignal-recovery"),
  reader:createPublicClient({chain:arc,transport:http("https://rpc.mainnet.arc.io")}),
});

// Run only after the application/user authorizes this paid operation.
const response=await session.call(request,{
  salt,maxFeeAtomic:60_000n,confirmPaidCall:true,
});
// Persist response in your application's private business-result storage.

// After an interruption, recreate the same session with the same operation ID:
const original=await session.recover(); // Read-only. No signature or payment.
```

The Node adapter uses argv-only subprocesses with no shell. It invokes admission
signing, service inspection and service payment; no wallet execute, transfer,
contract deployment or Gateway command is used. Private keys and Circle sessions
stay in Circle's existing tooling. Provider error text is not reflected in SDK
errors. A browser application can implement the exported `ResolveSignalWallet`
interface and its own durable CAS store instead of importing the Node adapter.

## Recovery and privacy

- Reuse the same operation ID, salt and private store after restart. Changing the
  operation ID creates a new purchase identity and is not a retry.
- Recovery state stores financial/request identifiers, quote and admission proof,
  not the request payload or result. Keep the entire directory private and out of
  Git, web roots, logs and public backups. Admission proofs/request keys are sensitive.
- State is persisted with atomic create/CAS before wallet/payment side effects.
  The Node store uses exclusive locks, file fsync and atomic rename; POSIX also
  syncs the directory. Newly created POSIX entries use 0700/0600 modes. Configure
  private ACLs separately on Windows. Multi-host deployments need a transactional store.
- A crash-held lock fails closed. Establish that the process is stopped and inspect
  persisted state before removing only that stale lock. Never reset payment flags.
- If an unpaid quote response is lost, `resumeQuote:true` explicitly resends the
  same request with the same keys. Changed input under the operation is rejected.
- After payment intent is recorded, `call()` refuses another purchase, even when
  the wallet times out or the response is lost. Use `recover()` and the Circle
  payment log to inspect the original payment. Do not rerun `services pay` blindly.
- An expired local worker or HTTP error is not refund evidence. Seller escrow
  status and wallet/token receipts determine the financial outcome. `recover()`
  reports status; it never credits a budget or asserts that a refund was received
  merely because an HTTP response says so. Existing seller refund rules apply.
- A paid quality-failure HTTP response may be reported as a Circle CLI error;
  recovery still inspects that original call and its refund path.
- Result retention/retrieval is governed by the service and caller. Financial
  recovery cannot recreate a lost business result. Persist delivered output promptly.

The default seller configuration pins the existing mainnet factory and roles,
verified read-only on 2026-10-16. A code/role change fails closed and requires
reviewed configuration. Test overrides must not be silently used as production
fallbacks. Acceptance/completion remains the existing seller operator's assertion,
not an independent proof of decision quality. See [ADR 0007](../adr/0007-resolvesignal-existing-wallet.md).

## Verification

```sh
pnpm --filter @agent-commitments/sdk typecheck
pnpm --filter @agent-commitments/sdk test
pnpm test:sdk-package
pnpm check:docs
```

The loopback-only `scripts/resolvesignal-api-e2e.mjs` is driven by
`tests/test_commitments_x402_bridge.py` in the ResolveSignal operational checkout.
Build this SDK, set `AGENT_COMMITMENTS_ROOT` to this checkout and run that pytest
test there. It tests successful delivery, quality-failure refund and a lost paid
response followed by restart. Each scenario invokes one paid command and creates
no Agent Commitments contracts or deposits. The existing seller factory creates
its normal per-call escrow locally. The Circle CLI/custody boundary, facilitator
and model are simulated; this is not a live Circle/mainnet payment claim.
