import { db } from "../server/db";
import { growthCampaigns, businessDataLayer, brandConfig, audienceSnapshots } from "../shared/schema";
import { eq, desc } from "drizzle-orm";
import { loadCampaignProductAnchor } from "../server/orchestrator/doctrine-seed";
import { buildAudiencePainRegistry } from "../server/shared/audience-pain-registry";
import { refineAudiencePainRegistry } from "../server/shared/pain-classifier";
import { runLaneGrouper } from "../server/shared/lane-grouper";

async function main() {
  const campaignId = "campaign_1786718877499_3jk4zv";
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";

  console.log("=== SFI PRODUCT FIT & STRATEGIC LANES VALIDATION ===");

  // 1. Load Anchor
  const anchor = await loadCampaignProductAnchor(campaignId, accountId);
  if (!anchor) {
    console.error("FAIL: Product anchor is missing!");
    process.exit(1);
  }
  console.log("\n[1] LOADED PRODUCT ANCHOR:");
  console.log(JSON.stringify(anchor, null, 2));

  // 2. Format Structured Product Capabilities
  const capLines: string[] = [
    `Product/Offering: ${anchor.name} (Type: ${anchor.type}${anchor.offeringType ? `, Model: ${anchor.offeringType}` : ""})`,
  ];
  if (anchor.productSpecs && anchor.productSpecs.length > 0) {
    capLines.push(`Product Specs: ${anchor.productSpecs.join("; ")}`);
  }
  if (anchor.customerUseCases && anchor.customerUseCases.length > 0) {
    capLines.push(`Customer Use Cases: ${anchor.customerUseCases.join("; ")}`);
  }
  if (anchor.problemSolved) {
    capLines.push(`Problem Solved: ${anchor.problemSolved}`);
  }
  if (anchor.uniqueMechanism) {
    capLines.push(`Delivery Mechanism: ${anchor.uniqueMechanism}`);
  }
  if (anchor.strategicAdvantage) {
    capLines.push(`Strategic Advantage: ${anchor.strategicAdvantage}`);
  }
  if (anchor.alternativeReplaced) {
    capLines.push(`Alternatives Replaced: ${anchor.alternativeReplaced}`);
  }
  if (anchor.keyAttributes && anchor.keyAttributes.length > 0) {
    capLines.push(`Key Attributes: ${anchor.keyAttributes.join("; ")}`);
  }
  if (!anchor.problemSolved && anchor.coreProblemSolved) {
    capLines.push(`Core Problem: ${anchor.coreProblemSolved}`);
  }
  if (!anchor.uniqueMechanism && !anchor.strategicAdvantage && anchor.differentiatingFeature) {
    capLines.push(`Differentiator: ${anchor.differentiatingFeature}`);
  }
  const productCapabilities = capLines.join(" | ");

  const [bc] = await db.select().from(brandConfig).where(eq(brandConfig.accountId, accountId)).limit(1);
  const businessProfile = bc ? `Brand: ${bc.brandName || "Unknown"}. Industry: ${bc.targetIndustry || "Unknown"}. Tone: ${bc.tone || "Unknown"}.` : null;

  console.log("\n[2] STRUCTURED PRODUCT TRUTH PASSED TO CLASSIFIER:");
  console.log(productCapabilities);

  // 3. Load latest audience snapshot
  const [latestAudience] = await db
    .select()
    .from(audienceSnapshots)
    .where(eq(audienceSnapshots.campaignId, campaignId))
    .orderBy(desc(audienceSnapshots.createdAt))
    .limit(1);

  if (!latestAudience) {
    console.error("FAIL: No audience snapshot found!");
    process.exit(1);
  }

  const segments = typeof latestAudience.audienceSegments === "string" 
    ? JSON.parse(latestAudience.audienceSegments) 
    : (latestAudience.audienceSegments || []);
  const rawPains = typeof latestAudience.audiencePains === "string" 
    ? JSON.parse(latestAudience.audiencePains) 
    : (latestAudience.audiencePains || []);

  console.log(`\n[3] AUDIENCE CONTEXT: Segments=${segments.length}, Raw Pains=${rawPains.length}`);

  // 4. Build deterministic registry
  const deterministicRegistry = buildAudiencePainRegistry(
    rawPains,
    { accountId, audienceSnapshotId: latestAudience.id },
    segments,
  );

  console.log(`\n[4] DETERMINISTIC REGISTRY: ${deterministicRegistry.length} pains built`);

  // 5. Run Pain Classifier with LLM + Judge
  const refined = await refineAudiencePainRegistry(deterministicRegistry, {
    accountId,
    campaignId,
    productCapabilities,
    businessProfile,
    audienceSegments: segments,
    llmEnabled: true,
  });

  console.log(`\n[5] CLASSIFIER RESULT: Refined Pains=${refined.registry.length}, Classifier=${refined.classifierUsed}, JudgeRejections=${refined.judgeRejections.length}`);

  // 6. Print Full Pain Evaluation Table
  console.log("\n=== COMPLETE PRODUCT FIT EVALUATION TABLE ===");
  console.log("| Pain ID | Canonical Pain | Segment / Role | Classification | Product Fit | Reason | Eligible |");
  console.log("|---|---|---|---|---|---|---|");

  for (const pain of refined.registry) {
    const roleNames = pain.segmentIds.map(sid => segments.find((s: any) => s.id === sid)?.name || sid).join(", ");
    const reasonText = (pain.productFitReason || pain.reason || "").replace(/\|/g, "-");
    console.log(`| ${pain.painId} | ${pain.canonical.replace(/\|/g, "-")} | ${roleNames.replace(/\|/g, "-")} | ${pain.classification} | ${pain.productFit} | ${reasonText} | ${pain.eligible ? "YES" : "NO"} |`);
  }

  // 7. Check for Over-Broad Fit Regression
  console.log("\n=== OVER-BROAD FIT REGRESSION AUDIT ===");
  const consumerKeywords = ["chronic pain", "injury", "body image", "weight loss", "wrinkle", "aesthetic", "aging", "fatigue"];
  let overBroadCount = 0;

  for (const pain of refined.registry) {
    const text = pain.canonical.toLowerCase();
    const roleNames = pain.segmentIds.map(sid => segments.find((s: any) => s.id === sid)?.name || sid).join(", ").toLowerCase();
    const isConsumerPain = consumerKeywords.some(kw => text.includes(kw));
    const isB2BRole = roleNames.includes("procurement") || roleNames.includes("clinic") || roleNames.includes("distributor") || roleNames.includes("reseller") || roleNames.includes("laboratory");

    if (isConsumerPain && isB2BRole && pain.productFit === "ELIGIBLE") {
      console.warn(`[OVER-BROAD DETECTED] Consumer symptom "${pain.canonical}" marked ELIGIBLE for B2B role "${roleNames}"!`);
      overBroadCount++;
    }
  }

  console.log(`Over-broad Consumer Pains as B2B FIT: ${overBroadCount === 0 ? "NONE (PASSED)" : `${overBroadCount} (FAILED)`}`);

  // 8. Rebuild Strategic Lanes
  console.log("\n=== REBUILDING STRATEGIC LANES ===");
  const lanes = await runLaneGrouper(segments, refined.registry, {
    accountId,
    campaignId,
    productCapabilities,
  });

  console.log(`Rebuilt ${lanes.length} Strategic Lanes:`);
  for (const lane of lanes) {
    console.log(`- [Lane: ${lane.title}] Segments: ${lane.segmentIds.length}, Pains: ${lane.painIds.length}, Direction: "${lane.messagingDirection}"`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("Validation error:", err);
  process.exit(1);
});
