# Arc Mainnet read-only quickstart

No signer, Circle credentials, approval, deposit or broadcast is needed. The internal pilot's available budget is zero; it is not a shared public pool.

```sh
pnpm install --frozen-lockfile
pnpm --filter @agent-commitments/network-config build
pnpm example:mainnet-pilot-readonly
pnpm console:mainnet
```

Open `http://127.0.0.1:4173/?mode=mainnet`; use CONSOLE_PORT for another loopback port. Local demo is explicitly selected with `?mode=demo`. Snapshot age over two minutes or RPC failure clears verified amounts and requests a new read. The API exposes selected public receipt/ID fields, never the operator journal, quote signatures, raw signed transactions or credentials.

## In a separate SDK project

Install the release archive as described in the [SDK README](../packages/sdk/README.md). Save this as `inspect.mjs` and run `node inspect.mjs`:

```javascript
import {createPublicClient,http} from "viem";
import {arc} from "viem/chains";
import {createArcMainnetPilotClient,createViemChainReader} from "@agent-commitments/sdk";
const rpc=createPublicClient({chain:arc,transport:http("https://rpc.mainnet.arc.io")});
if(await rpc.getChainId()!==5042) throw new Error("Wrong chain");
const sdk=createArcMainnetPilotClient(createViemChainReader({
  readContract:request=>rpc.readContract(request),
  getBlockNumber:()=>rpc.getBlockNumber(),
  getTransactionReceipt:request=>rpc.getTransactionReceipt(request),
}));
const funding=await sdk.inspectVaultFunding();
console.log(JSON.stringify(funding,(_,v)=>typeof v==="bigint"?String(v):v,2));
```

For combined snapshots, pin all inspections to one block and independently verify canonicality as in the [console collector](../scripts/mainnet-console-snapshot.mjs). The SDK's basic reader does not perform canonical receipt validation.

## Evidence and limits

Arc Mainnet chain 5042, RPC https://rpc.mainnet.arc.io, USDC ERC-20 `0x3600000000000000000000000000000000000000` with 6 decimals. Native gas uses 18 decimals for the same asset; never sum balances.

The [manifest](../deployments/arc-mainnet.json) pins addresses/code hashes. [Public pilot evidence](../deployments/arc-mainnet-pilot-evidence.json) contains 19 receipt records and stable job IDs. Final atomic ledger: D=10000, A=R=E=0, S=W=5000. Refund funds were reused; total deposit was only 0.01 USDC. Owner also evaluated these internal jobs; none count as external traction.

Run `forge build --root contracts` then `pnpm verify:arc-mainnet` for source/runtime/receipt verification. ECDSA EOA providers only, documented ERC-8183 Draft subset, independent review pending, no direct-vault-transfer recovery. See [threat model](threat-model.md) and [recovery](runbooks/recovery.md) before building write flows.
