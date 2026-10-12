import { spawn } from "node:child_process";
import { once } from "node:events";
import { statSync } from "node:fs";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { createPublicClient, createWalletClient, http, keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { quoteTypedData } from "../packages/sdk/dist/index.js";

const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const provider = privateKeyToAccount("0x59c6995e998f97a5a0044976f0945389dc9e86dae88c7a8412f4603b6b78690d");
const consoleRoot = resolve("apps/console/dist");
const browserPath = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((candidate) => {
  try { return typeof candidate === "string" && statSync(candidate).isFile(); } catch { return false; }
});

async function freePort() {
  const server = createServer();
  await new Promise((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveReady);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  await new Promise((resolveClose) => server.close(resolveClose));
  if (!port) throw new Error("Could not allocate a local port");
  return port;
}

async function waitFor(label, check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) { lastError = error; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ""}`);
}

async function artifact(source, name = source) {
  return JSON.parse(await readFile(new URL(`../contracts/out/${source}.sol/${name}.json`, import.meta.url), "utf8"));
}

function bytecode(value) {
  return value.bytecode.object.startsWith("0x") ? value.bytecode.object : `0x${value.bytecode.object}`;
}

function formatUsdc(value) {
  const whole = value / 1_000_000n;
  const fraction = String(value % 1_000_000n).padStart(6, "0");
  return `${whole}.${fraction}`;
}

async function createChainFixture(port) {
  const rpcUrl = `http://127.0.0.1:${port}`;
  const chain = {
    id: 31_338,
    name: "Agent Commitments browser local",
    nativeCurrency: { name: "Local Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };
  const anvil = spawn("anvil", ["--silent", "--port", String(port), "--chain-id", String(chain.id)], { stdio: "ignore" });
  await waitFor("Anvil readiness", async () => {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    return response.ok;
  });

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const ownerClient = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });
  const providerClient = createWalletClient({ account: provider, chain, transport: http(rpcUrl) });
  await publicClient.request({ method: "anvil_setBalance", params: [provider.address, "0x8ac7230489e80000"] });
  const [tokenArtifact, vaultArtifact, escrowArtifact, adapterArtifact] = await Promise.all([
    artifact("TestSupport", "MockUSDC"), artifact("BudgetVault"), artifact("LocalAgenticCommerce"), artifact("ERC8183Adapter"),
  ]);
  const deploy = async (artifactValue, args = []) => {
    const hash = await ownerClient.deployContract({ abi: artifactValue.abi, bytecode: bytecode(artifactValue), args });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress || receipt.status !== "success") throw new Error("Local deployment failed");
    return receipt.contractAddress;
  };
  const send = async (client, address, abi, functionName, args = []) => {
    const hash = await client.writeContract({ address, abi, functionName, args });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
    return receipt;
  };

  const latest = await publicClient.getBlock();
  const token = await deploy(tokenArtifact);
  const vault = await deploy(vaultArtifact, [
    token, owner.address, latest.timestamp + 30n * 86_400n, 100_000_000n, 25_000_000n, 2n,
  ]);
  const escrow = await deploy(escrowArtifact, [token]);
  const adapter = await deploy(adapterArtifact, [vault, escrow, token]);
  await send(ownerClient, vault, vaultArtifact.abi, "setAdapter", [adapter]);
  const rootGrant = await publicClient.readContract({ address: vault, abi: vaultArtifact.abi, functionName: "ROOT_GRANT_ID" });
  const grantId = keccak256(stringToHex("browser-local-e2e-agent"));
  await send(ownerClient, vault, vaultArtifact.abi, "createGrant", [
    grantId, rootGrant, owner.address, 100_000_000n, latest.timestamp + 10n * 86_400n,
    [provider.address], [owner.address],
  ]);
  await send(ownerClient, token, tokenArtifact.abi, "mint", [owner.address, 100_000_000n]);
  await send(ownerClient, token, tokenArtifact.abi, "approve", [vault, 100_000_000n]);
  await send(ownerClient, vault, vaultArtifact.abi, "deposit", [100_000_000n]);

  let settlementPromise;
  return {
    close: () => anvil.kill(),
    settle: () => {
      settlementPromise ??= (async () => {
        const operationId = keccak256(stringToHex("browser-local-e2e-document"));
        const quote = {
          grantId, operationId, provider: provider.address, evaluator: owner.address, token, adapter, amount: 25_000_000n,
          quoteExpiresAt: latest.timestamp + 3_600n, jobExpiresAt: latest.timestamp + 86_400n,
          workHash: keccak256(stringToHex("schema:v1:pages:2")), nonce: keccak256(stringToHex("browser-local-e2e-nonce")),
        };
        const signature = await provider.signTypedData(quoteTypedData(chain.id, vault, quote));
        await send(ownerClient, vault, vaultArtifact.abi, "reserve", [quote, signature]);
        const commitmentId = await publicClient.readContract({ address: vault, abi: vaultArtifact.abi, functionName: "commitmentId", args: [grantId, operationId] });
        await send(ownerClient, adapter, adapterArtifact.abi, "dispatch", [commitmentId]);
        const jobId = await publicClient.readContract({ address: adapter, abi: adapterArtifact.abi, functionName: "jobs", args: [commitmentId] });
        await send(providerClient, escrow, escrowArtifact.abi, "setBudget", [jobId, 25_000_000n, "0x"]);
        await send(ownerClient, adapter, adapterArtifact.abi, "fund", [commitmentId]);
        await send(providerClient, escrow, escrowArtifact.abi, "submit", [jobId, keccak256(stringToHex("deliverable")), "0x"]);
        await send(ownerClient, escrow, escrowArtifact.abi, "complete", [jobId, keccak256(stringToHex("accepted")), "0x"]);
        const reconcileReceipt = await send(ownerClient, adapter, adapterArtifact.abi, "reconcile", [commitmentId]);
        const ledger = await publicClient.readContract({ address: vault, abi: vaultArtifact.abi, functionName: "ledger" });
        const providerBalance = await publicClient.readContract({ address: token, abi: tokenArtifact.abi, functionName: "balanceOf", args: [provider.address] });
        if (ledger.available !== 75_000_000n || ledger.settled !== 25_000_000n || providerBalance !== 25_000_000n) {
          throw new Error("Browser E2E final chain state mismatch");
        }
        return {
          ledger: {
            deposited: formatUsdc(ledger.deposited), available: formatUsdc(ledger.available),
            reserved: formatUsdc(ledger.reserved), inEscrow: formatUsdc(ledger.inEscrow),
            settled: formatUsdc(ledger.settled), withdrawn: formatUsdc(ledger.withdrawn),
          },
          operation: commitmentId,
          provider: provider.address,
          amount: formatUsdc(providerBalance),
          economic: "SETTLED",
          transport: "CONFIRMED",
          transactionHash: reconcileReceipt.transactionHash,
        };
      })();
      return settlementPromise;
    },
  };
}

