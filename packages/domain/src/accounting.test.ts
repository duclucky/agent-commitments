import { describe, expect, it } from "vitest";
import {
  AccountingError,
  createBudgetLedger,
  transitionLedger,
  type BudgetLedger,
} from "./accounting.js";

function expectConserved(ledger: BudgetLedger): void {
  expect(ledger.deposited).toBe(
    ledger.available + ledger.reserved + ledger.inEscrow + ledger.settled + ledger.withdrawn,
  );
}

describe("budget accounting", () => {
  it("conserves funds through reserve, escrow, settlement and withdrawal", () => {
    let ledger = createBudgetLedger();
    ledger = transitionLedger(ledger, { type: "deposit", amount: 100_000_000n });
    ledger = transitionLedger(ledger, { type: "reserve", amount: 40_000_000n });
    ledger = transitionLedger(ledger, { type: "fund", amount: 40_000_000n });
    ledger = transitionLedger(ledger, { type: "settle", amount: 40_000_000n });
    ledger = transitionLedger(ledger, { type: "withdraw", amount: 60_000_000n });

    expect(ledger).toEqual({
      deposited: 100_000_000n,
      available: 0n,
      reserved: 0n,
      inEscrow: 0n,
      settled: 40_000_000n,
      withdrawn: 60_000_000n,
    });
    expectConserved(ledger);
  });

  it("returns a funded refund to available without increasing deposits", () => {
    let ledger = createBudgetLedger(100n);
    ledger = transitionLedger(ledger, { type: "reserve", amount: 60n });
    ledger = transitionLedger(ledger, { type: "fund", amount: 60n });
    ledger = transitionLedger(ledger, { type: "refund", amount: 60n });

    expect(ledger.deposited).toBe(100n);
    expect(ledger.available).toBe(100n);
    expectConserved(ledger);
  });

  it("rejects an over-reservation without mutating the input", () => {
    const ledger = createBudgetLedger(100n);
    expect(() => transitionLedger(ledger, { type: "reserve", amount: 101n })).toThrowError(
      new AccountingError("INSUFFICIENT_AVAILABLE"),
    );
    expect(ledger.available).toBe(100n);
  });

  it("rejects zero and negative amounts", () => {
    const ledger = createBudgetLedger(100n);
    expect(() => transitionLedger(ledger, { type: "reserve", amount: 0n })).toThrowError(
      new AccountingError("INVALID_AMOUNT"),
    );
    expect(() => transitionLedger(ledger, { type: "reserve", amount: -1n })).toThrowError(
      new AccountingError("INVALID_AMOUNT"),
    );
  });
});
