import { test } from "node:test";
import assert from "node:assert/strict";
import { enforcePilotFeeCap, enforcePilotScope, settledFeeReservation } from "./arc-mainnet-pilot-policy.mjs";

test("fee cap counts provider allocation and refuses one-unit overspend", () => {
  enforcePilotFeeCap(270n, 20n, 10n, 300n);
  assert.throws(() => enforcePilotFeeCap(270n, 20n, 11n, 300n), /fee ceiling/);
  assert.throws(() => enforcePilotFeeCap(-1n, 0n, 0n, 300n), /Invalid/);
});
test("confirmed fee releases the old estimate reservation but retains authoritative costs", () => {
  assert.equal(settledFeeReservation(40n, 12n, 10n), 12n);
  assert.equal(settledFeeReservation(40n, 12n, 15n), 15n);
  assert.equal(settledFeeReservation(40n, undefined, 10n), 40n);
});
test("broadcast requires the exact authorized chain, owner, candidate and amount", () => {
  const accepted = { chainId: 5042, owner: "0x1", adapter: "0x2", depositAmountUnits: "10000", totalFeeCeilingUnits: "300000", independentReviewException: true, acceptedScope: true };
  enforcePilotScope(accepted, { chainId: 5042, owner: "0x1", adapter: "0x2" });
  for (const patch of [{ chainId: 5042002 }, { acceptedScope: false }, { independentReviewException: false }, { depositAmountUnits: "100000" }, { totalFeeCeilingUnits: "400000" }, { owner: "0x3" }, { adapter: "0x4" }]) {
    assert.throws(() => enforcePilotScope({ ...accepted, ...patch }, { chainId: 5042, owner: "0x1", adapter: "0x2" }), /scope/);
  }
});
