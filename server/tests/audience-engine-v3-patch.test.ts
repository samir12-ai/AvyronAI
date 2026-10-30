import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAudienceEngine } from "../audience-engine/engine";
import * as reliabilityRunner from "../shared/llm-reliability/reliability-runner";
import * as aiModule from "../ai-client";
import * as dbModule from "../db";

vi.mock("../shared/llm-reliability/reliability-runner");
vi.mock("../shared/ai/index");
vi.mock("../db/index");
vi.mock("../competitive-intelligence/evidence-routing", () => ({
  loadCanonicalCustomerVoice: vi.fn(async () => [
    { id: "c1", origin: "COMPETITOR_COMMENT", text: "Long enough comment for audience analysis 1", competitorId: "comp_1" },
    { id: "c2", origin: "COMPETITOR_COMMENT", text: "Long enough comment for audience analysis 2", competitorId: "comp_1" },
    { id: "c3", origin: "COMPETITOR_COMMENT", text: "Long enough comment for audience analysis 3", competitorId: "comp_1" },
    { id: "c4", origin: "COMPETITOR_COMMENT", text: "Long enough comment for audience analysis 4", competitorId: "comp_1" },
    { id: "c5", origin: "COMPETITOR_COMMENT", text: "Long enough comment for audience analysis 5", competitorId: "comp_1" },
    { id: "c6", origin: "COMPETITOR_COMMENT", text: "Long enough comment for audience analysis 6", competitorId: "comp_1" },
    { id: "c7", origin: "COMPETITOR_COMMENT", text: "Long enough comment for audience analysis 7", competitorId: "comp_1" },
    { id: "c8", origin: "COMPETITOR_COMMENT", text: "Long enough comment for audience analysis 8", competitorId: "comp_1" },
    { id: "c9", origin: "COMPETITOR_COMMENT", text: "Long enough comment for audience analysis 9", competitorId: "comp_1" },
    { id: "c10", origin: "COMPETITOR_COMMENT", text: "Long enough comment for audience analysis 10", competitorId: "comp_1" }
  ])
}));
vi.mock("../shared/product-dna", () => ({
  loadProductDNA: vi.fn(async () => ({
    campaignOfferingId: "off-1",
    targetDecisionMaker: "Director of Marketing",
    targetRoles: [{ roleTitle: "Marketing Lead", roleType: "BUYER" }],
    coreOffer: "AI Automation Platform"
  })),
  formatProductDNAForPrompt: vi.fn(() => "CORE OFFER: AI Automation Platform")
}));
vi.mock("../audience-engine/semantic-reasoner", () => ({
  runDynamicCustomerVoiceExtraction: vi.fn(async () => ({
    pains: [
      { canonical: "Manual coordination is broken", claim: "Manual coordination is broken", evidenceIds: ["EV-1"], frequency: 5, confidenceScore: 0.8, evidenceCount: 1, evidence: ["e1"], sourceSignals: [], sourceTypes: ["COMMENT"], competitorIds: [] },
      { canonical: "UI latency slows workflow", claim: "UI latency slows workflow", evidenceIds: ["EV-2"], frequency: 4, confidenceScore: 0.8, evidenceCount: 1, evidence: ["e2"], sourceSignals: [], sourceTypes: ["COMMENT"], competitorIds: [] },
      { canonical: "Data sync fails constantly", claim: "Data sync fails constantly", evidenceIds: ["EV-3"], frequency: 4, confidenceScore: 0.8, evidenceCount: 1, evidence: ["e3"], sourceSignals: [], sourceTypes: ["COMMENT"], competitorIds: [] },
      { canonical: "High subscription costs", claim: "High subscription costs", evidenceIds: ["EV-4"], frequency: 3, confidenceScore: 0.8, evidenceCount: 1, evidence: ["e4"], sourceSignals: [], sourceTypes: ["COMMENT"], competitorIds: [] },
      { canonical: "Lack of onboarding support", claim: "Lack of onboarding support", evidenceIds: ["EV-5"], frequency: 3, confidenceScore: 0.8, evidenceCount: 1, evidence: ["e5"], sourceSignals: [], sourceTypes: ["COMMENT"], competitorIds: [] },
    ],
    desires: [
      { canonical: "Automate task coordination", claim: "Automate task coordination", evidenceIds: ["EV-6"], frequency: 3, confidenceScore: 0.8, evidenceCount: 1, evidence: ["e6"], sourceSignals: [], sourceTypes: ["COMMENT"], competitorIds: [] }
    ],
    objections: [],
    patterns: [],
    psychologicalDrivers: [],
    clusters: [],
    rawEvidenceCount: 10,
    synthesizedSignalCount: 6,
    failedBatches: 0,
    totalBatches: 1,
    totalUnits: 10,
    status: "COMPLETE",
    doctrineUsed: false
  }))
}));

