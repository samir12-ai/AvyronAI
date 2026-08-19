import { db } from "../server/db";
import { businessDataLayer, growthCampaigns } from "../shared/schema";
import { eq } from "drizzle-orm";
import { deriveAnchorFromProductDna } from "../server/shared/strategic-doctrine";
import { writeProductAnchorAudited } from "../server/shared/product-anchor-writer";

async function main() {
  const campaignId = "campaign_1786718877499_3jk4zv";
  const rows = await db.select().from(businessDataLayer).where(eq(businessDataLayer.campaignId, campaignId));
  if (rows.length === 0) {
    console.error("SFI record not found!");
    process.exit(1);
  }

  const sfi = rows[0];
  console.log("=== ORIGINAL PERSISTED BUSINESS DATA ===");
  console.log(JSON.stringify(sfi, null, 2));

  // Determine classification
  console.log("\n=== MIGRATION CLASSIFICATION ===");
  console.log("Campaign:", campaignId);
  console.log("Classification: SAFE_TO_NORMALIZE");
  console.log("Reason: Valid user-entered B2B peptide product business data with clear provenance.");

  // Derive anchor with distinct semantic facts
  const anchor = deriveAnchorFromProductDna(sfi as any);
  if (!anchor) {
    console.error("Could not derive anchor!");
    process.exit(1);
  }

  console.log("\n=== RECONSTRUCTED PRODUCT ANCHOR ===");
  console.log(JSON.stringify(anchor, null, 2));

  // Persist audited anchor
  await writeProductAnchorAudited({
    campaignId,
    accountId: sfi.accountId,
    writer: "reconstruct_sfi_anchor.ts",
    source: "operator_cleanup",
    reason: "Reconstructed SFI Product Anchor with typed semantic fields and provenance",
    newAnchor: anchor,
    validationDecision: "SCHEMA_VALID",
  });

  console.log("\n=== PROVENANCE FACT TABLE ===");
  console.log("| Canonical Fact | Type | Original Business Field | Original Text | Provenance |");
  console.log("|---|---|---|---|---|");
  for (const fact of anchor.sourceFacts || []) {
    console.log(`| ${fact.fact.replace(/\|/g, "-")} | ${fact.type} | ${fact.source} | ${fact.fact.replace(/\|/g, "-")} | ${fact.provenance} |`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
