import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { privateKeyToAccount } from "viem/accounts";
import { buildServer } from "./server.js";
import { PostgresApiStore } from "./store.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const account = privateKeyToAccount("0x59c6995e998f97a5a0044976f0945389dc9e86dae88c7a8412f4603b6b78690d");
let pool: Pool;

suite("Postgres API state", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query("TRUNCATE api_operations, auth_sessions, auth_challenges, transaction_attempts, tenants CASCADE");
  });
  afterAll(async () => { await pool?.end(); });

  it("consumes challenges atomically and preserves sessions and operations across server instances", async () => {
    const first = buildServer({ store: new PostgresApiStore(pool) });
    const challengeResponse = await first.inject({ method: "POST", url: "/v1/auth/challenges", payload: { address: account.address } });
    const challenge = challengeResponse.json<{ message: string }>();
    const signature = await account.signMessage({ message: challenge.message });
    const [attemptA, attemptB] = await Promise.all([
      first.inject({ method: "POST", url: "/v1/auth/sessions", payload: { address: account.address, signature } }),
      first.inject({ method: "POST", url: "/v1/auth/sessions", payload: { address: account.address, signature } }),
    ]);
    expect([attemptA.statusCode, attemptB.statusCode].sort()).toEqual([201, 401]);
    const successful = attemptA.statusCode === 201 ? attemptA : attemptB;
    const token = successful.json<{ token: string }>().token;
    const created = await first.inject({
      method: "POST", url: "/v1/operations",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": "persistent-op" },
      payload: { action: "reserve", amount: "42" },
    });
    await first.close();

    const restarted = buildServer({ store: new PostgresApiStore(pool) });
    const listed = await restarted.inject({ method: "GET", url: "/v1/operations", headers: { authorization: `Bearer ${token}` } });
    const duplicate = await restarted.inject({
      method: "POST", url: "/v1/operations",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": "persistent-op" },
      payload: { amount: "42", action: "reserve" },
    });
    expect(created.statusCode).toBe(201);
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ operations: unknown[] }>().operations).toHaveLength(1);
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual(created.json());
    await restarted.close();
  });
});
