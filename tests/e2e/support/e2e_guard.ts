import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

// Types for manifest-based cleanup
export interface E2EFixtureManifest {
  accountIds: string[];
  campaignIds: string[];
  competitorIds: string[];
  postIds: string[];
  classificationIds: string[];
  snapshotIds: string[];
  eventIds: string[];
  fetchJobIds: string[];
  scheduleIds: string[];
  runIds: string[];
}

export const createEmptyManifest = (): E2EFixtureManifest => ({
  accountIds: [], campaignIds: [], competitorIds: [], postIds: [],
  classificationIds: [], snapshotIds: [], eventIds: [], fetchJobIds: [],
  scheduleIds: [], runIds: []
});

export class E2ESafeguardError extends Error {
  constructor(message: string) {
    super(`[E2E_SAFEGUARD_ERROR] ${message}`);
  }
}

export function validateFixtureId(id: string | null | undefined, expectedPrefix: string = 'e2e_') {
  if (!id) return; // Allow nulls if field is nullable
  if (!id.startsWith(expectedPrefix)) {
    throw new E2ESafeguardError(`ID "${id}" does not start with required prefix "${expectedPrefix}"`);
  }
}

let verifiedPool: Pool | null = null;
let verifiedDb: ReturnType<typeof drizzle> | null = null;

export async function initializeE2EDatabase() {
  if (verifiedPool && verifiedDb) return { pool: verifiedPool, db: verifiedDb };

  if (process.env.NODE_ENV !== "test") {
    throw new E2ESafeguardError("NODE_ENV must be 'test'. 'development' is not sufficient authorization.");
  }
  if (process.env.E2E_SAFEGUARD !== "true") {
    throw new E2ESafeguardError("E2E_SAFEGUARD environment variable must be exactly 'true'.");
  }
  if (!process.env.E2E_DATABASE_URL) {
    throw new E2ESafeguardError("E2E_DATABASE_URL is explicitly required.");
  }
  
  const standardDbUrl = process.env.DATABASE_URL || "";
  const e2eDbUrl = process.env.E2E_DATABASE_URL;

  if (standardDbUrl && e2eDbUrl === standardDbUrl) {
    throw new E2ESafeguardError("E2E_DATABASE_URL cannot be identical to DATABASE_URL.");
  }
  if (e2eDbUrl.includes("ep-twilight-night-asou49te")) {
    throw new E2ESafeguardError("Active known production branch (ep-twilight-night-asou49te) is hard-blocked.");
  }

  const pool = new Pool({ connectionString: e2eDbUrl });
  
  // Database Identity Verification
  const idRes = await pool.query(`
    SELECT 
      current_database() as dbname, 
      current_user as user,
      inet_server_addr() as server_addr,
      current_setting('application_name') as app_name,
      current_setting('server_version') as version
  `);
  const identity = idRes.rows[0];
  
  console.log("[E2E_GUARD] Database Identity Verification:");
  console.log(`- Database Name: ${identity.dbname}`);
  console.log(`- Current User: ${identity.user}`);
  console.log(`- Server Address: ${identity.server_addr || 'local/socket'}`);
  console.log(`- Application Name: ${identity.app_name}`);
  
  // Example allowlist enforcement: Only allow test databases
  if (!identity.dbname.includes("test") && !identity.dbname.includes("e2e")) {
     // For safety, require 'test' or 'e2e' in the db name.
     if (!e2eDbUrl.includes("test") && !e2eDbUrl.includes("e2e") && !e2eDbUrl.includes("local")) {
       pool.end();
       throw new E2ESafeguardError(`Database "${identity.dbname}" not in isolated allowlist.`);
     }
  }

  console.log("E2E DATABASE VERIFIED");
  
  verifiedPool = pool;
  verifiedDb = drizzle(pool);
  
  return { pool: verifiedPool, db: verifiedDb };
}

export function isDryRun(): boolean {
  const args = process.argv.slice(2);
  const hasApply = args.includes("--apply");
  const hasConfirm = args.includes("--confirm=E2E_ONLY_DESTRUCTIVE_WRITE");
  return !(hasApply && hasConfirm);
}

