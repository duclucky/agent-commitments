import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  parseAbiParameters,
} from "viem";
import { arcTestnet } from "viem/chains";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const contractsRoot = join(repositoryRoot, "contracts");
const outputDirectory = join(repositoryRoot, "verification", "arc-testnet");
const manifest = JSON.parse(await readFile(join(repositoryRoot, "deployments", "arc-testnet.json"), "utf8"));
const client = createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_TESTNET_RPC_URL ?? manifest.rpcUrl) });

const contracts = [
  {
    key: "budgetVault",
    label: "BudgetVault",
    identifier: "src/BudgetVault.sol:BudgetVault",
    artifact: "out/BudgetVault.sol/BudgetVault.json",
    parameters: "address,address,uint256,uint256,uint256,uint256",
    values: [
      manifest.usdc.address,
      manifest.owner,
      BigInt(manifest.policy.rootExpiresAt),
      BigInt(manifest.policy.depositCap),
      BigInt(manifest.policy.maxCommitmentAmount),
      BigInt(manifest.policy.maxConcurrentCommitments),
    ],
  },
  {
    key: "erc8183Adapter",
    label: "ERC8183Adapter",
    identifier: "src/ERC8183Adapter.sol:ERC8183Adapter",
    artifact: "out/ERC8183Adapter.sol/ERC8183Adapter.json",
    parameters: "address,address,address",
    values: [manifest.budgetVault.address, manifest.erc8183Escrow.address, manifest.usdc.address],
  },
];

await mkdir(outputDirectory, { recursive: true });
const results = [];

for (const contract of contracts) {
  const deployment = manifest[contract.key];
  const artifact = JSON.parse(await readFile(join(contractsRoot, contract.artifact), "utf8"));
  const constructorArgs = encodeAbiParameters(parseAbiParameters(contract.parameters), contract.values);
  const expectedCreationInput = `${artifact.bytecode.object}${constructorArgs.slice(2)}`.toLowerCase();
  const [transaction, runtimeCode] = await Promise.all([
    client.getTransaction({ hash: deployment.transactionHash }),
    client.getCode({ address: deployment.address }),
  ]);
  if (transaction.input.toLowerCase() !== expectedCreationInput) {
    throw new Error(`${contract.label}: local creation bytecode and constructor args do not match the deployment transaction`);
  }
  if (!runtimeCode || keccak256(runtimeCode) !== deployment.codeHash) {
    throw new Error(`${contract.label}: current runtime bytecode does not match the deployment manifest`);
  }

  const argsPath = join(outputDirectory, `${contract.label}.constructor-args.txt`);
  await writeFile(argsPath, `${constructorArgs}\n`, "utf8");
  const forge = spawnSync("forge", [
    "verify-contract",
    deployment.address,
    contract.identifier,
    "--chain", String(manifest.chainId),
    "--compiler-version", manifest.toolchain.solc,
    "--num-of-optimizations", String(manifest.toolchain.optimizerRuns),
    "--evm-version", manifest.toolchain.evmVersion,
    "--constructor-args", constructorArgs,
    "--show-standard-json-input",
  ], {
    cwd: contractsRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (forge.status !== 0) {
    throw new Error(`${contract.label}: forge could not create Standard JSON\n${forge.stderr || forge.stdout}`);
  }
  const standardInput = forge.stdout.trim();
  JSON.parse(standardInput);
  const standardInputPath = join(outputDirectory, `${contract.label}.standard-input.json`);
  await writeFile(standardInputPath, `${standardInput}\n`, "utf8");

  results.push({
    contract: contract.label,
    address: getAddress(deployment.address),
    transactionHash: deployment.transactionHash,
    creationInputMatched: true,
    runtimeCodeHash: deployment.codeHash,
    constructorArgsFile: argsPath.slice(repositoryRoot.length + 1).replaceAll("\\", "/"),
    standardInputFile: standardInputPath.slice(repositoryRoot.length + 1).replaceAll("\\", "/"),
  });
}

const report = {
  preparedAt: new Date().toISOString(),
  network: manifest.network,
  chainId: manifest.chainId,
  verifier: "blockscout",
  verifierUrl: `${manifest.explorerUrl}/api/`,
  publicationPerformed: false,
  contracts: results,
};
await writeFile(join(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
