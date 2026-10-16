import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe,expect,it} from "vitest";
import {keccak256,type Address,type Hex} from "viem";
import {FileResolveSignalSessionStore} from "./resolvesignal-node-store.js";
import {ResolveSignalX402Session,type ResolveSignalSession,type ResolveSignalSessionStore,type ResolveSignalWallet} from "./resolvesignal-session.js";
import type {ResolveSignalReader} from "./resolvesignal.js";

const a=(n:string)=>`0x${n.repeat(40)}` as Address;
const id=`0x${"aa".repeat(32)}` as Hex,salt=`0x${"bb".repeat(32)}` as Hex;
const request={current_state:"synthetic customer input never stored"};
const seller={factory:a("3"),factoryCodeHash:keccak256("0x01"),operator:a("4"),treasury:a("5")};
const fields=[{name:"purpose",type:"string"},{name:"payer",type:"address"},{name:"inputHash",type:"bytes32"},
 {name:"requestOwner",type:"bytes32"},{name:"requestIdempotency",type:"bytes32"},{name:"nonce",type:"bytes32"},{name:"expiresAt",type:"uint64"}];
class MemoryStore implements ResolveSignalSessionStore {
 state:ResolveSignalSession|undefined;
 async load(_key:string){return this.state?structuredClone(this.state):undefined;}
 async create(_key:string,state:ResolveSignalSession){if(this.state)return false;this.state=structuredClone(state);return true;}
 async compareAndSwap(_key:string,revision:number,state:ResolveSignalSession){
  if(this.state?.revision!==revision)return false;this.state=structuredClone(state);return true;
 }
}
function harness(options:{losePayment?:boolean;badQuote?:boolean;wrongInput?:boolean;wrongTypes?:boolean;wrongInspection?:boolean;wrongChain?:boolean;loseQuote?:boolean}={}){
 let payCount=0,signCount=0,inspectCount=0,quoteCount=0;
 const typed={domain:{name:"NextCue Quote Admission",version:"1",chainId:5042,verifyingContract:seller.factory},
  primaryType:"QuoteAdmission",types:{QuoteAdmission:options.wrongTypes?[{name:"spender",type:"address"}]:fields},
  message:{purpose:"quote_admission_only_no_payment",payer:a("1"),inputHash:id,requestOwner:id,requestIdempotency:id,nonce:id,expiresAt:2000}};
 const q={call_id:"call_abc",input_hash:(options.wrongInput?salt:id).slice(2),quote_until:2000,payment_allowed:true,
  escrow:{vault:a("2"),state:"open"},payment_required:{x402Version:2,resource:{url:"https://resolvesignal.com/v2/requests/call_abc/pay"},
   accepts:[{scheme:"exact",network:"eip155:5042",asset:"0x3600000000000000000000000000000000000000",amount:options.badQuote?"60001":"60000",
    payTo:a("2"),maxTimeoutSeconds:100,extra:{name:"USDC",version:"2",assetTransferMethod:"eip3009"}}]}};
 const reader:ResolveSignalReader={getChainId:async()=>options.wrongChain?1:5042,getBlockNumber:async()=>1n,getBytecode:async()=>"0x01",
  readContract:async({functionName})=>{
   const values:Record<string,unknown>={payer:a("1"),factory:seller.factory,token:"0x3600000000000000000000000000000000000000",operator:seller.operator,
    treasury:seller.treasury,decimals:6,amount:60000n,validBefore:2000n,completeBy:2200n,status:0,callId:id,vaults:a("2")};
   return values[functionName];
  }};
 const fetcher=(async(url:unknown)=>{
  const path=String(url);let value:unknown,status=200;
  if(path.endsWith("/health"))value={status:"ok"};
  else if(path.endsWith("/v2/form"))value={mode:"live",protocol_version:"2",payment_metadata:{backend:"escrow_v3",payer_control_proof_required:true}};
  else if(path.endsWith("/payer-challenge"))value={typed_data:typed,challenge_token:"synthetic"};
  else if(path.endsWith("/v2/requests")){quoteCount++;if(options.loseQuote&&quoteCount===1)throw Error("quote response lost");value=q;status=402;}
  else value={call_id:q.call_id,status:"response_sent"};
  return new Response(JSON.stringify(value),{status});
 }) as typeof fetch;
 const wallet:ResolveSignalWallet={signAdmission:async()=>{signCount++;return `0x${"11".repeat(65)}`;},
  inspect:async()=>{inspectCount++;return {status:"payable",price:{amount:"60000"},chains:["eip155:5042"],seller:options.wrongInspection?a("9"):a("2"),scheme:"USDC"};},
  pay:async()=>{payCount++;if(options.losePayment)throw Error("network lost");return {call_id:q.call_id,input_hash:q.input_hash,result:{synthetic:true}};}};
 const store=new MemoryStore();
 return {store,wallet,reader,counts:()=>({payCount,signCount,inspectCount,quoteCount}),
  session:()=>new ResolveSignalX402Session({payer:a("1"),operationId:id,store,wallet,reader,seller,fetch:fetcher,now:()=>1900})};
}
describe("existing wallet x402 integration",()=>{
 it("calls with the existing wallet, without preparing or broadcasting a contract transaction",async()=>{
  const h=harness(),opts={salt,maxFeeAtomic:60000n,confirmPaidCall:true};
  const result=await h.session().call(request,opts);expect(result.result).toEqual({synthetic:true});
  await expect(h.session().call(request,opts)).rejects.toThrow("payment_already_attempted");
  expect(h.counts()).toEqual({payCount:1,signCount:1,inspectCount:1,quoteCount:1});
  expect(JSON.stringify(h.store.state)).not.toContain(request.current_state);
  expect(JSON.stringify(h.store.state)).not.toContain('"result"');
 });
 it("does not buy again after a lost paid response and restart",async()=>{
  const h=harness({losePayment:true}),opts={salt,maxFeeAtomic:60000n,confirmPaidCall:true};
  await expect(h.session().call(request,opts)).rejects.toThrow("network lost");
  await expect(h.session().call(request,opts)).rejects.toThrow("payment_already_attempted");
  expect((await h.session().recover()).paymentAttempted).toBe(true);
  expect(h.counts().payCount).toBe(1);
 });
 it.each([
  ["badQuote","quote_binding_invalid"],["wrongInput","quote_input_mismatch"],["wrongTypes","admission_types_invalid"],
  ["wrongInspection","inspection_mismatch"],["wrongChain","chain_mismatch"],
 ] as const)("rejects %s before spending",async(key,error)=>{
  const h=harness({[key]:true});
  await expect(h.session().call(request,{salt,maxFeeAtomic:60000n,confirmPaidCall:true})).rejects.toThrow(error);
  expect(h.counts().payCount).toBe(0);
 });
 it("requires explicit spending scope before wallet use",async()=>{
  const h=harness();await expect(h.session().call(request,{salt,maxFeeAtomic:60000n,confirmPaidCall:false})).rejects.toThrow("not_confirmed");
  expect(h.counts().signCount).toBe(0);
 });
 it("reuses the same unpaid request after an explicit quote resume",async()=>{
  const h=harness({loseQuote:true}),opts={salt,maxFeeAtomic:60000n,confirmPaidCall:true};
  await expect(h.session().call(request,opts)).rejects.toThrow("quote response lost");
  const keys={key:h.store.state!.requestKey,idem:h.store.state!.idempotencyKey};
  await expect(h.session().call(request,opts)).rejects.toThrow("quote_outcome_unknown");
  await h.session().call(request,{...opts,resumeQuote:true});
  expect(h.store.state!.requestKey).toBe(keys.key);expect(h.store.state!.idempotencyKey).toBe(keys.idem);
  expect(h.counts().payCount).toBe(1);
 });
 it("refuses changed business input under the same operation",async()=>{
  const h=harness({loseQuote:true}),opts={salt,maxFeeAtomic:60000n,confirmPaidCall:true};
  await expect(h.session().call(request,opts)).rejects.toThrow();
  await expect(h.session().call({current_state:"changed"},{...opts,resumeQuote:true})).rejects.toThrow("request_changed");
  expect(h.counts().payCount).toBe(0);
 });
 it("fails closed on a concurrent state change",async()=>{
  const h=harness();h.store.compareAndSwap=async()=>false;
  await expect(h.session().call(request,{salt,maxFeeAtomic:60000n,confirmPaidCall:true})).rejects.toThrow("concurrent_session_change");
  expect(h.counts().payCount).toBe(0);
 });
 it("two concurrent clients cannot both submit the same purchase",async()=>{
  const h=harness(),opts={salt,maxFeeAtomic:60000n,confirmPaidCall:true};
  const results=await Promise.allSettled([h.session().call(request,opts),h.session().call(request,opts)]);
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect(h.counts().payCount).toBe(1);
 });
 it("a persistence failure prevents the payment side effect",async()=>{
  const h=harness();const save=h.store.compareAndSwap.bind(h.store);
  h.store.compareAndSwap=async(key,revision,state)=>state.paymentAttempted?false:save(key,revision,state);
  await expect(h.session().call(request,{salt,maxFeeAtomic:60000n,confirmPaidCall:true})).rejects.toThrow("concurrent_session_change");
  expect(h.counts().payCount).toBe(0);
 });
 it("snapshots business input before asynchronous wallet and HTTP work",async()=>{
  const h=harness();const input={...request};
  h.reader.getChainId=async()=>{input.current_state="changed while pending";return 5042;};
  await h.session().call(input,{salt,maxFeeAtomic:60000n,confirmPaidCall:true});
  const {resolveSignalWorkHash}=await import("./resolvesignal.js");
  expect(h.store.state?.workHash).toBe(resolveSignalWorkHash(request,salt));
 });
});

it("private file store survives restart and enforces CAS",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"commitments-session-"));
 try{
  const h=harness();h.store.create=async(key,state)=>new FileResolveSignalSessionStore(directory).create(key,state);
  h.store.load=async(key)=>new FileResolveSignalSessionStore(directory).load(key);
  h.store.compareAndSwap=async(key,revision,state)=>new FileResolveSignalSessionStore(directory).compareAndSwap(key,revision,state);
  await h.session().call(request,{salt,maxFeeAtomic:60000n,confirmPaidCall:true});
  await expect(h.session().call(request,{salt,maxFeeAtomic:60000n,confirmPaidCall:true})).rejects.toThrow("payment_already_attempted");
  const state=await h.store.load(h.session().key);expect(state?.paymentAttempted).toBe(true);
  expect(await h.store.compareAndSwap(h.session().key,0,{...state!,revision:1})).toBe(false);
 }finally{await rm(directory,{recursive:true,force:true});}
});
