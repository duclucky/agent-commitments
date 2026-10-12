const keys = ["deposited", "available", "reserved", "inEscrow", "settled", "withdrawn"];
const economicStates = new Set(["NONE", "RESERVED", "FUNDED", "SETTLED", "REFUNDED", "CANCELLED", "UNKNOWN"]);
const transportStates = new Set(["PREPARED", "SUBMITTED", "CONFIRMED", "REVERTED", "UNKNOWN"]);
function units(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value)) throw new Error("Invalid snapshot money");
  return BigInt(value);
}
function format(value) { return `${value / 1_000_000n}.${String(value % 1_000_000n).padStart(6, "0")}`; }
function hex(value, size) { if (typeof value !== "string" || !new RegExp(`^0x[0-9a-f]{${size}}$`, "i").test(value)) throw new Error("Invalid snapshot evidence"); return value; }

export function validateMainnetSnapshot(snapshot) {
  const age = Date.now() - Date.parse(snapshot?.observedAt);
  if (snapshot?.chainId !== 5042 || snapshot.readOnly !== true || !Number.isFinite(age) || age > 120_000 || age < -30_000) throw new Error("Invalid or stale snapshot");
  units(snapshot.observedBlock);
  const values = keys.map(key => units(snapshot.ledger?.[key]));
  if (values[0] !== values.slice(1).reduce((sum, value) => sum + value, 0n)) throw new Error("Snapshot ledger conservation mismatch");
  const funding = Object.fromEntries(["physicalBalance", "recordedBacking", "unassignedBalance", "backingShortfall"].map(key => [key, units(snapshot.funding?.[key])]));
  const delta = funding.physicalBalance - funding.recordedBacking;
  if (funding.recordedBacking !== values[1] + values[2] || funding.unassignedBalance !== (delta > 0n ? delta : 0n) || funding.backingShortfall !== (delta < 0n ? -delta : 0n)) throw new Error("Invalid snapshot backing");
  if (!Array.isArray(snapshot.operations) || snapshot.operations.length > 20) throw new Error("Invalid snapshot operations");
  const rows = snapshot.operations.map(operation => {
    if (!economicStates.has(operation.economicStatus) || !transportStates.has(operation.transportState)) throw new Error("Invalid snapshot state");
    units(operation.jobId);
    return { operation:hex(operation.commitmentId,64), provider:hex(operation.provider,40), amount:format(units(operation.amount)), economic:operation.economicStatus, transport:operation.transportState, transactionHash:hex(operation.transactionHash,64), jobId:operation.jobId };
  });
  return { amounts:values.map(format), rows, funding:snapshot.funding, observedBlock:snapshot.observedBlock, observedAt:snapshot.observedAt };
}

export async function loadMainnetSnapshot(fetchSnapshot = fetch) {
  const response = await fetchSnapshot("/api/mainnet/snapshot", { method:"GET", cache:"no-store", headers:{accept:"application/json"}, signal:AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error("Unable to read mainnet evidence");
  return validateMainnetSnapshot(await response.json());
}
