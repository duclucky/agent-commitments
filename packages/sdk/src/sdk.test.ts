import { describe, expect, it } from "vitest";
import { decodeFunctionData, keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  AgentCommitmentsClient,
  CircleWalletsExecutor,
  createArcTestnetClient,
  createViemChainReader,
  adapterAbi,
  agenticCommerceAbi,
  agenticCommerceDraftAbi,
  arcMainnetCanaryDeployment,
  arcTestnetDeployment,
  budgetVaultAbi,
  deriveCommitmentId,
  erc20Abi,
  quoteDigest,
  quoteTypedData,
  type CircleTransactionState,
  type Quote,
} from "./index.js";

const vault = "0x1000000000000000000000000000000000000001" as const;
const adapter = "0x2000000000000000000000000000000000000002" as const;
const account = privateKeyToAccount("0x59c6995e998f97a5a0044976f0945389dc9e86dae88c7a8412f4603b6b78690d");
const quote: Quote = {
  grantId: keccak256(stringToHex("grant")), operationId: keccak256(stringToHex("operation")),
  provider: account.address, evaluator: "0x3000000000000000000000000000000000000003",
  token: "0x3600000000000000000000000000000000000000",
  adapter,
  amount: 12_500_000n, quoteExpiresAt: 1_800_000_000n, jobExpiresAt: 1_800_086_400n,
  workHash: keccak256(stringToHex("work")), nonce: keccak256(stringToHex("nonce")),
};

describe("quote binding", () => {
  it("produces a signature recoverable only for the exact EIP-712 terms", async () => {
    const typed = quoteTypedData(5_042_002, vault, quote);
    const signature = await account.signTypedData(typed);
    expect(await account.signTypedData(typed)).toBe(signature);
    expect(quoteDigest(5_042_002, vault, quote)).not.toBe(quoteDigest(5_042, vault, quote));
    expect(quoteDigest(5_042_002, vault, quote)).not.toBe(quoteDigest(5_042_002, adapter, quote));
    expect(quoteDigest(5_042_002, vault, quote)).not.toBe(quoteDigest(5_042_002, vault, {
      ...quote,
      token: "0x4000000000000000000000000000000000000004",
    }));
    expect(quoteDigest(5_042_002, vault, quote)).not.toBe(quoteDigest(5_042_002, vault, {
      ...quote,
      adapter: "0x5000000000000000000000000000000000000005",
    }));
  });

  it("derives commitment identity from chain, vault, grant and operation", () => {
    const id = deriveCommitmentId(5_042_002, vault, quote.grantId, quote.operationId);
    expect(id).toHaveLength(66);
    expect(id).not.toBe(deriveCommitmentId(5_042, vault, quote.grantId, quote.operationId));
  });
});

