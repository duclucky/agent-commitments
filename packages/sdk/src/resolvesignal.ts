import {keccak256,stringToHex,zeroAddress,type Address,type Hex} from "viem";
import {erc20Abi} from "./abi.js";
import type {ContractReadRequest} from "./client.js";
import {resolveSignalFactoryAbi,resolveSignalVaultAbi} from "./resolvesignal-abi.js";

export const RESOLVESIGNAL_USDC="0x3600000000000000000000000000000000000000" as const;
/** Existing seller deployment, verified read-only on 2026-10-16. No new contracts. */
export const RESOLVESIGNAL_SELLER={
 factory:"0xB2b41f3e45AEe1Da3D8756bd087277f1194bf3C7",
 factoryCodeHash:"0x810f2d5ff8788a4d9ef58ad3446369c7e635deeacd0b6fd120f7287bbd633cd9",
 operator:"0xCd71c60Eb4E0C180CeBB8359606E402255d9C407",treasury:"0x8B26F57Ac95619887B7281573CF10764B95869CD",
} as const;
export interface ResolveSignalSeller {factory:Address;factoryCodeHash:Hex;operator:Address;treasury:Address;}
export interface ResolveSignalBinding {
 payer:Address;escrow:Address;factory:Address;token:Address;operator:Address;treasury:Address;
 amount:bigint;validBefore:bigint;completeBy:bigint;status:number;factoryVault:Address;
}
export interface ResolveSignalRequirement {
 scheme:"exact";network:"eip155:5042";asset:Address;amount:string;payTo:Address;
 maxTimeoutSeconds:number;extra:{name:string;version:string;assetTransferMethod:string};
}
export interface ResolveSignalQuote {
 call_id:string;input_hash:string;quote_until:number;payment_allowed:boolean;escrow:{vault:Address;state:string};
 payment_required:{x402Version:number;resource:{url:string};accepts:ResolveSignalRequirement[]};
}
export interface ResolveSignalQuotePolicy {
 baseUrl:string;factory:Address;operator:Address;treasury:Address;payer:Address;amount:bigint;maxFeeAtomic:bigint;now:number;
}
const same=(a:unknown,b:unknown)=>typeof a==="string" && typeof b==="string" && a.toLowerCase()===b.toLowerCase();
const address=(v:unknown):v is Address=>typeof v==="string" && /^0x[0-9a-fA-F]{40}$/.test(v) && v!==zeroAddress;
const bytes32=(v:unknown):v is Hex=>typeof v==="string" && /^0x[0-9a-fA-F]{64}$/.test(v);
export function validateResolveSignalQuote(q:ResolveSignalQuote,b:ResolveSignalBinding,p:ResolveSignalQuotePolicy):ResolveSignalRequirement{
 const r=q?.payment_required?.accepts?.[0];
 if(!r || q.payment_required.accepts.length!==1 || q.payment_required.x402Version!==2 ||
  !/^call_[A-Za-z0-9_-]{1,128}$/.test(q.call_id) || !/^[0-9a-f]{64}$/.test(q.input_hash) ||
  q.payment_allowed!==true || q.escrow?.state!=="open" || q.payment_required.resource?.url!==`${p.baseUrl}/v2/requests/${q.call_id}/pay` ||
  r.scheme!=="exact" || r.network!=="eip155:5042" || !same(r.asset,RESOLVESIGNAL_USDC) ||
  !/^[1-9][0-9]{0,76}$/.test(r.amount) || BigInt(r.amount)!==p.amount || p.amount>p.maxFeeAtomic ||
  !Number.isSafeInteger(q.quote_until) || q.quote_until<=p.now || !Number.isSafeInteger(r.maxTimeoutSeconds) || r.maxTimeoutSeconds<=0 ||
  r.extra?.name!=="USDC" || r.extra.version!=="2" || r.extra.assetTransferMethod!=="eip3009" ||
  !address(r.payTo) || !same(r.payTo,q.escrow.vault) || !same(r.payTo,b.escrow) || !same(b.factoryVault,b.escrow) ||
  !same(b.factory,p.factory) || !same(b.token,RESOLVESIGNAL_USDC) || !same(b.operator,p.operator) || !same(b.treasury,p.treasury) || !same(b.payer,p.payer) ||
  b.amount!==p.amount || b.status!==0 || b.validBefore<=BigInt(p.now+6) || b.validBefore>BigInt(q.quote_until) || b.completeBy<=b.validBefore)throw Error("resolvesignal_quote_binding_invalid");
 return r;
}
export interface ResolveSignalReader {
 getChainId():Promise<number>;
 getBlockNumber(options?:{cacheTime?:number}):Promise<bigint>;
 getBytecode(args:{address:Address;blockNumber?:bigint}):Promise<Hex|undefined>;
 readContract(args:ContractReadRequest):Promise<unknown>;
}
export async function verifyResolveSignalSeller(reader:ResolveSignalReader,seller:ResolveSignalSeller){
 if(![seller.factory,seller.operator,seller.treasury].every(address) || !bytes32(seller.factoryCodeHash))throw Error("resolvesignal_seller_config_invalid");
 if(await reader.getChainId()!==5042)throw Error("resolvesignal_chain_mismatch");
 const blockNumber=await reader.getBlockNumber({cacheTime:0});
 const code=await reader.getBytecode({address:seller.factory,blockNumber});
 if(!code || !same(keccak256(code),seller.factoryCodeHash))throw Error("resolvesignal_seller_code_mismatch");
 for(const [name,expected] of [["token",RESOLVESIGNAL_USDC],["operator",seller.operator],["treasury",seller.treasury]]){
  if(!same(await reader.readContract({address:seller.factory,abi:resolveSignalFactoryAbi,functionName:name!,blockNumber}),expected))throw Error("resolvesignal_seller_binding_invalid");
 }
 if(await reader.readContract({address:RESOLVESIGNAL_USDC,abi:erc20Abi,functionName:"decimals",blockNumber})!==6)throw Error("resolvesignal_token_decimals_invalid");
 return blockNumber;
}
/** Read-only inspection of the seller's existing escrow; never creates a contract. */
export async function readResolveSignalBinding(reader:ResolveSignalReader,seller:ResolveSignalSeller,escrow:Address):Promise<ResolveSignalBinding>{
 if(!address(escrow))throw Error("resolvesignal_escrow_invalid");
 const blockNumber=await verifyResolveSignalSeller(reader,seller);
 const [payer,factory,token,operator,treasury,amount,validBefore,completeBy,status,callId]=await Promise.all(
  ["payer","factory","token","operator","treasury","amount","validBefore","completeBy","status","callId"].map(functionName=>
   reader.readContract({address:escrow,abi:resolveSignalVaultAbi,functionName,blockNumber})));
 const factoryVault=await reader.readContract({address:seller.factory,abi:resolveSignalFactoryAbi,functionName:"vaults",args:[callId],blockNumber});
 if(!same(factoryVault,escrow) || !same(factory,seller.factory) || !same(token,RESOLVESIGNAL_USDC) || !same(operator,seller.operator) || !same(treasury,seller.treasury))throw Error("resolvesignal_escrow_binding_invalid");
 return {payer,escrow,factory,token,operator,treasury,amount,validBefore,completeBy,status,factoryVault} as ResolveSignalBinding;
}
const admissionFields=[{name:"purpose",type:"string"},{name:"payer",type:"address"},{name:"inputHash",type:"bytes32"},
 {name:"requestOwner",type:"bytes32"},{name:"requestIdempotency",type:"bytes32"},{name:"nonce",type:"bytes32"},{name:"expiresAt",type:"uint64"}];
