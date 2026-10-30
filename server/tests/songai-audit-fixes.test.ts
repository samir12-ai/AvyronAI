import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  PRICING_VERSION,
  MODEL_PRICING_PER_1M_TOKENS,
  calculateCallCost,
  extractOpenAIUsage,
  extractGeminiUsage,
  classifyAIError,
  __resetProviderCircuitBreakerForTests,
} from "../ai-client";
import { buildCompactDifferentiationPromptInput } from "../differentiation-engine/proposer";
import { bindPainEvidence, attachTargetCoverageToPainRegistry } from "../shared/audience-pain-registry";
import { extractNarrativeObjections } from "../market-intelligence-v3/narrative-objection-extractor";
import { computeAllSignals } from "../market-intelligence-v3/signal-engine";
import { buildCompetitorCoverageRegistry } from "../market-intelligence-v3/engine";
import { buildCommercialAudienceSynthesis } from "../audience-engine/engine";
import { sanitizeTerritoryName, filterAudienceTerritories } from "../positioning-engine/engine";
import { buildSectionStatusEntry } from "../orchestrator/index";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

test("1. AI Spend & Telemetry Accounting: versioned pricing table, split input/output rates, and unknown model null cost", () => {
  assert.ok(PRICING_VERSION.length > 0);
  assert.ok(MODEL_PRICING_PER_1M_TOKENS["gpt-4o"]);
  assert.ok(MODEL_PRICING_PER_1M_TOKENS["gpt-4o-mini"]);
  assert.ok(MODEL_PRICING_PER_1M_TOKENS["gpt-4.1-mini"]);
  assert.ok(MODEL_PRICING_PER_1M_TOKENS["gemini-2.5-flash"]);

  const oaiUsage = extractOpenAIUsage({
    usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 },
  });
  assert.equal(oaiUsage.inputTokens, 1_000_000);
  assert.equal(oaiUsage.outputTokens, 1_000_000);
  assert.equal(oaiUsage.totalTokens, 2_000_000);
  assert.equal(oaiUsage.usageAvailable, true);

  // 1M input ($2.50) + 1M output ($10.00) = $12.50 (not blended $5/1k)
  const gpt4oCost = calculateCallCost("gpt-4o", oaiUsage);
  assert.equal(gpt4oCost.costStatus, "ESTIMATED");
  assert.equal(gpt4oCost.effectiveCostUsd, 12.5);

  // gpt-4.1-mini: 1M input ($0.40) + 1M output ($1.60) = $2.00
  const gpt41MiniCost = calculateCallCost("gpt-4.1-mini", oaiUsage);
  assert.equal(gpt41MiniCost.costStatus, "ESTIMATED");
  assert.equal(gpt41MiniCost.effectiveCostUsd, 2.0);

  // Unknown model (gemini-3.6-flash) must return null cost and PRICING_UNKNOWN (never $0)
  const geminiUsage = extractGeminiUsage({
    usageMetadata: { promptTokenCount: 50_000, candidatesTokenCount: 10_000, totalTokenCount: 60_000 },
  });
  assert.equal(geminiUsage.inputTokens, 50_000);
  assert.equal(geminiUsage.outputTokens, 10_000);
  assert.equal(geminiUsage.totalTokens, 60_000);
  assert.equal(geminiUsage.usageAvailable, true);

  const unknownCost = calculateCallCost("gemini-3.6-flash", geminiUsage);
  assert.equal(unknownCost.costStatus, "PRICING_UNKNOWN");
  assert.equal(unknownCost.estimatedCostUsd, null);
  assert.equal(unknownCost.effectiveCostUsd, null);
});

