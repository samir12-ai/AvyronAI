import { describe, it, expect } from "vitest";
import {
  buildCompactCompetitorComparisonContext,
  computePositioningCandidateHash,
  validatePositioningCandidate,
  evaluateAndSelectCollisionRevision,
} from "../positioning-engine/engine";
import { interpretSemanticCollision } from "../positioning-engine/semantic-collision";
import { evaluateClaimSemanticEntailment } from "../shared/claim-entailment";

const SONGAI_VERIFIED_FACTS = [
  "Songai lets users create custom personalized songs from structured personal stories and memories.",
  "Users create a trial song for free and pay when gifting.",
  "Deliverables include custom song audio, cover artwork, lyric video, photo slideshow video, printable/physical song plaque, and a shareable gift page.",
];

const SONGAI_CU_SNAPSHOTS = [
  {
    id: "cu_snap_songfinch",
    competitorId: "comp_songfinch",
    competitorName: "Songfinch",
    competitorUnderstanding: {
      competitorId: "comp_songfinch",
      competitorName: "Songfinch",
      capabilities: [
        "Create a custom radio-quality song from your personal stories and memories",
      ],
      offers: [
        {
          offerName: "Custom Song Package",
          description: "Personalized song crafted from your memories with lyric video and physical keepsake add-ons",
          includedItems: ["Custom song MP3", "Lyric video add-on", "Photo slideshow", "Acrylic plaque"],
          pricePoint: "$199 upfront",
        },
      ],
      positioning: [
        {
          statement: "Create a custom radio-quality song from your personal stories and memories",
        },
      ],
    },
  },
  {
    id: "cu_snap_tuney",
    competitorId: "comp_tuney",
    competitorName: "Tuney",
    competitorUnderstanding: {
      competitorId: "comp_tuney",
      competitorName: "Tuney",
      capabilities: [
        "Generate custom personalized songs with free trial previews before purchasing",
      ],
      offers: [
        {
          offerName: "Free Trial Custom Song",
          description: "Listen before you buy with a free song preview trial and custom sharing page",
          includedItems: ["Free trial preview", "Custom song download", "Custom sharing page"],
        },
      ],
      positioning: [
        {
          statement: "Try for free and preview your custom song before purchasing",
        },
      ],
    },
  },
];

const SONGAI_SCOPED_PAINS = [
  {
    painId: "pain_comp_1",
    canonical: "Customer reported receiving a generic-sounding song that missed specific personal details [ev_trustpilot_sf_101]",
    subjectScope: "COMPETITOR_SPECIFIC",
    competitorNames: ["Songfinch"],
    evidenceIds: ["ev_trustpilot_sf_101"],
  },
];

const INITIAL_COLLISION_META = {
  comparisonStatus: "COMPARISON_COMPLETED" as const,
  semanticCollisionScore: 0.65,
  collisionMeaning:
    "High model-estimated semantic overlap — competitor advances a closely related positioning claim; requires evidence-backed distinction or shared-capability strategic emphasis",
  competitorEquivalentClaim: "Create a custom radio-quality song from your personal stories and memories",
  competitorSource: "Songfinch",
  competitorId: "comp_songfinch",
  jaccardScore: 0.42,
  perCompetitor: [
    {
      source: "Songfinch",
      competitorId: "comp_songfinch",
      claim: "Create a custom radio-quality song from your personal stories and memories",
      score: 0.65,
      evidenceSource: "cu_snapshot:cu_snap_songfinch",
    },
  ],
  comparedCompetitorCount: 2,
  directCompetitorCount: 2,
  adjacentCompetitorCount: 0,
  referenceCompetitorCount: 0,
  comparisonCoverage: "ADEQUATE" as const,
  reasoningSteps: [],
  modelUsed: "gpt-4.1-mini",
  generatedAt: new Date().toISOString(),
};

