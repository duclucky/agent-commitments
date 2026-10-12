import { refundView, fundingView, recheckRefund } from "./recovery.js";
import { loadMainnetSnapshot } from "./mainnet.js";

const scenarios = {
  success: { ledger: ["100.000000", "30.000000", "10.000000", "20.000000", "40.000000", "0.000000"], row: ["doc-2048", "Atlas OCR", "40.000000", "SETTLED", "CONFIRMED"] },
  refund: { ledger: ["100.000000", "70.000000", "10.000000", "20.000000", "0.000000", "0.000000"], row: ["doc-2051", "Lumen Translate", "20.000000", "REFUNDED", "CONFIRMED"] },
  unknown: { ledger: ["100.000000", "50.000000", "10.000000", "40.000000", "0.000000", "0.000000"], row: ["doc-2055", "Schema Works", "40.000000", "FUNDED", "UNKNOWN"] },
  "refund-blocked": { ledger: ["100.000000", "60.000000", "0.000000", "40.000000", "0.000000", "0.000000"], row: ["doc-2056", "Atlas OCR", "20.000000", "FUNDED", "CONFIRMED"], refund: { state: "BLOCKED" } },
  "refund-ready": { ledger: ["100.000000", "60.000000", "0.000000", "40.000000", "0.000000", "0.000000"], row: ["doc-2056", "Atlas OCR", "20.000000", "FUNDED", "CONFIRMED"], refund: { state: "READY" } },
  donation: { ledger: ["100.000000", "100.000000", "0.000000", "0.000000", "0.000000", "0.000000"], row: ["doc-2057", "Atlas OCR", "0.000000", "NONE", "PREPARED"], funding: { unassignedBalance: "5000000", backingShortfall: "0" } },
};
const labels = ["Deposited · D", "Available · A", "Reserved · R", "Escrow · E", "Settled · S", "Withdrawn · W"];
const metrics = document.querySelector("#metrics");
const body = document.querySelector("#commitments");
const announcer = document.querySelector("#announcer");
const demoButton = document.querySelector("#new-commitment");
const demoStatus = document.querySelector("#demo-status");
const localChainMode = new URLSearchParams(window.location.search).get("mode") === "local-chain";
const mainnetMode = new URLSearchParams(window.location.search).get("mode") === "mainnet";
let staleTimer;
const usdcPattern = /^(0|[1-9][0-9]*)\.[0-9]{6}$/;
let currentScenario = "success";
let recoveryRevision = 0;
const recheckButton = document.querySelector("#recheck-refund");

function renderRefund(view) {
  document.querySelector("#refund-title").textContent = view.title;
  document.querySelector("#refund-message").textContent = view.message;
  document.querySelector(".recovery-detail").dataset.tone = view.tone;
}

function renderRecovery(scenario) {
  recoveryRevision++;
  const state = scenario.refund ?? { state: scenario.row[3] === "REFUNDED" ? "REFUNDED" : "NOT_APPLICABLE", transportState: scenario.row[4] };
  renderRefund(refundView(state));
  const funding = fundingView(scenario.funding ?? { unassignedBalance: "0", backingShortfall: "0" });
  document.querySelector("#funding-message").textContent = funding.message;
  document.querySelector("#unassigned-balance").textContent = funding.unassigned;
  document.querySelector(".funding-panel").dataset.tone = funding.tone;
}

function renderLedger(values) {
  metrics.replaceChildren(...values.map((value, index) => {
    const card = document.createElement("article");
    card.className = "metric";
    const label = document.createElement("span");
    const amount = document.createElement("strong");
    const unit = document.createElement("small");
    label.textContent = labels[index];
    amount.textContent = value;
    unit.textContent = "USDC";
    card.append(label, amount, unit);
    return card;
  }));
}

