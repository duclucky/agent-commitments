import { readFile } from "node:fs/promises";
import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  parseAbi,
  toFunctionSelector,
} from "viem";
import { arcTestnet } from "viem/chains";

const manifest = JSON.parse(await readFile(new URL("../deployments/arc-testnet.json", import.meta.url), "utf8"));
const rpcUrl = process.env.ARC_TESTNET_RPC_URL ?? manifest.rpcUrl;
const client = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) });

const vaultAbi = parseAbi([
  "function token() view returns(address)",
  "function owner() view returns(address)",
  "function depositCap() view returns(uint256)",
  "function maxCommitmentAmount() view returns(uint256)",
  "function maxConcurrentCommitments() view returns(uint256)",
  "function adapter() view returns(address)",
  "function paused() view returns(bool)",
  "function ledger() view returns(uint256 deposited,uint256 available,uint256 reserved,uint256 inEscrow,uint256 settled,uint256 withdrawn)",
  "function reservations(bytes32) view returns((bytes32 grantId,address provider,address evaluator,uint256 amount,uint256 jobExpiresAt,bytes32 workHash,bytes32 termsHash,uint8 status))",
  "function grants(bytes32) view returns((bytes32 parentId,address grantee,uint256 cap,uint256 expiresAt,uint256 reserved,uint256 inEscrow,uint256 grossSpent,bool revoked,bool exists,uint8 depth,bool providerRestricted,bool evaluatorRestricted))",
]);
const adapterAbi = parseAbi([
  "function vault() view returns(address)",
  "function escrow() view returns(address)",
  "function token() view returns(address)",
  "function jobs(bytes32) view returns(uint256)",
]);
const tokenAbi = parseAbi([
  "function decimals() view returns(uint8)",
  "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
]);
const escrowAbi = parseAbi([
  "function paymentToken() view returns(address)",
  "function getJob(uint256) view returns((uint256 id,address client,address provider,address evaluator,string description,uint256 budget,uint256 expiredAt,uint8 status,address hook))",
]);
const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

