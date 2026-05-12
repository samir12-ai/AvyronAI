/**
 * Seal #7 (Task #25 / F10.1, F10.10) — Migration runner with advisory lock.
 *
 * Replaces the 13 inline migration calls in server/index.ts:530-544. Those
 * ran in PARALLEL on every boot, fired-and-forgotten with .catch(console.error).
 * Two consequences:
 *   1. Two replicas booting at the same time raced each other — the
 *      ALTER TABLE / CREATE INDEX statements would conflict (especially the
 *      non-CONCURRENTLY ones) and one replica would silently end up with a
 *      half-applied schema.
 *   2. .catch(console.error) meant a failed migration didn't stop boot —
 *      the server would happily start serving requests against an
 *      incompatible schema.
 *
 * Fix:
 *   • pg_try_advisory_lock(8675309) — only one replica applies migrations
 *     at a time. Other replicas wait briefly, see no work to do, proceed.
 *   • schema_migrations table tracks applied versions. Lazily-created.
 *   • Files in server/migrations/sql/<NNN>_<name>.sql applied in numeric
 *     order. Each file is one transaction (with an opt-out comment for
 *     CONCURRENTLY ops, see SQL_NO_TXN_MARKER).
 *   • Boot calls runMigrations() and AWAITS it. Failure → process.exit(1).
 *   • The legacy TS migrations (002-014) are wrapped in 014a_legacy_compat.ts
 *     — they remain idempotent (IF NOT EXISTS / IF EXISTS) so re-running is
 *     safe; we invoke them sequentially after the SQL files.
 *
 * REQUIRED_SCHEMA_VERSION: bump this when application code requires a new
 * column / index that ships in an SQL migration. Boot refuses to start if
 * schema_migrations.last_applied_version < REQUIRED.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { Pool, PoolClient } from "pg";

/**
 * SQL migration files placed here. Convention: NNN_short_name.sql
 * NNN is a zero-padded integer. Files are applied in numeric-asc order.
 * Default mode: each file is wrapped in a single TX. To opt out (e.g. for
 * CREATE INDEX CONCURRENTLY) start the file with the literal first line:
 *   -- noTransaction
 */
const SQL_DIR = path.resolve(process.cwd(), "server", "migrations", "sql");
const SQL_NO_TXN_MARKER = "-- noTransaction";
const ADVISORY_LOCK_KEY = 8675309;

/**
 * Bump when application code starts depending on a new schema element.
 * Boot reads schema_migrations.last_applied_version; if < REQUIRED, refuses
 * to serve. This prevents a v1.7 binary from starting against a v1.6 DB.
 */
export const REQUIRED_SCHEMA_VERSION = 16;

interface RunnerOptions {
  /** Defaults to DATABASE_URL. */
  databaseUrl?: string;
  /** When true (set by `npm run db:migrate`), apply pending and exit. */
  exitOnComplete?: boolean;
  /** Skip the legacy TS-migration step (used by tests). */
  skipLegacy?: boolean;
}

interface MigrationFile {
  version: number;
  name: string;
  filePath: string;
  noTransaction: boolean;
}

