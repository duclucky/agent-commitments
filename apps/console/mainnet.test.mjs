import assert from "node:assert/strict";
import { test } from "node:test";
import { validateMainnetSnapshot, loadMainnetSnapshot } from "./src/mainnet.js";

const hash = `0x${"a".repeat(64)}`;
const address = `0x${"b".repeat(40)}`;
const snapshot = () => ({ chainId:5042, readOnly:true, observedBlock:"123", observedAt:new Date().toISOString(),
  ledger:{deposited:"10000",available:"0",reserved:"0",inEscrow:"0",settled:"5000",withdrawn:"5000"},
  funding:{physicalBalance:"0",recordedBacking:"0",unassignedBalance:"0",backingShortfall:"0"},
  operations:[{ commitmentId:hash,provider:address,amount:"5000",economicStatus:"SETTLED",transportState:"CONFIRMED",escrowStatus:"COMPLETED",jobId:"2",transactionHash:hash }],
});
test("mainnet money remains exact and transport confirmation is shown separately",()=>{
  const view=validateMainnetSnapshot(snapshot());
  assert.deepEqual(view.amounts,["0.010000","0.000000","0.000000","0.000000","0.005000","0.005000"]);
  assert.equal(view.rows[0].amount,"0.005000");
  const pending=snapshot();pending.operations[0].transportState="UNKNOWN";
  assert.equal(validateMainnetSnapshot(pending).rows[0].transport,"UNKNOWN");
});
test("wrong chain, malformed evidence and non-conserving ledger are rejected",()=>{
  for(const patch of [{chainId:5042002},{readOnly:false},{observedBlock:"-1"},{observedAt:"invalid"},{observedAt:new Date(Date.now()-300000).toISOString()}]) assert.throws(()=>validateMainnetSnapshot({...snapshot(),...patch}));
  const invalid=snapshot();invalid.ledger.available="1";assert.throws(()=>validateMainnetSnapshot(invalid),/conservation/);
  const float=snapshot();float.ledger.deposited=0.01;assert.throws(()=>validateMainnetSnapshot(float));
  const badHash=snapshot();badHash.operations[0].transactionHash="javascript:alert(1)";assert.throws(()=>validateMainnetSnapshot(badHash));
});
test("backend error never yields a successful empty ledger or demo fallback",async()=>{
  await assert.rejects(loadMainnetSnapshot(async()=>({ok:false,status:503})),/Unable to read/);
  await assert.rejects(loadMainnetSnapshot(async()=>({ok:true,json:async()=>({chainId:5042})})),/snapshot/);
});
test("loader performs only a no-store GET to the fixed read-only endpoint",async()=>{
  let request;
  await loadMainnetSnapshot(async(...args)=>{request=args;return {ok:true,json:async()=>snapshot()};});
  assert.equal(request[0],"/api/mainnet/snapshot");
  assert.equal(request[1].method,"GET");assert.equal(request[1].cache,"no-store");
});
test("direct donation does not increase available money, and backing must agree with ledger",()=>{
  const donation=snapshot();donation.funding.physicalBalance="5000000";donation.funding.unassignedBalance="5000000";
  const view=validateMainnetSnapshot(donation);
  assert.equal(view.amounts[1],"0.000000");assert.equal(view.funding.unassignedBalance,"5000000");
  const wrongBacking=snapshot();wrongBacking.funding.recordedBacking="1";
  assert.throws(()=>validateMainnetSnapshot(wrongBacking),/backing/);
});
