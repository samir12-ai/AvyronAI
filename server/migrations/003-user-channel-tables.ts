import { sql } from "drizzle-orm";
import { db } from "../db";

export async function migrateUserChannelTables() {
  console.log("[Migration-003] Creating user_public_profiles and user_channel_snapshots tables...");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_public_profiles (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id varchar NOT NULL,
      campaign_id varchar NOT NULL,
      platform text NOT NULL,
      handle text,
      url text,
      added_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_channel_snapshots (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id varchar NOT NULL,
      campaign_id varchar NOT NULL,
      platform text NOT NULL,
      handle text,
      snapshot_data text,
      delta_from_previous text,
      scraped_at timestamp DEFAULT now()
    )
  `);

  console.log("[Migration-003] user_public_profiles and user_channel_snapshots tables ready.");
}
