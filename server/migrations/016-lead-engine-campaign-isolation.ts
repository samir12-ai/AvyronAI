import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export async function up(db: PostgresJsDatabase<any>) {
  await db.execute(sql`
    ALTER TABLE lead_forms ADD COLUMN campaign_id VARCHAR(255) REFERENCES growth_campaigns(id) ON DELETE CASCADE;
    ALTER TABLE landing_pages ADD COLUMN campaign_id VARCHAR(255) REFERENCES growth_campaigns(id) ON DELETE CASCADE;
    ALTER TABLE funnel_definitions ADD COLUMN campaign_id VARCHAR(255) REFERENCES growth_campaigns(id) ON DELETE CASCADE;
    ALTER TABLE lead_magnets ADD COLUMN campaign_id VARCHAR(255) REFERENCES growth_campaigns(id) ON DELETE CASCADE;
  `);
}

export async function down(db: PostgresJsDatabase<any>) {
  await db.execute(sql`
    ALTER TABLE lead_forms DROP COLUMN IF EXISTS campaign_id;
    ALTER TABLE landing_pages DROP COLUMN IF EXISTS campaign_id;
    ALTER TABLE funnel_definitions DROP COLUMN IF EXISTS campaign_id;
    ALTER TABLE lead_magnets DROP COLUMN IF EXISTS campaign_id;
  `);
}