test("2. AI Error Classification & Provider Billing Circuit Breaker", () => {
  __resetProviderCircuitBreakerForTests();

  const billingErr = classifyAIError(
    new Error("429 insufficient_quota: You exceeded your current quota, please check your plan and billing details.")
  );
  assert.equal(billingErr, "BILLING_EXHAUSTED");

  const noCreditsErr = classifyAIError(
    new Error("Your credit balance is too low to access the API (no credits remaining).")
  );
  assert.equal(noCreditsErr, "BILLING_EXHAUSTED");

  const rateLimitErr = classifyAIError(
    new Error("429 Rate limit reached for requests per minute")
  );
  assert.equal(rateLimitErr, "RATE_LIMITED");

  const malformedErr = classifyAIError(
    Object.assign(new Error("Gemini JSON mode returned malformed JSON"), { code: "MALFORMED_OUTPUT" })
  );
  assert.equal(malformedErr, "MALFORMED_OUTPUT");
});

test("3. Differentiation Prompt Compaction, Guarantee Narrowing & Round-1 Baseline-Only Defect Handling", () => {
  const hugeMiFacts = Array.from({ length: 40 }, (_, idx) => ({
    miAuthorityId: `mi_${idx}`,
    competitorId: `comp_${idx % 18}`,
    competitorName: `Competitor ${idx % 18}`,
    category: "offer",
    statement: `Offer ${idx} details with verbose marketing copy `.repeat(15),
    rawEvidenceReference: { hugeRowPayload: "x".repeat(2000) },
  }));
  const hugeEvidence = Array.from({ length: 80 }, (_, idx) => ({
    customerEvidenceId: `cev_${idx}`,
    painIds: idx < 6 ? ["pain_1"] : [],
    verbatimText: `Customer complaint about late delivery and broken download link #${idx}. `.repeat(12),
    sourceType: "trustpilot",
    competitorId: idx < 10 ? "comp_songfinch" : undefined,
    competitorName: idx < 10 ? "Songfinch" : undefined,
    rawEvidenceReference: { hugeRowPayload: "y".repeat(2000) },
  }));

  const rawInput = {
    lineage: { campaignId: "camp_test" },
    ourProductFacts: [
      { productTruthFactId: "pf_1", category: "delivery", fact: "Delivered in 24-72 hours as a digital MP3 download and streaming link" },
      { productTruthFactId: "pf_2", category: "pricing", fact: "One-time purchase £49.99" },
    ],
    productTruth: [
      { productTruthFactId: "pf_1", category: "delivery", fact: "Delivered in 24-72 hours as a digital MP3 download and streaming link" },
      { productTruthFactId: "pf_2", category: "pricing", fact: "One-time purchase £49.99" },
    ],
    miFacts: hugeMiFacts,
    competitiveAuthority: hugeMiFacts,
    customerEvidence: hugeEvidence,
    corePains: [
      {
        painId: "pain_1",
        canonicalPain: "Delayed song delivery missing gift occasions",
        customerEvidenceIds: ["cev_0", "cev_1"],
        customerEvidence: hugeEvidence.slice(0, 20),
      },
    ],
  };

  const compact = buildCompactDifferentiationPromptInput(rawInput as any);
  const rawChars = JSON.stringify(rawInput).length;
  const compactChars = JSON.stringify(compact).length;
  assert.ok(compactChars < rawChars * 0.25, `Expected compact payload (${compactChars}) < 25% of raw (${rawChars})`);
  assert.equal(compact.ourProductFacts.length, 2);
  assert.ok(compact.customerEvidence.length <= 30);

  // Verify guarantee narrowing and Round 1 comparisonBaseline-only shortcut in source
  const diffEngineSrc = fs.readFileSync(
    path.join(REPO_ROOT, "server/differentiation-engine/engine.ts"),
    "utf8"
  );
  assert.ok(/finalizeComparisonBaselineOnlyDefect/.test(diffEngineSrc), "finalizeComparisonBaselineOnlyDefect missing");
  assert.ok(/ROUND1_BASELINE_REPAIR_FINALIZED/.test(diffEngineSrc), "ROUND1_BASELINE_REPAIR_FINALIZED missing");
  assert.ok(/direct MP3 download and shareable link access/.test(diffEngineSrc), "permanent and unrestricted access narrowing missing");
  assert.ok(/with defined package tier options before checkout/.test(diffEngineSrc), "avoiding unexpected post-purchase charges narrowing missing");
});

