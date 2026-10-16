import {keccak256,stringToHex,type Address,type Hex} from "viem";
import {RESOLVESIGNAL_SELLER,canonicalRequest,readResolveSignalBinding,resolveSignalWorkHash,
 validateResolveSignalAdmission,validateResolveSignalQuote,verifyResolveSignalSeller,
 type ResolveSignalQuote,type ResolveSignalReader,type ResolveSignalSeller} from "./resolvesignal.js";

export interface ResolveSignalPaymentRequest {
 url:string;requestKey:string;inputHash:string;payer:Address;maxAmountAtomic:bigint;
}
export interface ResolveSignalWalletInspection {
 status:string;price?:{amount:string};chains?:string[];seller?:string;scheme?:string;
}
/** Existing wallet custody/signing boundary. No vault funding or contract execution. */
export interface ResolveSignalWallet {
 signAdmission(typedData:Record<string,any>,payer:Address):Promise<Hex>;
 inspect(request:ResolveSignalPaymentRequest):Promise<ResolveSignalWalletInspection>;
 pay(request:ResolveSignalPaymentRequest):Promise<Record<string,any>>;
}
export interface ResolveSignalSession {
 version:2;revision:number;operationId:Hex;configHash:Hex;payer:Address;salt:Hex;workHash:Hex;
 requestKey:string;idempotencyKey:string;
 challenge?:{typed_data:Record<string,any>;challenge_token:string};admissionSignature?:Hex;
 quoteAttempted?:boolean;quote?:ResolveSignalQuote;paymentAttempted?:boolean;
}
/** Private durable atomic create/CAS. Never store business input or result here. */
export interface ResolveSignalSessionStore {
 load(key:string):Promise<ResolveSignalSession|undefined>;
 create(key:string,value:ResolveSignalSession):Promise<boolean>;
 compareAndSwap(key:string,revision:number,value:ResolveSignalSession):Promise<boolean>;
}
export interface ResolveSignalSessionOptions {
 payer:Address;operationId:Hex;wallet:ResolveSignalWallet;store:ResolveSignalSessionStore;
 reader:ResolveSignalReader;seller?:ResolveSignalSeller;baseUrl?:string;fetch?:typeof fetch;now?:()=>number;
}
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const random=(bytes:number)=>[...crypto.getRandomValues(new Uint8Array(bytes))].map(v=>v.toString(16).padStart(2,"0")).join("");
const base64=(v:unknown)=>btoa(Array.from(new TextEncoder().encode(JSON.stringify(v)),b=>String.fromCharCode(b)).join(""));

