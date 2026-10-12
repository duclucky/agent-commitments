export interface BudgetLedger {
  readonly deposited: bigint;
  readonly available: bigint;
  readonly reserved: bigint;
  readonly inEscrow: bigint;
  readonly settled: bigint;
  readonly withdrawn: bigint;
}

export type LedgerTransition =
  | { readonly type: "deposit"; readonly amount: bigint }
  | { readonly type: "reserve"; readonly amount: bigint }
  | { readonly type: "cancel"; readonly amount: bigint }
  | { readonly type: "fund"; readonly amount: bigint }
  | { readonly type: "settle"; readonly amount: bigint }
  | { readonly type: "refund"; readonly amount: bigint }
  | { readonly type: "withdraw"; readonly amount: bigint };

export class AccountingError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AccountingError";
  }
}

export function createBudgetLedger(initialDeposit = 0n): BudgetLedger {
  if (initialDeposit < 0n) throw new AccountingError("INVALID_AMOUNT");
  return Object.freeze({
    deposited: initialDeposit,
    available: initialDeposit,
    reserved: 0n,
    inEscrow: 0n,
    settled: 0n,
    withdrawn: 0n,
  });
}

export function transitionLedger(ledger: BudgetLedger, transition: LedgerTransition): BudgetLedger {
  if (transition.amount <= 0n) throw new AccountingError("INVALID_AMOUNT");
  const next = { ...ledger };

  switch (transition.type) {
    case "deposit":
      next.deposited += transition.amount;
      next.available += transition.amount;
      break;
    case "reserve":
      requireBalance(next.available, transition.amount, "INSUFFICIENT_AVAILABLE");
      next.available -= transition.amount;
      next.reserved += transition.amount;
      break;
    case "cancel":
      requireBalance(next.reserved, transition.amount, "INSUFFICIENT_RESERVED");
      next.reserved -= transition.amount;
      next.available += transition.amount;
      break;
    case "fund":
      requireBalance(next.reserved, transition.amount, "INSUFFICIENT_RESERVED");
      next.reserved -= transition.amount;
      next.inEscrow += transition.amount;
      break;
    case "settle":
      requireBalance(next.inEscrow, transition.amount, "INSUFFICIENT_ESCROW");
      next.inEscrow -= transition.amount;
      next.settled += transition.amount;
      break;
    case "refund":
      requireBalance(next.inEscrow, transition.amount, "INSUFFICIENT_ESCROW");
      next.inEscrow -= transition.amount;
      next.available += transition.amount;
      break;
    case "withdraw":
      requireBalance(next.available, transition.amount, "INSUFFICIENT_AVAILABLE");
      next.available -= transition.amount;
      next.withdrawn += transition.amount;
      break;
  }

  assertConserved(next);
  return Object.freeze(next);
}

function requireBalance(balance: bigint, amount: bigint, code: string): void {
  if (balance < amount) throw new AccountingError(code);
}

export function assertConserved(ledger: BudgetLedger): void {
  const parts = [
    ledger.deposited,
    ledger.available,
    ledger.reserved,
    ledger.inEscrow,
    ledger.settled,
    ledger.withdrawn,
  ];
  if (parts.some((value) => value < 0n)) throw new AccountingError("NEGATIVE_BALANCE");
  if (
    ledger.deposited !==
    ledger.available + ledger.reserved + ledger.inEscrow + ledger.settled + ledger.withdrawn
  ) {
    throw new AccountingError("CONSERVATION_BROKEN");
  }
}
