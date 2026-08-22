import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAudienceEngine } from "../audience-engine/engine";
import * as reliabilityRunner from "../shared/llm-reliability/reliability-runner";
import * as aiModule from "../ai-client";
import * as dbModule from "../db";
import * as memoryModule from "../system-control/memory";
import * as groundingModule from "../system-integrity/grounding";

vi.mock("../shared/llm-reliability/reliability-runner");
vi.mock("../shared/ai/index");
vi.mock("../db/index");
vi.mock("../system-control/memory");
vi.mock("../system-integrity/grounding");

describe("Audience Engine V3 - Claim Locking & Patch Repair", () => {
  let generateWithRepairSpy: any;
  let aiChatSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    aiChatSpy = vi.spyOn(aiModule, "aiChat");
    // Default mock for DB / Memory so runAudienceEngine doesn't crash before calling generateWithRepair
    vi.spyOn(memoryModule, "getJudgeStatus").mockResolvedValue(null);
    vi.spyOn(memoryModule, "saveJudgeReport").mockResolvedValue(undefined);
    vi.spyOn(groundingModule, "checkGroundingContract").mockImplementation(() => {});
    vi.spyOn(dbModule, "db", "get").mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([]))
        }))
      })),
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

    generateWithRepairSpy = vi.spyOn(reliabilityRunner, "generateWithRepair").mockImplementation(async (args) => {
      // Expose the args so we can test them
      (global as any).lastGenerateArgs = args;
      return { result: "[]", attempts: 1 };
    });
  });

  it("extracts the repair function and merges a structural REPLACE patch correctly", async () => {
    await runAudienceEngine("job_1", "acc_1", "camp_1");

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

    // Mock AI chat to return a PATCH
    aiChatSpy.mockResolvedValueOnce({
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
    });

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
    await runAudienceEngine("job_1", "acc_1", "camp_1");
    const args = (global as any).lastGenerateArgs;
    
    const failedCandidate = JSON.stringify([
      {
        name: "Seg 1",
        role: { claimId: "role_1", value: "PRACTITIONER" },
        desires: [
          { claimId: "des_1", claim: "Unsupported desire" }
        ]
      }
    ]);

    aiChatSpy.mockResolvedValueOnce({
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
    });

    const resultStr = await args.repair("input", failedCandidate, [{ claimId: "des_1" }]);
    const result = JSON.parse(resultStr);

    expect(result[0].desires.length).toBe(0);
    expect(result[0].role.value).toBe("PRACTITIONER"); // Locked
  });

  it("rejects unauthorized patches (claimId not in rejected list)", async () => {
    await runAudienceEngine("job_1", "acc_1", "camp_1");
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

    // But LLM hallucinator tries to change pain_1
    aiChatSpy.mockResolvedValueOnce({
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
    });

    // We expect the structural merge to catch this and return original failed state or throw (which our implementation catches and returns failed state)
    const resultStr = await args.repair("input", failedCandidate, rejections);
    const result = JSON.parse(resultStr);

    // It should have failed the merge, returning the unmodified candidate
    expect(result[0].pains[0].claim).toBe("Good pain");
  });

  it("throws/fails when trying to REMOVE a required field like role", async () => {
    await runAudienceEngine("job_1", "acc_1", "camp_1");
    const args = (global as any).lastGenerateArgs;
    
    const failedCandidate = JSON.stringify([
      {
        name: "Seg 1",
        role: { claimId: "role_1", value: "UNKNOWN" }
      }
    ]);

    aiChatSpy.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            repairs: [{ claimId: "role_1", action: "REMOVE" }]
          })
        }
      }]
    });

    const resultStr = await args.repair("input", failedCandidate, [{ claimId: "role_1" }]);
    const result = JSON.parse(resultStr);

    // Fallback to original
    expect(result[0].role.value).toBe("UNKNOWN");
  });
});
