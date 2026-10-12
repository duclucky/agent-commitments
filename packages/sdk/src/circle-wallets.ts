import { isHex, type Hex } from "viem";
import { arcTestnet } from "@agent-commitments/network-config";
import type { PreparedCall } from "./client.js";

/** States currently documented by Circle Wallets transaction APIs. */
export type CircleTransactionState =
  | "CANCELLED"
  | "CLEARED"
  | "COMPLETE"
  | "CONFIRMED"
  | "DENIED"
  | "FAILED"
  | "INITIATED"
  | "QUEUED"
  | "SENT"
  | "STUCK";

export type CircleExecutionPhase =
  | "PENDING"
  | "MINED"
  | "FINALIZED"
  | "TERMINAL_FAILURE"
  | "UNKNOWN";

export type CircleFeeLevel = "LOW" | "MEDIUM" | "HIGH";

export interface CircleContractExecutionRequest {
  readonly walletId: string;
  readonly contractAddress: string;
  readonly callData: Hex;
  readonly fee: {
    readonly type: "level";
    readonly config: { readonly feeLevel: CircleFeeLevel };
  };
  readonly idempotencyKey: string;
  readonly refId?: string;
}

export interface CircleTransactionRecord {
  readonly id: string;
  readonly state: CircleTransactionState;
  readonly blockchain?: string;
  readonly txHash?: string;
  readonly errorReason?: string;
  readonly errorDetails?: string;
}

/**
 * Minimal structural interface implemented by Circle's Developer-Controlled
 * Wallets client. Applications own its credentials and lifecycle.
 */
export interface CircleDeveloperWalletsClient {
  createContractExecutionTransaction(
    request: CircleContractExecutionRequest,
  ): Promise<{ readonly data?: { readonly id?: string; readonly state?: string } }>;
  getTransaction(request: {
    readonly id: string;
  }): Promise<{ readonly data?: { readonly transaction?: CircleTransactionRecord } }>;
}

export interface CircleWalletsSubmission {
  readonly transactionId: string;
  readonly circleState: CircleTransactionState;
  readonly phase: CircleExecutionPhase;
}

export interface CircleWalletsInspection extends CircleWalletsSubmission {
  readonly transactionHash?: Hex;
  readonly errorReason?: string;
  readonly errorDetails?: string;
}

export interface CircleWalletsWaitOptions {
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

const circleStates = new Set<CircleTransactionState>([
  "CANCELLED",
  "CLEARED",
  "COMPLETE",
  "CONFIRMED",
  "DENIED",
  "FAILED",
  "INITIATED",
  "QUEUED",
  "SENT",
  "STUCK",
]);

export function circleExecutionPhase(state: CircleTransactionState): CircleExecutionPhase {
  switch (state) {
    case "INITIATED":
    case "QUEUED":
    case "CLEARED":
    case "SENT":
      return "PENDING";
    case "CONFIRMED":
      return "MINED";
    case "COMPLETE":
      return "FINALIZED";
    case "CANCELLED":
    case "DENIED":
    case "FAILED":
      return "TERMINAL_FAILURE";
    case "STUCK":
      return "UNKNOWN";
  }
}

function parseState(value: string | undefined): CircleTransactionState {
  if (!value || !circleStates.has(value as CircleTransactionState)) {
    throw new Error(`Circle returned an unsupported transaction state: ${value ?? "missing"}`);
  }
  return value as CircleTransactionState;
}

export class CircleWalletsExecutor {
  private readonly feeLevel: CircleFeeLevel;

  constructor(
    private readonly circle: CircleDeveloperWalletsClient,
    private readonly walletId: string,
    options: { readonly feeLevel?: CircleFeeLevel } = {},
  ) {
    if (!walletId.trim()) throw new Error("Circle walletId is required");
    this.feeLevel = options.feeLevel ?? "MEDIUM";
  }

  async submit(
    call: PreparedCall,
    metadata: { readonly idempotencyKey: string; readonly refId?: string },
  ): Promise<CircleWalletsSubmission> {
    if (call.chainId !== arcTestnet.chainId) {
      throw new Error("Circle Wallets execution is enabled only for ARC-TESTNET; Arc mainnet support is not documented");
    }
    if (call.value !== 0n) throw new Error("Circle Wallets executor only accepts zero-value Agent Commitments calls");
    if (!metadata.idempotencyKey.trim()) throw new Error("Circle idempotencyKey is required");

    const response = await this.circle.createContractExecutionTransaction({
      walletId: this.walletId,
      contractAddress: call.to,
      callData: call.data,
      fee: { type: "level", config: { feeLevel: this.feeLevel } },
      idempotencyKey: metadata.idempotencyKey,
      ...(metadata.refId === undefined ? {} : { refId: metadata.refId }),
    });
    const transactionId = response.data?.id;
    const rawState = response.data?.state;
    if (!transactionId || !rawState) throw new Error("Circle did not return a transaction id and state");
    const circleState = parseState(rawState);
    return { transactionId, circleState, phase: circleExecutionPhase(circleState) };
  }

  async inspect(transactionId: string): Promise<CircleWalletsInspection> {
    if (!transactionId.trim()) throw new Error("Circle transaction id is required");
    const response = await this.circle.getTransaction({ id: transactionId });
    const transaction = response.data?.transaction;
    if (!transaction) throw new Error("Circle did not return a transaction");
    if (transaction.id !== transactionId) throw new Error("Circle returned a different transaction id");
    if (transaction.blockchain !== undefined && transaction.blockchain !== "ARC-TESTNET") {
      throw new Error(`Circle returned transaction for unexpected blockchain ${transaction.blockchain}`);
    }
    const circleState = parseState(transaction.state);
    const transactionHash = transaction.txHash;
    if (transactionHash !== undefined && !isHex(transactionHash)) {
      throw new Error("Circle returned an invalid transaction hash");
    }

    return {
      transactionId,
      circleState,
      phase: circleExecutionPhase(circleState),
      ...(transactionHash === undefined ? {} : { transactionHash }),
      ...(transaction.errorReason === undefined ? {} : { errorReason: transaction.errorReason }),
      ...(transaction.errorDetails === undefined ? {} : { errorDetails: transaction.errorDetails }),
    };
  }

  /**
   * Polls the transaction created earlier. This method never submits or retries
   * an onchain operation, so callers can resume it safely after a restart.
   */
  async waitForFinality(
    transactionId: string,
    options: CircleWalletsWaitOptions = {},
  ): Promise<CircleWalletsInspection> {
    const pollIntervalMs = options.pollIntervalMs ?? 1_000;
    const timeoutMs = options.timeoutMs ?? 120_000;
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
      throw new Error("Circle pollIntervalMs must be a non-negative finite number");
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new Error("Circle timeoutMs must be a non-negative finite number");
    }

    const deadline = Date.now() + timeoutMs;
    while (true) {
      if (options.signal?.aborted) throw new Error("Circle transaction polling was aborted");
      const inspection = await this.inspect(transactionId);
      if (inspection.phase === "FINALIZED" ||
          inspection.phase === "TERMINAL_FAILURE" ||
          inspection.phase === "UNKNOWN") {
        return inspection;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new Error(`Circle transaction ${transactionId} polling timed out`);
      }
      await abortableDelay(Math.min(pollIntervalMs, remainingMs), options.signal);
    }
  }
}

function abortableDelay(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  if (delayMs === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Circle transaction polling was aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
