import type { Pool } from "pg";
import type { Hex } from "viem";
import { PayloadConflictError, type DurableOperation, type OperationStore } from "./outbox.js";

interface OperationRow {
  id: string; tenant_id: string; idempotency_key: string; payload_fingerprint: Buffer;
  raw_transaction: Buffer; expected_hash: Buffer; tx_hash: Buffer | null; status: DurableOperation["status"];
  lease_owner: string | null; lease_expires_at: Date | null; last_error: string | null;
}

export class PostgresOperationStore implements OperationStore {
  constructor(private readonly pool: Pool) {}

  async put(operation: DurableOperation): Promise<DurableOperation> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO tenants(id) VALUES ($1) ON CONFLICT DO NOTHING", [operation.scope]);
      const inserted = await client.query<OperationRow>(
        `INSERT INTO transaction_attempts
          (id, tenant_id, idempotency_key, payload_fingerprint, raw_transaction, expected_hash, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING *`,
        [operation.id, operation.scope, operation.idempotencyKey, bytes(operation.payloadFingerprint), bytes(operation.rawTransaction), bytes(operation.expectedHash), operation.status],
      );
      const row = inserted.rows[0] ?? (await client.query<OperationRow>("SELECT * FROM transaction_attempts WHERE tenant_id=$1 AND idempotency_key=$2", [operation.scope, operation.idempotencyKey])).rows[0];
      if (!row) throw new Error("Operation insert did not return a row");
      const existing = fromRow(row);
      if (existing.payloadFingerprint !== operation.payloadFingerprint || existing.rawTransaction !== operation.rawTransaction) throw new PayloadConflictError();
      await client.query("COMMIT");
      return existing;
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  async byId(id: string): Promise<DurableOperation | undefined> {
    const result = await this.pool.query<OperationRow>("SELECT * FROM transaction_attempts WHERE id=$1", [id]);
    return result.rows[0] ? fromRow(result.rows[0]) : undefined;
  }

  async claim(workerId: string, now: number, leaseMs: number): Promise<DurableOperation | undefined> {
    const result = await this.pool.query<OperationRow>(
      `WITH candidate AS (
         SELECT id FROM transaction_attempts
         WHERE (status='QUEUED' AND (lease_expires_at IS NULL OR lease_expires_at <= $1))
            OR (status='SENDING' AND lease_expires_at <= $1)
         ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       UPDATE transaction_attempts AS operation
       SET lease_owner=$2, lease_expires_at=$3, updated_at=now()
       FROM candidate WHERE operation.id=candidate.id RETURNING operation.*`,
      [new Date(now), workerId, new Date(now + leaseMs)],
    );
    return result.rows[0] ? fromRow(result.rows[0]) : undefined;
  }

  async claimReconciliation(workerId: string, now: number, leaseMs: number): Promise<DurableOperation | undefined> {
    const result = await this.pool.query<OperationRow>(
      `WITH candidate AS (
         SELECT id FROM transaction_attempts
         WHERE status IN ('BROADCAST','UNKNOWN')
           AND (lease_expires_at IS NULL OR lease_expires_at <= $1)
         ORDER BY updated_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       UPDATE transaction_attempts AS operation
       SET lease_owner=$2, lease_expires_at=$3, updated_at=now()
       FROM candidate WHERE operation.id=candidate.id RETURNING operation.*`,
      [new Date(now), workerId, new Date(now + leaseMs)],
    );
    return result.rows[0] ? fromRow(result.rows[0]) : undefined;
  }

  async markSending(id: string, workerId: string, now: number): Promise<void> {
    await this.ownedUpdate("UPDATE transaction_attempts SET status='SENDING', updated_at=now() WHERE id=$1 AND lease_owner=$2 AND lease_expires_at >= $3", [id, workerId, new Date(now)]);
  }

  async markBroadcast(id: string, workerId: string, hash: Hex): Promise<void> {
    const operation = await this.byId(id);
    if (!operation || operation.expectedHash !== hash) throw new Error("Broadcaster returned an unexpected transaction hash");
    await this.ownedUpdate("UPDATE transaction_attempts SET status='BROADCAST', tx_hash=$3, lease_owner=NULL, lease_expires_at=NULL, updated_at=now() WHERE id=$1 AND lease_owner=$2", [id, workerId, bytes(hash)]);
  }

  async markUnknown(id: string, workerId: string, message: string): Promise<void> {
    await this.ownedUpdate("UPDATE transaction_attempts SET status='UNKNOWN', tx_hash=expected_hash, last_error=$3, lease_owner=NULL, lease_expires_at=NULL, updated_at=now() WHERE id=$1 AND lease_owner=$2", [id, workerId, message]);
  }

  async markReceipt(id: string, receipt: { status: "success" | "reverted" }): Promise<void> {
    const status = receipt.status === "success" ? "CONFIRMED" : "REVERTED";
    const result = await this.pool.query("UPDATE transaction_attempts SET status=$2, tx_hash=expected_hash, lease_owner=NULL, lease_expires_at=NULL, updated_at=now() WHERE id=$1", [id, status]);
    if (result.rowCount !== 1) throw new Error("Unknown operation");
  }

  async deferReconciliation(id: string, workerId: string, nextAttemptAt: number, message?: string): Promise<void> {
    await this.ownedUpdate(
      `UPDATE transaction_attempts
       SET lease_owner=NULL, lease_expires_at=$3, last_error=COALESCE($4,last_error), updated_at=now()
       WHERE id=$1 AND lease_owner=$2`,
      [id, workerId, new Date(nextAttemptAt), message ?? null],
    );
  }

  private async ownedUpdate(sql: string, params: unknown[]): Promise<void> {
    const result = await this.pool.query(sql, params);
    if (result.rowCount !== 1) throw new Error("Operation lease lost");
  }
}

function bytes(hex: string): Buffer { return Buffer.from(hex.slice(2), "hex"); }
function hex(value: Buffer): Hex { return `0x${value.toString("hex")}`; }
function fromRow(row: OperationRow): DurableOperation {
  const value: DurableOperation = {
    id: row.id, scope: row.tenant_id, idempotencyKey: row.idempotency_key,
    payloadFingerprint: hex(row.payload_fingerprint), rawTransaction: hex(row.raw_transaction), expectedHash: hex(row.expected_hash),
    status: row.status,
  };
  if (row.tx_hash) value.txHash = hex(row.tx_hash);
  if (row.lease_owner) value.leaseOwner = row.lease_owner;
  if (row.lease_expires_at) value.leaseExpiresAt = row.lease_expires_at.getTime();
  if (row.last_error) value.lastError = row.last_error;
  return value;
}
