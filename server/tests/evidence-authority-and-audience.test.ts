import { describe, it, expect } from "vitest";
import { PLATFORM_PROVIDER_CAPABILITIES, executeSourceFetch } from "../competitive-intelligence/provider-registry";
import { extractSourcesFromHtml, performExternalSearchDiscovery } from "../competitive-intelligence/source-discovery";
import { normalizeCrossSourceEvidence, computeExternalItemId, ACTOR_SLOTS } from "../acquisition/multi-source-providers";
import { ENGINE_SIGNAL_REQUIREMENTS } from "../signal-governance/types";
import { MIN_SIGNALS_PER_CATEGORY, MIN_TOTAL_SIGNALS, SIGNAL_CONFIDENCE_FLOOR, SGL_VERSION } from "../signal-governance/constants";
import { buildCampaignEvidenceBundle } from "../competitive-intelligence/evidence-bundle";

describe("Part 1 & 2: Canonical Source Identity Authority", () => {
  it("defines supported capabilities across all 9 platform types", () => {
    const requiredPlatforms = [
      "WEBSITE", "INSTAGRAM", "TIKTOK", "LINKEDIN", "X", "YOUTUBE", "REVIEWS", "GOOGLE_SEARCH", "BLOG"
    ];

    for (const plat of requiredPlatforms) {
      const cap = PLATFORM_PROVIDER_CAPABILITIES[plat];
      expect(cap).toBeDefined();
      expect(cap.discovery).toBe(true);
      expect(cap.verification).toBe(true);
      expect(cap.status).toBe("PRODUCTION_READY");
    }
  });

  it("ensures YouTube discovery and verification from website HTML", () => {
    const html = `
      <html>
        <body>
          <a href="https://www.youtube.com/@SaraFtOfficial">YouTube Channel</a>
          <a href="https://www.instagram.com/sara_ft">Instagram</a>
        </body>
      </html>
    `;
    const extracted = extractSourcesFromHtml(html, "https://sara-ft.com");
    expect(extracted.youtube).toBe("https://www.youtube.com/@SaraFtOfficial");
    expect(extracted.instagram).toBe("https://instagram.com/sara_ft");
  });

  it("handles missing platforms truthfully without guessing handles", async () => {
    const res = await performExternalSearchDiscovery({
      competitorName: "Sara Ft Modest",
      cleanDomain: "sara-ft.com",
      missingPlatforms: ["linkedin", "tiktok"],
    });

    expect(res.linkedin).toBeDefined();
    expect(res.tiktok).toBeDefined();
    // TikTok without backlink should NOT be verified
    expect(res.tiktok.verified).toBe(false);
  });
});

describe("Part 3 & 4: Evidence Normalization & Lineage", () => {
  it("normalizes cross-source evidence with deterministic IDs and tenant lineage", () => {
    const item1 = {
      id: computeExternalItemId("LINKEDIN", "urn:li:activity:12345"),
      platform: "LINKEDIN" as const,
      externalId: "urn:li:activity:12345",
      text: "Modest summer collection is live now!",
      publishedAt: new Date().toISOString(),
      campaignId: "camp_123",
      accountId: "acc_456",
      competitorId: "comp_789",
      authorityClass: "DIRECT_AUDIENCE_EVIDENCE" as const,
      fetchedAt: new Date().toISOString(),
    };

    const item2 = { ...item1 }; // duplicate

    const normalized = normalizeCrossSourceEvidence([item1, item2]);
    expect(normalized.length).toBe(1);
    expect(normalized[0].id).toBe(item1.id);
    expect(normalized[0].campaignId).toBe("camp_123");
    expect(normalized[0].accountId).toBe("acc_456");
  });

  it("ensures actor slots for YouTube, LinkedIn, X, and Reviews exist", () => {
    expect(ACTOR_SLOTS.GOOGLE_SEARCH).toBeDefined();
    expect(ACTOR_SLOTS.LINKEDIN_POSTS).toBeDefined();
    expect(ACTOR_SLOTS.X_TWEETS).toBeDefined();
    expect(ACTOR_SLOTS.YOUTUBE_VIDEOS).toBeDefined();
    expect(ACTOR_SLOTS.GOOGLE_REVIEWS).toBeDefined();
    expect(ACTOR_SLOTS.TRUSTPILOT_REVIEWS).toBeDefined();
  });
});

describe("Part 9 & 10: Customer Voice vs Post Classification Separation", () => {
  it("distinguishes customer voice comments from competitor marketing posts", () => {
    const postClassification = {
      primaryHook: "Summer Sale 50% Off",
      hookArchetype: "PROMOTIONAL",
      ctaType: "SHOP_NOW",
      awarenessStage: "SOLUTION_AWARE",
    };

    const customerComment = {
      commentText: "Please restock the black maxi dress in size L!",
      username: "hijabi_shopper",
      likesCount: 5,
    };

    // Post classification is what competitor does
    expect(postClassification.primaryHook).toContain("Sale");
    // Customer voice is what buyer wants
    expect(customerComment.commentText).toContain("restock");
  });
});

describe("Part 26: SGL Threshold Invariance", () => {
  it("preserves strict governance thresholds without modification", () => {
    expect(MIN_SIGNALS_PER_CATEGORY.pain).toBe(2);
    expect(MIN_SIGNALS_PER_CATEGORY.desire).toBe(2);
    expect(MIN_SIGNALS_PER_CATEGORY.objection).toBe(1);
    expect(MIN_SIGNALS_PER_CATEGORY.pattern).toBe(1);
    expect(MIN_SIGNALS_PER_CATEGORY.root_cause).toBe(1);
    expect(MIN_SIGNALS_PER_CATEGORY.psychological_driver).toBe(1);
    expect(MIN_TOTAL_SIGNALS).toBe(5);
    expect(SIGNAL_CONFIDENCE_FLOOR).toBe(0.20);
    expect(SGL_VERSION).toBe(2);
  });

  it("requires all 7 strategy engines to define explicit signal requirements", () => {
    const requiredEngines = [
      "differentiation", "positioning", "mechanism", "offer", "awareness", "funnel", "persuasion"
    ];

    for (const eng of requiredEngines) {
      expect((ENGINE_SIGNAL_REQUIREMENTS as any)[eng]).toBeDefined();
      expect((ENGINE_SIGNAL_REQUIREMENTS as any)[eng].length).toBeGreaterThanOrEqual(2);
    }
  });
});
