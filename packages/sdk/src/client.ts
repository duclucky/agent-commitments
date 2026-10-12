import { encodeFunctionData, type Address, type Hex } from "viem";
import { arcTestnet, arcTestnetDeployment, arcMainnetPilotDeployment, networkForChain } from "@agent-commitments/network-config";
import { adapterAbi, agenticCommerceAbi, budgetVaultAbi, erc20Abi } from "./abi.js";
import type { Quote } from "./quote.js";

export type TransportState = "PREPARED" | "SUBMITTED" | "UNKNOWN" | "CONFIRMED" | "REVERTED";
export type EconomicStatus = "NONE" | "RESERVED" | "FUNDED" | "SETTLED" | "REFUNDED" | "CANCELLED" | "UNKNOWN";
export type EscrowStatus = "OPEN" | "FUNDED" | "SUBMITTED" | "COMPLETED" | "REJECTED" | "EXPIRED" | "UNKNOWN";
export type RecoveryAction =
  | "DISPATCH"
  | "SET_PROVIDER_BUDGET"
  | "FUND"
  | "CANCEL_RESERVATION"
  | "WAIT_FOR_ESCROW"
  | "RECONCILE"
  | "INSPECT_ESCROW"
  | "CHECK_TRANSACTION";

export interface PreparedCall { readonly chainId: number; readonly to: Address; readonly data: Hex; readonly value: 0n }
export interface ExternalSigner { sendTransaction(call: PreparedCall): Promise<Hex> }
export interface ContractReadRequest {
  readonly address: Address;
  readonly abi: readonly unknown[];
  readonly functionName: string;
  readonly args?: readonly unknown[];
  readonly blockNumber?: bigint | undefined;
}
export interface ChainReader {
  readContract(request: ContractReadRequest): Promise<unknown>;
  getTransactionReceipt(request: { hash: Hex }): Promise<{ status: "success" | "reverted" } | undefined>;
  getBlockNumber?: (() => Promise<bigint>) | undefined;
  simulateContract?: ((request: ContractReadRequest) => Promise<unknown>) | undefined;
}

export interface ViemPublicClientLike {
  readContract(request: ContractReadRequest): Promise<unknown>;
  getTransactionReceipt(request: { hash: Hex }): Promise<{ status: "success" | "reverted" }>;
  getBlockNumber?: (() => Promise<bigint>) | undefined;
  simulateContract?: ((request: ContractReadRequest) => Promise<unknown>) | undefined;
}

export function createViemChainReader(client: ViemPublicClientLike): ChainReader {
  return {
    readContract: (request) => client.readContract(request),
    getBlockNumber: client.getBlockNumber ? () => client.getBlockNumber!() : undefined,
    simulateContract: client.simulateContract ? (request) => client.simulateContract!(request) : undefined,
    getTransactionReceipt: async (request) => {
      try {
        const receipt = await client.getTransactionReceipt(request);
        return { status: receipt.status };
      } catch (error) {
        if (error instanceof Error && error.name === "TransactionReceiptNotFoundError") return undefined;
        throw error;
      }
    },
  };
}

export interface CommitmentInspection {
  readonly economicState: number;
  readonly economicStatus: EconomicStatus;
  readonly transportState: TransportState;
  readonly observedAt: string;
  readonly observedBlock?: bigint | undefined;
  readonly ledger: unknown;
  readonly reservation: unknown;
  readonly jobId?: bigint | undefined;
  readonly escrowStatus?: EscrowStatus | undefined;
  readonly escrowJob?: unknown | undefined;
  readonly recoveryActions: readonly RecoveryAction[];
}

export interface RefundRecoveryInspection {
  readonly commitmentId: Hex;
  readonly commitment: CommitmentInspection;
  readonly amount?: bigint | undefined;
  readonly state: "REFUNDED" | "AWAITING_ESCROW" | "READY" | "BLOCKED" | "UNKNOWN" | "NOT_APPLICABLE";
  readonly reason?: "TRANSACTION_PENDING" | "SIMULATION_UNAVAILABLE" | "SIMULATION_REVERTED" | "INVALID_EVIDENCE" | "SNAPSHOT_UNAVAILABLE" | undefined;
}

