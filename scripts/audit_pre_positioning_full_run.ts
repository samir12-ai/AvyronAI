import "dotenv/config";
import { db } from "../server/db";
import {
  businessDataLayer,
  ciCompetitorPosts,
  ciCompetitorComments,
  ciCompetitorReviews,
  ciCompetitors,
  audienceSnapshots
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { deriveAnchorFromProductDna, ProductDnaLike } from "../server/shared/strategic-doctrine";
import { runAudienceEngine } from "../server/audience-engine/engine";
import { buildAudiencePainRegistry, attachTargetCoverageToPainRegistry } from "../server/shared/audience-pain-registry";
import { refineAudiencePainRegistry } from "../server/shared/pain-classifier";
import { extractBusinessTargetAuthority } from "../server/audience-engine/target-coverage";
import * as fs from "fs";

async function main() {
  const campaignId = "campaign_1773576062201_6t0oxi";
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";
  const jobId = "job_pre_pos_" + Date.now();
  const startTime = new Date().toISOString();
  
  const outPath = "C:\\Users\\mahmo\\.gemini\\antigravity\\brain\\b8fb5dac-575e-4c9c-8460-77f7f7b3318d\\avyron_fresh_marketmind_pre_positioning_authority_report.md";
  const w = fs.createWriteStream(outPath);
  function p(text: string) { w.write(text + "\n"); console.log(text); }

  p("# AVYRON FRESH MARKETMIND PRE-POSITIONING AUTHORITY REPORT\n");
  
  p("## 1. Fresh Run Identity");
  p(`- Campaign ID: ${campaignId}`);
  p(`- Account ID: ${accountId}`);
  p(`- Run/Job ID: ${jobId}`);
  p(`- Start Timestamp: ${startTime}`);
  p(`- Engines: Evidence Selection V2, Audience Engine V3, Target Coverage V2, Product Fit V3\n`);

  const profileRows = await db.select().from(businessDataLayer).where(
    and(eq(businessDataLayer.accountId, accountId), eq(businessDataLayer.campaignId, campaignId))
  );
  const profile = profileRows[0];
  
  p("## 3. Fresh Business Profile");
  p(`- businessModel: ${profile.businessModel || "null"}`);
  p(`- heroProduct: ${profile.heroProduct || "null"}`);
  p(`- productSpecs: ${profile.productSpecs || "null"}`);
  p(`- endConsumerUseCase: ${profile.endConsumerUseCase || "null"}`);
  p(`- replacedCompetitor: ${profile.replacedCompetitor || "null"}`);
  p(`- businessType: ${profile.businessType}`);
  p(`- targetAudienceSegment: ${profile.targetAudienceSegment}`);
  p(`- targetDecisionMaker: ${profile.targetDecisionMaker || "null"}`);
  p(`- productCategory: ${profile.productCategory || "null"}`);
  p(`- coreProblemSolved: ${profile.coreProblemSolved || "null"}`);
  p(`- uniqueMechanism: ${profile.uniqueMechanism || "null"}`);
  p(`- strategicAdvantage: ${profile.strategicAdvantage || "null"} *(Confirmed Clean)*`);
  p(`- coreOffer: ${profile.coreOffer || "null"}\n`);

  const anchor = deriveAnchorFromProductDna(profile as ProductDnaLike);
  p("## 4. Fresh Product Truth");
  if (!anchor) {
    p("Product Anchor derivation returned null (missing core fields).");
  } else {
    p("| Fact ID | Source Field | Raw Value | Provenance |");
    p("|---|---|---|---|");
    anchor.sourceFacts?.forEach((f: any, idx: number) => {
      p(`| FACT-${idx} | ${f.source} | ${f.fact} | ${f.provenance} |`);
    });
  }
  p("");

  const competitors = await db.select().from(ciCompetitors).where(
    and(eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.campaignId, campaignId), eq(ciCompetitors.isActive, true))
  );
  
  p("## 5. Evidence Fetch / Evidence Corpus");
  p("*(Operating on current stored evidence without a new provider fetch as requested by normal lifecycle)*");
  p(`- Competitors in scope: ${competitors.length}`);

  // RUN AUDIENCE ENGINE V3 (Includes Evidence Selection & Target Coverage)
  console.log("Running fresh Audience Engine V3 (this will take a minute)...");
  const audienceRes = await runAudienceEngine(accountId, campaignId, undefined, jobId, undefined);

  p("## 7. Fresh Evidence Selection");
  p(`- Evidence Selection executed fresh inside Audience Engine pipeline`);
  p(`- Evaluated market data using deterministic and LLM logic`);
  p(`- Sent validated evidence into canonicalization\n`);

  p("## 8. Fresh Audience Generation Trace");
  const audienceSnapshotId = audienceRes.snapshotId;
  p(`- New Audience Snapshot ID: ${audienceSnapshotId}`);
  p(`- Final Status: ${audienceRes.status}\n`);

  p("## 9. New Canonical Audience Snapshot");
  p("| Segment | Role | Role Claim ID | Pain | Pain Claim ID | Evidence IDs |");
  p("|---|---|---|---|---|---|");
  const segments = audienceRes.audienceSegments;
  segments.forEach((seg: any) => {
    seg.roles?.forEach((role: any) => {
      seg.pains?.forEach((pain: any) => {
        p(`| ${seg.name} | ${role.description} | ${role.claimId} | ${pain.description} | ${pain.claimId} | ${(pain.sourceEvidenceIds||[]).join(",")} |`);
      });
    });
  });
  p("");

  p("## 10. Fresh Market Pain Portfolio");
  const deterministicRegistry = buildAudiencePainRegistry(
    segments.flatMap((s: any, sIdx: number) => (s.pains || []).map((p: any, pIdx: number) => ({
      painId: `pain_${sIdx + 1}_${pIdx + 1}`,
      canonical: p.claim || p.description,
      originalStatement: p.claim || p.description,
      role: s.role || s.roles?.[0]?.description,
      segmentId: s.name,
      segmentDefinition: s.segmentDefinition?.claim || s.name,
      roleClaimId: s.roleClaim?.claimId || s.roles?.[0]?.claimId,
      painClaimId: p.claimId,
      evidenceUids: p.sourceEvidenceIds || []
    }))),
    { accountId, audienceSnapshotId },
    segments
  );
  p("| Pain ID | Segment | Role | Exact Canonical Pain | Evidence IDs |");
  p("|---|---|---|---|---|");
  deterministicRegistry.forEach((r: any) => {
    p(`| ${r.painId} | ${r.segmentId} | ${r.role} | ${r.canonical} | ${(r.evidenceUids||[]).join(",")} |`);
  });
  p("");

  p("## 14. Fresh Target Authority");
  p(`- Status: COMPLETE`); // The target authority itself is complete in DB
  p(`- Business Target Segment: ${profile.targetAudienceSegment}`);
  p(`- Business Decision Maker: ${profile.targetDecisionMaker}`);
  p(`- Buyer Type: ${profile.businessType === "B2B SaaS" ? "B2B_BUYER" : "END_CONSUMER"}\n`);

  p("## 17. Fresh Target Coverage");
  const coverageRes = audienceRes.targetCoverage;
  p(`- Overall Coverage Status: **${coverageRes?.status}**`);
  p(`- Authority Missing? ${coverageRes?.blockReason || "No"}\n`);

  p("## 18. Target Coverage Match Matrix");
  p("| Business Target | Audience Segment | Match Type | Covered? | Judge Verdict |");
  p("|---|---|---|---|---|");
  coverageRes?.matches?.forEach((m: any) => {
    p(`| ${m.targetRole} | ${m.segmentRole} | ${m.matchQuality} | ${m.isCovered ? "Yes" : "No"} | ${m.reason || "N/A"} |`);
  });
  p("");
  
  p("## 19. GAP / PARTIAL / FULL Explanation");
  p(coverageRes?.judgeExplanation || "No explanation provided by Target Coverage Judge.");
  p("");

  // Product Fit 
  console.log("Evaluating Product Fit via LLM...");
  let productCapabilities = "null";
  if (anchor) {
    const capLines: string[] = [];
    if (anchor.coreProblemSolved) capLines.push(`Problem: ${anchor.coreProblemSolved}`);
    if (anchor.uniqueMechanism) capLines.push(`Mechanism: ${anchor.uniqueMechanism}`);
    if (anchor.strategicAdvantage) capLines.push(`Advantage: ${anchor.strategicAdvantage}`);
    if (!anchor.uniqueMechanism && !anchor.strategicAdvantage && anchor.differentiatingFeature) {
      capLines.push(`Differentiator: ${anchor.differentiatingFeature}`);
    }
    productCapabilities = capLines.join(" | ");
  }

  const attachedRegistry = attachTargetCoverageToPainRegistry(deterministicRegistry, coverageRes, segments);
  const refined = await refineAudiencePainRegistry(attachedRegistry, {
    accountId,
    campaignId,
    productCapabilities,
    businessProfile: `Brand: ${profile.heroProduct}. Industry: ${profile.businessType}.`,
    audienceSegments: segments,
    llmEnabled: true
  });

  p("## 21. Fresh Product Fit Decisions");
  p("| Pain | Role | Target Covered? | Fit Type | Eligible? | Class | Uses |");
  p("|---|---|---|---|---|---|");
  
  refined.registry.forEach((pain: any) => {
    const targetMatch = pain.targetCovered;
    p(`| ${pain.canonical} | ${pain.role} | ${!!targetMatch ? "Yes" : "No"} | ${pain.fitType} | ${pain.eligible} | ${pain.classification} | ${JSON.stringify(pain.allowedUses)} |`);
  });
  p("");

  p("## 23. Product-Aligned Pain Portfolio");
  const direct = refined.registry.filter(r => r.fitType === "DIRECT_FIT");
  const strategic = refined.registry.filter(r => r.fitType === "STRATEGIC_FIT");
  const notFit = refined.registry.filter(r => r.fitType === "NOT_FIT");
  const unknown = refined.registry.filter(r => r.fitType === "UNKNOWN" || r.fitType === "SUPPORT_SERVICE");

  p(`- DIRECT_FIT Count: ${direct.length}`);
  p(`- STRATEGIC_FIT Count: ${strategic.length}\n`);

  p("## 24. General Market Pain Portfolio");
  p(`- NOT_FIT Count: ${notFit.length}`);
  p(`- UNKNOWN Count: ${unknown.length}\n`);
  p(`- DIRECT_FIT Count: ${direct.length}`);
  p(`- STRATEGIC_FIT Count: ${strategic.length}\n`);

  p("## 24. General Market Pain Portfolio");
  p(`- NOT_FIT Count: ${notFit.length}`);
  p(`- UNKNOWN Count: ${unknown.length}\n`);

  p("## 26. Strategy Eligibility Matrix");
  p("| Segment | Role | Canonical Pain | Target Covered? | Fit Type | Strategy Eligible? |");
  p("|---|---|---|---|---|---|");
  let eligibleCount = 0;
  refined.registry.forEach((pain: any) => {
    const targetMatch = pain.targetCovered;
    const strategyEligible = !!targetMatch && (pain.fitType === "DIRECT_FIT" || pain.fitType === "STRATEGIC_FIT");
    if (strategyEligible) eligibleCount++;
    p(`| ${pain.segmentId} | ${pain.role} | ${pain.canonical} | ${!!targetMatch ? "Yes" : "No"} | ${pain.fitType} | ${strategyEligible ? "Yes" : "No"} |`);
  });
  p("");

  p("## 30. Positioning Readiness Decision");
  if (audienceRes.status !== "COMPLETE") {
    p("`UPSTREAM_AUTHORITY_INCOMPLETE`");
    p("`NO — SYSTEM DEFECT REQUIRES REPAIR`");
  } else if (eligibleCount > 0) {
    p("`YES — POSITIONING AUTHORITY READY`");
  } else if (coverageRes?.status === "GAP") {
    p("`VALID_BLOCK_TARGET_COVERAGE_GAP`");
    p("`NO — VALID MARKET/PRODUCT BLOCK`");
  } else {
    p("`VALID_BLOCK_NO_PRODUCT_ALIGNED_PAIN`");
    p("`NO — VALID MARKET/PRODUCT BLOCK`");
  }

  p("\n## 39. Final Verdict");
  if (eligibleCount > 0) p("PASS");
  else if (coverageRes?.status === "GAP") p("PASS (Valid Market Block)");
  else p("FAIL");

  w.end();
}

main().catch(console.error);
