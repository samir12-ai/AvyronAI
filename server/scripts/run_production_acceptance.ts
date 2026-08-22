import 'dotenv/config';
import { db } from "../db";
import { 
  websiteSnapshots, 
  businessUnderstandingSnapshots, 
  offeringInputEvidence, 
  campaignOfferings,
  competitorWebsiteSnapshots,
  competitorUnderstandingSnapshots,
  ciCompetitors
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { randomUUID as uuidv4 } from "crypto";
import { runWebsiteCrawler } from "../business-understanding/crawler";
import { runBusinessUnderstandingEngine } from "../business-understanding/engine";
import { runCompetitorUnderstandingEngine } from "../competitive-intelligence/competitor-understanding-engine";
import { runDifferentiationEngine } from "../differentiation-engine/engine";
import { runStrategicPainDecisionPipeline } from "../strategic-pain-decision-engine/pipeline";

async function main() {
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";
  const campaignId = "campaign_1773576062201_6t0oxi";
  const jobId = "prod_acceptance_depth_job";

  console.log("============================================================");
  console.log("PART 14 — PRODUCTION ACCEPTANCE: OWN BUSINESS UNDERSTANDING");
  console.log("============================================================");

  const [offeringRec] = await db.select().from(campaignOfferings)
    .where(eq(campaignOfferings.campaignId, campaignId))
    .orderBy(desc(campaignOfferings.createdAt))
    .limit(1);

  if (!offeringRec) throw new Error("Offering not found");

  const [webSnap] = await db.select().from(websiteSnapshots)
    .where(eq(websiteSnapshots.campaignId, campaignId))
    .orderBy(desc(websiteSnapshots.createdAt))
    .limit(1);

  const webUrl = webSnap?.rootUrl || "https://avyron.ai";
  console.log(`Crawling Own Business website: ${webUrl}...`);

  // Run upgraded crawler
  const newWebSnapId = uuidv4();
  await db.insert(websiteSnapshots).values({
    id: newWebSnapId,
    accountId,
    campaignId,
    rootUrl: webUrl,
    status: "IN_PROGRESS",
    pagesCrawled: [] as any,
    contentHash: ""
  });

  const crawledPages = await runWebsiteCrawler(newWebSnapId, webUrl, 6);
  console.log(`Own Website Crawl Complete. Pages: ${crawledPages.length}`);

  // Run upgraded Business Understanding Engine
  const ownAuthId = await runBusinessUnderstandingEngine(accountId, campaignId, offeringRec.id);
  const [ownSnap] = await db.select().from(businessUnderstandingSnapshots).where(eq(businessUnderstandingSnapshots.id, ownAuthId));
  const ownBU = ownSnap.businessUnderstanding as any;

  console.log("\n--- OWN BUSINESS UNDERSTANDING REPORT ---");
  console.log(`AuthorityId: ${ownAuthId}`);
  console.log(`Pages Crawled: ${crawledPages.length}`);
  console.log(`Capabilities (${ownBU.campaignOffering.productTruthFacts.filter((f: any) => f.factType === "CAPABILITY").length}):`);
  ownBU.campaignOffering.productTruthFacts.filter((f: any) => f.factType === "CAPABILITY").forEach((f: any) => console.log(`  - [${f.productTruthFactId}] ${f.statement}`));

  console.log(`Mechanisms (${ownBU.campaignOffering.productTruthFacts.filter((f: any) => f.factType === "DELIVERY_MECHANISM").length}):`);
  ownBU.campaignOffering.productTruthFacts.filter((f: any) => f.factType === "DELIVERY_MECHANISM").forEach((f: any) => console.log(`  - [${f.productTruthFactId}] ${f.statement}`));

  console.log(`Boundaries (${ownBU.campaignOffering.productTruthFacts.filter((f: any) => f.factType === "BOUNDARY").length}):`);
  ownBU.campaignOffering.productTruthFacts.filter((f: any) => f.factType === "BOUNDARY").forEach((f: any) => console.log(`  - [${f.productTruthFactId}] ${f.statement}`));

  console.log(`Target Roles (${ownBU.targetUnderstanding.targetRoles.length}):`);
  ownBU.targetUnderstanding.targetRoles.forEach((r: any) => console.log(`  - [${r.targetRoleFactId}] ${r.roleTitle} (${r.roleType})`));

  console.log("\n============================================================");
  console.log("PART 14 — PRODUCTION ACCEPTANCE: COMPETITOR UNDERSTANDING");
  console.log("============================================================");

  const competitors = await db.select().from(ciCompetitors).where(eq(ciCompetitors.campaignId, campaignId));
  console.log(`Found ${competitors.length} active competitors.`);

  const competitorBaselines: any[] = [];

  for (const comp of competitors) {
    const compName = comp.competitorName || comp.name || comp.id;
    const url = comp.websiteUrl || `https://www.${compName.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`;
    console.log(`\n--- Analyzing Competitor: ${compName} (${comp.id}) ---`);
    
    const und = await runCompetitorUnderstandingEngine(accountId, campaignId, comp.id, url, compName);

    console.log(`Status: ${und.status}`);
    console.log(`Capabilities (${und.capabilities.length}):`);
    und.capabilities.forEach(c => console.log(`  - [${c.competitorCapabilityFactId}] ${c.statement}`));
    console.log(`Positioning (${und.positioning.length}):`);
    und.positioning.forEach(p => console.log(`  - [${p.competitorPositioningFactId}] ${p.statement}`));
    console.log(`Mechanisms (${und.mechanisms.length}):`);
    und.mechanisms.forEach(m => console.log(`  - [${m.competitorMechanismFactId}] ${m.statement}`));
    console.log(`Offers (${und.offers.length}):`);
    und.offers.forEach(o => console.log(`  - [${o.competitorOfferFactId}] ${o.offerStatement} (Pricing: ${o.pricing || 'N/A'})`));
    console.log(`Target Roles (${und.targetRoles.length}):`);
    und.targetRoles.forEach(t => console.log(`  - [${t.competitorTargetFactId}] ${t.roleTitle} (${t.roleType})`));
    console.log(`Proof (${und.proof.length}):`);
    und.proof.forEach(pr => console.log(`  - [${pr.competitorProofFactId}] [${pr.proofType}] ${pr.statement}`));

    if (und.status === "COMPLETE") {
      competitorBaselines.push({
        competitorId: comp.id,
        competitorName: compName,
        websiteUrl: url,
        understandingAuthorityId: und.competitorUnderstandingAuthorityId,
        websiteSnapshotId: und.competitorWebsiteSnapshotId,
        capabilities: und.capabilities,
        positioning: und.positioning,
        mechanisms: und.mechanisms,
        offers: und.offers,
        targetRoles: und.targetRoles,
        proof: und.proof,
        notEstablishedAreas: und.notEstablishedAreas
      });
    }
  }

  console.log("\n============================================================");
  console.log("PART 15 — REAL DIFFERENTIATION RECHECK");
  console.log("============================================================");

  const corePain = {
    painId: "seg_3_pain_1",
    painStatement: "Scattered and incomplete data causes difficulty in identifying true buying signals and leads to poor targeting.",
    classification: "CORE_PURCHASE" as const
  };

  console.log(`Target CORE Pain: "${corePain.painStatement}" [ID: ${corePain.painId}]`);

  const diffResult = await runDifferentiationEngine(
    {
      marketIntelligenceId: "mi_prod_acceptance",
      dominanceData: competitorBaselines.map(c => ({
        competitorId: c.competitorId,
        competitorName: c.competitorName,
        canonicalFacts: [
          ...c.capabilities.map((cap: any) => ({ fact: cap.statement, factType: "CAPABILITY", miAuthorityId: cap.competitorCapabilityFactId })),
          ...c.mechanisms.map((m: any) => ({ fact: m.statement, factType: "MECHANISM", miAuthorityId: m.competitorMechanismFactId })),
          ...c.positioning.map((p: any) => ({ fact: p.statement, factType: "POSITIONING", miAuthorityId: p.competitorPositioningFactId }))
        ]
      })),
      competitorBaselines,
      competitors: competitorBaselines
    } as any,
    {
      painRegistry: [corePain]
    } as any,
    {
      brandTruth: "Avyron AI - Continuous Market Mirror with specialized AI semantic Judges",
      productTruth: ownBU.campaignOffering.productTruthFacts
    } as any,
    {
      accountId,
      campaignId,
      jobId
    }
  );

  console.log(`\nDifferentiation Result:`, JSON.stringify(diffResult, null, 2));
  process.exit(0);
}

main().catch(err => {
  console.error("Error in production acceptance script:", err);
  process.exit(1);
});