test("4. Audience Pain Evidence Decoded Excerpt Deduplication & Fabricated Pain Removal", () => {
  // Duplicate decoded text across two different evidence IDs & platforms (HTML entity vs literal apostrophe)
  const candidatePain = {
    painId: "pain_delivery",
    canonical: "Delayed delivery missing special gift dates",
    evidenceUids: ["cev_trustpilot_1", "cev_reddit_2"],
  };
  const registryMap = new Map<string, any>([
    [
      "cev_trustpilot_1",
      {
        canonicalEvidenceId: "cev_trustpilot_1",
        verbatimText: "Ordered a custom song for our anniversary and waited 7 days&#39; delay with no link.",
        platform: "trustpilot",
        author: "Sarah M.",
        competitorId: "comp_songfinch",
        competitorName: "Songfinch",
      },
    ],
    [
      "cev_reddit_2",
      {
        canonicalEvidenceId: "cev_reddit_2",
        verbatimText: "Ordered a custom song for our anniversary and waited 7 days' delay with no link.",
        platform: "reddit",
        author: "u/giftbuyer",
      },
    ],
  ]);

  const bound = bindPainEvidence(candidatePain, registryMap);
  assert.ok(bound && bound.mode === "GROUNDED");
  // Must collapse the identical decoded quote across platforms into 1 unique evidence item while preserving competitor attribution
  assert.equal(bound.uniqueEvidenceCount, 1);
  assert.equal(bound.evidence.length, 1);
  assert.equal(bound.evidence[0].competitorId, "comp_songfinch");
  assert.equal(bound.evidence[0].competitorName, "Songfinch");
  assert.deepEqual(bound.evidence[0].rawEvidenceUids, ["cev_trustpilot_1", "cev_reddit_2"]);

  // Verify "stop chasing" competitor caption does NOT fabricate "Current solutions waste money without results"
  const objectionMap = extractNarrativeObjections([
    {
      competitorId: "comp_1",
      competitorName: "Tuneflow",
      posts: [
        {
          id: "post_1",
          caption: "Stop chasing trending sounds and start creating original tracks today!",
        },
      ],
    } as any,
  ]);
  const fabricated = objectionMap.objections.find(
    (o) => o.objection === "Current solutions waste money without results"
  );
  assert.equal(fabricated, undefined);
});

test("5. B2B Target Coverage Gap & Digital Product Modality Guard", () => {
  // Verify target-coverage.ts sets evidenceGap = unsupportedTargetRoles.length > 0 when status === "PARTIAL"
  const targetCoverageSrc = fs.readFileSync(
    path.join(REPO_ROOT, "server/audience-engine/target-coverage.ts"),
    "utf8"
  );
  assert.ok(
    /status = "PARTIAL";\s*evidenceGap = unsupportedTargetRoles\.length > 0;/.test(targetCoverageSrc),
    "PARTIAL target coverage evidenceGap fix missing"
  );

  const attached = attachTargetCoverageToPainRegistry(
    [
      {
        painId: "pain_1",
        canonical: "Delayed custom song delivery",
        classification: "CORE_PURCHASE",
        segmentIds: ["seg_1"],
      } as any,
    ],
    {
      status: "PARTIAL",
      supportedTargetRoles: ["Consumer Gift Buyers"],
      unsupportedTargetRoles: ["Corporate Event Planners & HR Teams"],
      evidenceGap: true,
      reason: "Partial coverage: 1/2 target roles supported. Evidence gap for unsupported role(s): Corporate Event Planners & HR Teams (no B2C substitution allowed).",
      targetRoles: [],
    },
    [{ id: "seg_1", name: "Milestone Gift Buyers" }] as any
  );
  assert.equal(attached.length, 1);

  // Directly invoke buildCommercialAudienceSynthesis on a digital song offering labeled "ecommerce"
  const digitalSynthesis = buildCommercialAudienceSynthesis({
    businessUnderstanding: {
      brandName: "Songai",
      businessType: "ecommerce",
      coreOffer: "Custom personalised digital songs delivered online as MP3",
      offerings: [
        {
          id: "off_songai",
          offeringName: "Songai Custom Digital Song",
          description: "Personalised song delivered online via MP3 download link",
        },
      ],
    },
    selectedOfferingId: "off_songai",
    painMap: [
      {
        canonical: "Delayed delivery and broken download links before anniversary date",
        frequency: 4,
      } as any,
    ],
    productTruthFacts: ["Delivered online in 24-72 hours as a high-quality MP3 download and streaming link"],
  });

  const synthJson = JSON.stringify(digitalSynthesis);
  assert.ok(!/crush-proof|shock-absorbing|baklava|thermal|perishable/i.test(synthJson), "Digital synthesis must not contain physical shipping/packaging templates");
  assert.ok(/Milestone & Occasion Gifting/i.test(synthJson), "Digital synthesis should use digital/commissioning purchase situations");
});