export interface VaultFundingInspection {
  readonly physicalBalance: bigint;
  readonly recordedBacking: bigint;
  readonly unassignedBalance: bigint;
  readonly backingShortfall: bigint;
  readonly observedAt: string;
  readonly observedBlock?: bigint | undefined;
}

export interface BudgetPolicyInspection {
  readonly depositCap: bigint;
  readonly maxCommitmentAmount: bigint;
  readonly maxConcurrentCommitments: bigint;
  readonly activeCommitments: bigint;
  readonly providerAllowed: boolean;
  readonly evaluatorAllowed: boolean;
  readonly observedAt: string;
}

export class AgentCommitmentsClient {
  readonly token: Address;
  constructor(
    readonly chainId: number,
    readonly vault: Address,
    readonly adapter: Address,
    private readonly reader?: ChainReader,
    readonly escrow?: Address,
  ) {
    this.token = networkForChain(chainId).usdc;
  }

  prepareGrant(args: {
    grantId: Hex;
    parentId: Hex;
    grantee: Address;
    cap: bigint;
    expiresAt: bigint;
    providers?: readonly Address[];
    evaluators?: readonly Address[];
  }): PreparedCall {
    return this.call(this.vault, budgetVaultAbi, "createGrant", [
      args.grantId,
      args.parentId,
      args.grantee,
      args.cap,
      args.expiresAt,
      args.providers ?? [],
      args.evaluators ?? [],
    ]);
  }

  prepareDeposit(amount: bigint): PreparedCall { return this.call(this.vault, budgetVaultAbi, "deposit", [amount]); }
  prepareDepositApproval(amount: bigint): PreparedCall { return this.call(this.token, erc20Abi, "approve", [this.vault, amount]); }
  prepareSetPaused(value: boolean): PreparedCall { return this.call(this.vault, budgetVaultAbi, "setPaused", [value]); }

  prepareRevoke(grantId: Hex): PreparedCall { return this.call(this.vault, budgetVaultAbi, "revokeGrant", [grantId]); }

  prepareReserve(quote: Quote, providerSignature: Hex): PreparedCall {
    return this.call(this.vault, budgetVaultAbi, "reserve", [quote, providerSignature]);
  }

  prepareDispatch(commitmentId: Hex): PreparedCall { return this.call(this.adapter, adapterAbi, "dispatch", [commitmentId]); }
  prepareProviderBudget(jobId: bigint, amount: bigint, escrow?: Address): PreparedCall {
    return this.call(this.requireEscrow(escrow), agenticCommerceAbi, "setBudget", [jobId, amount, "0x"]);
  }
  prepareSubmit(jobId: bigint, deliverable: Hex, escrow?: Address): PreparedCall {
    return this.call(this.requireEscrow(escrow), agenticCommerceAbi, "submit", [jobId, deliverable, "0x"]);
  }
  prepareComplete(jobId: bigint, reason: Hex, escrow?: Address): PreparedCall {
    return this.call(this.requireEscrow(escrow), agenticCommerceAbi, "complete", [jobId, reason, "0x"]);
  }
  prepareReject(jobId: bigint, reason: Hex, escrow?: Address): PreparedCall {
    return this.call(this.requireEscrow(escrow), agenticCommerceAbi, "reject", [jobId, reason, "0x"]);
  }
  prepareClaimRefund(jobId: bigint, escrow?: Address): PreparedCall {
    return this.call(this.requireEscrow(escrow), agenticCommerceAbi, "claimRefund", [jobId]);
  }
  prepareFund(commitmentId: Hex): PreparedCall { return this.call(this.adapter, adapterAbi, "fund", [commitmentId]); }
  prepareReconcile(commitmentId: Hex): PreparedCall { return this.call(this.adapter, adapterAbi, "reconcile", [commitmentId]); }
  prepareCancelReservation(commitmentId: Hex): PreparedCall { return this.call(this.vault, budgetVaultAbi, "cancelReservation", [commitmentId]); }
  prepareWithdrawAvailable(recipient: Address, amount: bigint): PreparedCall { return this.call(this.vault, budgetVaultAbi, "withdrawAvailable", [recipient, amount]); }

