import { db } from "../server/db";
import { businessDataLayer } from "../shared/schema";
import { eq } from "drizzle-orm";
import { deriveAnchorFromProductDna } from "../server/shared/strategic-doctrine";
import { writeProductAnchorAudited } from "../server/shared/product-anchor-writer";

async function main() {
  const campaignId = "campaign_1786718877499_3jk4zv";
  const rows = await db.select().from(businessDataLayer).where(eq(businessDataLayer.campaignId, campaignId));
  if (rows.length === 0) { console.log("no row"); process.exit(1); }
  
  const anchor = deriveAnchorFromProductDna(rows[0] as any);
  if (anchor) {
    await writeProductAnchorAudited({
      campaignId,
      accountId: rows[0].accountId,
      writer: "script",
      source: "operator_cleanup",
      reason: "Populate missing anchor from valid business_data_layer",
      newAnchor: anchor,
      validationDecision: "SCHEMA_VALID"
    });
    console.log("FIXED ANCHOR!");
  } else {
    console.log("COULD NOT DERIVE");
  }
  process.exit(0);
}
main().catch(console.error);
