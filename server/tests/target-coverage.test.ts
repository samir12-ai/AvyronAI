import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  evaluateTargetCoverage,
  resolveTargetRolesWithJudge,
  matchAudienceToTargetsWithJudge,
  type NormalizedTargetRole,
  type BusinessTargetSourceItem
} from "../audience-engine/target-coverage";
import type { AudienceSegment } from "../audience-engine/engine";

// Mock the aiChat module
vi.mock("../ai-client", () => ({
  aiChat: vi.fn()
}));

import { aiChat } from "../ai-client";

describe("Target Coverage Authority and Semantic Matching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Case A: Missing business target authority returns NOT_EVALUATED with TARGET_AUTHORITY_MISSING", async () => {
    const emptySegments: AudienceSegment[] = [];
    const result = await evaluateTargetCoverage(
      "non_existent_campaign",
      undefined,
      emptySegments,
      "COMPLETE"
    );

    expect(result.status).toBe("NOT_EVALUATED");
    expect(result.reason).toBe("TARGET_AUTHORITY_MISSING");
    expect(result.evidenceGap).toBe(false);
    expect(result.supportedTargetRoles).toEqual([]);
    expect(result.unsupportedTargetRoles).toEqual([]);
  });

  it("Case A2: Incomplete audience status returns NOT_EVALUATED without reading targets", async () => {
    const result = await evaluateTargetCoverage(
      "non_existent_campaign",
      undefined,
      [],
      "INCOMPLETE"
    );

    expect(result.status).toBe("NOT_EVALUATED");
    expect(result.reason).toContain("incomplete audience status");
    expect(result.evidenceGap).toBe(false);
  });

  it("Case B: Explicit B2B Buyer Target + End-Consumer Complaints Only returns GAP (No Buyer/User Collapse)", async () => {
    const targetRoles: NormalizedTargetRole[] = [
      {
        targetId: "target_1",
        roleName: "Enterprise Marketing VP",
        description: "Enterprise decision maker purchasing marketing automation solutions",
        buyerType: "ECONOMIC_BUYER",
        sourceField: "productDna.targetDecisionMaker",
        rawSourceText: "Enterprise Marketing VP with budget authority"
      }
    ];

    const consumerComplaintSegments: AudienceSegment[] = [
      {
        name: "Users frustrated by billing and cancellation",
        role: "END_CONSUMER",
        roleClaim: { claimId: "seg_1_role", value: "END_CONSUMER", evidenceIds: ["EV-1"] },
        segmentDefinition: { claimId: "seg_1_def", claim: "Subscribers facing unauthorized card charges", evidenceIds: ["EV-1"] },
        pains: [{ claimId: "seg_1_p1", claim: "Unauthorized charges on credit card", evidenceIds: ["EV-1"] }],
        desires: [],
        objections: [],
        motivations: [],
        outcomes: [],
        description: "End user subscribers complaining about billing",
        painProfile: ["Unauthorized charges"],
        desireProfile: [],
        objectionProfile: [],
        motivationProfile: [],
        estimatedPercentage: 100,
        groundingRefs: ["EV-1"],
        evidenceCount: 10,
        confidenceScore: 0.8,
        sourceSignals: ["painMap"],
        inputSnapshotId: "snap-1"
      }
    ];

    // Mock matcher LLM response: BUYER_USER_MISMATCH
    (aiChat as any)
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              matches: [{
                targetId: "target_1",
                roleName: "Enterprise Marketing VP",
                matchType: "BUYER_USER_MISMATCH",
                isCovered: false,
                matchedSegmentNames: ["Users frustrated by billing and cancellation"],
                matchedRoles: ["END_CONSUMER"],
                reasoning: "Audience evidence only represents end-user billing complaints, not Enterprise Marketing VPs."
              }]
            })
          }
        }]
      })
      // Mock judge response: valid
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              valid: true,
              reasons: []
            })
          }
        }]
      });

    const matchResult = await matchAudienceToTargetsWithJudge(targetRoles, consumerComplaintSegments);
    expect(matchResult.valid).toBe(true);
    expect(matchResult.matches.length).toBe(1);
    expect(matchResult.matches[0].isCovered).toBe(false);
    expect(matchResult.matches[0].matchType).toBe("BUYER_USER_MISMATCH");
  });

  it("Case C1: Marketing Manager target + Generic Practitioner evidence only returns NOT COVERED (BROADER_THAN_TARGET)", async () => {
    const targetRoles: NormalizedTargetRole[] = [
      {
        targetId: "target_1",
        roleName: "B2B Marketing Director",
        description: "B2B Marketing Director overseeing multi-channel ad spend and team KPIs",
        buyerType: "ECONOMIC_BUYER",
        sourceField: "campaign.targetAudience",
        rawSourceText: "B2B Marketing Directors managing growth teams"
      }
    ];

    const genericPractitionerSegments: AudienceSegment[] = [
      {
        name: "Content Creators and Solo Operators",
        role: "PRACTITIONER",
        roleClaim: { claimId: "seg_2_role", value: "PRACTITIONER", evidenceIds: ["EV-2"] },
        segmentDefinition: { claimId: "seg_2_def", claim: "Individual content creators making short videos", evidenceIds: ["EV-2"] },
        pains: [{ claimId: "seg_2_p1", claim: "Manual video clipping takes too long", evidenceIds: ["EV-2"] }],
        desires: [],
        objections: [],
        motivations: [],
        outcomes: [],
        description: "Solo creators making video clips",
        painProfile: ["Manual video editing"],
        desireProfile: [],
        objectionProfile: [],
        motivationProfile: [],
        estimatedPercentage: 100,
        groundingRefs: ["EV-2"],
        evidenceCount: 10,
        confidenceScore: 0.8,
        sourceSignals: ["painMap"],
        inputSnapshotId: "snap-2"
      }
    ];

    // Mock matcher response: BROADER_THAN_TARGET
    (aiChat as any)
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              matches: [{
                targetId: "target_1",
                roleName: "B2B Marketing Director",
                matchType: "BROADER_THAN_TARGET",
                isCovered: false,
                matchedSegmentNames: ["Content Creators and Solo Operators"],
                matchedRoles: ["PRACTITIONER"],
                reasoning: "The evidence describes individual solo video creators, which is broader/different than B2B Marketing Directors."
              }]
            })
          }
        }]
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              valid: true,
              reasons: []
            })
          }
        }]
      });

    const matchResult = await matchAudienceToTargetsWithJudge(targetRoles, genericPractitionerSegments);
    expect(matchResult.valid).toBe(true);
    expect(matchResult.matches.length).toBe(1);
    expect(matchResult.matches[0].isCovered).toBe(false);
    expect(matchResult.matches[0].matchType).toBe("BROADER_THAN_TARGET");
  });

  it("Case C2: Marketing Manager target + Audience evidence clearly establishing marketing-management function returns VALID_SEMANTIC_MATCH (FULL)", async () => {
    const targetRoles: NormalizedTargetRole[] = [
      {
        targetId: "target_1",
        roleName: "Marketing Team Lead",
        description: "Marketing team leads and operators seeking automation for campaign workflows and prospecting",
        buyerType: "PRACTITIONER",
        sourceField: "campaign.targetAudience",
        rawSourceText: "Marketing team leads and operators"
      }
    ];

    const matchedMarketingSegments: AudienceSegment[] = [
      {
        name: "Marketing and sales practitioners seeking automation to reduce manual workload",
        role: "PRACTITIONER",
        roleClaim: { claimId: "seg_2_role", value: "PRACTITIONER", evidenceIds: ["EV-22", "EV-74"] },
        segmentDefinition: { claimId: "seg_2_def", claim: "Marketing and sales professionals who seek AI and automation tools to reduce repetitive tasks, improve targeting, and increase efficiency in outreach and ad creation", evidenceIds: ["EV-22", "EV-74"] },
        pains: [{ claimId: "seg_2_p1", claim: "They struggle with time-consuming manual tasks such as ad design, prospecting, and follow-ups that reduce efficiency and effectiveness.", evidenceIds: ["EV-22", "EV-74"] }],
        desires: [],
        objections: [],
        motivations: [],
        outcomes: [],
        description: "Marketing practitioners running prospecting and ad campaigns",
        painProfile: ["Manual prospecting and ad creation"],
        desireProfile: [],
        objectionProfile: [],
        motivationProfile: [],
        estimatedPercentage: 100,
        groundingRefs: ["EV-22", "EV-74"],
        evidenceCount: 10,
        confidenceScore: 0.8,
        sourceSignals: ["painMap"],
        inputSnapshotId: "snap-3"
      }
    ];

    // Mock matcher response: VALID_SEMANTIC_MATCH
    (aiChat as any)
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              matches: [{
                targetId: "target_1",
                roleName: "Marketing Team Lead",
                matchType: "VALID_SEMANTIC_MATCH",
                isCovered: true,
                matchedSegmentNames: ["Marketing and sales practitioners seeking automation to reduce manual workload"],
                matchedRoles: ["PRACTITIONER"],
                reasoning: "The evidence directly establishes marketing operators and team leads managing ad creation and prospecting."
              }]
            })
          }
        }]
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              valid: true,
              reasons: []
            })
          }
        }]
      });

    const matchResult = await matchAudienceToTargetsWithJudge(targetRoles, matchedMarketingSegments);
    expect(matchResult.valid).toBe(true);
    expect(matchResult.matches.length).toBe(1);
    expect(matchResult.matches[0].isCovered).toBe(true);
    expect(matchResult.matches[0].matchType).toBe("VALID_SEMANTIC_MATCH");
  });

  it("Case D: Target Resolver preserves lineage and allows UNKNOWN buyerType", async () => {
    const sources: BusinessTargetSourceItem[] = [
      {
        field: "growthCampaigns.targetAudience",
        text: "Small businesses and real estate agents looking to create social media posts"
      }
    ];

    // Mock resolver response
    (aiChat as any)
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              targetRoles: [{
                targetId: "target_1",
                roleName: "Real Estate Agents",
                description: "Real estate agents looking to create social media posts",
                buyerType: "UNKNOWN",
                sourceField: "growthCampaigns.targetAudience",
                rawSourceText: "real estate agents looking to create social media posts"
              }]
            })
          }
        }]
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              valid: true,
              reasons: []
            })
          }
        }]
      });

    const resolution = await resolveTargetRolesWithJudge(sources);
    expect(resolution.valid).toBe(true);
    expect(resolution.targetRoles.length).toBe(1);
    expect(resolution.targetRoles[0].buyerType).toBe("UNKNOWN");
    expect(resolution.targetRoles[0].rawSourceText).toBe("real estate agents looking to create social media posts");
  });

  it("Case E: CROSS_CAMPAIGN_AUTHORITY_MISMATCH fails closed without invoking LLMs when campaign IDs differ", async () => {
    const segments: AudienceSegment[] = [];
    const result = await evaluateTargetCoverage(
      "campaign_A",
      "account_1",
      segments,
      "COMPLETE",
      { campaignId: "campaign_B", accountId: "account_1" }
    );

    expect(result.status).toBe("NOT_EVALUATED");
    expect(result.reason).toBe("CROSS_CAMPAIGN_AUTHORITY_MISMATCH");
    expect(result.evidenceGap).toBe(false);
    expect(aiChat).not.toHaveBeenCalled();
  });

  it("Case E2: CROSS_ACCOUNT_AUTHORITY_MISMATCH fails closed without invoking LLMs when account IDs differ", async () => {
    const segments: AudienceSegment[] = [];
    const result = await evaluateTargetCoverage(
      "campaign_A",
      "account_1",
      segments,
      "COMPLETE",
      { campaignId: "campaign_A", accountId: "account_2" }
    );

    expect(result.status).toBe("NOT_EVALUATED");
    expect(result.reason).toBe("CROSS_ACCOUNT_AUTHORITY_MISMATCH");
    expect(result.evidenceGap).toBe(false);
    expect(aiChat).not.toHaveBeenCalled();
  });

  it("Case E3: CROSS_SNAPSHOT_SEGMENT_MISMATCH fails closed when audience segments have mixed snapshot IDs", async () => {
    const mixedSegments: AudienceSegment[] = [
      {
        name: "Segment 1",
        role: "PRACTITIONER",
        roleClaim: { claimId: "c1", value: "PRACTITIONER", evidenceIds: [] },
        segmentDefinition: { claimId: "d1", claim: "Def 1", evidenceIds: [] },
        pains: [],
        desires: [],
        objections: [],
        motivations: [],
        outcomes: [],
        description: "Desc 1",
        painProfile: [],
        desireProfile: [],
        objectionProfile: [],
        motivationProfile: [],
        estimatedPercentage: 50,
        groundingRefs: [],
        evidenceCount: 1,
        confidenceScore: 0.9,
        sourceSignals: [],
        inputSnapshotId: "snapshot_AAA"
      },
      {
        name: "Segment 2",
        role: "END_CONSUMER",
        roleClaim: { claimId: "c2", value: "END_CONSUMER", evidenceIds: [] },
        segmentDefinition: { claimId: "d2", claim: "Def 2", evidenceIds: [] },
        pains: [],
        desires: [],
        objections: [],
        motivations: [],
        outcomes: [],
        description: "Desc 2",
        painProfile: [],
        desireProfile: [],
        objectionProfile: [],
        motivationProfile: [],
        estimatedPercentage: 50,
        groundingRefs: [],
        evidenceCount: 1,
        confidenceScore: 0.9,
        sourceSignals: [],
        inputSnapshotId: "snapshot_BBB"
      }
    ];

    const result = await evaluateTargetCoverage(
      "campaign_A",
      "account_1",
      mixedSegments,
      "COMPLETE",
      { campaignId: "campaign_A", accountId: "account_1" }
    );

    expect(result.status).toBe("NOT_EVALUATED");
    expect(result.reason).toBe("CROSS_SNAPSHOT_SEGMENT_MISMATCH");
    expect(result.evidenceGap).toBe(false);
    expect(aiChat).not.toHaveBeenCalled();
  });

  it("Case E4: CROSS_CAMPAIGN_EVIDENCE_LINEAGE_MISMATCH fails closed when cited evidence belongs to another campaign", async () => {
    const segmentsWithForeignEvidence: AudienceSegment[] = [
      {
        name: "Segment 1",
        role: "PRACTITIONER",
        roleClaim: { claimId: "c1", value: "PRACTITIONER", evidenceIds: ["EV-FOREIGN"] },
        segmentDefinition: { claimId: "d1", claim: "Def 1", evidenceIds: ["EV-FOREIGN"] },
        pains: [{ claimId: "p1", claim: "Pain 1", evidenceIds: ["EV-FOREIGN"] }],
        desires: [],
        objections: [],
        motivations: [],
        outcomes: [],
        description: "Desc 1",
        painProfile: [],
        desireProfile: [],
        objectionProfile: [],
        motivationProfile: [],
        estimatedPercentage: 100,
        groundingRefs: ["EV-FOREIGN"],
        evidenceCount: 1,
        confidenceScore: 0.9,
        sourceSignals: [],
        inputSnapshotId: "snapshot_AAA"
      }
    ];

    const result = await evaluateTargetCoverage(
      "campaign_A",
      "account_1",
      segmentsWithForeignEvidence,
      "COMPLETE",
      {
        campaignId: "campaign_A",
        accountId: "account_1",
        evidenceOwnership: [
          {
            evidenceId: "EV-FOREIGN",
            stableRecordId: "rec_999",
            sourceTable: "ci_competitor_comments",
            campaignId: "campaign_FOREIGN",
            accountId: "account_1"
          }
        ]
      }
    );

    expect(result.status).toBe("NOT_EVALUATED");
    expect(result.reason).toBe("CROSS_CAMPAIGN_EVIDENCE_LINEAGE_MISMATCH");
    expect(result.evidenceGap).toBe(false);
    expect(aiChat).not.toHaveBeenCalled();
  });

  it("Case E5: CROSS_ACCOUNT_EVIDENCE_LINEAGE_MISMATCH fails closed when cited evidence belongs to another account", async () => {
    const segmentsWithForeignAccountEvidence: AudienceSegment[] = [
      {
        name: "Segment 1",
        role: "PRACTITIONER",
        roleClaim: { claimId: "c1", value: "PRACTITIONER", evidenceIds: ["EV-FOREIGN-ACC"] },
        segmentDefinition: { claimId: "d1", claim: "Def 1", evidenceIds: ["EV-FOREIGN-ACC"] },
        pains: [{ claimId: "p1", claim: "Pain 1", evidenceIds: ["EV-FOREIGN-ACC"] }],
        desires: [],
        objections: [],
        motivations: [],
        outcomes: [],
        description: "Desc 1",
        painProfile: [],
        desireProfile: [],
        objectionProfile: [],
        motivationProfile: [],
        estimatedPercentage: 100,
        groundingRefs: ["EV-FOREIGN-ACC"],
        evidenceCount: 1,
        confidenceScore: 0.9,
        sourceSignals: [],
        inputSnapshotId: "snapshot_AAA"
      }
    ];

    const result = await evaluateTargetCoverage(
      "campaign_A",
      "account_1",
      segmentsWithForeignAccountEvidence,
      "COMPLETE",
      {
        campaignId: "campaign_A",
        accountId: "account_1",
        evidenceOwnership: [
          {
            evidenceId: "EV-FOREIGN-ACC",
            stableRecordId: "rec_888",
            sourceTable: "ci_competitor_comments",
            campaignId: "campaign_A",
            accountId: "account_FOREIGN"
          }
        ]
      }
    );

    expect(result.status).toBe("NOT_EVALUATED");
    expect(result.reason).toBe("CROSS_ACCOUNT_EVIDENCE_LINEAGE_MISMATCH");
    expect(result.evidenceGap).toBe(false);
    expect(aiChat).not.toHaveBeenCalled();
  });
});
