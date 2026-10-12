import type { Hex } from "viem";

export type LedgerEventKind = "DEPOSITED" | "RESERVED" | "CANCELLED" | "FUNDED" | "SETTLED" | "REFUNDED" | "WITHDRAWN";

export interface ChainEvent {
  readonly chainId: number;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly transactionIndex: number;
  readonly logIndex: number;
  readonly txHash: Hex;
  readonly kind: LedgerEventKind;
  readonly amount: bigint;
}

export interface ProjectionLedger {
  deposited: bigint;
  available: bigint;
  reserved: bigint;
  inEscrow: bigint;
  settled: bigint;
  withdrawn: bigint;
}

const emptyLedger = (): ProjectionLedger => ({ deposited: 0n, available: 0n, reserved: 0n, inEscrow: 0n, settled: 0n, withdrawn: 0n });

export class ChainProjection {
  private events = new Map<string, ChainEvent>();
  private ledger = emptyLedger();

  ingest(incoming: readonly ChainEvent[]): void {
    for (const event of incoming) this.events.set(`${event.chainId}:${event.txHash}:${event.logIndex}`, event);
    this.replay();
  }

  rebuild(events: readonly ChainEvent[]): void {
    this.events.clear();
    this.ingest(events);
  }

  snapshot(): ProjectionLedger { return { ...this.ledger }; }
  eventCount(): number { return this.events.size; }

  private replay(): void {
    this.ledger = emptyLedger();
    const ordered = [...this.events.values()].sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
      if (a.transactionIndex !== b.transactionIndex) return a.transactionIndex - b.transactionIndex;
      return a.logIndex - b.logIndex;
    });
    for (const event of ordered) this.apply(event);
    const { deposited, available, reserved, inEscrow, settled, withdrawn } = this.ledger;
    if (deposited !== available + reserved + inEscrow + settled + withdrawn) throw new Error("Projection conservation violated");
  }

  private apply(event: ChainEvent): void {
    const amount = event.amount;
    switch (event.kind) {
      case "DEPOSITED": this.ledger.deposited += amount; this.ledger.available += amount; break;
      case "RESERVED": this.take("available", amount); this.ledger.reserved += amount; break;
      case "CANCELLED": this.take("reserved", amount); this.ledger.available += amount; break;
      case "FUNDED": this.take("reserved", amount); this.ledger.inEscrow += amount; break;
      case "SETTLED": this.take("inEscrow", amount); this.ledger.settled += amount; break;
      case "REFUNDED": this.take("inEscrow", amount); this.ledger.available += amount; break;
      case "WITHDRAWN": this.take("available", amount); this.ledger.withdrawn += amount; break;
    }
  }

  private take(bucket: "available" | "reserved" | "inEscrow", amount: bigint): void {
    if (this.ledger[bucket] < amount) throw new Error(`Projection underflow in ${bucket}`);
    this.ledger[bucket] -= amount;
  }
}
