import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();

  try {
    const accountId = "f020f6c7-15d8-4129-90a6-83a40558c642";
    const campaignId = "camp_mtewrp8kkom3";

    // 12 unique approved competitors
    const targetCompetitors = [
      { name: "Amar Beirut", domain: "amar-beirut.com" },
      { name: "Abayas Boutique", domain: "abayasboutique.com" },
      { name: "Abayaboutiquelb", domain: "instagram.com/_abayaboutiquelb" },
      { name: "Modern Hijabi", domain: "modernhijabi.com" },
      { name: "Modern Abayati", domain: "modern-abayati.com" },
      { name: "Niswa Fashion", domain: "niswafashion.com" },
      { name: "Abayas Online", domain: "abayabuth.com" },
      { name: "BNAH", domain: "nouralhouda.com.au" },
      { name: "Aab", domain: "aabcollection.com" },
      { name: "Lameeramoda", domain: "lameeramoda.com" },
      { name: "Guava Lebanon", domain: "guavaonlineshop.com" },
      { name: "Online Shopping in Lebanon", domain: "shopwithabc.com" },
    ];

    console.log("=== DETAILED MATRIX AUDIT FOR 12 APPROVED COMPETITORS ===");
    for (const comp of targetCompetitors) {
      console.log(`\n======================================================`);
      console.log(`COMPETITOR: ${comp.name} (${comp.domain})`);

      // Find all matching rows in ci_competitors
      const cRows = await client.query(`
        SELECT id, name, platform, profile_link, website_url, tiktok_url, blog_url, google_maps_url, notes, created_at
        FROM ci_competitors
        WHERE account_id = $1 AND (website_url ILIKE $2 OR profile_link ILIKE $2 OR name ILIKE $3)
        ORDER BY created_at DESC
      `, [accountId, `%${comp.domain}%`, `%${comp.name}%`]);

      const compIds = cRows.rows.map((r: any) => r.id);
      console.log(`Matching ci_competitors rows: ${cRows.rows.length} (IDs: ${compIds.join(", ")})`);

      // Manifest sources from the latest row
      let manifestSources: any = {};
      if (cRows.rows[0]?.notes) {
        try {
          const m = JSON.parse(cRows.rows[0].notes);
          manifestSources = m.sources || {};
        } catch {}
      }

      // Check each source channel
      const channels = ["website", "instagram", "tiktok", "linkedin", "x", "google_search", "reviews", "blog"] as const;
      for (const ch of channels) {
        const ms = manifestSources[ch] || { status: "NOT_FOUND", url: null };
        
        // Check actual DB evidence
        let dbEvidenceCount = 0;
        let dbDetail = "";

        if (ch === "website") {
          if (compIds.length > 0) {
            const idList = compIds.map((id: string) => `'${id}'`).join(",");
            const w = await client.query(`SELECT count(*) as count FROM competitor_website_snapshots WHERE competitor_id IN (${idList})`);
            dbEvidenceCount = parseInt(w.rows[0].count);
            dbDetail = `${dbEvidenceCount} snapshot(s) in competitor_website_snapshots`;
          }
        } else if (ch === "instagram") {
          if (compIds.length > 0) {
            const idList = compIds.map((id: string) => `'${id}'`).join(",");
            const p = await client.query(`SELECT count(*) as count FROM ci_competitor_posts WHERE competitor_id IN (${idList}) AND (platform = 'instagram' OR platform IS NULL)`);
            dbEvidenceCount = parseInt(p.rows[0].count);
            dbDetail = `${dbEvidenceCount} post(s) in ci_competitor_posts`;
          }
        } else if (ch === "tiktok") {
          if (compIds.length > 0) {
            const idList = compIds.map((id: string) => `'${id}'`).join(",");
            const p = await client.query(`SELECT count(*) as count FROM ci_competitor_posts WHERE competitor_id IN (${idList}) AND platform = 'tiktok'`);
            dbEvidenceCount = parseInt(p.rows[0].count);
            dbDetail = `${dbEvidenceCount} post(s) in ci_competitor_posts`;
          }
        } else if (ch === "reviews") {
          if (compIds.length > 0) {
            const idList = compIds.map((id: string) => `'${id}'`).join(",");
            const r = await client.query(`SELECT count(*) as count FROM ci_competitor_reviews WHERE competitor_id IN (${idList})`);
            dbEvidenceCount = parseInt(r.rows[0].count);
            dbDetail = `${dbEvidenceCount} review(s) in ci_competitor_reviews`;
          }
        } else if (ch === "blog") {
          // Check if blog was scraped
          dbEvidenceCount = 0;
          dbDetail = "0 articles (no dedicated blog table)";
        } else if (ch === "linkedin" || ch === "x" || ch === "google_search") {
          dbEvidenceCount = 0;
          dbDetail = "0 rows (no dedicated provider fetch/table)";
        }

        // Determine granular status:
        // DISCOVERED, VERIFIED, FIRST_FETCH_PENDING, FIRST_FETCH_RUNNING, FETCH_SUCCESS, FETCH_FAILED,
        // SNAPSHOT_PERSISTED, NORMALIZED, AVAILABLE_TO_SGL, NOT_FOUND, PROVIDER_UNAVAILABLE, INSUFFICIENT_EVIDENCE
        let granularStatus = "NOT_FOUND";
        if (ms.status === "NOT_FOUND") {
          granularStatus = "NOT_FOUND";
        } else if (ms.status === "PROVIDER_UNAVAILABLE") {
          granularStatus = "PROVIDER_UNAVAILABLE";
        } else if (ms.status === "VERIFIED") {
          if (ch === "website") {
            granularStatus = dbEvidenceCount > 0 ? "AVAILABLE_TO_SGL" : "FETCH_FAILED";
          } else if (ch === "instagram") {
            if (dbEvidenceCount > 0) {
              granularStatus = "AVAILABLE_TO_SGL"; // Available in posts table
            } else {
              granularStatus = "DISCOVERED_NO_FETCH";
            }
          } else if (ch === "tiktok") {
            if (dbEvidenceCount > 0) {
              granularStatus = "AVAILABLE_TO_SGL";
            } else {
              granularStatus = "DISCOVERED_NO_FETCH";
            }
          } else if (ch === "reviews") {
            if (dbEvidenceCount > 0) {
              granularStatus = "AVAILABLE_TO_SGL";
            } else {
              granularStatus = "DISCOVERED_NO_FETCH";
            }
          } else if (ch === "linkedin" || ch === "x") {
            granularStatus = "PROVIDER_NOT_PRODUCTION_READY";
          } else if (ch === "google_search") {
            granularStatus = "DISCOVERY_ONLY_NO_RECURRING";
          } else if (ch === "blog") {
            granularStatus = "DISCOVERED_NO_FETCH";
          }
        }

        console.log(`  Source [${ch.padEnd(14)}]: Manifest=${ms.status.padEnd(12)} | URL=${(ms.url || "none").slice(0, 45).padEnd(45)} | DB=${dbDetail.padEnd(30)} | GranularStatus=${granularStatus}`);
      }
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
