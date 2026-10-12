import { keccak256, type Hex } from "viem";

export type OperationStatus = "QUEUED" | "SENDING" | "BROADCAST" | "UNKNOWN" | "CONFIRMED" | "REVERTED";

export interface DurableOperation {
  readonly id: string;
  readonly scope: string;
  readonly idempotencyKey: string;
  readonly payloadFingerprint: string;
  readonly rawTransaction: Hex;
  readonly expectedHash: Hex;
  status: OperationStatus;
  txHash?: Hex;
  leaseOwner?: string;
  leaseExpiresAt?: number;
  lastError?: string;
}

export interface TransactionBroadcaster {
  broadcast(rawTransaction: Hex, expectedHash: Hex): Promise<Hex>;
}

export interface ReceiptReader {
  getReceipt(hash: Hex): Promise<{ status: "success" | "reverted" } | undefined>;
}

export class PayloadConflictError extends Error {
  constructor() { super("Idempotency key was reused with a different payload"); }
}

export interface OperationStore {
  put(operation: DurableOperation): Promise<DurableOperation>;
  byId(id: string): Promise<DurableOperation | undefined>;
  claim(workerId: string, now: number, leaseMs: number): Promise<DurableOperation | undefined>;
  claimReconciliation(workerId: string, now: number, leaseMs: number): Promise<DurableOperation | undefined>;
  markSending(id: string, workerId: string, now: number): Promise<void>;
  markBroadcast(id: string, workerId: string, hash: Hex): Promise<void>;
  markUnknown(id: string, workerId: string, message: string): Promise<void>;
  markReceipt(id: string, receipt: { status: "success" | "reverted" }): Promise<void>;
  deferReconciliation(id: string, workerId: string, nextAttemptAt: number, message?: string): Promise<void>;
}

export class InMemoryOperationStore implements OperationStore {
  private readonly records = new Map<string, DurableOperation>();

  async put(operation: DurableOperation): Promise<DurableOperation> {
    const existing = this.records.get(operation.id);
    if (existing) {
      if (existing.payloadFingerprint !== operation.payloadFingerprint || existing.rawTransaction !== operation.rawTransaction) {
        throw new PayloadConflictError();
      }
      return structuredClone(existing);
    }
    this.records.set(operation.id, structuredClone(operation));
    return structuredClone(operation);
  }

  async byId(id: string): Promise<DurableOperation | undefined> {
    const operation = this.records.get(id);
    return operation ? structuredClone(operation) : undefined;
  }

  async claim(workerId: string, now: number, leaseMs: number): Promise<DurableOperation | undefined> {
    for (const operation of this.records.values()) {
      const reclaimableSend = operation.status === "SENDING" && (operation.leaseExpiresAt ?? 0) <= now;
      const claimableQueue = operation.status === "QUEUED" && (operation.leaseExpiresAt === undefined || operation.leaseExpiresAt <= now);
      if (!claimableQueue && !reclaimableSend) continue;
      operation.leaseOwner = workerId;
      operation.leaseExpiresAt = now + leaseMs;
      return structuredClone(operation);
    }
    return undefined;
  }

  async claimReconciliation(workerId: string, now: number, leaseMs: number): Promise<DurableOperation | undefined> {
    for (const operation of this.records.values()) {
      if (operation.status !== "BROADCAST" && operation.status !== "UNKNOWN") continue;
      if ((operation.leaseExpiresAt ?? 0) > now) continue;
      operation.leaseOwner = workerId;
      operation.leaseExpiresAt = now + leaseMs;
      return structuredClone(operation);
    }
    return undefined;
  }

  async markSending(id: string, workerId: string, now: number): Promise<void> {
    const operation = this.required(id);
    if (operation.leaseOwner !== workerId || (operation.leaseExpiresAt ?? 0) < now) throw new Error("Operation lease lost");
    operation.status = "SENDING";
  }

  async markBroadcast(id: string, workerId: string, hash: Hex): Promise<void> {
    const operation = this.owned(id, workerId);
    if (hash !== operation.expectedHash) throw new Error("Broadcaster returned an unexpected transaction hash");
    operation.status = "BROADCAST";
    operation.txHash = hash;
    this.release(operation);
  }

  async markUnknown(id: string, workerId: string, message: string): Promise<void> {
    const operation = this.owned(id, workerId);
    operation.status = "UNKNOWN";
    operation.txHash = operation.expectedHash;
    operation.lastError = message;
    this.release(operation);
  }

