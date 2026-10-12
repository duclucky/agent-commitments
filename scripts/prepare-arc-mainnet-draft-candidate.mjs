import { mkdir, readFile, writeFile } from "node:fs/promises";
import { encodeDeployData, encodeFunctionData, getCreate2Address, keccak256, toHex } from "viem";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("deployments/arc-mainnet.json", root), "utf8"));

async function artifact(source, name = source) {
  return JSON.parse(await readFile(new URL(`contracts/out/${source}.sol/${name}.json`, root), "utf8"));
}

function bytecode(value) {
  return value.bytecode.object.startsWith("0x") ? value.bytecode.object : `0x${value.bytecode.object}`;
}

const [escrowArtifact, adapterArtifact] = await Promise.all([
  artifact("AgenticCommerceEscrow"),
  artifact("ERC8183DraftAdapter"),
]);

const helper = manifest.checkedCreate2Deployer.address;
const escrowInitCode = encodeDeployData({
  abi: escrowArtifact.abi,
  bytecode: bytecode(escrowArtifact),
  args: [manifest.usdc.address, manifest.owner],
});
const escrowSalt = keccak256(toHex("agent-commitments-mainnet-erc8183-draft-2026-10-12-escrow-v1"));
const escrowAddress = getCreate2Address({ from: helper, salt: escrowSalt, bytecodeHash: keccak256(escrowInitCode) });

const adapterInitCode = encodeDeployData({
  abi: adapterArtifact.abi,
  bytecode: bytecode(adapterArtifact),
  args: [manifest.budgetVault.address, escrowAddress, manifest.usdc.address],
});
const adapterSalt = keccak256(toHex("agent-commitments-mainnet-erc8183-draft-2026-10-12-adapter-v2"));
const adapterAddress = getCreate2Address({ from: helper, salt: adapterSalt, bytecodeHash: keccak256(adapterInitCode) });

const helperAbi = [{
  type: "function",
  name: "deploy",
  stateMutability: "nonpayable",
  inputs: [{ name: "initCode", type: "bytes" }, { name: "salt", type: "bytes32" }],
  outputs: [{ name: "deployed", type: "address" }],
}];

const plan = {
  schemaVersion: 1,
  preparedAt: new Date().toISOString(),
  network: manifest.network,
  chainId: manifest.chainId,
  status: "prepared-unbound-unfunded",
  owner: manifest.owner,
  token: manifest.usdc,
  vault: manifest.budgetVault.address,
  checkedCreate2Deployer: helper,
  erc8183DraftSnapshot: "2026-10-12",
  adapterRevision: 2,
  escrow: {
    predictedAddress: escrowAddress,
    salt: escrowSalt,
    initCodeBytes: (escrowInitCode.length - 2) / 2,
    initCodeHash: keccak256(escrowInitCode),
    deploymentCalldata: encodeFunctionData({ abi: helperAbi, functionName: "deploy", args: [escrowInitCode, escrowSalt] }),
  },
  adapter: {
    predictedAddress: adapterAddress,
    salt: adapterSalt,
    initCodeBytes: (adapterInitCode.length - 2) / 2,
    initCodeHash: keccak256(adapterInitCode),
    deploymentCalldata: encodeFunctionData({ abi: helperAbi, functionName: "deploy", args: [adapterInitCode, adapterSalt] }),
  },
  binding: {
    applied: false,
    irreversible: true,
    requiredReview: "independent security review",
  },
};

await mkdir(new URL("deployments/", root), { recursive: true });
await writeFile(new URL("deployments/arc-mainnet-draft-candidate-plan.json", root), `${JSON.stringify(plan, null, 2)}\n`);
console.log(JSON.stringify({
  prepared: true,
  escrow: escrowAddress,
  adapter: adapterAddress,
  output: "deployments/arc-mainnet-draft-candidate-plan.json",
}, null, 2));
