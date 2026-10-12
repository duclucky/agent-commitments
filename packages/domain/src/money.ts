export class MoneyError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "MoneyError";
  }
}

const USDC_DECIMALS = 6;
const USDC_SCALE = 1_000_000n;

export function parseUsdc(value: string): bigint {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) throw new MoneyError("INVALID_USDC_AMOUNT");
  const whole = BigInt(match[1] ?? "0");
  const fraction = (match[2] ?? "").padEnd(USDC_DECIMALS, "0");
  return whole * USDC_SCALE + BigInt(fraction || "0");
}

export function formatUsdc(atomic: bigint): string {
  if (atomic < 0n) throw new MoneyError("INVALID_USDC_AMOUNT");
  const whole = atomic / USDC_SCALE;
  const fraction = (atomic % USDC_SCALE).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
