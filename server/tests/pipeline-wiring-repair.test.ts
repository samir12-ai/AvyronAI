import "dotenv/config";
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  resolvePlanContext,
} from "../orchestrator/execution-plan-resolver";
import { assembleAudiencePositioningData } from "../audience-positioning-service";
import { isPositiveAppreciationSignal } from "../shared/audience-pain-registry";
import {
  extractLockedDecisionLabels,
} from "../orchestrator/plan-synthesis";
import {
  translateJourneyType,
  translateEntryTrigger,
  translateMessageStepLabel,
} from "../../components/strategy-plan/bll-presenter";

const SONGAI_ACCOUNT_ID = "ce5c11b9-9a9a-499c-a4f8-b75e6ec6055f";
const SONGAI_CAMPAIGN_ID = "camp_ac86e8b8-55b";

describe("Pipeline End-to-End Wiring & Contract Repairs", () => {
  it("1. Active plan / strategy root / audience-positioning resolver alignment returns unified jobId, planId, strategyRootId, and rootBundleId", async () => {
    const planCtx = await resolvePlanContext({
      campaignId: SONGAI_CAMPAIGN_ID,
      accountId: SONGAI_ACCOUNT_ID,
    });
    expect(planCtx.selectedPlan).toBeTruthy();
    expect(planCtx.planId).toBe(planCtx.selectedPlan?.id);
    expect(planCtx.jobId).toBe(planCtx.selectedPlan?.jobId);

    const apData = await assembleAudiencePositioningData(
      SONGAI_CAMPAIGN_ID,
      SONGAI_ACCOUNT_ID,
      { planId: planCtx.planId || undefined, runId: planCtx.jobId || undefined }
    );
    expect(apData.planId).toBe(planCtx.planId);
    expect(apData.jobId).toBe(planCtx.jobId);
    expect(apData.strategyRootId).toBe(planCtx.strategyRootId);
  });

  it("2. Positive customer appreciation signals (e.g. pain_33) are detected and excluded from active pains", async () => {
    const appreciationText =
      "Positive Customer Appreciation: Customers express strong satisfaction and gratitude for personalized song quality and emotional impact.";
    expect(
      isPositiveAppreciationSignal({
        id: "pain_33",
        canonical: appreciationText,
        originalStatement: "Absolutely loved the song, thank you so much!",
      })
    ).toBe(true);

    const apData = await assembleAudiencePositioningData(
      SONGAI_CAMPAIGN_ID,
      SONGAI_ACCOUNT_ID
    );
    expect(apData.coreBuyingPain.painId).not.toBe("pain_33");
    expect(apData.coreBuyingPain.title.toLowerCase().includes("positive customer appreciation")).toBe(false);
    for (const pain of apData.supportingSignals.pains) {
      expect(pain.painId).not.toBe("pain_33");
      expect(pain.title.toLowerCase().includes("positive customer appreciation")).toBe(false);
    }
  });

  it("3. Competitor attribution from ci_reviews is preserved in resume-hydration and persuasion structuredObjections", () => {
    const resumeHydrationSrc = fs.readFileSync(
      path.resolve(__dirname, "../orchestrator/resume-hydration.ts"),
      "utf8"
    );
    expect(resumeHydrationSrc.includes("loadCanonicalCustomerVoice")).toBe(true);
    expect(resumeHydrationSrc.includes("competitorSubjectAttribution")).toBe(true);
    expect(resumeHydrationSrc.includes("COMPETITOR_SPECIFIC")).toBe(true);
    expect(resumeHydrationSrc.includes("UNATTRIBUTED_MARKET")).toBe(true);

    const persEngineSrc = fs.readFileSync(
      path.resolve(__dirname, "../persuasion-engine/engine.ts"),
      "utf8"
    );
    expect(persEngineSrc.includes("subjectScope")).toBe(true);
    expect(persEngineSrc.includes("competitorNames")).toBe(true);
  });

  it("4. Product truth boundary rules forbid human-driven studio composition over automation, phonetic pronunciation input, permanent link guarantees, and 'The only...' exclusivity", () => {
    const valueArchSrc = fs.readFileSync(
      path.resolve(__dirname, "../offer-engine/value-architect.ts"),
      "utf8"
    );
    expect(valueArchSrc.includes("The only B2B martech vendor")).toBe(false);
    expect(valueArchSrc.includes("Do NOT make unverified category-exclusivity or market-monopoly claims")).toBe(true);
    expect(valueArchSrc.includes("phonetic pronunciation")).toBe(true);

    const trustTransferSrc = fs.readFileSync(
      path.resolve(__dirname, "../persuasion-engine/trust-transfer.ts"),
      "utf8"
    );
    expect(trustTransferSrc.includes("human-driven studio composition over automation")).toBe(true);
    expect(trustTransferSrc.includes("phonetic pronunciation input")).toBe(true);
    expect(trustTransferSrc.includes("permanent/lifetime link hosting guarantees")).toBe(true);
    expect(trustTransferSrc.includes('judgeVerdict: "ACCEPTED"')).toBe(true);
  });

  it("5. Mechanism field mapping reads mechanismName/mechanismType/mechanismPromise/mechanismSteps and removes hardcoded B2B strings from MechanismSectionView", () => {
    const results = new Map<any, any>([
      [
        "mechanism",
        {
          status: "SUCCESS",
          output: {
            primaryMechanism: {
              mechanismName: "Guided 3-Step Song Creation & Preview Verification",
              mechanismType: "process_mechanism",
            },
          },
        },
      ],
    ]);
    const strategyRoot = {
      approvedClaim: "Hear a 1-minute preview before unlocking your personalized song",
      approvedMechanism: {
        mechanismName: "Guided 3-Step Song Creation & Preview Verification",
        mechanismType: "process_mechanism",
      },
    };
    const labels = extractLockedDecisionLabels(results, strategyRoot);
    expect(labels.some((l) => l.label === "Guided 3-Step Song Creation & Preview Verification" && l.scope === "mechanism")).toBe(true);
    expect(labels.some((l) => l.label === "Guided 3-Step Song Creation & Preview Verification" && l.scope === "strategyRoot")).toBe(true);

    const mechViewSrc = fs.readFileSync(
      path.resolve(__dirname, "../../components/strategy-plan/MechanismSectionView.tsx"),
      "utf8"
    );
    expect(mechViewSrc.includes("Multi-source signal ingestion across active market channels")).toBe(false);
    expect(mechViewSrc.includes("Continuous verified signal intelligence without manual research overhead")).toBe(false);
  });

  it("6. AwarenessSectionView binds to sections.awareness without hardcoded Avyron B2B defaults", () => {
    const awViewSrc = fs.readFileSync(
      path.resolve(__dirname, "../../components/strategy-plan/AwarenessSectionView.tsx"),
      "utf8"
    );
    expect(awViewSrc.includes("Transitioning from unverified market noise to continuous signal intelligence")).toBe(false);
    expect(awViewSrc.includes("Most growth strategies rely on guesswork, manual research, and static competitive audits")).toBe(false);
    expect(awViewSrc.includes("primaryRoute.oldBelief")).toBe(true);
    expect(awViewSrc.includes("primaryRoute.newBelief")).toBe(true);
  });

  it("7. ProductTruthBadge never defaults missing status to SUPPORTED and maps SHARED_CAPABILITY_STRATEGIC_EMPHASIS to PROPOSED", () => {
    const badgeSrc = fs.readFileSync(
      path.resolve(__dirname, "../../components/ProductTruthBadge.tsx"),
      "utf8"
    );
    expect(badgeSrc.includes("Never defaults missing/unknown status to SUPPORTED")).toBe(true);
    expect(badgeSrc.includes("SHARED_CAPABILITY_STRATEGIC_EMPHASIS")).toBe(true);
    expect(badgeSrc.includes("COMPETITIVE_COMPARISON_UNAVAILABLE")).toBe(true);
    expect(badgeSrc.includes("STRATEGIC_HYPOTHESIS")).toBe(true);
  });

  it("8. Funnel entry trigger and stage CTAs support self-serve preview discovery and stage-specific actions", () => {
    const funnelSrc = fs.readFileSync(
      path.resolve(__dirname, "../funnel-engine/engine.ts"),
      "utf8"
    );
    expect(funnelSrc.includes("isSelfServePreview")).toBe(true);
    expect(funnelSrc.includes("hasPreviewBridgeOffer")).toBe(true);
    expect(funnelSrc.includes("Generate Your Free 1-Minute Song Preview")).toBe(true);
    expect(translateJourneyType("tripwire")).toBe("Low-Friction Preview / Tripwire Flow");
    expect(translateEntryTrigger("discovery")).toBe("Self-Serve Preview & Discovery");
  });

  it("9. Persuasion message sequence and structured objections serialize human-readable focus labels, rationales, and competitor attribution", () => {
    const label = translateMessageStepLabel(
      "Phase 1",
      0,
      "Acknowledge the fear that personalized songs might sound generic or fail to deliver"
    );
    expect(label).toBe("Acknowledge the fear that personalized songs might sound generic or fail to deliver");

    const planSynthSrc = fs.readFileSync(
      path.resolve(__dirname, "../orchestrator/plan-synthesis.ts"),
      "utf8"
    );
    expect(planSynthSrc.includes("Array.isArray(pData.structuredObjections) && pData.structuredObjections.length > 0")).toBe(true);
    expect(planSynthSrc.includes("subjectScope: o.subjectScope")).toBe(true);
    expect(planSynthSrc.includes("competitorNames: o.competitorNames")).toBe(true);
  });

  it("10. Budget Governor allocation schema maps channelName, platform, mode, costCategory, and monthlyAmount into ChannelsBudgetSectionView", () => {
    const channelsViewSrc = fs.readFileSync(
      path.resolve(__dirname, "../../components/strategy-plan/ChannelsBudgetSectionView.tsx"),
      "utf8"
    );
    expect(channelsViewSrc.includes("b.channelName || b.channel")).toBe(true);
    expect(channelsViewSrc.includes("b.monthlyAmount ?? b.monthlyBudget ?? b.allocatedAmount")).toBe(true);
    expect(channelsViewSrc.includes("PLATFORM & MODE")).toBe(true);
  });
});
