import type { Pool } from "pg";
import type { Address, Hex } from "viem";

export interface AuthChallenge {
  readonly message: string;
  readonly expiresAt: number;
}

export interface Session {
  readonly tenantId: string;
  readonly address: Address;
  readonly expiresAt: number;
}

export interface ApiOperation {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly payload: { readonly action: string; readonly amount: string };
  readonly status: "PREPARED";
}

export class ApiPayloadConflictError extends Error {
  constructor() { super("Idempotency key was reused with a different payload"); }
}

export interface ApiStore {
  readonly kind: "memory" | "postgres";
  putChallenge(address: string, challenge: AuthChallenge): Promise<void>;
  getChallenge(address: string, now: number): Promise<AuthChallenge | undefined>;
  consumeChallenge(address: string, message: string, now: number): Promise<boolean>;
  putSession(tokenHash: Hex, session: Session): Promise<void>;
  getSession(tokenHash: Hex, now: number): Promise<Session | undefined>;
  putOperation(
    tenantId: string,
    idempotencyKey: string,
    fingerprint: Hex,
    operation: ApiOperation,
  ): Promise<{ readonly operation: ApiOperation; readonly created: boolean }>;
  listOperations(tenantId: string): Promise<readonly ApiOperation[]>;
}

export class InMemoryApiStore implements ApiStore {
  readonly kind = "memory" as const;
  private readonly challenges = new Map<string, AuthChallenge>();
  private readonly sessions = new Map<Hex, Session>();
  private readonly operations = new Map<string, Map<string, { fingerprint: Hex; operation: ApiOperation }>>();

  async putChallenge(address: string, challenge: AuthChallenge): Promise<void> {
    this.challenges.set(address, challenge);
  }

  async getChallenge(address: string, now: number): Promise<AuthChallenge | undefined> {
    const challenge = this.challenges.get(address);
    if (challenge && challenge.expiresAt >= now) return challenge;
    this.challenges.delete(address);
    return undefined;
  }

  async consumeChallenge(address: string, message: string, now: number): Promise<boolean> {
    const challenge = this.challenges.get(address);
    if (!challenge || challenge.message !== message || challenge.expiresAt < now) return false;
    this.challenges.delete(address);
    return true;
  }

  async putSession(tokenHash: Hex, session: Session): Promise<void> {
    this.sessions.set(tokenHash, session);
  }

  async getSession(tokenHash: Hex, now: number): Promise<Session | undefined> {
    const session = this.sessions.get(tokenHash);
    if (session && session.expiresAt >= now) return session;
    this.sessions.delete(tokenHash);
    return undefined;
  }

  async putOperation(
    tenantId: string,
    idempotencyKey: string,
    fingerprint: Hex,
    operation: ApiOperation,
  ): Promise<{ operation: ApiOperation; created: boolean }> {
    let tenantOperations = this.operations.get(tenantId);
    if (!tenantOperations) {
      tenantOperations = new Map();
      this.operations.set(tenantId, tenantOperations);
    }
    const existing = tenantOperations.get(idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new ApiPayloadConflictError();
      return { operation: existing.operation, created: false };
    }
    tenantOperations.set(idempotencyKey, { fingerprint, operation });
    return { operation, created: true };
  }

  async listOperations(tenantId: string): Promise<readonly ApiOperation[]> {
    return [...(this.operations.get(tenantId)?.values() ?? [])].map(({ operation }) => operation);
  }
}

interface ChallengeRow { message: string; expires_at: Date }
interface SessionRow { tenant_id: string; address: Address; expires_at: Date }
interface OperationRow {
  id: string;
  idempotency_key: string;
  payload_fingerprint: Buffer;
  payload: ApiOperation["payload"];
  status: ApiOperation["status"];
}

export class PostgresApiStore implements ApiStore {
  readonly kind = "postgres" as const;
  constructor(private readonly pool: Pool) {}

