import "dotenv/config";
import { db } from "../server/db";
import { businessUnderstandingSnapshots, audienceSnapshots } from "../shared/schema";
import { eq } from "drizzle-orm";
import { runTargetAssessmentForPain } from "../server/strategic-reasoning/target-assessment";
import { runProductAssessmentForPain } from "../server/strategic-reasoning/product-assessment";
import { judgeStrategicPainDecision } from "../server/strategic-pain-decision-judge";
import fs from "fs";

async function main() {
  const audSnapId = "5921969d-4b59-48e0-9373-a78d708683d8";
  const buSnapId = "90497a6c-91af-4061-b11b-5477367f8712";

  const [audSnap] = await db.select().from(audienceSnapshots).where(eq(audienceSnapshots.id, audSnapId)).limit(1);
  const [buSnap] = await db.select().from(businessUnderstandingSnapshots).where(eq(businessUnderstandingSnapshots.id, buSnapId)).limit(1);

  const buData: any = buSnap?.businessUnderstanding || {};
  const productTruthFacts = buData?.campaignOffering?.productTruthFacts || [];
  const targetRoles = buData?.targetUnderstanding?.targetRoles || [];

  const canonicalPains = [
    {
      id: "seg_1_pain_1",
      name: "Pain 1 (Compound)",
      canonical: "Difficulty finding modest clothing that balances style, comfort, proper fit, and quality fabric",
      citationCount: 14,
      evidenceUids: ["EV-868", "EV-869", "EV-870", "EV-903", "EV-904", "EV-905", "EV-906", "EV-907", "EV-908", "EV-910", "EV-911", "EV-920", "EV-865", "EV-871"]
    },
    {
      id: "seg_2_pain_1",
      name: "Pain 2 (Refunds only)",
      canonical: "Issues with refunds and returns including delays, refusals, and complicated processes causing customer frustration and additional costs",
      citationCount: 13,
      evidenceUids: ["EV-537", "EV-539", "EV-542", "EV-549", "EV-556", "EV-557", "EV-572", "EV-702", "EV-757", "EV-758", "EV-762", "EV-769", "EV-873"]
    },
    {
      id: "seg_2_pain_2",
      name: "Pain 3 (Service + Refunds + Defective items)",
      canonical: "Issues including poor customer service responsiveness and communication, delayed or refused refunds, receiving wrong or defective items, and complicated return processes causing frustration",
      citationCount: 13,
      evidenceUids: ["EV-537", "EV-539", "EV-589", "EV-590", "EV-591", "EV-592", "EV-757", "EV-758", "EV-762", "EV-769", "EV-873", "EV-878", "EV-879"]
    },
    {
      id: "seg_2_pain_3",
      name: "Pain 4 (Defective quality + Refunds + Support)",
      canonical: "Issues including receiving wrong, defective, or poor quality items, delayed or refused refunds despite returning items in good condition, poor customer service responsiveness and communication, and complicated return processes causing additional costs and frustration",
      citationCount: 9,
      evidenceUids: ["EV-589", "EV-590", "EV-591", "EV-592", "EV-757", "EV-758", "EV-762", "EV-769", "EV-873"]
    },
    {
      id: "seg_3_pain_1",
      name: "Pain 5 (Pricing + Sizing)",
      canonical: "Modest fashion consumers face two distinct issues: overpriced items relative to material quality, and sizing inconsistencies leading to poor fit",
      citationCount: 11,
      evidenceUids: ["EV-706", "EV-709", "EV-716", "EV-720", "EV-725", "EV-745", "EV-766", "EV-816", "EV-898", "EV-713", "EV-821"]
    }
  ];

  // Atomic Counterfactual Variants for Part 16
  const counterfactualVariants = [
    // Pain 1 split
    {
      id: "pain_1_atomic_a",
      name: "Pain 1 Atomic A (Modesty + Style + Comfort + Quality)",
      canonical: "Difficulty finding modest clothing that balances style, comfort, and quality fabric",
      citationCount: 12,
      evidenceUids: ["EV-868", "EV-869", "EV-903", "EV-904", "EV-905", "EV-906", "EV-907", "EV-908", "EV-910", "EV-911", "EV-920"]
    },
    {
      id: "pain_1_atomic_b",
      name: "Pain 1 Atomic B (Proper Fit Accuracy)",
      canonical: "Difficulty finding modest dresses with proper fit accuracy and reliable sizing",
      citationCount: 3,
      evidenceUids: ["EV-865", "EV-870", "EV-920"]
    },
    // Pain 3 split
    {
      id: "pain_3_atomic_a",
      name: "Pain 3 Atomic A (Customer Service Responsiveness)",
      canonical: "Poor customer service responsiveness and lack of communication from store support teams",
      citationCount: 8,
      evidenceUids: ["EV-537", "EV-539", "EV-589", "EV-590", "EV-591", "EV-758", "EV-873", "EV-879"]
    },
    {
      id: "pain_3_atomic_b",
      name: "Pain 3 Atomic B (Delayed or Refused Refunds)",
      canonical: "Delayed or refused refunds and complicated return processes after returning purchased items",
      citationCount: 9,
      evidenceUids: ["EV-537", "EV-539", "EV-757", "EV-762", "EV-769", "EV-873", "EV-878"]
    },
    {
      id: "pain_3_atomic_c",
      name: "Pain 3 Atomic C (Wrong or Defective Items Received)",
      canonical: "Receiving wrong, missing, or defective items with loose threads or stains upon delivery",
      citationCount: 5,
      evidenceUids: ["EV-589", "EV-590", "EV-591", "EV-592", "EV-879"]
    },
    // Pain 5 split
    {
      id: "pain_5_atomic_a",
      name: "Pain 5 Atomic A (Overpriced Relative to Material Quality)",
      canonical: "Overpriced modest fashion items relative to poor material quality and cheap synthetic fabrics",
      citationCount: 7,
      evidenceUids: ["EV-706", "EV-709", "EV-716", "EV-720", "EV-816", "EV-898", "EV-713"]
    },
    {
      id: "pain_5_atomic_b",
      name: "Pain 5 Atomic B (Sizing Inconsistencies Leading to Poor Fit)",
      canonical: "Inconsistent sizing standards across items leading to poor fit and incorrect garment dimensions",
      citationCount: 6,
      evidenceUids: ["EV-706", "EV-725", "EV-745", "EV-766", "EV-821"]
    }
  ];

  async function evaluateList(list: any[], tag: string) {
    const evaluated: any[] = [];
    for (const item of list) {
      const jobId = `job_audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      const ta = await runTargetAssessmentForPain({
        painId: item.id,
        segmentId: "seg_audit",
        canonicalPain: item.canonical,
        segmentContext: { name: "Modest Fashion Shoppers", role: "END_CONSUMER" },
        targetUnderstandingAuthorityId: buData?.targetUnderstanding?.targetUnderstandingAuthorityId || "tu_sara_ft",
        canonicalTargetRoles: targetRoles,
        accountId: audSnap.accountId,
        campaignId: audSnap.campaignId,
        jobId
      });

      const pa = await runProductAssessmentForPain({
        painId: item.id,
        canonicalPain: item.canonical,
        campaignOfferingId: buData?.campaignOfferingId || "off_70677f8f-1",
        businessUnderstandingAuthorityId: buSnapId,
        productTruthFacts,
        accountId: audSnap.accountId,
        campaignId: audSnap.campaignId,
        jobId
      });

      const spd = await judgeStrategicPainDecision({
        jobId,
        painId: item.id,
        targetUnderstandingAuthorityId: buData?.targetUnderstanding?.targetUnderstandingAuthorityId || "tu_sara_ft",
        productTruthFactIds: productTruthFacts.map((f: any) => f.productTruthFactId),
        campaignOfferingId: buData?.campaignOfferingId || "off_70677f8f-1",
        targetAssessmentAuthorityId: ta.targetAssessmentAuthorityId,
        productAssessmentAuthorityId: pa.productAssessmentAuthorityId,
        targetAssessmentParentAuthorityIds: ta.parentAuthorityIds,
        productAssessmentParentAuthorityIds: pa.parentAuthorityIds,
        targetAssessmentJobId: ta.jobId,
        productAssessmentJobId: pa.jobId,
        painClaim: item.canonical,
        productFitType: pa.fitType,
        targetCoverageDecision: ta.decision,
        materialityContext: {
          citationCount: item.citationCount,
          evidenceUids: item.evidenceUids,
          sourceTypes: ["review", "google_serp", "reddit"]
        },
        accountId: audSnap.accountId,
        campaignId: audSnap.campaignId
      });

      console.log(`\n[${tag}] ${item.name}`);
      console.log(`  Pain: "${item.canonical}"`);
      console.log(`  TA: ${ta.decision} | ${ta.reason}`);
      console.log(`  PA: ${pa.fitType} | ${pa.reason}`);
      console.log(`  SPD: ${spd.finalClassification} | ${spd.reason}`);

      evaluated.push({
        id: item.id,
        name: item.name,
        canonical: item.canonical,
        citationCount: item.citationCount,
        evidenceUids: item.evidenceUids,
        targetAssessment: { decision: ta.decision, reason: ta.reason },
        productAssessment: { fitType: pa.fitType, reason: pa.reason },
        spdDecision: { finalClassification: spd.finalClassification, reason: spd.reason }
      });
    }
    return evaluated;
  }

  console.log("=== Evaluating 5 Canonical Pains with Matching Job IDs ===");
  const canonicalEvaluated = await evaluateList(canonicalPains, "CANONICAL");

  console.log("\n=== Evaluating 7 Atomic Counterfactual Variants (Part 16) ===");
  const counterfactualEvaluated = await evaluateList(counterfactualVariants, "COUNTERFACTUAL");

  fs.writeFileSync(
    "C:/Users/mahmo/.gemini/antigravity/brain/9555ab3d-27e6-4460-b3ad-232e0d7ef085/scratch/sara_ft_full_forensic_evaluations.json",
    JSON.stringify({ canonicalEvaluated, counterfactualEvaluated }, null, 2),
    "utf8"
  );
  console.log("\nFull forensic evaluations saved to scratch/sara_ft_full_forensic_evaluations.json");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
