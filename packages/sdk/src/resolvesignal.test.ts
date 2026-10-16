import { describe, expect, it } from "vitest";
import { canonicalRequest, resolveSignalWorkHash, validateResolveSignalQuote, type ResolveSignalBinding, type ResolveSignalQuote } from "./resolvesignal.js";

const addr = (n: string) => `0x${n.repeat(40)}` as `0x${string}`;
const binding: ResolveSignalBinding = {
  payer: addr("1"), escrow: addr("2"), factory: addr("3"), token: "0x3600000000000000000000000000000000000000",
  operator: addr("4"), treasury: addr("5"), amount: 60000n, validBefore: 2000n, completeBy: 2200n,
  status: 0, factoryVault: addr("2"),
};
const quote = ():ResolveSignalQuote => ({
  call_id: "call_abc", input_hash: "a".repeat(64), quote_until: 2000, payment_allowed: true,
  escrow: {vault:addr("2"), state:"open"},
  payment_required: {x402Version:2, resource:{url:"https://resolvesignal.com/v2/requests/call_abc/pay"},
    accepts:[{scheme:"exact",network:"eip155:5042",asset:binding.token,amount:"60000",payTo:addr("2"),
      maxTimeoutSeconds:100,extra:{name:"USDC",version:"2",assetTransferMethod:"eip3009"}}]},
});

describe("ResolveSignal quote binding", () => {
  it("accepts the exact funded payer and fee", () => {
    expect(validateResolveSignalQuote(quote(), binding, {
      baseUrl:"https://resolvesignal.com",factory:binding.factory,operator:binding.operator,treasury:binding.treasury,
      payer:binding.payer,amount:60000n,maxFeeAtomic:60000n,now:1900,
    }).amount).toBe("60000");
  });
  it("accepts an unexpired quote after time spent confirming registration", () => {
    expect(validateResolveSignalQuote(quote(), binding, {
      baseUrl:"https://resolvesignal.com",factory:binding.factory,operator:binding.operator,treasury:binding.treasury,
      payer:binding.payer,amount:60000n,maxFeeAtomic:60000n,now:1910,
    }).amount).toBe("60000");
  });
  it.each(["network","asset","amount","payTo"])("rejects substituted %s before authorization", key => {
    const q = quote(); Object.assign(q.payment_required.accepts[0]!, {[key]:"malicious"});
    expect(() => validateResolveSignalQuote(q, binding, {baseUrl:"https://resolvesignal.com",factory:binding.factory,
      operator:binding.operator,treasury:binding.treasury,payer:binding.payer,amount:60000n,maxFeeAtomic:60000n,now:1900})).toThrow();
  });
  it("does not accept HTTP proof without a matching onchain payer", () => {
    expect(() => validateResolveSignalQuote(quote(), {...binding,payer:addr("9")}, {baseUrl:"https://resolvesignal.com",
      factory:binding.factory,operator:binding.operator,treasury:binding.treasury,payer:binding.payer,
      amount:60000n,maxFeeAtomic:60000n,now:1900})).toThrow();
  });
});

describe("private work binding", () => {
  it("canonicalizes object order but preserves business values and salt", () => {
    const salt=`0x${"11".repeat(32)}` as const;
    expect(resolveSignalWorkHash({b:2,a:[1]},salt)).toBe(resolveSignalWorkHash({a:[1],b:2},salt));
    expect(resolveSignalWorkHash({a:[1],b:2},salt)).not.toBe(resolveSignalWorkHash({a:[2],b:2},salt));
    expect(resolveSignalWorkHash({a:[1],b:2},salt)).not.toBe(resolveSignalWorkHash({a:[1],b:2},`0x${"22".repeat(32)}`));
  });
  it("rejects ambiguous sparse arrays and non-JSON values", () => {
    expect(()=>canonicalRequest(Array(1))).toThrow("not_json");
    expect(()=>canonicalRequest({value:undefined})).toThrow("not_json");
    expect(()=>canonicalRequest({value:NaN})).toThrow("not_json");
  });
});
