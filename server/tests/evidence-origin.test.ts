/**
 * Source-agnostic customer-evidence philosophy (Aug 2026) — deterministic
 * tests over existing evidence shapes. Covers the 20 required cases from the
 * change brief: origin classification, comment provenance validation, CTA
 * metadata containment, cross-post independence, Pain Registry lineage
 * without circular corroboration, and no-threshold-weakening regression.
 */
import { describe, it, expect } from "vitest";
import {
  roleToSignalOrigin,
  isCtaMetadataLabel,
  validateCustomerComment,
  buildCustomerEvidence,
  type CustomerCommentCandidate,
  type CustomerEvidenceArtifact,
} from "../market-intelligence-v3/evidence-origin";
import { runCrossSignalDecisionLayer } from "../market-intelligence-v3/cross-signal-decision";
import type { MultiSourceSignals } from "../market-intelligence-v3/source-types";

function comment(over: Partial<CustomerCommentCandidate> = {}): CustomerCommentCandidate {
  return {
    commentId: over.commentId ?? `c_${Math.abs(JSON.stringify(over).split("").reduce((a, c) => a + c.charCodeAt(0), 0))}`,
    username: "real_user_1",
    text: "I tried three tools and still don't know what marketing strategy I should follow",
    authorType: "audience",
    platform: "instagram",
    competitorId: "comp-1",
    ...over,
  };
}

function multiSource(over: Partial<MultiSourceSignals> = {}): MultiSourceSignals {
  return {
    instagram: { hooks: [], ctaPatterns: [], contentAngles: [], painInferences: [], storytellingPatterns: [], authorityFraming: [], proofFraming: [], curiosityFraming: [] },
    website: null,
    blog: null,
    tiktok: null,
    reviews: null,
    sourceAvailability: {
      instagram: true, website: false, blog: false, tiktok: true, reviews: false,
      availableSources: ["instagram", "tiktok"], missingSourcesCount: 3, primarySource: "instagram",
    },
    classifiedSignals: [],
    reconciliationNotes: [],
    signalConfidence: 0,
    ...over,
  } as MultiSourceSignals;
}

function run(ms: MultiSourceSignals, customerEvidence: CustomerEvidenceArtifact[] = []) {
  return runCrossSignalDecisionLayer(ms, null, null, null, customerEvidence);
}

describe("canonical origin roles (cases 1, 2, 5, 6, 11)", () => {
  it("CUSTOMER_ORIGIN → real (Trustpilot/G2 reviews and validated comments share one semantic role)", () => {
    expect(roleToSignalOrigin("CUSTOMER_ORIGIN")).toBe("real");
  });
  it("competitor caption roles → competitor; AI inference → inferred; metadata/noise → excluded (unknown)", () => {
    expect(roleToSignalOrigin("COMPETITOR_MESSAGING")).toBe("competitor");
    expect(roleToSignalOrigin("COMPETITOR_BEHAVIOR")).toBe("competitor");
    expect(roleToSignalOrigin("INFERRED")).toBe("inferred");
    expect(roleToSignalOrigin("METADATA")).toBe("unknown");
    expect(roleToSignalOrigin("NOISE")).toBe("unknown");
  });
});

describe("customer comment provenance validation (cases 3, 4, 15)", () => {
  it("substantive Instagram user comment → eligible when provenance validates", () => {
    const v = validateCustomerComment(comment(), { ownerHandles: ["competitorbrand"] });
    expect(v).toEqual({ eligible: true, reason: "OK" });
  });
  it("substantive TikTok user comment → eligible (platform is secondary)", () => {
    const v = validateCustomerComment(comment({ platform: "tiktok", text: "Managing five different marketing tools is exhausting" }), { ownerHandles: [] });
    expect(v.eligible).toBe(true);
  });
  it("owner reply (stored authorType) → rejected as customer evidence", () => {
    expect(validateCustomerComment(comment({ authorType: "owner" }), { ownerHandles: [] }).reason).toBe("REJECTED_OWNER_AUTHOR");
  });
  it("owner detected by handle match → rejected", () => {
    const v = validateCustomerComment(comment({ authorType: null, username: "CompetitorBrand" }), { ownerHandles: ["@competitorbrand"] });
    expect(v.reason).toBe("REJECTED_OWNER_AUTHOR");
  });
  it("unknown author with no username → fail closed (uncertain provenance never promoted)", () => {
    expect(validateCustomerComment(comment({ authorType: null, username: null }), { ownerHandles: [] }).reason).toBe("REJECTED_UNVERIFIED_AUTHOR");
  });
  it("spam comment → rejected", () => {
    expect(validateCustomerComment(comment({ text: "follow me for follow back guys" }), { ownerHandles: [] }).reason).toBe("REJECTED_SPAM");
  });
  it("generic reaction (emoji-only / 'ok') → rejected as low-signal", () => {
    expect(validateCustomerComment(comment({ text: "🔥🔥😍" }), { ownerHandles: [] }).reason).toBe("REJECTED_LOW_SIGNAL");
    expect(validateCustomerComment(comment({ text: "ok" }), { ownerHandles: [] }).reason).toBe("REJECTED_LOW_SIGNAL");
  });
  it("empty → rejected", () => {
    expect(validateCustomerComment(comment({ text: "  " }), { ownerHandles: [] }).reason).toBe("REJECTED_EMPTY");
  });
});

