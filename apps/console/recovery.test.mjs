import assert from "node:assert/strict";
import { test } from "node:test";
import { refundView, fundingView, recheckRefund } from "./src/recovery.js";

test("a blocked or ready refund remains unavailable until authoritative reconciliation", () => {
  for (const state of ["BLOCKED", "READY", "UNKNOWN"]) {
    const view = refundView({ state });
    assert.equal(view.refunded, false);
    assert.equal(view.canPrepare, state === "READY");
    assert.ok(view.message.length > 0);
  }
  assert.equal(refundView({ state: "REFUNDED" }).refunded, true);
});

test("unknown receipt suppresses retry even when the last simulation was ready", () => {
  const view = refundView({ state: "READY", transportState: "UNKNOWN" });
  assert.equal(view.canPrepare, false);
  assert.equal(view.tone, "warning");
});

test("unknown recovery payload never enables a transfer", () => {
  for (const value of [null, {}, { state: "INVALID" }]) assert.equal(refundView(value).canPrepare, false);
});

test("a failed recheck discards stale readiness and keeps recovery unknown", async () => {
  assert.equal(refundView({ state: "READY" }).canPrepare, true);
  const view = await recheckRefund(async () => { throw new Error("RPC unavailable"); });
  assert.equal(view.canPrepare, false);
  assert.equal(view.tone, "warning");
});

test("unassigned money is shown separately from usable backing without floating point", () => {
  const view = fundingView({ unassignedBalance: "9007199254740993", backingShortfall: "0" });
  assert.equal(view.unassigned, "9007199254.740993");
  assert.equal(view.tone, "warning");
  assert.equal(view.availableCredit, "0.000000");
});

test("shortfall or invalid evidence is never shown as healthy funding", () => {
  assert.equal(fundingView({ unassignedBalance: "0", backingShortfall: "5" }).tone, "danger");
  for (const value of [null, { unassignedBalance: "-1", backingShortfall: "0" }, { unassignedBalance: 1.1, backingShortfall: "0" }]) {
    assert.equal(fundingView(value).tone, "warning");
  }
});
