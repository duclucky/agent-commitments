import { describe, expect, it } from "vitest";
import {
  InboundFundingConflictError,
  advanceInboundFunding,
  budgetCreditableAmount,
  createInboundFunding,
  nextInboundFundingAction,
} from "./inbound-funding.js";

const route = {
  protocol: "CCTP" as const,
  sourceChainId: 8453,
  sourceDomain: 6,
  destinationChainId: 5_042_002,
  destinationDomain: 26,
  recipient: "0x1000000000000000000000000000000000000001" as const,
  budgetVault: "0x2000000000000000000000000000000000000002" as const,
  operationId: `0x${"11".repeat(32)}` as const,
  requestedAmount: 10_000_000n,
};

describe("CCTP inbound budget funding", () => {
  it("does not credit a budget before the destination deposit is confirmed", () => {
    let state = createInboundFunding(route);
    expect(nextInboundFundingAction(state)).toBe("SUBMIT_BURN");
    state = advanceInboundFunding(state, { type: "BURN_SUBMITTED", txHash: "0xaa01" });
    state = advanceInboundFunding(state, { type: "BURN_CONFIRMED", txHash: "0xaa01", messageHash: "0xbb01" });
    state = advanceInboundFunding(state, { type: "ATTESTATION_RECEIVED", messageHash: "0xbb01", attestationHash: "0xcc01" });
    state = advanceInboundFunding(state, { type: "MINT_SUBMITTED", txHash: "0xdd01" });
    state = advanceInboundFunding(state, { type: "MINT_CONFIRMED", txHash: "0xdd01", receivedAmount: 9_990_000n });
    expect(budgetCreditableAmount(state)).toBe(0n);
    expect(nextInboundFundingAction(state)).toBe("APPROVE_AND_DEPOSIT");
    state = advanceInboundFunding(state, { type: "DEPOSIT_SUBMITTED", txHash: "0xee01", amount: 9_990_000n });
    expect(budgetCreditableAmount(state)).toBe(0n);
    state = advanceInboundFunding(state, { type: "DEPOSIT_CONFIRMED", txHash: "0xee01", amount: 9_990_000n });
    expect(budgetCreditableAmount(state)).toBe(9_990_000n);
    expect(nextInboundFundingAction(state)).toBe("COMPLETE");
  });

  it("is idempotent for matching evidence and rejects conflicting retries", () => {
    const planned = createInboundFunding(route);
    const submitted = advanceInboundFunding(planned, { type: "BURN_SUBMITTED", txHash: "0xaa01" });
    expect(advanceInboundFunding(submitted, { type: "BURN_SUBMITTED", txHash: "0xaa01" })).toEqual(submitted);
    expect(() => advanceInboundFunding(submitted, { type: "BURN_SUBMITTED", txHash: "0xaa02" }))
      .toThrow(InboundFundingConflictError);
  });

  it("rejects skipped stages, wrong message binding and deposit amount mismatch", () => {
    const planned = createInboundFunding(route);
    expect(() => advanceInboundFunding(planned, { type: "MINT_SUBMITTED", txHash: "0xdd01" })).toThrow("Invalid inbound funding transition");
    const burned = advanceInboundFunding(
      advanceInboundFunding(planned, { type: "BURN_SUBMITTED", txHash: "0xaa01" }),
      { type: "BURN_CONFIRMED", txHash: "0xaa01", messageHash: "0xbb01" },
    );
    expect(() => advanceInboundFunding(burned, { type: "ATTESTATION_RECEIVED", messageHash: "0xbb02", attestationHash: "0xcc01" }))
      .toThrow(InboundFundingConflictError);

    let minted = advanceInboundFunding(burned, { type: "ATTESTATION_RECEIVED", messageHash: "0xbb01", attestationHash: "0xcc01" });
    minted = advanceInboundFunding(minted, { type: "MINT_SUBMITTED", txHash: "0xdd01" });
    minted = advanceInboundFunding(minted, { type: "MINT_CONFIRMED", txHash: "0xdd01", receivedAmount: 9_990_000n });
    expect(() => advanceInboundFunding(minted, { type: "DEPOSIT_SUBMITTED", txHash: "0xee01", amount: 10_000_000n }))
      .toThrow(InboundFundingConflictError);
  });

  it("requires Arc as destination and rejects non-positive amounts", () => {
    expect(() => createInboundFunding({ ...route, destinationChainId: 1 })).toThrow("Arc destination");
    expect(() => createInboundFunding({ ...route, requestedAmount: 0n })).toThrow("positive");
  });
});
