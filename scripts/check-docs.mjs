import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "node:fs/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
for await (const relative of glob("**/*.md", { cwd: root, exclude: ["node_modules/**", "contracts/out/**", ".git/**", ".release/**", ".upstream/**", ".agents/**", ".audit-reproduction/**"] })) {
  const absolute = join(root, relative);
  const text = await readFile(absolute, "utf8");
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1].trim().replace(/^<|>$/g, "");
    if (/^(https?:|mailto:|#)/.test(raw)) continue;
    const withoutAnchor = decodeURIComponent(raw.split("#", 1)[0]);
    const target = isAbsolute(withoutAnchor) ? withoutAnchor : resolve(dirname(absolute), withoutAnchor);
    try { await access(target); } catch { failures.push(`${relative}: missing ${raw}`); }
  }
}
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
for (const script of ["build", "typecheck", "test:unit", "test:contracts", "test:invariants", "test:integration", "test:failure", "test:e2e", "test:local-chain", "test:browser-local-chain", "test:deployment-rehearsal", "test:arc-testnet-fork", "verify:arc-testnet", "verify:arc-mainnet", "prepare:arc-mainnet-draft-candidate", "estimate:arc-mainnet-draft-escrow", "estimate:arc-mainnet-draft-adapter", "deploy:arc-mainnet-draft-escrow", "deploy:arc-mainnet-draft-adapter", "example:sdk", "example:testnet-readonly", "example:circle-wallets", "check:docs"]) {
  if (!packageJson.scripts?.[script]) failures.push(`package.json: missing script ${script}`);
}
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
else console.log("Documentation links and command contract passed.");
