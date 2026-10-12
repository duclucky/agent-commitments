import { encodeAbiParameters, isAddress, keccak256, parseAbiParameters, type Address, type Hex } from "viem";
import { arcMainnet, arcTestnet } from "@agent-commitments/network-config";

export type InboundFundingStage =
  | "PLANNED"
  | "BURN_SUBMITTED"
  | "BURN_CONFIRMED"
  | "ATTESTED"
  | "MINT_SUBMITTED"
  | "MINT_CONFIRMED"
  | "DEPOSIT_SUBMITTED"
  | "DEPOSIT_CONFIRMED";

export type InboundFundingAction =
  | "SUBMIT_BURN"
  | "CHECK_BURN"
  | "FETCH_ATTESTATION"
  | "SUBMIT_MINT"
  | "CHECK_MINT"
  | "APPROVE_AND_DEPOSIT"
  | "CHECK_DEPOSIT"
  | "COMPLETE";

export interface InboundFundingRoute {
  readonly protocol: "CCTP";
  readonly sourceChainId: number;
  readonly sourceDomain: number;
  readonly destinationChainId: number;
  readonly destinationDomain: number;
  readonly recipient: Address;
  readonly budgetVault: Address;
  readonly operationId: Hex;
  readonly requestedAmount: bigint;
}

export interface InboundFundingEvidence {
  readonly burnTxHash: Hex | undefined;
  readonly messageHash: Hex | undefined;
  readonly attestationHash: Hex | undefined;
  readonly mintTxHash: Hex | undefined;
  readonly receivedAmount: bigint | undefined;
  readonly depositTxHash: Hex | undefined;
  readonly depositAmount: bigint | undefined;
}

export interface InboundFundingState {
  readonly id: Hex;
  readonly stage: InboundFundingStage;
  readonly route: InboundFundingRoute;
  readonly evidence: InboundFundingEvidence;
}

export type InboundFundingEvent =
  | { readonly type: "BURN_SUBMITTED"; readonly txHash: Hex }
  | { readonly type: "BURN_CONFIRMED"; readonly txHash: Hex; readonly messageHash: Hex }
  | { readonly type: "ATTESTATION_RECEIVED"; readonly messageHash: Hex; readonly attestationHash: Hex }
  | { readonly type: "MINT_SUBMITTED"; readonly txHash: Hex }
  | { readonly type: "MINT_CONFIRMED"; readonly txHash: Hex; readonly receivedAmount: bigint }
  | { readonly type: "DEPOSIT_SUBMITTED"; readonly txHash: Hex; readonly amount: bigint }
  | { readonly type: "DEPOSIT_CONFIRMED"; readonly txHash: Hex; readonly amount: bigint };

export class InboundFundingConflictError extends Error {
  constructor(message = "Inbound funding evidence conflicts with the existing transfer") { super(message); }
}

export function createInboundFunding(route: InboundFundingRoute): InboundFundingState {
  if (route.destinationChainId !== arcMainnet.chainId && route.destinationChainId !== arcTestnet.chainId) {
    throw new Error("Inbound funding requires an Arc destination");
  }
  if (route.destinationDomain !== 26) throw new Error("Arc CCTP destination domain must be 26");
  if (!Number.isInteger(route.sourceChainId) || route.sourceChainId <= 0 || !Number.isInteger(route.sourceDomain) || route.sourceDomain < 0) {
    throw new Error("Invalid CCTP source route");
  }
  if (!isAddress(route.recipient) || !isAddress(route.budgetVault)) throw new Error("Invalid inbound funding address");
  if (!/^0x[0-9a-fA-F]{64}$/.test(route.operationId)) throw new Error("operationId must be bytes32");
  if (route.requestedAmount <= 0n) throw new Error("Inbound funding amount must be positive");
  const id = keccak256(encodeAbiParameters(
    parseAbiParameters("uint256,uint32,uint256,uint32,address,address,bytes32,uint256"),
    [
      BigInt(route.sourceChainId), route.sourceDomain, BigInt(route.destinationChainId), route.destinationDomain,
      route.recipient, route.budgetVault, route.operationId, route.requestedAmount,
    ],
  ));
  return {
    id,
    stage: "PLANNED",
    route: { ...route },
    evidence: {
      burnTxHash: undefined,
      messageHash: undefined,
      attestationHash: undefined,
      mintTxHash: undefined,
      receivedAmount: undefined,
      depositTxHash: undefined,
      depositAmount: undefined,
    },
  };
}