function makeInitialValidatedSongaiTerritory(): any {
  return {
    id: "territory-1",
    name: "Multi-Format Keepsake Song Gifting",
    enemyDefinition:
      "Fragmented gift preparation where buyers must piece together separate audio files, cards, and presentation formats",
    contrastAxis:
      "From single-format digital song files -> To complete multi-format keepsake gift experiences with free trial creation before gifting",
    differentiationAxes: ["multi_format_keepsake_packaging", "free_trial_before_gifting"],
    narrativeDirection:
      "Emphasize turning personal memories into a complete multi-format gift package (custom song, artwork, lyric video, slideshow, plaque, and shareable gift page) where users create a trial song for free and pay when gifting.",
    rationale:
      "Rather than claiming exclusive ownership of custom storytelling (which overlaps with Songfinch and Tuney), this territory focuses strategic emphasis on Songai's verified multi-format keepsake deliverables and free-trial-before-gifting workflow.",
    epistemicStatus: "STRATEGIC_HYPOTHESIS",
    epistemicLabel: "Shared-Capability Strategic Emphasis — Grounded in Verified Product Capabilities",
    proposalStatus: "PROPOSED",
    positioningOutcomeType: "SHARED_CAPABILITY_STRATEGIC_EMPHASIS",
    comparisonStatus: "COMPARISON_COMPLETED",
    capabilityRefs: ["cap_1", "cap_2", "cap_3"],
    semanticCollision: { ...INITIAL_COLLISION_META },
  };
}

