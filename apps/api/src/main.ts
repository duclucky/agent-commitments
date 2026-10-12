import { buildServer } from "./server.js";
import { Pool } from "pg";
import { InMemoryApiStore, PostgresApiStore } from "./store.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const host = process.env.HOST ?? "127.0.0.1";
const chainId = Number.parseInt(process.env.ARC_CHAIN_ID ?? "5042", 10);
const audience = process.env.AUTH_AUDIENCE ?? "agent-commitments.local";
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : undefined;
const server = buildServer({ chainId, audience, store: pool ? new PostgresApiStore(pool) : new InMemoryApiStore() });
if (pool) server.addHook("onClose", async () => { await pool.end(); });

await server.listen({ port, host });
console.log(`Agent Commitments API listening on http://${host}:${port} with ${pool ? "PostgreSQL" : "in-memory development"} storage`);
