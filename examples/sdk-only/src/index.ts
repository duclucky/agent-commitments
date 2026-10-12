import {
  AgentCommitmentsClient,
  arcTestnet,
  arcTestnetDeployment,
  deriveCommitmentId,
} from "@agent-commitments/sdk";
import { keccak256, stringToHex } from "viem";

const vault = arcTestnetDeployment.budgetVault;
const adapter = arcTestnetDeployment.erc8183Adapter;
const grantId = keccak256(stringToHex("example-grant"));
const operationId = keccak256(stringToHex("example-operation"));
const commitmentId = deriveCommitmentId(arcTestnet.chainId, vault, grantId, operationId);
const client = new AgentCommitmentsClient(arcTestnet.chainId, vault, adapter);
const call = client.prepareDispatch(commitmentId);

console.log(JSON.stringify({
  mode: "prepare-only",
  note: "No transaction was signed or broadcast.",
  network: arcTestnet.name,
  commitmentId,
  call,
}, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));
