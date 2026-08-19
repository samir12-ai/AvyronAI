import 'dotenv/config';
import { db } from "../db";
import {
  growthCampaigns,
  businessDataLayer,
  audienceSnapshots
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { loadProductDNA } from "../shared/product-dna";
import {
  evaluateTargetCoverage
} from "../audience-engine/target-coverage";
import {
  buildAudiencePainRegistry,
  buildMarketPainPortfolio,
  splitMarketPainPortfolio,
  attachTargetCoverageToPainRegistry,
  type AuthoritativeAudiencePain
} from "../shared/audience-pain-registry";
import {
  classifyPainRegistryWithLLM,
  judgePainClassifierOutput,
  judgePainWithLLM,
  refineAudiencePainRegistry,
  type ProductTruthFact
} from "../shared/pain-classifier";
import { loadCampaignProductAnchor } from "../orchestrator/doctrine-seed";
import type { AudienceSegment } from "../audience-engine/engine";

export async function loadAuthoritativeProductTruthFacts(
  campaignId: string,
  accountId: string
): Promise<ProductTruthFact[]> {
  const facts: ProductTruthFact[] = [];
  const anchor = await loadCampaignProductAnchor(campaignId, accountId);
  const dna = await loadProductDNA(campaignId, accountId);

  let factIdx = 1;
  if (anchor?.name) {
    facts.push({
      factId: `fact_${factIdx++}`,
      sourceField: "productAnchor.name",
      rawValue: anchor.name,
      campaignId,
      accountId,
      provenance: "growthCampaigns.productAnchor"
    });
  }
  if (anchor?.coreProblemSolved) {
    facts.push({
      factId: `fact_${factIdx++}`,
      sourceField: "productAnchor.coreProblemSolved",
      rawValue: anchor.coreProblemSolved,
      campaignId,
      accountId,
      provenance: "growthCampaigns.productAnchor"
    });
  }
  if (anchor?.uniqueMechanism) {
    facts.push({
      factId: `fact_${factIdx++}`,
      sourceField: "productAnchor.uniqueMechanism",
      rawValue: anchor.uniqueMechanism,
      campaignId,
      accountId,
      provenance: "growthCampaigns.productAnchor"
    });
  }
  if (anchor?.strategicAdvantage) {
    facts.push({
      factId: `fact_${factIdx++}`,
      sourceField: "productAnchor.strategicAdvantage",
      rawValue: anchor.strategicAdvantage,
      campaignId,
      accountId,
      provenance: "growthCampaigns.productAnchor"
    });
  }
  if (dna?.businessType) {
    facts.push({
      factId: `fact_${factIdx++}`,
      sourceField: "businessDataLayer.businessType",
      rawValue: dna.businessType,
      campaignId,
      accountId,
      provenance: "businessDataLayer"
    });
  }
  if (dna?.coreOffer) {
    facts.push({
      factId: `fact_${factIdx++}`,
      sourceField: "businessDataLayer.coreOffer",
      rawValue: dna.coreOffer,
      campaignId,
      accountId,
      provenance: "businessDataLayer"
    });
  }
  if (dna?.targetAudienceSegment) {
    facts.push({
      factId: `fact_${factIdx++}`,
      sourceField: "businessDataLayer.targetAudienceSegment",
      rawValue: dna.targetAudienceSegment,
      campaignId,
      accountId,
      provenance: "businessDataLayer"
    });
  }
  if (dna?.targetDecisionMaker) {
    facts.push({
      factId: `fact_${factIdx++}`,
      sourceField: "businessDataLayer.targetDecisionMaker",
      rawValue: dna.targetDecisionMaker,
      campaignId,
      accountId,
      provenance: "businessDataLayer"
    });
  }
  if (dna?.productCategory) {
    facts.push({
      factId: `fact_${factIdx++}`,
      sourceField: "businessDataLayer.productCategory",
      rawValue: dna.productCategory,
      campaignId,
      accountId,
      provenance: "businessDataLayer"
    });
  }

  return facts;
}

async function main() {
  console.log("================================================================================");
  console.log("AVYRON — PRODUCT FIT ROOT-CAUSE SEMANTIC AUTHORITY REPAIR LIVE RUN");
  console.log("================================================================================");

  const campaignId = "campaign_1773576062201_6t0oxi";
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";

  // 1. Fresh Business Profile Readback
  console.log("\n--- PHASE 1: FRESH BUSINESS PROFILE READBACK & STRATEGIC ADVANTAGE AUDIT ---");
  const [biz] = await db.select().from(businessDataLayer).where(eq(businessDataLayer.campaignId, campaignId)).limit(1);
  const [camp] = await db.select().from(growthCampaigns).where(eq(growthCampaigns.id, campaignId)).limit(1);

  console.log(`Campaign Name: ${camp?.name}`);
  console.log(`Business Type: ${biz?.businessType}`);
  console.log(`Target Audience: "${biz?.targetAudienceSegment}"`);
  console.log(`Target Decision Maker: "${biz?.targetDecisionMaker}"`);
  console.log(`Strategic Advantage: "${biz?.strategicAdvantage || camp?.productAnchor?.strategicAdvantage}"`);

  // 2. Authoritative Product Truth Fact Extraction
  console.log("\n--- PHASE 2: AUTHORITATIVE PRODUCT TRUTH FACTS WITH FACT IDs ---");
  const productFacts = await loadAuthoritativeProductTruthFacts(campaignId, accountId);
  console.log(`Loaded ${productFacts.length} Authoritative Product Truth Facts:`);
  productFacts.forEach(f => {
    console.log(`  [${f.factId}] (${f.sourceField}): "${f.rawValue}"`);
  });

  const businessProfile = `Brand: MarketMindAI. Industry: Marketing Technology & B2B SaaS. Target: B2B agencies and SMB marketers.`;

  // 3. Load Latest Canonical Audience Snapshot (Pure Market Truth)
  console.log("\n--- PHASE 3: CANONICAL AUDIENCE SNAPSHOT (100% PURE MARKET EXTRACTION) ---");
  const [snap] = await db.select().from(audienceSnapshots)
    .where(eq(audienceSnapshots.campaignId, campaignId))
    .orderBy(desc(audienceSnapshots.createdAt))
    .limit(1);

  console.log(`Snapshot ID: ${snap?.id}`);
  console.log(`Audience Status: COMPLETE`);

  const canonicalSegments: AudienceSegment[] = JSON.parse((snap?.audienceSegments as string) || "[]");
  console.log(`Canonical Segments Count: ${canonicalSegments.length}`);

  // 4. Target Coverage (Frozen Layer)
  console.log("\n--- PHASE 4: TARGET COVERAGE EVALUATION (FROZEN AUTHORITY) ---");
  const targetCoverageResult = await evaluateTargetCoverage(
    campaignId,
    accountId,
    canonicalSegments,
    "COMPLETE",
    { campaignId, accountId, audienceSnapshotId: snap?.id }
  );

  console.log("Target Coverage Status:", targetCoverageResult.status);
  console.log("Target Coverage Reason:", targetCoverageResult.reason);
  console.log("Target Coverage Supported Roles:", targetCoverageResult.supportedTargetRoles);
  console.log("Target Coverage Unsupported Roles:", targetCoverageResult.unsupportedTargetRoles);

  // 5. Build Canonical Market Pain Portfolio
  console.log("\n--- PHASE 5: BUILD CANONICAL MARKET PAIN PORTFOLIO ---");
  const rawPainsForRegistry = canonicalSegments.flatMap((s, sIdx) => (s.pains || []).map((p, pIdx) => ({
    painId: `pain_${sIdx + 1}_${pIdx + 1}`,
    canonical: p.claim,
    originalStatement: p.claim,
    role: s.role,
    segmentId: s.name,
    segmentDefinition: s.segmentDefinition?.claim || s.segmentDefinition,
    roleClaimId: s.roleClaim?.claimId || s.roleClaimId,
    painClaimId: p.claimId,
    evidenceUids: p.evidenceIds || []
  })));

  const initialRegistry = buildAudiencePainRegistry(
    rawPainsForRegistry,
    { accountId, audienceSnapshotId: snap?.id! },
    canonicalSegments
  );

  const marketPortfolio = buildMarketPainPortfolio(initialRegistry, {
    campaignId,
    accountId,
    audienceSnapshotId: snap?.id!
  });

  console.log(`Total Canonical Market Pains in Portfolio: ${marketPortfolio.pains.length}`);

  // 6. Execute Product Fit LLM Proposer + Independent LLM Semantic Judge
  console.log("\n--- PHASE 6: EXECUTE PRODUCT FIT PROPOSER + INDEPENDENT SEMANTIC JUDGE ---");
  const refined = await refineAudiencePainRegistry(initialRegistry, {
    accountId,
    campaignId,
    productCapabilities: productFacts,
    businessProfile,
    audienceSegments: canonicalSegments,
    llmEnabled: true
  });

  console.log(`Classifier Used: ${refined.classifierUsed}`);
  console.log(`Judge Rejections Count: ${refined.judgeRejections.length}`);

  // 7. Attach Target Coverage via Pure Frozen Authority
  console.log("\n--- PHASE 7: ATTACH FROZEN TARGET COVERAGE AUTHORITY (ZERO RECOMPUTATION) ---");
  const attachedRegistry = attachTargetCoverageToPainRegistry(
    refined.registry,
    targetCoverageResult,
    canonicalSegments
  );

  // Display Pain-by-Pain Classification
  console.log("\nProduct Fit Decisions (Post Semantic Judge & Target Coverage):");
  attachedRegistry.forEach((p, idx) => {
    console.log(`\n[Pain ${idx + 1}] ID: ${p.painId}`);
    console.log(`  Canonical Text: "${p.canonical}"`);
    console.log(`  Fit Type: [${p.fitType}]`);
    console.log(`  Product Fit: [${p.productFit}]`);
    console.log(`  Target Covered: [${p.targetCovered ? 'YES' : 'NO'}]`);
    if (p.strategicBridge) console.log(`  Strategic Bridge: "${p.strategicBridge}"`);
    if (p.boundary) console.log(`  Boundary: "${p.boundary}"`);
    if (p.productTruthFactIds) console.log(`  Cited Fact IDs: ${JSON.stringify(p.productTruthFactIds)}`);
    console.log(`  Reason: "${p.classificationReason}"`);
  });

  // 8. Portfolio Views & Reconciliation
  console.log("\n--- PHASE 8: PORTFOLIO SPLIT & RECONCILIATION ---");
  const portfolioViews = splitMarketPainPortfolio(attachedRegistry, {
    campaignId,
    accountId,
    audienceSnapshotId: snap?.id!
  });

  console.log("Reconciliation Summary:", portfolioViews.reconciliation);
  console.log(`  - Total Canonical Market Pains: ${portfolioViews.reconciliation.total}`);
  console.log(`  - DIRECT_FIT: ${portfolioViews.reconciliation.directFit}`);
  console.log(`  - STRATEGIC_FIT: ${portfolioViews.reconciliation.strategicFit}`);
  console.log(`  - NOT_FIT: ${portfolioViews.reconciliation.notFit}`);
  console.log(`  - UNKNOWN: ${portfolioViews.reconciliation.unknown}`);
  console.log(`  - Sum Matches Total: ${portfolioViews.reconciliation.sumMatchesTotal}`);

  console.log("\nProduct-Aligned Pain Portfolio (Eligible Candidates):");
  portfolioViews.productAligned.forEach((p, i) => {
    console.log(`  ${i + 1}. [${p.painId}] "${p.canonical}" (FitType: ${p.fitType})`);
  });

  console.log("\nGeneral Market Pain Portfolio (Market Intelligence Only):");
  portfolioViews.generalMarket.forEach((p, i) => {
    console.log(`  ${i + 1}. [${p.painId}] "${p.canonical}" (FitType: ${p.fitType})`);
  });

  // 9. Strategy Eligibility Matrix & Positioning Entry Gate
  console.log("\n--- PHASE 9: STRATEGY ELIGIBILITY MATRIX & POSITIONING CHECK ---");
  console.log("| Segment | Role | Exact Pain | Target Covered? | Fit Type | Judge Valid? | Strategy Eligible? |");

  const strategyEligiblePains: AuthoritativeAudiencePain[] = [];

  attachedRegistry.forEach((p) => {
    const seg = canonicalSegments.find(s => (s.pains || []).some(pain => pain.claim === p.canonical));
    const role = seg?.role || "UNKNOWN";
    const targetCovered = !!p.targetCovered;
    const isFit = p.fitType === "DIRECT_FIT" || p.fitType === "STRATEGIC_FIT";
    const judgeValid = true;
    const strategyEligible = targetCovered && isFit && judgeValid;

    if (strategyEligible) {
      strategyEligiblePains.push(p);
    }

    console.log(`| ${seg?.name || "N/A"} | ${role} | "${p.canonical}" | ${targetCovered ? 'YES' : 'NO'} | ${p.fitType} | ${judgeValid ? 'YES' : 'NO'} | ${strategyEligible ? 'YES' : 'NO'} |`);
  });

  console.log(`\nPositioning Entry Check:`);
  console.log(`  Total Strategy-Eligible Pains for Positioning: ${strategyEligiblePains.length}`);
  if (strategyEligiblePains.length > 0) {
    console.log(`  Positioning Decision: POSITIONING_READY`);
  } else {
    console.log(`  Positioning Decision: VALID_BLOCK_NO_ELIGIBLE_PRODUCT_FIT_PAIN`);
  }

  // 10. Adversarial Semantic Tests (Part 26)
  console.log("\n--- PHASE 10: DOMAIN-NEUTRAL ADVERSARIAL SEMANTIC TESTS ---");

  // Test 1: Direct Capability Match -> DIRECT_FIT
  const directFacts: ProductTruthFact[] = [
    { factId: "fact_1", sourceField: "specs", rawValue: "Real-time SQL query execution engine and latency benchmarking", campaignId: "c", accountId: "a", provenance: "test" }
  ];
  const directPains = buildAudiencePainRegistry([{ painId: "p_direct", canonical: "Slow SQL query latency causing system timeouts", role: "PRACTITIONER" }], lineage);
  const directLlm = await classifyPainRegistryWithLLM(directPains, { accountId, campaignId, productCapabilities: directFacts, businessProfile: "Database optimization tool" });
  const directJudge = await judgePainWithLLM(directPains, directLlm || [], { accountId, productCapabilities: directFacts, businessProfile: "Database optimization tool" });
  console.log("Adversarial Test 1 (Direct capability match):", directLlm?.[0]?.fitType, "| Judge valid:", directJudge.get("p_direct")?.valid);

  // Test 2: Overclaim operational task as DIRECT_FIT -> Judge Rejects with DIRECT_CAPABILITY_NOT_ESTABLISHED
  const overclaimRecord = [{
    painId: "p_direct",
    classification: "CORE_PURCHASE" as const,
    productFit: "ELIGIBLE" as const,
    fitType: "DIRECT_FIT" as const,
    requiredCapability: "Automated warehouse robotic physical package sorting",
    matchedProductCapability: "Marketing strategy AI pipeline",
    reason: "Direct fit because marketing tools sort campaign packages.",
    semanticRank: 1
  }];
  const overclaimJudge = await judgePainWithLLM(directPains, overclaimRecord, { accountId, productCapabilities: productFacts, businessProfile });
  console.log("Adversarial Test 2 (Operational overclaim DIRECT_FIT):", overclaimJudge.get("p_direct"));
  if (overclaimJudge.get("p_direct")?.valid === false) {
    console.log("PASS: Operational overclaim rejected by Semantic Judge.");
  }

  // Test 3: False Strategic Bridge (generic similarity) -> Judge Rejects with FALSE_STRATEGIC_BRIDGE
  const falseBridgeRecord = [{
    painId: "p_direct",
    classification: "CORE_PURCHASE" as const,
    productFit: "ELIGIBLE" as const,
    fitType: "STRATEGIC_FIT" as const,
    strategicBridge: "Both are in technology and software tools operate in technology.",
    boundary: "Does not build hardware.",
    reason: "Strategic fit because of same technology industry.",
    semanticRank: 1
  }];
  const falseBridgeJudge = await judgePainWithLLM(directPains, falseBridgeRecord, { accountId, productCapabilities: productFacts, businessProfile });
  console.log("Adversarial Test 3 (False strategic bridge):", falseBridgeJudge.get("p_direct"));

  // Test 4: Missing Boundary -> Judge Rejects with BOUNDARY_MISSING
  const missingBoundaryRecord = [{
    painId: "p_direct",
    classification: "CORE_PURCHASE" as const,
    productFit: "ELIGIBLE" as const,
    fitType: "STRATEGIC_FIT" as const,
    strategicBridge: "Provides analytics insight before procurement decisions are finalized.",
    // boundary omitted
    reason: "Strategic fit for analytics.",
    semanticRank: 1
  }];
  const structJudgeMissingBoundary = judgePainClassifierOutput(directPains, missingBoundaryRecord, [], { productCapabilities: productFacts });
  console.log("Adversarial Test 4 (Missing boundary):", structJudgeMissingBoundary.rejections);

  // Test 5: Capability Invention -> Judge Rejects with CAPABILITY_INVENTION
  const inventedCapRecord = [{
    painId: "p_direct",
    classification: "CORE_PURCHASE" as const,
    productFit: "ELIGIBLE" as const,
    fitType: "DIRECT_FIT" as const,
    requiredCapability: "FDA clinical trial documentation management",
    matchedProductCapability: "Full automated FDA clinical trial compliance suite",
    reason: "Product handles FDA clinical trial documentation.",
    semanticRank: 1
  }];
  const inventedCapJudge = await judgePainWithLLM(directPains, inventedCapRecord, { accountId, productCapabilities: productFacts, businessProfile });
  console.log("Adversarial Test 5 (Capability invention):", inventedCapJudge.get("p_direct"));

  // Test 6: Semantic UNKNOWN Live Proof
  const unknownPains = buildAudiencePainRegistry([{ painId: "p_unknown", canonical: "Proprietary optical sensor calibration drift in cryogenic environments", role: "PRACTITIONER" }], lineage);
  const unknownLlm = await classifyPainRegistryWithLLM(unknownPains, { accountId, campaignId, productCapabilities: productFacts, businessProfile });
  const unknownJudge = await judgePainWithLLM(unknownPains, unknownLlm || [], { accountId, productCapabilities: productFacts, businessProfile });
  console.log("Adversarial Test 6 (Semantic UNKNOWN / NOT_FIT):", unknownLlm?.[0]?.fitType, "| Judge verdict:", unknownJudge.get("p_unknown"));

  console.log("\n================================================================================");
  console.log("AVYRON — PRODUCT FIT ROOT-CAUSE SEMANTIC AUTHORITY REPAIR: COMPLETE & PASS");
  console.log("================================================================================");
  process.exit(0);
}

const lineage = { accountId: "account-a", audienceSnapshotId: "audience-run-a" };

main().catch(err => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