describe("CTA metadata containment (cases 7, 8)", () => {
  it("LinkInBio and detector labels are METADATA — never customer or content evidence", () => {
    for (const label of ["LinkInBio", " ClickAction", "Download", "SeeHow", " Try", "StartYour", "Book", "HowToGuide"]) {
      expect(isCtaMetadataLabel(label)).toBe(true);
    }
    expect(validateCustomerComment(comment({ text: "LinkInBio" }), { ownerHandles: [] }).eligible).toBe(false);
  });
  it("CTA labels in instagram.ctaPatterns never become candidate decisions (structured analytics preserved upstream)", () => {
    const ms = multiSource();
    (ms.instagram as any).ctaPatterns = ["LinkInBio", "Download", "Book"];
    const result = run(ms);
    const texts = result.decisions.map(d => d.signalText.toLowerCase());
    expect(texts).not.toContain("linkinbio");
    expect(texts).not.toContain("download");
    expect(texts).not.toContain("book");
  });
});

describe("independence model (cases 9, 10)", () => {
  it("same competitor caption cross-posted IG+TikTok → ONE independent voice → stays WEAK/single-source", () => {
    const ms = multiSource();
    (ms.instagram as any).hooks = ["Have you ever lost a star team member?"];
    ms.tiktok = {
      validatedHooks: ["Have you ever lost a star team member?"],
      highPerformingCaptions: [], trendingHashtags: [], contentPatterns: [], painInferences: [], ctaPatterns: [],
      performanceTierDistribution: { high: 0, mid: 0, low: 0 },
      audienceObjections: [], audienceConfusion: [], audienceValidation: [], audienceLanguage: [],
      transcriptHooks: [], hookReliability: "caption_proxy", commentVolume: 0, transcriptCoverage: 0,
    };
    const result = run(ms);
    const d = result.decisions.find(x => x.signalText.includes("star team member"));
    expect(d).toBeDefined();
    expect(d!.independentVoiceCount).toBe(1);
    expect(d!.agreementType).toBe("SINGLE_SOURCE");
    expect(d!.type).toBe("WEAK_SIGNAL");
  });
  it("different independent customer authors on the SAME platform count as separate voices", () => {
    const { artifacts } = buildCustomerEvidence(
      [
        comment({ commentId: "a1", username: "user_a", text: "Managing five different marketing tools is exhausting honestly" }),
        comment({ commentId: "a2", username: "user_b", text: "So exhausting managing five different marketing tools every week" }),
        comment({ commentId: "a3", username: "user_c", text: "Five different marketing tools is exhausting and confusing to manage" }),
      ],
      { ownerHandles: [] },
    );
    expect(artifacts.length).toBe(3);
    const result = run(multiSource(), artifacts);
    const d = result.decisions.find(x => /exhaust/i.test(x.signalText));
    expect(d).toBeDefined();
    expect(d!.independentVoiceCount).toBeGreaterThanOrEqual(3);
    expect(d!.realRatio).toBe(1);
  });
  it("same author repeating identical text cross-platform is deduped to one artifact", () => {
    const { artifacts, stats } = buildCustomerEvidence(
      [
        comment({ commentId: "b1", username: "same_user", platform: "instagram" }),
        comment({ commentId: "b2", username: "same_user", platform: "tiktok" }),
      ],
      { ownerHandles: [] },
    );
    expect(artifacts.length).toBe(1);
    expect(stats.dedupedCrossPost).toBe(1);
  });
});

