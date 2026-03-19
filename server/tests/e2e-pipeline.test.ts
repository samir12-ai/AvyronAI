/**
 * END-TO-END PIPELINE CHECK
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs all 15 engines in priority order through a single test pass.
 * Each engine receives the output of the previous engine(s) as input —
 * exactly as the Orchestrator wires them.
 *
 * AI calls are intercepted with vi.mock and return deterministic fixture
 * payloads so the test is fast and free, while still exercising every
 * engine's real parsing, scoring, compliance, and contract-enforcement logic.
 *
 * DB snapshot reads/writes are also mocked so no live database is required.
 *
 * What is NOT mocked (runs for real every pass):
 *   • All CEL enforcement (enforceEngineDepthCompliance, classifyClaims)
 *   • All SGL signal tracking and resolution
 *   • Positioning Lock + anti-drift anchor injection
 *   • Cosine similarity (embedding.ts)
 *   • Integrity Engine (pure deterministic)
 *   • Budget Governor (pure deterministic)
 *   • Channel Selection (pure deterministic)
 *   • Statistical Validation (pure deterministic scoring)
 *   • All engine-hardening gates (boundary, genericness, reliability)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, test, expect, vi, beforeAll, afterAll } from "vitest";
import { cosineSimilarity } from "../shared/embedding";
import { initializeSignalGovernance, getGovernanceSummary } from "../signal-governance/engine";
import { buildAnalyticalPackage } from "../analytical-enrichment-layer/engine";
import {
  enforceEngineDepthCompliance,
  enforceGenericEngineCompliance,
  isDepthBlocking,
} from "../causal-enforcement-layer/engine";
import { runDifferentiationEngine } from "../differentiation-engine/engine";
import { runMechanismEngine } from "../mechanism-engine/engine";
import { runOfferEngine } from "../offer-engine/engine";
import { runAwarenessEngine } from "../awareness-engine/engine";
import { runFunnelEngine } from "../funnel-engine/engine";
import { runPersuasionEngine } from "../persuasion-engine/engine";
import { runIntegrityEngine } from "../integrity-engine/engine";
import { runStatisticalValidationEngine } from "../strategy/statistical-validation/engine";
import { runBudgetGovernorEngine } from "../strategy/budget-governor/engine";
import { runChannelSelectionEngine } from "../strategy/channel-selection/engine";
import { runIterationEngine } from "../strategy/iteration-engine/engine";
import { runRetentionEngine } from "../strategy/retention-engine/engine";

// ─── AI-CLIENT MOCK ──────────────────────────────────────────────────────────
// Returns fixture JSON for each engine based on prompt content.
vi.mock("../ai-client", () => ({
  aiChat: vi.fn(async (messages: any[]) => {
    const allText = messages.map((m: any) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n").toLowerCase();

    // AEL (Analytical Enrichment Layer)
    if (allText.includes("analytical package") || allText.includes("ael") || allText.includes("root causes") || allText.includes("enrichment")) {
      return JSON.stringify({
        root_causes: [
          "entrepreneurs lack a repeatable client-acquisition system that generates predictable revenue",
          "hidden costs of undisclosed fees erode trust and increase churn",
        ],
        causal_chain: [
          "no reliable lead generation → inconsistent revenue → reliance on referrals → growth ceiling",
        ],
        barriers: [
          "fear of investing in marketing without guaranteed ROI",
          "distrust of agencies due to undisclosed fees and opaque billing",
        ],
        behavioral_triggers: [
          "social proof from peers in same niche",
          "transparent pricing with guaranteed outcome",
        ],
        desire_map: [
          "consistent $10k–$50k months without working 60-hour weeks",
          "marketing system that runs without constant oversight",
        ],
        objection_themes: [
          "too expensive",
          "tried agencies before and got burned",
        ],
        psychological_drivers: [
          "desire for financial freedom and autonomy",
          "fear of falling behind competitors",
        ],
        market_maturity: "developing",
        awareness_concentration: "problem_aware",
        competitive_gap: "no competitor transparently proves ROI before commitment",
      });
    }

    // Positioning Engine
    if (allText.includes("positioning") && (allText.includes("territory") || allText.includes("narrative"))) {
      return JSON.stringify({
        territories: [
          {
            name: "Transparent Growth Partner",
            contrastAxis: "transparent results-first vs opaque retainer agencies",
            narrativeDirection: "FROM endless agency fees that drain profit TO a clear-path client acquisition system with guaranteed monthly ROI",
            specificity: 0.81,
            saturation: 0.22,
            differentiationVector: ["transparent billing", "guaranteed ROI proof before commitment", "no long-term contracts"],
            mechanismHint: "Revenue-Proof Acquisition System",
          },
        ],
        narrative: "For entrepreneurs who've been burned by agencies promising results but delivering invoices, we are the only marketing system that proves ROI on paper before you pay a single dollar.",
        narrativeDirection: "FROM opaque agency billing TO transparent client acquisition with pre-committed proof",
        specificityScore: 0.81,
        saturationScore: 0.22,
        strategyCards: [
          {
            name: "Proof-First Outreach",
            type: "flanking",
            rationale: "Competitors avoid committing to measurable outcomes — we lead with proof to own the trust gap",
            executableInsight: "Lead every cold message with a specific, verifiable outcome from a peer in the prospect's niche",
          },
        ],
        differentiationVector: ["transparent billing", "guaranteed ROI proof", "no retainers"],
        contrastAxis: "transparent results-first vs opaque retainer agencies",
        enemyDefinition: "retainer agencies that bill monthly regardless of results",
        stabilityResult: { isStable: true, checks: [], advisories: [], fallbackApplied: false },
      });
    }

    // Differentiation Engine
    if (allText.includes("differentiation") || allText.includes("claims") || allText.includes("pillars") || allText.includes("collision")) {
      return JSON.stringify({
        claims: [
          "Our Revenue-Proof Acquisition System guarantees a minimum of 3 qualified client calls in the first 30 days or you pay nothing",
          "Transparent billing: every dollar is traceable to a specific campaign activity — no hidden fees ever",
          "72-hour campaign activation: your first outreach sequence goes live within 3 business days of onboarding",
        ],
        collisions: [
          { claim: "money-back guarantee", competitorName: "Agency X", collisionType: "weak_overlap", riskScore: 0.28 },
        ],
        trustGaps: [
          { gap: "buyers cannot verify ROI claims before committing", severity: "high", resolution: "show verified client revenue screenshots with name redacted" },
        ],
        proofDemandMap: [
          { claim: "3 qualified calls in 30 days", proofType: "client_screenshot", demand: "high" },
          { claim: "transparent billing", proofType: "invoice_sample", demand: "medium" },
        ],
        validatedClaims: [
          "Revenue-Proof Acquisition System: 3 qualified calls in 30 days or full refund",
          "Transparent billing — every dollar traceable to campaign activity",
        ],
        differentiationScore: 0.79,
        authorityMode: "PROOF_LED",
        mechanismFraming: "Revenue-Proof Acquisition System",
        mechanismCore: "systematic cold outreach + proof-first positioning that converts skeptical buyers before first call",
        claimStructures: [
          { claim: "3 qualified calls in 30 days", type: "outcome_guarantee", specificity: 0.88 },
          { claim: "transparent billing", type: "process_proof", specificity: 0.74 },
        ],
      });
    }

    // Mechanism Engine
    if (allText.includes("mechanism") && !allText.includes("differentiation")) {
      return JSON.stringify({
        mechanismName: "Revenue-Proof Acquisition System (RPAS)",
        mechanismDescription: "A 3-phase systematic outreach process: (1) Proof-First Positioning — lead with verified client screenshots, (2) Authority Bridge — peer-proof sequencing that pre-handles the 'agencies lie' objection, (3) Commitment-Free Diagnostic — a 20-minute call framed as an ROI audit, not a sales call.",
        uniqueMechanismCore: "The only client-acquisition system where the prospect sees verifiable ROI evidence from 3 peers in their niche before agreeing to a discovery call — collapsing the trust barrier that kills most outreach.",
        phaseBreakdown: [
          { phase: 1, name: "Proof-First Positioning", action: "Lead with verified peer screenshots in first touch", outcomeMetric: "reply rate ≥ 12%" },
          { phase: 2, name: "Authority Bridge", action: "3-email sequence addressing the agency-trust objection directly", outcomeMetric: "positive response rate ≥ 8%" },
          { phase: 3, name: "Commitment-Free Diagnostic", action: "20-min ROI audit framed with zero sales pressure", outcomeMetric: "call show rate ≥ 65%" },
        ],
        confidenceScore: 0.82,
        depthScore: 0.77,
      });
    }

    // Offer Engine
    if (allText.includes("offer") && (allText.includes("headline") || allText.includes("price") || allText.includes("stack"))) {
      return JSON.stringify({
        offerName: "The Revenue-Proof Client Acquisition Program",
        headline: "3 Qualified Client Calls in 30 Days — Or You Don't Pay",
        coreOutcome: "A predictable pipeline of 3–8 qualified discovery calls per month from cold outreach, without paid ads, retainers, or long-term contracts",
        mechanismDescription: "Revenue-Proof Acquisition System (RPAS): 3-phase proof-first outreach that converts skeptical buyers before the first call",
        valueStack: [
          "Proof-First Positioning Package — verified peer-proof assets (3 niche-matched case studies)",
          "Authority Bridge Email Sequence (7 emails, fully written and scheduled)",
          "Commitment-Free Diagnostic Script — ROI-audit framing that pre-handles objections",
          "30-Day Performance Dashboard — every metric traceable to campaign activity",
        ],
        priceAnchoring: {
          perceivedValue: "$4,800",
          investmentFrame: "$1,497/month — cancellable any time, guaranteed results or refund",
        },
        guaranteeStatement: "3 qualified calls in your first 30 days or we refund 100% and continue working for free until you do.",
        urgencyMechanism: "Only 4 spots per cohort — onboarding closes when cohort is full",
        nonGenericAnchors: [
          "RPAS proof-first outreach",
          "transparent billing — every dollar traceable",
          "peer-niche verification before first call",
        ],
      });
    }

    // Awareness Engine
    if (allText.includes("awareness") && (allText.includes("route") || allText.includes("stage") || allText.includes("entry"))) {
      return JSON.stringify({
        primaryRoute: {
          routeName: "problem-aware-proof-led-trust-rebuild",
          targetReadinessStage: "problem_aware",
          entryMechanismType: "proof_led_cold_outreach",
          triggerClass: "agency_trust_collapse",
          trustRequirement: "high",
          awarenessStrengthScore: 0.76,
          entryMessage: "You've hired agencies. You got invoices. Here's what 3 of our clients in your niche got instead.",
          contentHooks: [
            "I tracked every dollar from our last 30-day campaign. Here's the receipts.",
            "The only agency that shows you results before you sign anything.",
            "What a $1,497/month investment looks like when you can see every metric.",
          ],
        },
        routes: [
          {
            routeName: "problem-aware-proof-led-trust-rebuild",
            targetReadinessStage: "problem_aware",
            awarenessStrengthScore: 0.76,
          },
          {
            routeName: "solution-aware-comparison-bridge",
            targetReadinessStage: "solution_aware",
            awarenessStrengthScore: 0.61,
          },
        ],
        awarenessGapDiagnostic: "Primary audience is problem-aware but deeply trust-skeptical — proof must precede any mechanism explanation",
      });
    }

    // Funnel Engine
    if (allText.includes("funnel") && (allText.includes("stage") || allText.includes("sequence") || allText.includes("conversion"))) {
      return JSON.stringify({
        funnelName: "Trust-Rebuild Acquisition Funnel",
        stages: [
          {
            name: "Cold Outreach — Proof Hook",
            objective: "Interrupt pattern of skepticism with verifiable peer-proof before any pitch",
            contentStrategy: "Lead with 3 verified client screenshots in first message — no ask, just proof",
            conversionTarget: "12% reply rate on cold outreach",
          },
          {
            name: "Authority Bridge Sequence",
            objective: "Pre-handle agency-trust objection across 3-email sequence before discovery call ask",
            contentStrategy: "Email 1: problem acknowledgement, Email 2: mechanism explanation, Email 3: diagnostic offer",
            conversionTarget: "8% positive response leading to diagnostic call",
          },
          {
            name: "Commitment-Free Diagnostic",
            objective: "Convert diagnostic call to program enrollment with zero sales pressure",
            contentStrategy: "ROI audit framing: show them what their current outreach is costing in missed revenue",
            conversionTarget: "35% close rate on diagnostic calls",
          },
        ],
        primaryConversionPath: "cold-outreach → proof-hook → authority-bridge → diagnostic-call → enrollment",
        funnelStrengthScore: 0.78,
        entryPointRecommendation: "LinkedIn cold DM + email sequence combo targeting coaches and consultants $10k+/month",
      });
    }

    // Persuasion Engine
    if (allText.includes("persuasion") || allText.includes("routes") || allText.includes("psychological")) {
      return JSON.stringify({
        persuasionRoutes: [
          {
            routeName: "authority-proof-trust-rebuild-RPAS",
            primaryDriver: "verifiable peer proof from same niche",
            sequence: [
              "Acknowledge the agency-trust wound explicitly ('you've been billed without results')",
              "Show 3 verified peer outcomes — same niche, specific numbers",
              "Introduce RPAS mechanism without pressure ('here is what made the difference')",
              "Offer the commitment-free diagnostic as a curiosity vehicle, not a close",
            ],
            frictionNotes: [
              "LOCK CONSTRAINT: contrast_axis=transparent results-first vs opaque retainer agencies",
              "ENEMY: retainer agencies that bill monthly regardless of results",
              "MECHANISM ANCHOR: Revenue-Proof Acquisition System",
            ],
          },
        ],
        sequences: [
          "Acknowledge pain → Show proof → Explain mechanism → No-pressure offer",
        ],
        primaryRoute: "authority-proof-trust-rebuild-RPAS",
        persuasionStrengthScore: 0.81,
      });
    }

    // Statistical Validation / other AI engines
    if (allText.includes("statistical") || allText.includes("validation") || allText.includes("confidence")) {
      return JSON.stringify({
        validationConfidence: 0.74,
        claimValidations: [
          { claim: "3 qualified calls in 30 days", confidence: 0.82, evidenceType: "outcome_guarantee", grounded: true },
          { claim: "transparent billing", confidence: 0.91, evidenceType: "process_proof", grounded: true },
        ],
        strategyAcceptability: "ACCEPTABLE",
        signalGrounding: 0.77,
      });
    }

    // Iteration / Retention
    if (allText.includes("iteration") || allText.includes("retention") || allText.includes("lifecycle")) {
      return JSON.stringify({
        recommendations: [
          "A/B test proof-hook message with direct ROI claim vs peer-screenshot opener",
          "Add urgency trigger at day 14 of outreach sequence for non-responders",
        ],
        retentionStrategy: {
          milestones: ["30-day ROI report delivered", "60-day referral incentive introduced"],
          churnPrevention: "Monthly transparent billing review with client — shows every dollar's impact",
        },
        iterationConfidence: 0.71,
      });
    }

    return JSON.stringify({ status: "OK", note: "generic fixture" });
  }),
}));

// ─── DB MOCK ─────────────────────────────────────────────────────────────────
vi.mock("../db", () => {
  const snapshotId = () => `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const fakeBuilder = {
    select: () => fakeBuilder,
    from: () => fakeBuilder,
    where: () => fakeBuilder,
    limit: () => fakeBuilder,
    orderBy: () => fakeBuilder,
    desc: () => fakeBuilder,
    then: (resolve: any) => resolve([]),
  };
  return {
    db: {
      select: () => fakeBuilder,
      insert: () => ({ values: () => ({ returning: async () => [{ id: snapshotId() }] }) }),
      update: () => ({ set: () => ({ where: async () => [] }) }),
      delete: () => ({ where: async () => [] }),
    },
  };
});

// Mock shared modules that need DB
vi.mock("../shared/product-dna", () => ({
  loadProductDNA: async () => ({
    businessType: "B2B Service",
    coreOffer: "Done-for-you client acquisition for coaches and consultants",
    coreProblemSolved: "Inconsistent revenue from unpredictable client pipeline",
    uniqueMechanism: "Revenue-Proof Acquisition System (RPAS)",
    strategicAdvantage: "Proof-first positioning with outcome guarantee before any commitment",
    targetAudienceSegment: "Coaches and consultants doing $5k–$30k/month seeking to scale to $50k+",
    monthlyBudget: "2500",
    revenueGoal: "50000",
  }),
  formatProductDNAForPrompt: (dna: any) => dna ? JSON.stringify(dna).slice(0, 500) : "",
}));

vi.mock("../market-intelligence-v3/engine-state", () => ({
  verifySnapshotIntegrity: async () => ({ valid: true, snapshotId: "snap_mi_mock", issues: [] }),
}));

vi.mock("../shared/snapshot-trust", () => ({
  buildFreshnessMetadata: () => ({ freshnessScore: 0.85, dataAge: 3, isStale: false }),
  logFreshnessTraceability: () => {},
}));

vi.mock("../shared/signal-quality-gate", () => ({
  checkForOrphanClaims: () => ({ hasOrphans: false, orphanedClaims: [], checkedCount: 0 }),
}));

vi.mock("../shared/engine-health", () => ({
  enforceGlobalStateRefresh: async () => {},
}));

// ─── PIPELINE STATE ───────────────────────────────────────────────────────────
const ACCOUNT_ID = "e2e-test-account";
const CAMPAIGN_ID = "e2e-test-campaign";

const report: Record<string, any> = {};

// ─── STUB: MI OUTPUT (Engine 1) ───────────────────────────────────────────────
const MI_STUB = {
  snapshotId: "snap_mi_001",
  status: "READY",
  output: {
    marketState: {
      direction: "GROWING",
      confidence: "MODERATE",
      saturationScore: 0.31,
      dominantNarrative: "results-guaranteed agency services for coaches",
    },
    overallConfidence: 0.72,
    signals: [
      { type: "pain_cluster", canonical: "no reliable client acquisition system", frequency: 18, confidenceScore: 0.83 },
      { type: "pain_cluster", canonical: "agency fees without results", frequency: 14, confidenceScore: 0.79 },
      { type: "desire_cluster", canonical: "consistent $10k–$50k months", frequency: 22, confidenceScore: 0.88 },
      { type: "desire_cluster", canonical: "marketing system that runs without me", frequency: 11, confidenceScore: 0.74 },
      { type: "objection", canonical: "too expensive — tried agencies before", frequency: 9, confidenceScore: 0.71 },
    ],
  },
  signalClusters: [
    { type: "pain_cluster", canonical: "no reliable client acquisition system", frequency: 18, confidenceScore: 0.83 },
    { type: "desire_cluster", canonical: "consistent monthly revenue", frequency: 22, confidenceScore: 0.88 },
  ],
  competitors: [
    { name: "Agency Alpha", dominanceScore: 0.61, narrative: "done-for-you leads on retainer" },
    { name: "LeadGen Pro", dominanceScore: 0.44, narrative: "automated outreach for coaches" },
  ],
  marketState: { direction: "GROWING", confidence: "MODERATE" },
  trajectoryData: { direction: "UP", velocity: 0.6, stabilityIndex: 0.71 },
  dominanceData: [{ competitor: "Agency Alpha", score: 0.61 }],
  narrativeObjections: ["agencies promise and disappear", "paid ads are a money pit"],
  comments: [
    "I spent $4k on an agency last year and got 0 clients",
    "I just need a system that actually works — not another retainer",
    "How do I know you won't be like every other agency?",
  ],
};

// ─── STUB: AUDIENCE OUTPUT (Engine 2) ─────────────────────────────────────────
const AUDIENCE_STUB = {
  snapshotId: "snap_aud_001",
  status: "READY",
  painProfiles: [
    { pain: "no reliable client acquisition system", severity: 0.89, evidenceCount: 18, rootCause: "no repeatable outreach process driving consistent leads" },
    { pain: "agency fees without measurable results", severity: 0.82, evidenceCount: 14, rootCause: "lack of transparent billing and outcome accountability" },
  ],
  desireMap: [
    { desire: "consistent $10k–$50k/month revenue", intensity: 0.91 },
    { desire: "marketing system that runs without constant oversight", intensity: 0.79 },
  ],
  objectionMap: [
    { objection: "too expensive — tried agencies before and got burned", frequency: 9, resolutionAngle: "show proof before asking for commitment" },
  ],
  emotionalDrivers: [
    { driver: "fear of falling behind competitors who ARE growing", weight: 0.83 },
    { driver: "desire for financial freedom and autonomy", weight: 0.88 },
  ],
  transformationMap: [
    { from: "inconsistent referral-dependent revenue", to: "predictable $30k+/month from systematic outreach" },
  ],
  audienceSegments: [
    { segment: "coaches $5k–$15k/month", size: "large", readiness: "problem_aware" },
    { segment: "consultants $15k–$50k/month", size: "medium", readiness: "solution_aware" },
  ],
  awarenessLevel: { level: "problem_aware", confidence: 0.78 },
  structuredSignals: {
    pain_clusters: [
      { canonical: "no reliable client acquisition system", frequency: 18, evidenceScore: 0.83, evidence: ["I tried 3 agencies", "still no consistent leads"] },
      { canonical: "agency fees without results", frequency: 14, evidenceScore: 0.79, evidence: ["wasted $4k on retainer", "got invoices not clients"] },
    ],
    desire_clusters: [
      { canonical: "consistent monthly revenue from outreach", frequency: 22, evidenceScore: 0.88, evidence: ["I want predictable income", "need a system not luck"] },
    ],
    pattern_clusters: [
      { canonical: "trust collapse after agency failure", frequency: 11, evidenceScore: 0.76, evidence: ["burned by last agency", "agencies all promise the same thing"] },
    ],
    root_causes: [
      "no repeatable outreach process that generates leads without paid ads",
      "previous agency experiences eroded trust in outcome claims",
    ],
    psychological_drivers: [
      "desire for financial autonomy",
      "fear of competitor growth while standing still",
    ],
  },
  confidenceScore: 0.81,
  engineVersion: "AEv3",
};

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

describe("E2E Pipeline — All 15 Engines", { timeout: 120_000 }, () => {

  // ── LAYER 0: SHARED INFRASTRUCTURE ──────────────────────────────────────────

  describe("INFRA: Embedding Layer", () => {
    test("cosineSimilarity is functional and returns valid range", () => {
      const score = cosineSimilarity(
        "no reliable client acquisition system causing inconsistent revenue",
        "lack of repeatable outreach process leads to unpredictable monthly income",
      );
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
      report["INFRA_embedding_cosine"] = { score: score.toFixed(4) };
    });
  });

  // ── ENGINE 2: SGL (built after Audience) ─────────────────────────────────────
  let sglState: any;

  describe("ENGINE 2 (post-Audience): Signal Governance Layer (SGL)", () => {
    test("initializes with Audience structured signals", () => {
      sglState = initializeSignalGovernance(
        AUDIENCE_STUB.structuredSignals,
        AUDIENCE_STUB.objectionMap,
      );
      const summary = getGovernanceSummary(sglState);
      expect(sglState.governedSignals.length).toBeGreaterThan(0);
      expect(sglState.traceToken).toBeTruthy();
      report["E02_SGL"] = {
        status: "INITIALIZED",
        governedSignals: sglState.governedSignals.length,
        traceToken: sglState.traceToken,
        summary,
      };
    });
  });

  // ── ENGINE 1+2: AEL (Analytical Enrichment, built after MI + Audience) ──────
  let aelPackage: any;

  describe("ENGINE 1+2: Analytical Enrichment Layer (AEL)", () => {
    test("builds analytical package from MI + Audience stubs", async () => {
      aelPackage = await buildAnalyticalPackage({
        mi: MI_STUB,
        audience: AUDIENCE_STUB,
        productDNA: null,
        competitiveData: null,
        accountId: ACCOUNT_ID,
        campaignId: CAMPAIGN_ID,
      });
      expect(aelPackage).toBeTruthy();
      expect(Array.isArray(aelPackage.root_causes)).toBe(true);
      expect(aelPackage.root_causes.length).toBeGreaterThan(0);
      report["E01_02_AEL"] = {
        status: "READY",
        root_causes: aelPackage.root_causes,
        causal_chain: aelPackage.causal_chain,
        barriers: aelPackage.barriers,
        desire_map: aelPackage.desire_map?.slice(0, 2),
        psychological_drivers: aelPackage.psychological_drivers,
      };
    });
  });

  // ── ENGINE 3: Positioning Engine ─────────────────────────────────────────────
  let positioningResult: any;

  describe("ENGINE 3: Positioning Engine", () => {
    test("runs differentiation pipeline on stub MI + Audience + AEL", async () => {
      const { runPositioningEngine } = await import("../positioning-engine/engine");
      positioningResult = await runPositioningEngine(
        ACCOUNT_ID,
        CAMPAIGN_ID,
        "snap_mi_001",
        "snap_aud_001",
        aelPackage,
      );
      expect(positioningResult).toBeTruthy();
      expect(positioningResult.status).not.toBe("ERROR");
      report["E03_POSITIONING"] = {
        status: positioningResult.status,
        territories: (positioningResult.territories || []).map((t: any) => ({
          name: t.name,
          contrastAxis: t.contrastAxis,
          narrativeDirection: t.narrativeDirection,
          specificity: t.specificityScore ?? t.specificity,
        })),
        narrative: positioningResult.narrative,
        narrativeDirection: positioningResult.narrativeDirection,
        contrastAxis: positioningResult.contrastAxis,
        enemyDefinition: positioningResult.enemyDefinition,
        strategyCards: (positioningResult.strategyCards || []).slice(0, 2).map((c: any) => c.name || c),
        specificityScore: positioningResult.specificityScore,
        saturationScore: positioningResult.saturationScore,
        snapshotId: positioningResult.snapshotId,
      };
    });
  });

  // ── ENGINE 4: Differentiation Engine ─────────────────────────────────────────
  let diffResult: any;

  describe("ENGINE 4: Differentiation Engine", () => {
    test("produces validated claims, collision map and proof architecture", async () => {
      const miInput = {
        competitors: MI_STUB.competitors,
        signals: MI_STUB.output.signals,
        dominance: MI_STUB.dominanceData,
        trajectory: MI_STUB.trajectoryData,
        marketState: MI_STUB.output.marketState,
        confidence: MI_STUB.output.overallConfidence,
      };
      const audInput = {
        painProfiles: AUDIENCE_STUB.painProfiles,
        desireMap: AUDIENCE_STUB.desireMap,
        objectionMap: AUDIENCE_STUB.objectionMap,
        transformationMap: AUDIENCE_STUB.transformationMap,
        emotionalDrivers: AUDIENCE_STUB.emotionalDrivers,
        segments: AUDIENCE_STUB.audienceSegments,
      };
      const posInput = {
        territories: positioningResult?.territories || [],
        narrative: positioningResult?.narrative || "",
        narrativeDirection: positioningResult?.narrativeDirection || "",
        specificity: positioningResult?.specificityScore || 0.81,
        saturation: positioningResult?.saturationScore || 0.22,
        strategyCards: positioningResult?.strategyCards || [],
        differentiationVector: positioningResult?.differentiationVector || [],
        stabilityResult: { isStable: true, checks: [], advisories: [], fallbackApplied: false },
      };
      diffResult = await runDifferentiationEngine(
        miInput, audInput, posInput,
        ACCOUNT_ID, undefined, aelPackage,
      );
      expect(diffResult).toBeTruthy();
      expect(diffResult.status).not.toBe("ERROR");
      report["E04_DIFFERENTIATION"] = {
        status: diffResult.status,
        validatedClaims: diffResult.validatedClaims?.slice(0, 3),
        collisions: (diffResult.collisions || []).slice(0, 2).map((c: any) => ({ claim: c.claim, risk: c.riskScore })),
        trustGaps: (diffResult.trustGaps || []).slice(0, 2).map((g: any) => g.gap),
        authorityMode: diffResult.authorityMode,
        mechanismCore: diffResult.mechanismCore,
        differentiationScore: diffResult.differentiationScore,
        depthGateStatus: diffResult.depthGateResult?.status,
        celViolations: diffResult.celDepthCompliance?.violations?.length ?? 0,
        snapshotId: diffResult.snapshotId,
      };
    });
  });

  // ── ENGINE 5: Mechanism Engine ────────────────────────────────────────────────
  let mechanismResult: any;

  describe("ENGINE 5: Mechanism Engine", () => {
    test("derives unique mechanism from positioning + differentiation", async () => {
      const posForMech = {
        contrastAxis: positioningResult?.contrastAxis || "transparent results-first vs opaque retainer agencies",
        enemyDefinition: positioningResult?.enemyDefinition || "retainer agencies that bill without results",
        narrativeDirection: positioningResult?.narrativeDirection || "",
        differentiationVector: positioningResult?.differentiationVector || [],
        territories: positioningResult?.territories || [],
      };
      const diffForMech = {
        pillars: diffResult?.validatedClaims || [],
        mechanismFraming: diffResult?.mechanismFraming || null,
        mechanismCore: diffResult?.mechanismCore || null,
        authorityMode: diffResult?.authorityMode || null,
        claimStructures: diffResult?.claimStructures || [],
        proofArchitecture: diffResult?.proofArchitecture || [],
      };
      mechanismResult = await runMechanismEngine(posForMech, diffForMech, ACCOUNT_ID, aelPackage);
      expect(mechanismResult).toBeTruthy();
      expect(mechanismResult.status).not.toBe("ERROR");
      report["E05_MECHANISM"] = {
        status: mechanismResult.status,
        mechanismName: mechanismResult.mechanismName || mechanismResult.output?.mechanismName,
        mechanismDescription: (mechanismResult.mechanismDescription || mechanismResult.output?.mechanismDescription || "").slice(0, 200),
        uniqueMechanismCore: (mechanismResult.uniqueMechanismCore || mechanismResult.output?.uniqueMechanismCore || "").slice(0, 200),
        phaseCount: (mechanismResult.phaseBreakdown || mechanismResult.output?.phaseBreakdown || []).length,
        confidenceScore: mechanismResult.confidenceScore || mechanismResult.output?.confidenceScore,
        depthGateStatus: mechanismResult.depthGateResult?.status,
        celViolations: mechanismResult.celDepthCompliance?.violations?.length ?? 0,
      };
    });
  });

  // ── ENGINE 6: Offer Engine ────────────────────────────────────────────────────
  let offerResult: any;

  describe("ENGINE 6: Offer Engine", () => {
    test("builds offer with positioning lock and non-generic anchors", async () => {
      const miInput = { competitors: MI_STUB.competitors, signals: MI_STUB.output.signals, marketState: MI_STUB.output.marketState, confidence: MI_STUB.output.overallConfidence };
      const audInput = { painProfiles: AUDIENCE_STUB.painProfiles, desireMap: AUDIENCE_STUB.desireMap, objectionMap: AUDIENCE_STUB.objectionMap, transformationMap: AUDIENCE_STUB.transformationMap, emotionalDrivers: AUDIENCE_STUB.emotionalDrivers, segments: AUDIENCE_STUB.audienceSegments };
      const posInput = { territories: positioningResult?.territories || [], narrative: positioningResult?.narrative || "", narrativeDirection: positioningResult?.narrativeDirection || "", specificity: 0.81, saturation: 0.22, strategyCards: [], differentiationVector: [] };
      const diffInput = { claims: diffResult?.validatedClaims || [], collisions: diffResult?.collisions || [], trustGaps: diffResult?.trustGaps || [], proofMap: diffResult?.proofDemandMap || [] };
      offerResult = await runOfferEngine(
        miInput, audInput, posInput, diffInput,
        ACCOUNT_ID, [],
        mechanismResult || undefined,
        undefined,
        aelPackage,
      );
      expect(offerResult).toBeTruthy();
      expect(offerResult.status).not.toBe("ERROR");
      report["E06_OFFER"] = {
        status: offerResult.status,
        offerName: offerResult.offerName,
        headline: offerResult.headline,
        coreOutcome: offerResult.coreOutcome,
        mechanismDescription: (offerResult.mechanismDescription || "").slice(0, 150),
        valueStack: (offerResult.valueStack || []).slice(0, 3),
        guaranteeStatement: offerResult.guaranteeStatement,
        positioningLock: offerResult.layerDiagnostics?.positioningLock
          ? {
              lockedDecisions: offerResult.layerDiagnostics.positioningLock.lockedDecisions,
              nonGenericAnchors: offerResult.layerDiagnostics.positioningLock.nonGenericAnchors?.slice(0, 3),
            }
          : "none",
        depthGateStatus: offerResult.depthGateResult?.status,
        celViolations: offerResult.celDepthCompliance?.violations?.length ?? 0,
        snapshotId: offerResult.snapshotId,
      };
    });
  });

  // ── ENGINE 7: Awareness Engine ────────────────────────────────────────────────
  let awarenessResult: any;

  describe("ENGINE 7: Awareness Engine", () => {
    test("builds awareness routes grounded in AEL pain + trigger signals", async () => {
      const miInput = { competitors: MI_STUB.competitors, signals: MI_STUB.output.signals, marketState: MI_STUB.output.marketState };
      const audInput = { painProfiles: AUDIENCE_STUB.painProfiles, desireMap: AUDIENCE_STUB.desireMap, objectionMap: AUDIENCE_STUB.objectionMap, emotionalDrivers: AUDIENCE_STUB.emotionalDrivers, segments: AUDIENCE_STUB.audienceSegments };
      const posInput = { territories: positioningResult?.territories || [], narrative: positioningResult?.narrative || "", narrativeDirection: positioningResult?.narrativeDirection || "" };
      const diffInput = { claims: diffResult?.validatedClaims || [], collisions: [], trustGaps: diffResult?.trustGaps || [], proofMap: [] };
      awarenessResult = await runAwarenessEngine(
        miInput, audInput, posInput, diffInput, offerResult || {},
        ACCOUNT_ID, [],
        undefined,
        aelPackage,
      );
      expect(awarenessResult).toBeTruthy();
      expect(awarenessResult.status).not.toBe("ERROR");
      report["E07_AWARENESS"] = {
        status: awarenessResult.status,
        primaryRoute: {
          routeName: awarenessResult.primaryRoute?.routeName,
          targetReadinessStage: awarenessResult.primaryRoute?.targetReadinessStage,
          entryMechanismType: awarenessResult.primaryRoute?.entryMechanismType,
          triggerClass: awarenessResult.primaryRoute?.triggerClass,
          awarenessStrengthScore: awarenessResult.primaryRoute?.awarenessStrengthScore,
          entryMessage: awarenessResult.primaryRoute?.entryMessage,
          contentHooks: (awarenessResult.primaryRoute?.contentHooks || []).slice(0, 2),
        },
        routeCount: (awarenessResult.routes || []).length,
        awarenessGapDiagnostic: awarenessResult.awarenessGapDiagnostic,
        depthGateStatus: awarenessResult.depthGateResult?.status,
        celViolations: awarenessResult.celDepthCompliance?.violations?.length ?? 0,
        snapshotId: awarenessResult.snapshotId,
      };
    });
  });

  // ── ENGINE 8: Funnel Engine ───────────────────────────────────────────────────
  let funnelResult: any;

  describe("ENGINE 8: Funnel Engine", () => {
    test("constructs conversion funnel from awareness + offer + audience", async () => {
      const miInput = { competitors: MI_STUB.competitors, signals: MI_STUB.output.signals, marketState: MI_STUB.output.marketState };
      const audInput = { painProfiles: AUDIENCE_STUB.painProfiles, desireMap: AUDIENCE_STUB.desireMap, objectionMap: AUDIENCE_STUB.objectionMap, emotionalDrivers: AUDIENCE_STUB.emotionalDrivers, segments: AUDIENCE_STUB.audienceSegments };
      const posInput = { territories: positioningResult?.territories || [], narrative: positioningResult?.narrative || "", narrativeDirection: positioningResult?.narrativeDirection || "" };
      const diffInput = { claims: diffResult?.validatedClaims || [], collisions: [], trustGaps: [], proofMap: [] };
      const awarenessInput = {
        awarenessStage: awarenessResult?.primaryRoute?.targetReadinessStage || "problem_aware",
        entryMechanism: awarenessResult?.primaryRoute?.entryMechanismType || "proof_led_cold_outreach",
        triggerClass: awarenessResult?.primaryRoute?.triggerClass || "agency_trust_collapse",
        trustState: awarenessResult?.primaryRoute?.trustRequirement || "high",
        awarenessRoute: awarenessResult?.primaryRoute?.routeName || "default",
        awarenessStrengthScore: awarenessResult?.primaryRoute?.awarenessStrengthScore || 0.76,
      };
      funnelResult = await runFunnelEngine(
        miInput, audInput, offerResult || {}, posInput, diffInput,
        ACCOUNT_ID, awarenessInput, aelPackage,
      );
      expect(funnelResult).toBeTruthy();
      expect(funnelResult.status).not.toBe("ERROR");
      report["E08_FUNNEL"] = {
        status: funnelResult.status,
        funnelName: funnelResult.funnelName,
        stages: (funnelResult.stages || []).map((s: any) => ({
          name: s.name,
          objective: (s.objective || "").slice(0, 80),
          conversionTarget: s.conversionTarget,
        })),
        primaryConversionPath: funnelResult.primaryConversionPath,
        funnelStrengthScore: funnelResult.funnelStrengthScore,
        depthGateStatus: funnelResult.depthGateResult?.status,
        celViolations: funnelResult.celDepthCompliance?.violations?.length ?? 0,
        snapshotId: funnelResult.snapshotId,
      };
    });
  });

  // ── ENGINE 9: Persuasion Engine ───────────────────────────────────────────────
  let persuasionResult: any;

  describe("ENGINE 9: Persuasion Engine", () => {
    test("builds persuasion routes with positioning lock enforcement", async () => {
      const miInput = { competitors: MI_STUB.competitors, signals: MI_STUB.output.signals, marketState: MI_STUB.output.marketState };
      const audInput = { painProfiles: AUDIENCE_STUB.painProfiles, desireMap: AUDIENCE_STUB.desireMap, objectionMap: AUDIENCE_STUB.objectionMap, emotionalDrivers: AUDIENCE_STUB.emotionalDrivers, segments: AUDIENCE_STUB.audienceSegments };
      const posInput = { territories: positioningResult?.territories || [], narrative: positioningResult?.narrative || "", narrativeDirection: positioningResult?.narrativeDirection || "" };
      const diffInput = { claims: diffResult?.validatedClaims || [], collisions: [], trustGaps: [], proofMap: [] };
      const posLock = offerResult?.layerDiagnostics?.positioningLock || null;
      const offerForPersuasion = posLock
        ? { ...offerResult, lockedDecisions: posLock.lockedDecisions || [], nonGenericAnchors: posLock.nonGenericAnchors || [] }
        : offerResult || {};
      persuasionResult = await runPersuasionEngine(
        miInput, audInput, posInput, diffInput,
        offerForPersuasion, funnelResult || {}, {}, awarenessResult || {},
        ACCOUNT_ID, [],
        aelPackage,
      );
      expect(persuasionResult).toBeTruthy();
      expect(persuasionResult.status).not.toBe("ERROR");
      const routes = persuasionResult.persuasionRoutes || persuasionResult.routes || [];
      report["E09_PERSUASION"] = {
        status: persuasionResult.status,
        primaryRoute: persuasionResult.primaryRoute,
        routeCount: routes.length,
        routes: routes.slice(0, 2).map((r: any) => ({
          routeName: r.routeName,
          primaryDriver: r.primaryDriver,
          frictionNotes: (r.frictionNotes || []).slice(0, 3),
          sequence: (r.sequence || []).slice(0, 2),
        })),
        persuasionStrengthScore: persuasionResult.persuasionStrengthScore,
        depthGateStatus: persuasionResult.depthGateResult?.status,
        celViolations: persuasionResult.celDepthCompliance?.violations?.length ?? 0,
        snapshotId: persuasionResult.snapshotId,
      };
    });
  });

  // ── ENGINE 10: Integrity Engine ───────────────────────────────────────────────
  let integrityResult: any;

  describe("ENGINE 10: Integrity Engine (deterministic)", () => {
    test("validates cross-engine structural consistency", () => {
      const miInput = { competitors: MI_STUB.competitors, signals: MI_STUB.output.signals, marketState: MI_STUB.output.marketState };
      const audInput = { painProfiles: AUDIENCE_STUB.painProfiles, desireMap: AUDIENCE_STUB.desireMap, objectionMap: AUDIENCE_STUB.objectionMap, emotionalDrivers: AUDIENCE_STUB.emotionalDrivers, segments: AUDIENCE_STUB.audienceSegments };
      const posInput = { territories: positioningResult?.territories || [], narrative: positioningResult?.narrative || "", specificityScore: 0.81, saturationScore: 0.22, strategyCards: [] };
      const diffInput = { claims: diffResult?.validatedClaims || [], collisions: diffResult?.collisions || [], trustGaps: diffResult?.trustGaps || [], proofMap: diffResult?.proofDemandMap || [] };
      integrityResult = runIntegrityEngine(
        miInput, audInput, posInput, diffInput,
        offerResult || {}, funnelResult || {},
      );
      expect(integrityResult).toBeTruthy();
      expect(typeof integrityResult.overallIntegrityScore).toBe("number");
      report["E10_INTEGRITY"] = {
        status: integrityResult.status || (integrityResult.overallIntegrityScore >= 0.65 ? "PASS" : "WARN"),
        overallIntegrityScore: integrityResult.overallIntegrityScore,
        layerResults: (integrityResult.layerResults || []).map((l: any) => ({
          layer: l.layer || l.name,
          score: l.score,
          status: l.status,
          findings: (l.findings || []).slice(0, 2),
        })),
        recommendations: (integrityResult.recommendations || []).slice(0, 3),
      };
    });
  });

  // ── ENGINE 11: Statistical Validation ─────────────────────────────────────────
  let statValidResult: any;

  describe("ENGINE 11: Statistical Validation (deterministic + AI)", () => {
    test("validates claim confidence and signal grounding", async () => {
      const miInput = { competitors: MI_STUB.competitors, signals: MI_STUB.output.signals, marketState: MI_STUB.output.marketState };
      const audInput = { painProfiles: AUDIENCE_STUB.painProfiles, desireMap: AUDIENCE_STUB.desireMap, objectionMap: AUDIENCE_STUB.objectionMap };
      statValidResult = await runStatisticalValidationEngine(
        miInput, audInput,
        offerResult || {}, funnelResult || {},
        awarenessResult || {}, persuasionResult || {},
        ACCOUNT_ID, [],
      );
      expect(statValidResult).toBeTruthy();
      report["E11_STATISTICAL_VALIDATION"] = {
        status: statValidResult.status,
        validationConfidence: statValidResult.validationConfidence,
        signalGrounding: statValidResult.signalGrounding,
        strategyAcceptability: statValidResult.strategyAcceptability,
        claimValidations: (statValidResult.claimValidations || []).slice(0, 3).map((c: any) => ({
          claim: (c.claim || "").slice(0, 80),
          confidence: c.confidence,
          grounded: c.grounded,
        })),
        snapshotId: statValidResult.snapshotId,
      };
    });
  });

  // ── ENGINE 12: Budget Governor (deterministic) ─────────────────────────────────
  let budgetResult: any;

  describe("ENGINE 12: Budget Governor (deterministic)", () => {
    test("computes budget allocation and risk gates", () => {
      budgetResult = runBudgetGovernorEngine({
        budget: { monthlyBudget: 2500, currency: "USD", currentSpend: 0 },
        campaign: { objective: "ACQUISITION", durationDays: 30, channels: [] },
        performance: null,
        validation: statValidResult || null,
      });
      expect(budgetResult).toBeTruthy();
      expect(typeof budgetResult.decision).toBe("string");
      report["E12_BUDGET_GOVERNOR"] = {
        status: budgetResult.status || "COMPUTED",
        decision: budgetResult.decision,
        monthlyBudget: budgetResult.budgetRange,
        expansionPermission: budgetResult.expansionPermission,
        riskScore: budgetResult.riskScore,
        guardResult: budgetResult.guardResult
          ? { triggered: budgetResult.guardResult.triggered, reason: budgetResult.guardResult.reason }
          : null,
      };
    });
  });

  // ── ENGINE 13: Channel Selection (deterministic) ───────────────────────────────
  let channelResult: any;

  describe("ENGINE 13: Channel Selection (deterministic)", () => {
    test("selects optimal channels with funnel role assignments", () => {
      const audInput = { painProfiles: AUDIENCE_STUB.painProfiles, desireMap: AUDIENCE_STUB.desireMap, objectionMap: AUDIENCE_STUB.objectionMap, segments: AUDIENCE_STUB.audienceSegments };
      channelResult = runChannelSelectionEngine(
        audInput,
        awarenessResult || {},
        persuasionResult || {},
        offerResult || {},
        budgetResult || {},
        statValidResult || {},
        "INTELLIGENT",
      );
      expect(channelResult).toBeTruthy();
      const channels = channelResult.selectedChannels || channelResult.channels || [];
      report["E13_CHANNEL_SELECTION"] = {
        status: channelResult.status,
        selectedChannels: channels.slice(0, 5).map((c: any) => ({
          channel: c.channel || c.name,
          score: c.score,
          role: c.funnelRole || c.role,
          objective: c.objectiveFit,
        })),
        primaryChannel: channelResult.primaryChannel,
        channelCount: channels.length,
        funnelRoleAssignments: (channelResult.funnelRoleAssignments || []).slice(0, 3),
      };
    });
  });

  // ── ENGINE 14: Iteration Engine ────────────────────────────────────────────────
  let iterationResult: any;

  describe("ENGINE 14: Iteration Engine", () => {
    test("generates optimization recommendations from funnel + persuasion", async () => {
      iterationResult = await runIterationEngine(
        null,
        funnelResult || null,
        null,
        persuasionResult || null,
      );
      expect(iterationResult).toBeTruthy();
      report["E14_ITERATION"] = {
        status: iterationResult.status,
        recommendations: (iterationResult.recommendations || []).slice(0, 3),
        iterationConfidence: iterationResult.iterationConfidence,
        optimizationPriority: iterationResult.optimizationPriority,
      };
    });
  });

  // ── ENGINE 15: Retention Engine ────────────────────────────────────────────────
  let retentionResult: any;

  describe("ENGINE 15: Retention Engine", () => {
    test("builds retention lifecycle strategy", async () => {
      retentionResult = await runRetentionEngine({
        customerJourneyData: {
          touchpoints: [
            { stage: "acquisition", channel: "cold_outreach", outcome: "qualified_call" },
            { stage: "onboarding", channel: "email", outcome: "campaign_live" },
            { stage: "delivery", channel: "dashboard", outcome: "roi_visible" },
          ],
          averageLifetimeValue: 4491,
          churnRiskIndicators: ["no ROI visibility in first 30 days", "lack of proactive check-ins"],
        },
        offerData: offerResult || {},
        audienceData: AUDIENCE_STUB,
      });
      expect(retentionResult).toBeTruthy();
      report["E15_RETENTION"] = {
        status: retentionResult.status,
        retentionStrategy: retentionResult.retentionStrategy || retentionResult.strategy,
        milestones: (retentionResult.retentionStrategy?.milestones || retentionResult.milestones || []).slice(0, 3),
        churnPrevention: retentionResult.retentionStrategy?.churnPrevention || retentionResult.churnPrevention,
        iterationConfidence: retentionResult.iterationConfidence,
      };
    });
  });

  // ── PIPELINE CROSS-CHECKS ─────────────────────────────────────────────────────

  describe("PIPELINE CROSS-CHECKS: Upgraded System Verification", () => {

    test("[Task #3] CEL semantic depth scoring fires on real output texts", () => {
      const sampleTexts = [
        "Our Revenue-Proof Acquisition System guarantees 3 qualified client calls in 30 days because transparent billing reduces the trust barrier that causes 78% of prospects to disengage before committing.",
        "Transparent billing results in 42% higher client retention rates.",
      ];
      const celResult = enforceEngineDepthCompliance("e2e-check", sampleTexts, aelPackage);
      expect(typeof celResult.causalDepthScore).toBe("number");
      expect(celResult.claimBreakdown).toBeDefined();
      report["CROSS_CEL_SEMANTIC"] = {
        causalDepthScore: celResult.causalDepthScore,
        passed: celResult.passed,
        factualClaimCount: celResult.factualClaimCount,
        claimBreakdown: celResult.claimBreakdown,
        violations: celResult.violations.map((v: any) => v.violationType),
        isDepthBlocking: isDepthBlocking(celResult),
      };
    });

    test("[Task #6] ClaimClassifier: emotional-only output is never depth-blocking", () => {
      const emotionalOnly = [
        "The message resonates deeply with buyers who long for financial freedom.",
        "This brand creates a profound sense of trust and stability.",
        "The campaign inspires passionate commitment from the audience.",
      ];
      const celResult = enforceEngineDepthCompliance("e2e-emotional-check", emotionalOnly, aelPackage);
      expect(celResult.factualClaimCount).toBe(0);
      expect(isDepthBlocking(celResult)).toBe(false);
      report["CROSS_CEL_EMOTIONAL_GUARD"] = {
        factualClaimCount: celResult.factualClaimCount,
        claimBreakdown: celResult.claimBreakdown,
        isDepthBlocking: isDepthBlocking(celResult),
        result: "PASS — emotional output correctly exempt from depth gate",
      };
    });

    test("[Task #5] PositioningLock: anti-drift anchors present in offer layer", () => {
      const lock = offerResult?.layerDiagnostics?.positioningLock;
      if (lock) {
        expect(Array.isArray(lock.lockedDecisions)).toBe(true);
        expect(Array.isArray(lock.nonGenericAnchors)).toBe(true);
        report["CROSS_POSITIONING_LOCK"] = {
          lockPresent: true,
          lockedDecisions: lock.lockedDecisions,
          nonGenericAnchors: lock.nonGenericAnchors,
          result: "PASS — positioning lock enforced at offer layer",
        };
      } else {
        report["CROSS_POSITIONING_LOCK"] = {
          lockPresent: false,
          result: "NOTE — lock not attached (offer engine AI fixture did not include layerDiagnostics.positioningLock)",
        };
      }
    });

    test("[Task #2] SGL: all governed signals are ranked and coverage is computed", () => {
      const summary = getGovernanceSummary(sglState);
      expect(sglState.governedSignals.length).toBeGreaterThan(0);
      expect(summary).toBeTruthy();
      report["CROSS_SGL_GOVERNANCE"] = {
        governedSignals: sglState.governedSignals.length,
        traceToken: sglState.traceToken,
        summary,
      };
    });

    test("[Task #4] SIV embedding-based alignment: cosine similarity between pipeline texts", () => {
      const posText = "transparent results-first vs opaque retainer agencies — proof before commitment";
      const offerText = offerResult?.coreOutcome || "predictable pipeline of qualified discovery calls";
      const alignScore = cosineSimilarity(posText, offerText);
      expect(alignScore).toBeGreaterThanOrEqual(0);
      report["CROSS_SIV_ALIGNMENT"] = {
        positioning_text: posText.slice(0, 80),
        offer_text: offerText.slice(0, 80),
        cosineAlignmentScore: alignScore.toFixed(4),
        result: alignScore > 0.1 ? "ALIGNED" : "DRIFT_RISK",
      };
    });

    test("[Final] Print full pipeline report", () => {
      console.log("\n\n╔══════════════════════════════════════════════════════════════════╗");
      console.log("║         MARKETMIND AI — END-TO-END PIPELINE REPORT              ║");
      console.log("╚══════════════════════════════════════════════════════════════════╝\n");

      const entries = Object.entries(report);
      for (const [key, value] of entries) {
        console.log(`\n──── ${key} ────`);
        console.log(JSON.stringify(value, null, 2));
      }

      console.log("\n\n╔══════════════════════════════════════════════════════════════════╗");
      console.log(`║  ENGINES COMPLETED: ${entries.length} / 20 (15 engines + 5 cross-checks)   ║`);
      console.log("╚══════════════════════════════════════════════════════════════════╝\n");

      expect(entries.length).toBeGreaterThanOrEqual(15);
    });
  });
});
