import type { Pool, PoolClient } from "pg";
import type { Hex } from "viem";
import { ChainProjection, type ChainEvent, type LedgerEventKind } from "./projection.js";

export interface IndexerCheckpoint {
  readonly chainId: number;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
}

interface EventRow {
  chain_id: string;
  block_number: string;
  block_hash: Buffer;
  transaction_index: number;
  tx_hash: Buffer;
  log_index: number;
  event_name: LedgerEventKind;
  decoded_payload: { amount: string };
}

interface CheckpointRow { chain_id: string; block_number: string; block_hash: Buffer }

export class ChainEventConflictError extends Error {
  constructor() { super("Chain event identity was reused with different canonical data"); }
}

export class PostgresProjectionStore {
  constructor(private readonly pool: Pool) {}

  async ingest(events: readonly ChainEvent[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const event of events) await insertEvent(client, event);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async load(chainId: number): Promise<readonly ChainEvent[]> {
    const result = await this.pool.query<EventRow>(
      `SELECT chain_id, block_number, block_hash, transaction_index, tx_hash, log_index, event_name, decoded_payload
       FROM chain_events WHERE chain_id=$1 ORDER BY block_number, transaction_index, log_index`,
      [chainId],
    );
    return result.rows.map(fromEventRow);
  }

  async rebuild(chainId: number): Promise<ChainProjection> {
    const projection = new ChainProjection();
    projection.rebuild(await this.load(chainId));
    return projection;
  }

  async setCheckpoint(checkpoint: IndexerCheckpoint): Promise<void> {
    await this.pool.query(
      `INSERT INTO indexer_checkpoints(chain_id, block_number, block_hash)
       VALUES ($1,$2,$3)
       ON CONFLICT (chain_id) DO UPDATE
       SET block_number=EXCLUDED.block_number, block_hash=EXCLUDED.block_hash, updated_at=now()`,
      [checkpoint.chainId, checkpoint.blockNumber.toString(), bytes(checkpoint.blockHash)],
    );
  }

  async checkpoint(chainId: number): Promise<IndexerCheckpoint | undefined> {
    const result = await this.pool.query<CheckpointRow>(
      "SELECT chain_id, block_number, block_hash FROM indexer_checkpoints WHERE chain_id=$1",
      [chainId],
    );
    const row = result.rows[0];
    return row ? { chainId: Number(row.chain_id), blockNumber: BigInt(row.block_number), blockHash: hex(row.block_hash) } : undefined;
  }

  async replaceFromBlock(
    chainId: number,
    fromBlock: bigint,
    replacement: readonly ChainEvent[],
    checkpoint: IndexerCheckpoint,
  ): Promise<void> {
    if (checkpoint.chainId !== chainId || checkpoint.blockNumber < fromBlock) throw new Error("Invalid replacement checkpoint");
    if (replacement.some((event) => event.chainId !== chainId || event.blockNumber < fromBlock)) {
      throw new Error("Replacement event lies outside the rollback range");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM chain_events WHERE chain_id=$1 AND block_number >= $2", [chainId, fromBlock.toString()]);
      for (const event of replacement) await insertEvent(client, event);
      await client.query(
        `INSERT INTO indexer_checkpoints(chain_id, block_number, block_hash)
         VALUES ($1,$2,$3)
         ON CONFLICT (chain_id) DO UPDATE
         SET block_number=EXCLUDED.block_number, block_hash=EXCLUDED.block_hash, updated_at=now()`,
        [chainId, checkpoint.blockNumber.toString(), bytes(checkpoint.blockHash)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}

async function insertEvent(client: PoolClient, event: ChainEvent): Promise<void> {
  const inserted = await client.query<EventRow>(
    `INSERT INTO chain_events(chain_id, block_number, block_hash, transaction_index, tx_hash, log_index, event_name, decoded_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING
     RETURNING chain_id, block_number, block_hash, transaction_index, tx_hash, log_index, event_name, decoded_payload`,
    [event.chainId, event.blockNumber.toString(), bytes(event.blockHash), event.transactionIndex, bytes(event.txHash), event.logIndex, event.kind, { amount: event.amount.toString() }],
  );
  if (inserted.rows[0]) return;
  const existing = (await client.query<EventRow>(
    `SELECT chain_id, block_number, block_hash, transaction_index, tx_hash, log_index, event_name, decoded_payload
     FROM chain_events WHERE chain_id=$1 AND tx_hash=$2 AND log_index=$3`,
    [event.chainId, bytes(event.txHash), event.logIndex],
  )).rows[0];
  if (!existing || !sameEvent(fromEventRow(existing), event)) throw new ChainEventConflictError();
}

function sameEvent(left: ChainEvent, right: ChainEvent): boolean {
  return left.chainId === right.chainId
    && left.blockNumber === right.blockNumber
    && left.blockHash === right.blockHash
    && left.transactionIndex === right.transactionIndex
    && left.txHash === right.txHash
    && left.logIndex === right.logIndex
    && left.kind === right.kind
    && left.amount === right.amount;
}

function fromEventRow(row: EventRow): ChainEvent {
  return {
    chainId: Number(row.chain_id),
    blockNumber: BigInt(row.block_number),
    blockHash: hex(row.block_hash),
    transactionIndex: row.transaction_index,
    txHash: hex(row.tx_hash),
    logIndex: row.log_index,
    kind: row.event_name,
    amount: BigInt(row.decoded_payload.amount),
  };
}

function bytes(value: Hex): Buffer { return Buffer.from(value.slice(2), "hex"); }
function hex(value: Buffer): Hex { return `0x${value.toString("hex")}`; }
