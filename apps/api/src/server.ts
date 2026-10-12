import { createHash, randomBytes, randomUUID } from "node:crypto";
import Fastify, { type FastifyRequest } from "fastify";
import { getAddress, isAddress, keccak256, stringToHex, verifyMessage, type Hex } from "viem";
import { z } from "zod";
import { ApiPayloadConflictError, InMemoryApiStore, type ApiStore, type Session } from "./store.js";
export { InMemoryApiStore, PostgresApiStore, type ApiStore } from "./store.js";

export interface ServerOptions {
  readonly now?: () => number;
  readonly chainId?: number;
  readonly audience?: string;
  readonly store?: ApiStore;
}

const authBody = z.object({ address: z.string(), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) });
const addressBody = z.object({ address: z.string() });
const operationBody = z.object({
  action: z.enum(["reserve", "dispatch", "set-budget", "fund", "reconcile"]),
  amount: z.string().regex(/^(0|[1-9][0-9]*)$/),
});

export function buildServer(options: ServerOptions = {}) {
  const now = options.now ?? Date.now;
  const chainId = options.chainId ?? 5_042;
  const audience = options.audience ?? "agent-commitments.local";
  const store = options.store ?? new InMemoryApiStore();
  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 });

  app.get("/health", async () => ({ status: "ok", storage: store.kind }));

  app.post("/v1/auth/challenges", async (request, reply) => {
    const parsed = addressBody.safeParse(request.body);
    if (!parsed.success || !isAddress(parsed.data.address)) return reply.code(400).send({ error: "INVALID_ADDRESS" });
    const address = getAddress(parsed.data.address);
    const nonce = randomBytes(24).toString("hex");
    const expiresAt = now() + 5 * 60_000;
    const message = [
      "Agent Commitments authentication",
      `Audience: ${audience}`,
      `Chain ID: ${chainId}`,
      `Address: ${address}`,
      `Nonce: ${nonce}`,
      `Expires at: ${new Date(expiresAt).toISOString()}`,
    ].join("\n");
    await store.putChallenge(address.toLowerCase(), { message, expiresAt });
    return reply.code(201).send({ message, expiresAt: new Date(expiresAt).toISOString() });
  });

  app.post("/v1/auth/sessions", async (request, reply) => {
    const parsed = authBody.safeParse(request.body);
    if (!parsed.success || !isAddress(parsed.data.address)) return reply.code(400).send({ error: "INVALID_AUTH_REQUEST" });
    const address = getAddress(parsed.data.address);
    const key = address.toLowerCase();
    const challenge = await store.getChallenge(key, now());
    if (!challenge) return reply.code(401).send({ error: "CHALLENGE_INVALID_OR_EXPIRED" });
    const valid = await verifyMessage({ address, message: challenge.message, signature: parsed.data.signature as Hex });
    if (!valid) return reply.code(401).send({ error: "SIGNATURE_INVALID" });
    if (!await store.consumeChallenge(key, challenge.message, now())) {
      return reply.code(401).send({ error: "CHALLENGE_INVALID_OR_EXPIRED" });
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = now() + 60 * 60_000;
    await store.putSession(tokenHash(token), { tenantId: key, address, expiresAt });
    return reply.code(201).send({ token, expiresAt: new Date(expiresAt).toISOString() });
  });

  app.get("/v1/operations", async (request, reply) => {
    const session = await authenticate(request, store, now());
    if (!session) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return { operations: await store.listOperations(session.tenantId) };
  });

  app.post("/v1/operations", async (request, reply) => {
    const session = await authenticate(request, store, now());
    if (!session) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const idempotencyKey = header(request, "idempotency-key");
    const parsed = operationBody.safeParse(request.body);
    if (!idempotencyKey || idempotencyKey.length > 200 || !parsed.success) return reply.code(400).send({ error: "INVALID_OPERATION" });

    const fingerprint = keccak256(stringToHex(canonicalJson(parsed.data)));
    const operation = { id: randomUUID(), idempotencyKey, payload: parsed.data, status: "PREPARED" as const };
    try {
      const stored = await store.putOperation(session.tenantId, idempotencyKey, fingerprint, operation);
      return reply.code(stored.created ? 201 : 200).send(stored.operation);
    } catch (error) {
      if (error instanceof ApiPayloadConflictError) return reply.code(409).send({ error: "IDEMPOTENCY_CONFLICT" });
      throw error;
    }
  });

  return app;
}

async function authenticate(request: FastifyRequest, store: ApiStore, currentTime: number): Promise<Session | undefined> {
  const authorization = header(request, "authorization");
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const token = authorization.slice(7);
  return store.getSession(tokenHash(token), currentTime);
}

function tokenHash(token: string): Hex { return `0x${createHash("sha256").update(token).digest("hex")}`; }

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function canonicalJson(value: Record<string, string>): string {
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${JSON.stringify(value[key])}`).join(",")}}`;
}
