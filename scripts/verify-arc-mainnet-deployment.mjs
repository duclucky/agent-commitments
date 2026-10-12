import { readFile, writeFile } from "node:fs/promises";
import { createPublicClient, decodeEventLog, decodeFunctionData, encodeDeployData, getAddress, getCreate2Address, http, keccak256, pad, parseAbi, toHex } from "viem";
import { arc } from "viem/chains";

const manifest = JSON.parse(await readFile(new URL("../deployments/arc-mainnet.json", import.meta.url), "utf8"));
const rpcUrl = process.env.ARC_MAINNET_RPC_URL ?? manifest.rpcUrl;
const client = createPublicClient({ chain: arc, transport: http(rpcUrl) });
const zeroAddress = "0x0000000000000000000000000000000000000000";

const vaultAbi = parseAbi([
  "function token() view returns(address)",
  "function owner() view returns(address)",
  "function depositCap() view returns(uint256)",
  "function maxCommitmentAmount() view returns(uint256)",
  "function maxConcurrentCommitments() view returns(uint256)",
  "function adapter() view returns(address)",
  "function paused() view returns(bool)",
  "function activeCommitments() view returns(uint256)",
  "function ledger() view returns(uint256 deposited,uint256 available,uint256 reserved,uint256 inEscrow,uint256 settled,uint256 withdrawn)",
  "function grants(bytes32) view returns((bytes32 parentId,address grantee,uint256 cap,uint256 expiresAt,uint256 reserved,uint256 inEscrow,uint256 grossSpent,bool revoked,bool exists,uint8 depth,bool providerRestricted,bool evaluatorRestricted))",
]);
const tokenAbi = parseAbi([
  "function decimals() view returns(uint8)",
  "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
]);