describe("prepare-only client", () => {
  it("creates a client pinned to the verified Arc testnet deployment", () => {
    const client = createArcTestnetClient();
    expect(client.chainId).toBe(5_042_002);
    expect(client.vault).toBe(arcTestnetDeployment.budgetVault);
    expect(client.adapter).toBe(arcTestnetDeployment.erc8183Adapter);
  });

  it("exposes the mainnet vault canary without inventing adapter addresses", () => {
    expect(arcMainnetCanaryDeployment).toMatchObject({
      chainId: 5_042,
      budgetVault: "0x2415a87B0b9280C1989F03ceA9DC1c3644777862",
      erc8183Adapter: null,
      erc8183Escrow: null,
      operational: false,
    });
  });

  it("adapts viem reads while keeping a missing receipt distinct from RPC failure", async () => {
    const missing = new Error("receipt not found");
    missing.name = "TransactionReceiptNotFoundError";
    const viem = {
      readContract: async () => 25_000_000n,
      getTransactionReceipt: async () => { throw missing; },
    };
    const reader = createViemChainReader(viem);
    await expect(reader.readContract({
      address: vault,
      abi: budgetVaultAbi,
      functionName: "maxCommitmentAmount",
    })).resolves.toBe(25_000_000n);
    await expect(reader.getTransactionReceipt({ hash: keccak256(stringToHex("pending")) }))
      .resolves.toBeUndefined();

    viem.getTransactionReceipt = async () => { throw new Error("RPC unavailable"); };
    await expect(reader.getTransactionReceipt({ hash: keccak256(stringToHex("rpc-error")) }))
      .rejects.toThrow("RPC unavailable");
  });

  it("encodes reserve without retaining a signer", () => {
    const client = new AgentCommitmentsClient(5_042_002, vault, adapter);
    const prepared = client.prepareReserve(quote, "0x1234");
    const decoded = decodeFunctionData({ abi: budgetVaultAbi, data: prepared.data });
    expect(decoded.functionName).toBe("reserve");
    expect(prepared.to).toBe(vault);
    expect(prepared.chainId).toBe(5_042_002);
  });

  it("prepares budget funding and emergency pause controls without retaining an owner signer", () => {
    const client = new AgentCommitmentsClient(5_042_002, vault, adapter);
    const approval = decodeFunctionData({ abi: erc20Abi, data: client.prepareDepositApproval(8_000_000n).data });
    const deposit = decodeFunctionData({ abi: budgetVaultAbi, data: client.prepareDeposit(8_000_000n).data });
    const pause = decodeFunctionData({ abi: budgetVaultAbi, data: client.prepareSetPaused(true).data });
    expect(approval.functionName).toBe("approve");
    expect(approval.args).toEqual([vault, 8_000_000n]);
    expect(deposit.functionName).toBe("deposit");
    expect(deposit.args).toEqual([8_000_000n]);
    expect(pause.functionName).toBe("setPaused");
    expect(pause.args).toEqual([true]);
  });

  it("prepares the provider-priced Arc reference funding handshake", () => {
    const client = createArcTestnetClient();
    const commitmentId = deriveCommitmentId(5_042_002, vault, quote.grantId, quote.operationId);
    const dispatched = decodeFunctionData({ abi: adapterAbi, data: client.prepareDispatch(commitmentId).data });
    const pricedCall = client.prepareProviderBudget(186_887n, quote.amount);
    const priced = decodeFunctionData({ abi: agenticCommerceAbi, data: pricedCall.data });
    const funded = decodeFunctionData({ abi: adapterAbi, data: client.prepareFund(commitmentId).data });

    expect(dispatched.functionName).toBe("dispatch");
    expect(priced.functionName).toBe("setBudget");
    expect(priced.args).toEqual([186_887n, quote.amount, "0x"]);
    expect(pricedCall.to).toBe(arcTestnetDeployment.erc8183Escrow);
    expect(funded.functionName).toBe("fund");
  });

  it("encodes attenuated provider and evaluator policy in a grant", () => {
    const client = new AgentCommitmentsClient(5_042_002, vault, adapter);
    const prepared = client.prepareGrant({
      grantId: quote.grantId,
      parentId: keccak256(stringToHex("parent")),
      grantee: account.address,
      cap: 25_000_000n,
      expiresAt: 1_800_000_000n,
      providers: [account.address],
      evaluators: [quote.evaluator],
    });
    const decoded = decodeFunctionData({ abi: budgetVaultAbi, data: prepared.data });
    expect(decoded.functionName).toBe("createGrant");
    expect(decoded.args?.[5]).toEqual([account.address]);
    expect(decoded.args?.[6]).toEqual([quote.evaluator]);
  });

  it("prepares provider, evaluator and recovery calls without owning signer keys", () => {
    const escrow = "0x4000000000000000000000000000000000000004" as const;
    const client = new AgentCommitmentsClient(5_042, vault, adapter, undefined, escrow);
    const deliverable = keccak256(stringToHex("deliverable"));
    const reason = keccak256(stringToHex("accepted"));

    expect(decodeFunctionData({ abi: agenticCommerceAbi, data: client.prepareSubmit(7n, deliverable).data }))
      .toMatchObject({ functionName: "submit", args: [7n, deliverable, "0x"] });
    expect(decodeFunctionData({ abi: agenticCommerceAbi, data: client.prepareComplete(7n, reason).data }))
      .toMatchObject({ functionName: "complete", args: [7n, reason, "0x"] });
    expect(decodeFunctionData({ abi: agenticCommerceAbi, data: client.prepareReject(7n, reason).data }))
      .toMatchObject({ functionName: "reject", args: [7n, reason, "0x"] });
    expect(decodeFunctionData({ abi: agenticCommerceAbi, data: client.prepareClaimRefund(7n).data }))
      .toMatchObject({ functionName: "claimRefund", args: [7n] });

    const draftFund = agenticCommerceDraftAbi.find((entry) => entry.type === "function" && entry.name === "fund");
    expect(draftFund).toMatchObject({ inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "bytes" }] });
  });

  it("uses the configured escrow for provider pricing on mainnet", () => {
    const escrow = "0x4000000000000000000000000000000000000004" as const;
    const client = new AgentCommitmentsClient(5_042, vault, adapter, undefined, escrow);
    expect(client.prepareProviderBudget(7n, 10n).to).toBe(escrow);
  });

  it("does not treat a transaction hash as confirmation", async () => {
    const reader = {
      readContract: async ({ functionName }: { functionName: string }) => functionName === "ledger" ? { available: 1n } : { status: 2 },
      getTransactionReceipt: async () => undefined,
    };
    const client = new AgentCommitmentsClient(5_042_002, vault, adapter, reader);
    const result = await client.inspect(keccak256(stringToHex("commitment")), keccak256(stringToHex("tx")));
    expect(result.transportState).toBe("UNKNOWN");
    expect(result.economicState).toBe(2);
    expect(result.economicStatus).toBe("FUNDED");
    expect(result.recoveryActions).toContain("WAIT_FOR_ESCROW");
    expect(result.recoveryActions).toContain("CHECK_TRANSACTION");
  });

  it("derives the next safe action from authoritative vault and escrow state", async () => {
    const jobId = 91n;
    const reader = {
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "ledger") return { deposited: 10n, available: 0n, reserved: 10n };
        if (functionName === "reservations") return { status: 1, amount: 10n };
        if (functionName === "jobs") return jobId;
        if (functionName === "getJob") return { status: 0, budget: 10n };
        throw new Error(`Unexpected read ${functionName}`);
      },
      getTransactionReceipt: async () => undefined,
    };
    const escrow = "0x4000000000000000000000000000000000000004" as const;
    const client = new AgentCommitmentsClient(5_042_002, vault, adapter, reader, escrow);
    const result = await client.inspect(keccak256(stringToHex("ready-to-fund")));
    expect(result).toMatchObject({
      economicStatus: "RESERVED",
      jobId,
      escrowStatus: "OPEN",
      recoveryActions: ["FUND"],
    });
  });

  it("recommends reconciliation only after escrow reaches a terminal state", async () => {
    const reader = {
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "ledger") return {};
        if (functionName === "reservations") return { status: 2 };
        if (functionName === "jobs") return 92n;
        if (functionName === "getJob") return { status: 3, budget: 10n };
        throw new Error(`Unexpected read ${functionName}`);
      },
      getTransactionReceipt: async () => undefined,
    };
    const client = new AgentCommitmentsClient(
      5_042_002, vault, adapter, reader, "0x4000000000000000000000000000000000000004",
    );
    const result = await client.inspect(keccak256(stringToHex("terminal")));
    expect(result.escrowStatus).toBe("COMPLETED");
    expect(result.recoveryActions).toEqual(["RECONCILE"]);
  });

  it("reads immutable caps and effective grant parties for developer tooling", async () => {
    const values: Record<string, unknown> = {
      depositCap: 100_000_000n,
      maxCommitmentAmount: 25_000_000n,
      maxConcurrentCommitments: 4n,
      activeCommitments: 2n,
      isProviderAllowed: true,
      isEvaluatorAllowed: false,
    };
    const reader = {
      readContract: async ({ functionName }: { functionName: string }) => values[functionName],
      getTransactionReceipt: async () => undefined,
    };
    const client = new AgentCommitmentsClient(5_042_002, vault, adapter, reader);
    const policy = await client.inspectPolicy({
      grantId: quote.grantId,
      provider: quote.provider,
      evaluator: quote.evaluator,
    });
    expect(policy).toMatchObject({
      depositCap: 100_000_000n,
      maxCommitmentAmount: 25_000_000n,
      maxConcurrentCommitments: 4n,
      activeCommitments: 2n,
      providerAllowed: true,
      evaluatorAllowed: false,
    });
  });

  it("rejects unsupported chains before a call can be prepared", () => {
    expect(() => new AgentCommitmentsClient(1, vault, adapter)).toThrow("Unsupported chain");
  });
});

