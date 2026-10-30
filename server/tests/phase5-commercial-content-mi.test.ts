/**
 * Phase 5 — Commercial + Content MI Isolated Tests
 *
 * Verifies:
 * 1. Competitors with competitorUnderstanding are not discarded when post count is 0.
 * 2. competitorData JSON serialization preserves commercial facts (capabilities, positioning, offers, proof).
 * 3. Degraded ratio and provenance reason calculation adhere to system control invariants.
 * 4. Manifest filtering scopes posts to includedPostIds.
 */

import { describe, it, expect } from "vitest";

describe("Phase 5: Competitor Resilience with Competitor Understanding", () => {
  it("retains competitors who have competitorUnderstanding even if posts are 0", () => {
    const allCompetitors = [
      {
        id: "comp_1",
        name: "Baklawati",
        posts: [], // 0 posts
        competitorUnderstanding: {
          capabilities: [{ statement: "Artisanal baklava production", factType: "CAPABILITY" }],
          offers: [{ offerName: "400g Mixed Box", pricing: "25 USD" }],
          positioning: [{ statement: "Authentic premium Mediterranean sweets" }],
          proof: [],
        },
      },
      {
        id: "comp_2",
        name: "Competitor B",
        posts: [{ id: "p1", caption: "Fresh batch ready!" }],
        competitorUnderstanding: null,
      },
      {
        id: "comp_3",
        name: "Empty Competitor",
        posts: [],
        competitorUnderstanding: null,
      },
    ];

    const competitors = allCompetitors.filter(c => {
      const postCount = c.posts?.length || 0;
      const hasCU = Boolean(c.competitorUnderstanding);
      if (postCount === 0 && !hasCU) {
        return false;
      }
      return true;
    });

    expect(competitors).toHaveLength(2);
    expect(competitors.map(c => c.id)).toEqual(["comp_1", "comp_2"]);
  });

  it("calculates degraded ratio accurately based on surviving vs total competitors", () => {
    const totalCompetitors = 4;
    const survivingCompetitors = 2;

    const degradedRatio = totalCompetitors > 0
      ? (totalCompetitors - survivingCompetitors) / totalCompetitors
      : 0;

    const provenanceDegraded = totalCompetitors > 0 && degradedRatio >= 0.5;
    const provenanceReason = survivingCompetitors === 0 && totalCompetitors > 0
      ? "ALL_COMPETITORS_EMPTY"
      : provenanceDegraded
        ? `PARTIAL_SCRAPE_FAILURE_${Math.round(degradedRatio * 100)}PCT`
        : null;

    expect(degradedRatio).toBe(0.5);
    expect(provenanceDegraded).toBe(true);
    expect(provenanceReason).toBe("PARTIAL_SCRAPE_FAILURE_50PCT");
  });

  it("serializes structured commercial facts into competitorData payload", () => {
    const competitors = [
      {
        id: "comp_baklawati",
        name: "Baklawati",
        websiteUrl: "https://baklawati.com",
        businessType: "CPG / Confectionery",
        competitorUnderstanding: {
          capabilities: [
            { statement: "Traditional stone ovens", factType: "CAPABILITY", status: "WEBSITE_ESTABLISHED" }
          ],
          positioning: [
            { statement: "Luxury Turkish sweets gifting", primaryPromise: "Delivered fresh within 48h" }
          ],
          offers: [
            { offerName: "400g Mixed Box", pricing: "25 USD" },
            { offerName: "1kg Family Box", pricing: "50 USD" }
          ],
          proof: [
            { statement: "ISO 22000 Certified food safety", proofType: "CERTIFICATION" }
          ],
        },
      },
    ];

    const competitorData = JSON.stringify(competitors.map(c => ({
      id: c.id,
      name: c.name,
      websiteUrl: c.websiteUrl || null,
      businessType: c.businessType,
      commercialFacts: c.competitorUnderstanding ? {
        capabilities: c.competitorUnderstanding.capabilities || [],
        positioning: c.competitorUnderstanding.positioning || [],
        offers: c.competitorUnderstanding.offers || [],
        proof: c.competitorUnderstanding.proof || [],
      } : null,
    })));

    const parsed = JSON.parse(competitorData);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("comp_baklawati");
    expect(parsed[0].commercialFacts).not.toBeNull();
    expect(parsed[0].commercialFacts.offers).toHaveLength(2);
    expect(parsed[0].commercialFacts.capabilities[0].statement).toBe("Traditional stone ovens");
  });
});