export function advanceInboundFunding(state: InboundFundingState, event: InboundFundingEvent): InboundFundingState {
  validateEvidence(event);
  const evidence = state.evidence;
  switch (event.type) {
    case "BURN_SUBMITTED":
      if (evidence.burnTxHash) return same(evidence.burnTxHash, event.txHash, state);
      requireStage(state, "PLANNED");
      return update(state, "BURN_SUBMITTED", { burnTxHash: event.txHash });
    case "BURN_CONFIRMED":
      if (evidence.messageHash) {
        if (evidence.burnTxHash !== event.txHash || evidence.messageHash !== event.messageHash) throw new InboundFundingConflictError();
        return state;
      }
      requireStage(state, "BURN_SUBMITTED");
      if (evidence.burnTxHash !== event.txHash) throw new InboundFundingConflictError("Burn confirmation does not match the submitted transaction");
      return update(state, "BURN_CONFIRMED", { messageHash: event.messageHash });
    case "ATTESTATION_RECEIVED":
      if (evidence.attestationHash) {
        if (evidence.messageHash !== event.messageHash || evidence.attestationHash !== event.attestationHash) throw new InboundFundingConflictError();
        return state;
      }
      requireStage(state, "BURN_CONFIRMED");
      if (evidence.messageHash !== event.messageHash) throw new InboundFundingConflictError("Attestation does not match the confirmed CCTP message");
      return update(state, "ATTESTED", { attestationHash: event.attestationHash });
    case "MINT_SUBMITTED":
      if (evidence.mintTxHash) return same(evidence.mintTxHash, event.txHash, state);
      requireStage(state, "ATTESTED");
      return update(state, "MINT_SUBMITTED", { mintTxHash: event.txHash });
    case "MINT_CONFIRMED":
      if (evidence.receivedAmount !== undefined) {
        if (evidence.mintTxHash !== event.txHash || evidence.receivedAmount !== event.receivedAmount) throw new InboundFundingConflictError();
        return state;
      }
      requireStage(state, "MINT_SUBMITTED");
      if (evidence.mintTxHash !== event.txHash || event.receivedAmount <= 0n || event.receivedAmount > state.route.requestedAmount) {
        throw new InboundFundingConflictError("Mint evidence or received amount is invalid");
      }
      return update(state, "MINT_CONFIRMED", { receivedAmount: event.receivedAmount });
    case "DEPOSIT_SUBMITTED":
      if (evidence.depositTxHash) {
        if (evidence.depositTxHash !== event.txHash || evidence.depositAmount !== event.amount) throw new InboundFundingConflictError();
        return state;
      }
      requireStage(state, "MINT_CONFIRMED");
      if (evidence.receivedAmount !== event.amount) throw new InboundFundingConflictError("Deposit must use the confirmed received amount");
      return update(state, "DEPOSIT_SUBMITTED", { depositTxHash: event.txHash, depositAmount: event.amount });
    case "DEPOSIT_CONFIRMED":
      if (state.stage === "DEPOSIT_CONFIRMED") {
        if (evidence.depositTxHash !== event.txHash || evidence.depositAmount !== event.amount) throw new InboundFundingConflictError();
        return state;
      }
      requireStage(state, "DEPOSIT_SUBMITTED");
      if (evidence.depositTxHash !== event.txHash || evidence.depositAmount !== event.amount) {
        throw new InboundFundingConflictError("Deposit confirmation does not match the submitted transaction");
      }
      return update(state, "DEPOSIT_CONFIRMED", {});
  }
}

export function budgetCreditableAmount(state: InboundFundingState): bigint {
  return state.stage === "DEPOSIT_CONFIRMED" ? (state.evidence.depositAmount ?? 0n) : 0n;
}

export function nextInboundFundingAction(state: InboundFundingState): InboundFundingAction {
  const actions: Record<InboundFundingStage, InboundFundingAction> = {
    PLANNED: "SUBMIT_BURN",
    BURN_SUBMITTED: "CHECK_BURN",
    BURN_CONFIRMED: "FETCH_ATTESTATION",
    ATTESTED: "SUBMIT_MINT",
    MINT_SUBMITTED: "CHECK_MINT",
    MINT_CONFIRMED: "APPROVE_AND_DEPOSIT",
    DEPOSIT_SUBMITTED: "CHECK_DEPOSIT",
    DEPOSIT_CONFIRMED: "COMPLETE",
  };
  return actions[state.stage];
}

function update(
  state: InboundFundingState,
  stage: InboundFundingStage,
  evidence: Partial<InboundFundingEvidence>,
): InboundFundingState {
  return { ...state, stage, evidence: { ...state.evidence, ...evidence } };
}

function requireStage(state: InboundFundingState, expected: InboundFundingStage): void {
  if (state.stage !== expected) throw new Error(`Invalid inbound funding transition: expected ${expected}, got ${state.stage}`);
}

function same<T extends string>(existing: T, incoming: T, state: InboundFundingState): InboundFundingState {
  if (existing !== incoming) throw new InboundFundingConflictError();
  return state;
}

function validateEvidence(event: InboundFundingEvent): void {
  for (const [key, value] of Object.entries(event)) {
    if ((key.endsWith("Hash") || key === "txHash") && (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value))) {
      throw new Error(`Invalid ${key}`);
    }
  }
}