function equal(actual, expected, label) {
  if (String(actual) !== String(expected)) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function equalAddress(actual, expected, label) {
  if (getAddress(actual) !== getAddress(expected)) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

async function verifyReceipt(entry, label) {
  const receipt = await client.getTransactionReceipt({ hash: entry.transactionHash });
  equal(receipt.status, "success", `${label} receipt status`);
  equal(receipt.blockNumber, entry.blockNumber, `${label} block`);
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  equal(receipt.blockHash, block.hash, `${label} canonical block hash`);
  if (entry.gasUsed) equal(receipt.gasUsed, entry.gasUsed, `${label} gas used`);
  if (entry.effectiveGasPriceWei) equal(receipt.effectiveGasPrice, entry.effectiveGasPriceWei, `${label} effective gas price`);
  if (entry.receiptGasCostWei) equal(receipt.gasUsed * receipt.effectiveGasPrice, entry.receiptGasCostWei, `${label} receipt gas cost`);
}

async function verifyCode(entry, label) {
  const code = await client.getCode({ address: entry.address });
  if (!code) throw new Error(`${label}: no deployed code`);
  equal((code.length - 2) / 2, entry.codeBytes, `${label} code size`);
  equal(keccak256(code), entry.codeHash, `${label} code hash`);
}

async function verifyCompiledSources(artifact, label) {
  for (const [path, source] of Object.entries(artifact.metadata.sources)) {
    if (!path.endsWith(".sol")) throw new Error(`${label}: unexpected source file type`);
    const contents = await readFile(new URL(`../contracts/${path}`, import.meta.url), "utf8");
    equal(keccak256(toHex(contents)), source.keccak256, `${label} compiled source ${path}`);
  }
}

equal(await client.getChainId(), manifest.chainId, "chain id");

await Promise.all([
  verifyReceipt(manifest.checkedCreate2Deployer, "checked CREATE2 deployer"),
  verifyReceipt(manifest.budgetVault, "BudgetVault"),
  verifyCode(manifest.checkedCreate2Deployer, "checked CREATE2 deployer"),
  verifyCode(manifest.budgetVault, "BudgetVault"),
  ...manifest.walletConsolidation.transfers.map((entry, index) => verifyReceipt(entry, `wallet transfer ${index + 1}`)),
  ...manifest.failedAttempts.map((entry, index) => verifyReceipt(entry, `failed inner deployment ${index + 1}`)),
]);

for (const entry of manifest.failedAttempts) {
  const code = await client.getCode({ address: entry.predictedAddress });
  equal(code ?? "0x", "0x", `failed attempt ${entry.predictedAddress} code`);
}

const [
  decimals,
  token,
  owner,
  depositCap,
  maxCommitmentAmount,
  maxConcurrentCommitments,
  adapter,
  paused,
  activeCommitments,
  ledger,
  rootGrant,
  vaultTokenBalance,
] = await Promise.all([
  client.readContract({ address: manifest.usdc.address, abi: tokenAbi, functionName: "decimals" }),
  client.readContract({ address: manifest.budgetVault.address, abi: vaultAbi, functionName: "token" }),
  client.readContract({ address: manifest.budgetVault.address, abi: vaultAbi, functionName: "owner" }),
  client.readContract({ address: manifest.budgetVault.address, abi: vaultAbi, functionName: "depositCap" }),
  client.readContract({ address: manifest.budgetVault.address, abi: vaultAbi, functionName: "maxCommitmentAmount" }),
  client.readContract({ address: manifest.budgetVault.address, abi: vaultAbi, functionName: "maxConcurrentCommitments" }),
  client.readContract({ address: manifest.budgetVault.address, abi: vaultAbi, functionName: "adapter" }),
  client.readContract({ address: manifest.budgetVault.address, abi: vaultAbi, functionName: "paused" }),
  client.readContract({ address: manifest.budgetVault.address, abi: vaultAbi, functionName: "activeCommitments" }),
  client.readContract({ address: manifest.budgetVault.address, abi: vaultAbi, functionName: "ledger" }),
  client.readContract({ address: manifest.budgetVault.address, abi: vaultAbi, functionName: "grants", args: [manifest.policy.rootGrantId] }),
  client.readContract({ address: manifest.usdc.address, abi: tokenAbi, functionName: "balanceOf", args: [manifest.budgetVault.address] }),
]);

equal(decimals, manifest.usdc.decimals, "USDC decimals");
equalAddress(token, manifest.usdc.address, "vault token");
equalAddress(owner, manifest.owner, "vault owner");
equal(depositCap, manifest.policy.depositCap, "deposit cap");
equal(maxCommitmentAmount, manifest.policy.maxCommitmentAmount, "max commitment amount");
equal(maxConcurrentCommitments, manifest.policy.maxConcurrentCommitments, "max concurrent commitments");
equalAddress(adapter, manifest.expectedState.adapter ?? zeroAddress, "adapter");
equal(paused, manifest.expectedState.paused, "paused");
equal(activeCommitments, manifest.expectedState.activeCommitments, "active commitments");
equal(rootGrant.parentId, `0x${"0".repeat(64)}`, "root grant parent");
equalAddress(rootGrant.grantee, manifest.owner, "root grant grantee");
equal(rootGrant.cap, manifest.policy.depositCap, "root grant cap");
equal(rootGrant.expiresAt, manifest.policy.rootExpiresAt, "root grant expiry");
equal(rootGrant.exists, true, "root grant exists");
equal(rootGrant.depth, 0, "root grant depth");
for (const key of ["reserved", "inEscrow", "grossSpent"]) equal(rootGrant[key], manifest.expectedState.rootGrant?.[key] ?? "0", `root grant ${key}`);
for (const key of ["revoked", "providerRestricted", "evaluatorRestricted"]) equal(rootGrant[key], false, `root grant ${key}`);
equal(vaultTokenBalance, manifest.expectedState.vaultTokenBalance, "vault token balance");

for (const [index, key] of ["deposited", "available", "reserved", "inEscrow", "settled", "withdrawn"].entries()) {
  equal(ledger[index], manifest.expectedState.ledger[key], `ledger ${key}`);
}

const vaultArtifact = JSON.parse(await readFile(new URL("../contracts/out/BudgetVault.sol/BudgetVault.json", import.meta.url), "utf8"));
await verifyCompiledSources(vaultArtifact, "BudgetVault");
const vaultInitCode = encodeDeployData({ abi: vaultArtifact.abi, bytecode: vaultArtifact.bytecode.object, args: [
  manifest.usdc.address, manifest.owner, BigInt(manifest.policy.rootExpiresAt),
  BigInt(manifest.policy.depositCap), BigInt(manifest.policy.maxCommitmentAmount), BigInt(manifest.policy.maxConcurrentCommitments),
] });
equalAddress(getCreate2Address({ from: manifest.budgetVault.deployer, salt: manifest.budgetVault.salt, bytecodeHash: keccak256(vaultInitCode) }), manifest.budgetVault.address, "BudgetVault CREATE2 artifact");
const vaultTransaction = await client.getTransaction({ hash: manifest.budgetVault.transactionHash });
if (!vaultTransaction.input.toLowerCase().includes(vaultInitCode.slice(2).toLowerCase())) throw new Error("BudgetVault transaction creation input mismatch");
let normalizedVault = (await client.getCode({ address: manifest.budgetVault.address })).slice(2);
for (const references of Object.values(vaultArtifact.deployedBytecode.immutableReferences)) {
  for (const { start, length } of references) {
    normalizedVault = normalizedVault.slice(0, start * 2) + "0".repeat(length * 2) + normalizedVault.slice((start + length) * 2);
  }
}
equal(`0x${normalizedVault}`, vaultArtifact.deployedBytecode.object, "BudgetVault runtime artifact outside immutables");

let candidateSummary;
if (manifest.draftCandidate) {
  const candidate = manifest.draftCandidate;
  const plan = JSON.parse(await readFile(new URL("../deployments/arc-mainnet-draft-candidate-plan.json", import.meta.url), "utf8"));
  const escrowAbi = parseAbi([
    "function paymentToken() view returns(address)",
    "function owner() view returns(address)",
    "function paused() view returns(bool)",
    "function totalEscrowed() view returns(uint256)",
    "function nextJobId() view returns(uint256)",
  ]);
  const adapterAbi = parseAbi([
    "function token() view returns(address)",
    "function vault() view returns(address)",
    "function escrow() view returns(address)",
  ]);
  const helperAbi = parseAbi(["function deploy(bytes initCode,bytes32 salt) returns(address)"]);
  for (const entry of candidate.supersededAdapters ?? []) {
    await Promise.all([verifyReceipt(entry, "superseded draft adapter"), verifyCode(entry, "superseded draft adapter")]);
    if (getAddress(adapter) === getAddress(entry.address)) throw new Error("Vault is bound to a superseded draft adapter");
    const oldBalance = await client.readContract({ address: manifest.usdc.address, abi: tokenAbi, functionName: "balanceOf", args: [entry.address] });
    equal(oldBalance, "0", "superseded draft adapter balance");
  }
  const constructorArgs = {
    escrow: [manifest.usdc.address, manifest.owner],
    adapter: [manifest.budgetVault.address, candidate.escrow.address, manifest.usdc.address],
  };
  for (const key of ["escrow", "adapter"]) {
    const entry = candidate[key];
    await Promise.all([verifyReceipt(entry, `draft ${key}`), verifyCode(entry, `draft ${key}`)]);
    equalAddress(entry.address, plan[key].predictedAddress, `draft ${key} planned address`);
    const artifact = JSON.parse(await readFile(new URL(`../contracts/out/${entry.contractName}.sol/${entry.contractName}.json`, import.meta.url), "utf8"));
    await verifyCompiledSources(artifact, `draft ${key}`);
    const initCode = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: constructorArgs[key] });
    equal(keccak256(initCode), plan[key].initCodeHash, `draft ${key} local creation artifact`);
    const decoded = decodeFunctionData({ abi: helperAbi, data: plan[key].deploymentCalldata });
    equal(decoded.args[0], initCode, `draft ${key} planned creation code`);
    equal(decoded.args[1], plan[key].salt, `draft ${key} planned salt`);
    equalAddress(getCreate2Address({ from: manifest.checkedCreate2Deployer.address, salt: plan[key].salt, bytecodeHash: keccak256(initCode) }), entry.address, `draft ${key} CREATE2 address`);

    const tx = await client.getTransaction({ hash: entry.transactionHash });
    if (!tx.input.toLowerCase().includes(plan[key].deploymentCalldata.slice(2).toLowerCase())) {
      throw new Error(`draft ${key}: account transaction does not contain the planned deployment calldata`);
    }
    const code = await client.getCode({ address: entry.address });
    let normalized = code.slice(2);
    const expectedWords = new Set(constructorArgs[key].map((value) => pad(value).slice(2).toLowerCase()));
    const observedWords = new Set();
    for (const references of Object.values(artifact.deployedBytecode.immutableReferences)) {
      let immutableWord;
      for (const { start, length } of references) {
        equal(length, 32, `draft ${key} immutable length`);
        const word = code.slice(2 + start * 2, 2 + (start + length) * 2).toLowerCase();
        if (!expectedWords.has(word)) throw new Error(`draft ${key}: unexpected immutable value`);
        if (immutableWord !== undefined) equal(word, immutableWord, `draft ${key} repeated immutable`);
        immutableWord = word;
        normalized = normalized.slice(0, start * 2) + "0".repeat(length * 2) + normalized.slice((start + length) * 2);
      }
      observedWords.add(immutableWord);
    }
    equal(observedWords.size, expectedWords.size, `draft ${key} constructor immutables`);
    equal(`0x${normalized}`, artifact.deployedBytecode.object, `draft ${key} runtime artifact outside immutables`);
  }
  const readEscrow = (functionName) => client.readContract({ address: candidate.escrow.address, abi: escrowAbi, functionName });
  const readAdapter = (functionName) => client.readContract({ address: candidate.adapter.address, abi: adapterAbi, functionName });
  const [paymentToken, escrowOwner, escrowPaused, totalEscrowed, nextJobId, adapterToken, adapterVault, adapterEscrow, escrowBalance, adapterBalance, allowance] = await Promise.all([
    ...["paymentToken", "owner", "paused", "totalEscrowed", "nextJobId"].map(readEscrow),
    ...["token", "vault", "escrow"].map(readAdapter),
    client.readContract({ address: manifest.usdc.address, abi: tokenAbi, functionName: "balanceOf", args: [candidate.escrow.address] }),
    client.readContract({ address: manifest.usdc.address, abi: tokenAbi, functionName: "balanceOf", args: [candidate.adapter.address] }),
    client.readContract({ address: manifest.usdc.address, abi: tokenAbi, functionName: "allowance", args: [candidate.adapter.address, candidate.escrow.address] }),
  ]);
  equalAddress(paymentToken, manifest.usdc.address, "draft escrow token");
  equalAddress(escrowOwner, manifest.owner, "draft escrow owner");
  equalAddress(adapterToken, manifest.usdc.address, "draft adapter token");
  equalAddress(adapterVault, manifest.budgetVault.address, "draft adapter vault");
  equalAddress(adapterEscrow, candidate.escrow.address, "draft adapter escrow");
  const state = candidate.expectedState;
  equal(escrowPaused, state.escrowPaused, "draft escrow paused");
  equal(totalEscrowed, state.totalEscrowed, "draft total escrowed");
  equal(nextJobId, state.nextJobId, "draft next job id");
  equal(escrowBalance, state.escrowTokenBalance, "draft escrow physical balance");
  equal(adapterBalance, state.adapterTokenBalance, "draft adapter physical balance");
  equal(allowance, state.adapterEscrowAllowance, "draft adapter allowance");
  candidateSummary = { escrow: candidate.escrow.address, adapter: candidate.adapter.address, bound: candidate.bound, creationAndRuntimeArtifactMatch: true };
}

