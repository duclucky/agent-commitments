import { describe, expect, it } from "vitest";
import { IdempotencyStore, IdempotencyError } from "./idempotency.js";

describe("idempotency records", () => {
  it("returns the original result for the same scope, key and payload", async () => {
    const store = new IdempotencyStore<string>();
    let calls = 0;
    const first = await store.execute("budget-1", "op-1", { amount: "10" }, async () => {
      calls += 1;
      return "commitment-1";
    });
    const second = await store.execute("budget-1", "op-1", { amount: "10" }, async () => {
      calls += 1;
      return "commitment-2";
    });

    expect(first).toBe("commitment-1");
    expect(second).toBe("commitment-1");
    expect(calls).toBe(1);
  });

  it("rejects the same key with a different payload", async () => {
    const store = new IdempotencyStore<string>();
    await store.execute("budget-1", "op-1", { amount: "10" }, async () => "ok");
    await expect(
      store.execute("budget-1", "op-1", { amount: "11" }, async () => "wrong"),
    ).rejects.toEqual(new IdempotencyError("PAYLOAD_CONFLICT"));
  });

  it("deduplicates concurrent executions", async () => {
    const store = new IdempotencyStore<string>();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const execute = () =>
      store.execute("budget-1", "op-1", { amount: "10" }, async () => {
        calls += 1;
        await gate;
        return "commitment-1";
      });

    const first = execute();
    const second = execute();
    release();
    expect(await Promise.all([first, second])).toEqual(["commitment-1", "commitment-1"]);
    expect(calls).toBe(1);
  });
});
