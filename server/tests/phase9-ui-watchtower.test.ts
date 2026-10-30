import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifyWatchtowerChanges } from "../watchtower/orchestrator";
import { evaluateTaskEligibility } from "../shared/task-eligibility";

describe("Phase 9 — UI / History / Watchtower", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Watchtower Deterministic Classifier", () => {
    it("classifies posting frequency shifts from competitor snapshots without side effects", () => {
      const prevPayload = {
        frequency: 10,
        patterns: ["#sweets", "#baklava"],
      };
      const currPayload = {
        frequency: 16, // +60% shift
        patterns: ["#sweets", "#baklava"],
      };

      const changes = classifyWatchtowerChanges(
        currPayload,
        prevPayload,
        "snap_curr_123",
        "snap_base_123"
      );

      expect(changes).toHaveLength(1);
      expect(changes[0].kind).toBe("posting_frequency_shift");
      expect(changes[0].severity).toBe("medium");
      expect(changes[0].prevValue).toBe(10);
      expect(changes[0].currValue).toBe(16);
      expect(changes[0].baselineSnapshotId).toBe("snap_base_123");
      expect(changes[0].currentSnapshotId).toBe("snap_curr_123");
    });

    it("detects pattern changes when new competitor tags/hooks emerge", () => {
      const prevPayload = {
        frequency: 10,
        patterns: ["organic", "fresh"],
      };
      const currPayload = {
        frequency: 10,
        patterns: ["organic", "fresh", "express-delivery", "handcrafted", "artisanal"],
      };

      const changes = classifyWatchtowerChanges(
        currPayload,
        prevPayload,
        "snap_curr_456",
        "snap_base_456"
      );

      expect(changes).toHaveLength(1);
      expect(changes[0].kind).toBe("competitor_profile_change");
      expect(changes[0].evidence.some(e => e.includes("express-delivery"))).toBe(true);
    });

    it("produces no changes when snapshots have identical payload", () => {
      const payload = {
        frequency: 10,
        patterns: ["organic", "fresh"],
      };

      const changes = classifyWatchtowerChanges(
        payload,
        payload,
        "snap_curr_789",
        "snap_base_789"
      );

      expect(changes).toHaveLength(0);
    });
  });

  describe("Plan Verification & Task Eligibility with Offering Truth", () => {
    it("evaluates task eligibility against verified product truth facts without mutating base history", () => {
      const sampleTask = {
        id: "task_1",
        planId: "plan_123",
        accountId: "acc_123",
        title: "Publish 400g Mixed Sweets Gift Box Campaign",
        status: "DRAFT",
        taskType: "CONTENT_PUBLISH",
        description: "Promote daily-crafted sweets boxes with 100% Antep pistachio filling",
      };

      const eligibilityContextWithFacts = {
        planStatus: "APPROVED" as const,
        isPlanDesignatedActive: true,
        verifiedEvidenceTexts: [
          "All sweet boxes are prepared daily from fresh ingredients",
          "Confectioneries are made strictly with 100% Antep pistachios",
        ],
      };

      const eligibility = evaluateTaskEligibility(sampleTask as any, eligibilityContextWithFacts);
      expect(eligibility.isEligible).toBe(true);
    });

    it("restricts task promotion when plan is not approved", () => {
      const sampleTask = {
        id: "task_2",
        planId: "plan_123",
        accountId: "acc_123",
        title: "Draft promo announcement",
        status: "DRAFT",
        taskType: "CONTENT_PUBLISH",
      };

      const draftContext = {
        planStatus: "DRAFT" as const,
        isPlanDesignatedActive: false,
        verifiedEvidenceTexts: [],
      };

      const eligibility = evaluateTaskEligibility(sampleTask as any, draftContext);
      expect(eligibility.isEligible).toBe(false);
    });
  });
});