function equalAddress(actual, expected, label) {
  if (getAddress(actual) !== getAddress(expected)) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function equal(actual, expected, label) {
  if (String(actual) !== String(expected)) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

async function verifyReceipt(entry, expectedContractAddress) {
  const receipt = await client.getTransactionReceipt({ hash: entry.transactionHash });
  equal(receipt.status, "success", `${entry.transactionHash} receipt status`);
  equal(receipt.blockNumber, entry.blockNumber, `${entry.transactionHash} block`);
  if (expectedContractAddress) equalAddress(receipt.contractAddress, expectedContractAddress, "deployed contract");
}

async function verifyCode(entry, label) {
  const code = await client.getCode({ address: entry.address });
  if (!code) throw new Error(`${label}: no deployed code`);
  equal((code.length - 2) / 2, entry.codeBytes, `${label} code size`);
  equal(keccak256(code), entry.codeHash, `${label} code hash`);
}

const chainId = await client.getChainId();
equal(chainId, manifest.chainId, "chain id");

await Promise.all([
  verifyReceipt(manifest.budgetVault, manifest.budgetVault.address),
  verifyReceipt(manifest.erc8183Adapter, manifest.erc8183Adapter.address),
  verifyReceipt(manifest.adapterBinding),
  verifyCode(manifest.budgetVault, "BudgetVault"),
  verifyCode(manifest.erc8183Adapter, "ERC8183Adapter"),
]);

const [
  decimals,
  token,
  owner,
  depositCap,
  maxCommitmentAmount,
  maxConcurrentCommitments,
  boundAdapter,
  paused,
  ledger,
  rootGrant,
  adapterVault,
  escrow,
  adapterToken,
  escrowToken,
  rawImplementation,
] = await Promise.all([
  client.readContract({ address: manifest.usdc.address, abi: tokenAbi, functionName: "decimals" }),
  client.readContract({ address: manifest.budgetVault.address, abi: vaultAbi, functionName: "token" }),
  client.readContract({ address: manifest.budgetVault.address, abi: vaultAbi, functionName: "owner" }),
  client.readContract({ address: manifest.budgetVault.address, abi: vaultAbi, functionName: "depositCap" }),
  client.readContract({ address: manifest.budgetVault.address, abi: vaultAbi, functionName: "maxCommitmentAmount" }),
  client.readContract({ address: manifest.budgetVault.address, abi: vaultAbi, functionName: "maxConcurrentCommitments" }),
  client.readContract({ address: manifest.budgetVault.address, abi: vaultAbi, functionName: "adapter" }),
  client.readContract({ address: manifest.budgetVault.address, abi: vaultAbi, functionName: "paused" }),
  client.readContract({ address: manifest.budgetVault.address, abi: vaultAbi, functionName: "ledger" }),
  client.readContract({
    address: manifest.budgetVault.address,
    abi: vaultAbi,
    functionName: "grants",
    args: [manifest.policy.rootGrantId],
  }),
  client.readContract({ address: manifest.erc8183Adapter.address, abi: adapterAbi, functionName: "vault" }),
  client.readContract({ address: manifest.erc8183Adapter.address, abi: adapterAbi, functionName: "escrow" }),
  client.readContract({ address: manifest.erc8183Adapter.address, abi: adapterAbi, functionName: "token" }),
  client.readContract({ address: manifest.erc8183Escrow.address, abi: escrowAbi, functionName: "paymentToken" }),
  client.getStorageAt({ address: manifest.erc8183Escrow.address, slot: implementationSlot }),
]);

equal(decimals, manifest.usdc.decimals, "USDC decimals");
equalAddress(token, manifest.usdc.address, "vault token");
equalAddress(owner, manifest.owner, "vault owner");
equal(depositCap, manifest.policy.depositCap, "deposit cap");
equal(maxCommitmentAmount, manifest.policy.maxCommitmentAmount, "max commitment amount");
equal(maxConcurrentCommitments, manifest.policy.maxConcurrentCommitments, "max concurrent commitments");
equalAddress(boundAdapter, manifest.erc8183Adapter.address, "vault adapter");
equalAddress(adapterVault, manifest.budgetVault.address, "adapter vault");
equalAddress(escrow, manifest.erc8183Escrow.address, "adapter escrow");
equalAddress(adapterToken, manifest.usdc.address, "adapter token");
equalAddress(escrowToken, manifest.usdc.address, "escrow payment token");
equalAddress(rootGrant.grantee, manifest.owner, "root grant grantee");
equal(rootGrant.cap, manifest.policy.depositCap, "root grant cap");
equal(rootGrant.expiresAt, manifest.policy.rootExpiresAt, "root grant expiry");
equal(rootGrant.exists, true, "root grant existence");
equal(rootGrant.depth, 0, "root grant depth");

if (!rawImplementation) throw new Error("ERC-8183 proxy implementation slot is empty");
const implementation = getAddress(`0x${rawImplementation.slice(-40)}`);
equalAddress(implementation, manifest.erc8183Escrow.implementation, "ERC-8183 implementation");
const implementationCode = await client.getCode({ address: implementation });
if (!implementationCode) throw new Error("ERC-8183 implementation has no deployed code");
equal(keccak256(implementationCode), manifest.erc8183Escrow.implementationCodeHash, "ERC-8183 implementation hash");
for (const signature of [
  "createJob(address,address,uint256,string,address)",
  "setBudget(uint256,uint256,bytes)",
  "fund(uint256,bytes)",
  "getJob(uint256)",
  "claimRefund(uint256)",
]) {
  const selector = toFunctionSelector(signature).slice(2).toLowerCase();
  if (!implementationCode.slice(2).toLowerCase().includes(selector)) {
    throw new Error(`ERC-8183 implementation is missing selector ${signature}`);
  }
}

async function verifySmoke(smoke, label) {
  const hashes = Object.values(smoke.transactionHashes);
  const receipts = await Promise.all(hashes.map((hash) => client.getTransactionReceipt({ hash })));
  for (const receipt of receipts) equal(receipt.status, "success", `${receipt.transactionHash} ${label} receipt`);
  const [reservation, boundJobId, job] = await Promise.all([
    client.readContract({
      address: manifest.budgetVault.address,
      abi: vaultAbi,
      functionName: "reservations",
      args: [smoke.commitmentId],
    }),
    client.readContract({
      address: manifest.erc8183Adapter.address,
      abi: adapterAbi,
      functionName: "jobs",
      args: [smoke.commitmentId],
    }),
    client.readContract({
      address: manifest.erc8183Escrow.address,
      abi: escrowAbi,
      functionName: "getJob",
      args: [BigInt(smoke.jobId)],
    }),
  ]);
  equal(boundJobId, smoke.jobId, `${label} adapter job binding`);
  equal(reservation.status, smoke.reservationStatus, `${label} reservation status`);
  equal(job.status, smoke.jobStatus, `${label} job status`);
  equalAddress(job.client, manifest.erc8183Adapter.address, `${label} escrow client`);
  equal(job.budget, smoke.amountAtomic, `${label} budget`);
  if (smoke.roles) {
    equalAddress(smoke.roles.budgetOwner, manifest.owner, `${label} budget owner`);
    equalAddress(smoke.roles.escrowClient, manifest.erc8183Adapter.address, `${label} escrow client role`);
    equalAddress(job.provider, smoke.roles.provider, `${label} provider`);
    equalAddress(job.evaluator, smoke.roles.evaluator, `${label} evaluator`);
    if (getAddress(smoke.roles.provider) === getAddress(smoke.roles.evaluator) ||
        getAddress(smoke.roles.provider) === getAddress(smoke.roles.budgetOwner) ||
        getAddress(smoke.roles.evaluator) === getAddress(smoke.roles.budgetOwner)) {
      throw new Error(`${label}: roles are not independent`);
    }
  }
}

if (manifest.liveSmoke) await verifySmoke(manifest.liveSmoke, "settlement smoke");
if (manifest.recoverySmoke) await verifySmoke(manifest.recoverySmoke, "recovery smoke");
if (manifest.multiRoleSmoke) await verifySmoke(manifest.multiRoleSmoke, "multi-role smoke");
if (manifest.expectedLedger) {
  for (const [index, key] of ["deposited", "available", "reserved", "inEscrow", "settled", "withdrawn"].entries()) {
    equal(ledger[index], manifest.expectedLedger[key], `current ledger ${key}`);
  }
}
if (manifest.expectedTokenState) {
  const [vaultBalance, adapterBalance, adapterEscrowAllowance] = await Promise.all([
    client.readContract({
      address: manifest.usdc.address,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [manifest.budgetVault.address],
    }),
    client.readContract({
      address: manifest.usdc.address,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [manifest.erc8183Adapter.address],
    }),
    client.readContract({
      address: manifest.usdc.address,
      abi: tokenAbi,
      functionName: "allowance",
      args: [manifest.erc8183Adapter.address, manifest.erc8183Escrow.address],
    }),
  ]);
  equal(vaultBalance, manifest.expectedTokenState.vaultBalance, "vault physical token balance");
  equal(adapterBalance, manifest.expectedTokenState.adapterBalance, "adapter physical token balance");
  equal(adapterEscrowAllowance, manifest.expectedTokenState.adapterEscrowAllowance, "adapter escrow allowance");
}

console.log(JSON.stringify({
  verified: true,
  verifiedAt: new Date().toISOString(),
  chainId,
  rpcUrl,
  budgetVault: manifest.budgetVault.address,
  erc8183Adapter: manifest.erc8183Adapter.address,
  erc8183Escrow: manifest.erc8183Escrow.address,
  paused,
  ledger: {
    deposited: ledger[0].toString(),
    available: ledger[1].toString(),
    reserved: ledger[2].toString(),
    inEscrow: ledger[3].toString(),
    settled: ledger[4].toString(),
    withdrawn: ledger[5].toString(),
  },
}, null, 2));