describe("Positioning Collision-Revision Validation & Downstream Safeguards", () => {
  it("1. Rejects collision revision that introduces unverified competitor-process language ('mass-produced automated prompt workflows' / 'template-bound music generation services') and preserves accepted territory", async () => {
    const compCtx = buildCompactCompetitorComparisonContext({
      cuSnapshots: SONGAI_CU_SNAPSHOTS,
      initialCollision: INITIAL_COLLISION_META,
      positioningPains: SONGAI_SCOPED_PAINS,
    });

    const initialTerritory = makeInitialValidatedSongaiTerritory();
    const defectiveRevision = {
      name: "Bespoke Narrative Songcraft vs Automated Templates",
      enemyDefinition:
        "Mass-produced automated prompt workflows and template-bound music generation services that produce generic, formulaic tracks",
      contrastAxis:
        "From mass-produced automated prompt workflows -> To bespoke story-driven song creation",
      narrativeDirection:
        "Contrast Songai against template-bound music generation services that produce generic, formulaic tracks that lack unique personal touches.",
      revisionRationale:
        "Positions against mass-produced automated prompt workflows to escape overlap.",
    };

    const selection = await evaluateAndSelectCollisionRevision({
      initialTerritory,
      initialCollision: INITIAL_COLLISION_META,
      proposedRevisionRaw: defectiveRevision,
      verifiedCapabilities: SONGAI_VERIFIED_FACTS,
      approvedPains: SONGAI_SCOPED_PAINS,
      competitorComparison: compCtx,
      competitorClaimList: [],
      evidenceSnapshotId: "bu_snap_songai_1",
      runJudge: false,
    });

    expect(selection.selected).toBe("INITIAL");
    expect(selection.territory.name).toBe("Multi-Format Keepsake Song Gifting");
    expect(selection.territory.enemyDefinition).not.toContain("mass-produced automated prompt workflows");
    expect(
      selection.validation.violations.some((r) =>
        /UNVERIFIED_COMPETITOR_INTERNAL_WORKFLOW|unverified_competitor_internal_workflow/i.test(r)
      )
    ).toBe(true);
  });

  it("2. Rejects collision revision that converts conditional payment trigger ('create a trial song for free and pay when gifting') into 'customers pay only when satisfied'", async () => {
    const compCtx = buildCompactCompetitorComparisonContext({
      cuSnapshots: SONGAI_CU_SNAPSHOTS,
      initialCollision: INITIAL_COLLISION_META,
      positioningPains: SONGAI_SCOPED_PAINS,
    });

    const satisfactionPaymentRevision = {
      name: "Risk-Free Satisfaction Song Gifting",
      enemyDefinition: "Upfront-payment custom song services",
      contrastAxis: "From upfront payment risk -> To risk-free trial song creation where customers pay only when satisfied",
      narrativeDirection:
        "Offer risk-free trial song creation where customers pay only when satisfied with the final track.",
      rationale: "Eliminates buyer hesitation by letting customers pay only when satisfied.",
    };

    const validation = await validatePositioningCandidate({
      candidate: satisfactionPaymentRevision,
      verifiedCapabilities: SONGAI_VERIFIED_FACTS,
      competitorComparison: compCtx,
      evidenceSnapshotId: "bu_snap_songai_1",
      runJudge: false,
    });

    expect(validation.passed).toBe(false);
    expect(
      validation.violations.some((v) =>
        /UNSUPPORTED_SATISFACTION_PAYMENT_GUARANTEE|satisfaction_contingent_payment/i.test(v)
      )
    ).toBe(true);
  });

  it("3. Rejects collision revision that claims 'blind-purchase custom song services with isolated audio tracks' when competitors offer free trials/previews or visual add-ons", async () => {
    const compCtx = buildCompactCompetitorComparisonContext({
      cuSnapshots: SONGAI_CU_SNAPSHOTS,
      initialCollision: INITIAL_COLLISION_META,
      positioningPains: SONGAI_SCOPED_PAINS,
    });

    expect(compCtx.previewOrTrialCounterexamples.length).toBeGreaterThan(0);
    expect(compCtx.multiFormatDeliverableCounterexamples.length).toBeGreaterThan(0);

    const blindPurchaseRevision = {
      name: "Complete Keepsake vs Blind-Purchase Audio",
      enemyDefinition: "Blind-purchase custom song services with isolated audio tracks",
      contrastAxis:
        "From blind-purchase custom song services with isolated audio tracks -> To preview-first multi-format keepsakes",
      narrativeDirection:
        "Replace blind-purchase custom song services with isolated audio tracks by offering a free trial song before gifting.",
      rationale: "Contrasts against blind-purchase custom song services with isolated audio tracks.",
    };

    const validation = await validatePositioningCandidate({
      candidate: blindPurchaseRevision,
      verifiedCapabilities: SONGAI_VERIFIED_FACTS,
      competitorComparison: compCtx,
      evidenceSnapshotId: "bu_snap_songai_1",
      runJudge: false,
    });

    expect(validation.passed).toBe(false);
    expect(
      validation.violations.some((v) =>
        /CONTRADICTS_COMPETITOR_PREVIEW_EVIDENCE|CONTRADICTS_COMPETITOR_DELIVERABLE_EVIDENCE|market_wide_blind_purchase_isolated_audio/i.test(
          v
        )
      )
    ).toBe(true);
  });

  it("4. Retains initial validated candidate when collision revision increases or fails to reduce collision score (e.g., 0.65 -> 0.85)", async () => {
    const compCtx = buildCompactCompetitorComparisonContext({
      cuSnapshots: SONGAI_CU_SNAPSHOTS,
      initialCollision: INITIAL_COLLISION_META,
      positioningPains: SONGAI_SCOPED_PAINS,
    });

    const initialTerritory = makeInitialValidatedSongaiTerritory();
    const factuallyCleanButWorseCollisionRevision = {
      name: "Personal Story Custom Gifting",
      enemyDefinition: "Single-format digital gifts that lack keepsake presentation options",
      contrastAxis:
        "From standalone digital audio files -> To custom songs created from personal stories with free trial creation before gifting",
      narrativeDirection:
        "Create custom personalized songs from personal stories where users create a trial song for free and pay when gifting.",
      revisionRationale:
        "Focuses on personal story custom song creation with free trial creation before gifting and multi-format keepsake options.",
    };

    const selection = await evaluateAndSelectCollisionRevision({
      initialTerritory,
      initialCollision: INITIAL_COLLISION_META,
      proposedRevisionRaw: factuallyCleanButWorseCollisionRevision,
      verifiedCapabilities: SONGAI_VERIFIED_FACTS,
      approvedPains: SONGAI_SCOPED_PAINS,
      competitorComparison: compCtx,
      competitorClaimList: [],
      evidenceSnapshotId: "bu_snap_songai_1",
      runJudge: false,
      recheckCollisionFn: async () => ({
        ...INITIAL_COLLISION_META,
        semanticCollisionScore: 0.85,
      }),
    });

    expect(selection.selected).toBe("INITIAL");
    expect(selection.selectionReason).toBe("RETENTION_REVISION_COLLISION_NOT_IMPROVED");
    expect(selection.territory.name).toBe("Multi-Format Keepsake Song Gifting");
    expect(selection.territory.positioningOutcomeType).toBe("SHARED_CAPABILITY_STRATEGIC_EMPHASIS");
  });

  it("5. Accepts a shared-capability candidate (SHARED_CAPABILITY_STRATEGIC_EMPHASIS) with honest rationale when exclusive whitespace is not supported", async () => {
    const compCtx = buildCompactCompetitorComparisonContext({
      cuSnapshots: SONGAI_CU_SNAPSHOTS,
      initialCollision: INITIAL_COLLISION_META,
      positioningPains: SONGAI_SCOPED_PAINS,
    });

    const candidate = makeInitialValidatedSongaiTerritory();
    const validation = await validatePositioningCandidate({
      candidate,
      verifiedCapabilities: SONGAI_VERIFIED_FACTS,
      competitorComparison: compCtx,
      evidenceSnapshotId: "bu_snap_songai_1",
      runJudge: false,
    });

    expect(validation.passed).toBe(true);
    expect(validation.violations).toHaveLength(0);
    expect(candidate.positioningOutcomeType).toBe("SHARED_CAPABILITY_STRATEGIC_EMPHASIS");

    const collisionMeaning = interpretSemanticCollision(0.65);
    expect(collisionMeaning).toContain("model-estimated");
    expect(collisionMeaning).not.toContain("Competitor owns this territory");
  });

  it("6. Preserves a customer complaint about a named competitor ('generic song', COMPETITOR_SPECIFIC) as a scoped signal without allowing unattributed industry process claims", async () => {
    const compCtx = buildCompactCompetitorComparisonContext({
      cuSnapshots: SONGAI_CU_SNAPSHOTS,
      initialCollision: INITIAL_COLLISION_META,
      positioningPains: SONGAI_SCOPED_PAINS,
    });

    expect(compCtx.promptBlock).toContain("COMPETITOR_SPECIFIC");
    expect(compCtx.promptBlock).toContain("ev_trustpilot_sf_101");

    const properlyScopedCandidate = {
      ...makeInitialValidatedSongaiTerritory(),
      rationale:
        "Addresses customer-reported concerns on Songfinch (ev_trustpilot_sf_101) about songs feeling generic by letting buyers create a trial song for free and pay when gifting.",
    };

    const validRes = await validatePositioningCandidate({
      candidate: properlyScopedCandidate,
      verifiedCapabilities: SONGAI_VERIFIED_FACTS,
      competitorComparison: compCtx,
      evidenceSnapshotId: "bu_snap_songai_1",
      runJudge: false,
    });
    expect(validRes.passed).toBe(true);
  });

  it("7. Accepts a genuine evidence-backed contrast against a specified alternative that reduces collision score", async () => {
    const genericFacts = [
      "Acme Analytics provides self-serve SQL warehouse native connectors with transparent per-seat pricing at $49/month.",
      "No annual contract lock-in; customers can cancel monthly.",
    ];
    const genericCollision = {
      ...INITIAL_COLLISION_META,
      semanticCollisionScore: 0.62,
      competitorSource: "LegacyBI",
      competitorEquivalentClaim: "Enterprise business intelligence dashboards for data teams",
    };
    const genericCompCtx = buildCompactCompetitorComparisonContext({
      cuSnapshots: [
        {
          id: "cu_legacybi",
          competitorId: "comp_legacybi",
          competitorName: "LegacyBI",
          competitorUnderstanding: {
            competitorId: "comp_legacybi",
            competitorName: "LegacyBI",
            capabilities: ["Enterprise business intelligence dashboards for data teams"],
            offers: [{ offerName: "Enterprise Suite", description: "Annual enterprise license required" }],
          },
        },
      ],
      initialCollision: genericCollision,
      positioningPains: [],
    });

    const initialGeneric: any = {
      id: "territory-acme-1",
      name: "Modern Data Team Dashboards",
      enemyDefinition: "Complex enterprise reporting suites requiring multi-month setup",
      contrastAxis: "From multi-month BI deployments -> To self-serve warehouse-native analytics",
      narrativeDirection: "Deliver warehouse-native SQL analytics for data teams.",
      rationale: "Initial territory focused on warehouse-native analytics.",
      semanticCollision: { ...genericCollision },
    };

    const improvedGenericRevision = {
      name: "Monthly Self-Serve Warehouse Analytics vs Annual Contract BI",
      enemyDefinition: "Enterprise BI suites like LegacyBI that require annual contract lock-in and mandatory onboarding",
      contrastAxis: "From annual contract lock-in -> To $49/month self-serve SQL warehouse connectors with monthly cancellation",
      narrativeDirection:
        "Contrast Acme Analytics' transparent $49/month per-seat pricing and monthly cancellation against LegacyBI's annual contract model.",
      revisionRationale:
        "Shifts the contrast from generic BI dashboards to Acme's verified monthly no-lock-in pricing model versus LegacyBI's documented annual contract requirement.",
    };

    const selection = await evaluateAndSelectCollisionRevision({
      initialTerritory: initialGeneric,
      initialCollision: genericCollision,
      proposedRevisionRaw: improvedGenericRevision,
      verifiedCapabilities: genericFacts,
      competitorComparison: genericCompCtx,
      competitorClaimList: [],
      evidenceSnapshotId: "bu_snap_acme_1",
      runJudge: false,
      recheckCollisionFn: async () => ({
        ...genericCollision,
        semanticCollisionScore: 0.24,
      }),
    });

    expect(selection.selected).toBe("REVISION");
    expect(selection.territory.name).toBe(improvedGenericRevision.name);
    expect((selection.territory as any).validationMetadata?.candidateHash).toBe(
      computePositioningCandidateHash(selection.territory)
    );
  });

  it("8. Rejects candidate when rationale equals contrastAxis or narrativeDirection", async () => {
    const compCtx = buildCompactCompetitorComparisonContext({
      cuSnapshots: SONGAI_CU_SNAPSHOTS,
      initialCollision: INITIAL_COLLISION_META,
      positioningPains: [],
    });

    const base = makeInitialValidatedSongaiTerritory();
    const duplicateRationaleCandidate = {
      ...base,
      rationale: base.contrastAxis,
    };

    const res1 = await validatePositioningCandidate({
      candidate: duplicateRationaleCandidate,
      verifiedCapabilities: SONGAI_VERIFIED_FACTS,
      competitorComparison: compCtx,
      evidenceSnapshotId: "bu_snap_songai_1",
      runJudge: false,
    });
    expect(res1.passed).toBe(false);
    expect(res1.violations.some((v) => /DUPLICATE_RATIONALE_VIOLATION|rationale must explain why/i.test(v))).toBe(true);

    const duplicateNarrativeCandidate = {
      ...base,
      rationale: base.narrativeDirection,
    };

    const res2 = await validatePositioningCandidate({
      candidate: duplicateNarrativeCandidate,
      verifiedCapabilities: SONGAI_VERIFIED_FACTS,
      competitorComparison: compCtx,
      evidenceSnapshotId: "bu_snap_songai_1",
      runJudge: false,
    });
    expect(res2.passed).toBe(false);
  });

  it("9. Invalidates validation metadata hash if candidate text is mutated after validation", async () => {
    const compCtx = buildCompactCompetitorComparisonContext({
      cuSnapshots: SONGAI_CU_SNAPSHOTS,
      initialCollision: INITIAL_COLLISION_META,
      positioningPains: [],
    });

    const candidate = makeInitialValidatedSongaiTerritory();
    const validation = await validatePositioningCandidate({
      candidate,
      verifiedCapabilities: SONGAI_VERIFIED_FACTS,
      competitorComparison: compCtx,
      evidenceSnapshotId: "bu_snap_songai_1",
      runJudge: false,
    });
    expect(validation.passed).toBe(true);

    const mutatedCandidate = {
      ...candidate,
      narrativeDirection:
        "Users enjoy risk-free trial song creation and pay only when satisfied with the final song.",
      validationMetadata: {
        candidateHash: validation.candidateHash,
        evidenceSnapshotId: validation.evidenceSnapshotId,
        validatedAt: validation.validatedAt,
      },
    };

    const currentHash = computePositioningCandidateHash(mutatedCandidate);
    expect(currentHash).not.toBe(mutatedCandidate.validationMetadata.candidateHash);
  });

  it("10. Downstream semantic entailment guard catches unsupported rewrites introduced after Positioning", () => {
    const downstreamRewrite =
      "Songai replaces blind-purchase custom song services with isolated audio tracks and mass-produced automated prompt workflows by offering risk-free trial song creation where customers pay only when satisfied.";

    const entailment = evaluateClaimSemanticEntailment(downstreamRewrite, SONGAI_VERIFIED_FACTS);
    expect(entailment.entailed).toBe(false);
    expect(entailment.violations).toContain("satisfaction_contingent_payment");
    expect(entailment.violations).toContain("unverified_competitor_internal_workflow");
    expect(entailment.violations).toContain("market_wide_blind_purchase_isolated_audio");
  });
});