  async submit(call: PreparedCall, signer: ExternalSigner): Promise<{ hash: Hex; state: "SUBMITTED" }> {
    if (call.chainId !== this.chainId) throw new Error("Prepared call chain mismatch");
    return { hash: await signer.sendTransaction(call), state: "SUBMITTED" };
  }

  async inspect(commitmentId: Hex, transactionHash?: Hex): Promise<CommitmentInspection> {
    if (!this.reader) throw new Error("A chain reader is required for inspect");
    const blockNumber = await this.reader.getBlockNumber?.();
    const [ledger, reservation, rawJobId, receipt] = await Promise.all([
      this.reader.readContract({ address: this.vault, abi: budgetVaultAbi, functionName: "ledger", blockNumber }),
      this.reader.readContract({ address: this.vault, abi: budgetVaultAbi, functionName: "reservations", args: [commitmentId], blockNumber }),
      this.reader.readContract({ address: this.adapter, abi: adapterAbi, functionName: "jobs", args: [commitmentId], blockNumber }),
      transactionHash ? this.reader.getTransactionReceipt({ hash: transactionHash }) : Promise.resolve(undefined),
    ]);
    const record = reservation as { status?: number | bigint };
    const economicState = Number(record.status ?? 0);
    const economicStatus = economicStatusFor(economicState);
    const jobId = typeof rawJobId === "bigint" && rawJobId > 0n ? rawJobId : undefined;
    const escrowJob = jobId && this.escrow
      ? await this.reader.readContract({ address: this.escrow, abi: agenticCommerceAbi, functionName: "getJob", args: [jobId], blockNumber })
      : undefined;
    const escrowRecord = escrowJob as { status?: number | bigint; budget?: bigint } | undefined;
    const escrowStatus = escrowRecord?.status === undefined ? undefined : escrowStatusFor(Number(escrowRecord.status));
    const transportState = transactionHash
      ? (receipt ? (receipt.status === "success" ? "CONFIRMED" : "REVERTED") : "UNKNOWN")
      : "PREPARED";
    return {
      economicState,
      economicStatus,
      transportState,
      observedAt: new Date().toISOString(),
      observedBlock: blockNumber,
      ledger,
      reservation,
      jobId,
      escrowStatus,
      escrowJob,
      recoveryActions: recoveryActionsFor({ economicStatus, jobId, escrowStatus, budget: escrowRecord?.budget, transactionPending: Boolean(transactionHash && !receipt) }),
    };
  }

  /** Read-only check: simulation success does not mean tokens have been refunded. */
  async inspectRefundRecovery(commitmentId: Hex, transactionHash?: Hex): Promise<RefundRecoveryInspection> {
    const commitment = await this.inspect(commitmentId, transactionHash);
    const amount = (commitment.reservation as { amount?: bigint }).amount;
    const result = { commitmentId, commitment, amount };
    if (commitment.economicStatus === "REFUNDED") return { ...result, state: "REFUNDED" };
    if (commitment.economicStatus !== "FUNDED") return { ...result, state: "NOT_APPLICABLE" };
    if (transactionHash && commitment.transportState === "UNKNOWN") {
      return { ...result, state: "UNKNOWN", reason: "TRANSACTION_PENDING" };
    }
    if (commitment.escrowStatus === "FUNDED" || commitment.escrowStatus === "SUBMITTED") {
      return { ...result, state: "AWAITING_ESCROW" };
    }
    if (commitment.escrowStatus === "COMPLETED") return { ...result, state: "NOT_APPLICABLE" };
    if ((commitment.escrowStatus !== "REJECTED" && commitment.escrowStatus !== "EXPIRED")
      || typeof amount !== "bigint" || amount <= 0n) {
      return { ...result, state: "UNKNOWN", reason: "INVALID_EVIDENCE" };
    }
    if (commitment.observedBlock === undefined) return { ...result, state: "UNKNOWN", reason: "SNAPSHOT_UNAVAILABLE" };
    if (!this.reader?.simulateContract) return { ...result, state: "UNKNOWN", reason: "SIMULATION_UNAVAILABLE" };
    try {
      await this.reader.simulateContract({
        address: this.adapter, abi: adapterAbi, functionName: "reconcile", args: [commitmentId],
        blockNumber: commitment.observedBlock,
      });
      return { ...result, state: "READY" };
    } catch (error) {
      return contractReverted(error)
        ? { ...result, state: "BLOCKED", reason: "SIMULATION_REVERTED" }
        : { ...result, state: "UNKNOWN", reason: "SIMULATION_UNAVAILABLE" };
    }
  }

