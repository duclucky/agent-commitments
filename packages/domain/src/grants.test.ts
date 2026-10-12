import { describe, expect, it } from "vitest";
import { GrantLedger, GrantPolicyError } from "./grants.js";

describe("grant ancestry", () => {
  it("prevents sibling reservations from exceeding their shared parent cap", () => {
    const grants = new GrantLedger();
    grants.add({ id: "root", parentId: null, cap: 100n, expiresAt: 2_000n });
    grants.add({ id: "coordinator", parentId: "root", cap: 100n, expiresAt: 1_900n });
    grants.add({ id: "agent-a", parentId: "coordinator", cap: 80n, expiresAt: 1_800n });
    grants.add({ id: "agent-b", parentId: "coordinator", cap: 80n, expiresAt: 1_800n });

    grants.reserve("agent-a", 60n, 1_000n);
    expect(() => grants.reserve("agent-b", 41n, 1_000n)).toThrowError(
      new GrantPolicyError("CAP_EXCEEDED"),
    );
    grants.reserve("agent-b", 40n, 1_000n);

    expect(grants.usage("root")).toEqual({ reserved: 100n, inEscrow: 0n, grossSpent: 0n });
  });

  it("does not restore lifetime spend after creating a replacement child grant", () => {
    const grants = new GrantLedger();
    grants.add({ id: "root", parentId: null, cap: 100n, expiresAt: 2_000n });
    grants.add({ id: "agent-a", parentId: "root", cap: 60n, expiresAt: 1_500n });
    grants.reserve("agent-a", 60n, 1_000n);
    grants.fund("agent-a", 60n);
    grants.settle("agent-a", 60n);
    grants.revoke("agent-a");
    grants.add({ id: "agent-b", parentId: "root", cap: 60n, expiresAt: 1_500n });

    expect(() => grants.reserve("agent-b", 41n, 1_000n)).toThrowError(
      new GrantPolicyError("CAP_EXCEEDED"),
    );
    grants.reserve("agent-b", 40n, 1_000n);
  });

  it("rejects a child that expands its parent's cap or expiry", () => {
    const grants = new GrantLedger();
    grants.add({ id: "root", parentId: null, cap: 100n, expiresAt: 2_000n });
    expect(() =>
      grants.add({ id: "too-large", parentId: "root", cap: 101n, expiresAt: 1_900n }),
    ).toThrowError(new GrantPolicyError("INVALID_DELEGATION"));
    expect(() =>
      grants.add({ id: "too-long", parentId: "root", cap: 50n, expiresAt: 2_001n }),
    ).toThrowError(new GrantPolicyError("INVALID_DELEGATION"));
  });

  it("attenuates provider and evaluator allowlists across descendants", () => {
    const grants = new GrantLedger();
    grants.add({
      id: "root",
      parentId: null,
      cap: 100n,
      expiresAt: 2_000n,
      providerAllowlist: ["provider-a", "provider-b"],
      evaluatorAllowlist: ["evaluator-a"],
    });
    grants.add({
      id: "agent",
      parentId: "root",
      cap: 50n,
      expiresAt: 1_500n,
      providerAllowlist: ["provider-a"],
      evaluatorAllowlist: ["evaluator-a"],
    });

    expect(() => grants.add({
      id: "widened",
      parentId: "root",
      cap: 50n,
      expiresAt: 1_500n,
      providerAllowlist: ["provider-c"],
      evaluatorAllowlist: ["evaluator-a"],
    })).toThrowError(new GrantPolicyError("INVALID_DELEGATION"));
    expect(() => grants.reserve("agent", 1n, 1_000n, {
      provider: "provider-b",
      evaluator: "evaluator-a",
    })).toThrowError(new GrantPolicyError("PROVIDER_NOT_ALLOWED"));
    grants.reserve("agent", 1n, 1_000n, { provider: "provider-a", evaluator: "evaluator-a" });
  });
});
