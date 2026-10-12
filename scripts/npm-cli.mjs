import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
export async function npmCliPath() {
  const bin=dirname(process.execPath);
  for(const path of [join(bin,"node_modules/npm/bin/npm-cli.js"),join(bin,"../lib/node_modules/npm/bin/npm-cli.js")]) {
    try { await access(path); return path; } catch {}
  }
  throw new Error("npm CLI is required; use an official Node.js distribution that includes npm");
}