function listSqlMigrations(): MigrationFile[] {
  if (!fs.existsSync(SQL_DIR)) return [];
  const files = fs.readdirSync(SQL_DIR).filter((f) => /^\d+_.+\.sql$/.test(f));
  const out: MigrationFile[] = [];
  for (const f of files) {
    const m = /^(\d+)_(.+)\.sql$/.exec(f);
    if (!m) continue;
    const version = parseInt(m[1], 10);
    const filePath = path.join(SQL_DIR, f);
    const head = fs.readFileSync(filePath, "utf-8").split("\n", 1)[0].trim();
    out.push({
      version,
      name: m[2],
      filePath,
      noTransaction: head === SQL_NO_TXN_MARKER,
    });
  }
  out.sort((a, b) => a.version - b.version);
  return out;
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      duration_ms INTEGER NOT NULL DEFAULT 0,
      checksum TEXT
    );
  `);
}

async function getAppliedVersions(client: PoolClient): Promise<Set<number>> {
  const r = await client.query<{ version: number }>("SELECT version FROM schema_migrations");
  return new Set(r.rows.map((row) => row.version));
}

export async function getLastAppliedVersion(databaseUrl?: string): Promise<number> {
  const pool = new Pool({ connectionString: databaseUrl ?? process.env.DATABASE_URL });
  try {
    const c = await pool.connect();
    try {
      await ensureMigrationsTable(c);
      const r = await c.query<{ max: number | null }>("SELECT MAX(version) AS max FROM schema_migrations");
      return r.rows[0]?.max ?? 0;
    } finally {
      c.release();
    }
  } finally {
    await pool.end();
  }
}

/**
 * Apply a single migration file. Honors -- noTransaction marker for
 * CREATE INDEX CONCURRENTLY (which cannot run inside a TX).
 */
async function applyOne(client: PoolClient, m: MigrationFile): Promise<number> {
  const sql = fs.readFileSync(m.filePath, "utf-8");
  const t0 = Date.now();
  if (m.noTransaction) {
    // node-pg's simple query protocol wraps multi-statement strings in an
    // implicit transaction. CREATE INDEX CONCURRENTLY refuses to run inside
    // any transaction (even an implicit one). Solution: parse the file into
    // individual statements and execute each on its own. Statements are
    // split on `;` at end-of-line; comment-only lines are stripped first.
    const statements = sql
      .split("\n")
      .filter((line) => !/^\s*--/.test(line))
      .join("\n")
      .split(/;\s*(?:\n|$)/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      await client.query(stmt);
    }
  } else {
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    }
  }
  const dur = Date.now() - t0;
  await client.query(
    "INSERT INTO schema_migrations (version, name, duration_ms) VALUES ($1, $2, $3) ON CONFLICT (version) DO NOTHING",
    [m.version, m.name, dur],
  );
  return dur;
}

/**
 * The legacy TS migrations (002-014) ship as imperative TS modules. They
 * are all idempotent (IF NOT EXISTS / IF EXISTS) so re-running on every
 * boot is safe. We invoke them sequentially under the advisory lock so two
 * replicas can't race them. Once converted to SQL files we'll drop this.
 */
async function runLegacyTsMigrations(): Promise<void> {
  const { migrateStrategyMemoryColumns } = await import("./002-strategy-memory-columns");
  const { migrateUserChannelTables } = await import("./003-user-channel-tables");
  const { migrateMemoryConfidenceDirection } = await import("./004-memory-confidence-direction");
  const { migrateCalendarExplorationFields } = await import("./005-calendar-exploration-fields");
  const { migrateRhythmSnapshotColumns } = await import("./006-rhythm-snapshot-columns");
  const { migrateBuildPlanSnapshots } = await import("./007-build-plan-snapshots");
  const { migrateDecisionAttribution } = await import("./008-decision-attribution");
  const { migrateMemoryOutcomeProvenance } = await import("./009-memory-outcome-provenance");
  const { runMigration010 } = await import("./010-tiktok-validation-columns");
  const { migrateSystemControlVerdicts } = await import("./011-system-control-verdicts");
  const { migrateTenantIsolationAccountId } = await import("./012-tenant-isolation-accountid");
  const { migrateAuthHardening } = await import("./013-auth-hardening");
  const { migrateScrapeSecurity } = await import("./014-scrape-security");

  const steps: Array<[string, () => Promise<void>]> = [
    ["002-strategy-memory-columns", migrateStrategyMemoryColumns],
    ["003-user-channel-tables", migrateUserChannelTables],
    ["004-memory-confidence-direction", migrateMemoryConfidenceDirection],
    ["005-calendar-exploration-fields", migrateCalendarExplorationFields],
    ["006-rhythm-snapshot-columns", migrateRhythmSnapshotColumns],
    ["007-build-plan-snapshots", migrateBuildPlanSnapshots],
    ["008-decision-attribution", migrateDecisionAttribution],
    ["009-memory-outcome-provenance", migrateMemoryOutcomeProvenance],
    ["010-tiktok-validation-columns", runMigration010],
    ["011-system-control-verdicts", migrateSystemControlVerdicts],
    ["012-tenant-isolation-accountid", migrateTenantIsolationAccountId],
    ["013-auth-hardening", migrateAuthHardening],
    ["014-scrape-security", migrateScrapeSecurity],
  ];

  for (const [name, fn] of steps) {
    const t0 = Date.now();
    try {
      await fn();
      console.log(`[Migrations] legacy ${name} ok (${Date.now() - t0}ms)`);
    } catch (err) {
      console.error(`[Migrations] legacy ${name} FAILED:`, err);
      throw err;
    }
  }
}

export async function runMigrations(opts: RunnerOptions = {}): Promise<{ applied: MigrationFile[]; lastVersion: number }> {
  const pool = new Pool({ connectionString: opts.databaseUrl ?? process.env.DATABASE_URL });
  const client = await pool.connect();
  const applied: MigrationFile[] = [];

  try {
    // Advisory lock — BLOCKING. Per architect-review: pg_try_advisory_lock
    // with a "skip after timeout, trust the other replica" branch is unsafe
    // because we can't actually verify the other replica completed the
    // pending migration before we proceed to read schema state. Use the
    // blocking pg_advisory_lock so we wait deterministically; only one
    // replica can hold the lock at a time, and we always observe a
    // consistent post-migration state when we resume.
    //
    // pg's statement_timeout does not apply to advisory-lock waits, so we
    // bound the wait with a Promise.race against an explicit timeout. On
    // timeout we throw — boot fails loudly rather than racing the other
    // replica.
    const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
    const lockAcquired = client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    const lockTimeout = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `[Migrations] could not acquire advisory lock ${ADVISORY_LOCK_KEY} within ${LOCK_TIMEOUT_MS}ms — another instance may be stuck. Refusing to boot.`,
            ),
          ),
        LOCK_TIMEOUT_MS,
      ),
    );
    await Promise.race([lockAcquired, lockTimeout]);

    try {
      await ensureMigrationsTable(client);
      const alreadyApplied = await getAppliedVersions(client);
      const all = listSqlMigrations();
      const pending = all.filter((m) => !alreadyApplied.has(m.version));

      if (pending.length === 0) {
        console.log(`[Migrations] up-to-date (${all.length} sql migrations on disk, 0 pending)`);
      } else {
        console.log(`[Migrations] applying ${pending.length} pending sql migration(s)…`);
        for (const m of pending) {
          const dur = await applyOne(client, m);
          console.log(`[Migrations] applied ${m.version}_${m.name} (${dur}ms)`);
          applied.push(m);
        }
      }

      if (!opts.skipLegacy) {
        // Legacy TS migrations — already idempotent. Run sequentially.
        await runLegacyTsMigrations();
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => undefined);
    }

    const lastVersion = await (async () => {
      const r = await client.query<{ max: number | null }>("SELECT MAX(version) AS max FROM schema_migrations");
      return r.rows[0]?.max ?? 0;
    })();

    if (lastVersion < REQUIRED_SCHEMA_VERSION && !opts.skipLegacy) {
      // The runner just ran. If we still don't meet the floor, the SQL files
      // on disk don't match the code's REQUIRED_SCHEMA_VERSION constant.
      // Refuse to boot — better than silently serving against an older schema.
      throw new Error(
        `[Migrations] DB schema_migrations.max=${lastVersion} < REQUIRED_SCHEMA_VERSION=${REQUIRED_SCHEMA_VERSION}. Disk migration files insufficient. Refusing to boot.`,
      );
    }

    return { applied, lastVersion };
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Seal #7 / F10.1 pass-4 — boot-time schema-floor verification.
 *
 * Used by `server/index.ts` when `BOOT_AUTO_MIGRATE=false` (multi-instance
 * deployments where `npm run db:migrate` is part of the deploy pipeline,
 * not the boot path). Reads `MAX(version)` from `schema_migrations` under
 * a NON-blocking advisory-lock-free read and throws if the result is less
 * than `REQUIRED_SCHEMA_VERSION` so the process exits before accepting
 * traffic. Does NOT mutate schema.
 */
export async function verifySchemaFloor(opts: { databaseUrl?: string } = {}): Promise<{ lastVersion: number }> {
  const pool = new Pool({ connectionString: opts.databaseUrl ?? process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    // Defensive: ensure the table exists. If a brand-new DB has never had
    // the runner applied to it, surface a clear error instead of an opaque
    // "relation does not exist" from MAX(version).
    const exists = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists",
    );
    if (!exists.rows[0]?.exists) {
      throw new Error(
        "[Migrations] schema_migrations table does not exist — run `npm run db:migrate` before starting the server.",
      );
    }
    const r = await client.query<{ max: number | null }>(
      "SELECT MAX(version) AS max FROM schema_migrations",
    );
    const lastVersion = Number(r.rows[0]?.max ?? 0);
    if (lastVersion < REQUIRED_SCHEMA_VERSION) {
      throw new Error(
        `[Migrations] DB schema_migrations.max=${lastVersion} < REQUIRED_SCHEMA_VERSION=${REQUIRED_SCHEMA_VERSION}. ` +
          `Run \`npm run db:migrate\` before starting the server.`,
      );
    }
    return { lastVersion };
  } finally {
    client.release();
    await pool.end();
  }
}

/** CLI entry — `npx tsx server/migrations/runner.ts`. */
if (typeof require !== "undefined" && require.main === module) {
  runMigrations({ exitOnComplete: true })
    .then((r) => {
      console.log(`[Migrations] CLI complete — applied ${r.applied.length}, lastVersion=${r.lastVersion}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[Migrations] CLI failed:", err);
      process.exit(1);
    });
}