describe("Audience Engine V3 - Claim Locking & Patch Repair", () => {
  let generateWithRepairSpy: any;
  let aiChatSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    aiChatSpy = vi.spyOn(aiModule, "aiChat");

    const mockSnapshot = {
      id: "camp_1",
      accountId: "job_1",
      campaignId: "acc_1",
      status: "COMPLETE",
      analysisVersion: 19,
      version: 19,
      signalData: JSON.stringify({ signals: [] }),
      confidenceData: JSON.stringify({ confidence: 0.9 }),
      marketState: "STABLE",
      trajectoryData: JSON.stringify({ trajectory: "GROWING" }),
      dominanceData: JSON.stringify({ dominance: "MODERATE" }),
      dataFreshness: "FRESH",
      createdAt: new Date(),
      marketIntelData: {
        canonicalCustomerVoice: {
          totalUnits: 2,
          comments: [
            { id: "c1", text: "I struggle with manual workflows and need automation.", source: "REDDIT" },
            { id: "c2", text: "Our team spends hours coordinating tasks without proper UI.", source: "G2" }
          ],
          reviews: [],
          marketVoice: []
        }
      }
    };

    const createChain = (res: any) => {
      const chain: any = Promise.resolve(res);
      chain.where = vi.fn(() => chain);
      chain.orderBy = vi.fn(() => chain);
      chain.limit = vi.fn(() => chain);
      chain.offset = vi.fn(() => chain);
      chain.from = vi.fn((table: any) => {
        if (table?.id?._name === "ci_competitors" || table?.accountId?._name === "ci_competitors") {
          return createChain([
            { id: "comp_1", accountId: "job_1", isActive: true, enrichmentStatus: "ENRICHED" },
            { id: "comp_2", accountId: "job_1", isActive: true, enrichmentStatus: "ENRICHED" },
            { id: "comp_3", accountId: "job_1", isActive: true, enrichmentStatus: "ENRICHED" }
          ]);
        }
        if (table?.caption?._name === "ci_competitor_posts") {
          return createChain(Array(25).fill(0).map((_, i) => ({
            caption: "Valid competitor post caption with enough characters",
            competitorId: "comp_1",
            platform: "instagram"
          })));
        }
        return createChain([mockSnapshot]);
      });
      chain.leftJoin = vi.fn(() => chain);
      chain.innerJoin = vi.fn(() => chain);
      return chain;
    };

    vi.spyOn(dbModule, "db", "get").mockReturnValue({
      select: vi.fn((fields: any) => {
        if (fields && fields.caption) {
          return createChain(Array(25).fill(0).map((_, i) => ({
            caption: "Valid competitor post caption with enough characters",
            competitorId: "comp_1",
            platform: "instagram"
          })));
        }
        return createChain([mockSnapshot]);
      }),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([{ id: "snap-123" }]))
        }))
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve())
        }))
      }))
    } as any);

    const defaultAiChatHandler = (opts: any) => {
      if (opts.endpoint === "evidence-selector-judge") {
        return { choices: [{ message: { content: JSON.stringify({ valid: true, reasoning: "ok" }) } }] };
      }
      if (opts.endpoint === "evidence-authority-evaluator") {
        return { choices: [{ message: { content: JSON.stringify({ evaluations: Array(10).fill(0).map((_, i) => ({ id: `c${i+1}`, classification: "DIRECT_AUDIENCE_EVIDENCE", confidence: 0.9, reasoning: "Direct evidence" })) }) } }] };
      }
      return { choices: [{ message: { content: "{}" } }] };
    };

    aiChatSpy = vi.spyOn(aiModule, "aiChat").mockImplementation(async (opts: any) => defaultAiChatHandler(opts));

    generateWithRepairSpy = vi.spyOn(reliabilityRunner, "generateWithRepair").mockImplementation(async (args) => {
      // Expose the args so we can test them
      (global as any).lastGenerateArgs = args;
      return { result: "[]", attempts: 1 };
    });
  });

  it("extracts the repair function and merges a structural REPLACE patch correctly", async () => {
    // Mock AI chat to return a PATCH
    aiChatSpy.mockImplementation(async (opts: any) => {
      if (opts.endpoint === "audience-engine-v3-segments-repair") {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                repairs: [
                  {
                    claimId: "pain_2",
                    action: "REPLACE",
                    repairedClaim: { claim: "Fixed pain", evidenceIds: ["EV-3"] }
                  }
                ]
              })
            }
          }]
        };
      }
      if (opts.endpoint === "evidence-selector-judge") {
        return { choices: [{ message: { content: JSON.stringify({ valid: true, reasoning: "ok" }) } }] };
      }
      if (opts.endpoint === "evidence-authority-evaluator") {
        return { choices: [{ message: { content: JSON.stringify({ evaluations: Array(10).fill(0).map((_, i) => ({ id: `c${i+1}`, classification: "DIRECT_AUDIENCE_EVIDENCE", confidence: 0.9, reasoning: "Direct evidence" })) }) } }] };
      }
      return { choices: [{ message: { content: "{}" } }] };
    });

    await runAudienceEngine("job_1", "acc_1", "camp_1", undefined, true);

    const args = (global as any).lastGenerateArgs;
    expect(args).toBeDefined();
    expect(args.repair).toBeTypeOf("function");

    const failedCandidate = JSON.stringify([
      {
        name: "Test Seg",
        role: { claimId: "seg_1_role", value: "BUYER" },
        pains: [
          { claimId: "pain_1", claim: "Bad pain", evidenceIds: ["EV-1"] },
          { claimId: "pain_2", claim: "Rejected pain", evidenceIds: ["EV-2"] }
        ],
        desires: []
      }
    ]);

    const rejections = [
      { claimId: "pain_2", rejectionCode: "UNSUPPORTED_PAIN", reason: "no proof" }
    ];

    const resultStr = await args.repair("input", failedCandidate, rejections);
    const result = JSON.parse(resultStr);

    // Verify structural merge
    expect(result.length).toBe(1);
    expect(result[0].role.value).toBe("BUYER");
    expect(result[0].pains.length).toBe(2);
    expect(result[0].pains[0].claim).toBe("Bad pain"); // Locked, unchanged
    expect(result[0].pains[1].claim).toBe("Fixed pain"); // Repaired
    expect(result[0].pains[1].evidenceIds).toEqual(["EV-3"]);
  });

  it("handles a REMOVE patch correctly for optional fields", async () => {
    aiChatSpy.mockImplementation(async (opts: any) => {
      if (opts.endpoint === "audience-engine-v3-segments-repair") {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                repairs: [
                  {
                    claimId: "des_1",
                    action: "REMOVE"
                  }
                ]
              })
            }
          }]
        };
      }
      if (opts.endpoint === "evidence-selector-judge") {
        return { choices: [{ message: { content: JSON.stringify({ valid: true, reasoning: "ok" }) } }] };
      }
      if (opts.endpoint === "evidence-authority-evaluator") {
        return { choices: [{ message: { content: JSON.stringify({ evaluations: Array(10).fill(0).map((_, i) => ({ id: `c${i+1}`, classification: "DIRECT_AUDIENCE_EVIDENCE", confidence: 0.9, reasoning: "Direct evidence" })) }) } }] };
      }
      return { choices: [{ message: { content: "{}" } }] };
    });

    await runAudienceEngine("job_1", "acc_1", "camp_1", undefined, true);
    const args = (global as any).lastGenerateArgs;
    
    const failedCandidate = JSON.stringify([
      {
        name: "Seg 1",
        role: { claimId: "role_1", value: "PRACTITIONER" },
        pains: [
          { claimId: "pain_1", claim: "Valid core pain" }
        ],
        desires: [
          { claimId: "des_1", claim: "Unsupported desire" }
        ]
      }
    ]);

    const resultStr = await args.repair("input", failedCandidate, [{ claimId: "des_1" }]);
    const result = JSON.parse(resultStr);

    expect(result[0].desires.length).toBe(0);
    expect(result[0].role.value).toBe("PRACTITIONER"); // Locked
  });

  it("rejects unauthorized patches (claimId not in rejected list)", async () => {
    aiChatSpy.mockImplementation(async (opts: any) => {
      if (opts.endpoint === "audience-engine-v3-segments-repair") {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                repairs: [
                  {
                    claimId: "pain_1",
                    action: "REPLACE",
                    repairedClaim: { claim: "I sneaked this in" }
                  }
                ]
              })
            }
          }]
        };
      }
      if (opts.endpoint === "evidence-selector-judge") {
        return { choices: [{ message: { content: JSON.stringify({ valid: true, reasoning: "ok" }) } }] };
      }
      if (opts.endpoint === "evidence-authority-evaluator") {
        return { choices: [{ message: { content: JSON.stringify({ evaluations: Array(10).fill(0).map((_, i) => ({ id: `c${i+1}`, classification: "DIRECT_AUDIENCE_EVIDENCE", confidence: 0.9, reasoning: "Direct evidence" })) }) } }] };
      }
      return { choices: [{ message: { content: "{}" } }] };
    });

    await runAudienceEngine("job_1", "acc_1", "camp_1", undefined, true);
    const args = (global as any).lastGenerateArgs;
    
    const failedCandidate = JSON.stringify([
      {
        name: "Seg 1",
        pains: [
          { claimId: "pain_1", claim: "Good pain" },
          { claimId: "pain_2", claim: "Bad pain" }
        ]
      }
    ]);

    // Judge only rejects pain_2
    const rejections = [{ claimId: "pain_2" }];

    // We expect the structural merge to catch this and return original failed state or throw (which our implementation catches and returns failed state)
    const resultStr = await args.repair("input", failedCandidate, rejections);
    const result = JSON.parse(resultStr);

    // It should have failed the merge, returning the unmodified candidate
    expect(result[0].pains[0].claim).toBe("Good pain");
  });

  it("throws/fails when trying to REMOVE a required field like role", async () => {
    aiChatSpy.mockImplementation(async (opts: any) => {
      if (opts.endpoint === "audience-engine-v3-segments-repair") {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                repairs: [{ claimId: "role_1", action: "REMOVE" }]
              })
            }
          }]
        };
      }
      if (opts.endpoint === "evidence-selector-judge") {
        return { choices: [{ message: { content: JSON.stringify({ valid: true, reasoning: "ok" }) } }] };
      }
      if (opts.endpoint === "evidence-authority-evaluator") {
        return { choices: [{ message: { content: JSON.stringify({ evaluations: Array(10).fill(0).map((_, i) => ({ id: `c${i+1}`, classification: "DIRECT_AUDIENCE_EVIDENCE", confidence: 0.9, reasoning: "Direct evidence" })) }) } }] };
      }
      return { choices: [{ message: { content: "{}" } }] };
    });

    await runAudienceEngine("job_1", "acc_1", "camp_1", undefined, true);
    const args = (global as any).lastGenerateArgs;
    
    const failedCandidate = JSON.stringify([
      {
        name: "Seg 1",
        role: { claimId: "role_1", value: "UNKNOWN" },
        pains: [
          { claimId: "pain_1", claim: "Valid core pain" }
        ]
      }
    ]);

    const resultStr = await args.repair("input", failedCandidate, [{ claimId: "role_1" }]);
    const result = JSON.parse(resultStr);

    // Fallback to original
    expect(result[0].role.value).toBe("UNKNOWN");
  });
});
