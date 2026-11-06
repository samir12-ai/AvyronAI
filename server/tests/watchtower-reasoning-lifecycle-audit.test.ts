import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and } from "drizzle-orm";
import {
  formatWatchtowerComparison,
  classifyComparisonValueState,
} from "@shared/perception-translator";
import { formatCompetitorWebCorpusSummary } from "../watchtower/strategic-brief-context";
import { classifyWatchtowerChanges } from "../watchtower/orchestrator";
import { runCausalReasoningAnalysis } from "../adaptive/reasoning-engine";
import { judgeReasoningAnalysis } from "../adaptive/reasoning-judge";
import { routeAdaptiveDecision } from "../adaptive/router";
import { StrategyExperienceService } from "../strategy-experience/service";

describe("Watchtower → Deep Reasoning → Proposal → Approval → Apply Lifecycle Audit", () => {
  // Scenario 9: Watchtower scalar, object, array, null, and unchanged values -> readable UI output, never [object Object]
  describe("Scenario 9: Watchtower structured comparison & [object Object] prevention", () => {
    it("formats scalar, object, array, null, and unchanged values into readable text without [object Object]", () => {
      const objectDiff = formatWatchtowerComparison({
        eventKind: "competitor_profile_change",
        oldValue: {
          headline: "Custom Songs Starting at $99",
          cta: "Start Your Song",
          proofPoints: ["500+ 5-star reviews", "7-day delivery"],
        },
        newValue: {
          headline: "Studio-Quality Custom Songs for Unforgettable Moments",
          cta: "Create Your Custom Song",
          proofPoints: ["1,000+ verified reviews", "48-hour express delivery", "Free lyric sheet"],
        },
        diffSummary: "Sing My Story updated hero positioning and proof claims.",
      });

      expect(objectDiff.beforeSummary).not.toContain("[object Object]");
      expect(objectDiff.afterSummary).not.toContain("[object Object]");
      expect(objectDiff.beforeSummary).toContain("Custom Songs Starting at $99");
      expect(objectDiff.afterSummary).toContain("Studio-Quality Custom Songs");
      expect(objectDiff.rows.length).toBeGreaterThan(0);

      const arrayDiff = formatWatchtowerComparison({
        eventKind: "offer_language_change",
        oldValue: ["Free revisions", "Digital MP3 download"],
        newValue: ["Unlimited lyric revisions", "Studio WAV + MP3 download", "100% satisfaction guarantee"],
      });
      expect(arrayDiff.beforeSummary).not.toContain("[object Object]");
      expect(arrayDiff.afterSummary).not.toContain("[object Object]");
      expect(arrayDiff.beforeSummary).toContain("Free revisions");
      expect(arrayDiff.afterSummary).toContain("Unlimited lyric revisions");

      const nullBeforeDiff = formatWatchtowerComparison({
        eventKind: "pricing_change",
        oldValue: null,
        newValue: { price: "$199", discount: "15% Off Anniversary Special" },
        hasBaseline: true,
      });
      expect(nullBeforeDiff.beforeValueState).toBe("null");
      expect(nullBeforeDiff.afterValueState).toBe("present");
      expect(nullBeforeDiff.afterSummary).not.toContain("[object Object]");

      expect(classifyComparisonValueState([], true)).toBe("empty");
      expect(classifyComparisonValueState({}, true)).toBe("empty");
      expect(classifyComparisonValueState("None", true)).toBe("explicit_none");
      expect(classifyComparisonValueState(undefined, false)).toBe("absent");

      const webCorpusText = formatCompetitorWebCorpusSummary(
        {
          corePositioning: "Bespoke acoustic songs for anniversaries and weddings",
          pricingSummary: "$199 standard package",
          guarantees: ["Unlimited revisions", "Full refund if not satisfied"],
        },
        [
          { url: "https://singmystory.example.com/pricing", title: "Pricing & Packages", summary: "Standard $199, Express $249" },
        ],
      );
      expect(webCorpusText).not.toContain("[object Object]");
      expect(webCorpusText).toContain("Bespoke acoustic songs");
      expect(webCorpusText).toContain("Pricing & Packages");
    });
  });

  // Scenario 10 & 11: Discount banner vs actual price change, and Stored post count vs windowed posting cadence
  describe("Scenario 10 & 11: Watchtower classification guards (discount banner vs base price, stored post count vs windowed cadence)", () => {
    it("distinguishes CTA-only price formatting and promotional discount banners from structural base-price changes", () => {
      // Case A: Same $199 base price with CTA suffix after '|' -> should NOT emit pricing_change
      const ctaOnlyCandidates = classifyWatchtowerChanges(
        {
          pricing: ["$199 | Start Your Song Today"],
          objections: ["Custom song package"],
          patterns: ["Custom Songs"],
        },
        {
          pricing: ["$199 | Order Now"],
          objections: ["Custom song package"],
          patterns: ["Custom Songs"],
        },
        "snap_curr_1",
        "snap_prev_1",
      );
      expect(ctaOnlyCandidates.filter((c) => c.kind === "pricing_change")).toHaveLength(0);

      // Case B: Same $199 base price with 15% off anniversary banner -> mild severity with promotional discount banner evidence note
      const promoBannerCandidates = classifyWatchtowerChanges(
        {
          pricing: ["$199 | Start Your Song", "15% Off Anniversary Special | Claim Offer"],
          objections: ["Custom song package"],
          patterns: ["Custom Songs"],
        },
        {
          pricing: ["$199 | Start Your Song"],
          objections: ["Custom song package"],
          patterns: ["Custom Songs"],
        },
        "snap_curr_2",
        "snap_prev_2",
      );
      const pricingCandidate = promoBannerCandidates.find((c) => c.kind === "pricing_change");
      expect(pricingCandidate).toBeDefined();
      expect(pricingCandidate?.severity).toBe("mild");
      expect(pricingCandidate?.evidence.join(" ")).toContain("promotional discount banner change only");
    });

    it("suppresses posting_frequency_shift when stored post count increases (29 -> 36) without comparable publication-window timestamps", () => {
      const unwindowedPostCountCandidates = classifyWatchtowerChanges(
        {
          frequency: 36,
          countMeaning: "stored_posts",
          _translation_sources: ["ci_competitor_posts"],
        },
        {
          frequency: 29,
          countMeaning: "stored_posts",
          _translation_sources: ["ci_competitor_posts"],
        },
        "snap_050d894a",
        "snap_d6fac470",
      );
      expect(unwindowedPostCountCandidates.filter((c) => c.kind === "posting_frequency_shift")).toHaveLength(0);
    });
  });

  // Scenario 1, 2, 3, 10, 11 in Deep Reasoning Engine
  describe("Scenario 1, 2, 3, 10, 11: Grounded Deep Reasoning hypotheses & evidence partitioning", () => {
    const makeBaseCase = (id: string) => ({
      reasoningCaseId: id,
      campaignId: "camp_test",
      accountId: "acc_test",
      strategyRootId: "root_test",
      strategyRootVersion: 13,
      status: "OPEN" as const,
      sourceMarketEventIds: [],
      sourcePerformanceWarningIds: [],
      evidenceIds: [],
      candidateAffectedAuthorities: [],
      candidateAffectedLaneIds: [],
      openedAt: new Date().toISOString(),
    });

    it("Scenario 1 & 10: Market observeOnly / promotional discount banner -> NO_CHANGE (OBSERVE) with grounded hypotheses and non-identical evidence sets", () => {
      const baseCase = makeBaseCase("rcase_promo_1");
      const analysis = runCausalReasoningAnalysis({
        reasoningCase: baseCase,
        marketSignals: [
          {
            signalId: "sig_wt_promo_1",
            campaignId: "camp_test",
            accountId: "acc_test",
            sourceDomain: "WATCHTOWER",
            sourceArtifactId: "wt_promo_1",
            signalType: "pricing_change",
            confirmationState: "CONFIRMED",
            severity: "LOW",
            confidence: 0.72,
            summary: "Sing My Story added a 15% anniversary discount banner while keeping $199 base package price.",
            entityIds: ["comp_sing_my_story"],
            evidenceIds: ["wt_promo_1", "brief_promo_1", "snap_base_1", "snap_curr_1"],
            candidateAffectedAuthorities: ["OFFER"],
            observedAt: new Date().toISOString(),
            metadata: {
              observeOnly: true,
              briefId: "brief_promo_1",
              briefValidatedConfidence: 0.72,
              isPromotionalDiscountOnly: true,
              promoSummary: "15% OFF Anniversary Special",
              unchangedBasePrice: "$199",
              baselineSnapshotId: "snap_base_1",
              currentSnapshotId: "snap_curr_1",
            },
          },
        ],
        performanceSignals: [],
      });

      const judgeVerdict = judgeReasoningAnalysis(
        analysis.updatedCase,
        [],
        [],
        new Set(["wt_promo_1", "brief_promo_1", "snap_base_1", "snap_curr_1"]),
      );
      const decision = routeAdaptiveDecision({
        reasoningCase: analysis.updatedCase,
        judgeVerdict,
        marketSignals: [
          {
            signalId: "sig_wt_promo_1",
            campaignId: "camp_test",
            accountId: "acc_test",
            sourceDomain: "WATCHTOWER",
            sourceArtifactId: "wt_promo_1",
            signalType: "pricing_change",
            confirmationState: "CONFIRMED",
            severity: "LOW",
            confidence: 0.72,
            summary: "Sing My Story added a 15% anniversary discount banner while keeping $199 base package price.",
            entityIds: ["comp_sing_my_story"],
            evidenceIds: ["wt_promo_1", "brief_promo_1", "snap_base_1", "snap_curr_1"],
            candidateAffectedAuthorities: ["OFFER"],
            observedAt: new Date().toISOString(),
            metadata: { observeOnly: true },
          },
        ],
        performanceSignals: [],
        campaignId: "camp_test",
        accountId: "acc_test",
      });

      expect(decision.decisionType).toBe("OBSERVE");
      const compPressure = analysis.hypotheses.find((h) => h.hypothesisType === "COMPETITIVE_PRESSURE");
      const promoHyp = analysis.hypotheses.find((h) => h.hypothesisType === "PROMOTIONAL_DISCOUNT_FRAMING_ONLY");
      expect(compPressure?.status).toBe("INCONCLUSIVE");
      expect(promoHyp?.status).toBe("VALIDATED");
      expect(compPressure?.supportingEvidenceIds).not.toEqual(promoHyp?.supportingEvidenceIds);
      expect(analysis.hypotheses.some((h) => h.hypothesisType === "STATISTICAL_NOISE")).toBe(false);
    });

    it("Scenario 2: Contradicted lyric-sheet removal -> MONITORING (INSUFFICIENT_EVIDENCE) with REJECTED competitive pressure and populated contradictingEvidenceIds", () => {
      const baseCase = makeBaseCase("rcase_lyric_1");
      const analysis = runCausalReasoningAnalysis({
        reasoningCase: baseCase,
        marketSignals: [
          {
            signalId: "sig_wt_lyric_1",
            campaignId: "camp_test",
            accountId: "acc_test",
            sourceDomain: "WATCHTOWER",
            sourceArtifactId: "wt_lyric_1",
            signalType: "competitor_profile_change",
            confirmationState: "CONFIRMED",
            severity: "MEDIUM",
            confidence: 0.85,
            summary: "Alleged removal of free lyric sheets.",
            entityIds: ["comp_personalised_song"],
            evidenceIds: ["wt_lyric_1", "brief_lyric_1", "snap_base_lyric", "snap_curr_lyric"],
            candidateAffectedAuthorities: ["OFFER"],
            observedAt: new Date().toISOString(),
            metadata: {
              isContradicted: true,
              failureCode: "COUNTEREVIDENCE_CONTRADICTION",
              counterevidenceViolations: ["CURR-POSTS still advertise free lyric sheets on active offerings."],
              baselineSnapshotId: "snap_base_lyric",
              currentSnapshotId: "snap_curr_lyric",
            },
          },
        ],
        performanceSignals: [],
      });

      const decision = routeAdaptiveDecision({
        reasoningCase: analysis.updatedCase,
        judgeVerdict: {
          status: "INSUFFICIENT_EVIDENCE",
          confidence: 0.35,
          violations: [],
          rationale: "Contradicted by CURR-POSTS",
          overclaimDetected: false,
          alternativeCausesSatisfied: true,
        },
        marketSignals: [],
        performanceSignals: [],
        campaignId: "camp_test",
        accountId: "acc_test",
      });

      expect(analysis.evidenceSufficiency).toBe("INSUFFICIENT");
      expect(decision.decisionType).toBe("INSUFFICIENT_EVIDENCE");
      const compPressure = analysis.hypotheses.find((h) => h.hypothesisType === "COMPETITIVE_PRESSURE");
      const contradictionHyp = analysis.hypotheses.find((h) => h.hypothesisType === "EXTRACTION_OR_SCOPE_CONTRADICTION");
      expect(compPressure?.status).toBe("REJECTED");
      expect(compPressure?.contradictingEvidenceIds.length).toBeGreaterThan(0);
      expect(contradictionHyp?.status).toBe("VALIDATED");
    });

    it("Scenario 3: Performance zero-metric check-in (0 leads, 0 customers, $0 ad spend, 0 active-window posts) -> partitions evidence by mechanism and avoids ad-fatigue claims", () => {
      const baseCase = makeBaseCase("rcase_perf_zero");
      const perfSig = {
        signalId: "sig_perf_zero",
        campaignId: "camp_test",
        accountId: "acc_test",
        sourceDomain: "PERFORMANCE_LOOP" as const,
        sourceArtifactId: "perf_ctx_zero",
        signalType: "CONVERSION_DROP",
        confirmationState: "CONFIRMED" as const,
        severity: "HIGH" as const,
        confidence: 0.75,
        summary: "Weekly check-in reported 0 leads, 0 customers, $0 ad spend, and 0 posts published in active window.",
        entityIds: [],
        evidenceIds: ["web_snap", "chan_ig", "inv_week1", "chan_tt", "chan_yt"],
        candidateAffectedAuthorities: ["PLAN_SYNTHESIS" as const],
        observedAt: new Date().toISOString(),
        metadata: {
          distributionEvidenceIds: ["chan_ig", "chan_tt", "chan_yt", "inv_week1"],
          funnelEvidenceIds: ["web_snap", "inv_week1"],
          zeroActivityChannelEvidenceIds: ["chan_ig", "chan_tt", "chan_yt"],
          baselineEvidenceIds: ["inv_week1"],
          isZeroExecutionWindow: true,
          isSingleWindowSample: true,
        },
      };

      const analysis = runCausalReasoningAnalysis({
        reasoningCase: baseCase,
        marketSignals: [],
        performanceSignals: [perfSig],
      });

      const judgeVerdict = judgeReasoningAnalysis(
        analysis.updatedCase,
        [],
        [perfSig],
        new Set(["web_snap", "chan_ig", "inv_week1", "chan_tt", "chan_yt"]),
      );
      const decision = routeAdaptiveDecision({
        reasoningCase: analysis.updatedCase,
        judgeVerdict,
        marketSignals: [],
        performanceSignals: [perfSig],
        campaignId: "camp_test",
        accountId: "acc_test",
      });

      expect(decision.decisionType).toBe("EXECUTION_RESPONSE");
      const distHyp = analysis.hypotheses.find((h) => h.hypothesisType === "EXECUTION_OR_DISTRIBUTION_FLUCTUATION");
      const funnelHyp = analysis.hypotheses.find((h) => h.hypothesisType === "FUNNEL_OR_OFFER_FRICTION");
      const sampleHyp = analysis.hypotheses.find((h) => h.hypothesisType === "SINGLE_WINDOW_SAMPLE_LIMITATION");

      expect(distHyp?.status).toBe("PROPOSED");
      expect(funnelHyp?.status).toBe("INCONCLUSIVE");
      expect(sampleHyp).toBeDefined();
      expect(distHyp?.supportingEvidenceIds).not.toEqual(funnelHyp?.supportingEvidenceIds);
      expect(distHyp?.explanation).toContain("$0 ad spend");
      expect(distHyp?.explanation).toContain("rather than paid ad fatigue");
    });
  });

  // Scenarios 1, 2, 4, 5, 6, 7, 8: Backend Apply Enforcement on Isolated DB Fixtures
  describe("Scenarios 1, 2, 4, 5, 6, 7, 8: Backend approveProposal enforcement & transactional guarantees", () => {
    const testAccountId = `acc_audit_${randomUUID().slice(0, 8)}`;
    const otherAccountId = `acc_other_${randomUUID().slice(0, 8)}`;
    const testCampaignId = `camp_audit_${randomUUID().slice(0, 8)}`;
    const rootIdV13 = `root_v13_${randomUUID().slice(0, 8)}`;
    const bundleIdV13 = `bundle_v13_${randomUUID().slice(0, 8)}`;
    const planIdV4 = `plan_v4_${randomUUID().slice(0, 8)}`;

    it("enforces all backend apply rules across NO_CHANGE, MONITORING, empty diff, execution-vs-strategy routing, stale version, valid execution apply, valid strategy apply, and duplicate apply", async () => {
      // Seed isolated active root v13, active bundle v13, and active plan v4
      await db.insert(schema.strategyRoots).values({
        id: rootIdV13,
        accountId: testAccountId,
        campaignId: testCampaignId,
        runId: "run_audit_init",
        rootHash: "hash_audit_v13",
        primaryAxis: "Emotional Bespoke Songwriting",
        contrastAxisText: "Human-crafted studio musicians vs generic AI templates",
        approvedMechanism: JSON.stringify({ name: "Guided Story-to-Song Studio Process" }),
        approvedAudiencePains: JSON.stringify(["Generic gifts feel impersonal"]),
        approvedDesires: JSON.stringify(["Move partner to tears on anniversary"]),
        approvedTransformation: "From generic gift anxiety to unforgettable emotional milestone",
        approvedClaim: "Broadcast-quality custom song delivered in 7 days",
        approvedClaims: JSON.stringify(["Broadcast-quality custom song delivered in 7 days"]),
        approvedPromise: "100% Emotional Resonance Guarantee with Unlimited Lyric Revisions",
        approvedObjections: JSON.stringify(["Will it sound cheesy?"]),
        approvedProofTypes: JSON.stringify(["Verified video reactions"]),
        approvedPositioningContext: JSON.stringify({ category: "Bespoke Musical Gifts" }),
        miSnapshotId: "mi_snap_audit_01",
        audienceSnapshotId: "aud_snap_audit_01",
        positioningSnapshotId: "pos_snap_audit_01",
        differentiationSnapshotId: "diff_snap_audit_01",
        mechanismSnapshotId: "mech_snap_audit_01",
        status: "ACTIVE",
      });

      await db.insert(schema.rootBundles).values({
        id: bundleIdV13,
        accountId: testAccountId,
        campaignId: testCampaignId,
        version: 13,
        strategyRootId: rootIdV13,
        status: "active",
        bundleData: JSON.stringify({ version: 13, strategyRootId: rootIdV13 }),
      });

      await db.insert(schema.strategicPlans).values({
        id: planIdV4,
        accountId: testAccountId,
        campaignId: testCampaignId,
        blueprintId: "bp_audit_v4",
        planJson: JSON.stringify({
          weeklyTasks: [
            { id: "task_ig_reels_01", title: "Publish 3 behind-the-scenes lyric story Reels per week" },
          ],
        }),
        planSummary: "Approved Strategy Plan v4",
        status: "APPROVED",
        executionStatus: "ACTIVE",
        isDesignatedActive: true,
        rootBundleId: bundleIdV13,
        rootBundleVersion: 13,
        version: 4,
      });

      try {
        // --- 1. Reject NO_CHANGE proposal ---
        const noChangePropId = `prop_nochange_${randomUUID().slice(0, 8)}`;
        await db.insert(schema.strategyChangeProposals).values({
          id: noChangePropId,
          accountId: testAccountId,
          campaignId: testCampaignId,
          adaptiveDecisionId: `adec_nc_${randomUUID().slice(0, 6)}`,
          reasoningCaseId: `rcase_nc_${randomUUID().slice(0, 6)}`,
          currentStrategyRootId: rootIdV13,
          currentRootBundleVersion: 13,
          decisionType: "OBSERVE",
          affectedAuthorities: ["OFFER"],
          preservedAuthorities: ["AUDIENCE"],
          summary: "No change observation",
          whyNow: "Observation only",
          evidenceSummary: "Observed competitor copy shift",
          expectedImpact: "None",
          riskNote: "None",
          status: "PENDING_USER_APPROVAL",
          metadata: {
            targetType: "STRATEGY",
            beforeAfterPatchPreview: [{ section: "Offer", before: "A", after: "B" }],
          },
        });

        await expect(
          StrategyExperienceService.approveProposal(noChangePropId, testAccountId),
        ).rejects.toMatchObject({
          statusCode: 422,
          code: "NON_ACTIONABLE_DECISION",
        });

        const [ncAfter] = await db
          .select()
          .from(schema.strategyChangeProposals)
          .where(eq(schema.strategyChangeProposals.id, noChangePropId));
        expect(ncAfter.status).toBe("PENDING_USER_APPROVAL");

        // --- 2. Reject MONITORING / contradicted investigation proposal ---
        const monCaseId = `rcase_mon_${randomUUID().slice(0, 8)}`;
        const monPropId = `prop_mon_${randomUUID().slice(0, 8)}`;
        await db.insert(schema.reasoningCases).values({
          id: monCaseId,
          accountId: testAccountId,
          campaignId: testCampaignId,
          strategyRootId: rootIdV13,
          strategyRootVersion: 13,
          status: "INSUFFICIENT_EVIDENCE",
          sourceMarketEventIds: ["wt_lyric_1"],
          sourcePerformanceWarningIds: [],
          evidenceIds: ["wt_lyric_1"],
          metadata: { failureCode: "COUNTEREVIDENCE_CONTRADICTION" },
        } as any);
        await db.insert(schema.strategyChangeProposals).values({
          id: monPropId,
          accountId: testAccountId,
          campaignId: testCampaignId,
          adaptiveDecisionId: `adec_mon_${randomUUID().slice(0, 6)}`,
          reasoningCaseId: monCaseId,
          currentStrategyRootId: rootIdV13,
          currentRootBundleVersion: 13,
          decisionType: "TARGETED_RECOMPUTE",
          affectedAuthorities: ["OFFER"],
          preservedAuthorities: ["AUDIENCE"],
          summary: "Contradicted case proposal",
          whyNow: "Contradicted",
          evidenceSummary: "Contradicted by CURR-POSTS",
          expectedImpact: "None",
          riskNote: "None",
          status: "PENDING_USER_APPROVAL",
          metadata: {
            targetType: "STRATEGY",
            beforeAfterPatchPreview: [{ section: "Offer", before: "A", after: "B" }],
          },
        });

        await expect(
          StrategyExperienceService.approveProposal(monPropId, testAccountId),
        ).rejects.toMatchObject({
          statusCode: 422,
          code: "CONTRADICTED_OR_INSUFFICIENT_EVIDENCE",
        });

        // --- 3. Reject unauthorized tenant ---
        await expect(
          StrategyExperienceService.approveProposal(noChangePropId, otherAccountId),
        ).rejects.toMatchObject({
          statusCode: 403,
          code: "UNAUTHORIZED_TENANT",
        });

        // --- 4. Reject Empty / No-Op Patch (before == after) ---
        const emptyPropId = `prop_empty_${randomUUID().slice(0, 8)}`;
        await db.insert(schema.strategyChangeProposals).values({
          id: emptyPropId,
          accountId: testAccountId,
          campaignId: testCampaignId,
          adaptiveDecisionId: `adec_emp_${randomUUID().slice(0, 6)}`,
          reasoningCaseId: `rcase_emp_${randomUUID().slice(0, 6)}`,
          currentStrategyRootId: rootIdV13,
          currentRootBundleVersion: 13,
          decisionType: "TARGETED_RECOMPUTE",
          affectedAuthorities: ["DIFFERENTIATION"],
          preservedAuthorities: ["AUDIENCE"],
          summary: "No-op patch",
          whyNow: "Test empty diff",
          evidenceSummary: "No diff",
          expectedImpact: "None",
          riskNote: "None",
          status: "PENDING_USER_APPROVAL",
          metadata: {
            targetType: "STRATEGY",
            beforeAfterPatchPreview: [{ section: "Differentiation", before: "Same text", after: "Same text" }],
          },
        });

        await expect(
          StrategyExperienceService.approveProposal(emptyPropId, testAccountId),
        ).rejects.toMatchObject({
          statusCode: 422,
          code: "EMPTY_OR_NOOP_PATCH",
        });
        const [emptyAfter] = await db
          .select()
          .from(schema.strategyChangeProposals)
          .where(eq(schema.strategyChangeProposals.id, emptyPropId));
        expect(emptyAfter.status).toBe("PENDING_USER_APPROVAL");

        // --- 5. Scenario 4: Execution Adjustment routed to Strategy -> Rejected; Valid Execution Adjustment -> Mutates plan tasks only, preserves Strategy Root v13 ---
        const execPropId = `prop_exec_${randomUUID().slice(0, 8)}`;
        await db.insert(schema.strategyChangeProposals).values({
          id: execPropId,
          accountId: testAccountId,
          campaignId: testCampaignId,
          adaptiveDecisionId: `adec_exec_${randomUUID().slice(0, 6)}`,
          reasoningCaseId: `rcase_exec_${randomUUID().slice(0, 6)}`,
          currentStrategyRootId: rootIdV13,
          currentRootBundleVersion: 13,
          decisionType: "EXECUTION_RESPONSE",
          affectedAuthorities: ["PLAN_SYNTHESIS"],
          preservedAuthorities: ["AUDIENCE", "POSITIONING", "DIFFERENTIATION", "OFFER"],
          summary: "Shift Weekly Reel Cadence to 3 Reaction Clips",
          whyNow: "Zero active-window posts published during Week 1.",
          evidenceSummary: "0 posts in active window across IG, TikTok, YouTube",
          expectedImpact: "Restore organic top-of-funnel distribution.",
          riskNote: "Low risk",
          status: "PENDING_USER_APPROVAL",
          metadata: {
            targetType: "EXECUTION",
            targetPlanId: planIdV4,
            targetTaskIds: ["task_ig_reels_01"],
            beforeAfterPatchPreview: [
              {
                sectionName: "What To Do Today — Task task_ig_reels_01",
                fieldLabel: "Weekly Publishing Cadence",
                beforeText: "Publish 3 behind-the-scenes lyric story Reels per week (0 published in window)",
                afterText: "Publish 2 customer reaction clips + 1 acoustic verse preview Reel with direct bio CTA",
              },
            ],
          },
        });

        // Reject when sent with expectedTargetType = STRATEGY
        await expect(
          StrategyExperienceService.approveProposal(execPropId, testAccountId, {
            expectedTargetType: "STRATEGY",
          }),
        ).rejects.toMatchObject({
          statusCode: 422,
          code: "EXECUTION_ROUTED_TO_STRATEGY",
        });

        // Succeed when sent with expectedTargetType = EXECUTION
        const execApplyResult = await StrategyExperienceService.approveProposal(execPropId, testAccountId, {
          expectedTargetType: "EXECUTION",
          expectedVersion: 13,
        });
        expect(execApplyResult.status).toBe("SUCCESS");
        expect(execApplyResult.executionStatus).toBe("EXECUTION_ADJUSTMENT_APPLIED");
        expect(execApplyResult.newRoot).toBeNull();

        // Confirm Strategy Root v13 is still ACTIVE and unchanged
        const [activeRootAfterExec] = await db
          .select()
          .from(schema.strategyRoots)
          .where(and(eq(schema.strategyRoots.campaignId, testCampaignId), eq(schema.strategyRoots.status, "ACTIVE")));
        expect(activeRootAfterExec.id).toBe(rootIdV13);

        // --- 6. Scenario 5: Genuine Strategy Proposal with concrete diff -> Creates Root v14 & Bundle v14 atomically ---
        const stratPropId = `prop_strat_${randomUUID().slice(0, 8)}`;
        await db.insert(schema.strategyChangeProposals).values({
          id: stratPropId,
          accountId: testAccountId,
          campaignId: testCampaignId,
          adaptiveDecisionId: `adec_strat_${randomUUID().slice(0, 6)}`,
          reasoningCaseId: `rcase_strat_${randomUUID().slice(0, 6)}`,
          currentStrategyRootId: rootIdV13,
          currentRootBundleVersion: 13,
          decisionType: "TARGETED_RECOMPUTE",
          affectedAuthorities: ["OFFER"],
          preservedAuthorities: ["AUDIENCE", "POSITIONING", "DIFFERENTIATION"],
          summary: "Add Explicit 48-Hour Preview Milestone to Offer Promise",
          whyNow: "Corroborated checkout hesitation on custom song delivery timeline.",
          evidenceSummary: "Corroborated checkout hesitation across 3 reporting windows",
          expectedImpact: "Hypothesized to reduce checkout drop-off by clarifying preview delivery.",
          riskNote: "Requires studio queue capacity for 48-hour acoustic preview.",
          status: "PENDING_USER_APPROVAL",
          metadata: {
            targetType: "STRATEGY",
            beforeAfterPatchPreview: [
              {
                sectionName: "Offer Architecture & Risk Reversal",
                fieldLabel: "Approved Promise",
                authority: "OFFER",
                beforeText: "100% Emotional Resonance Guarantee with Unlimited Lyric Revisions",
                afterText: "48-Hour Acoustic Preview + 100% Emotional Resonance Guarantee with Unlimited Lyric Revisions",
              },
            ],
          },
        });

        const stratApplyResult = await StrategyExperienceService.approveProposal(stratPropId, testAccountId, {
          expectedTargetType: "STRATEGY",
          expectedVersion: 13,
        });
        expect(stratApplyResult.status).toBe("SUCCESS");
        expect(stratApplyResult.executionStatus).toBe("STRATEGY_UPDATED");
        expect(stratApplyResult.appliedVersion).toBe(14);
        expect(stratApplyResult.newRoot?.id).toBeDefined();
        expect(stratApplyResult.newRoot?.id).not.toBe(rootIdV13);
        expect(stratApplyResult.newRoot?.approvedPromise).toContain("48-Hour Acoustic Preview");

        // --- 7. Scenario 8: Duplicate apply call -> Rejected idempotently with 409 PROPOSAL_ALREADY_APPLIED ---
        await expect(
          StrategyExperienceService.approveProposal(stratPropId, testAccountId),
        ).rejects.toMatchObject({
          statusCode: 409,
          code: "PROPOSAL_ALREADY_APPLIED",
        });

        // --- 8. Scenario 7: Stale target version -> Rejected with 409 PROPOSAL_STALE ---
        const stalePropId = `prop_stale_${randomUUID().slice(0, 8)}`;
        await db.insert(schema.strategyChangeProposals).values({
          id: stalePropId,
          accountId: testAccountId,
          campaignId: testCampaignId,
          adaptiveDecisionId: `adec_stale_${randomUUID().slice(0, 6)}`,
          reasoningCaseId: `rcase_stale_${randomUUID().slice(0, 6)}`,
          currentStrategyRootId: rootIdV13, // Stale! Active root is now v14
          currentRootBundleVersion: 13,
          decisionType: "TARGETED_RECOMPUTE",
          affectedAuthorities: ["DIFFERENTIATION"],
          preservedAuthorities: ["AUDIENCE"],
          summary: "Stale proposal targeting v13",
          whyNow: "Created before v14 update",
          evidenceSummary: "Prior root v13 evidence",
          expectedImpact: "None",
          riskNote: "None",
          status: "PENDING_USER_APPROVAL",
          metadata: {
            targetType: "STRATEGY",
            beforeAfterPatchPreview: [
              {
                sectionName: "Differentiation",
                beforeText: "Human-crafted studio musicians vs generic AI templates",
                afterText: "Named acoustic session vocalists vs automated generators",
              },
            ],
          },
        });

        await expect(
          StrategyExperienceService.approveProposal(stalePropId, testAccountId),
        ).rejects.toMatchObject({
          statusCode: 409,
          code: "PROPOSAL_STALE",
        });

        const [staleAfter] = await db
          .select()
          .from(schema.strategyChangeProposals)
          .where(eq(schema.strategyChangeProposals.id, stalePropId));
        expect(staleAfter.status).toBe("STALE");
      } finally {
        // Clean up isolated test fixtures
        await db.delete(schema.strategyAdaptationOutcomes).where(eq(schema.strategyAdaptationOutcomes.campaignId, testCampaignId));
        await db.delete(schema.strategyAdaptationLineages).where(eq(schema.strategyAdaptationLineages.campaignId, testCampaignId));
        await db.delete(schema.strategyChangeProposals).where(eq(schema.strategyChangeProposals.campaignId, testCampaignId));
        await db.delete(schema.reasoningCases).where(eq(schema.reasoningCases.campaignId, testCampaignId));
        await db.delete(schema.strategicPlans).where(eq(schema.strategicPlans.campaignId, testCampaignId));
        await db.delete(schema.rootBundles).where(eq(schema.rootBundles.campaignId, testCampaignId));
        await db.delete(schema.strategyRoots).where(eq(schema.strategyRoots.campaignId, testCampaignId));
      }
    }, 30000);
  });
});