describe("Circle Developer-Controlled Wallets executor", () => {
  it("submits Arc testnet calldata with the caller's stable idempotency key", async () => {
    const requests: unknown[] = [];
    const circle = {
      createContractExecutionTransaction: async (request: unknown) => {
        requests.push(request);
        return { data: { id: "circle-transaction-1", state: "INITIATED" as const } };
      },
      getTransaction: async () => ({ data: {} }),
    };
    const executor = new CircleWalletsExecutor(circle, "circle-wallet-1");
    const call = new AgentCommitmentsClient(5_042_002, vault, adapter).prepareDispatch(
      deriveCommitmentId(5_042_002, vault, quote.grantId, quote.operationId),
    );

    const result = await executor.submit(call, {
      idempotencyKey: "2e49db68-4094-4a69-9f60-6fc0bb19ec63",
      refId: "dispatch:example-operation",
    });

    expect(requests).toEqual([{
      walletId: "circle-wallet-1",
      contractAddress: adapter,
      callData: call.data,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      idempotencyKey: "2e49db68-4094-4a69-9f60-6fc0bb19ec63",
      refId: "dispatch:example-operation",
    }]);
    expect(result).toEqual({
      transactionId: "circle-transaction-1",
      circleState: "INITIATED",
      phase: "PENDING",
    });
  });

  it("keeps Circle finality and terminal failures distinct", async () => {
    let state: CircleTransactionState = "CONFIRMED";
    const circle = {
      createContractExecutionTransaction: async () => ({ data: { id: "unused", state: "INITIATED" as const } }),
      getTransaction: async () => ({
        data: { transaction: { id: "circle-transaction-1", state, txHash: "0x1234" } },
      }),
    };
    const executor = new CircleWalletsExecutor(circle, "circle-wallet-1");

    await expect(executor.inspect("circle-transaction-1")).resolves.toMatchObject({ phase: "MINED" });
    state = "COMPLETE";
    await expect(executor.inspect("circle-transaction-1")).resolves.toMatchObject({ phase: "FINALIZED" });
    state = "FAILED";
    await expect(executor.inspect("circle-transaction-1")).resolves.toMatchObject({ phase: "TERMINAL_FAILURE" });
    state = "STUCK";
    await expect(executor.inspect("circle-transaction-1")).resolves.toMatchObject({ phase: "UNKNOWN" });
  });

  it("polls an existing Circle transaction through finality without resubmitting", async () => {
    const states: CircleTransactionState[] = ["INITIATED", "CONFIRMED", "COMPLETE"];
    let createCalls = 0;
    let inspectCalls = 0;
    const circle = {
      createContractExecutionTransaction: async () => {
        createCalls += 1;
        return { data: { id: "unused", state: "INITIATED" as const } };
      },
      getTransaction: async () => ({
        data: {
          transaction: {
            id: "circle-transaction-1",
            state: states[Math.min(inspectCalls++, states.length - 1)]!,
            blockchain: "ARC-TESTNET",
            txHash: "0x1234",
          },
        },
      }),
    };
    const executor = new CircleWalletsExecutor(circle, "circle-wallet-1");

    await expect(executor.waitForFinality("circle-transaction-1", {
      pollIntervalMs: 0,
      timeoutMs: 1_000,
    })).resolves.toMatchObject({ circleState: "COMPLETE", phase: "FINALIZED" });
    expect(inspectCalls).toBe(3);
    expect(createCalls).toBe(0);
  });

  it("stops Circle polling on timeout or uncertain terminal state", async () => {
    let state: CircleTransactionState = "INITIATED";
    const circle = {
      createContractExecutionTransaction: async () => ({ data: { id: "unused", state: "INITIATED" as const } }),
      getTransaction: async () => ({
        data: { transaction: { id: "circle-transaction-1", state, blockchain: "ARC-TESTNET" } },
      }),
    };
    const executor = new CircleWalletsExecutor(circle, "circle-wallet-1");

    await expect(executor.waitForFinality("circle-transaction-1", {
      pollIntervalMs: 0,
      timeoutMs: 0,
    })).rejects.toThrow("timed out");

    state = "STUCK";
    await expect(executor.waitForFinality("circle-transaction-1", {
      pollIntervalMs: 0,
      timeoutMs: 1_000,
    })).resolves.toMatchObject({ circleState: "STUCK", phase: "UNKNOWN" });
  });

  it("rejects Arc mainnet until Circle documents Wallets support there", async () => {
    const circle = {
      createContractExecutionTransaction: async () => ({ data: { id: "unused", state: "INITIATED" as const } }),
      getTransaction: async () => ({ data: {} }),
    };
    const executor = new CircleWalletsExecutor(circle, "circle-wallet-1");
    const call = new AgentCommitmentsClient(5_042, vault, adapter).prepareDispatch(
      deriveCommitmentId(5_042, vault, quote.grantId, quote.operationId),
    );

    await expect(executor.submit(call, { idempotencyKey: "same-economic-task" }))
      .rejects.toThrow("ARC-TESTNET");
  });

  it("rejects missing idempotency and malformed Circle responses", async () => {
    const circle = {
      createContractExecutionTransaction: async () => ({}),
      getTransaction: async () => ({ data: {} }),
    };
    const executor = new CircleWalletsExecutor(circle, "circle-wallet-1");
    const call = new AgentCommitmentsClient(5_042_002, vault, adapter).prepareDispatch(
      deriveCommitmentId(5_042_002, vault, quote.grantId, quote.operationId),
    );

    await expect(executor.submit(call, { idempotencyKey: " " })).rejects.toThrow("idempotencyKey");
    await expect(executor.submit(call, { idempotencyKey: "same-economic-task" }))
      .rejects.toThrow("transaction id and state");
    await expect(executor.inspect("circle-transaction-1")).rejects.toThrow("did not return a transaction");
  });
});