async function startAppServer(port, chainFixture) {
  const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
      if (request.method === "POST" && url.pathname === "/api/local-chain/settle") {
        const result = await chainFixture.settle();
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify(result));
        return;
      }
      if (request.method !== "GET") {
        response.writeHead(405).end();
        return;
      }
      const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (!new Set(["index.html", "app.js", "recovery.js", "mainnet.js", "styles.css"]).has(relative)) {
        response.writeHead(404).end();
        return;
      }
      const contents = await readFile(join(consoleRoot, relative));
      response.writeHead(200, { "content-type": contentTypes[extname(relative)] ?? "application/octet-stream", "cache-control": "no-store" });
      response.end(contents);
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown local E2E error" }));
    }
  });
  await new Promise((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolveReady);
  });
  return server;
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
  }
  async open() {
    await new Promise((resolveOpen, reject) => {
      this.socket.addEventListener("open", resolveOpen, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }
  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolveCall, reject) => {
      this.pending.set(id, { resolve: resolveCall, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket.close(); }
}

async function pressKey(cdp, key, code, windowsVirtualKeyCode) {
  const event = { key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode };
  const text = key === "Enter" ? "\r" : key === " " ? " " : undefined;
  await cdp.call("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...event, ...(text ? { text, unmodifiedText: text } : {}) });
  await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", ...event });
}

if (!browserPath) throw new Error("Chrome or Edge is required for browser E2E");
const [chainPort, appPort, debugPort] = await Promise.all([freePort(), freePort(), freePort()]);
const profilePath = await mkdtemp(join(tmpdir(), "agent-commitments-browser-"));
let chainFixture;
let appServer;
let browser;
let cdp;
try {
  chainFixture = await createChainFixture(chainPort);
  appServer = await startAppServer(appPort, chainFixture);
  browser = spawn(browserPath, [
    "--headless=new", `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*",
    `--user-data-dir=${profilePath}`, "--no-first-run", "--disable-default-apps", "about:blank",
  ], { stdio: ["ignore", "ignore", "inherit"] });
  const target = await waitFor("Browser debug target", async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const targets = await response.json();
    return targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  });
  cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await cdp.call("Page.navigate", { url: `http://127.0.0.1:${appPort}/?mode=local-chain` });
  await waitFor("Console load", () => cdp.evaluate("document.readyState === 'complete'"));

  const overflow = await cdp.evaluate("document.scrollingElement.scrollWidth > window.innerWidth");
  if (overflow) throw new Error("Console has horizontal overflow at 375px");
  const clippedHero = await cdp.evaluate(`['#page-title', '.lede', '#new-commitment'].filter((selector) => {
    const bounds = document.querySelector(selector).getBoundingClientRect();
    return bounds.left < 0 || bounds.right > window.innerWidth;
  })`);
  if (clippedHero.length) throw new Error(`Hero controls clipped at 375px: ${clippedHero.join(", ")}`);
  await pressKey(cdp, "Tab", "Tab", 9);
  const firstFocus = await cdp.evaluate("document.activeElement.className");
  if (firstFocus !== "skip-link") throw new Error(`Expected skip link first, received ${firstFocus}`);
  await pressKey(cdp, "Tab", "Tab", 9);
  await pressKey(cdp, "Tab", "Tab", 9);
  const actionFocus = await cdp.evaluate("document.activeElement.id");
  if (actionFocus !== "new-commitment") throw new Error(`Expected commitment action in tab order, received ${actionFocus}`);
  await pressKey(cdp, "Enter", "Enter", 13);
  try {
    await waitFor("Browser-to-chain settlement", () => cdp.evaluate("document.body.dataset.chainE2e === 'settled'"), 8_000);
  } catch (error) {
    const diagnostic = await cdp.evaluate(`({
      state: document.body.dataset.chainE2e,
      status: document.querySelector('#demo-status')?.textContent,
      button: document.querySelector('#new-commitment')?.textContent,
    })`);
    throw new Error(`${error.message}; browser state=${JSON.stringify(diagnostic)}`);
  }

  const result = await cdp.evaluate(`({
    status: document.querySelector('#demo-status').textContent,
    settled: [...document.querySelectorAll('#metrics strong')].map((node) => node.textContent),
    transactionHash: document.querySelector('#commitments tr').dataset.transactionHash,
    active: document.activeElement.id,
  })`);
  if (!result.status.includes("25.000000 USDC")) throw new Error(`Missing visible settlement evidence: ${result.status}`);
  if (result.settled.at(4) !== "25.000000") throw new Error(`Unexpected settled metric: ${result.settled.at(4)}`);
  if (!/^0x[0-9a-f]{64}$/i.test(result.transactionHash)) throw new Error("Missing transaction hash evidence");
  if (result.active !== "new-commitment") throw new Error("Keyboard focus moved unexpectedly after settlement");
  if (process.env.E2E_SCREENSHOT) {
    const screenshot = await cdp.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(process.env.E2E_SCREENSHOT, Buffer.from(screenshot.data, "base64"));
  }
  console.log(`Browser local-chain E2E passed at 375px with keyboard activation: ${result.transactionHash}`);
} finally {
  cdp?.close();
  if (browser && browser.exitCode === null) {
    browser.kill();
    await Promise.race([
      once(browser, "exit"),
      new Promise((resolveWait) => setTimeout(resolveWait, 2_000)),
    ]);
  }
  if (appServer) await new Promise((resolveClose) => appServer.close(resolveClose));
  chainFixture?.close();
  await rm(profilePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
