import { spawn, spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";

const nativeUrl = "postgres://agent_commitments:agent_commitments@127.0.0.1:55432/agent_commitments_test";
const dockerUrl = "postgres://agent_commitments:agent_commitments@127.0.0.1:5432/agent_commitments";
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false, ...options });
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

async function canConnect(pool, attempts) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { await pool.query("SELECT 1"); return true; }
    catch { if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 1_000)); }
  }
  return false;
}

let url = process.env.TEST_DATABASE_URL ?? nativeUrl;
let pool = new Pool({ connectionString: url, connectionTimeoutMillis: 1_000 });
let dockerStarted = false;
try {
  let connected = await canConnect(pool, 1);
  if (!connected && !process.env.TEST_DATABASE_URL) {
    await pool.end();
    run("docker", ["compose", "up", "-d", "postgres"]);
    dockerStarted = true;
    url = dockerUrl;
    pool = new Pool({ connectionString: url, connectionTimeoutMillis: 1_000 });
    connected = await canConnect(pool, 30);
  }
  if (!connected) throw new Error("Postgres did not become ready");
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  const migrationsDirectory = new URL("../db/migrations/", import.meta.url);
  const migrations = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
  for (const migration of migrations) await pool.query(await readFile(new URL(migration, migrationsDirectory), "utf8"));
  for (const project of ["@agent-commitments/runtime", "@agent-commitments/api"]) await new Promise((resolve, reject) => {
    const pnpmCommand = process.platform === "win32" ? process.env.ComSpec : "pnpm";
    const pnpmArgs = process.platform === "win32"
      ? ["/d", "/s", "/c", `pnpm --filter ${project} test:integration`]
      : ["--filter", project, "test:integration"];
    const child = spawn(pnpmCommand, pnpmArgs, {
      stdio: "inherit", shell: false, env: { ...process.env, TEST_DATABASE_URL: url },
    });
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${project} integration tests failed with exit code ${code}`)));
  });
} finally {
  await pool.end();
  if (dockerStarted) run("docker", ["compose", "stop", "postgres"]);
}
