import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const cols = await db.execute(sql`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'business_data_layer'
  `);
  console.log("Current columns:", cols.rows.map((r: any) => r.column_name));

  // Add missing columns if they don't exist
  await db.execute(sql`
    ALTER TABLE business_data_layer 
    ADD COLUMN IF NOT EXISTS business_model text,
    ADD COLUMN IF NOT EXISTS hero_product text,
    ADD COLUMN IF NOT EXISTS product_specs text,
    ADD COLUMN IF NOT EXISTS end_consumer_use_case text,
    ADD COLUMN IF NOT EXISTS replaced_competitor text;
  `);

  // Make core_offer nullable if it has a NOT NULL constraint
  await db.execute(sql`
    ALTER TABLE business_data_layer 
    ALTER COLUMN core_offer DROP NOT NULL;
  `);

  console.log("Migration executed successfully.");
  process.exit(0);
}

main().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
