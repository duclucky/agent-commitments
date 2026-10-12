import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createPublicClient, decodeFunctionData, getCreate2Address, http, keccak256 } from "viem";
import { arc } from "viem/chains";

const mode = process.argv.includes("--broadcast") ? "broadcast" : "estimate";
const targetIndex = process.argv.indexOf("--target");
const target = targetIndex >= 0 ? process.argv[targetIndex + 1] : undefined;
if (target !== "escrow" && target !== "adapter") throw new Error("Use --target escrow or --target adapter");
if (mode === "broadcast" && process.env.ARC_MAINNET_CANDIDATE_BROADCAST !== "UNBOUND_UNFUNDED") {
  throw new Error("Set ARC_MAINNET_CANDIDATE_BROADCAST=UNBOUND_UNFUNDED to broadcast this canary deployment");
}

const plan = JSON.parse(await readFile(new URL("../deployments/arc-mainnet-draft-candidate-plan.json", import.meta.url), "utf8"));
const rpcUrl = process.env.ARC_MAINNET_RPC_URL ?? "https://rpc.mainnet.arc.io";
const client = createPublicClient({ chain: arc, transport: http(rpcUrl) });
if (await client.getChainId() !== plan.chainId) throw new Error(`RPC is not chain ${plan.chainId}`);

const entry = plan[target];
const existingCode = await client.getCode({ address: entry.predictedAddress });
if (existingCode) {
  console.log(JSON.stringify({ target, status: "already-deployed", address: entry.predictedAddress }, null, 2));
  process.exit(0);
}
if (target === "adapter" && !(await client.getCode({ address: plan.escrow.predictedAddress }))) {
  throw new Error("Deploy and verify the escrow before estimating or deploying the adapter");
}

const helperAbi = [{
  type: "function",
  name: "deploy",
  stateMutability: "nonpayable",
  inputs: [{ name: "initCode", type: "bytes" }, { name: "salt", type: "bytes32" }],
  outputs: [{ name: "deployed", type: "address" }],
}];
const decoded = decodeFunctionData({ abi: helperAbi, data: entry.deploymentCalldata });
const [initCode, salt] = decoded.args;
if (keccak256(initCode) !== entry.initCodeHash || salt !== entry.salt) throw new Error("Deployment payload conflicts with plan");
if (getCreate2Address({ from: plan.checkedCreate2Deployer, salt, bytecodeHash: keccak256(initCode) }) !== entry.predictedAddress) {
  throw new Error("Predicted deployment address conflicts with payload");
}
const mainnet = JSON.parse(await readFile(new URL("../deployments/arc-mainnet.json", import.meta.url), "utf8"));
const helperCode = await client.getCode({ address: plan.checkedCreate2Deployer });
if (!helperCode || keccak256(helperCode) !== mainnet.checkedCreate2Deployer.codeHash) throw new Error("Checked deployer code mismatch");
const args = [
  "wallet", "execute", "deploy(bytes,bytes32)", initCode, salt,
  "--contract", plan.checkedCreate2Deployer,
  "--address", plan.owner,
  "--chain", "ARC",
  "--output", "json",
];
if (mode === "estimate") args.push("--estimate");
else args.push("--idempotency-key", target === "escrow"
  ? "fb8e5c55-9805-4d79-93e3-866fda95d0c1"
  : plan.adapterRevision === 2 ? "02d1575d-5fce-4d50-b8d8-2e4aa2a73518" : "ac68af3c-51f0-42d4-8bd9-8e84a61a8602");

const windowsBootstrap = `import {pathToFileURL} from 'node:url'; let input=''; for await (const chunk of process.stdin) input+=chunk; const {entry,args}=JSON.parse(input); process.argv=[process.execPath,entry,...args]; await import(pathToFileURL(entry).href);`;
const child = process.platform === "win32"
  ? spawn(process.execPath, ["--input-type=module", "-e", windowsBootstrap], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
  : spawn("circle", args, { stdio: ["ignore", "pipe", "pipe"] });
if (process.platform === "win32") {
  child.stdin.end(JSON.stringify({ entry: resolve(dirname(process.execPath), "node_modules/@circle-fin/cli/dist/index.js"), args }));
}
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });
const [exitCode] = await once(child, "exit");
if (exitCode !== 0) throw new Error(`Circle CLI failed (${exitCode}): ${stderr || stdout}`);
let result;
try { result = JSON.parse(stdout); } catch { result = { output: stdout.trim() }; }
const data = result.data ?? result;
const summary = mode === "estimate" ? data : {
  id: data.id, state: data.state, blockchain: data.blockchain, txHash: data.txHash,
  blockHeight: data.blockHeight, networkFee: data.networkFee,
};
console.log(JSON.stringify({ target, mode, predictedAddress: entry.predictedAddress, circle: summary }, null, 2));
