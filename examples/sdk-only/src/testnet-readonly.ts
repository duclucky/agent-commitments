import {
  arcTestnet,
  arcTestnetDeployment,
  createArcTestnetClient,
  createViemChainReader,
} from "@agent-commitments/sdk";
import { createPublicClient, http, keccak256, stringToHex } from "viem";
import { arcTestnet as viemArcTestnet } from "viem/chains";

const publicClient = createPublicClient({
  chain: viemArcTestnet,
  transport: http(arcTestnet.rpcUrl),
});
const client = createArcTestnetClient(createViemChainReader(publicClient));
const rootGrantId = keccak256(stringToHex("AGENT_COMMITMENTS_ROOT"));
const policy = await client.inspectPolicy({
  grantId: rootGrantId,
  provider: arcTestnetDeployment.budgetVault,
  evaluator: arcTestnetDeployment.budgetVault,
});

console.log(JSON.stringify({
  mode: "read-only",
  network: arcTestnet.name,
  deployment: arcTestnetDeployment,
  policy,
}, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));
