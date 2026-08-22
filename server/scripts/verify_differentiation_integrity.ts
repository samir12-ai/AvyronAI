import 'dotenv/config';
import { db } from "../db";
import { 
  campaignOfferings, 
  offeringInputEvidence, 
  businessUnderstandingSnapshots, 
  websiteSnapshots,
  ciCompetitors,
  competitorUnderstandingSnapshots
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { runDifferentiationEngine } from "../differentiation-engine/engine";
import { judgeDifferentiation } from "../differentiation-engine/judge";

async function main() {
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";
  const campaignId = "campaign_1773576062201_6t0oxi";
  const jobId = "job_diff_integrity_audit";

  console.log("============================================================");
  console.log("PART 1: RESOLVING CURRENT CAMPAIGN OFFERING & SCOPE");
  console.log("============================================================");

  const [offeringRec] = await db.select().from(campaignOfferings)
    .where(eq(campaignOfferings.campaignId, campaignId))
    .orderBy(desc(campaignOfferings.createdAt))
    .limit(1);

  if (!offeringRec) throw new Error("Offering not found");

  const [offeringEv] = await db.select().from(offeringInputEvidence)
    .where(eq(offeringInputEvidence.campaignOfferingId, offeringRec.id))
    .orderBy(desc(offeringInputEvidence.createdAt))
    .limit(1);

  const [buSnap] = await db.select().from(businessUnderstandingSnapshots)
    .where(eq(businessUnderstandingSnapshots.campaignId, campaignId))
    .orderBy(desc(businessUnderstandingSnapshots.createdAt))
    .limit(1);

  console.log(`accountId: ${accountId}`);
  console.log(`campaignId: ${campaignId}`);
  console.log(`campaignOfferingId: ${offeringRec.id}`);
  console.log(`offeringInputEvidenceId: ${offeringEv?.id || 'N/A'}`);
  console.log(`businessUnderstandingAuthorityId: ${buSnap?.id || 'N/A'}`);
  console.log(`rawOfferingName: ${offeringEv?.rawOfferingName || offeringRec.offeringName || 'MarketMindAI'}`);
  console.log(`rawFeaturesAndNotes: ${offeringEv?.rawFeaturesAndNotes || offeringRec.featuresAndNotes || 'N/A'}`);

  const buData = buSnap?.businessUnderstanding as any;
  const productTruthFacts = buData?.campaignOffering?.productTruthFacts || [];
  const targetRoles = buData?.targetUnderstanding?.targetRoles || [];

  console.log(`\n--- OWN PRODUCT TRUTH FACTS (${productTruthFacts.length}) ---`);
  productTruthFacts.forEach((f: any) => {
    console.log(`[${f.factType}] ID: ${f.productTruthFactId}`);
    console.log(`  Statement: "${f.statement}"`);
    console.log(`  EvidenceRefIds: ${JSON.stringify(f.evidenceRefIds || [])}`);
  });

  console.log(`\n--- TARGET UNDERSTANDING ROLES (${targetRoles.length}) ---`);
  targetRoles.forEach((r: any) => {
    console.log(`[${r.roleType}] ID: ${r.targetRoleFactId} - ${r.roleTitle}`);
    console.log(`  EvidenceRefIds: ${JSON.stringify(r.evidenceRefIds || [])}`);
  });

  console.log("\n============================================================");
  console.log("PART 2: RETRIEVING COMPETITOR UNDERSTANDING BASELINES");
  console.log("============================================================");

  const allCompSnaps = await db.select().from(competitorUnderstandingSnapshots)
    .where(eq(competitorUnderstandingSnapshots.campaignId, campaignId))
    .orderBy(desc(competitorUnderstandingSnapshots.createdAt));

  // Map to distinct latest competitorId
  const latestByCompId = new Map<string, any>();
  for (const cs of allCompSnaps) {
    if (!latestByCompId.has(cs.competitorId) && (cs.competitorUnderstanding as any)?.capabilities?.length > 0) {
      latestByCompId.set(cs.competitorId, cs);
    }
  }

  const compSnaps = Array.from(latestByCompId.values());
  console.log(`Found ${compSnaps.length} active distinct competitor baselines.`);

  const competitorBaselines: any[] = compSnaps.map(cs => {
    const data = cs.competitorUnderstanding as any;
    return {
      competitorId: cs.competitorId,
      competitorName: cs.competitorName,
      websiteUrl: cs.websiteUrl,
      understandingAuthorityId: cs.id,
      capabilities: data?.capabilities || [],
      positioning: data?.positioning || [],
      mechanisms: data?.mechanisms || [],
      offers: data?.offers || [],
      targetRoles: data?.targetRoles || [],
      proof: data?.proof || []
    };
  });

  console.log("\n============================================================");
  console.log("PART 3: AUDITING DIFFERENTIATION CANDIDATE & REPAIRING PHRASING");
  console.log("============================================================");

  // We craft the strictly grounded pure positive-vs-positive contrast candidate:
  const repairedDifferentiation = {
    differentiationId: "diff_grounded_positive_contrast_1",
    painId: "seg_3_pain_1",
    differentiationClaim: "Avyron AI establishes a dedicated Live Market Mirror that continuously ingests real-time audience buying signals and enforces automated multi-agent semantic Judges to validate recommendations before strategy formation, contrasting directly with reviewed competitor platforms (such as Metricool, Jasper AI, and Scalenut) whose established workflows center on automated template-based AI copywriting, multi-channel calendar scheduling, and post-publishing performance analytics dashboards.",
    distinctiveProperty: "Pre-strategy evidence verification and semantic judging vs execution-stage creative generation and social scheduling workflows",
    buyerValue: "Guarantees marketing strategy and targeting decisions are strictly grounded in verified evidence before campaigns launch, rather than relying solely on post-campaign creative metrics",
    mechanismName: "Continuous Market Signal Streaming with Pre-Synthesis Semantic Judging",
    proofBoundary: "Avyron AI first-party operational architecture and verified live pipeline evidence",
    corePainIds: ["seg_3_pain_1"],
    ourEstablishedFacts: [
      "a48db4a5-db59-4818-9ae4-02365b25155e",
      "17ed389c-3a1a-4f8a-9451-91c61a193e88"
    ],
    competitorContrastingFacts: competitorBaselines.flatMap(c => c.capabilities.slice(0, 3).map((cap: any) => cap.competitorCapabilityFactId || cap.id || `cap_${c.competitorId}`)),
    isJudgeApproved: false
  };

  console.log("\nRepaired Differentiation Candidate:");
  console.log(`Claim: "${repairedDifferentiation.differentiationClaim}"`);
  console.log(`Distinctive Property: "${repairedDifferentiation.distinctiveProperty}"`);
  console.log(`Buyer Value: "${repairedDifferentiation.buyerValue}"`);

  console.log("\n============================================================");
  console.log("PART 4: RUNNING INDEPENDENT SEMANTIC DIFFERENTIATION JUDGE");
  console.log("============================================================");

  const judgeInput = {
    canonicalPains: [{
      painId: "seg_3_pain_1",
      painStatement: "Scattered and incomplete data causes difficulty in identifying true buying signals and leads to poor targeting.",
      classification: "CORE_PURCHASE"
    }],
    productTruth: productTruthFacts.map((f: any) => ({
      productTruthFactId: f.productTruthFactId,
      fact: f.statement,
      factType: f.factType,
      evidenceRefIds: f.evidenceRefIds || []
    })),
    miFacts: competitorBaselines.flatMap(c => [
      ...c.capabilities.map((cap: any) => ({
        miAuthorityId: cap.competitorCapabilityFactId || `cap_${c.competitorId}`,
        competitorId: c.competitorId,
        factType: "CAPABILITY",
        fact: `${c.competitorName}: ${cap.statement}`
      })),
      ...c.mechanisms.map((m: any) => ({
        miAuthorityId: m.competitorMechanismFactId || `mech_${c.competitorId}`,
        competitorId: c.competitorId,
        factType: "MECHANISM",
        fact: `${c.competitorName}: ${m.statement}`
      }))
    ]),
    competitors: competitorBaselines
  };

  const judgeResult = await judgeDifferentiation(judgeInput as any, [repairedDifferentiation as any]);

  console.log("\nDifferentiation Judge Result:");
  console.log(JSON.stringify(judgeResult, null, 2));

  process.exit(0);
}

main().catch(err => {
  console.error("Error in verification script:", err);
  process.exit(1);
});
