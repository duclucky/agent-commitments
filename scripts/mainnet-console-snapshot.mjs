// No wallet, signer, credentials or broadcast. Only allowlisted public evidence leaves this module.
import { readFile } from "node:fs/promises";
import { createPublicClient, http, keccak256, parseAbi } from "viem";
import { arc } from "viem/chains";
import { createArcMainnetPilotClient, createViemChainReader } from "../packages/sdk/dist/index.js";
const ledgerKeys = ["deposited", "available", "reserved", "inEscrow", "settled", "withdrawn"];
const fundingKeys = ["physicalBalance", "recordedBacking", "unassignedBalance", "backingShortfall"];

export async function readMainnetConsoleSnapshot() {
  const [manifest, journal] = await Promise.all([
    readFile(new URL("../deployments/arc-mainnet.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../deployments/arc-mainnet-pilot-evidence.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const chain = createPublicClient({ chain:arc, transport:http("https://rpc.mainnet.arc.io", {timeout:10_000,retryCount:1}) });
  if (await chain.getChainId() !== 5042) throw new Error("Wrong chain");
  const block = await chain.getBlock();
  const blockAge = Date.now() - Number(block.timestamp) * 1000;
  if (blockAge > 120_000 || blockAge < -30_000) throw new Error("Stale RPC head");
  const contracts = [manifest.budgetVault, manifest.draftCandidate.adapter, manifest.draftCandidate.escrow];
  await Promise.all(contracts.map(async contract => {
    const code = await chain.getCode({address:contract.address,blockNumber:block.number});
    if (!code || keccak256(code) !== contract.codeHash) throw new Error("Contract code mismatch");
  }));
  const bound = await chain.readContract({address:manifest.budgetVault.address,abi:parseAbi(["function adapter() view returns (address)"]),functionName:"adapter",blockNumber:block.number});
  if (bound.toLowerCase() !== manifest.draftCandidate.adapter.address.toLowerCase()) throw new Error("Binding mismatch");
  const reader = createViemChainReader({
    readContract: request => chain.readContract(request),
    getBlockNumber: async () => block.number,
    getTransactionReceipt: async request => {
      let receipt;
      try { receipt = await chain.getTransactionReceipt(request); }
      catch (error) { if (error?.name === "TransactionReceiptNotFoundError") return undefined; throw error; }
      if (receipt.blockNumber > block.number) return undefined;
      const canonical = await chain.getBlock({blockNumber:receipt.blockNumber});
      if (canonical.hash !== receipt.blockHash || receipt.transactionHash.toLowerCase() !== request.hash.toLowerCase()) return undefined;
      return receipt;
    },
  });
  const sdk = createArcMainnetPilotClient(reader);
  const [funding, ...inspections] = await Promise.all([
    sdk.inspectVaultFunding(),
    ...["refund", "settle"].map(kind => sdk.inspect(journal.quotes[kind].commitmentId, journal.steps[`${kind}-reconcile`].hash)),
  ]);
  // Guard against a reorg while the pinned calls were in flight.
  if ((await chain.getBlock({blockNumber:block.number})).hash !== block.hash) throw new Error("Snapshot reorg");
  const operations = inspections.map((inspection,index) => {
    const kind = ["refund","settle"][index];
    const reservation = inspection.reservation;
    if (typeof reservation.amount !== "bigint" || typeof reservation.provider !== "string" || !inspection.jobId) throw new Error("Missing reservation");
    return { commitmentId:journal.quotes[kind].commitmentId, provider:reservation.provider, amount:String(reservation.amount), economicStatus:inspection.economicStatus, transportState:inspection.transportState, escrowStatus:inspection.escrowStatus, jobId:String(inspection.jobId), transactionHash:journal.steps[`${kind}-reconcile`].hash };
  });
  return { chainId:5042, readOnly:true, observedBlock:String(block.number), observedAt:new Date().toISOString(),
    ledger:Object.fromEntries(ledgerKeys.map(key=>[key,String(inspections[0].ledger[key])])),
    funding:Object.fromEntries(fundingKeys.map(key=>[key,String(funding[key])])), operations };
}
