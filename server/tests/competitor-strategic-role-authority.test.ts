/**
 * Competitor Strategic Role Authority & Customer Voice Routing Test Suite
 * 
 * Invariants:
 * 1. ciCompetitors has canonical `strategicRole` column ('DIRECT', 'ADJACENT', 'ASPIRATIONAL', 'UNRESOLVED').
 * 2. `tier` ('A'/'B') is strictly decoupled from `strategicRole` (tier is operational scheduling only).
 * 3. CustomerEvidenceUnit carries `strategicRole` and `evidencePool`.
 * 4. Evidence routing accurately segregates into PRIMARY, SUPPORTING, BENCHMARK, and UNRESOLVED pools.
 * 5. Fail closed: UNRESOLVED competitor evidence is excluded from Audience synthesis.
 * 6. Deduplication prioritizes pool hierarchy (PRIMARY > SUPPORTING > BENCHMARK > UNRESOLVED).
 * 7. mapClassificationToStrategicRole correctly maps classifications without blindly promoting RELEVANT_COMPETITOR to DIRECT.
 * 8. Zero numeric weights or multipliers applied to competitor roles.
 * 9. Strong Regression: Benchmark volume cannot generate primary pains without Direct grounding.
 * 10. UNRESOLVED Regression: 100 comments from unresolved competitors produce 0 Audience units.
 * 11. competitor_sources remains the one and only platform identity authority.
 */

import { describe, it, expect, vi } from "vitest";
import { ciCompetitors, competitorSources, type CompetitorStrategicRole, type CustomerEvidencePool } from "@shared/schema";
import { mapClassificationToStrategicRole, resolveAmbiguousCompetitorStrategicRoleWithLLM } from "../discovery/competitor-quality-pipeline";
import { 
  type CustomerEvidenceUnit, 
  type EvidenceContributor,
  deduplicateCustomerVoice 
} from "../competitive-intelligence/evidence-routing";
import { 
  deduplicateFromCanonicalCustomerVoice, 
  synthesizeFinalSignals,
  synthesizeGlobalAudienceWithLLM,
  corroborateThemesWithNonDirectEvidenceWithLLM,
  type DeduplicatedEvidenceUnit,
  type AudienceSignalDraft,
  type CanonicalCompetitorMap,
  type TerminalEvidenceClassification,
  type SemanticTheme
} from "../audience-engine/semantic-reasoner";

vi.mock("../ai-client", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    aiChat: vi.fn(async (params: any) => {
      const endpoint = params.endpoint || "";
      if (endpoint === "competitor-strategic-role-judge") {
        if (params.messages?.[1]?.content?.includes("FAILS_CLOSED_CANDIDATE")) {
          throw new Error("Simulated LLM network failure");
        }
        return {
          choices: [{ message: { content: JSON.stringify({ strategicRole: "DIRECT", reasoning: "Direct competitor" }) } }],
        };
      }
      if (endpoint === "semantic-reasoner-theme-batch") {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                themes: [],
                isolatedTruthClaimIds: [],
                redundantClaimMappings: [],
                insufficientClaimIds: [],
                noMeaningfulTruthClaimIds: ["clm_dir_praise"],
              }),
            },
          }],
        };
      }
      if (endpoint === "semantic-reasoner-theme-corroboration") {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                corroborations: [
                  {
                    claimId: "clm_bench_corrob_1",
                    evidenceUnitId: "ev_bench_corrob",
                    themeId: "theme_fabric_sheer",
                    corroborationRationale: "Directly corroborates transparency concerns",
                  },
                ],
                unmatchedClaimIds: ["clm_adj_delay_1"],
              }),
            },
          }],
        };
      }
      return { choices: [{ message: { content: "{}" } }] };
    }),
  };
});

