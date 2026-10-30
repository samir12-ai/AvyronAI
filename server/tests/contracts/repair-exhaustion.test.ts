import { describe, it, expect, vi, beforeEach } from "vitest";
import { runLaneGrouper } from "../../shared/lane-grouper";
import { runMechanismEngine } from "../../mechanism-engine/engine";
import { designCategoryGame } from "../../positioning-engine/category-game";
import * as aiClient from "../../ai-client";

describe("Contract: Repair Exhaustion Fail-Closed Semantics", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("1. Lane Grouper: returns empty array without fallback lanes when zero core pains exist", async () => {
    const emptyResult = await runLaneGrouper([], [], {
      accountId: "acc_1",
      campaignId: "camp_1",
    });

    expect(emptyResult).toEqual([]);
    expect(Array.isArray(emptyResult)).toBe(true);
    expect(emptyResult.length).toBe(0);
  });

  it("2. Mechanism Engine: fails closed with NO_DISTINCT_MECHANISM_ESTABLISHED and null mechanism when semantic judge rejects all retries", async () => {
    vi.spyOn(aiClient, "aiChat").mockImplementation(async (opts: any) => {
      const prompt = JSON.stringify(opts.messages || []);
      if (prompt.includes("SEMANTIC_ROLE_JUDGE") || prompt.includes("axisVerdict") || prompt.includes("failureType")) {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  verdict: "REPAIR",
                  axisVerdict: "MISALIGNED",
                  axisReason: "Candidate mechanism contradicts the positioning contrast axis",
                  reasons: ["Mechanism fails to explain the operational HOW for simplicity"],
                  failureType: "AXIS_MISALIGNED",
                  operationalClaims: [],
                  feedback: "Align operational steps with simplicity axis",
                }),
              },
            },
          ],
        } as any;
      }
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                name: "Overcomplicated Multi-Tier Orchestrator",
                description: "An intricate multi-step legacy system",
                steps: ["Step 1: complex setup", "Step 2: manual verification"],
                logic: "Requires 14 manual checkpoints",
                promise: "Complexity for power users",
                problem: "Manual overhead",
                capabilityRefs: [],
              }),
            },
          },
        ],
      } as any;
    });

    const positioningInput = {
      primaryAxis: "simplicity",
      contrastAxis: "simplicity vs manual burden",
      statement: "The effortless automation platform",
      enemyDefinition: "Manual friction",
    };
    const differentiationInput = {
      mechanismCore: {
        mechanismName: "Core Tech",
        mechanismType: "engine",
        mechanismSteps: ["Step 1", "Step 2"],
        mechanismPromise: "Speed and simplicity",
        mechanismProblem: "Manual burden",
      },
      mechanismFraming: {},
      pillars: [],
    };
    const result = await runMechanismEngine(
      positioningInput as any,
      differentiationInput as any,
      "acc_1",
    );

    expect(result.status).toBe("NO_DISTINCT_MECHANISM_ESTABLISHED");
    expect(result.primaryMechanism).toBeNull();
  });

  it("3. Category Game: returns null (fails closed) when retry v2 is rejected by judge (zero auto-accept)", async () => {
    let callCount = 0;
    vi.spyOn(aiClient, "aiChat").mockImplementation(async (opts: any) => {
      callCount++;
      // Call 1: generator v1
      if (callCount === 1) {
        return {
          choices: [{ message: { content: JSON.stringify({ ourDimension: "speed", ourGame: "instant sync", competitorGames: [], defensibility: "structural" }) } }],
        } as any;
      }
      // Call 2: judge rejects v1
      if (callCount === 2) {
        return {
          choices: [{ message: { content: JSON.stringify({ verdict: "REJECTED", reason: "Fails distinctiveness", fix: "Make it more defensible" }) } }],
        } as any;
      }
      // Call 3: retry generator v2
      if (callCount === 3) {
        return {
          choices: [{ message: { content: JSON.stringify({ ourDimension: "speed", ourGame: "still slow sync", competitorGames: [], defensibility: "weak" }) } }],
        } as any;
      }
      // Call 4: judge re-evaluates v2 and REJECTS IT AGAIN
      return {
        choices: [{ message: { content: JSON.stringify({ verdict: "REJECTED", reason: "Retry v2 still lacks category defensibility" }) } }],
      } as any;
    });

    const result = await designCategoryGame({
      category: "Automation Software",
      marketDiagnosis: "Crowded",
      competitorBriefs: [{ name: "LegacyCorp", positioning: "Complex suites" }],
      audiencePainSignals: ["Slow manual sync"],
      audienceDesireSignals: ["Instant sync"],
      audienceObjections: ["Hard to configure"],
      productAdvantage: "Direct push synchronization",
      accountId: "acc_1",
    });

    // Invariant: Zero auto-accept of unapproved v2; returns null
    expect(result).toBeNull();
  });
});