  async putChallenge(address: string, challenge: AuthChallenge): Promise<void> {
    await this.pool.query(
      `INSERT INTO auth_challenges(address, message, expires_at)
       VALUES ($1,$2,$3)
       ON CONFLICT (address) DO UPDATE SET message=EXCLUDED.message, expires_at=EXCLUDED.expires_at, created_at=now()`,
      [address, challenge.message, new Date(challenge.expiresAt)],
    );
  }

  async getChallenge(address: string, now: number): Promise<AuthChallenge | undefined> {
    const result = await this.pool.query<ChallengeRow>(
      "SELECT message, expires_at FROM auth_challenges WHERE address=$1 AND expires_at >= $2",
      [address, new Date(now)],
    );
    const row = result.rows[0];
    return row ? { message: row.message, expiresAt: row.expires_at.getTime() } : undefined;
  }

  async consumeChallenge(address: string, message: string, now: number): Promise<boolean> {
    const result = await this.pool.query<ChallengeRow>(
      "DELETE FROM auth_challenges WHERE address=$1 AND message=$2 AND expires_at >= $3 RETURNING message, expires_at",
      [address, message, new Date(now)],
    );
    return result.rowCount === 1;
  }

  async putSession(tokenHash: Hex, session: Session): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO tenants(id) VALUES ($1) ON CONFLICT DO NOTHING", [session.tenantId]);
      await client.query(
        `INSERT INTO auth_sessions(token_hash, tenant_id, address, expires_at)
         VALUES ($1,$2,$3,$4)`,
        [bytes(tokenHash), session.tenantId, session.address, new Date(session.expiresAt)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async getSession(tokenHash: Hex, now: number): Promise<Session | undefined> {
    await this.pool.query("DELETE FROM auth_sessions WHERE expires_at < $1", [new Date(now)]);
    const result = await this.pool.query<SessionRow>(
      "SELECT tenant_id, address, expires_at FROM auth_sessions WHERE token_hash=$1 AND expires_at >= $2",
      [bytes(tokenHash), new Date(now)],
    );
    const row = result.rows[0];
    return row ? { tenantId: row.tenant_id, address: row.address, expiresAt: row.expires_at.getTime() } : undefined;
  }

  async putOperation(
    tenantId: string,
    idempotencyKey: string,
    fingerprint: Hex,
    operation: ApiOperation,
  ): Promise<{ operation: ApiOperation; created: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO tenants(id) VALUES ($1) ON CONFLICT DO NOTHING", [tenantId]);
      const inserted = await client.query<OperationRow>(
        `INSERT INTO api_operations(id, tenant_id, idempotency_key, payload_fingerprint, payload, status)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
         RETURNING id, idempotency_key, payload_fingerprint, payload, status`,
        [operation.id, tenantId, idempotencyKey, bytes(fingerprint), operation.payload, operation.status],
      );
      const row = inserted.rows[0] ?? (await client.query<OperationRow>(
        `SELECT id, idempotency_key, payload_fingerprint, payload, status
         FROM api_operations WHERE tenant_id=$1 AND idempotency_key=$2`,
        [tenantId, idempotencyKey],
      )).rows[0];
      if (!row) throw new Error("Operation insert did not return a row");
      if (hex(row.payload_fingerprint) !== fingerprint) throw new ApiPayloadConflictError();
      await client.query("COMMIT");
      return { operation: operationFromRow(row), created: Boolean(inserted.rows[0]) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async listOperations(tenantId: string): Promise<readonly ApiOperation[]> {
    const result = await this.pool.query<OperationRow>(
      `SELECT id, idempotency_key, payload_fingerprint, payload, status
       FROM api_operations WHERE tenant_id=$1 ORDER BY created_at, id`,
      [tenantId],
    );
    return result.rows.map(operationFromRow);
  }
}

function operationFromRow(row: OperationRow): ApiOperation {
  return { id: row.id, idempotencyKey: row.idempotency_key, payload: row.payload, status: row.status };
}

function bytes(value: string): Buffer { return Buffer.from(value.slice(2), "hex"); }
function hex(value: Buffer): Hex { return `0x${value.toString("hex")}`; }
