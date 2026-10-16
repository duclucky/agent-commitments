// Synthetic local test: real seller API/escrow, simulated Circle custody/CLI boundary.
// No Agent Commitments contracts are deployed or funded by this script.
import {readFile} from "node:fs/promises";
import {createPublicClient,http,keccak256,toHex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {ResolveSignalX402Session} from "../packages/sdk/dist/index.js";
import {CircleCliResolveSignalWallet,FileResolveSignalSessionStore} from "../packages/sdk/dist/resolvesignal-node.js";

const setup=JSON.parse(await readFile(process.argv[2],"utf8"));
const rpc=new URL(setup.rpcUrl),api=new URL(setup.httpUrl);
if(rpc.hostname!=="127.0.0.1" || api.hostname!=="127.0.0.1")throw Error("loopback only");
const pub=createPublicClient({transport:http(setup.rpcUrl)});
// Public fixture key 702; never used on a shared network.
const payer=privateKeyToAccount(toHex(702n,{size:32}));
const seller={factory:setup.factory,operator:setup.operator,treasury:setup.treasury,
 factoryCodeHash:keccak256(await pub.getBytecode({address:setup.factory}))};
const transport=(url,opts)=>{
 const target=new URL(url);target.host=api.host;target.protocol=api.protocol;return fetch(target,opts);
};
const results=[];
for(const scenario of ["success","refund","lost-response"]){
 let payCount=0,signCount=0,inspectCount=0;
 const operationId=keccak256(toHex("existing-wallet "+scenario)),salt=keccak256(toHex("local private salt "+scenario));
 const run=async args=>{
  if(args[0]==="wallet" && args[1]==="sign" && args[2]==="typed-data"){
   signCount++;const t=JSON.parse(args[3]);
   return {data:{signature:await payer.signTypedData({...t,message:{...t.message,expiresAt:BigInt(t.message.expiresAt)}})}};
  }
  if(args[0]!=="services" || !["inspect","pay"].includes(args[1]))throw Error("unexpected contract/wallet command");
  const url=args[2],body=args[args.indexOf("--data")+1],header=args[args.indexOf("-H")+1];
  if(args[args.indexOf("-X")+1]!=="POST")throw Error("method changed");
  const requestKey=header.slice("X-Request-Key: ".length);
  const headers={"content-type":"application/json","X-Request-Key":requestKey};
  const challenge=await transport(url,{method:"POST",headers,body});
  if(challenge.status!==402)throw Error("expected x402 challenge");
  const required=JSON.parse(Buffer.from(challenge.headers.get("payment-required"),"base64").toString("utf8"));
  const r=required.accepts[0];
  if(args[1]==="inspect"){
   inspectCount++;return {data:{status:"payable",price:{amount:r.amount},chains:[r.network],seller:r.payTo,scheme:r.extra.name}};
  }
  if(args[args.indexOf("--chain")+1]!=="ARC" || args[args.indexOf("--max-amount")+1]!=="0.060000")throw Error("payment scope changed");
  payCount++;
  const now=Math.floor(Date.now()/1000);
  const authorization={from:payer.address,to:r.payTo,value:r.amount,validAfter:String(now-1),validBefore:String(now+r.maxTimeoutSeconds),nonce:operationId};
  const t={domain:{name:"USDC",version:"2",chainId:5042,verifyingContract:r.asset},primaryType:"TransferWithAuthorization",
   types:{TransferWithAuthorization:[{name:"from",type:"address"},{name:"to",type:"address"},{name:"value",type:"uint256"},
    {name:"validAfter",type:"uint256"},{name:"validBefore",type:"uint256"},{name:"nonce",type:"bytes32"}]},
   message:{...authorization,value:BigInt(authorization.value),validAfter:BigInt(authorization.validAfter),validBefore:BigInt(authorization.validBefore)}};
  const signature=await payer.signTypedData(t);
  const payload={x402Version:2,accepted:r,resource:required.resource,payload:{authorization,signature}};
  const response=await transport(url,{method:"POST",body,headers:{...headers,"PAYMENT-SIGNATURE":Buffer.from(JSON.stringify(payload)).toString("base64")}});
  const value=await response.json();
  if(scenario==="lost-response")throw Error("simulated lost response after submission");
  if(![200,424].includes(response.status))throw Error("paid API failed "+response.status);
  if(response.status===424)return {error:{code:"INTERNAL"}}; // Matches Circle CLI's paid HTTP-error path.
  return {data:{response:value}};
 };
 const wallet=new CircleCliResolveSignalWallet({run,factory:setup.factory});
 const config={payer:payer.address,operationId,store:new FileResolveSignalSessionStore(setup.recoveryDirectory),wallet,
  reader:pub,seller,fetch:transport,baseUrl:"https://local.test"};
 await fetch(setup.httpUrl+"/_test/scenario/"+scenario,{method:"POST"});
 let delivered=false;
 try{const result=await new ResolveSignalX402Session(config).call(setup.request,{salt,maxFeeAtomic:60000n,confirmPaidCall:true});delivered=Boolean(result.result);}
 catch(error){if(scenario==="success")throw error;}
 const restarted=new ResolveSignalX402Session({...config,store:new FileResolveSignalSessionStore(setup.recoveryDirectory)});
 try{await restarted.call(setup.request,{salt,maxFeeAtomic:60000n,confirmPaidCall:true});throw Error("unexpected repeat");}
 catch(error){if(!String(error).includes("payment_already_attempted"))throw error;}
 let status;
 for(let i=0;i<100;i++){
  status=await restarted.recover();
  if([1,2].includes(status.escrow?.status))break;
  await new Promise(r=>setTimeout(r,50));
 }
 if(status.escrow?.status!==(scenario==="refund"?2:1) || payCount!==1)throw Error("wrong terminal state or duplicate purchase");
 results.push({scenario,payCount,signCount,inspectCount,delivered,escrowStatus:status.escrow.status,serviceStatus:status.service?.status});
}
console.log(JSON.stringify({verified:true,newBudgetContracts:0,contractTransactionsFromClient:0,results}));
