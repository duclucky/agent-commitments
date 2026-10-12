// Read-only preparation. This script has no signer, wallet client or broadcast mode.
import { readFile, writeFile } from "node:fs/promises";
import { createPublicClient, encodeFunctionData, getAddress, http, keccak256, parseAbi } from "viem";
import { arc } from "viem/chains";
import { AgentCommitmentsClient, createViemChainReader } from "../packages/sdk/dist/index.js";

const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === "--output")) throw new Error("Only --output PATH is supported; this command never broadcasts");
const manifest = JSON.parse(await readFile(new URL("../deployments/arc-mainnet.json", import.meta.url), "utf8"));
const candidate = manifest.draftCandidate;
const client = createPublicClient({ chain: arc, transport: http(process.env.ARC_MAINNET_RPC_URL ?? manifest.rpcUrl) });
if (await client.getChainId() !== manifest.chainId) throw new Error("RPC chain mismatch");
const blockNumber = await client.getBlockNumber();
for (const entry of [manifest.budgetVault, candidate.escrow, candidate.adapter]) {
  const code = await client.getCode({ address: entry.address, blockNumber });
  if (!code || keccak256(code) !== entry.codeHash) throw new Error(`Code hash mismatch at ${entry.address}`);
}
const vault = manifest.budgetVault.address;
const adapter = candidate.adapter.address;
const escrow = candidate.escrow.address;
const owner = manifest.owner;
const vaultAbi = parseAbi(["function owner() view returns(address)", "function adapter() view returns(address)", "function setAdapter(address)"]);
const [actualOwner, boundAdapter, paused, escrowPaused, price] = await Promise.all([
  client.readContract({ address: vault, abi: vaultAbi, functionName: "owner", blockNumber }),
  client.readContract({ address: vault, abi: vaultAbi, functionName: "adapter", blockNumber }),
  client.readContract({ address: vault, abi: parseAbi(["function paused() view returns(bool)"]), functionName: "paused", blockNumber }),
  client.readContract({ address: escrow, abi: parseAbi(["function paused() view returns(bool)"]), functionName: "paused", blockNumber }),
  client.getGasPrice(),
]);
if (getAddress(actualOwner) !== getAddress(owner) || boundAdapter !== "0x0000000000000000000000000000000000000000") throw new Error("Owner or unbound state changed");
if (paused || escrowPaused) throw new Error("Candidate is paused; inspect before preparing activation");
const reader = createViemChainReader({
  readContract: (request) => client.readContract(request),
  getTransactionReceipt: (request) => client.getTransactionReceipt(request),
  getBlockNumber: async () => blockNumber,
  simulateContract: (request) => client.simulateContract(request),
});
const commitments = new AgentCommitmentsClient(manifest.chainId, vault, adapter, reader, escrow);
const funding = await commitments.inspectVaultFunding();
if (funding.physicalBalance !== 0n || funding.recordedBacking !== 0n || funding.backingShortfall !== 0n) throw new Error("Vault is no longer empty; inspect current obligations before preparing activation");
const amount = 10_000n; // Proposed 0.01 USDC for an internal pilot, not an approved transfer.
if (amount > BigInt(manifest.policy.depositCap) || amount > BigInt(manifest.policy.maxCommitmentAmount)) throw new Error("Proposed pilot exceeds cap");
const binding = { chainId: manifest.chainId, to: vault, value: 0n, data: encodeFunctionData({ abi: vaultAbi, functionName: "setAdapter", args: [adapter] }) };
const approval = commitments.prepareDepositApproval(amount);
const deposit = commitments.prepareDeposit(amount);
await client.simulateContract({ address: vault, abi: vaultAbi, functionName: "setAdapter", args: [adapter], account: owner, blockNumber });
const [bindingGas, approvalGas, ownerBalance] = await Promise.all([
  client.estimateGas({ account: owner, to: binding.to, data: binding.data }),
  client.estimateGas({ account: owner, to: approval.to, data: approval.data }),
  client.readContract({ address: manifest.usdc.address, abi: parseAbi(["function balanceOf(address) view returns(uint256)"]), functionName: "balanceOf", args: [owner], blockNumber }),
]);
const result = {
  preparedAt: new Date().toISOString(), chainId: manifest.chainId, observedBlock: blockNumber,
  mode: "prepare-only", broadcasts: 0, owner, proposedAmountUnits: amount,
  contracts: { vault, adapter, escrow }, funding,
  calls: { oneTimeBinding: binding, exactApproval: approval, deposit },
  estimation: {
    bindingGas, approvalGas, gasPriceWei: price,
    initialGasCostWei: (bindingGas + approvalGas) * price,
    ownerBalanceUnits: ownerBalance,
    note: "Binding and approval estimates only; excludes deposit, role transactions and all smoke lifecycle fees. No fee ceiling or spending approval inferred. Native gas and ERC-20 USDC share one balance; do not sum them.",
  },
  activationReady: false,
  remainingGates: [
    "Independent review of pinned contract sources is still absent; self-review is recorded separately.",
    "Select a provider EOA able to sign the vault's EIP-712 quote; ERC-1271 SCA provider signatures are unsupported.",
    "Select and authorize provider/evaluator signers, the exact pilot scope and a total fee ceiling after full simulation.",
    "Reverify state before one-time binding; do not execute deposit before confirmed exact approval.",
  ],
  smokeSequence: ["reserve/dispatch/price/fund/reject/reconcile using 0.01 USDC", "reserve/dispatch/price/fund/submit/complete/reconcile using the recovered 0.01 USDC", "withdraw remaining A; capture receipts, balances and D/A/R/E/S/W"],
};
const json = JSON.stringify(result, (_, value) => typeof value === "bigint" ? String(value) : value, 2);
if (args[1]) await writeFile(args[1], `${json}\n`);
console.log(JSON.stringify({ mode: result.mode, broadcasts: 0, observedBlock: String(blockNumber), activationReady: false, proposedAmountUnits: String(amount), ownerBalanceUnits: String(ownerBalance), output: args[1] ?? null }));
