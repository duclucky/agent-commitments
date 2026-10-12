import { describe, expect, it } from "vitest";
import { ChainProjection, type ChainEvent } from "./projection.js";

const events: ChainEvent[] = [
  { chainId: 31337, blockNumber: 3n, blockHash: "0xa3", transactionIndex: 0, logIndex: 1, txHash: "0x03", kind: "FUNDED", amount: 40n },
  { chainId: 31337, blockNumber: 4n, blockHash: "0xa4", transactionIndex: 0, logIndex: 0, txHash: "0x04", kind: "SETTLED", amount: 40n },
  { chainId: 31337, blockNumber: 1n, blockHash: "0xa1", transactionIndex: 0, logIndex: 0, txHash: "0x01", kind: "DEPOSITED", amount: 100n },
  { chainId: 31337, blockNumber: 2n, blockHash: "0xa2", transactionIndex: 1, logIndex: 0, txHash: "0x02", kind: "RESERVED", amount: 40n },
];

describe("chain projection", () => {
  it("deduplicates and orders events before rebuilding accounting", () => {
    const projection = new ChainProjection();
    projection.ingest([...events, events[1]!]);
    expect(projection.snapshot()).toEqual({ deposited: 100n, available: 60n, reserved: 0n, inEscrow: 0n, settled: 40n, withdrawn: 0n });

    const rebuilt = new ChainProjection();
    rebuilt.rebuild([...events].reverse());
    expect(rebuilt.snapshot()).toEqual(projection.snapshot());
    expect(rebuilt.eventCount()).toBe(4);
  });
});
