const refundStates = {
  BLOCKED: ["Refund blocked", "Reconciliation simulation reverted. Funds have not returned to the vault; the obligation remains in E. Check USDC transfer restrictions and contract state, then recheck before retrying.", "warning"],
  READY: ["Ready to prepare reconciliation", "Simulation passed. Funds remain unavailable until the receipt and vault state confirm the refund. Reuse the same commitment ID.", "info"],
  UNKNOWN: ["Refund recovery unknown", "Evidence is incomplete or the RPC has not responded. Preserve the obligation and recheck; do not create a new payment.", "warning"],
  REFUNDED: ["Refund reconciled", "The vault records REFUNDED. Do not reconcile this commitment again.", "success"],
  AWAITING_ESCROW: ["Awaiting escrow", "Escrow has not returned funds. A worker timeout does not release a funded obligation.", "info"],
  NOT_APPLICABLE: ["No refund to reconcile", "Track the economic state and transaction receipt separately for each commitment.", "info"],
};

export function refundView(snapshot) {
  const pending = snapshot?.transportState === "UNKNOWN" && snapshot?.state !== "REFUNDED";
  const state = pending ? "UNKNOWN" : Object.hasOwn(refundStates, snapshot?.state ?? "") ? snapshot.state : "UNKNOWN";
  const [title, message, tone] = refundStates[state];
  return {
    title, tone, message: pending ? "The previous transaction receipt is unknown. Check the same transaction hash before preparing a retry." : message,
    canPrepare: state === "READY", refunded: state === "REFUNDED",
  };
}

export async function recheckRefund(readSnapshot) {
  try { return refundView(await readSnapshot()); }
  catch { return refundView({ state: "UNKNOWN" }); }
}

function units(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("Invalid money");
  return BigInt(value);
}

function format(value) { return `${value / 1_000_000n}.${String(value % 1_000_000n).padStart(6, "0")}`; }

export function fundingView(snapshot) {
  try {
    const unassigned = units(snapshot?.unassignedBalance);
    const shortfall = units(snapshot?.backingShortfall);
    return {
      tone: shortfall > 0n ? "danger" : unassigned > 0n ? "warning" : "info",
      unassigned: format(unassigned), shortfall: format(shortfall), availableCredit: "0.000000",
      message: shortfall > 0n ? "Backing is below A+R. Stop new obligations and inspect the on-chain evidence."
        : unassigned > 0n ? "Some USDC is unassigned to the budget. It does not increase A, and the vault currently has no recovery function for direct transfers."
          : "Approve the exact amount, then deposit. Direct USDC transfers to the vault do not credit the budget.",
    };
  } catch {
    return { tone: "warning", unassigned: "—", shortfall: "—", availableCredit: "0.000000", message: "Balance evidence is incomplete. Verify the 6-decimal token, ledger and block before depositing." };
  }
}
