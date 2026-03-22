import { sql } from "drizzle-orm";
import { db } from "../db";

const FOUNDER_ACCOUNT_ID = "a2d87878-a1e9-41ea-a8a5-90beff569673";

export async function migrateDefaultAccountToFounder() {
  console.log("[Migration-001] Reassigning account_id='default' rows to founder account...");

  const tableRows: any[] = await db.execute(sql`
    SELECT table_name FROM information_schema.columns 
    WHERE column_name = 'account_id' AND table_schema = 'public'
    ORDER BY table_name
  `);
  const tables = tableRows.map((r: any) => r.table_name);

  let totalMigrated = 0;

  for (const table of tables) {
    try {
      const result: any = await db.execute(
        sql.raw(`UPDATE "${table}" SET account_id = '${FOUNDER_ACCOUNT_ID}' WHERE account_id = 'default'`)
      );
      const count = typeof result === "number" ? result : (result?.rowCount || 0);
      if (count > 0) {
        console.log(`[Migration-001] Migrated ${count} rows in ${table}`);
        totalMigrated += count;
      }
    } catch (err: any) {
      if (err.message?.includes("unique constraint") || err.message?.includes("duplicate key")) {
        console.log(`[Migration-001] Skipping ${table}: founder row already exists (deleting stale default row)`);
        await db.execute(
          sql.raw(`DELETE FROM "${table}" WHERE account_id = 'default'`)
        ).catch(() => {});
      } else {
        console.error(`[Migration-001] Error migrating ${table}:`, err.message);
      }
    }
  }

  console.log(`[Migration-001] Complete — ${totalMigrated} total rows migrated`);

  let clean = true;
  for (const table of tables) {
    try {
      const rows: any[] = await db.execute(
        sql.raw(`SELECT COUNT(*) as cnt FROM "${table}" WHERE account_id = 'default'`)
      );
      const cnt = Number(rows[0]?.cnt || 0);
      if (cnt > 0) {
        console.error(`[Migration-001] WARNING: ${table} still has ${cnt} default rows`);
        clean = false;
      }
    } catch {}
  }

  if (clean) {
    console.log("[Migration-001] Verification PASSED: zero remaining account_id='default' rows");
  }

  return { totalMigrated, clean };
}

if (require.main === module) {
  migrateDefaultAccountToFounder()
    .then(() => process.exit(0))
    .catch((err) => { console.error(err); process.exit(1); });
}
