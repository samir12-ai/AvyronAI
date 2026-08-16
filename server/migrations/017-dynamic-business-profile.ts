import { db } from "../db";
import { sql } from "drizzle-orm";

export async function up() {
  await db.execute(sql`
    ALTER TABLE business_data_layer
    ADD COLUMN IF NOT EXISTS business_model VARCHAR(50) DEFAULT 'service',
    ADD COLUMN IF NOT EXISTS hero_product TEXT,
    ADD COLUMN IF NOT EXISTS product_specs TEXT,
    ADD COLUMN IF NOT EXISTS end_consumer_use_case TEXT,
    ADD COLUMN IF NOT EXISTS replaced_competitor TEXT;
  `);
}

export async function down() {
  await db.execute(sql`
    ALTER TABLE business_data_layer
    DROP COLUMN IF EXISTS business_model,
    DROP COLUMN IF EXISTS hero_product,
    DROP COLUMN IF EXISTS product_specs,
    DROP COLUMN IF EXISTS end_consumer_use_case,
    DROP COLUMN IF EXISTS replaced_competitor;
  `);
}
