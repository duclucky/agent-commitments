import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, keccak256, stringToHex } from "viem";
import { AgentCommitmentsClient, adapterAbi, type ChainReader } from "./index.js";

const vault = "0x1000000000000000000000000000000000000001" as const;
const adapter = "0x2000000000000000000000000000000000000002" as const;
const escrow = "0x3000000000000000000000000000000000000003" as const;
const commitmentId = keccak256(stringToHex("refund-recovery"));
const txHash = keccak256(stringToHex("pending-refund"));
const ledger = { deposited: 100n, available: 60n, reserved: 10n, inEscrow: 20n, settled: 5n, withdrawn: 5n };

function fixture(overrides: Partial<ChainReader> = {}) {
  const reader = {
    getBlockNumber: vi.fn(async () => 123n),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "ledger") return ledger;
      if (functionName === "reservations") return { status: 2, amount: 20n };
      if (functionName === "jobs") return 7n;
      if (functionName === "getJob") return { status: 4, budget: 20n };
      if (functionName === "balanceOf") return 75n;
      if (functionName === "decimals") return 6;
      if (functionName === "token") return "0x3600000000000000000000000000000000000000";
      throw new Error(`Unexpected read ${functionName}`);
    }),
    getTransactionReceipt: vi.fn(async () => undefined),
    simulateContract: vi.fn(async () => undefined),
    ...overrides,
  };
  return { reader, client: new AgentCommitmentsClient(5042, vault, adapter, reader, escrow) };
}

describe("refund recovery", () => {
  it("only prepares reconciliation after a successful simulation of the same commitment", async () => {
    const { client, reader } = fixture();
    const recovery = await client.inspectRefundRecovery(commitmentId);
    expect(recovery.state).toBe("READY");
    expect(recovery.commitment.economicStatus).toBe("FUNDED");
    expect(recovery.amount).toBe(20n);
    expect(reader.simulateContract).toHaveBeenCalledWith(expect.objectContaining({
      address: adapter, functionName: "reconcile", args: [commitmentId], blockNumber: 123n,
    }));
    for (const [request] of vi.mocked(reader.readContract).mock.calls) expect(request).toMatchObject({ blockNumber: 123n });
    const call = await client.prepareRefundReconciliation(commitmentId);
    expect(decodeFunctionData({ abi: adapterAbi, data: call.data })).toMatchObject({ functionName: "reconcile", args: [commitmentId] });
  });

  it("keeps a blocked refund FUNDED and becomes ready after a fresh successful check", async () => {
    const revert = new Error("private RPC payload must not appear in status");
    revert.name = "ContractFunctionRevertedError";
    const simulation = vi.fn().mockRejectedValueOnce({ cause: revert }).mockResolvedValue(undefined);
    const { client } = fixture({ simulateContract: simulation });
    const blocked = await client.inspectRefundRecovery(commitmentId);
    expect(blocked.state).toBe("BLOCKED");
    expect(blocked.reason).toBe("SIMULATION_REVERTED");
    expect(blocked.commitment.economicStatus).toBe("FUNDED");
    expect(JSON.stringify(blocked, (_, value) => typeof value === "bigint" ? String(value) : value)).not.toContain("private RPC payload");
    expect((await client.inspectRefundRecovery(commitmentId)).state).toBe("READY");
  });

  it("rejects preparing another transaction while the prior receipt is unknown", async () => {
    const { client, reader } = fixture();
    expect(await client.inspectRefundRecovery(commitmentId, txHash)).toMatchObject({ state: "UNKNOWN", reason: "TRANSACTION_PENDING" });
    await expect(client.prepareRefundReconciliation(commitmentId, txHash)).rejects.toThrow("TRANSACTION_PENDING");
    expect(reader.simulateContract).not.toHaveBeenCalled();
  });

  it("distinguishes RPC failure from an onchain revert and does not broadcast", async () => {
    const { client } = fixture({ simulateContract: async () => { throw new Error("RPC offline"); } });
    expect(await client.inspectRefundRecovery(commitmentId)).toMatchObject({ state: "UNKNOWN", reason: "SIMULATION_UNAVAILABLE" });
    await expect(client.prepareRefundReconciliation(commitmentId)).rejects.toThrow("SIMULATION_UNAVAILABLE");
  });

  it("does not infer refund readiness without simulation support", async () => {
    const { client } = fixture({ simulateContract: undefined });
    expect(await client.inspectRefundRecovery(commitmentId)).toMatchObject({ state: "UNKNOWN", reason: "SIMULATION_UNAVAILABLE" });
  });

  it("does not enable retry from unpinned reads", async () => {
    const { client, reader } = fixture({ getBlockNumber: undefined });
    expect(await client.inspectRefundRecovery(commitmentId)).toMatchObject({ state: "UNKNOWN", reason: "SNAPSHOT_UNAVAILABLE" });
    expect(reader.simulateContract).not.toHaveBeenCalled();
  });

  it("never proposes another refund for a reconciled reservation", async () => {
    const { client, reader } = fixture({ readContract: async ({ functionName }) => {
      if (functionName === "reservations") return { status: 4, amount: 20n };
      if (functionName === "getJob") return { status: 5, budget: 20n };
      if (functionName === "jobs") return 7n;
      return ledger;
    } });
    expect((await client.inspectRefundRecovery(commitmentId)).state).toBe("REFUNDED");
    await expect(client.prepareRefundReconciliation(commitmentId)).rejects.toThrow("REFUNDED");
    expect(reader.simulateContract).not.toHaveBeenCalled();
  });

  it("does not treat a Completed payout as a refund", async () => {
    const { client, reader } = fixture({ readContract: async ({ functionName }) => {
      if (functionName === "getJob") return { status: 3, budget: 20n };
      if (functionName === "jobs") return 7n;
      if (functionName === "reservations") return { status: 2, amount: 20n };
      return ledger;
    } });
    expect((await client.inspectRefundRecovery(commitmentId)).state).toBe("NOT_APPLICABLE");
    expect(reader.simulateContract).not.toHaveBeenCalled();
  });
});

