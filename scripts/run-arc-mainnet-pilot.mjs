import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createPublicClient, encodeFunctionData, getAddress, http, keccak256, parseUnits, recoverAddress, parseTransaction, recoverTransactionAddress, stringToHex } from "viem";
import { arc } from "viem/chains";
import { enforcePilotFeeCap, enforcePilotScope, settledFeeReservation } from "./arc-mainnet-pilot-policy.mjs";

if (process.argv.slice(2).join(" ") !== "--broadcast-authorized-pilot") throw new Error("Use --broadcast-authorized-pilot only for the recorded human-approved scope");
const manifest = JSON.parse(await readFile("deployments/arc-mainnet.json", "utf8"));
const approved = JSON.parse(await readFile("docs/deployments/arc-mainnet-approved-pilot-preflight-2026-10-12.json", "utf8"));
const providerRecord = JSON.parse(await readFile("docs/deployments/arc-mainnet-provider-2026-10-12.json", "utf8"));
const owner = manifest.owner;
const provider = providerRecord.address;
const evaluator = owner;
const vault = manifest.budgetVault.address;
const adapter = manifest.draftCandidate.adapter.address;
const escrow = manifest.draftCandidate.escrow.address;
const token = manifest.usdc.address;
enforcePilotScope({ chainId: approved.chainId, ...approved.authorization }, { chainId: manifest.chainId, owner, adapter });
if (getAddress(approved.authorization.provider) !== getAddress(provider) || getAddress(approved.authorization.evaluator) !== getAddress(evaluator)) throw new Error("Role scope mismatch");
const client = createPublicClient({ chain: arc, transport: http(manifest.rpcUrl, { timeout: 20_000 }) });
if (await client.getChainId() !== 5042) throw new Error("Chain mismatch");
for (const entry of [manifest.budgetVault, manifest.draftCandidate.escrow, manifest.draftCandidate.adapter]) {
  const code = await client.getCode({ address: entry.address });
  if (!code || keccak256(code) !== entry.codeHash) throw new Error("Candidate code mismatch");
}
const artifact = async (source, name = source) => JSON.parse(await readFile(`contracts/out/${source}.sol/${name}.json`, "utf8"));
const vaultAbi = (await artifact("BudgetVault")).abi;
const escrowAbi = (await artifact("AgenticCommerceEscrow")).abi;
const adapterAbi = (await artifact("ERC8183DraftAdapter")).abi;
const tokenAbi = (await artifact("TestSupport", "MockUSDC")).abi;
const read = (address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args });
const balance = address => read(token, tokenAbi, "balanceOf", [address]);
if (await read(token, tokenAbi, "decimals") !== 6 || getAddress(await read(vault, vaultAbi, "owner")) !== getAddress(owner)) throw new Error("Token or owner changed");
if (await client.getCode({ address: provider })) throw new Error("Provider must be EOA");
const journalPath = "deployments/arc-mainnet-pilot-journal.json";
let journal;
try { journal = JSON.parse(await readFile(journalPath, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const stringify = value => JSON.stringify(value, (_, item) => typeof item === "bigint" ? String(item) : item, 2);
const save = async () => {
  journal.updatedAt = new Date().toISOString();
  await writeFile(`${journalPath}.tmp`, `${stringify(journal)}\n`);
  await rename(`${journalPath}.tmp`, journalPath);
};
if (!journal) {
  if (await balance(owner) < 310_000n) throw new Error("Insufficient funds to reserve approved ceiling and deposit");
  const initialLedger = await read(vault, vaultAbi, "ledger");
  if (initialLedger.deposited !== 0n || await read(vault, vaultAbi, "activeCommitments") !== 0n
    || await read(vault, vaultAbi, "adapter") !== "0x0000000000000000000000000000000000000000") throw new Error("Initial canary state differs");
  const block = await client.getBlock();
  journal = {
    chainId: 5042, owner, provider, evaluator, vault, adapter, escrow, startedAt: new Date().toISOString(),
    acceptedScope: approved.authorization, independentHumanAudit: false,
    grantId: keccak256(stringToHex("agent-commitments-mainnet-pilot-2026-10-12")),
    quoteExpiresAt: String(block.timestamp + 24n * 3600n), jobExpiresAt: String(block.timestamp + 48n * 3600n), grantExpiresAt: String(block.timestamp + 72n * 3600n),
    ownerBalanceBefore: String(await balance(owner)), providerBalanceBefore: String(await balance(provider)),
    providerFundingUnits: "20000", feeCeilingWei: String(parseUnits("0.30", 18)), steps: {}, quotes: {}, state: "RUNNING",
  };
  await save();
}
if (journal.chainId !== 5042 || getAddress(journal.owner) !== getAddress(owner) || getAddress(journal.provider) !== getAddress(provider) || journal.adapter !== adapter) throw new Error("Journal scope conflict");
const ceiling = BigInt(journal.feeCeilingWei);
const allocatedProviderWei = parseUnits(journal.providerFundingUnits, 12); // ERC-20 units to native wei: ×1e12.
function circleFeeReservations() {
  return Object.values(journal.steps).filter(step => step.signer === "circle").reduce((sum, step) => sum + BigInt(step.feeReservationWei ?? 0), 0n);
}
async function processOutput(file, args, input) {
  const child = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  child.stdin.end(input ?? "");
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`Command failed (${code}): ${stderr.slice(-1500) || stdout.slice(-1500)}`);
  return stdout.trim();
}
const bootstrap = "import {pathToFileURL} from 'node:url'; let input=''; for await (const chunk of process.stdin) input+=chunk; const {entry,args}=JSON.parse(input); process.argv=[process.execPath,entry,...args]; await import(pathToFileURL(entry).href);";
async function circle(args, callData) {
  const structured = callData !== undefined;
  const invocation = structured ? ["scripts/circle-pilot-abi-bootstrap.mjs"] : ["--input-type=module", "-e", bootstrap];
  const output = await processOutput(process.execPath, invocation, JSON.stringify({ entry: resolve(dirname(process.execPath), "node_modules/@circle-fin/cli/dist/index.js"), args, callData }));
  return JSON.parse(output).data;
}
const pause = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
async function finalize(step) {
  if (!step.hash && step.circleId) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const data = await circle(["transaction", "list", "--address", owner, "--chain", "ARC", "--limit", "50", "--output", "json"]);
      const transaction = (data.transactions ?? []).find(item => item.id === step.circleId);
      if (transaction?.txHash) { step.hash = transaction.txHash; step.circleState = transaction.state; step.circleReportedFee = transaction.networkFee; await save(); break; }
      if (transaction && ["FAILED", "DENIED", "CANCELLED"].includes(transaction.state)) throw new Error("Circle transaction ended without success");
      await pause(2000);
    }
  }
  if (!step.hash) throw new Error("Transaction response still unknown; retained journal, never create a replacement economic ID");
  const receipt = await client.waitForTransactionReceipt({ hash: step.hash, timeout: 90_000, pollingInterval: 1000 });
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (block.hash !== receipt.blockHash) throw new Error("Receipt is not canonical");
  step.receipt = { status: receipt.status, blockNumber: String(receipt.blockNumber), blockHash: receipt.blockHash, gasUsed: String(receipt.gasUsed), effectiveGasPrice: String(receipt.effectiveGasPrice), gasCostWei: String(receipt.gasUsed * receipt.effectiveGasPrice) };
  step.status = receipt.status === "success" ? "CONFIRMED" : "REVERTED";
  if (step.signer === "circle") {
    const quoted = BigInt(step.feeReservationWei);
    const reported = step.circleReportedFee === undefined ? undefined : parseUnits(String(step.circleReportedFee), 18);
    step.estimatedMaximumFeeWei ??= String(quoted);
    step.feeReservationWei = String(settledFeeReservation(BigInt(step.estimatedMaximumFeeWei), reported, receipt.gasUsed * receipt.effectiveGasPrice));
  }
  await save();
  if (step.signer === "circle") enforcePilotFeeCap(circleFeeReservations(), allocatedProviderWei, 0n, ceiling);
  if (receipt.status !== "success") throw new Error("Transaction reverted; stop and inspect authoritative state");
  console.log(`${step.name}: CONFIRMED ${step.hash}`);
  return step;
}
async function circleCall(name, to, abi, functionName, args, signature, cliArgs) {
  let step = journal.steps[name];
  const data = encodeFunctionData({ abi, functionName, args });
  if (step) {
    if (step.to !== to || step.data !== data) throw new Error("Idempotency payload conflict");
    if (step.status === "CONFIRMED") return finalize(step);
    if (step.circleId || step.hash) return finalize(step);
    if (step.status !== "REQUEST_REJECTED") throw new Error("Circle submission boundary interrupted before ID was persisted; inspect history before retrying");
    // Only a confirmed HTTP validation rejection can be prepared again; retain the exact economic payload.
    step.retryAfterValidationRejection = true;
  }
  await client.simulateContract({ address: to, abi, functionName, args, account: owner });
  const baseArgs = ["wallet", "execute", signature, ...cliArgs, "--contract", to, "--address", owner, "--chain", "ARC", "--output", "json"];
  const rawCallData = cliArgs.some(arg=>arg.startsWith("[")) ? data : undefined;
  const estimate = await circle([...baseArgs, "--estimate"], rawCallData);
  if (!estimate?.medium?.networkFee) throw new Error("Missing Circle fee estimate");
  const quoteWei = parseUnits(estimate.medium.networkFee, 18);
  const maximumFee = quoteWei * 125n / 100n;
  enforcePilotFeeCap(circleFeeReservations() - BigInt(step?.feeReservationWei ?? 0), allocatedProviderWei, maximumFee, ceiling);
  if (await balance(owner) * 1_000_000_000_000n < maximumFee + 10_000n * 1_000_000_000_000n) throw new Error("Owner funding too low");
  step = { ...step, name, signer: "circle", to, data, idempotencyKey: step?.idempotencyKey ?? randomUUID(), status: "SUBMITTING", feeReservationWei: String(maximumFee), feeEstimate: estimate };
  journal.steps[name] = step;
  await save();
  console.log(`${name}: submit with checked fee and stable idempotency`);
  const result = await circle([...baseArgs, "--idempotency-key", step.idempotencyKey], rawCallData);
  step.circleId = result.id; step.circleState = result.state; step.hash = result.txHash; step.circleReportedFee = result.networkFee;
  step.status = "SUBMITTED";
  await save();
  return finalize(step);
}
async function providerCall(name, functionName, args) {
  let step = journal.steps[name];
  const data = encodeFunctionData({ abi: escrowAbi, functionName, args });
  if (step) {
    if (step.data !== data) throw new Error("Provider payload conflict");
    // Signed raw transaction was persisted before broadcast: always recover its exact hash.
    return finalize(step);
  }
  await client.simulateContract({ address: escrow, abi: escrowAbi, functionName, args, account: provider });
  const estimated = await client.estimateGas({ account: provider, to: escrow, data });
  const gasLimit = estimated * 125n / 100n;
  const gasPrice = (await client.getGasPrice()) * 125n / 100n;
  if (gasLimit > 500000n || gasPrice > 100000000000n || await balance(provider) * 1_000_000_000_000n < gasLimit * gasPrice) throw new Error("Provider gas cap or balance insufficient");
  const previousProviderFees = Object.values(journal.steps).filter(s=>s.signer==="provider").reduce((sum,s)=>sum+BigInt(s.maximumFeeWei??0),0n);
  if (previousProviderFees + gasLimit * gasPrice > allocatedProviderWei) throw new Error("Provider fee allocation exceeded");
  const nonce = await client.getTransactionCount({ address: provider, blockTag: "pending" });
  const raw = await processOutput("pwsh", ["-NoProfile", "-File", "scripts/sign-arc-mainnet-provider.ps1", "-Mode", "transaction", "-To", escrow, "-Data", data, "-Nonce", String(nonce), "-GasLimit", String(gasLimit), "-GasPriceWei", String(gasPrice)]);
  const decoded = parseTransaction(raw);
  if (decoded.chainId !== 5042 || getAddress(decoded.to) !== getAddress(escrow) || decoded.data !== data || (decoded.value ?? 0n) !== 0n
    || decoded.nonce !== nonce || decoded.gas !== gasLimit || decoded.gasPrice !== gasPrice
    || getAddress(await recoverTransactionAddress({ serializedTransaction: raw })) !== getAddress(provider)) throw new Error("Signed provider transaction scope mismatch");
  step = { name, signer: "provider", to: escrow, data, hash: keccak256(raw), rawTransaction: raw, nonce, status: "PREPARED", maximumFeeWei: String(gasLimit * gasPrice) };
  journal.steps[name] = step;
  await save();
  step.status = "SENDING"; await save();
  const hash = await client.sendRawTransaction({ serializedTransaction: raw });
  if (hash !== step.hash) throw new Error("Provider hash conflict");
  step.status = "SUBMITTED"; await save();
  return finalize(step);
}
async function quoteFor(phase, amount) {
  if (!journal.quotes[phase]) {
    const input = {
      grantId: journal.grantId, operationId: keccak256(stringToHex(`mainnet-pilot-${phase}-2026-10-12`)), provider, evaluator, token, adapter, amount,
      quoteExpiresAt: BigInt(journal.quoteExpiresAt), jobExpiresAt: BigInt(journal.jobExpiresAt),
      workHash: keccak256(stringToHex(`internal-pilot-no-customer-data-${phase}`)), nonce: keccak256(stringToHex(`mainnet-pilot-${phase}-nonce-2026-10-12`)),
    };
    const digest = await read(vault, vaultAbi, "quoteDigest", [input]);
    const signature = await processOutput("pwsh", ["-NoProfile", "-File", "scripts/sign-arc-mainnet-provider.ps1", "-Mode", "quote", "-Digest", digest]);
    if (getAddress(await recoverAddress({ hash: digest, signature })) !== getAddress(provider)) throw new Error("Provider signature mismatch");
    const commitmentId = await read(vault, vaultAbi, "commitmentId", [journal.grantId, input.operationId]);
    journal.quotes[phase] = { input, signature, digest, commitmentId };
    await save();
  }
  const stored = journal.quotes[phase];
  return { ...stored, input: { ...stored.input, amount: BigInt(stored.input.amount), quoteExpiresAt: BigInt(stored.input.quoteExpiresAt), jobExpiresAt: BigInt(stored.input.jobExpiresAt) } };
}
async function fundPhase(phase, amount) {
  const quote = await quoteFor(phase, amount);
  const tuple = JSON.stringify(Object.values(quote.input).map(String));
  await circleCall(`${phase}-reserve`, vault, vaultAbi, "reserve", [quote.input, quote.signature], "reserve((bytes32,bytes32,address,address,address,address,uint256,uint256,uint256,bytes32,bytes32),bytes)", [tuple, quote.signature]);
  await circleCall(`${phase}-dispatch`, adapter, adapterAbi, "dispatch", [quote.commitmentId], "dispatch(bytes32)", [quote.commitmentId]);
  const jobId = await read(adapter, adapterAbi, "jobs", [quote.commitmentId]);
  if (jobId === 0n) throw new Error("Job not dispatched");
  if (quote.jobId && BigInt(quote.jobId) !== jobId) throw new Error("Job id conflict");
  journal.quotes[phase].jobId = String(jobId); await save();
  await providerCall(`${phase}-price`, "setBudget", [jobId, amount, "0x"]);
  await circleCall(`${phase}-fund`, adapter, adapterAbi, "fund", [quote.commitmentId], "fund(bytes32)", [quote.commitmentId]);
  return { id: quote.commitmentId, jobId };
}
try {
  await circleCall("bind", vault, vaultAbi, "setAdapter", [adapter], "setAdapter(address)", [adapter]);
  await circleCall("provider-gas", token, tokenAbi, "transfer", [provider, 20000n], "transfer(address,uint256)", [provider, "20000"]);
  await circleCall("approve", token, tokenAbi, "approve", [vault, 10000n], "approve(address,uint256)", [vault, "10000"]);
  await circleCall("deposit", vault, vaultAbi, "deposit", [10000n], "deposit(uint256)", ["10000"]);
  const root = await read(vault, vaultAbi, "ROOT_GRANT_ID");
  await circleCall("grant", vault, vaultAbi, "createGrant", [journal.grantId, root, owner, 20000n, BigInt(journal.grantExpiresAt), [provider], [evaluator]], "createGrant(bytes32,bytes32,address,uint256,uint256,address[],address[])", [journal.grantId, root, owner, "20000", journal.grantExpiresAt, JSON.stringify([provider]), JSON.stringify([evaluator])]);
  const refund = await fundPhase("refund", 10000n);
  const rejectedReason = keccak256(stringToHex("internal-pilot-rejected"));
  await circleCall("refund-reject", escrow, escrowAbi, "reject", [refund.jobId, rejectedReason, "0x"], "reject(uint256,bytes32,bytes)", [String(refund.jobId), rejectedReason, "0x"]);
  await circleCall("refund-reconcile", adapter, adapterAbi, "reconcile", [refund.id], "reconcile(bytes32)", [refund.id]);
  if ((await read(vault, vaultAbi, "reservations", [refund.id])).status !== 4) throw new Error("Refund not recorded");
  const settled = await fundPhase("settle", 5000n);
  await providerCall("settle-submit", "submit", [settled.jobId, keccak256(stringToHex("internal-pilot-output")), "0x"]);
  const acceptedReason = keccak256(stringToHex("internal-pilot-accepted"));
  await circleCall("settle-complete", escrow, escrowAbi, "complete", [settled.jobId, acceptedReason, "0x"], "complete(uint256,bytes32,bytes)", [String(settled.jobId), acceptedReason, "0x"]);
  await circleCall("settle-reconcile", adapter, adapterAbi, "reconcile", [settled.id], "reconcile(bytes32)", [settled.id]);
  await circleCall("withdraw", vault, vaultAbi, "withdrawAvailable", [owner, 5000n], "withdrawAvailable(address,uint256)", [owner, "5000"]);
  const ledger = await read(vault, vaultAbi, "ledger");
  if (ledger.deposited !== 10000n || ledger.settled !== 5000n || ledger.withdrawn !== 5000n || ledger.available+ledger.reserved+ledger.inEscrow !== 0n) throw new Error("Final ledger mismatch");
  if (await read(vault,vaultAbi,"activeCommitments") !== 0n || await read(escrow,escrowAbi,"totalEscrowed") !== 0n || await balance(vault) !== 0n || await balance(adapter) !== 0n || await balance(escrow) !== 0n) throw new Error("Stranded funds or obligations");
  if (await read(token,tokenAbi,"allowance",[adapter,vault]) !== 0n || await read(token,tokenAbi,"allowance",[adapter,escrow]) !== 0n) throw new Error("Residual adapter allowance");
  journal.finalLedger = ledger; journal.ownerBalanceAfter = String(await balance(owner)); journal.providerBalanceAfter = String(await balance(provider));
  journal.circleFeeReservationsWei = String(circleFeeReservations());
  journal.providerActualGasCostWei = String(Object.values(journal.steps).filter(s=>s.signer==="provider").reduce((sum,s)=>sum+BigInt(s.receipt.gasCostWei),0n));
  if (journal.lastError) { journal.resolvedLastError = journal.lastError; delete journal.lastError; }
  journal.state = "COMPLETE"; await save();
  console.log(`Pilot COMPLETE: ${stringify(ledger)}`);
} catch (error) {
  journal.state = "NEEDS_RECONCILIATION"; journal.lastError = error.message; await save();
  throw error;
}
