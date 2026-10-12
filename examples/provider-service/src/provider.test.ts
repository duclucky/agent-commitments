import { afterEach, describe, expect, it } from "vitest";
import { keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildProviderServer } from "./provider.js";

const account = privateKeyToAccount("0x59c6995e998f97a5a0044976f0945389dc9e86dae88c7a8412f4603b6b78690d");
const servers: ReturnType<typeof buildProviderServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });

describe("provider reference service", () => {
  it("signs a fully bound quote and accepts one idempotent job", async () => {
    const server = buildProviderServer({ signer: account, nowSeconds: () => 1_700_000_000n }); servers.push(server);
    const base = {
      chainId: 5_042_002, vault: "0x1000000000000000000000000000000000000001",
      grantId: keccak256(stringToHex("grant")), operationId: keccak256(stringToHex("op")),
      evaluator: "0x3000000000000000000000000000000000000003", amount: "2500000",
      token: "0x3600000000000000000000000000000000000000",
      adapter: "0x2000000000000000000000000000000000000002",
      workHash: keccak256(stringToHex("document-schema-v1")),
    };
    const quote = await server.inject({ method: "POST", url: "/v1/quotes", payload: base });
    expect(quote.statusCode).toBe(201);
    expect(quote.json<{ quote: { provider: string } }>().quote.provider).toBe(account.address);

    const job = { operationId: base.operationId, commitmentId: keccak256(stringToHex("commitment")), workHash: base.workHash };
    const first = await server.inject({ method: "POST", url: "/v1/jobs", headers: { "idempotency-key": "op-7" }, payload: job });
    const duplicate = await server.inject({ method: "POST", url: "/v1/jobs", headers: { "idempotency-key": "op-7" }, payload: job });
    const conflict = await server.inject({ method: "POST", url: "/v1/jobs", headers: { "idempotency-key": "op-7" }, payload: { ...job, workHash: keccak256(stringToHex("changed")) } });
    expect(first.statusCode).toBe(202);
    expect(duplicate.json()).toEqual(first.json());
    expect(conflict.statusCode).toBe(409);
  });
});
