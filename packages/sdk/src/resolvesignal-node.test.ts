import {describe,expect,it} from "vitest";
import {CircleCliResolveSignalWallet} from "./resolvesignal-node.js";
import type {ResolveSignalPaymentRequest} from "./resolvesignal-session.js";
const payment:ResolveSignalPaymentRequest={url:"https://resolvesignal.com/v2/requests/call_abc/pay",requestKey:"a".repeat(64),inputHash:"b".repeat(64),
 payer:`0x${"11".repeat(20)}`,maxAmountAtomic:60000n};
describe("Circle existing-wallet CLI adapter",()=>{
 it("pins POST, ARC and the exact 0.06 cap without using contract commands",async()=>{
  const calls:readonly string[][]=[];const mutable=calls as string[][];
  const wallet=new CircleCliResolveSignalWallet({run:async args=>{mutable.push([...args]);return {data:{response:{call_id:"call_abc"}}};}});
  expect((await wallet.pay(payment)).call_id).toBe("call_abc");
  const args=calls[0]!;expect(args.slice(0,2)).toEqual(["services","pay"]);
  expect(args[args.indexOf("-X")+1]).toBe("POST");expect(args[args.indexOf("--chain")+1]).toBe("ARC");
  expect(args[args.indexOf("--max-amount")+1]).toBe("0.060000");
  expect(args).not.toContain("execute");expect(args).not.toContain("gateway");
 });
 it("inspects before the client chooses to pay and supports stringified response JSON",async()=>{
  let verb="";const wallet=new CircleCliResolveSignalWallet({run:async args=>{verb=String(args[1]);return {data:verb==="inspect"?{status:"payable"}:{response:'{"call_id":"call_abc"}'}};}});
  expect((await wallet.inspect(payment)).status).toBe("payable");expect(verb).toBe("inspect");
  expect((await wallet.pay(payment)).call_id).toBe("call_abc");
 });
 it("rejects unsafe payment scope before invoking Circle",async()=>{
  let count=0;const wallet=new CircleCliResolveSignalWallet({run:async()=>{count++;return {};}});
  await expect(wallet.pay({...payment,url:"https://evil.test/arbitrary"})).rejects.toThrow("scope_invalid");
  await expect(wallet.pay({...payment,requestKey:"a\nmalicious"})).rejects.toThrow("scope_invalid");
  expect(count).toBe(0);
 });
 it("does not expose provider error text or retry a failed paid command",async()=>{
  let count=0;const wallet=new CircleCliResolveSignalWallet({run:async()=>{count++;return {error:{message:"private provider text"}};}});
  await expect(wallet.pay(payment)).rejects.toThrow("command_failed_use_recover");expect(count).toBe(1);
 });
 it("refuses payment typed data passed as an admission proof without opening the wallet",async()=>{
  let count=0;const wallet=new CircleCliResolveSignalWallet({run:async()=>{count++;return {};}});
  await expect(wallet.signAdmission({primaryType:"TransferWithAuthorization",domain:{name:"USDC"}},payment.payer)).rejects.toThrow("admission_scope_invalid");
  expect(count).toBe(0);
 });
});
