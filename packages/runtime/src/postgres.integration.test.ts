import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { OutboxRuntime, PayloadConflictError } from "./outbox.js";
import { PostgresOperationStore } from "./postgres.js";
import { ChainEventConflictError, PostgresProjectionStore } from "./postgres-projection.js";
import type { ChainEvent } from "./projection.js";

const connectionString = process.env.TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
let pool: Pool;

suite("Postgres outbox locking", () => {
  beforeAll(() => { pool = new Pool({ connectionString, max: 4 }); });
  afterAll(async () => { await pool.end(); });

  it("allows only one worker to claim and broadcast a durable operation", async () => {
    const store = new PostgresOperationStore(pool);
    let broadcasts = 0;
    const runtime = new OutboxRuntime(store, { broadcast: async (_raw, hash) => { broadcasts += 1; return hash; } }, { getReceipt: async () => undefined });
    await runtime.enqueue("tenant-db", "job-1", { amount: "9000000" }, "0x02abcd");
    await Promise.all([runtime.processNext("worker-db-a", 1_000), runtime.processNext("worker-db-b", 1_000)]);
    expect(broadcasts).toBe(1);
    expect((await store.byId("tenant-db:job-1"))?.status).toBe("BROADCAST");
  });

  it("survives restart after SENDING without broadcasting a second time", async () => {
    const firstStore = new PostgresOperationStore(pool);
    const firstRuntime = new OutboxRuntime(firstStore, { broadcast: async (_raw, hash) => hash }, { getReceipt: async () => undefined }, { leaseMs: 100 });
    const operation = await firstRuntime.enqueue("tenant-db", "restart-boundary", { amount: "7000000" }, "0x02cafe");
    const claimed = await firstStore.claim("dead-worker", 2_000, 100);
    expect(claimed?.id).toBe(operation.id);
    await firstStore.markSending(operation.id, "dead-worker", 2_001);

    let broadcasts = 0;
    const restartedStore = new PostgresOperationStore(pool);
    const restartedRuntime = new OutboxRuntime(
      restartedStore,
      { broadcast: async (_raw, hash) => { broadcasts += 1; return hash; } },
      { getReceipt: async (hash) => hash === operation.expectedHash ? { status: "success" } : undefined },
      { leaseMs: 100 },
    );
    await restartedRuntime.processNext("recovery-worker", 2_101);
    expect(broadcasts).toBe(0);
    expect((await restartedStore.byId(operation.id))?.status).toBe("CONFIRMED");
  });

  it("persists idempotency conflicts across runtime instances", async () => {
    const first = new OutboxRuntime(new PostgresOperationStore(pool), { broadcast: async (_raw, hash) => hash }, { getReceipt: async () => undefined });
    await first.enqueue("tenant-db", "persistent-key", { amount: "1" }, "0x0201");
    const restarted = new OutboxRuntime(new PostgresOperationStore(pool), { broadcast: async (_raw, hash) => hash }, { getReceipt: async () => undefined });
    await expect(restarted.enqueue("tenant-db", "persistent-key", { amount: "2" }, "0x0201")).rejects.toBeInstanceOf(PayloadConflictError);
  });

  it("allows only one worker to reconcile a broadcast transaction", async () => {
    await pool.query("TRUNCATE transaction_attempts CASCADE");
    const store = new PostgresOperationStore(pool);
    let reads = 0;
    const runtime = new OutboxRuntime(
      store,
      { broadcast: async (_raw, hash) => hash },
      { getReceipt: async () => { reads += 1; return { status: "success" }; } },
    );
    const operation = await runtime.enqueue("tenant-db", "receipt-lease", { amount: "8" }, "0x0208");
    await runtime.processNext("sender-db", 3_000);
    await Promise.all([
      runtime.reconcileNext("receipt-worker-a", 4_000),
      runtime.reconcileNext("receipt-worker-b", 4_000),
    ]);
    expect(reads).toBe(1);
    expect((await store.byId(operation.id))?.status).toBe("CONFIRMED");
  });
});

suite("Postgres chain projection", () => {
  beforeAll(() => { pool = new Pool({ connectionString, max: 4 }); });
  afterAll(async () => { await pool.end(); });

  it("persists canonical events and rebuilds the accounting projection after restart", async () => {
    const store = new PostgresProjectionStore(pool);
    const deposit: ChainEvent = { chainId: 31337, blockNumber: 1n, blockHash: "0xaa01", transactionIndex: 0, logIndex: 0, txHash: "0xbb01", kind: "DEPOSITED", amount: 100n };
    const reserve: ChainEvent = { chainId: 31337, blockNumber: 2n, blockHash: "0xaa02", transactionIndex: 0, logIndex: 0, txHash: "0xbb02", kind: "RESERVED", amount: 40n };
    await store.ingest([reserve, deposit, deposit]);
    await store.setCheckpoint({ chainId: 31337, blockNumber: 2n, blockHash: "0xaa02" });

    const restarted = new PostgresProjectionStore(pool);
    const projection = await restarted.rebuild(31337);
    expect(projection.snapshot()).toEqual({ deposited: 100n, available: 60n, reserved: 40n, inEscrow: 0n, settled: 0n, withdrawn: 0n });
    expect(await restarted.checkpoint(31337)).toEqual({ chainId: 31337, blockNumber: 2n, blockHash: "0xaa02" });
  });

  it("rolls back a replaced fork range before replaying canonical events", async () => {
    const store = new PostgresProjectionStore(pool);
    await store.replaceFromBlock(31337, 2n, [
      { chainId: 31337, blockNumber: 2n, blockHash: "0xcc02", transactionIndex: 0, logIndex: 0, txHash: "0xdd02", kind: "RESERVED", amount: 30n },
      { chainId: 31337, blockNumber: 3n, blockHash: "0xcc03", transactionIndex: 0, logIndex: 0, txHash: "0xdd03", kind: "CANCELLED", amount: 30n },
    ], { chainId: 31337, blockNumber: 3n, blockHash: "0xcc03" });
    const projection = await store.rebuild(31337);
    expect(projection.snapshot()).toEqual({ deposited: 100n, available: 100n, reserved: 0n, inEscrow: 0n, settled: 0n, withdrawn: 0n });
  });

  it("rejects duplicate event identities with conflicting canonical payload", async () => {
    const store = new PostgresProjectionStore(pool);
    await expect(store.ingest([
      { chainId: 31337, blockNumber: 1n, blockHash: "0xaa01", transactionIndex: 0, logIndex: 0, txHash: "0xbb01", kind: "DEPOSITED", amount: 99n },
    ])).rejects.toBeInstanceOf(ChainEventConflictError);
  });
});
