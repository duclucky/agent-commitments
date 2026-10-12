import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readMainnetConsoleSnapshot } from "./mainnet-console-snapshot.mjs";
const files = new Map([["/","index.html"],["/index.html","index.html"],["/app.js","app.js"],["/mainnet.js","mainnet.js"],["/recovery.js","recovery.js"],["/styles.css","styles.css"]]);
export function createConsoleServer(readSnapshot = readMainnetConsoleSnapshot) {
  return createServer(async (request,response) => {
    response.setHeader("Cache-Control","no-store");
    response.setHeader("X-Content-Type-Options","nosniff");
    if (request.method !== "GET") { response.writeHead(405,{Allow:"GET"}).end(); return; }
    const pathname = new URL(request.url,"http://127.0.0.1").pathname;
    if (pathname === "/api/mainnet/snapshot") {
      response.setHeader("Content-Type","application/json; charset=utf-8");
      try { response.end(JSON.stringify(await readSnapshot())); }
      catch { response.writeHead(503).end(JSON.stringify({error:"MAINNET_EVIDENCE_UNAVAILABLE"})); }
      return;
    }
    if (!files.has(pathname)) { response.writeHead(404).end(); return; }
    const file = files.get(pathname);
    try {
      const data = await readFile(new URL(`../apps/console/dist/${file}`,import.meta.url));
      response.setHeader("Content-Type",file.endsWith(".js") ? "text/javascript; charset=utf-8" : file.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8");
      response.end(data);
    } catch { response.writeHead(503).end("Console build unavailable"); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.CONSOLE_PORT ?? 4173);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid console port");
  createConsoleServer().listen(port,"127.0.0.1",()=>console.log(`Read-only mainnet console: http://127.0.0.1:${port}/?mode=mainnet`));
}
