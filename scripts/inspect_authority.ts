import "dotenv/config";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { loadMarketVoicePlannerContext } from "../server/market-voice/search-planner";

async function verifySaraFtLive() {
  console.log("============================================================");
  console.log("LIVE SARA-FT CANONICAL AUTHORITY VERIFICATION");
  console.log("============================================================");

  const campaignId = "camp_mtewrp8kkom3";
  const campaignOfferingId = "off_70677f8f-1";

  const [offering] = (await db.execute(sql`
    SELECT * FROM campaign_offerings WHERE id = ${campaignOfferingId} AND campaign_id = ${campaignId}
  `)).rows as any[];

  if (!offering) {
    throw new Error("Canonical offering not found!");
  }

  const [evidence] = (await db.execute(sql`
    SELECT * FROM offering_input_evidence WHERE id = ${offering.source_input_evidence_id}
  `)).rows as any[];

  if (!evidence) {
    throw new Error("Source input evidence not found!");
  }

  const accountLineageMatch = evidence.account_id === offering.account_id;
  const campaignLineageMatch = evidence.campaign_id === offering.campaign_id;
  const offeringLineageMatch = evidence.campaign_offering_id === offering.id;

  console.log(`campaignOfferingId: ${offering.id}`);
  console.log(`offeringName: "${offering.offering_name}"`);
  console.log(`sourceInputEvidenceId: ${offering.source_input_evidence_id}`);
  console.log(`evidenceAuthorityType: ${evidence.authority_type}`);
  console.log(`evidenceRawOfferingName: "${evidence.raw_offering_name}"`);
  console.log(`account lineage match: ${accountLineageMatch}`);
  console.log(`campaign lineage match: ${campaignLineageMatch}`);
  console.log(`offering lineage match: ${offeringLineageMatch}`);

  console.log("\nCalling loadMarketVoicePlannerContext(campaignId, campaignOfferingId)...");
  const ctx = await loadMarketVoicePlannerContext(campaignId, campaignOfferingId);
  console.log("loadMarketVoicePlannerContext Status: SUCCESS");
  console.log("Loaded Context Summary:");
  console.log(`- Hero Product Canonical Text: "${ctx.heroProductCanonicalText}"`);
  console.log(`- Hero Product Authority Source: ${ctx.heroProductAuthoritySource}`);
  console.log(`- Hero Product Authority ID: ${ctx.heroProductAuthorityId}`);
  console.log(`- Category: ${ctx.category}`);
  console.log(`- Target Market Geography: ${ctx.targetMarketGeography}`);
  console.log(`- Execution Date: ${ctx.currentDate}`);

  process.exit(0);
}

verifySaraFtLive().catch(console.error);