export class ResolveSignalX402Session {
 readonly baseUrl:string;
 readonly key:string;
 readonly seller:ResolveSignalSeller;
 private readonly configHash:Hex;
 private readonly fetcher:typeof fetch;
 private readonly now:()=>number;
 constructor(readonly options:ResolveSignalSessionOptions){
  const url=new URL(options.baseUrl??"https://resolvesignal.com");
  if((url.protocol!=="https:" && !(url.protocol==="http:" && ["127.0.0.1","localhost"].includes(url.hostname))) ||
   url.username || url.password || url.search || url.hash || url.pathname!=="/")throw Error("resolvesignal_origin_invalid");
  if(!/^0x[0-9a-fA-F]{64}$/.test(options.operationId) || !/^0x[0-9a-fA-F]{40}$/.test(options.payer) || /^0x0{40}$/i.test(options.payer))throw Error("resolvesignal_operation_or_payer_invalid");
  this.baseUrl=url.origin;this.seller={...(options.seller??RESOLVESIGNAL_SELLER)};
  this.fetcher=options.fetch??fetch;this.now=options.now??(()=>Math.floor(Date.now()/1000));
  this.configHash=keccak256(stringToHex(canonicalRequest({baseUrl:this.baseUrl,payer:options.payer.toLowerCase(),seller:this.seller})));
  this.key=`5042:${this.baseUrl}:${options.payer.toLowerCase()}:${options.operationId.toLowerCase()}`;
 }
 private async save(state:ResolveSignalSession,patch:Partial<ResolveSignalSession>){
  const next={...state,...patch,revision:state.revision+1};
  if(!await this.options.store.compareAndSwap(this.key,state.revision,next))throw Error("resolvesignal_concurrent_session_change");
  return next;
 }
 private async load(){
  const s=await this.options.store.load(this.key);
  if(s && (s.version!==2 || s.configHash!==this.configHash || !same(s.operationId,this.options.operationId) || !same(s.payer,this.options.payer) ||
   !Number.isSafeInteger(s.revision) || !/^[0-9a-f]{64}$/.test(s.requestKey) || !/^[0-9a-f]{48}$/.test(s.idempotencyKey)))throw Error("resolvesignal_recovery_binding_invalid");
  return s;
 }
 private headers(s:ResolveSignalSession){return {"X-Request-Key":s.requestKey,"Idempotency-Key":s.idempotencyKey,"X-Payer-Address":s.payer};}
 private async http(path:string,method="GET",body?:unknown,headers:Record<string,string>={}){
  const r=await this.fetcher(this.baseUrl+path,{method,redirect:"error",signal:AbortSignal.timeout(90_000),
   headers:{"content-type":"application/json",...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const value=await r.json() as Record<string,any>;return {status:r.status,value};
 }
 async call(input:unknown,opts:{salt:Hex;maxFeeAtomic:bigint;confirmPaidCall:boolean;resumeQuote?:boolean}){
  if(!opts.confirmPaidCall)throw Error("resolvesignal_paid_call_not_confirmed");
  if(typeof opts.maxFeeAtomic!=="bigint" || opts.maxFeeAtomic<=0n)throw Error("resolvesignal_fee_cap_invalid");
  // Freeze the JSON value across async wallet/network boundaries.
  const request=JSON.parse(canonicalRequest(input));
  let s=await this.load();
  if(s?.paymentAttempted)throw Error("resolvesignal_payment_already_attempted_use_recover");
  const workHash=resolveSignalWorkHash(request,opts.salt);
  if(s && !same(s.workHash,workHash))throw Error("resolvesignal_request_changed");
  await verifyResolveSignalSeller(this.options.reader,this.seller);
  if(!s){
   s={version:2,revision:0,operationId:this.options.operationId,configHash:this.configHash,payer:this.options.payer,
    salt:opts.salt,workHash,requestKey:random(32),idempotencyKey:random(24)};
   if(!await this.options.store.create(this.key,s))throw Error("resolvesignal_session_already_exists");
  }
  const health=await this.http("/health"),form=await this.http("/v2/form");
  if(health.status!==200 || health.value.status!=="ok" || form.status!==200 || form.value.mode!=="live" ||
   String(form.value.protocol_version)!=="2" || form.value.payment_metadata?.backend!=="escrow_v3" ||
   form.value.payment_metadata?.payer_control_proof_required!==true)throw Error("resolvesignal_service_not_ready");
  if(!s.quote){
   if(s.quoteAttempted && !opts.resumeQuote)throw Error("resolvesignal_quote_outcome_unknown_resume_same_request");
   if(!s.challenge){
    const c=await this.http("/v2/payer-challenge","POST",request,this.headers(s));
    if(c.status!==200 || typeof c.value.challenge_token!=="string")throw Error("resolvesignal_challenge_invalid");
    validateResolveSignalAdmission(c.value.typed_data,s.payer,this.seller.factory,this.now());
    s=await this.save(s,{challenge:{typed_data:c.value.typed_data,challenge_token:c.value.challenge_token}});
   }
   validateResolveSignalAdmission(s.challenge!.typed_data,s.payer,this.seller.factory,this.now());
   if(!s.admissionSignature){
    // Claim the session before using the wallet; competing callers fail CAS.
    s=await this.save(s,{});
    const signature=await this.options.wallet.signAdmission(s.challenge!.typed_data,s.payer);
    if(!/^0x(?:[0-9a-fA-F]{2}){1,8192}$/.test(signature))throw Error("resolvesignal_admission_signature_invalid");
    s=await this.save(s,{admissionSignature:signature});
   }
   s=await this.save(s,{quoteAttempted:true});
   const quoted=await this.http("/v2/requests","POST",request,{...this.headers(s),"X-Payer-Proof":base64({
    typed_data:s.challenge!.typed_data,challenge_token:s.challenge!.challenge_token,signature:s.admissionSignature})});
   if(quoted.status!==402)throw Error(`resolvesignal_admission_http_${quoted.status}`);
   const q=quoted.value as ResolveSignalQuote;
   if(q.input_hash!==s.challenge!.typed_data.message.inputHash.slice(2))throw Error("resolvesignal_quote_input_mismatch");
   await this.checkQuote(q,s.payer,opts.maxFeeAtomic);
   s=await this.save(s,{quote:financialQuote(q)});
  }
  const q=s.quote!;
  const requirement=await this.checkQuote(q,s.payer,opts.maxFeeAtomic);
  const payment:ResolveSignalPaymentRequest={url:`${this.baseUrl}/v2/requests/${q.call_id}/pay`,requestKey:s.requestKey,
   inputHash:q.input_hash,payer:s.payer,maxAmountAtomic:BigInt(requirement.amount)};
  const inspected=await this.options.wallet.inspect(payment);
  if(inspected.status!=="payable" || inspected.price?.amount!==requirement.amount ||
   inspected.chains?.length!==1 || inspected.chains[0]!=="eip155:5042" || !same(inspected.seller??"",requirement.payTo) ||
   !["USDC","exact"].includes(inspected.scheme??""))throw Error("resolvesignal_inspection_mismatch");
  // Recheck chain state/expiry after inspection, then persist intent before the one purchase.
  await this.checkQuote(q,s.payer,opts.maxFeeAtomic);
  s=await this.save(s,{paymentAttempted:true});
  const result=await this.options.wallet.pay(payment);
  if(result.call_id!==q.call_id || result.input_hash!==q.input_hash)throw Error("resolvesignal_paid_response_binding_invalid_use_recover");
  return result; // Caller stores business output. Never credit a BudgetVault from this result.
 }
 private async checkQuote(q:ResolveSignalQuote,payer:Address,cap:bigint){
  const b=await readResolveSignalBinding(this.options.reader,this.seller,q.escrow.vault);
  return validateResolveSignalQuote(q,b,{baseUrl:this.baseUrl,...this.seller,payer,amount:b.amount,maxFeeAtomic:cap,now:this.now()});
 }
 /** Read-only: retrieves the original call and seller escrow. Never signs, pays or deploys. */
 async recover(){
  const s=await this.load();if(!s)throw Error("resolvesignal_recovery_missing");
  await verifyResolveSignalSeller(this.options.reader,this.seller);
  const service=s.quote?await this.http(`/v2/requests/${s.quote.call_id}`,"GET",undefined,{"X-Request-Key":s.requestKey}):undefined;
  const escrow=s.quote?await readResolveSignalBinding(this.options.reader,this.seller,s.quote.escrow.vault):undefined;
  return {operationId:s.operationId,callId:s.quote?.call_id,paymentAttempted:s.paymentAttempted===true,
   service:service?.value,serviceHttpStatus:service?.status,escrow,
   next:s.paymentAttempted?"INSPECT_ORIGINAL_CALL_AND_WALLET_PAYMENT_LOG":"RESUME_SAME_UNPAID_REQUEST"};
 }
}
function financialQuote(q:ResolveSignalQuote):ResolveSignalQuote{
 const r=q.payment_required.accepts[0]!;
 return {call_id:q.call_id,input_hash:q.input_hash,quote_until:q.quote_until,payment_allowed:true,
  escrow:{vault:q.escrow.vault,state:q.escrow.state},payment_required:{x402Version:2,resource:{url:q.payment_required.resource.url},
   accepts:[{scheme:r.scheme,network:r.network,asset:r.asset,amount:r.amount,payTo:r.payTo,maxTimeoutSeconds:r.maxTimeoutSeconds,
    extra:{name:r.extra.name,version:r.extra.version,assetTransferMethod:r.extra.assetTransferMethod}}]}};
}
