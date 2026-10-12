import assert from "node:assert/strict";
import { test } from "node:test";
import { createConsoleServer } from "./serve-mainnet-console.mjs";
async function withServer(reader, run) {
  const server = createConsoleServer(reader);
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
}
test("read endpoint has no cache and never serves credentials, journal or filesystem", async()=>{
  let reads=0;
  await withServer(async()=>({readOnly:true,sequence:++reads}),async url=>{
    const first = await fetch(`${url}/api/mainnet/snapshot`);
    assert.equal(first.headers.get("cache-control"),"no-store");
    assert.equal((await first.json()).sequence,1);
    assert.equal((await (await fetch(`${url}/api/mainnet/snapshot`)).json()).sequence,2);
    for (const path of ["/.env","/deployments/arc-mainnet-pilot-journal.json","/../package.json","/%2e%2e%2f.env"]) assert.equal((await fetch(`${url}${path}`)).status,404);
    assert.equal(reads,2);
    const write=await fetch(`${url}/api/mainnet/snapshot`,{method:"POST"});
    assert.equal(write.status,405); assert.equal(reads,2);
  });
});
test("RPC exceptions become generic unavailable evidence without leaking details",async()=>{
  await withServer(async()=>{throw new Error("PRIVATE_CREDENTIAL_SENTINEL");},async url=>{
    const response=await fetch(`${url}/api/mainnet/snapshot`);
    assert.equal(response.status,503);
    assert.deepEqual(await response.json(),{error:"MAINNET_EVIDENCE_UNAVAILABLE"});
  });
});
