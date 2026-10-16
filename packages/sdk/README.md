# Agent Commitments SDK

Experimental TypeScript/JavaScript primitives for shared USDC budgets on Arc. Prepare calldata, bind provider quotes to a stable commitment ID, inspect economic and transport states independently, and recover without creating a second payment. No hosted API, database or LLM is required.

The GitHub release archive includes the compiled network configuration; it has no workspace dependencies or install scripts. Node.js >=22 is required. The SDK is not yet published to the npm registry.

```sh
npm install https://github.com/duclucky/agent-commitments/releases/download/v0.1.0-alpha.1/agent-commitments-sdk-0.1.0-alpha.1.tgz
```

```javascript
import { createArcTestnetClient, deriveCommitmentId, arcTestnetDeployment }
  from "@agent-commitments/sdk";
import { keccak256, stringToHex } from "viem";

const client = createArcTestnetClient();
const grantId = keccak256(stringToHex("example-grant"));
const operationId = keccak256(stringToHex("example-operation"));
const id = deriveCommitmentId(client.chainId, client.vault, grantId, operationId);
const call = client.prepareDispatch(id);
console.log(call); // Prepared only. No signature or transaction broadcast.
```

Use `createArcMainnetPilotClient(reader)` to read the bound internal pilot. Its budget is empty; it is not a public funding pool. `arcMainnetCanaryDeployment` preserves the historical unbound snapshot and must not be used as current operational configuration.

All monetary amounts are bigint atomic units: 1 USDC = 1_000_000n. Arc's native 18-decimal gas interface and 6-decimal ERC-20 interface expose the same asset; never add the balances.

The source candidate `0.1.0-alpha.2` adds `ResolveSignalX402Session` for
ResolveSignal's existing x402 v2 exact API on Arc, using your existing Circle
wallet. The current API fee is 0.06 USDC (`60_000n`). No new contract, budget
deposit or adapter is required. Durable recovery state prevents an automatic
second purchase after a lost paid response. `CircleCliResolveSignalWallet` and
`FileResolveSignalSessionStore` are optional Node exports from
`@agent-commitments/sdk/resolvesignal-node`; browser code supplies its own wallet
adapter and private CAS store. See the [ResolveSignal guide](https://github.com/duclucky/agent-commitments/blob/main/docs/integrations/resolvesignal-x402.md).

That integration is locally verified, not present in the published alpha.1
archive above. Build with `pnpm pack:sdk` and install the generated alpha.2
archive locally. End-to-end testing uses the real API and escrow on an isolated
chain, with simulated Circle custody/CLI and model/facilitator. Live Circle paid
testing remains pending. Callers provide their wallet permissions and private
recovery/business-result storage. Direct wallet purchases bypass BudgetVault;
they do not inherit its hierarchical budget enforcement or accounting.

Read the [integration guide](https://github.com/duclucky/agent-commitments/blob/main/docs/integration.md), [SDK API reference](https://github.com/duclucky/agent-commitments/blob/main/docs/sdk-api.md) and [security policy](https://github.com/duclucky/agent-commitments/blob/main/SECURITY.md). Provider budget-envelope signatures remain ECDSA EOA only. The ERC-8183 Draft adapter covers only the documented subset. Independent security review is pending. This alpha is for experimentation, not a production safety claim.