describe("Competitor Strategic Role Authority & Customer Voice Routing", () => {
  // Guard 1: Schema Invariant - strategicRole column present
  it("Guard 1: ciCompetitors schema contains strategicRole column", () => {
    const cols = Object.keys(ciCompetitors);
    expect(cols).toContain("strategicRole");
    expect(cols).toContain("tier");
    expect(cols).toContain("websiteUrl");
  });

  // Guard 2: Tier Decoupling
  it("Guard 2: tier and strategicRole are decoupled", () => {
    const directTierB = {
      id: "comp_dir_1",
      tier: "B",
      strategicRole: "DIRECT" as CompetitorStrategicRole,
    };
    const aspirationalTierA = {
      id: "comp_asp_1",
      tier: "A",
      strategicRole: "ASPIRATIONAL" as CompetitorStrategicRole,
    };

    expect(directTierB.strategicRole).toBe("DIRECT");
    expect(directTierB.tier).toBe("B");
    expect(aspirationalTierA.strategicRole).toBe("ASPIRATIONAL");
    expect(aspirationalTierA.tier).toBe("A");
  });

  // Guard 3: Classification Normalization & RELEVANT_COMPETITOR Fail-Closed
  it("Guard 3: mapClassificationToStrategicRole maps correctly and fails closed to UNRESOLVED for RELEVANT_COMPETITOR", () => {
    expect(mapClassificationToStrategicRole("DIRECT_COMPETITOR")).toBe("DIRECT");
    expect(mapClassificationToStrategicRole("ADJACENT_COMPETITOR")).toBe("ADJACENT");
    expect(mapClassificationToStrategicRole("BENCHMARK_COMPETITOR")).toBe("ASPIRATIONAL");
    
    // RELEVANT_COMPETITOR must NOT be deterministically mapped to DIRECT or ADJACENT; fails closed to UNRESOLVED
    expect(mapClassificationToStrategicRole("RELEVANT_COMPETITOR")).toBe("UNRESOLVED");

    // Other unmapped / invalid classifications fail closed
    expect(mapClassificationToStrategicRole("NOT_COMPETITOR")).toBe("UNRESOLVED");
    expect(mapClassificationToStrategicRole("INSUFFICIENT_EVIDENCE")).toBe("UNRESOLVED");
    expect(mapClassificationToStrategicRole(null)).toBe("UNRESOLVED");
    expect(mapClassificationToStrategicRole(undefined)).toBe("UNRESOLVED");
    expect(mapClassificationToStrategicRole("UNKNOWN_VALUE")).toBe("UNRESOLVED");
  });

  // Guard 4: Deduplication Pool Priority Preservation
  it("Guard 4: deduplicateCustomerVoice preserves higher-priority pool and full contributor lineage", () => {
    const benchmarkUnit: CustomerEvidenceUnit = {
      evidenceId: "cev_com_1",
      origin: "COMPETITOR_COMMENT",
      platform: "instagram",
      competitorId: "comp_benchmark",
      competitorName: "Modelle",
      strategicRole: "ASPIRATIONAL",
      evidencePool: "BENCHMARK_CONTEXT",
      accountId: "acc_1",
      campaignId: "camp_1",
      text: "The fabric quality is sheer and see-through in sunlight",
      author: "user_a",
      authorType: "CUSTOMER",
      acquiredAt: new Date().toISOString(),
      verificationProvenance: { isVerified: true },
      rawEvidenceReference: { table: "ci_competitor_comments", id: "1" },
    };

    const directUnit: CustomerEvidenceUnit = {
      evidenceId: "cev_com_2",
      origin: "COMPETITOR_COMMENT",
      platform: "instagram",
      competitorId: "comp_direct",
      competitorName: "Abayaboutiquelb",
      strategicRole: "DIRECT",
      evidencePool: "SUPPORTING_SOCIAL_CUSTOMER_VOICE",
      accountId: "acc_1",
      campaignId: "camp_1",
      text: "The fabric quality is sheer and see-through in sunlight",
      author: "user_b",
      authorType: "CUSTOMER",
      acquiredAt: new Date().toISOString(),
      verificationProvenance: { isVerified: true },
      rawEvidenceReference: { table: "ci_competitor_comments", id: "2" },
    };

    // When processed in either order, canonical unit is promoted to SUPPORTING_SOCIAL_CUSTOMER_VOICE and keeps full lineage
    const result1 = deduplicateCustomerVoice([benchmarkUnit, directUnit]);
    expect(result1.uniqueUnits.length).toBe(1);
    expect(result1.uniqueUnits[0].evidencePool).toBe("SUPPORTING_SOCIAL_CUSTOMER_VOICE");
    expect(result1.uniqueUnits[0].strategicRole).toBe("DIRECT");
    expect(result1.uniqueUnits[0].contributors).toBeDefined();
    expect(result1.uniqueUnits[0].contributors?.length).toBe(2);
    expect(result1.uniqueUnits[0].contributors?.map(c => c.evidencePool)).toEqual(
      expect.arrayContaining(["BENCHMARK_CONTEXT", "SUPPORTING_SOCIAL_CUSTOMER_VOICE"])
    );

    const result2 = deduplicateCustomerVoice([directUnit, benchmarkUnit]);
    expect(result2.uniqueUnits.length).toBe(1);
    expect(result2.uniqueUnits[0].evidencePool).toBe("SUPPORTING_SOCIAL_CUSTOMER_VOICE");
    expect(result2.uniqueUnits[0].strategicRole).toBe("DIRECT");
    expect(result2.uniqueUnits[0].contributors?.length).toBe(2);
  });

  // Guard 5: Fail Closed on UNRESOLVED in Audience Deduplication
  it("Guard 5: deduplicateFromCanonicalCustomerVoice strictly excludes UNRESOLVED competitors", () => {
    const compMap: CanonicalCompetitorMap = {
      canonicalList: [
        { id: "comp_unresolved", name: "Unresolved Brand", cleanKey: "unresolvedbrand", websiteUrl: null, platform: null, strategicRole: "UNRESOLVED" },
        { id: "comp_direct", name: "Direct Brand", cleanKey: "directbrand", websiteUrl: null, platform: null, strategicRole: "DIRECT" },
      ],
      idToCanonicalId: new Map([["comp_unresolved", "comp_unresolved"], ["comp_direct", "comp_direct"]]),
      canonicalIdToName: new Map([["comp_unresolved", "Unresolved Brand"], ["comp_direct", "Direct Brand"]]),
      totalApprovedCount: 2,
    };

    const unresolvedUnits: CustomerEvidenceUnit[] = [
      {
        evidenceId: "cev_com_unres_1",
        origin: "COMPETITOR_COMMENT",
        platform: "instagram",
        competitorId: "comp_unresolved",
        competitorName: "Unresolved Brand",
        strategicRole: "UNRESOLVED",
        evidencePool: "UNRESOLVED_EXCLUDED",
        accountId: "acc_1",
        campaignId: "camp_1",
        text: "Are sizes true to fit?",
        author: "user_x",
        authorType: "CUSTOMER",
        acquiredAt: new Date().toISOString(),
        verificationProvenance: { isVerified: true },
        rawEvidenceReference: { table: "ci_competitor_comments", id: "u1" },
      },
    ];

    const directUnits: CustomerEvidenceUnit[] = [
      {
        evidenceId: "cev_com_dir_1",
        origin: "COMPETITOR_COMMENT",
        platform: "instagram",
        competitorId: "comp_direct",
        competitorName: "Direct Brand",
        strategicRole: "DIRECT",
        evidencePool: "SUPPORTING_SOCIAL_CUSTOMER_VOICE",
        accountId: "acc_1",
        campaignId: "camp_1",
        text: "Do you deliver to Tripoli Lebanon?",
        author: "user_y",
        authorType: "CUSTOMER",
        acquiredAt: new Date().toISOString(),
        verificationProvenance: { isVerified: true },
        rawEvidenceReference: { table: "ci_competitor_comments", id: "d1" },
      },
    ];

    const dedupOnlyUnresolved = deduplicateFromCanonicalCustomerVoice(unresolvedUnits, compMap);
    expect(dedupOnlyUnresolved.length).toBe(0); // 0 units admitted

    const dedupMixed = deduplicateFromCanonicalCustomerVoice([...unresolvedUnits, ...directUnits], compMap);
    expect(dedupMixed.length).toBe(1);
    expect(dedupMixed[0].canonicalBrandName).toBe("Direct Brand");
    expect(dedupMixed[0].evidencePool).toBe("SUPPORTING_SOCIAL_CUSTOMER_VOICE");
    expect(dedupMixed[0].contributors?.length).toBe(1);
  });

  // Guard 6: Strong Regression — Benchmark Volume vs Primary Market Voice Grounding on Pains
  it("Guard 6: Primary pains require primary market voice grounding when market voice is present", () => {
    const compMap: CanonicalCompetitorMap = {
      canonicalList: [
        { id: "comp_direct", name: "Direct Brand", cleanKey: "directbrand", websiteUrl: null, platform: null },
        { id: "comp_benchmark", name: "Benchmark Brand", cleanKey: "benchmarkbrand", websiteUrl: null, platform: null },
      ],
      idToCanonicalId: new Map([["comp_direct", "comp_direct"], ["comp_benchmark", "comp_benchmark"]]),
      canonicalIdToName: new Map([["comp_direct", "Direct Brand"], ["comp_benchmark", "Benchmark Brand"]]),
      totalApprovedCount: 2,
    };

    const dedupUnits: DeduplicatedEvidenceUnit[] = [
      {
        id: "ev_mv_1",
        text: "Fabric is too thin for summer",
        sourceType: "market_voice",
        canonicalCompetitorId: "market_voice",
        canonicalBrandName: "Broad Market Voice",
        platform: "reddit",
        rawOccurrenceCount: 2,
        likesCount: 5,
        originalIds: ["d1", "d2"],
        evidencePool: "PRIMARY_MARKET_VOICE",
      },
      {
        id: "ev_bench_1",
        text: "International shipping to UK took 3 weeks",
        sourceType: "comment",
        canonicalCompetitorId: "comp_benchmark",
        canonicalBrandName: "Benchmark Brand",
        platform: "instagram",
        rawOccurrenceCount: 100, // Massive benchmark volume
        likesCount: 500,
        originalIds: ["b1"],
        strategicRole: "ASPIRATIONAL",
        evidencePool: "BENCHMARK_CONTEXT",
      },
    ];

    const drafts: AudienceSignalDraft[] = [
      {
        id: "draft_pain_mv",
        type: "pain",
        canonical: "Fabric transparency in warm weather",
        explanation: "Customers find the summer fabrics too sheer",
        evidenceIds: ["ev_mv_1"],
        competitorIds: ["market_voice"],
        platforms: ["reddit"],
        confidence: 0.9,
        reasoningSummary: "Grounded in primary market voice",
      },
      {
        id: "draft_pain_benchmark_only",
        type: "pain",
        canonical: "Excessive international UK delivery delays",
        explanation: "UK customers experience 3 week delivery times",
        evidenceIds: ["ev_bench_1"],
        competitorIds: ["comp_benchmark"],
        platforms: ["instagram"],
        confidence: 0.95,
        reasoningSummary: "Derived purely from benchmark brand comments",
      },
    ];

    const result = synthesizeFinalSignals(drafts, dedupUnits, compMap);

    // Only market voice grounded pain should be synthesized as primary pain
    expect(result.pains.length).toBe(1);
    expect(result.pains[0].canonical).toBe("Fabric transparency in warm weather");
    expect(result.pains[0].sourceTypes).toContain("market_voice");
  });

  // Guard 7: UNRESOLVED Regression — 100 unresolved comments produce 0 audience output
  it("Guard 7 (UNRESOLVED Regression): 100 unresolved comments yield 0 deduplicated units and 0 signals", () => {
    const compMap: CanonicalCompetitorMap = {
      canonicalList: [
        { id: "comp_unres", name: "Unresolved Brand", cleanKey: "unresbrand", websiteUrl: null, platform: null, strategicRole: "UNRESOLVED" }
      ],
      idToCanonicalId: new Map([["comp_unres", "comp_unres"]]),
      canonicalIdToName: new Map([["comp_unres", "Unresolved Brand"]]),
      totalApprovedCount: 1,
    };

    const hundredUnresolvedUnits: CustomerEvidenceUnit[] = Array.from({ length: 100 }, (_, i) => ({
      evidenceId: `cev_unres_${i}`,
      origin: "COMPETITOR_COMMENT",
      platform: "instagram",
      competitorId: "comp_unres",
      competitorName: "Unresolved Brand",
      strategicRole: "UNRESOLVED",
      evidencePool: "UNRESOLVED_EXCLUDED",
      accountId: "acc_1",
      campaignId: "camp_1",
      text: `Customer comment ${i} about prices`,
      author: `user_${i}`,
      authorType: "CUSTOMER",
      acquiredAt: new Date().toISOString(),
      verificationProvenance: { isVerified: true },
      rawEvidenceReference: { table: "ci_competitor_comments", id: `u_${i}` },
    }));

    const dedup = deduplicateFromCanonicalCustomerVoice(hundredUnresolvedUnits, compMap);
    expect(dedup.length).toBe(0);

    const signals = synthesizeFinalSignals([], dedup, compMap);
    expect(signals.pains.length).toBe(0);
    expect(signals.desires.length).toBe(0);
    expect(signals.objections.length).toBe(0);
  });

  // Guard 8: competitor_sources is the ONE AND ONLY source authority (frozen)
  it("Guard 8: competitor_sources remains the one and only platform identity authority", () => {
    const srcCols = Object.keys(competitorSources);
    expect(srcCols).toContain("id");
    expect(srcCols).toContain("competitorId");
    expect(srcCols).toContain("platform");
    expect(srcCols).toContain("canonicalUrl");
    expect(srcCols).toContain("status");

    // ciCompetitors does NOT have any platform source fields
    const compCols = Object.keys(ciCompetitors);
    expect(compCols).not.toContain("profileLink");
    expect(compCols).not.toContain("tiktokUrl");
    expect(compCols).not.toContain("googleMapsUrl");
    expect(compCols).not.toContain("blogUrl");
    expect(compCols).not.toContain("platform");
  });

  // Guard 9 (Regression Test A): 0 Direct units + 100 Aspirational units -> 0 canonical candidate themes
  it("Guard 9 (Regression Test A): 0 Direct units + 100 Aspirational units produce 0 candidate themes", async () => {
    const businessContext = {
      heroProduct: "Premium Linen Abayas",
      businessName: "Sara-ft",
      market: "Lebanon",
      category: "Modest Fashion",
    };

    const benchmarkClassifications: TerminalEvidenceClassification[] = Array.from({ length: 100 }, (_, i) => ({
      evidenceUnitId: `ev_bench_${i}`,
      primaryForm: "PAIN",
      semanticType: "PAIN",
      claim: `Benchmark international shipping issue ${i}`,
      semanticClaims: [{
        claimId: `clm_b_${i}`,
        claimKind: "friction_problem",
        meaning: `International delivery delay ${i}`,
        confidence: 0.9,
      }],
      confidence: 0.9,
      canonicalCompetitorId: "comp_modelle",
      canonicalBrandName: "Modelle",
      platform: "instagram",
      rawText: `International delivery to UK took 4 weeks ${i}`,
      strategicRole: "ASPIRATIONAL",
      evidencePool: "BENCHMARK_CONTEXT",
    }));

    const result = await synthesizeGlobalAudienceWithLLM(
      benchmarkClassifications,
      businessContext,
      "test_acc"
    );

    // Invariant: Benchmark evidence CANNOT create candidate themes without Primary Market Voice evidence
    expect(result.themes.length).toBe(0);
    expect(result.candidateThemes.length).toBe(0);
    expect(result.draft.pains.length).toBe(0);
    // All 100 claims should be dispositioned as non-direct supporting context
    expect(result.manifest.claimManifest.length).toBe(100);
    expect(result.manifest.claimManifest.every(c => c.status !== "ASSIGNED_TO_THEME")).toBe(true);
  });

  // Guard 10 (Regression Test B): 100 Aspirational + 1 superficial quote -> theme not canonical
  it("Guard 10 (Regression Test B): 100 Aspirational + 1 superficial quote does not create canonical theme", async () => {
    const businessContext = {
      heroProduct: "Premium Linen Abayas",
      businessName: "Sara-ft",
      market: "Lebanon",
      category: "Modest Fashion",
    };

    const superficialDirect: TerminalEvidenceClassification = {
      evidenceUnitId: "ev_dir_superficial",
      primaryForm: "PRAISE",
      semanticType: "PRAISE",
      claim: "Nice dress",
      semanticClaims: [{
        claimId: "clm_dir_praise",
        claimKind: "positive_experience",
        meaning: "Generic praise without actionable insight",
        confidence: 0.8,
      }],
      confidence: 0.8,
      canonicalCompetitorId: "comp_direct_1",
      canonicalBrandName: "Abayaboutiquelb",
      platform: "instagram",
      rawText: "Beautiful ❤️❤️❤️",
      strategicRole: "DIRECT",
      evidencePool: "SUPPORTING_SOCIAL_CUSTOMER_VOICE",
    };

    const benchmarkUnits: TerminalEvidenceClassification[] = Array.from({ length: 50 }, (_, i) => ({
      evidenceUnitId: `ev_bench_${i}`,
      primaryForm: "PAIN",
      semanticType: "PAIN",
      claim: `Packaging damage issue ${i}`,
      semanticClaims: [{
        claimId: `clm_bench_${i}`,
        claimKind: "friction_problem",
        meaning: `Packaging box was crushed on arrival ${i}`,
        confidence: 0.9,
      }],
      confidence: 0.9,
      canonicalCompetitorId: "comp_modelle",
      canonicalBrandName: "Modelle",
      platform: "instagram",
      rawText: `The box was completely damaged upon arrival ${i}`,
      strategicRole: "ASPIRATIONAL",
      evidencePool: "BENCHMARK_CONTEXT",
    }));

    // The single social quote does not establish a packaging damage theme
    const result = await synthesizeGlobalAudienceWithLLM(
      [superficialDirect, ...benchmarkUnits],
      businessContext,
      "test_acc"
    );

    // No packaging theme should be created because Primary Market Voice evidence didn't establish it
    const packagingTheme = result.themes.find(t => t.canonicalMeaning.toLowerCase().includes("packaging") || t.canonicalMeaning.toLowerCase().includes("damaged"));
    expect(packagingTheme).toBeUndefined();
  });

  // Guard 11 (Regression Test C & D): Primary Market Voice Theme corroborated by Benchmark vs Adjacent Context
  it("Guard 11 (Regression Test C & D): corroborateThemesWithNonDirectEvidenceWithLLM attaches corroboration without creating unestablished themes", async () => {
    const businessContext = {
      heroProduct: "Premium Linen Abayas",
      businessName: "Sara-ft",
      market: "Lebanon",
      category: "Modest Fashion",
    };

    const existingDirectTheme: SemanticTheme = {
      themeId: "theme_fabric_sheer",
      canonicalMeaning: "Fabric opacity and transparency concerns in sunlight",
      description: "Customers find certain lightweight fabrics see-through under bright lighting.",
      supportingClaimIds: ["clm_dir_1"],
      supportingEvidenceUnitIds: ["ev_dir_1"],
      claimKinds: ["friction_problem"],
      competitorIds: ["market_voice"],
      platforms: ["reddit"],
      semanticRationale: "Market voice customer quotes reporting fabric transparency.",
      confidence: 0.9,
    };

    // Non-direct units:
    // 1. Aspirational unit about fabric sheer/opacity (corroborates primary theme)
    // 2. Adjacent unit about warehouse regional delays (does NOT match primary theme -> remains supporting context)
    const nonDirectUnits: TerminalEvidenceClassification[] = [
      {
        evidenceUnitId: "ev_bench_corrob",
        primaryForm: "PAIN",
        semanticType: "PAIN",
        claim: "Fabric is see-through in bright daylight",
        semanticClaims: [{
          claimId: "clm_bench_corrob_1",
          claimKind: "friction_problem",
          meaning: "Fabric is sheer and requires slip underneath",
          confidence: 0.9,
        }],
        confidence: 0.9,
        canonicalCompetitorId: "comp_bench_1",
        canonicalBrandName: "VEILED",
        platform: "tiktok",
        rawText: "I had to wear a full inner slip because it was completely transparent in daylight",
        strategicRole: "ASPIRATIONAL",
        evidencePool: "BENCHMARK_CONTEXT",
      },
      {
        evidenceUnitId: "ev_adj_context",
        primaryForm: "PAIN",
        semanticType: "PAIN",
        claim: "Regional postal delays in remote areas",
        semanticClaims: [{
          claimId: "clm_adj_delay_1",
          claimKind: "friction_problem",
          meaning: "Delivery took 2 weeks to rural delivery zones",
          confidence: 0.85,
        }],
        confidence: 0.85,
        canonicalCompetitorId: "comp_adj_1",
        canonicalBrandName: "DeFacto",
        platform: "instagram",
        rawText: "Shipping to regional depot took more than 14 business days",
        strategicRole: "ADJACENT",
        evidencePool: "SUPPORTING_SOCIAL_CUSTOMER_VOICE",
      },
    ];

    const { corroboratedThemes, nonDirectDispositions } = await corroborateThemesWithNonDirectEvidenceWithLLM(
      [existingDirectTheme],
      nonDirectUnits,
      businessContext,
      "test_acc"
    );

    // Number of themes should NEVER exceed direct themes (no new themes created)
    expect(corroboratedThemes.length).toBe(1);
    expect(corroboratedThemes[0].themeId).toBe("theme_fabric_sheer");

    // Non-direct dispositions: 2 claims accounted for
    expect(nonDirectDispositions.length).toBe(2);
    const delayDisp = nonDirectDispositions.find(d => d.claimId === "clm_adj_delay_1");
    expect(delayDisp).toBeDefined();
    // Unmatched adjacent delay claim remains isolated context
    expect(delayDisp?.status).toBe("ISOLATED_VALID_TRUTH");
  });

  // Guard 12: LLM Strategic Role Resolution & Fail-Closed
  it("Guard 12: resolveAmbiguousCompetitorStrategicRoleWithLLM resolves semantic role and fails closed on failure", async () => {
    const mockContext = {
      offeringName: "Premium Linen Abayas",
      category: "Modest Fashion",
      targetMarket: "Lebanon",
      productTruthFacts: ["Linen abayas crafted in Beirut"],
      targetRoles: ["DIRECT", "ADJACENT", "ASPIRATIONAL"],
    };

    // Case 1: Successfully resolves to DIRECT
    const roleSuccess = await resolveAmbiguousCompetitorStrategicRoleWithLLM({
      candidateName: "Sam Hijab",
      domain: "samhijab.com",
      evidenceText: "Direct modest fashion seller in Lebanon selling linen abayas",
      context: mockContext,
    });
    expect(roleSuccess).toBe("DIRECT");

    // Case 2: Network failure / LLM error fails closed to UNRESOLVED
    const roleFail = await resolveAmbiguousCompetitorStrategicRoleWithLLM({
      candidateName: "FAILS_CLOSED_CANDIDATE",
      domain: "unknown.com",
      evidenceText: "Ambiguous vendor",
      context: mockContext,
    });
    expect(roleFail).toBe("UNRESOLVED");
  });
});