  /** Prepare only. Recheck before retry; retain the economic ID and never create a new payment. */
  async prepareRefundReconciliation(commitmentId: Hex, transactionHash?: Hex): Promise<PreparedCall> {
    const recovery = await this.inspectRefundRecovery(commitmentId, transactionHash);
    if (recovery.state !== "READY") throw new Error(`Refund is not ready: ${recovery.reason ?? recovery.state}`);
    return this.prepareReconcile(commitmentId);
  }

  async inspectVaultFunding(): Promise<VaultFundingInspection> {
    if (!this.reader) throw new Error("A chain reader is required for inspectVaultFunding");
    const blockNumber = await this.reader.getBlockNumber?.();
    if (blockNumber === undefined) throw new Error("Funding inspection requires a pinned block number");
    const [rawLedger, balance, decimals, token] = await Promise.all([
      this.reader.readContract({ address: this.vault, abi: budgetVaultAbi, functionName: "ledger", blockNumber }),
      this.reader.readContract({ address: this.token, abi: erc20Abi, functionName: "balanceOf", args: [this.vault], blockNumber }),
      this.reader.readContract({ address: this.token, abi: erc20Abi, functionName: "decimals", blockNumber }),
      this.reader.readContract({ address: this.vault, abi: budgetVaultAbi, functionName: "token", blockNumber }),
    ]);
    if (decimals !== 6 && decimals !== 6n) throw new Error("Funding inspection requires ERC-20 USDC with 6 decimals");
    if (typeof token !== "string" || token.toLowerCase() !== this.token.toLowerCase()) throw new Error("Vault token binding mismatch");
    const ledger = rawLedger as Record<string, unknown>;
    const values = ["deposited", "available", "reserved", "inEscrow", "settled", "withdrawn"].map((key) => ledger?.[key]);
    if (typeof balance !== "bigint" || balance < 0n || values.some((value) => typeof value !== "bigint" || value < 0n)) {
      throw new Error("Invalid funding evidence");
    }
    const [deposited, available, reserved, inEscrow, settled, withdrawn] = values as [bigint, bigint, bigint, bigint, bigint, bigint];
    if (deposited !== available + reserved + inEscrow + settled + withdrawn) throw new Error("Ledger conservation mismatch");
    // E has left the vault; it must not be subtracted again from the vault's physical balance.
    const recordedBacking = available + reserved;
    return {
      physicalBalance: balance, recordedBacking,
      unassignedBalance: balance > recordedBacking ? balance - recordedBacking : 0n,
      backingShortfall: balance < recordedBacking ? recordedBacking - balance : 0n,
      observedAt: new Date().toISOString(), observedBlock: blockNumber,
    };
  }

  async inspectPolicy(args: {
    grantId: Hex;
    provider: Address;
    evaluator: Address;
  }): Promise<BudgetPolicyInspection> {
    if (!this.reader) throw new Error("A chain reader is required for inspectPolicy");
    const [depositCap, maxCommitmentAmount, maxConcurrentCommitments, activeCommitments, providerAllowed, evaluatorAllowed] =
      await Promise.all([
        this.reader.readContract({ address: this.vault, abi: budgetVaultAbi, functionName: "depositCap" }),
        this.reader.readContract({ address: this.vault, abi: budgetVaultAbi, functionName: "maxCommitmentAmount" }),
        this.reader.readContract({ address: this.vault, abi: budgetVaultAbi, functionName: "maxConcurrentCommitments" }),
        this.reader.readContract({ address: this.vault, abi: budgetVaultAbi, functionName: "activeCommitments" }),
        this.reader.readContract({
          address: this.vault,
          abi: budgetVaultAbi,
          functionName: "isProviderAllowed",
          args: [args.grantId, args.provider],
        }),
        this.reader.readContract({
          address: this.vault,
          abi: budgetVaultAbi,
          functionName: "isEvaluatorAllowed",
          args: [args.grantId, args.evaluator],
        }),
      ]);
    if (
      typeof depositCap !== "bigint"
      || typeof maxCommitmentAmount !== "bigint"
      || typeof maxConcurrentCommitments !== "bigint"
      || typeof activeCommitments !== "bigint"
      || typeof providerAllowed !== "boolean"
      || typeof evaluatorAllowed !== "boolean"
    ) throw new Error("Vault returned an invalid budget policy");
    return {
      depositCap,
      maxCommitmentAmount,
      maxConcurrentCommitments,
      activeCommitments,
      providerAllowed,
      evaluatorAllowed,
      observedAt: new Date().toISOString(),
    };
  }

