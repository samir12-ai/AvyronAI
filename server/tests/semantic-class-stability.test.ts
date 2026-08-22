import { describe, it, expect } from "vitest";
import { judgePainClassStructural } from "../shared/pain-classifier";

describe("Pain Class Centrality Hardening", () => {
  const dummyRegistry: any = [
    { painId: "p1", canonical: "foo", evidenceUids: ["ev-1"] },
  ];

  it("requires centralityEvidenceUids if CORE_PURCHASE (Phase 8, 9, 29.9)", () => {
    const judged = judgePainClassStructural(dummyRegistry, [
      {
        painId: "p1",
        classification: "CORE_PURCHASE",
        marketProblemMeaning: "problem",
        marketFunction: "PROBLEM_TO_SOLVE",
        problemEvidenceUids: ["ev-1"],
        centralityStatus: "PROVEN",
        centralityEvidenceUids: [],
        centralityReason: "reason",
        reason: "reason",
      }
    ] as any);
    expect(judged.accepted.size).toBe(0);
    expect(judged.rejections[0].code).toBe("CORE_CENTRALITY_EVIDENCE_MISSING");
  });

  it("requires centralityStatus = PROVEN if CORE_PURCHASE (Phase 29.2, 29.16)", () => {
    const judged = judgePainClassStructural(dummyRegistry, [
      {
        painId: "p1",
        classification: "CORE_PURCHASE",
        marketProblemMeaning: "problem",
        marketFunction: "PROBLEM_TO_SOLVE",
        problemEvidenceUids: ["ev-1"],
        centralityStatus: "NOT_ESTABLISHED",
        centralityEvidenceUids: ["ev-1"],
        centralityReason: "reason",
        reason: "reason",
      }
    ] as any);
    expect(judged.accepted.size).toBe(0);
    expect(judged.rejections[0].code).toBe("CORE_REQUIRES_PROVEN_CENTRALITY");
  });

  it("accepts CORE_PURCHASE when centrality is PROVEN and UIDs provided (Phase 29.1)", () => {
    const judged = judgePainClassStructural(dummyRegistry, [
      {
        painId: "p1",
        classification: "CORE_PURCHASE",
        marketProblemMeaning: "problem",
        marketFunction: "PROBLEM_TO_SOLVE",
        problemEvidenceUids: ["ev-1"],
        centralityStatus: "PROVEN",
        centralityEvidenceUids: ["ev-1"],
        centralityReason: "reason",
        reason: "reason",
      }
    ] as any);
    expect(judged.accepted.size).toBe(1);
  });

  it("accepts SUPPORTING when centrality is NOT_ESTABLISHED", () => {
    const judged = judgePainClassStructural(dummyRegistry, [
      {
        painId: "p1",
        classification: "SUPPORTING",
        marketProblemMeaning: "problem",
        marketFunction: "PROBLEM_TO_SOLVE",
        problemEvidenceUids: ["ev-1"],
        centralityStatus: "NOT_ESTABLISHED",
        centralityEvidenceUids: [],
        centralityReason: "reason",
        reason: "reason",
      }
    ] as any);
    expect(judged.accepted.size).toBe(1);
  });
});
