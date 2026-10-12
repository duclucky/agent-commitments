import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, http, keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { quoteTypedData } from "../packages/sdk/dist/index.js";

const port = 8547;
const rpcUrl = `http://127.0.0.1:${port}`;
const chain = {
  id: 31_337,
  name: "Agent Commitments local",
  nativeCurrency: { name: "Local Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const provider = privateKeyToAccount("0x59c6995e998f97a5a0044976f0945389dc9e86dae88c7a8412f4603b6b78690d");
const processHandle = spawn("anvil", ["--silent", "--port", String(port), "--chain-id", String(chain.id)], { stdio: "ignore" });

const artifact = async (source, name = source) => JSON.parse(await readFile(new URL(`../contracts/out/${source}.sol/${name}.json`, import.meta.url), "utf8"));
const bytecode = (value) => value.bytecode.object.startsWith("0x") ? value.bytecode.object : `0x${value.bytecode.object}`;

try {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
      if (response.ok) break;
    } catch {}
    if (attempt === 49) throw new Error("Anvil did not become ready");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const ownerClient = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });
  const providerClient = createWalletClient({ account: provider, chain, transport: http(rpcUrl) });
  await publicClient.request({ method: "anvil_setBalance", params: [provider.address, "0x8ac7230489e80000"] });
  const [tokenArtifact, vaultArtifact, escrowArtifact, adapterArtifact] = await Promise.all([
    artifact("TestSupport", "MockUSDC"), artifact("BudgetVault"), artifact("LocalAgenticCommerce"), artifact("ERC8183Adapter"),
  ]);
  const deploy = async (artifactValue, args = []) => {
    const hash = await ownerClient.deployContract({ abi: artifactValue.abi, bytecode: bytecode(artifactValue), args });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress || receipt.status !== "success") throw new Error("Local deployment failed");
    return receipt.contractAddress;
  };
  const send = async (client, address, abi, functionName, args = []) => {
    const hash = await client.writeContract({ address, abi, functionName, args });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
    return receipt;
  };

  const latest = await publicClient.getBlock();
  const token = await deploy(tokenArtifact);
  const vault = await deploy(vaultArtifact, [
    token, owner.address, latest.timestamp + 30n * 86_400n, 100_000_000n, 25_000_000n, 2n,
  ]);
  const escrow = await deploy(escrowArtifact, [token]);
  const adapter = await deploy(adapterArtifact, [vault, escrow, token]);
  await send(ownerClient, vault, vaultArtifact.abi, "setAdapter", [adapter]);

  const rootGrant = await publicClient.readContract({ address: vault, abi: vaultArtifact.abi, functionName: "ROOT_GRANT_ID" });
  const grantId = keccak256(stringToHex("local-e2e-agent"));
  await send(ownerClient, vault, vaultArtifact.abi, "createGrant", [
    grantId, rootGrant, owner.address, 100_000_000n, latest.timestamp + 10n * 86_400n,
    [provider.address], [owner.address],
  ]);
  await send(ownerClient, token, tokenArtifact.abi, "mint", [owner.address, 100_000_000n]);
  await send(ownerClient, token, tokenArtifact.abi, "approve", [vault, 100_000_000n]);
  await send(ownerClient, vault, vaultArtifact.abi, "deposit", [100_000_000n]);

  const operationId = keccak256(stringToHex("local-e2e-document"));
  const quote = {
    grantId, operationId, provider: provider.address, evaluator: owner.address, token, adapter, amount: 25_000_000n,
    quoteExpiresAt: latest.timestamp + 3_600n, jobExpiresAt: latest.timestamp + 86_400n,
    workHash: keccak256(stringToHex("schema:v1:pages:2")), nonce: keccak256(stringToHex("local-e2e-nonce")),
  };
  const signature = await provider.signTypedData(quoteTypedData(chain.id, vault, quote));
  await send(ownerClient, vault, vaultArtifact.abi, "reserve", [quote, signature]);
  const commitmentId = await publicClient.readContract({ address: vault, abi: vaultArtifact.abi, functionName: "commitmentId", args: [grantId, operationId] });
  await send(ownerClient, adapter, adapterArtifact.abi, "dispatch", [commitmentId]);
  const jobId = await publicClient.readContract({ address: adapter, abi: adapterArtifact.abi, functionName: "jobs", args: [commitmentId] });
  await send(providerClient, escrow, escrowArtifact.abi, "setBudget", [jobId, 25_000_000n, "0x"]);
  await send(ownerClient, adapter, adapterArtifact.abi, "fund", [commitmentId]);
  await send(providerClient, escrow, escrowArtifact.abi, "submit", [jobId, keccak256(stringToHex("deliverable")), "0x"]);
  await send(ownerClient, escrow, escrowArtifact.abi, "complete", [jobId, keccak256(stringToHex("accepted")), "0x"]);
  await send(ownerClient, adapter, adapterArtifact.abi, "reconcile", [commitmentId]);

  const ledger = await publicClient.readContract({ address: vault, abi: vaultArtifact.abi, functionName: "ledger" });
  const providerBalance = await publicClient.readContract({ address: token, abi: tokenArtifact.abi, functionName: "balanceOf", args: [provider.address] });
  if (ledger.available !== 75_000_000n || ledger.settled !== 25_000_000n || ledger.reserved !== 0n || ledger.inEscrow !== 0n) throw new Error("Final ledger mismatch");
  if (providerBalance !== 25_000_000n) throw new Error("Provider payment mismatch");
  console.log(`Local-chain E2E passed: commitment ${commitmentId}, job ${jobId}, settled 25.000000 USDC.`);
} finally {
  processHandle.kill();
}
