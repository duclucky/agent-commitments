import { describe, expect, it } from "vitest";
import { formatUsdc, parseUsdc, MoneyError } from "./money.js";

describe("USDC amount conversion", () => {
  it("converts decimal strings to 6-decimal atomic units without floats", () => {
    expect(parseUsdc("1")).toBe(1_000_000n);
    expect(parseUsdc("0.000001")).toBe(1n);
    expect(parseUsdc("123.450000")).toBe(123_450_000n);
  });

  it("formats atomic units deterministically", () => {
    expect(formatUsdc(123_450_000n)).toBe("123.45");
    expect(formatUsdc(1n)).toBe("0.000001");
    expect(formatUsdc(0n)).toBe("0");
  });

  it("rejects precision loss, exponent notation and negatives", () => {
    for (const value of ["0.0000001", "1e6", "-1", "", ".1"]) {
      expect(() => parseUsdc(value)).toThrow(MoneyError);
    }
  });
});