describe("vault funding inspection", () => {
  it("detects unassigned transfers using A+R backing, excluding external escrow money", async () => {
    const { client } = fixture();
    expect(await client.inspectVaultFunding()).toMatchObject({
      physicalBalance: 75n, recordedBacking: 70n, unassignedBalance: 5n, backingShortfall: 0n, observedBlock: 123n,
    });
    expect(ledger.available).toBe(60n);
  });

  it("reports a backing shortfall instead of negative unassigned funds", async () => {
    const { client } = fixture({ readContract: async ({ functionName }) => functionName === "ledger" ? ledger : functionName === "decimals" ? 6 : functionName === "token" ? "0x3600000000000000000000000000000000000000" : 65n });
    expect(await client.inspectVaultFunding()).toMatchObject({ unassignedBalance: 0n, backingShortfall: 5n });
  });

  it("fails closed if token decimals or ledger evidence is invalid", async () => {
    const { client } = fixture({ readContract: async ({ functionName }) => functionName === "ledger" ? ledger : functionName === "decimals" ? 18 : 75n });
    await expect(client.inspectVaultFunding()).rejects.toThrow("6 decimals");
    const invalid = fixture({ readContract: async ({ functionName }) => functionName === "ledger" ? { ...ledger, available: 61n } : functionName === "decimals" ? 6 : functionName === "token" ? "0x3600000000000000000000000000000000000000" : 75n });
    await expect(invalid.client.inspectVaultFunding()).rejects.toThrow("conservation");
  });

  it("rejects token binding mismatch and an unpinned funding snapshot", async () => {
    const mismatched = fixture({ readContract: async ({ functionName }) => functionName === "ledger" ? ledger : functionName === "decimals" ? 6 : functionName === "token" ? escrow : 75n });
    await expect(mismatched.client.inspectVaultFunding()).rejects.toThrow("token binding");
    const unpinned = fixture({ getBlockNumber: undefined });
    await expect(unpinned.client.inspectVaultFunding()).rejects.toThrow("block number");
  });
});