  private call(to: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[]): PreparedCall {
    return { chainId: this.chainId, to, data: encodeFunctionData({ abi, functionName, args }), value: 0n };
  }

  private requireEscrow(override?: Address): Address {
    const target = override ?? this.escrow
      ?? (this.chainId === arcTestnet.chainId ? arcTestnetDeployment.erc8183Escrow : undefined);
    if (!target) throw new Error("An ERC-8183 escrow address is required for this chain");
    return target;
  }
}

function contractReverted(error: unknown): boolean {
  let current = error;
  for (let depth = 0; current && typeof current === "object" && depth < 16; depth++) {
    const detail = current as { name?: string; cause?: unknown };
    if (detail.name === "ContractFunctionRevertedError" || detail.name === "ExecutionRevertedError") return true;
    current = detail.cause;
  }
  return false;
}

export function createArcTestnetClient(reader?: ChainReader): AgentCommitmentsClient {
  return new AgentCommitmentsClient(
    arcTestnet.chainId,
    arcTestnetDeployment.budgetVault,
    arcTestnetDeployment.erc8183Adapter,
    reader,
    arcTestnetDeployment.erc8183Escrow,
  );
}

/** Prepare-only factory for the limited mainnet pilot; no signer or authorization to spend is retained. */
export function createArcMainnetPilotClient(reader?: ChainReader): AgentCommitmentsClient {
  return new AgentCommitmentsClient(
    arcMainnetPilotDeployment.chainId,
    arcMainnetPilotDeployment.budgetVault,
    arcMainnetPilotDeployment.erc8183Adapter,
    reader,
    arcMainnetPilotDeployment.erc8183Escrow,
  );
}

function economicStatusFor(value: number): EconomicStatus {
  return (["NONE", "RESERVED", "FUNDED", "SETTLED", "REFUNDED", "CANCELLED"] as const)[value] ?? "UNKNOWN";
}

function escrowStatusFor(value: number): EscrowStatus {
  return (["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"] as const)[value] ?? "UNKNOWN";
}

function recoveryActionsFor(state: {
  economicStatus: EconomicStatus;
  jobId?: bigint | undefined;
  escrowStatus?: EscrowStatus | undefined;
  budget?: bigint | undefined;
  transactionPending: boolean;
}): RecoveryAction[] {
  const actions: RecoveryAction[] = [];
  if (state.economicStatus === "RESERVED") {
    if (!state.jobId) actions.push("DISPATCH", "CANCEL_RESERVATION");
    else if (!state.escrowStatus) actions.push("INSPECT_ESCROW");
    else if (state.escrowStatus === "OPEN" && state.budget === 0n) actions.push("SET_PROVIDER_BUDGET", "CANCEL_RESERVATION");
    else if (state.escrowStatus === "OPEN") actions.push("FUND");
    else actions.push("INSPECT_ESCROW");
  } else if (state.economicStatus === "FUNDED") {
    if (state.escrowStatus === "COMPLETED" || state.escrowStatus === "REJECTED" || state.escrowStatus === "EXPIRED") {
      actions.push("RECONCILE");
    } else actions.push("WAIT_FOR_ESCROW");
  }
  if (state.transactionPending) actions.push("CHECK_TRANSACTION");
  return actions;
}
