import Fastify, { type FastifyRequest } from "fastify";
import { quoteTypedData, type Quote } from "@agent-commitments/sdk";
import { getAddress, isAddress, keccak256, stringToHex, type Address, type Hex } from "viem";
import { z } from "zod";

interface QuoteSigner {
  readonly address: Address;
  signTypedData(data: ReturnType<typeof quoteTypedData>): Promise<Hex>;
}

interface ProviderOptions { readonly signer: QuoteSigner; readonly nowSeconds?: () => bigint }
interface ProviderJob { readonly id: string; readonly operationId: Hex; readonly commitmentId: Hex; readonly workHash: Hex; readonly status: "ACCEPTED" }

const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const quoteRequest = z.object({
  chainId: z.number().int().positive(), vault: z.string(), grantId: bytes32, operationId: bytes32,
  evaluator: z.string(), token: z.string(), adapter: z.string(),
  amount: z.string().regex(/^[1-9][0-9]*$/), workHash: bytes32,
});
const jobRequest = z.object({ operationId: bytes32, commitmentId: bytes32, workHash: bytes32 });

export function buildProviderServer(options: ProviderOptions) {
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 });
  const nowSeconds = options.nowSeconds ?? (() => BigInt(Math.floor(Date.now() / 1000)));
  const jobs = new Map<string, { fingerprint: Hex; value: ProviderJob }>();

  app.post("/v1/quotes", async (request, reply) => {
    const parsed = quoteRequest.safeParse(request.body);
    if (
      !parsed.success
      || !isAddress(parsed.data.vault)
      || !isAddress(parsed.data.evaluator)
      || !isAddress(parsed.data.token)
      || !isAddress(parsed.data.adapter)
    ) return reply.code(400).send({ error: "INVALID_QUOTE_REQUEST" });
    const issuedAt = nowSeconds();
    const quote: Quote = {
      grantId: parsed.data.grantId as Hex, operationId: parsed.data.operationId as Hex,
      provider: options.signer.address, evaluator: getAddress(parsed.data.evaluator), amount: BigInt(parsed.data.amount),
      token: getAddress(parsed.data.token),
      adapter: getAddress(parsed.data.adapter),
      quoteExpiresAt: issuedAt + 15n * 60n, jobExpiresAt: issuedAt + 24n * 60n * 60n,
      workHash: parsed.data.workHash as Hex,
      nonce: keccak256(stringToHex(`${parsed.data.operationId}:${issuedAt}:${parsed.data.amount}`)),
    };
    const signature = await options.signer.signTypedData(quoteTypedData(parsed.data.chainId, getAddress(parsed.data.vault), quote));
    return reply.code(201).send({
      quote: { ...quote, amount: quote.amount.toString(), quoteExpiresAt: quote.quoteExpiresAt.toString(), jobExpiresAt: quote.jobExpiresAt.toString() },
      signature,
    });
  });

  app.post("/v1/jobs", async (request, reply) => {
    const idempotencyKey = header(request, "idempotency-key");
    const parsed = jobRequest.safeParse(request.body);
    if (!idempotencyKey || !parsed.success) return reply.code(400).send({ error: "INVALID_JOB_REQUEST" });
    const fingerprint = keccak256(stringToHex(canonicalJson(parsed.data)));
    const existing = jobs.get(idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return reply.code(409).send({ error: "IDEMPOTENCY_CONFLICT" });
      return reply.code(200).send(existing.value);
    }
    const value: ProviderJob = { id: idempotencyKey, operationId: parsed.data.operationId as Hex, commitmentId: parsed.data.commitmentId as Hex, workHash: parsed.data.workHash as Hex, status: "ACCEPTED" };
    jobs.set(idempotencyKey, { fingerprint, value });
    return reply.code(202).send(value);
  });

  app.get<{ Params: { operationId: string } }>("/v1/jobs/:operationId", async (request, reply) => {
    const found = [...jobs.values()].find(({ value }) => value.operationId === request.params.operationId)?.value;
    return found ? found : reply.code(404).send({ error: "JOB_NOT_FOUND" });
  });
  return app;
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name]; return Array.isArray(value) ? value[0] : value;
}
function canonicalJson(value: Record<string, string>): string {
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${JSON.stringify(value[key])}`).join(",")}}`;
}
