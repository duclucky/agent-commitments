// Independent SDK consumer: read-only, no signer or broadcast.
import { readFile } from "node:fs/promises";
import { createPublicClient, http } from "viem";
import { arc } from "viem/chains";
import { createArcMainnetPilotClient, createViemChainReader } from "../packages/sdk/dist/index.js";
const journal = JSON.parse(await readFile("deployments/arc-mainnet-pilot-evidence.json", "utf8"));
const publicClient = createPublicClient({ chain: arc, transport: http("https://rpc.mainnet.arc.io") });
if (await publicClient.getChainId() !== 5042) throw new Error("Wrong chain");
const client = createArcMainnetPilotClient(createViemChainReader({
  readContract: request => publicClient.readContract(request),
  getBlockNumber: () => publicClient.getBlockNumber(),
  getTransactionReceipt: request => publicClient.getTransactionReceipt(request),
  simulateContract: request => publicClient.simulateContract(request),
}));
const [refund, settled, funding] = await Promise.all([
  client.inspectRefundRecovery(journal.quotes.refund.commitmentId, journal.steps["refund-reconcile"].hash),
  client.inspect(journal.quotes.settle.commitmentId, journal.steps["settle-reconcile"].hash),
  client.inspectVaultFunding(),
]);
if (refund.state !== "REFUNDED" || settled.economicStatus !== "SETTLED" || settled.transportState !== "CONFIRMED"
  || funding.physicalBalance !== 0n || funding.backingShortfall !== 0n || funding.unassignedBalance !== 0n) throw new Error("SDK mainnet evidence mismatch");
console.log(JSON.stringify({ chainId:5042, readOnly:true, refund:refund.state, settlement:settled.economicStatus, settlementTransport:settled.transportState, funding }, (_,value)=>typeof value === "bigint" ? String(value) : value,2));
