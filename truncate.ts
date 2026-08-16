import { db } from "./server/db";
import { sql } from "drizzle-orm";

async function run() {
  console.log("Truncating studio_items...");
  await db.execute(sql`TRUNCATE TABLE studio_items CASCADE;`);
  console.log("Done");
  process.exit(0);
}
run().catch(console.error);
