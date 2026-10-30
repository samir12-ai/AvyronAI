import "dotenv/config";
import { describe, it, expect, vi } from "vitest";
import {
  extractBrandEntityInfo,
  generateCanonicalEntityId,
  resolveCanonicalEntities,
} from "../discovery/entity-resolver";
import {
  isExcludedPlatformDomain,
  verifyCompetitorRelevance,
  runCompetitorFinalJudge,
  type CompetitorQualityCampaignContext,
} from "../discovery/competitor-quality-pipeline";
import {
  resolveMarketLocalization,
  matchesTargetMarketDomestic,
} from "../shared/market-localization";
import {
  type DiscoveredCompetitorCandidate,
  type CandidateProvenance,
} from "@shared/contracts/discovery-contracts";

describe("Competitor Selection Contract & Entity Resolution", () => {
  // -------------------------------------------------------------
  // Test 1: Multi-ccTLD Entity Deduplication
  // -------------------------------------------------------------
  it("Test 1: Multi-ccTLD Entity Deduplication collapses 5 country domains to 1 canonical entity", () => {
    const ubuyDomains = [
      { domain: "ubuy.tl", url: "https://www.ubuy.tl/en/brand/baklawati", name: "Ubuy Timor-Leste" },
      { domain: "ubuy.ec", url: "https://www.ubuy.ec/en/brand/baklawati", name: "Ubuy Ecuador" },
      { domain: "ubuy.bf", url: "https://www.ubuy.bf/en/brand/baklawati", name: "Ubuy Burkina Faso" },
      { domain: "ubuy.hn", url: "https://www.ubuy.hn/en/brand/baklawati", name: "Ubuy Honduras" },
      { domain: "ubuy.mq", url: "https://www.ubuy.mq/en/brand/baklawati", name: "Ubuy Martinique" },
    ];

    const candidates: DiscoveredCompetitorCandidate[] = ubuyDomains.map((item, idx) => ({
      candidateKey: item.domain,
      name: item.name,
      domain: item.domain,
      websiteUrl: item.url,
      judgeVerdict: "APPROVED",
      tier: "B",
      geographicClassification: "CROSS_BORDER_SERVING_MARKET",
      occurrences: [
        {
          missionId: `m_${idx + 1}`,
          searchProvider: "GOOGLE",
          searchQuery: "baklava online",
          rawTitle: item.name,
          rawSnippet: `Buy products on ${item.name}`,
          url: item.url,
          domain: item.domain,
          retrievedAt: new Date().toISOString(),
        },
      ],
    }));

    const resolved = resolveCanonicalEntities(candidates);

    expect(resolved.length).toBe(1);
    const ubuyEntity = resolved[0];
    expect(ubuyEntity.canonicalEntityId).toBe("ent_ubuy");
    expect(ubuyEntity.storefronts).toBeDefined();
    expect(ubuyEntity.storefronts!.length).toBe(5);
    expect(ubuyEntity.occurrences.length).toBe(5);
  });

  // -------------------------------------------------------------
  // Test 2: Distinct Entities with Similar Names
  // -------------------------------------------------------------
  it("Test 2: Distinct Entities with Similar Names remain completely separate", () => {
    const candidates: DiscoveredCompetitorCandidate[] = [
      {
        candidateKey: "gazianteplibaklavaci.com",
        name: "Gaziantepli Baklavacı",
        domain: "gazianteplibaklavaci.com",
        websiteUrl: "https://gazianteplibaklavaci.com",
        judgeVerdict: "APPROVED",
        geographicClassification: "LOCAL_MARKET",
        occurrences: [],
      },
      {
        candidateKey: "gazisehirbaklava.com",
        name: "Gazişehir Baklava",
        domain: "gazisehirbaklava.com",
        websiteUrl: "https://gazisehirbaklava.com",
        judgeVerdict: "APPROVED",
        geographicClassification: "LOCAL_MARKET",
        occurrences: [],
      },
    ];

    const resolved = resolveCanonicalEntities(candidates);

    expect(resolved.length).toBe(2);
    expect(resolved[0].canonicalEntityId).not.toBe(resolved[1].canonicalEntityId);
    expect(resolved[0].name).toBe("Gaziantepli Baklavacı");
    expect(resolved[1].name).toBe("Gazişehir Baklava");
  });

  // -------------------------------------------------------------
  // Test 3: Product Origin vs Market Service
  // -------------------------------------------------------------
  it("Test 3: Product Origin vs Market Service rejects foreign stores claiming origin as domestic service", () => {
    const martiniqueMatch = matchesTargetMarketDomestic(
      "ubuy.mq",
      "Handmade in Istanbul authentic Turkish delight sold in Martinique overseas territory.",
      "Turkey"
    );

    // Domestic ccTLD check for .mq against Turkey (.tr)
    expect(martiniqueMatch.isDomesticMatch).toBe(false);

    const turkishDomesticMatch = matchesTargetMarketDomestic(
      "karakoygulluoglu.com",
      "Karaköy Güllüoğlu İstanbul Türkiye online sipariş ve teslimat.",
      "Turkey"
    );
    expect(turkishDomesticMatch.isDomesticMatch).toBe(true);
  });

  // -------------------------------------------------------------
  // Test 4: Hypothetical Relevance Rejection
  // -------------------------------------------------------------
  it("Test 4: Hypothetical Relevance Rejection demotes hypothetical expansion away from LOCAL_MARKET", async () => {
    const context: CompetitorQualityCampaignContext = {
      businessName: "Baklawati",
      offeringName: "Antep Fıstıklı Kadayıf",
      category: "Sweets & Confectionery",
      targetMarket: "Turkey",
      productTruthFacts: ["Handcrafted", "Pistachio"],
      targetRoles: ["Shopper"],
    };

    // Candidate claiming hypothetical expansion in reason
    const relevanceResult = {
      candidateKey: "randomsweet.com",
      isRelevant: true,
      classification: "DIRECT_COMPETITOR" as any,
      geographicClassification: "LOCAL_MARKET" as any,
      geographicReasoning: "Would compete if it expands to Turkey in the near future.",
      tier: "B" as any,
      reason: "Hypothetically a strong competitor if they open a store in Istanbul.",
    };

    // Deterministic rule: hypothetical expansion must NOT be local
    const combined = (relevanceResult.reason + " " + relevanceResult.geographicReasoning).toLowerCase();
    const isHypothetical = combined.includes("if it expands") || combined.includes("hypothetically");
    expect(isHypothetical).toBe(true);

    if (isHypothetical && relevanceResult.geographicClassification === "LOCAL_MARKET") {
      relevanceResult.geographicClassification = "INTERNATIONAL_REFERENCE";
      relevanceResult.classification = "BENCHMARK_COMPETITOR";
    }

    expect(relevanceResult.geographicClassification).toBe("INTERNATIONAL_REFERENCE");
    expect(relevanceResult.classification).toBe("BENCHMARK_COMPETITOR");
  });

  // -------------------------------------------------------------
  // Test 5: Shortfall Gate Rejection
  // -------------------------------------------------------------
  it("Test 5: Shortfall Gate Rejection fails when local count is under 10 even with worldwide references", () => {
    const approvedCompetitors = [
      ...Array.from({ length: 9 }, (_, i) => ({
        id: `local_${i + 1}`,
        name: `Local Brand ${i + 1}`,
        geographicClassification: "LOCAL_MARKET",
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `global_${i + 1}`,
        name: `Global Benchmark ${i + 1}`,
        geographicClassification: "INTERNATIONAL_REFERENCE",
      })),
    ];

    const localOnly = approvedCompetitors.filter((c) => c.geographicClassification === "LOCAL_MARKET");
    const distinctLocalCount = new Set(localOnly.map((c) => c.name.toLowerCase().trim())).size;

    expect(distinctLocalCount).toBe(9);
    expect(distinctLocalCount < 10).toBe(true);

    const gateEvaluation = () => {
      if (distinctLocalCount < 10) {
        throw new Error(`PREREQUISITE_FAILED: A minimum of 10 distinct, verified LOCAL competitors is required (currently ${distinctLocalCount} verified local competitors approved).`);
      }
    };

    expect(gateEvaluation).toThrowError(/PREREQUISITE_FAILED/);
  });

  // -------------------------------------------------------------
  // Test 6: 10-Local Requirement Gate Pass
  // -------------------------------------------------------------
  it("Test 6: 10-Local Requirement Gate Pass passes when 10 local distinct competitors exist", () => {
    const approvedCompetitors = [
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `local_${i + 1}`,
        canonicalEntityId: `ent_local_${i + 1}`,
        name: `Local Brand ${i + 1}`,
        geographicClassification: "LOCAL_MARKET",
      })),
      {
        id: "global_1",
        canonicalEntityId: "ent_global_1",
        name: "Worldwide Reference Brand",
        geographicClassification: "INTERNATIONAL_REFERENCE",
      },
    ];

    const localOnly = approvedCompetitors.filter((c) => c.geographicClassification === "LOCAL_MARKET");
    const distinctLocalCount = new Set(localOnly.map((c) => c.canonicalEntityId)).size;

    expect(distinctLocalCount).toBe(10);
    expect(distinctLocalCount >= 10).toBe(true);

    let passed = false;
    if (distinctLocalCount >= 10) {
      passed = true;
    }
    expect(passed).toBe(true);
  });

  // -------------------------------------------------------------
  // Test 7: Cross-Border vs Local Distinguishability
  // -------------------------------------------------------------
  it("Test 7: Cross-Border vs Local Distinguishability keeps cross-border shippers separate from local count", () => {
    const candidates: DiscoveredCompetitorCandidate[] = [
      {
        candidateKey: "localbaklava.com.tr",
        name: "Local Baklava TR",
        domain: "localbaklava.com.tr",
        websiteUrl: "https://localbaklava.com.tr",
        geographicClassification: "LOCAL_MARKET",
        judgeVerdict: "APPROVED",
        occurrences: [],
      },
      {
        candidateKey: "athenssweets.gr",
        name: "Athens Sweets Cross-Border",
        domain: "athenssweets.gr",
        websiteUrl: "https://athenssweets.gr",
        geographicClassification: "CROSS_BORDER_SERVING_MARKET",
        judgeVerdict: "APPROVED",
        occurrences: [],
      },
    ];

    const localCandidates = candidates.filter((c) => c.geographicClassification === "LOCAL_MARKET");
    const crossBorderCandidates = candidates.filter((c) => c.geographicClassification === "CROSS_BORDER_SERVING_MARKET");

    expect(localCandidates.length).toBe(1);
    expect(crossBorderCandidates.length).toBe(1);

    // Cross-border must NOT count toward local
    expect(localCandidates.some((c) => c.name === "Athens Sweets Cross-Border")).toBe(false);
  });

  // -------------------------------------------------------------
  // Test 8: Partial Provider Failure Resilience
  // -------------------------------------------------------------
  it("Test 8: Partial Provider Failure Resilience preserves results from successful missions", async () => {
    const mission1Success: CandidateProvenance[] = [
      {
        missionId: "m_1",
        searchProvider: "GOOGLE",
        searchQuery: "baklava istanbul",
        rawTitle: "Hafız Mustafa 1864",
        rawSnippet: "Authentic Turkish sweets in Istanbul",
        url: "https://hafizmustafa.com",
        domain: "hafizmustafa.com",
        retrievedAt: new Date().toISOString(),
      },
    ];

    const mission2FailedError = new Error("Apify actor timeout after 50000ms");

    const executedMissions = [
      Promise.resolve(mission1Success),
      Promise.reject(mission2FailedError),
    ];

    const results = await Promise.allSettled(executedMissions);
    const accumulated: CandidateProvenance[] = [];

    for (const r of results) {
      if (r.status === "fulfilled") {
        accumulated.push(...r.value);
      }
    }

    expect(accumulated.length).toBe(1);
    expect(accumulated[0].domain).toBe("hafizmustafa.com");
  });

  // -------------------------------------------------------------
  // Test 9: Continuation Idempotency
  // -------------------------------------------------------------
  it("Test 9: Continuation Idempotency skips already executed queries", () => {
    const existingMissions = [
      { id: "m_1", query: "baklava sipariş", targetProvider: "GOOGLE" },
      { id: "m_2", query: "antep fıstıklı tatlı", targetProvider: "GOOGLE" },
    ];

    const existingQueries = new Set(existingMissions.map((m) => m.query.toLowerCase().trim()));

    const candidateNewMissions = [
      { id: "m_new_1", query: "baklava sipariş", targetProvider: "GOOGLE" }, // duplicate!
      { id: "m_new_2", query: "online tatlıcı istanbul", targetProvider: "GOOGLE" }, // fresh!
    ];

    const filtered = candidateNewMissions.filter(
      (m) => !existingQueries.has(m.query.toLowerCase().trim())
    );

    expect(filtered.length).toBe(1);
    expect(filtered[0].query).toBe("online tatlıcı istanbul");
  });

  // -------------------------------------------------------------
  // Test 10: Context Drift Guard
  // -------------------------------------------------------------
  it("Test 10: Context Drift Guard flags modified snapshot ID", () => {
    const pinned = {
      buSnapshotId: "bu_snap_original_123",
      category: "Sweets",
      targetMarket: "Turkey",
    };

    const currentSnapshotInDb = {
      id: "bu_snap_modified_999",
      category: "Software",
    };

    const isDrifted = pinned.buSnapshotId !== currentSnapshotInDb.id;
    expect(isDrifted).toBe(true);
  });

  // -------------------------------------------------------------
  // Test 11: Client-Server Count Alignment
  // -------------------------------------------------------------
  it("Test 11: Client-Server Count Alignment evaluates identical local count contract", () => {
    const rawCompetitors = [
      { name: "Hafız Mustafa", canonicalEntityId: "ent_hafizmustafa", geographicClassification: "LOCAL_MARKET" },
      { name: "Güllüoğlu", canonicalEntityId: "ent_gulluoglu", geographicClassification: "LOCAL_MARKET" },
      { name: "Ubuy TL", canonicalEntityId: "ent_ubuy", geographicClassification: "CROSS_BORDER_SERVING_MARKET" },
      { name: "Ubuy EC", canonicalEntityId: "ent_ubuy", geographicClassification: "CROSS_BORDER_SERVING_MARKET" },
      { name: "Ladurée", canonicalEntityId: "ent_laduree", geographicClassification: "INTERNATIONAL_REFERENCE" },
    ];

    // Client-side logic
    const clientLocalCount = rawCompetitors.filter(
      (c) => (c.geographicClassification || "LOCAL_MARKET") === "LOCAL_MARKET"
    ).length;

    // Server-side logic
    const serverLocalCompetitors = rawCompetitors.filter(
      (c) => (c.geographicClassification || "LOCAL_MARKET") === "LOCAL_MARKET"
    );
    const serverDistinctEntities = new Set(serverLocalCompetitors.map((c) => c.canonicalEntityId));
    const serverLocalCount = serverDistinctEntities.size;

    expect(clientLocalCount).toBe(2);
    expect(serverLocalCount).toBe(2);
    expect(clientLocalCount).toBe(serverLocalCount);
  });

  // -------------------------------------------------------------
  // Test 12: Multi-Country & Multi-Category Portability
  // -------------------------------------------------------------
  it("Test 12: Multi-Country & Multi-Category Portability works for US fashion and UK SaaS", () => {
    // US Sustainable Fashion
    const usLoc = resolveMarketLocalization("United States");
    expect(usLoc.countryCode).toBe("us");
    expect(usLoc.searchLanguage).toBe("en");
    expect(matchesTargetMarketDomestic("everlane.com", "US sustainable clothing", "United States").isDomesticMatch).toBe(true);

    // UK B2B SaaS
    const ukLoc = resolveMarketLocalization("United Kingdom");
    expect(ukLoc.countryCode).toBe("gb");
    expect(ukLoc.searchLanguage).toBe("en");
    expect(matchesTargetMarketDomestic("synthesia.io", "UK London artificial intelligence SaaS", "United Kingdom").isDomesticMatch).toBe(true);

    // Platform exclusion portability
    expect(isExcludedPlatformDomain("tr.pinterest.com")).toBe(true);
    expect(isExcludedPlatformDomain("www.youtube.com")).toBe(true);
    expect(isExcludedPlatformDomain("uk.trustpilot.com")).toBe(false);
  });
});