  async markReceipt(id: string, receipt: { status: "success" | "reverted" }): Promise<void> {
    const operation = this.required(id);
    operation.status = receipt.status === "success" ? "CONFIRMED" : "REVERTED";
    operation.txHash = operation.expectedHash;
    this.release(operation);
  }

  async deferReconciliation(id: string, workerId: string, nextAttemptAt: number, message?: string): Promise<void> {
    const operation = this.owned(id, workerId);
    delete operation.leaseOwner;
    operation.leaseExpiresAt = nextAttemptAt;
    if (message) operation.lastError = message;
  }

  private required(id: string): DurableOperation {
    const operation = this.records.get(id);
    if (!operation) throw new Error(`Unknown operation ${id}`);
    return operation;
  }

  private owned(id: string, workerId: string): DurableOperation {
    const operation = this.required(id);
    if (operation.leaseOwner !== workerId) throw new Error("Operation lease lost");
    return operation;
  }

  private release(operation: DurableOperation): void {
    delete operation.leaseOwner;
    delete operation.leaseExpiresAt;
  }
}

export class OutboxRuntime {
  private readonly leaseMs: number;
  private readonly reconciliationBackoffMs: number;

  constructor(
    private readonly store: OperationStore,
    private readonly broadcaster: TransactionBroadcaster,
    private readonly receipts: ReceiptReader,
    options: { leaseMs?: number; reconciliationBackoffMs?: number } = {},
  ) {
    this.leaseMs = options.leaseMs ?? 30_000;
    this.reconciliationBackoffMs = options.reconciliationBackoffMs ?? 5_000;
  }

  async enqueue(scope: string, idempotencyKey: string, payload: unknown, rawTransaction: Hex): Promise<DurableOperation> {
    if (!scope || !idempotencyKey) throw new Error("Scope and idempotency key are required");
    const operation: DurableOperation = {
      id: `${scope}:${idempotencyKey}`,
      scope,
      idempotencyKey,
      payloadFingerprint: keccak256(new TextEncoder().encode(canonicalJson(payload))),
      rawTransaction,
      expectedHash: keccak256(rawTransaction),
      status: "QUEUED",
    };
    return this.store.put(operation);
  }

  async processNext(workerId: string, now = Date.now()): Promise<DurableOperation | undefined> {
    const operation = await this.store.claim(workerId, now, this.leaseMs);
    if (!operation) return undefined;

    if (operation.status === "SENDING") {
      const receipt = await this.receipts.getReceipt(operation.expectedHash);
      if (receipt) await this.store.markReceipt(operation.id, receipt);
      else await this.store.markUnknown(operation.id, workerId, "Worker lease expired after broadcast may have started");
      return this.store.byId(operation.id);
    }

    await this.store.markSending(operation.id, workerId, now);
    try {
      const hash = await this.broadcaster.broadcast(operation.rawTransaction, operation.expectedHash);
      await this.store.markBroadcast(operation.id, workerId, hash);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown broadcast error";
      await this.store.markUnknown(operation.id, workerId, message);
    }
    return this.store.byId(operation.id);
  }

  async reconcile(id: string): Promise<DurableOperation> {
    const operation = await this.store.byId(id);
    if (!operation) throw new Error(`Unknown operation ${id}`);
    if (operation.status === "CONFIRMED" || operation.status === "REVERTED") return operation;
    const receipt = await this.receipts.getReceipt(operation.expectedHash);
    if (receipt) await this.store.markReceipt(id, receipt);
    return (await this.store.byId(id))!;
  }

  async reconcileNext(workerId: string, now = Date.now()): Promise<DurableOperation | undefined> {
    const operation = await this.store.claimReconciliation(workerId, now, this.leaseMs);
    if (!operation) return undefined;
    try {
      const receipt = await this.receipts.getReceipt(operation.expectedHash);
      if (receipt) await this.store.markReceipt(operation.id, receipt);
      else await this.store.deferReconciliation(operation.id, workerId, now + this.reconciliationBackoffMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Receipt lookup failed";
      await this.store.deferReconciliation(operation.id, workerId, now + this.reconciliationBackoffMs, message);
    }
    return this.store.byId(operation.id);
  }
}

function canonicalJson(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}