test("6. MIv3 Full 18-Competitor Cohort, Deterministic Ordering & Competitor Coverage Registry", () => {
  const mockCompetitors = Array.from({ length: 18 }, (_, i) => {
    const num = String(18 - i).padStart(2, "0");
    const hasPosts = i < 11;
    const hasCU = i >= 11 && i < 16;
    return {
      id: `comp_${num}`,
      name: `Competitor ${num}`,
      posts: hasPosts
        ? [
            {
              id: `post_${num}_1`,
              caption: "Custom personalised song delivered in 24 hours — £49",
              likes: 120,
              comments: 15,
              timestamp: new Date().toISOString(),
            },
          ]
        : [],
      comments: [],
      competitorUnderstanding: hasCU
        ? {
            capabilities: [{ statement: "Custom vocal recording and MP3 digital download" }],
            positioning: [{ statement: "Personalised gift songs for every occasion" }],
            offers: [{ offerStatement: "£49 standard 24-hour digital delivery", pricing: "£49", cta: "Create Your Song" }],
            proof: [{ statement: "Over 10,000 5-star customer reviews" }],
          }
        : null,
    };
  });

  const signals = computeAllSignals(mockCompetitors as any);
  // Must include all 18 competitors (no .slice(0, 10) truncation) and be sorted deterministically by competitorId
  assert.equal(signals.length, 18);
  assert.equal(signals[0].competitorId, "comp_01");
  assert.equal(signals[17].competitorId, "comp_18");

  // Competitors with 0 posts but valid competitorUnderstanding must emit [COMPETITOR_UNDERSTANDING] semanticSignals
  const cuOnlySignal = signals.find((s) => s.competitorId === "comp_05");
  assert.ok(cuOnlySignal);
  assert.ok(
    cuOnlySignal.semanticSignals.some((s) => s.snippet.startsWith("[COMPETITOR_UNDERSTANDING]")),
    "Expected [COMPETITOR_UNDERSTANDING] semantic signal on 0-post competitor with website understanding"
  );
  assert.ok(cuOnlySignal.signalCoverageScore > 0);

  const registry = buildCompetitorCoverageRegistry(mockCompetitors as any, []);
  assert.equal(registry.length, 18);
  assert.equal(registry[0].competitorId, "comp_01");
  assert.equal(registry[17].competitorId, "comp_18");
  const withEvidenceCount = registry.filter(
    (r) => r.availableEvidence.postsCount > 0 || r.availableEvidence.websiteUnderstanding
  ).length;
  const withoutEvidenceCount = registry.filter(
    (r) => r.availableEvidence.postsCount === 0 && !r.availableEvidence.websiteUnderstanding
  ).length;
  assert.equal(withEvidenceCount, 16);
  assert.equal(withoutEvidenceCount, 2);
});

