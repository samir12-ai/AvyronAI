import 'dotenv/config';
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("=== INVALIDATING SYNTHETIC-CONTAMINATED WATCHTOWER EVENTS ===");

  const targetIds = [
    "wt_1787326595001_w1d1xx9", // GenericAI Marketing (campaign_1773576062201_6t0oxi)
    "wt_1787326557646_s2pp9wm", // GenericAI Marketing (campaign_1773576062201_6t0oxi)
  ];

  for (const id of targetIds) {
    const existing = await db.execute(sql`SELECT * FROM pipeline_change_events WHERE id = ${id}`);
    if (existing.rows.length > 0) {
      const row = existing.rows[0] as any;
      let evidenceParsed = typeof row.evidence === 'string' ? JSON.parse(row.evidence) : (row.evidence || {});
      evidenceParsed.invalidationReason = "invalidated_synthetic_scrape_fallback";
      evidenceParsed.invalidatedAt = new Date().toISOString();

      await db.execute(sql`
        UPDATE pipeline_change_events
        SET status = 'dismissed',
            evidence = ${JSON.stringify(evidenceParsed)},
            updated_at = NOW()
        WHERE id = ${id}
      `);
      console.log(`[Invalidated] Event ${id} -> status: dismissed (invalidationReason: invalidated_synthetic_scrape_fallback)`);
    } else {
      console.log(`[Not Found] Event ${id}`);
    }
  }

  process.exit(0);
}

main();
