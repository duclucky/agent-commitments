import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import {
  AgentCommitmentsClient,
  CircleWalletsExecutor,
  arcTestnet,
  deriveCommitmentId,
} from "@agent-commitments/sdk";
import { keccak256, stringToHex, type Address } from "viem";

const vault = (process.env.BUDGET_VAULT_ADDRESS
  ?? "0x1000000000000000000000000000000000000001") as Address;
const adapter = (process.env.ESCROW_ADAPTER_ADDRESS
  ?? "0x2000000000000000000000000000000000000002") as Address;
const walletId = process.env.CIRCLE_WALLET_ID ?? "replace-with-circle-wallet-id";
const operationId = process.env.OPERATION_ID
  ? ensureBytes32(process.env.OPERATION_ID, "OPERATION_ID")
  : keccak256(stringToHex("circle-wallets-example-operation"));
const grantId = process.env.GRANT_ID
  ? ensureBytes32(process.env.GRANT_ID, "GRANT_ID")
  : keccak256(stringToHex("circle-wallets-example-grant"));
const commitmentId = deriveCommitmentId(arcTestnet.chainId, vault, grantId, operationId);
const call = new AgentCommitmentsClient(arcTestnet.chainId, vault, adapter).prepareDispatch(commitmentId);
const idempotencyKey = process.env.CIRCLE_IDEMPOTENCY_KEY
  ?? "2e49db68-4094-4a69-9f60-6fc0bb19ec63";

const preview = {
  walletId,
  contractAddress: call.to,
  callData: call.data,
  fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  idempotencyKey,
  refId: `dispatch:${operationId}`,
};

if (process.env.ALLOW_SHARED_NETWORK_BROADCAST !== "ARC-TESTNET") {
  console.log(JSON.stringify({
    mode: "prepare-only",
    note: "No credentials were read and no transaction was submitted.",
    network: arcTestnet.name,
    circleRequest: preview,
  }, null, 2));
} else {
  const apiKey = required("CIRCLE_API_KEY");
  const entitySecret = required("CIRCLE_ENTITY_SECRET");
  if (walletId === "replace-with-circle-wallet-id") throw new Error("CIRCLE_WALLET_ID is required");
  if (!process.env.BUDGET_VAULT_ADDRESS || !process.env.ESCROW_ADAPTER_ADDRESS) {
    throw new Error("BUDGET_VAULT_ADDRESS and ESCROW_ADAPTER_ADDRESS are required");
  }

  const circle = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  const executor = new CircleWalletsExecutor(circle, walletId);
  const submission = await executor.submit(call, {
    idempotencyKey,
    refId: `dispatch:${operationId}`,
  });
  const inspection = await executor.waitForFinality(submission.transactionId, {
    pollIntervalMs: Number(process.env.CIRCLE_POLL_INTERVAL_MS ?? "1000"),
    timeoutMs: Number(process.env.CIRCLE_FINALITY_TIMEOUT_MS ?? "120000"),
  });
  console.log(JSON.stringify({ mode: "finality-inspected", network: arcTestnet.name, submission, inspection }, null, 2));
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function ensureBytes32(value: string, name: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be bytes32 hex`);
  return value as `0x${string}`;
}
