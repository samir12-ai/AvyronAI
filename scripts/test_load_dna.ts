import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });

const CAMPAIGN = "campaign_1773576062201_6t0oxi";
const ACCOUNT = "a2d87878-a1e9-41ea-a8a5-90beff569673";

async function main() {
  const client = await pool.connect();
  try {
    const res = await client.query(
      "SELECT id, campaign_offering_id, business_understanding FROM business_understanding_snapshots WHERE campaign_id=$1 AND account_id=$2 ORDER BY created_at DESC LIMIT 1",
      [CAMPAIGN, ACCOUNT]
    );
    if (!res.rows[0]) {
      console.log("No snapshot found");
      return;
    }

    const row = res.rows[0];
    const data = typeof row.business_understanding === "string" ? JSON.parse(row.business_understanding) : row.business_understanding;
    const offering = data.campaignOffering || {};
    const target = data.targetUnderstanding || {};
    const targetRoles = Array.isArray(target.targetRoles) ? target.targetRoles : [];
    const productTruthFacts = Array.isArray(offering.productTruthFacts) ? offering.productTruthFacts : [];

    const decisionMakerRole = targetRoles.find((r: any) => r.roleType === "DECISION_MAKER")?.roleTitle
      || (targetRoles.length > 0 ? targetRoles[0].roleTitle : null);
    
    const buyerOrUserRole = targetRoles.find((r: any) => r.roleType === "BUYER" || r.roleType === "USER")?.roleTitle
      || (targetRoles.length > 1 ? targetRoles[1].roleTitle : decisionMakerRole);

    const capabilityFacts = productTruthFacts.filter((f: any) => f.factType === "CAPABILITY" || !f.factType);
    const uniqueMechanism = capabilityFacts.length > 0
      ? capabilityFacts.map((f: any) => f.statement).slice(0, 2).join("; ")
      : (offering.offeringName ? `${offering.offeringName} Core Capability` : null);

    const coreProblem = productTruthFacts.find((f: any) => f.statement.toLowerCase().includes("problem") || f.statement.toLowerCase().includes("struggle") || f.statement.toLowerCase().includes("fragmented") || f.statement.toLowerCase().includes("inefficiency"))?.statement
      || (offering.category ? `Challenges addressed by ${offering.category}` : null);

    const result = {
      productCategory: offering.category || data.generalIndustry || null,
      coreProblemSolved: coreProblem,
      uniqueMechanism,
      strategicAdvantage: capabilityFacts.length > 2 ? capabilityFacts[2].statement : null,
      targetDecisionMaker: decisionMakerRole,
      businessType: data.businessModel || offering.category || "B2B SaaS",
      coreOffer: offering.offeringName || data.businessName || "Offering",
      targetAudienceSegment: buyerOrUserRole || decisionMakerRole || "Target Market",
      priceRange: offering.pricingModel || "Subscription-based",
      campaignOfferingId: row.campaign_offering_id || offering.campaignOfferingId || undefined,
      businessUnderstandingAuthorityId: row.id || data.businessUnderstandingAuthorityId || undefined,
      targetUnderstandingAuthorityId: target.targetUnderstandingAuthorityId || undefined,
      targetRoles,
      productTruthFacts,
    };

    console.log("=== PARSED PRODUCT DNA RESULT ===");
    console.log(JSON.stringify(result, null, 2));

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