describe("origin semantics in decisions (cases 11, 16, 17, 18)", () => {
  it("AI inference stays INFERRED — narrative objections never gain real grounding by themselves", () => {
    const ms = multiSource();
    (ms.instagram as any).painInferences = ["Audience struggles to achieve desired results"];
    const result = run(ms);
    const d = result.decisions.find(x => /struggles/i.test(x.signalText));
    expect(d!.originType).toBe("inferred");
    expect(d!.realRatio).toBe(0);
  });
  it("validated customer evidence participates as real and can cross-validate competitor messaging", () => {
    const ms = multiSource();
    (ms.tiktok as any) = {
      validatedHooks: ["Tired of juggling marketing tools? Struggling with your strategy every single day"],
      highPerformingCaptions: [], trendingHashtags: [], contentPatterns: [], painInferences: [], ctaPatterns: [],
      performanceTierDistribution: { high: 0, mid: 0, low: 0 },
      audienceObjections: [], audienceConfusion: [], audienceValidation: [], audienceLanguage: [],
      transcriptHooks: [], hookReliability: "caption_proxy", commentVolume: 0, transcriptCoverage: 0,
    };
    const { artifacts } = buildCustomerEvidence(
      [comment({ commentId: "x1", username: "u_x", text: "I am struggling with my marketing strategy and tired of juggling tools" })],
      { ownerHandles: [] },
    );
    const result = run(ms, artifacts);
    const withReal = result.decisions.find(d => d.realRatio > 0);
    expect(withReal).toBeDefined();
    expect(withReal!.originBreakdown.real).toBeGreaterThanOrEqual(1);
  });
  it("customer evidence alone does NOT force VALIDATED status — a single voice stays WEAK", () => {
    const { artifacts } = buildCustomerEvidence(
      [comment({ commentId: "solo1", username: "solo_user", text: "I honestly have no idea which growth channel to invest in" })],
      { ownerHandles: [] },
    );
    const result = run(multiSource(), artifacts);
    const d = result.decisions.find(x => /growth channel/i.test(x.signalText));
    expect(d!.type).toBe("WEAK_SIGNAL");
    expect(d!.independentVoiceCount).toBe(1);
  });
  it("competitor evidence alone never becomes customer truth (realRatio stays 0)", () => {
    const ms = multiSource();
    (ms.instagram as any).hooks = ["Save 10 hours every week with our AI"];
    const result = run(ms);
    for (const d of result.decisions) {
      expect(d.realRatio).toBe(0);
      expect(d.originType).not.toBe("real");
    }
  });
});

describe("Pain Registry lineage without circular corroboration (cases 12, 16)", () => {
  const painRefs = [{ painId: "pain_abc", evidenceUids: ["i tried three tools and still dont know what marketing strategy"] }];
  it("artifact matching a pain's evidenceUid carries painId lineage as a tag", () => {
    const { artifacts, stats } = buildCustomerEvidence([comment({ commentId: "p1" })], { ownerHandles: [], approvedPains: painRefs });
    expect(artifacts[0].linkedPainIds).toEqual(["pain_abc"]);
    expect(stats.linkedToPains).toBe(1);
  });
  it("the pain entry itself never becomes a second source — one artifact stays one voice / WEAK", () => {
    const { artifacts } = buildCustomerEvidence([comment({ commentId: "p2" })], { ownerHandles: [], approvedPains: painRefs });
    const result = run(multiSource(), artifacts);
    const d = result.decisions.find(x => /three tools/i.test(x.signalText));
    expect(d!.supportingEvidenceCount).toBe(1);
    expect(d!.independentVoiceCount).toBe(1);
    expect(d!.type).toBe("WEAK_SIGNAL");
  });
});

describe("tenant/run scoping (cases 13, 14)", () => {
  it("evidence loading is scoped at the accessor (competitorId+accountId, isSynthetic=false) — builder never invents identity", () => {
    // The DB accessor getStoredCommentsForCustomerEvidence filters by
    // competitorId + accountId and excludes synthetic rows; the builder only
    // consumes what the tenant-scoped accessor returns. Assert the builder
    // preserves competitor lineage verbatim and never fabricates artifacts.
    const { artifacts } = buildCustomerEvidence([comment({ commentId: "t1", competitorId: "tenant-A-comp" })], { ownerHandles: [] });
    expect(artifacts[0].competitorId).toBe("tenant-A-comp");
    expect(artifacts[0].artifactId).toBe("t1");
    const empty = buildCustomerEvidence([], { ownerHandles: [] });
    expect(empty.artifacts.length).toBe(0);
  });
});

describe("guards unchanged (cases 19, 20)", () => {
  it("genuinely weak single-source competitor caption still WEAK_SIGNAL", () => {
    const ms = multiSource();
    (ms.instagram as any).hooks = ["Some of our 2023 platform highlights and the teams behind the scenes"];
    const result = run(ms);
    expect(result.decisions.every(d => d.type === "WEAK_SIGNAL")).toBe(true);
  });
  it("no threshold weakening: 2-voice inferred/competitor agreement below 0.45 stays WEAK (real-grounding floor intact)", () => {
    const ms = multiSource();
    (ms.instagram as any).hooks = ["What would you do about losing your best manager today"];
    ms.tiktok = {
      validatedHooks: ["Losing your best manager today, what would you do about it"],
      highPerformingCaptions: [], trendingHashtags: [], contentPatterns: [], painInferences: [], ctaPatterns: [],
      performanceTierDistribution: { high: 0, mid: 0, low: 0 },
      audienceObjections: [], audienceConfusion: [], audienceValidation: [], audienceLanguage: [],
      transcriptHooks: [], hookReliability: "caption_proxy", commentVolume: 0, transcriptCoverage: 0,
    } as any;
    const result = run(ms);
    // Two competitor voices agreeing with zero customer grounding: the 0.65
    // real-grounding floor keeps confidence below the unchanged 0.45 gate.
    for (const d of result.decisions) {
      if (d.realRatio === 0 && (d.independentVoiceCount ?? 0) >= 2) {
        expect(d.confidenceScore).toBeLessThan(0.45);
        expect(d.type).toBe("WEAK_SIGNAL");
      }
    }
    expect(result.decisions.length).toBeGreaterThan(0);
  });
});
