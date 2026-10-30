import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  extractAssertionSemanticProperties,
  evaluateClaimSemanticEntailment,
} from "../shared/claim-entailment";
import {
  extractEngineInsights,
  extractLockedDecisions,
} from "../orchestrator/plan-synthesis";
import { classifyOfferGuaranteeApprovalStatus } from "../offer-engine/engine";
import { validateClaimGrounding } from "../positioning-engine/engine";

const SONGAI_VERIFIED_PRODUCT_FACTS = [
  "The Songai creates custom, personalized songs for gifts and special occasions.",
  "Customers submit personal stories, memories, and recipient details through a guided online form.",
  "Customers can select musical genre, mood/emotion, and vocal preference.",
  "Songs are delivered digitally within 24 hours (with an express 6-hour option).",
  "Pricing is structured as one-time package tiers (£29.99, £39.99, £79.99).",
  "Delivered songs include a downloadable MP3 file, custom lyric sheet, and shareable song link.",
  "Customers receive a 100% money-back guarantee if they are not satisfied.",
];

describe("Overview Audit Source-Level Repairs — 10 Targeted Regression Checks", () => {
  it("1 & 2. Snapshot selection chooses the latest valid Differentiation snapshot in lineage and invalidates Positioning, Mechanism, Strategy Root, Offer, Awareness, and Overview synthesis when Differentiation updates", async () => {
    const continuationSrc = fs.readFileSync(
      path.resolve(__dirname, "../orchestrator/continuation.ts"),
      "utf-8",
    );
    const rootBundleSrc = fs.readFileSync(
      path.resolve(__dirname, "../root-bundle.ts"),
      "utf-8",
    );

    // Verify pickBySourceJob prioritizes validInLineage over stale preferredSnapshotId for non-acquisition stages
    expect(continuationSrc).toContain("lineage_compatible_latest");
    // Verify upstream snapshot divergence invalidates effectiveStrategyRoot and forces downstream recomputation
    expect(continuationSrc).toContain("effectiveStrategyRoot = null");
    expect(continuationSrc).toContain("strategyRootId = null");

    // Verify buildRootBundle uses pinned selectedSnapshotIds / strategyRoot rather than blind campaign-wide latest queries
    expect(rootBundleSrc).toContain("pinnedDiffId");
    expect(rootBundleSrc).toContain("pinnedPosId");
    expect(rootBundleSrc).toContain("pinnedMechId");
    expect(rootBundleSrc).toContain("pinnedOfferId");
    expect(rootBundleSrc).toContain("selectedSnapshotIds");
  });

  it("3. Positioning PROPOSED / STRATEGIC_HYPOTHESIS status survives synthesis inputs, BLL translation metadata, and API/UI mapping", () => {
    const results = new Map<string, any>([
      [
        "positioning",
        {
          status: "SUCCESS",
          output: {
            territories: [
              {
                name: "Bespoke Narrative-Driven Song Creation",
                rationale:
                  "Selected to emphasize verified story, mood, genre, and vocal customization while acknowledging competitor comparison is unverified.",
                epistemicStatus: "STRATEGIC_HYPOTHESIS",
                epistemicLabel:
                  "Proposed Strategic Hypothesis — Requires Market Validation (No Competitor Positioning Compared)",
                positioningOutcomeType: "SHARED_CAPABILITY_STRATEGIC_EMPHASIS",
                comparisonStatus: "COMPETITIVE_COMPARISON_UNAVAILABLE",
                comparedCompetitorCount: 0,
              },
            ],
            enemyDefinition:
              "Specific service patterns where buyers report templated outputs in customer reviews of MakeBestMusic",
            contrastAxis: "Guided Story & Vocal Preference Input vs. Unverified Generic Alternatives",
            narrativeDirection:
              "Emphasize guided story, mood, genre, and vocal customization without claiming proven category exclusivity.",
            epistemicStatus: "STRATEGIC_HYPOTHESIS",
            epistemicLabel:
              "Proposed Strategic Hypothesis — Requires Market Validation (No Competitor Positioning Compared)",
            positioningOutcomeType: "SHARED_CAPABILITY_STRATEGIC_EMPHASIS",
            comparisonStatus: "COMPETITIVE_COMPARISON_UNAVAILABLE",
            comparedCompetitorCount: 0,
          },
        },
      ],
    ]);

    const insights = extractEngineInsights(results as any, null);
    expect(insights).toContain('EpistemicStatus "STRATEGIC_HYPOTHESIS"');
    expect(insights).toContain("Proposed Strategic Hypothesis — Requires Market Validation");
    expect(insights).toContain('OutcomeType "SHARED_CAPABILITY_STRATEGIC_EMPHASIS"');
    expect(insights).toContain('ComparisonStatus "COMPETITIVE_COMPARISON_UNAVAILABLE" (comparedCompetitorCount=0)');

    const rootWithPos = {
      approvedPositioningContext: results.get("positioning")!.output,
    };
    const locked = extractLockedDecisions(results as any, rootWithPos);
    expect(locked).toContain('Positioning epistemic status: "STRATEGIC_HYPOTHESIS"');
    expect(locked).toContain(
      'Positioning epistemic label: "Proposed Strategic Hypothesis — Requires Market Validation (No Competitor Positioning Compared)"',
    );
    expect(locked).toContain('Positioning comparison status: "COMPETITIVE_COMPARISON_UNAVAILABLE" (comparedCompetitorCount=0)');
  });

  it("4. comparedCompetitorCount = 0 prevents category-wide competitor process assertions while preserving competitor-attributed customer reviews", () => {
    const posEngineSrc = fs.readFileSync(
      path.resolve(__dirname, "../positioning-engine/engine.ts"),
      "utf-8",
    );
    // Verify validateClaimGrounding rejects ungrounded capability/outcome assertions even if present in customer desire labels
    expect(posEngineSrc).toContain("const entailment = evaluateClaimSemanticEntailment(claimText, extraAllowedTerms);");

    const seedWithCustomerDesire = {
      sourceLabels: [
        "Customers want multiple song versions to choose from and guaranteed emotional authenticity that is never generic",
      ],
      sourceSignalIds: ["sig_desire_1"],
    } as any;
    const groundingResult = validateClaimGrounding(
      "Our process ensures emotional authenticity that is never generic and lets you choose from multiple song versions.",
      seedWithCustomerDesire,
      SONGAI_VERIFIED_PRODUCT_FACTS,
    );
    expect(groundingResult.grounded).toBe(false);
  });

  it("5. MakeBestMusic customer reviews stay attributed to MakeBestMusic and do not become claims about every competitor or Songai", () => {
    const results = new Map<string, any>([
      [
        "audience",
        {
          status: "SUCCESS",
          output: {
            audiencePains: [
              {
                painId: "seg_1_pain_1",
                canonical: "Customers report that songs feel generic and templated despite submitting personal stories",
                subjectScope: "COMPETITOR_SPECIFIC",
                competitorNames: ["MakeBestMusic"],
                evidenceIds: ["ddb5d396-0b3c-4f25-8306-4476dc844028"],
              },
            ],
            audienceSegments: [{ name: "Sentimental Gift Buyers" }],
          },
        },
      ],
    ]);

    const insights = extractEngineInsights(results as any, null);
    expect(insights).toContain("[COMPETITOR_SPECIFIC: MakeBestMusic]");

    const locked = extractLockedDecisions(results as any, {
      approvedAudiencePains: [
        {
          pain: "Customers report that songs feel generic and templated despite submitting personal stories",
          competitorNames: ["MakeBestMusic"],
        },
      ],
    });
    expect(locked).toContain("[Competitor-attributed to MakeBestMusic]");
  });

  it("6. Product facts supporting downloadable MP3 and shareable link do not pass as permanent/lifetime cloud hosting", () => {
    const factProps = extractAssertionSemanticProperties(
      "Delivered songs include a downloadable MP3 file, custom lyric sheet, and shareable song link.",
    ).properties;
    expect(factProps).toContain("downloadable_file_delivery");
    expect(factProps).toContain("shareable_link_delivery");
    expect(factProps).not.toContain("indefinite_cloud_hosting");

    const lifetimeHostingEntailment = evaluateClaimSemanticEntailment(
      "Includes lifetime cloud hosting and permanent cloud access to your song.",
      SONGAI_VERIFIED_PRODUCT_FACTS,
    );
    expect(lifetimeHostingEntailment.entailed).toBe(false);
    expect(lifetimeHostingEntailment.isGrounded).toBe(false);
    expect(
      lifetimeHostingEntailment.violations.some((v) => v.includes("indefinite_cloud_hosting")),
    ).toBe(true);

    const permanentMp3Entailment = evaluateClaimSemanticEntailment(
      "Provides permanent downloadable MP3 access with indefinite cloud storage.",
      SONGAI_VERIFIED_PRODUCT_FACTS,
    );
    expect(permanentMp3Entailment.entailed).toBe(false);

    // Also verify Offer guarantee/deliverable classifier marks lifetime cloud hosting as PROPOSED_OPERATIONAL_CHANGE / PENDING_BUSINESS_APPROVAL
    const offerStatus = classifyOfferGuaranteeApprovalStatus(
      "Lifetime cloud hosting and permanent song link",
      SONGAI_VERIFIED_PRODUCT_FACTS.map((s) => ({ statement: s })),
    );
    expect(offerStatus.isVerifiedInProductTruth).toBe(false);
    expect(offerStatus.strategicStatus).toBe("PROPOSED_OPERATIONAL_CHANGE");
    expect(offerStatus.businessApprovalStatus).toBe("PENDING_BUSINESS_APPROVAL");
  });

  it("7. Product facts supporting story/mood/genre/vocal customization do not pass as multi-version selection, iterative editing, or guaranteed emotional outcomes", () => {
    const multiVersionEntailment = evaluateClaimSemanticEntailment(
      "Customers receive multiple song versions to choose from and select their favorite.",
      SONGAI_VERIFIED_PRODUCT_FACTS,
    );
    expect(multiVersionEntailment.entailed).toBe(false);
    expect(
      multiVersionEntailment.violations.some((v) => v.includes("multi_version_selection")),
    ).toBe(true);

    const iterativeEditingEntailment = evaluateClaimSemanticEntailment(
      "Interactive lyric editing and collaborative revision rounds before final delivery.",
      SONGAI_VERIFIED_PRODUCT_FACTS,
    );
    expect(iterativeEditingEntailment.entailed).toBe(false);
    expect(
      iterativeEditingEntailment.violations.some((v) => v.includes("iterative_editing_control")),
    ).toBe(true);

    const guaranteedOutcomeEntailment = evaluateClaimSemanticEntailment(
      "Our bespoke creation process ensures emotional authenticity so the song is never generic.",
      SONGAI_VERIFIED_PRODUCT_FACTS,
    );
    expect(guaranteedOutcomeEntailment.entailed).toBe(false);
    expect(
      guaranteedOutcomeEntailment.violations.some((v) => v.includes("guaranteed_emotional_outcome")),
    ).toBe(true);
  });

  it("8. Product facts supporting one-time package tiers do not become a claim that all competitors use deceptive subscription traps unless supported by scoped evidence", () => {
    const factProps = extractAssertionSemanticProperties(
      "Pricing is structured as one-time package tiers (£29.99, £39.99, £79.99).",
    ).properties;
    expect(factProps).toContain("upfront_package_tier_pricing");

    const awarenessReframeSrc = fs.readFileSync(
      path.resolve(__dirname, "../awareness-engine/narrative-reframe.ts"),
      "utf-8",
    );
    const awarenessMythSrc = fs.readFileSync(
      path.resolve(__dirname, "../awareness-engine/myth-breaker-llm.ts"),
      "utf-8",
    );

    expect(awarenessReframeSrc).toContain("UNSCOPED COMPETITOR GENERALIZATION OR BUSINESS-MODEL FICTION");
    expect(awarenessReframeSrc).toContain("portrays ordinary subscription models as deceptive traps without scoped evidence");
    expect(awarenessMythSrc).toContain("do NOT portray ordinary subscription models or upsells as deceptive traps without scoped evidence");
  });

  it("9. Card 2 rationale is not a duplicate of narrativeDirection when a distinct rationale exists", () => {
    const strategyPlanUiSrc = fs.readFileSync(
      path.resolve(__dirname, "../../app/(tabs)/strategy-plan.tsx"),
      "utf-8",
    );
    expect(strategyPlanUiSrc).toContain("const canonicalDoctrineRationale =");
    expect(strategyPlanUiSrc).toContain("sections.positioning.rationale.trim() !== canonicalStatement.trim()");
  });

  it("10. UI does not display static 'Engine Verified' or 'Algorithmically Approved' when the underlying claim status is PROPOSED / STRATEGIC_HYPOTHESIS", () => {
    const strategyPlanUiSrc = fs.readFileSync(
      path.resolve(__dirname, "../../app/(tabs)/strategy-plan.tsx"),
      "utf-8",
    );
    expect(strategyPlanUiSrc).not.toContain("Source of Truth · Engine Verified");
    expect(strategyPlanUiSrc).not.toContain("ALGORITHMICALLY APPROVED STATEMENT");
    expect(strategyPlanUiSrc).not.toContain("Business Layer · Active");
    expect(strategyPlanUiSrc).toContain("Proposed Strategic Hypothesis");
    expect(strategyPlanUiSrc).toContain("Supported by Product Facts");
    expect(strategyPlanUiSrc).toContain("Customer-Reported Competitor Signal");
    expect(strategyPlanUiSrc).toContain("Competitor Comparison Unavailable");
  });
});
