export class IdempotencyError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "IdempotencyError";
  }
}

export class IdempotencyStore<T> {
  readonly #records = new Map<string, { fingerprint: string; result: Promise<T> }>();

  async execute(
    scope: string,
    key: string,
    payload: unknown,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!scope || !key) throw new IdempotencyError("INVALID_KEY");
    const recordKey = `${scope}\u0000${key}`;
    const fingerprint = canonicalJson(payload);
    const existing = this.#records.get(recordKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new IdempotencyError("PAYLOAD_CONFLICT");
      return existing.result;
    }

    const result = Promise.resolve().then(operation);
    this.#records.set(recordKey, { fingerprint, result });
    return result;
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new IdempotencyError("INVALID_PAYLOAD");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new IdempotencyError("INVALID_PAYLOAD");
}