const domainFields=[{name:"name",type:"string"},{name:"version",type:"string"},{name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}];
export function validateResolveSignalAdmission(typed:Record<string,any>,payer:Address,factory:Address,now:number){
 const m=typed?.message,d=typed?.domain;
 if(typed?.primaryType!=="QuoteAdmission" || d?.name!=="NextCue Quote Admission" || d.version!=="1" || d.chainId!==5042 ||
  !same(d.verifyingContract,factory) || m?.purpose!=="quote_admission_only_no_payment" || !same(m.payer,payer) ||
  ![m.inputHash,m.requestOwner,m.requestIdempotency,m.nonce].every(bytes32) || !Number.isSafeInteger(m.expiresAt) ||
  m.expiresAt<=now || m.expiresAt>now+300)throw Error("resolvesignal_admission_scope_invalid");
 const t=typed.types;
 if(Object.keys(typed).sort().join(",")!=="domain,message,primaryType,types" || !t || Object.keys(t).some(k=>!["EIP712Domain","QuoteAdmission"].includes(k)) ||
  canonicalRequest(t.QuoteAdmission)!==canonicalRequest(admissionFields) ||
  (t.EIP712Domain && canonicalRequest(t.EIP712Domain)!==canonicalRequest(domainFields)) ||
  Object.keys(m).sort().join(",")!==admissionFields.map(f=>f.name).sort().join(",") ||
  Object.keys(d).sort().join(",")!==domainFields.map(f=>f.name).sort().join(","))throw Error("resolvesignal_admission_types_invalid");
}
export function resolveSignalWorkHash(request:unknown,salt:Hex):Hex{
 if(!bytes32(salt))throw Error("resolvesignal_work_salt_required");return keccak256(stringToHex(salt+canonicalRequest(request)));
}
export function canonicalRequest(value:unknown):string{
 if(value===null || typeof value==="string" || typeof value==="boolean" || (typeof value==="number" && Number.isFinite(value)))return JSON.stringify(value);
 if(Array.isArray(value))return "["+Array.from(value,canonicalRequest).join(",")+"]";
 if(typeof value==="object" && value && Object.getPrototypeOf(value)===Object.prototype)return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonicalRequest((value as Record<string,unknown>)[k])).join(",")+"}";
 throw Error("resolvesignal_request_not_json");
}
