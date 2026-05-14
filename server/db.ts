import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

// Seal #11 / Task #29 / F6.3 — pg.Pool tuning.
// Pre-fix: bare `new pg.Pool({ connectionString })` accepted unbounded
// concurrent connections (default max=10, but no statement_timeout, no
// connection-acquire timeout). A single slow query could starve the
// entire app of clients; a runaway analytic query had no upper bound.
// Now: max=20 (overridable), 10s acquire timeout, 30s idle reaper, and
// every checked-out client receives `SET statement_timeout = 30s` so any
// stray long-running query is killed by Postgres rather than holding a
// pool slot indefinitely.
const POOL_MAX = parseInt(process.env.DB_POOL_MAX || "20", 10);
const STATEMENT_TIMEOUT_MS = parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || "30000", 10);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number.isFinite(POOL_MAX) && POOL_MAX > 0 ? POOL_MAX : 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("connect", (client) => {
  client
    .query(`SET statement_timeout = ${STATEMENT_TIMEOUT_MS}`)
    .catch((err) => console.error("[db] statement_timeout SET failed:", err?.message || err));
});

pool.on("error", (err) => {
  console.error("[db] idle-client error:", err?.message || err);
});

export const db = drizzle(pool, { schema });