function renderRow([operation, provider, amount, economic, transport], transactionHash = "", append = false) {
  const row = document.createElement("tr");
  row.dataset.transactionHash = transactionHash;
  const values = [operation, provider, `${amount} USDC`];
  values.forEach((value, index) => {
    const cell = document.createElement("td");
    cell.textContent = mainnetMode && index < 2 ? `${value.slice(0,10)}…${value.slice(-6)}` : value;
    if (mainnetMode && index < 2) cell.title = value;
    if (index !== 1 || mainnetMode) cell.className = "mono";
    if (index === 2) cell.classList.add("money-cell");
    row.append(cell);
  });
  for (const state of [economic, transport]) {
    const cell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `status ${state.toLowerCase()}`;
    badge.textContent = state;
    cell.append(badge);
    row.append(cell);
  }
  const actionCell = document.createElement("td");
  const inspect = document.createElement(mainnetMode ? "a" : "button");
  inspect.className = "link-button";
  if (mainnetMode) {
    inspect.href = `https://explorer.arc.io/tx/${transactionHash}`;
    inspect.target = "_blank";
    inspect.rel = "noopener noreferrer";
    inspect.textContent = "View receipt";
    inspect.setAttribute("aria-label", `View receipt for ${operation}`);
  } else { inspect.type = "button"; inspect.textContent = "Inspect chain"; }
  inspect.addEventListener("click", () => {
    if (transport === "UNKNOWN") announcer.textContent = "Receipt unavailable. Do not resend the transaction.";
    else if (transactionHash) announcer.textContent = `Confirmed receipt: ${transactionHash}.`;
    else announcer.textContent = `Transaction state: ${transport}.`;
  });
  actionCell.append(inspect);
  row.append(actionCell);
  if (append) body.append(row); else body.replaceChildren(row);
}

function clearMainnetEvidence(message, state) {
  renderLedger(labels.map(() => "—"));
  body.replaceChildren();
  renderRefund(refundView({state:"UNKNOWN"}));
  document.querySelector("#funding-message").textContent = "Mainnet balance evidence is unavailable.";
  document.querySelector("#unassigned-balance").textContent = "—";
  document.querySelector(".funding-panel").dataset.tone = "warning";
  demoStatus.textContent = message;
  announcer.textContent = message;
  document.body.dataset.mainnetState = state;
}

async function refreshMainnet() {
  clearTimeout(staleTimer);
  const restoreFocus = document.activeElement;
  demoButton.disabled = recheckButton.disabled = true;
  demoButton.setAttribute("aria-busy", "true");
  clearMainnetEvidence("Reading Arc Mainnet · chain 5042…", "loading");
  try {
    const view = await loadMainnetSnapshot();
    renderLedger(view.amounts);
    body.replaceChildren();
    view.rows.forEach(row => renderRow([row.operation,row.provider,row.amount,row.economic,row.transport],row.transactionHash,true));
    const refund = view.rows.find(row => row.economic === "REFUNDED");
    renderRefund(refundView({state:refund ? "REFUNDED" : "NOT_APPLICABLE",transportState:refund?.transport}));
    const funding = fundingView(view.funding);
    document.querySelector("#funding-message").textContent = funding.message;
    document.querySelector("#unassigned-balance").textContent = funding.unassigned;
    document.querySelector(".funding-panel").dataset.tone = funding.tone;
    demoStatus.textContent = `Block ${view.observedBlock} · ${new Date(view.observedAt).toLocaleTimeString("en-GB")} · read-only`;
    announcer.textContent = "Ledger and receipts verified on Arc Mainnet.";
    document.body.dataset.mainnetState = "verified";
    staleTimer = setTimeout(() => clearMainnetEvidence("Snapshot is over 2 minutes old. Refresh to verify the current state.","stale"),120_000);
  } catch {
    clearMainnetEvidence("Unverified: mainnet evidence is unavailable. Refresh to retry the read; no transaction will be sent.", "error");
  } finally {
    demoButton.disabled = recheckButton.disabled = false;
    demoButton.removeAttribute("aria-busy");
    if (restoreFocus === demoButton || restoreFocus === recheckButton) restoreFocus.focus();
  }
}

function render(name) {
  currentScenario = name;
  const scenario = scenarios[name];
  renderLedger(scenario.ledger);
  renderRow(scenario.row);
  renderRecovery(scenario);
  announcer.textContent = `Demo scenario: ${name}.`;
}