export async function withE2ETransaction<T>(
  operationName: string,
  manifest: E2EFixtureManifest,
  callback: (tx: any, dryRun: boolean) => Promise<T>
): Promise<T | void> {
  const { db } = await initializeE2EDatabase();
  const dryRun = isDryRun();
  
  console.log(`\n=== E2E OPERATION: ${operationName} ===`);
  if (dryRun) {
    console.log("MODE: DRY-RUN (No writes will be committed)");
  } else {
    console.log("MODE: DESTRUCTIVE WRITE");
  }

  // Pre-flight check: validate manifest IDs
  for (const [key, ids] of Object.entries(manifest)) {
    for (const id of ids as string[]) {
      validateFixtureId(id);
    }
  }

  return await db.transaction(async (tx) => {
    try {
      const result = await callback(tx, dryRun);
      
      if (dryRun) {
        console.log(`[DRY-RUN] ${operationName} simulated successfully. Rolling back.`);
        tx.rollback(); 
      }
      
      console.log(`[COMMIT] ${operationName} successful.`);
      return result;
    } catch (err: any) {
      console.error(`[ROLLBACK] ${operationName} failed: ${err.message}`);
      throw err; // Drizzle will automatically rollback when the callback throws
    }
  });
}

// Helpers for exact row counts and IDs
export function assertExpectedRowCount(result: any, expectedCount: number, context: string) {
  let count = -1;
  // Handle node-postgres raw result vs drizzle returning array
  if (Array.isArray(result)) {
    count = result.length;
  } else if (result && typeof result.rowCount === 'number') {
    count = result.rowCount;
  }
  
  if (count !== expectedCount) {
    throw new E2ESafeguardError(`Row count mismatch in ${context}. Expected ${expectedCount}, got ${count}. Rolling back.`);
  }
  console.log(`[GUARD] Verified ${count} rows affected in ${context}.`);
}

export function assertExactReturnedIds(returnedRows: any[], expectedIds: string[], context: string) {
  if (returnedRows.length !== expectedIds.length) {
    throw new E2ESafeguardError(`Row count mismatch in ${context}. Expected ${expectedIds.length}, got ${returnedRows.length}. Rolling back.`);
  }
  
  const returnedSet = new Set(returnedRows.map(r => r.id));
  for (const expectedId of expectedIds) {
    if (!returnedSet.has(expectedId)) {
      throw new E2ESafeguardError(`Exact ID mismatch in ${context}. Expected ID ${expectedId} was not affected. Rolling back.`);
    }
  }
  console.log(`[GUARD] Verified exact ${expectedIds.length} IDs affected in ${context}.`);
}

export async function cleanupManifest(tx: any, manifest: E2EFixtureManifest, dryRun: boolean) {
  // If the manifest is missing or completely empty, abort.
  const totalIds = Object.values(manifest).reduce((acc, curr) => acc + curr.length, 0);
  if (totalIds === 0) {
    throw new E2ESafeguardError("Manifest is missing or empty. Cleanup aborted to prevent broad deletion.");
  }
  
  const { inArray } = require('drizzle-orm');
  const { pipelineChangeEvents, pipelineSnapshots, ciCompetitorPosts, competitorPostClassifications, ciCompetitors, growthCampaigns } = require('../../../shared/schema');
  
  const deleteAndVerify = async (table: any, ids: string[], tableName: string) => {
    if (ids.length === 0) return;
    
    if (dryRun) {
      console.log(`[DRY-RUN] Would delete ${ids.length} rows from ${tableName} (IDs: ${ids.join(', ')})`);
      return;
    }

    const result = await tx.delete(table).where(inArray(table.id, ids)).returning({ id: table.id });
    assertExactReturnedIds(result, ids, `cleanup of ${tableName}`);
  };

  // Delete in correct foreign-key dependency order
  await deleteAndVerify(pipelineChangeEvents, manifest.eventIds, "pipeline_change_events");
  await deleteAndVerify(pipelineSnapshots, manifest.snapshotIds, "pipeline_snapshots");
  await deleteAndVerify(competitorPostClassifications, manifest.classificationIds, "competitor_post_classifications");
  await deleteAndVerify(ciCompetitorPosts, manifest.postIds, "ci_competitor_posts");
  await deleteAndVerify(ciCompetitors, manifest.competitorIds, "ci_competitors");
  await deleteAndVerify(growthCampaigns, manifest.campaignIds, "growth_campaigns");
  
  console.log(`[GUARD] Manifest cleanup complete.`);
}
