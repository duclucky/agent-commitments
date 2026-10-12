import { afterEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { buildServer } from "./server.js";
import { InMemoryApiStore } from "./store.js";

const alice = privateKeyToAccount("0x59c6995e998f97a5a0044976f0945389dc9e86dae88c7a8412f4603b6b78690d");
const bob = privateKeyToAccount("0x8b3a350cf5c34c9194ca3a545d3b54d3f6f0196913d8b48c83f96f8a702c71e8");
const servers: ReturnType<typeof buildServer>[] = [];

async function sessionFor(account: typeof alice) {
  const server = servers.at(-1)!;
  const challengeResponse = await server.inject({ method: "POST", url: "/v1/auth/challenges", payload: { address: account.address } });
  const challenge = challengeResponse.json<{ message: string }>();
  const signature = await account.signMessage({ message: challenge.message });
  return server.inject({ method: "POST", url: "/v1/auth/sessions", payload: { address: account.address, signature } });
}

afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });

describe("wallet challenge authentication", () => {
  it("consumes each challenge exactly once", async () => {
    const server = buildServer({ now: () => 1_000 }); servers.push(server);
    const challengeResponse = await server.inject({ method: "POST", url: "/v1/auth/challenges", payload: { address: alice.address } });
    const challenge = challengeResponse.json<{ message: string }>();
    const signature = await alice.signMessage({ message: challenge.message });
    const first = await server.inject({ method: "POST", url: "/v1/auth/sessions", payload: { address: alice.address, signature } });
    const replay = await server.inject({ method: "POST", url: "/v1/auth/sessions", payload: { address: alice.address, signature } });
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(401);
  });

  it("does not let an invalid signature consume another wallet's challenge", async () => {
    const server = buildServer({ now: () => 1_000 }); servers.push(server);
    const challengeResponse = await server.inject({ method: "POST", url: "/v1/auth/challenges", payload: { address: alice.address } });
    const challenge = challengeResponse.json<{ message: string }>();
    const invalidSignature = await bob.signMessage({ message: challenge.message });
    const validSignature = await alice.signMessage({ message: challenge.message });
    const invalid = await server.inject({ method: "POST", url: "/v1/auth/sessions", payload: { address: alice.address, signature: invalidSignature } });
    const valid = await server.inject({ method: "POST", url: "/v1/auth/sessions", payload: { address: alice.address, signature: validSignature } });
    expect(invalid.statusCode).toBe(401);
    expect(valid.statusCode).toBe(201);
  });

  it("keeps sessions and idempotency records across API restarts when the store is shared", async () => {
    const store = new InMemoryApiStore();
    const firstServer = buildServer({ store }); servers.push(firstServer);
    const token = await sessionFor(alice).then((response) => response.json<{ token: string }>().token);
    const created = await firstServer.inject({
      method: "POST", url: "/v1/operations",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": "restart-safe" },
      payload: { action: "dispatch", amount: "0" },
    });
    await firstServer.close();
    servers.splice(servers.indexOf(firstServer), 1);

    const restarted = buildServer({ store }); servers.push(restarted);
    const duplicate = await restarted.inject({
      method: "POST", url: "/v1/operations",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": "restart-safe" },
      payload: { amount: "0", action: "dispatch" },
    });
    expect(created.statusCode).toBe(201);
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual(created.json());
  });
});

describe("tenant scoped operations", () => {
  it("isolates reads and enforces idempotency payload equality", async () => {
    const server = buildServer(); servers.push(server);
    const aliceToken = sessionFor(alice).then((response) => response.json<{ token: string }>().token);
    const bobToken = sessionFor(bob).then((response) => response.json<{ token: string }>().token);
    const created = await server.inject({ method: "POST", url: "/v1/operations", headers: { authorization: `Bearer ${await aliceToken}`, "idempotency-key": "invoice-7" }, payload: { amount: "12500000", action: "reserve" } });
    const duplicate = await server.inject({ method: "POST", url: "/v1/operations", headers: { authorization: `Bearer ${await aliceToken}`, "idempotency-key": "invoice-7" }, payload: { action: "reserve", amount: "12500000" } });
    const conflict = await server.inject({ method: "POST", url: "/v1/operations", headers: { authorization: `Bearer ${await aliceToken}`, "idempotency-key": "invoice-7" }, payload: { amount: "13000000", action: "reserve" } });
    const bobList = await server.inject({ method: "GET", url: "/v1/operations", headers: { authorization: `Bearer ${await bobToken}` } });
    expect(created.statusCode).toBe(201);
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual(created.json());
    expect(conflict.statusCode).toBe(409);
    expect(bobList.json()).toEqual({ operations: [] });
  });
});