function validateSettlement(payload) {
  const ledger = payload?.ledger;
  const amounts = ledger && [ledger.deposited, ledger.available, ledger.reserved, ledger.inEscrow, ledger.settled, ledger.withdrawn];
  if (!amounts || amounts.some((amount) => !usdcPattern.test(amount))) throw new Error("Invalid local-chain ledger");
  const units = amounts.map((amount) => BigInt(amount.replace(".", "")));
  if (units[0] !== units.slice(1).reduce((total, value) => total + value, 0n)) throw new Error("Local-chain ledger violates D=A+R+E+S+W");
  if (!usdcPattern.test(payload.amount) || payload.economic !== "SETTLED" || payload.transport !== "CONFIRMED") throw new Error("Invalid local-chain settlement");
  if (!/^0x[0-9a-f]{64}$/i.test(payload.operation) || !/^0x[0-9a-f]{40}$/i.test(payload.provider) || !/^0x[0-9a-f]{64}$/i.test(payload.transactionHash)) throw new Error("Invalid on-chain evidence");
  return { amounts, row: [payload.operation, payload.provider, payload.amount, payload.economic, payload.transport] };
}

async function runLocalSettlement() {
  const restoreFocus = document.activeElement === demoButton;
  demoButton.disabled = true;
  demoButton.setAttribute("aria-busy", "true");
  demoButton.textContent = "Settling…";
  demoStatus.textContent = "Signing the quote, reserving, dispatching and reconciling on local Anvil…";
  document.body.dataset.chainE2e = "running";
  try {
    const response = await fetch("/api/local-chain/settle", { method: "POST", headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Local chain returned HTTP ${response.status}`);
    const payload = await response.json();
    const settlement = validateSettlement(payload);
    renderLedger(settlement.amounts);
    renderRow(settlement.row, payload.transactionHash);
    renderRecovery({ row: settlement.row });
    demoStatus.textContent = `Settled ${payload.amount} USDC on the local chain. Receipt ${payload.transactionHash.slice(0, 12)}…`;
    announcer.textContent = `Settlement confirmed for ${payload.amount} USDC.`;
    document.body.dataset.chainE2e = "settled";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown local-chain error";
    demoStatus.textContent = `Unable to confirm settlement: ${message}. The transaction will not be resent automatically.`;
    announcer.textContent = demoStatus.textContent;
    document.body.dataset.chainE2e = "error";
  } finally {
    demoButton.disabled = false;
    demoButton.removeAttribute("aria-busy");
    demoButton.textContent = "Run local settlement";
    if (restoreFocus) demoButton.focus();
  }
}

document.querySelectorAll("[data-scenario]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll("[data-scenario]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
  render(button.dataset.scenario);
}));
demoButton.addEventListener("click", () => {
  if (mainnetMode) void refreshMainnet();
  else if (localChainMode) void runLocalSettlement();
  else {
    demoStatus.textContent = "Local demo: the signature request would be prepared; no transaction is broadcast.";
    announcer.textContent = demoStatus.textContent;
  }
});
recheckButton.addEventListener("click", async () => {
  if (mainnetMode) { await refreshMainnet(); return; }
  const revision = recoveryRevision;
  recheckButton.disabled = true;
  recheckButton.setAttribute("aria-busy", "true");
  try {
    const view = await recheckRefund(async () => {
      const scenario = scenarios[currentScenario];
      return scenario.refund ?? { state: scenario.row[3] === "REFUNDED" ? "REFUNDED" : "NOT_APPLICABLE", transportState: scenario.row[4] };
    });
    if (revision === recoveryRevision) renderRefund(view);
  } finally {
    recheckButton.disabled = false;
    recheckButton.removeAttribute("aria-busy");
  }
});
if (localChainMode) {
  demoButton.textContent = "Run local settlement";
  demoStatus.textContent = "Local E2E mode: transactions are broadcast only to Anvil on this machine.";
}
if (mainnetMode) {
  document.querySelector(".network").textContent = "Arc Mainnet · read-only";
  document.querySelector(".segmented").hidden = true;
  document.querySelector(".recovery-detail .eyebrow").textContent = "REFUND RECONCILIATION · MAINNET";
  document.querySelector("#refund-scope").textContent = "Internal pilot: 2 test jobs, excluded from customer traction. Independent review is pending. Reads on-chain state and receipts only; no signing or broadcasting.";
  document.querySelector("#funding-mode").textContent = "mainnet";
  demoButton.textContent = "Refresh mainnet";
  recheckButton.textContent = "Recheck mainnet";
  void refreshMainnet();
} else render("success");
