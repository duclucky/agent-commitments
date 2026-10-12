// Compatibility shim for Circle CLI 1.1.4 structured arguments: the estimate API
// accepts arrays, while the user challenge rejects nested ABI parameter arrays.
// Use Circle's supported raw callData shape for both, retaining its normal auth/challenge flow.
// Original installed CLI is never edited; a temporary sibling module is removed after use.
import { readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { entry, args, callData } = JSON.parse(input);
if (typeof callData !== "string" || !/^0x[0-9a-f]+$/i.test(callData)) throw new Error("Invalid pre-encoded calldata");
const original = await readFile(entry, "utf8");
const start = original.indexOf("async function handleAgentExecute(wallet,");
const end = original.indexOf("async function handleLocalExecuteEstimate(", start);
if (start < 0 || end < 0) throw new Error("CLI compatibility scope missing");
const scoped = original.slice(start, end);
const target = /abiFunctionSignature,\s*abiParameters: abiParameters\.length > 0 \? abiParameters : void 0,/g;
if ([...scoped.matchAll(target)].length !== 2) throw new Error("CLI ABI request sites changed; review before use");
const patchedScope = scoped.replace(target, `callData: ${JSON.stringify(callData)},`);
const patched = original.slice(0,start) + patchedScope + original.slice(end);
const temporary = join(dirname(entry), `pilot-abi-${randomUUID()}.mjs`);
try {
  await writeFile(temporary, patched, { flag: "wx" });
  process.argv = [process.execPath, entry, ...args];
  await import(pathToFileURL(temporary).href);
} finally {
  await unlink(temporary);
}
