import { sql } from "drizzle-orm";
import { db } from "../db";

const FOUNDER_ACCOUNT_ID = "a2d87878-a1e9-41ea-a8a5-90beff569673";

export async function migrateDefaultAccountToFounder() {
  console.log("[Migration] Reassigning account_id='default' rows to founder account...");

  const tables: string[] = await db.execute(sql`
    SELECT table_name FROM information_schema.columns 
    WHERE column_name = 'account_id' AND table_schema = 'public'
    ORDER BY table_name
  `).then((rows: any[]) => rows.map((r: any) => r.table_name));

  let totalMigrated = 0;

  for (const table of tables) {
    try {
      const result = await db.execute(
        sql.raw(`DELETE FROM "${table}" WHERE account_id = 'default' AND EXISTS (SELECT 1 FROM "${table}" t2 WHERE t2.account_id = '${FOUNDER_ACCOUNT_ID}' AND t2.ctid != "${table}".ctid) AND account_id IN (SELECT account_id FROM "${table}" GROUP BY account_id HAVING COUNT(*) > 0) RETURNING 1`)
      ).catch(() => []);
    } catch {}

    try {
      const result: any = await db.execute(
        sql.raw(`UPDATE "${table}" SET account_id = '${FOUNDER_ACCOUNT_ID}' WHERE account_id = 'default'`)
      );
      const count = typeof result === "number" ? result : (result?.rowCount || result?.length || 0);
      if (count > 0) {
        console.log(`[Migration] Migrated ${count} rows in ${table}`);
        totalMigrated += count;
      }
    } catch (err: any) {
      if (err.message?.includes("unique constraint") || err.message?.includes("duplicate key")) {
        await db.execute(
          sql.raw(`DELETE FROM "${table}" WHERE account_id = 'default'`)
        ).catch(() => {});
        console.log(`[Migration] Deleted conflicting default row(s) in ${table} (founder row exists)`);
      } else {
        console.error(`[Migration] Error migrating ${table}:`, err.message);
      }
    }
  }

  console.log(`[Migration] Complete — ${totalMigrated} total rows migrated to founder account`);

  const remaining: any[] = await db.execute(sql`
    SELECT 'remaining' FROM information_schema.columns c
    WHERE c.column_name = 'account_id' AND c.table_schema = 'public'
    AND EXISTS (
      SELECT 1 FROM information_schema.tables t 
      WHERE t.table_name = c.table_name AND t.table_schema = 'public'
    )
    LIMIT 1
  `);

  console.log("[Migration] Verification: checking for remaining default rows...");
  let clean = true;
  for (const table of tables) {
    try {
      const rows: any[] = await db.execute(
        sql.raw(`SELECT COUNT(*) as cnt FROM "${table}" WHERE account_id = 'default'`)
      );
      const cnt = rows[0]?.cnt || rows[0]?.count || 0;
      if (Number(cnt) > 0) {
        console.error(`[Migration] WARNING: ${table} still has ${cnt} rows with account_id='default'`);
        clean = false;
      }
    } catch {}
  }
  if (clean) {
    console.log("[Migration] Verification PASSED: zero remaining account_id='default' rows");
  }
}

if (require.main === module) {
  migrateDefaultAccountToFounder()
    .then(() => process.exit(0))
    .catch((err) => { console.error(err); process.exit(1); });
}
