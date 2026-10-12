import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error("Could not allocate local rehearsal port");
  return port;
}

async function waitForRpc(rpcUrl) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Anvil did not become ready for deployment rehearsal");
}

async function artifact(source, name = source) {
  return JSON.parse(await readFile(new URL(`../contracts/out/${source}.sol/${name}.json`, import.meta.url), "utf8"));
}

function bytecode(value) {
  return value.bytecode.object.startsWith("0x") ? value.bytecode.object : `0x${value.bytecode.object}`;
}

async function run() {
  const port = await freePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const chain = {
    id: 31_339,
    name: "Agent Commitments deployment rehearsal",
    nativeCurrency: { name: "Local Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };
  const anvil = spawn("anvil", ["--silent", "--port", String(port), "--chain-id", String(chain.id)], {
    stdio: "ignore",
  });

  try {
    await waitForRpc(rpcUrl);
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    const walletClient = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });
    const [tokenArtifact, escrowArtifact, vaultArtifact] = await Promise.all([
      artifact("TestSupport", "MockUSDC"),
      artifact("LocalAgenticCommerce"),
      artifact("BudgetVault"),
    ]);
    const deploy = async (artifactValue, args = []) => {
      const hash = await walletClient.deployContract({ abi: artifactValue.abi, bytecode: bytecode(artifactValue), args });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (!receipt.contractAddress || receipt.status !== "success") throw new Error("Rehearsal dependency deployment failed");
      return receipt.contractAddress;
    };

    const token = await deploy(tokenArtifact);
    const escrow = await deploy(escrowArtifact, [token]);
    const latest = await publicClient.getBlock();
    const candidateVault = await deploy(vaultArtifact, [
      token,
      owner.address,
      latest.timestamp + 30n * 86_400n,
      100_000_000n,
      25_000_000n,
      4n,
    ]);
    const blockBeforeSimulation = await publicClient.getBlockNumber();
    const env = {
      ...process.env,
      TOKEN_ADDRESS: token,
      ESCROW_ADDRESS: escrow,
      OWNER_ADDRESS: owner.address,
      ROOT_EXPIRES_AT: String(latest.timestamp + 30n * 86_400n),
      DEPOSIT_CAP: "100000000",
      MAX_COMMITMENT_AMOUNT: "25000000",
      MAX_CONCURRENT_COMMITMENTS: "4",
    };
    const forge = spawn(
      "forge",
      [
        "script",
        "script/Deploy.s.sol:Deploy",
        "--rpc-url",
        rpcUrl,
        "--sender",
        owner.address,
      ],
      { cwd: resolve("contracts"), env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    forge.stdout.on("data", (chunk) => { output += chunk; });
    forge.stderr.on("data", (chunk) => { output += chunk; });
    const [exitCode] = await once(forge, "exit");
    if (exitCode !== 0) throw new Error(`Deployment simulation failed:\n${output}`);

    const blockAfterSimulation = await publicClient.getBlockNumber();
    if (blockAfterSimulation !== blockBeforeSimulation) {
      throw new Error("Deployment rehearsal unexpectedly broadcast a transaction");
    }
    const candidate = spawn(
      "forge",
      [
        "script",
        "script/DeployDraftCandidate.s.sol:DeployDraftCandidate",
        "--rpc-url",
        rpcUrl,
        "--sender",
        owner.address,
      ],
      {
        cwd: resolve("contracts"),
        env: { ...process.env, TOKEN_ADDRESS: token, VAULT_ADDRESS: candidateVault, OWNER_ADDRESS: owner.address },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let candidateOutput = "";
    candidate.stdout.on("data", (chunk) => { candidateOutput += chunk; });
    candidate.stderr.on("data", (chunk) => { candidateOutput += chunk; });
    const [candidateExitCode] = await once(candidate, "exit");
    if (candidateExitCode !== 0) throw new Error(`Draft candidate simulation failed:\n${candidateOutput}`);
    if (await publicClient.getBlockNumber() !== blockBeforeSimulation) {
      throw new Error("Draft candidate rehearsal unexpectedly broadcast a transaction");
    }

    console.log("Deployment rehearsal passed: production and draft candidate scripts simulated without broadcast.");
  } finally {
    anvil.kill();
    await Promise.race([once(anvil, "exit"), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  }
}

await run();
