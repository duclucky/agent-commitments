export interface GrantDefinition {
  readonly id: string;
  readonly parentId: string | null;
  readonly cap: bigint;
  readonly expiresAt: bigint;
  readonly providerAllowlist?: readonly string[];
  readonly evaluatorAllowlist?: readonly string[];
}

export interface GrantUsage {
  readonly reserved: bigint;
  readonly inEscrow: bigint;
  readonly grossSpent: bigint;
}

export class GrantPolicyError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "GrantPolicyError";
  }
}

export class GrantLedger {
  readonly #grants = new Map<string, StoredGrant>();

  add(definition: GrantDefinition): void {
    if (!definition.id || this.#grants.has(definition.id)) {
      throw new GrantPolicyError("GRANT_EXISTS");
    }
    if (definition.cap <= 0n || definition.expiresAt <= 0n) {
      throw new GrantPolicyError("INVALID_GRANT");
    }
    if (definition.parentId !== null) {
      const parent = this.#get(definition.parentId);
      if (
        parent.revoked ||
        definition.cap > parent.cap ||
        definition.expiresAt > parent.expiresAt
      ) {
        throw new GrantPolicyError("INVALID_DELEGATION");
      }
      this.#assertSubset(definition.providerAllowlist, parent.allowedProviders);
      this.#assertSubset(definition.evaluatorAllowlist, parent.allowedEvaluators);
    } else if (this.#rootCount() > 0) {
      throw new GrantPolicyError("MULTIPLE_ROOTS");
    }
    const allowedProviders = this.#allowlist(definition.providerAllowlist);
    const allowedEvaluators = this.#allowlist(definition.evaluatorAllowlist);
    this.#grants.set(definition.id, {
      ...definition,
      revoked: false,
      usage: { reserved: 0n, inEscrow: 0n, grossSpent: 0n },
      allowedProviders,
      allowedEvaluators,
    });
  }

  reserve(
    grantId: string,
    amount: bigint,
    now: bigint,
    parties?: { readonly provider: string; readonly evaluator: string },
  ): void {
    this.#validateAmount(amount);
    const path = this.#path(grantId);
    for (const grant of path) {
      if (grant.revoked) throw new GrantPolicyError("GRANT_REVOKED");
      if (now >= grant.expiresAt) throw new GrantPolicyError("GRANT_EXPIRED");
      if (grant.allowedProviders.size > 0 && !grant.allowedProviders.has(parties?.provider ?? "")) {
        throw new GrantPolicyError("PROVIDER_NOT_ALLOWED");
      }
      if (grant.allowedEvaluators.size > 0 && !grant.allowedEvaluators.has(parties?.evaluator ?? "")) {
        throw new GrantPolicyError("EVALUATOR_NOT_ALLOWED");
      }
      const used = grant.usage.reserved + grant.usage.inEscrow + grant.usage.grossSpent;
      if (used + amount > grant.cap) throw new GrantPolicyError("CAP_EXCEEDED");
    }
    for (const grant of path) grant.usage.reserved += amount;
  }

  fund(grantId: string, amount: bigint): void {
    this.#validateAmount(amount);
    const path = this.#path(grantId);
    for (const grant of path) {
      if (grant.usage.reserved < amount) throw new GrantPolicyError("INSUFFICIENT_RESERVED");
    }
    for (const grant of path) {
      grant.usage.reserved -= amount;
      grant.usage.inEscrow += amount;
    }
  }

  settle(grantId: string, amount: bigint): void {
    this.#validateAmount(amount);
    const path = this.#path(grantId);
    for (const grant of path) {
      if (grant.usage.inEscrow < amount) throw new GrantPolicyError("INSUFFICIENT_ESCROW");
    }
    for (const grant of path) {
      grant.usage.inEscrow -= amount;
      grant.usage.grossSpent += amount;
    }
  }

  cancel(grantId: string, amount: bigint): void {
    this.#validateAmount(amount);
    const path = this.#path(grantId);
    for (const grant of path) {
      if (grant.usage.reserved < amount) throw new GrantPolicyError("INSUFFICIENT_RESERVED");
    }
    for (const grant of path) grant.usage.reserved -= amount;
  }

  refund(grantId: string, amount: bigint): void {
    this.#validateAmount(amount);
    const path = this.#path(grantId);
    for (const grant of path) {
      if (grant.usage.inEscrow < amount) throw new GrantPolicyError("INSUFFICIENT_ESCROW");
    }
    for (const grant of path) grant.usage.inEscrow -= amount;
  }

  revoke(grantId: string): void {
    this.#get(grantId).revoked = true;
  }

  usage(grantId: string): GrantUsage {
    return { ...this.#get(grantId).usage };
  }

  #path(grantId: string): StoredGrant[] {
    const path = [];
    let current = this.#get(grantId);
    const visited = new Set<string>();
    while (true) {
      if (visited.has(current.id)) throw new GrantPolicyError("GRANT_CYCLE");
      visited.add(current.id);
      path.push(current);
      if (current.parentId === null) break;
      current = this.#get(current.parentId);
    }
    return path;
  }

  #get(id: string): StoredGrant {
    const grant = this.#grants.get(id);
    if (!grant) throw new GrantPolicyError("GRANT_NOT_FOUND");
    return grant;
  }

  #validateAmount(amount: bigint): void {
    if (amount <= 0n) throw new GrantPolicyError("INVALID_AMOUNT");
  }

  #rootCount(): number {
    let count = 0;
    for (const grant of this.#grants.values()) if (grant.parentId === null) count += 1;
    return count;
  }

  #allowlist(values: readonly string[] | undefined): Set<string> {
    const result = new Set(values ?? []);
    if (result.has("")) throw new GrantPolicyError("INVALID_GRANT");
    return result;
  }

  #assertSubset(values: readonly string[] | undefined, parent: ReadonlySet<string>): void {
    if (parent.size === 0) return;
    if (!values?.length || values.some((value) => !parent.has(value))) {
      throw new GrantPolicyError("INVALID_DELEGATION");
    }
  }
}

interface MutableGrantUsage {
  reserved: bigint;
  inEscrow: bigint;
  grossSpent: bigint;
}

type StoredGrant = GrantDefinition & {
  revoked: boolean;
  usage: MutableGrantUsage;
  allowedProviders: Set<string>;
  allowedEvaluators: Set<string>;
};