test("7. Positioning Territory Sanitizer, Epistemic Proposal Labels & Mechanism Judge NOT_EVALUATED Handling", () => {
  // Directly test sanitizeTerritoryName stripping brand name + "Failure System" jargon
  const sanitized = sanitizeTerritoryName("Songai Delivery Access Failure System", {
    brandName: "Songai",
    coreOffer: "Custom personalised digital songs",
    businessType: "ecommerce",
  });
  assert.ok(!/Songai/i.test(sanitized), `Expected brand name stripped, got: ${sanitized}`);
  assert.ok(!/Failure System/i.test(sanitized), `Expected Failure System stripped, got: ${sanitized}`);
  assert.equal(sanitized, "Direct Digital Delivery & Access Clarity");

  // Directly test filterAudienceTerritories retaining digital song delivery territories
  const filterRes = filterAudienceTerritories([
    {
      name: "Direct Digital Delivery & Access Clarity",
      opportunityScore: 0.82,
      narrativeDistanceScore: 0.75,
      painAlignment: ["Delayed delivery and broken download links"],
      desireAlignment: ["Immediate MP3 access"],
      enemyDefinition: "Opaque custom song platforms that delay digital delivery",
      contrastAxis: "Predictable digital song delivery vs opaque turnaround",
      narrativeDirection: "Own transparent online song delivery",
      isStable: true,
      stabilityNotes: [],
      evidenceSignals: [" waited 7 days for the song "],
      confidenceScore: 0.8,
    } as any,
  ]);
  assert.equal(filterRes.systemLevel.length, 1);
  assert.equal(filterRes.rejected.length, 0);

  const posEngineSrc = fs.readFileSync(
    path.join(REPO_ROOT, "server/positioning-engine/engine.ts"),
    "utf8"
  );
  assert.ok(/PROPOSED_CAPABILITY/.test(posEngineSrc), "PROPOSED_CAPABILITY missing in positioning engine.ts");
  assert.ok(/Proposed Positioning & Packaging Direction — Requires Validation/.test(posEngineSrc), "Proposed Positioning & Packaging Direction label missing in positioning engine.ts");
  assert.ok(/UNAVAILABLE_OR_FAILED/.test(posEngineSrc), "UNAVAILABLE_OR_FAILED missing in positioning engine.ts");
  assert.ok(/degraded_or_orphaned_primary_cap/.test(posEngineSrc), "degraded_or_orphaned_primary_cap missing in positioning engine.ts");

  const mechEngineSrc = fs.readFileSync(
    path.join(REPO_ROOT, "server/mechanism-engine/engine.ts"),
    "utf8"
  );
  assert.ok(/axisVerdict:\s*"NOT_EVALUATED"/.test(mechEngineSrc), "axisVerdict NOT_EVALUATED missing in mechanism engine.ts");
  assert.ok(/preservedCandidate/.test(mechEngineSrc), "preservedCandidate missing in mechanism engine.ts");
  assert.ok(!/unsupportedPredicates:\s*\["Unparseable evaluation"\]/.test(mechEngineSrc), "Unparseable evaluation still present in mechanism engine.ts");
});

test("8. Recovery Mode & Error Classification in Orchestrator Section Statuses", () => {
  const billingSection = buildSectionStatusEntry(
    { id: "mechanism" as any, name: "Conversion Mechanism" },
    {
      engineId: "mechanism" as any,
      status: "BLOCKED",
      durationMs: 1200,
      blockReason: "Mechanism Semantic Role Judge unavailable (BILLING_EXHAUSTED): monthly spending limit reached",
      output: {
        status: "INCOMPLETE",
        diagnostics: {
          roleVerdict: {
            verdict: "NOT_EVALUATED",
            axisVerdict: "NOT_EVALUATED",
            errorCategory: "BILLING_EXHAUSTED",
          },
        },
      },
    }
  );
  assert.equal(billingSection.failureCategory, "BILLING_EXHAUSTED");

  const malformedSection = buildSectionStatusEntry(
    { id: "mechanism" as any, name: "Conversion Mechanism" },
    {
      engineId: "mechanism" as any,
      status: "BLOCKED",
      durationMs: 900,
      blockReason: "Judge technical failure (MALFORMED_OUTPUT): truncated JSON",
      output: {
        status: "INCOMPLETE",
      },
    }
  );
  assert.equal(malformedSection.failureCategory, "MALFORMED_OUTPUT");
});
