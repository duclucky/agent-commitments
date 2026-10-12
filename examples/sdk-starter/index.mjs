// Copy this file to a separate project after installing the release archive.
// Runs offline; no signer, credential, RPC call or transaction submission.
import { createArcTestnetClient, deriveCommitmentId } from "@agent-commitments/sdk";
import { keccak256, stringToHex } from "viem";
const client=createArcTestnetClient();
const grantId=keccak256(stringToHex("starter-grant"));
const operationId=keccak256(stringToHex("starter-document-job"));
const commitmentId=deriveCommitmentId(client.chainId,client.vault,grantId,operationId);
const call=client.prepareDispatch(commitmentId);
console.log(JSON.stringify({mode:"prepare-only",note:"Illustrative IDs; no existing grant or reservation is assumed. Nothing is signed or broadcast.",commitmentId,call},(_,value)=>typeof value==="bigint"?String(value):value,2));
