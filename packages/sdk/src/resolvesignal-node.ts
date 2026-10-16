import {spawn} from "node:child_process";
import {access} from "node:fs/promises";
import {constants} from "node:fs";
import {delimiter,join} from "node:path";
import type {Address,Hex} from "viem";
import {RESOLVESIGNAL_SELLER,validateResolveSignalAdmission} from "./resolvesignal.js";
import type {ResolveSignalPaymentRequest,ResolveSignalWallet,ResolveSignalWalletInspection} from "./resolvesignal-session.js";
export {FileResolveSignalSessionStore} from "./resolvesignal-node-store.js";

export type CircleCommandRunner=(args:readonly string[])=>Promise<unknown>;
/** Uses an already installed/authenticated Circle CLI. Does not log in, fund or deploy. */
export class CircleCliResolveSignalWallet implements ResolveSignalWallet {
 private readonly run:CircleCommandRunner;
 constructor(readonly options:{run?:CircleCommandRunner;factory?:Address;now?:()=>number}={}){this.run=options.run??runCircle;}
 private async command(args:string[]){
  const response=await this.run([...args,"--output","json"]) as Record<string,any>;
  if(!response || typeof response!=="object" || response.error || response.success===false)throw Error("resolvesignal_circle_command_failed_use_recover");
  const data=response.data??response;
  if(!data || typeof data!=="object" || Array.isArray(data))throw Error("resolvesignal_circle_response_invalid");
  return data as Record<string,any>;
 }
 async signAdmission(typed:Record<string,any>,payer:Address):Promise<Hex>{
  validateResolveSignalAdmission(typed,payer,this.options.factory??RESOLVESIGNAL_SELLER.factory,(this.options.now??(()=>Math.floor(Date.now()/1000)))());
  const data=await this.command(["wallet","sign","typed-data",JSON.stringify(typed),"--address",payer,"--chain","ARC"]);
  if(typeof data.signature!=="string" || !/^0x(?:[0-9a-fA-F]{2}){1,8192}$/.test(data.signature))throw Error("resolvesignal_circle_signature_invalid");
  return data.signature as Hex;
 }
 private common(p:ResolveSignalPaymentRequest){
  const url=new URL(p.url);
  if((url.protocol!=="https:" && !(url.protocol==="http:" && ["localhost","127.0.0.1"].includes(url.hostname))) ||
   url.username || url.password || url.search || url.hash || !/^\/v2\/requests\/call_[A-Za-z0-9_-]{1,128}\/pay$/.test(url.pathname) ||
   !/^[0-9a-f]{64}$/.test(p.requestKey) || !/^[0-9a-f]{64}$/.test(p.inputHash) ||
   !/^0x[0-9a-fA-F]{40}$/.test(p.payer) || /^0x0{40}$/i.test(p.payer) || p.maxAmountAtomic<=0n)throw Error("resolvesignal_circle_payment_scope_invalid");
  return [url.href,"-X","POST","--data",JSON.stringify({input_hash:p.inputHash}),"-H",`X-Request-Key: ${p.requestKey}`];
 }
 async inspect(p:ResolveSignalPaymentRequest):Promise<ResolveSignalWalletInspection>{
  return await this.command(["services","inspect",...this.common(p)]) as unknown as ResolveSignalWalletInspection;
 }
 async pay(p:ResolveSignalPaymentRequest){
  const cap=`${p.maxAmountAtomic/1_000_000n}.${(p.maxAmountAtomic%1_000_000n).toString().padStart(6,"0")}`;
  const data=await this.command(["services","pay",...this.common(p),"--address",p.payer,"--chain","ARC","--max-amount",cap,"--timeout","120"]);
  let value=data.response;
  if(typeof value==="string"){try{value=JSON.parse(value);}catch{throw Error("resolvesignal_circle_paid_response_invalid_use_recover");}}
  if(!value || typeof value!=="object" || Array.isArray(value))throw Error("resolvesignal_circle_paid_response_invalid_use_recover");
  return value as Record<string,any>;
 }
}

async function commandPath(){
 for(const directory of (process.env.PATH??"").split(delimiter)){
  if(!directory)continue;
  if(process.platform==="win32"){
   const entry=join(directory,"node_modules","@circle-fin","cli","dist","index.js");
   try{await access(entry,constants.R_OK);return {file:process.execPath,prefix:[entry]};}catch{}
  }else{
   const entry=join(directory,"circle");
   try{await access(entry,constants.X_OK);return {file:entry,prefix:[]};}catch{}
  }
 }
 throw Error("resolvesignal_circle_cli_not_installed");
}
async function runCircle(args:readonly string[]):Promise<unknown>{
 const command=await commandPath();
 return new Promise((resolve,reject)=>{
  const child=spawn(command.file,[...command.prefix,...args],{shell:false,windowsHide:true,stdio:["ignore","pipe","pipe"]});
  let stdout="",size=0,failed=false;
  const fail=(code:string)=>{if(failed)return;failed=true;child.kill();reject(Error(code));};
  const timer=setTimeout(()=>fail("resolvesignal_circle_timeout_use_recover"),150_000);
  child.stdout.setEncoding("utf8");
  child.stdout.on("data",(chunk:string)=>{size+=Buffer.byteLength(chunk,"utf8");if(size>2_000_000)fail("resolvesignal_circle_output_limit_use_recover");else stdout+=chunk;});
  child.stderr.on("data",()=>{}); // Provider errors can contain signatures; never reflect them.
  child.on("error",()=>{clearTimeout(timer);fail("resolvesignal_circle_process_failed_use_recover");});
  child.on("close",code=>{
   clearTimeout(timer);if(failed)return;
   if(code!==0){failed=true;reject(Error("resolvesignal_circle_command_failed_use_recover"));return;}
   try{resolve(JSON.parse(stdout));}catch{reject(Error("resolvesignal_circle_response_invalid_use_recover"));}
  });
 });
}
