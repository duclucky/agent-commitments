import { describe, expect, it } from "vitest";
import { InMemoryOperationStore, OutboxRuntime, PayloadConflictError, type ReceiptReader, type TransactionBroadcaster } from "./outbox.js";

const rawTransaction = "0x02aabb" as const;

describe("durable outbox failure boundaries", () => {
  it("lets only one of two workers broadcast the operation", async () => {
    const store = new InMemoryOperationStore();
    let broadcasts = 0;
    const broadcaster: TransactionBroadcaster = { broadcast: async (_raw, expectedHash) => { broadcasts += 1; return expectedHash; } };
    const receipts: ReceiptReader = { getReceipt: async () => undefined };
    const runtime = new OutboxRuntime(store, broadcaster, receipts);
    await runtime.enqueue("tenant-a", "operation-1", { amount: "1000000" }, rawTransaction);

    await Promise.all([runtime.processNext("worker-a", 1_000), runtime.processNext("worker-b", 1_000)]);

    expect(broadcasts).toBe(1);
    expect((await store.byId("tenant-a:operation-1"))?.status).toBe("BROADCAST");
  });

  it("rejects reuse of an idempotency key with a different payload", async () => {
    const store = new InMemoryOperationStore();
    const runtime = new OutboxRuntime(store, { broadcast: async (_raw, hash) => hash }, { getReceipt: async () => undefined });
    await runtime.enqueue("tenant-a", "same-key", { amount: "1" }, rawTransaction);
    await expect(runtime.enqueue("tenant-a", "same-key", { amount: "2" }, rawTransaction)).rejects.toBeInstanceOf(PayloadConflictError);
  });

  it("marks an ambiguous broadcast UNKNOWN and never sends it again", async () => {
    const store = new InMemoryOperationStore();
    let broadcasts = 0;
    let confirmed = false;
    const runtime = new OutboxRuntime(
      store,
      { broadcast: async () => { broadcasts += 1; throw new Error("connection reset after write"); } },
      { getReceipt: async () => confirmed ? { status: "success" } : undefined },
    );
    const operation = await runtime.enqueue("tenant-a", "ambiguous", { amount: "3" }, rawTransaction);
    await runtime.processNext("worker-a", 1_000);
    expect((await store.byId(operation.id))?.status).toBe("UNKNOWN");

    await runtime.processNext("worker-b", 10_000);
    expect(broadcasts).toBe(1);
    confirmed = true;
    await runtime.reconcile(operation.id);
    expect((await store.byId(operation.id))?.status).toBe("CONFIRMED");
  });

  it("recovers a worker crash after send began by checking the deterministic hash", async () => {
    const store = new InMemoryOperationStore();
    let broadcasts = 0;
    const runtime = new OutboxRuntime(
      store,
      { broadcast: async (_raw, hash) => { broadcasts += 1; return hash; } },
      { getReceipt: async () => ({ status: "success" }) },
      { leaseMs: 100 },
    );
    const operation = await runtime.enqueue("tenant-a", "crash", { amount: "4" }, rawTransaction);
    const claimed = await store.claim("dead-worker", 1_000, 100);
    expect(claimed?.id).toBe(operation.id);
    await store.markSending(operation.id, "dead-worker", 1_001);

    await runtime.processNext("recovery-worker", 1_101);
    expect(broadcasts).toBe(0);
    expect((await store.byId(operation.id))?.status).toBe("CONFIRMED");
  });

  it("leases receipt reconciliation so two workers do not poll the same transaction", async () => {
    const store = new InMemoryOperationStore();
    let receiptReads = 0;
    const runtime = new OutboxRuntime(
      store,
      { broadcast: async (_raw, hash) => hash },
      { getReceipt: async () => { receiptReads += 1; return { status: "success" }; } },
    );
    const operation = await runtime.enqueue("tenant-a", "reconcile-once", { amount: "5" }, rawTransaction);
    await runtime.processNext("sender", 1_000);
    await Promise.all([
      runtime.reconcileNext("reconciler-a", 2_000),
      runtime.reconcileNext("reconciler-b", 2_000),
    ]);
    expect(receiptReads).toBe(1);
    expect((await store.byId(operation.id))?.status).toBe("CONFIRMED");
  });

  it("backs off unresolved receipt polling without broadcasting again", async () => {
    const store = new InMemoryOperationStore();
    let broadcasts = 0;
    let receiptReads = 0;
    const runtime = new OutboxRuntime(
      store,
      { broadcast: async (_raw, hash) => { broadcasts += 1; return hash; } },
      { getReceipt: async () => { receiptReads += 1; return undefined; } },
      { reconciliationBackoffMs: 5_000 },
    );
    await runtime.enqueue("tenant-a", "backoff", { amount: "6" }, rawTransaction);
    await runtime.processNext("sender", 1_000);
    await runtime.reconcileNext("reconciler-a", 2_000);
    await runtime.reconcileNext("reconciler-b", 2_001);
    expect(receiptReads).toBe(1);
    expect(broadcasts).toBe(1);
    await runtime.reconcileNext("reconciler-c", 7_000);
    expect(receiptReads).toBe(2);
  });
});