let pilotSummary;
if (manifest.pilot) {
  const pilot = manifest.pilot;
  equal(pilot.independentReviewException, true, "pilot human-authorized review exception");
  equal(manifest.independentSecurityReview, false, "pilot does not claim independent review");
  const journal = JSON.parse(await readFile(new URL(`../${pilot.evidence}`, import.meta.url), "utf8"));
  equal(journal.state, "COMPLETE", "pilot journal completion");
  equal(journal.chainId, manifest.chainId, "pilot journal chain");
  equalAddress(journal.owner, manifest.owner, "pilot journal owner");
  const steps = Object.values(journal.steps);
  equal(steps.length, 19, "pilot transaction count");
  equal(new Set(steps.map(step => step.hash)).size, 19, "pilot unique transaction count");
  for (const step of steps) {
    equal(step.status, "CONFIRMED", `pilot ${step.name} journal status`);
    await verifyReceipt({ transactionHash: step.hash, blockNumber: step.receipt.blockNumber, gasUsed: step.receipt.gasUsed,
      effectiveGasPriceWei: step.receipt.effectiveGasPrice, receiptGasCostWei: step.receipt.gasCostWei }, `pilot ${step.name}`);
  }
  const artifactVaultAbi = vaultArtifact.abi;
  const artifactEscrow = JSON.parse(await readFile(new URL("../contracts/out/AgenticCommerceEscrow.sol/AgenticCommerceEscrow.json", import.meta.url), "utf8"));
  const artifactAdapter = JSON.parse(await readFile(new URL("../contracts/out/ERC8183DraftAdapter.sol/ERC8183DraftAdapter.json", import.meta.url), "utf8"));
  for (const [stepName, eventName, expectedRecipient, expectedAmount, jobPhase] of [
    ["refund-reject", "Refunded", manifest.draftCandidate.adapter.address, 10000n, "refund"],
    ["settle-complete", "PaymentReleased", journal.provider, 5000n, "settle"],
  ]) {
    const receipt = await client.getTransactionReceipt({ hash: journal.steps[stepName].hash });
    const events = receipt.logs.filter(log=>getAddress(log.address)===getAddress(manifest.draftCandidate.escrow.address)).flatMap(log=>{
      try { return [decodeEventLog({ abi:artifactEscrow.abi, data:log.data, topics:log.topics })]; } catch { return []; }
    });
    const matching = events.filter(event=>event.eventName===eventName);
    equal(matching.length, 1, `pilot ${stepName} payment event count`);
    equal(matching[0].args.jobId, journal.quotes[jobPhase].jobId, `pilot ${stepName} payment event job`);
    equal(matching[0].args.amount, expectedAmount, `pilot ${stepName} payment event amount`);
    equalAddress(matching[0].args.provider ?? matching[0].args.client, expectedRecipient, `pilot ${stepName} payment event recipient`);
  }
  for (const [phase, reservationStatus, jobStatus, amount] of [["refund",4,4,10000n],["settle",3,3,5000n]]) {
    const quote = journal.quotes[phase];
    const [reservation, job, jobId] = await Promise.all([
      client.readContract({ address: manifest.budgetVault.address, abi: artifactVaultAbi, functionName: "reservations", args: [quote.commitmentId] }),
      client.readContract({ address: manifest.draftCandidate.escrow.address, abi: artifactEscrow.abi, functionName: "getJob", args: [BigInt(quote.jobId)] }),
      client.readContract({ address: manifest.draftCandidate.adapter.address, abi: artifactAdapter.abi, functionName: "jobs", args: [quote.commitmentId] }),
    ]);
    equal(jobId, quote.jobId, `pilot ${phase} job id`);
    equal(reservation.status, reservationStatus, `pilot ${phase} reservation status`);
    equal(job.status, jobStatus, `pilot ${phase} escrow status`);
    equal(job.budget, amount, `pilot ${phase} job amount`);
    equal(reservation.amount, amount, `pilot ${phase} reservation amount`);
    equalAddress(job.client, manifest.draftCandidate.adapter.address, `pilot ${phase} escrow client`);
    equalAddress(job.provider, journal.provider, `pilot ${phase} provider`);
    equalAddress(job.evaluator, journal.evaluator, `pilot ${phase} evaluator`);
  }
  const child = await client.readContract({ address: manifest.budgetVault.address, abi: artifactVaultAbi, functionName:"grants", args:[journal.grantId] });
  equal(child.exists, true, "pilot grant exists");
  equal(child.providerRestricted, true, "pilot grant provider restriction");
  equal(child.evaluatorRestricted, true, "pilot grant evaluator restriction");
  equal(child.grossSpent, "5000", "pilot grant gross spend");
  const refundAllowance = await client.readContract({ address: manifest.usdc.address, abi: tokenAbi, functionName:"allowance", args:[manifest.draftCandidate.adapter.address,manifest.budgetVault.address] });
  equal(refundAllowance, "0", "pilot refund allowance cleared");
  const providerGas = steps.filter(step=>step.signer==="provider").reduce((sum,step)=>sum+BigInt(step.receipt.gasCostWei),0n);
  const reportedCircleFees = steps.filter(step=>step.signer==="circle").reduce((sum,step)=>sum+BigInt(step.feeReservationWei),0n);
  if (reportedCircleFees + providerGas > BigInt(journal.feeCeilingWei)) throw new Error("Pilot fee ceiling exceeded");
  pilotSummary = { completed:true, canonicalReceipts:steps.length, refundJobId:journal.quotes.refund.jobId, settlementJobId:journal.quotes.settle.jobId,
    independentReviewException:true, independentHumanAudit:false, feeCeilingRespected:true };
}

const verification = {
  verified: true,
  verifiedAt: new Date().toISOString(),
  chainId: manifest.chainId,
  rpcUrl,
  budgetVault: manifest.budgetVault.address,
  checkedCreate2Deployer: manifest.checkedCreate2Deployer.address,
  adapter,
  funded: manifest.funded,
  compiledSourceContentMatch: true,
  draftCandidate: candidateSummary,
  pilot: pilotSummary,
  ledger: Object.fromEntries(["deposited", "available", "reserved", "inEscrow", "settled", "withdrawn"].map((key, index) => [key, ledger[index].toString()])),
};
const outputIndex = process.argv.indexOf("--output");
if (outputIndex >= 0) {
  const outputPath = process.argv[outputIndex + 1];
  if (!outputPath) throw new Error("--output requires a local JSON file path");
  await writeFile(outputPath, `${JSON.stringify(verification, null, 2)}\n`);
}
console.log(JSON.stringify(verification, null, 2));
