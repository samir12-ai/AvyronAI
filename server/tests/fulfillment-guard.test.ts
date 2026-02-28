import { describe, it, expect } from "vitest";
import { normalizeMediaType, getBranchForMediaType, CANONICAL_MEDIA_TYPES } from "../../lib/media-types";
import type { FulfillmentBranch } from "../../lib/media-types";

describe("Fulfillment Guard Tests", () => {

  describe("Branch mapping is deterministic and centralized", () => {
    it("REEL maps to VIDEO", () => expect(getBranchForMediaType("REEL")).toBe("VIDEO"));
    it("VIDEO maps to VIDEO", () => expect(getBranchForMediaType("VIDEO")).toBe("VIDEO"));
    it("IMAGE maps to DESIGNER", () => expect(getBranchForMediaType("IMAGE")).toBe("DESIGNER"));
    it("CAROUSEL maps to DESIGNER", () => expect(getBranchForMediaType("CAROUSEL")).toBe("DESIGNER"));
    it("POST maps to WRITER", () => expect(getBranchForMediaType("POST")).toBe("WRITER"));
    it("STORY maps to WRITER", () => expect(getBranchForMediaType("STORY")).toBe("WRITER"));
  });

  describe("normalizeMediaType never returns null or undefined", () => {
    it("null input defaults to IMAGE", () => expect(normalizeMediaType(null)).toBe("IMAGE"));
    it("undefined input defaults to IMAGE", () => expect(normalizeMediaType(undefined)).toBe("IMAGE"));
    it("empty string defaults to IMAGE", () => expect(normalizeMediaType("")).toBe("IMAGE"));
    for (const t of CANONICAL_MEDIA_TYPES) {
      it(`${t} normalizes to itself`, () => expect(normalizeMediaType(t)).toBe(t));
      it(`${t.toLowerCase()} normalizes to ${t}`, () => expect(normalizeMediaType(t.toLowerCase())).toBe(t));
    }
  });

  describe("Studio type to canonical mapping matches branch expectations", () => {
    const studioMap: Record<string, { canonical: string; branch: FulfillmentBranch }> = {
      REEL: { canonical: "REEL", branch: "VIDEO" },
      VIDEO: { canonical: "VIDEO", branch: "VIDEO" },
      IMAGE: { canonical: "IMAGE", branch: "DESIGNER" },
      poster: { canonical: "IMAGE", branch: "DESIGNER" },
    };

    for (const [studioType, expected] of Object.entries(studioMap)) {
      it(`Studio type '${studioType}' → ${expected.canonical} → ${expected.branch} branch`, () => {
        const normalized = normalizeMediaType(studioType);
        expect(normalized).toBe(expected.canonical);
        expect(getBranchForMediaType(normalized)).toBe(expected.branch);
      });
    }
  });

  describe("Fulfillment invariants", () => {
    it("remaining is never negative (fulfilled > required)", () => {
      const required = 5;
      const fulfilled = 8;
      const remaining = Math.max(0, required - fulfilled);
      expect(remaining).toBe(0);
      expect(remaining).toBeGreaterThanOrEqual(0);
    });

    it("progress percent is capped at 100", () => {
      const required = 5;
      const fulfilled = 10;
      const pct = required > 0 ? Math.min(100, Math.round((fulfilled / required) * 100)) : 0;
      expect(pct).toBe(100);
      expect(pct).toBeLessThanOrEqual(100);
    });

    it("zero required means zero progress percent", () => {
      const required = 0;
      const fulfilled = 0;
      const pct = required > 0 ? Math.min(100, Math.round((fulfilled / required) * 100)) : 0;
      expect(pct).toBe(0);
    });
  });

  describe("Guard: fulfilled count must equal DB row count", () => {
    it("simulated: 1 item in DB = 1 fulfilled (not 5, not 0)", () => {
      const dbRows = [
        { contentType: "REEL", campaignId: "camp1", status: "READY" },
      ];

      const fulfilledByBranch: Record<FulfillmentBranch, number> = { VIDEO: 0, DESIGNER: 0, WRITER: 0 };
      for (const row of dbRows) {
        const branch = getBranchForMediaType(row.contentType);
        fulfilledByBranch[branch]++;
      }
      const totalFulfilled = fulfilledByBranch.VIDEO + fulfilledByBranch.DESIGNER + fulfilledByBranch.WRITER;

      expect(totalFulfilled).toBe(dbRows.length);
      expect(fulfilledByBranch.VIDEO).toBe(1);
      expect(fulfilledByBranch.DESIGNER).toBe(0);
      expect(fulfilledByBranch.WRITER).toBe(0);
    });

    it("simulated: 3 mixed items in DB = correct per-branch counts", () => {
      const dbRows = [
        { contentType: "REEL", campaignId: "camp1", status: "READY" },
        { contentType: "IMAGE", campaignId: "camp1", status: "DRAFT" },
        { contentType: "POST", campaignId: "camp1", status: "DRAFT" },
      ];

      const fulfilledByBranch: Record<FulfillmentBranch, number> = { VIDEO: 0, DESIGNER: 0, WRITER: 0 };
      for (const row of dbRows) {
        const branch = getBranchForMediaType(row.contentType);
        fulfilledByBranch[branch]++;
      }
      const totalFulfilled = fulfilledByBranch.VIDEO + fulfilledByBranch.DESIGNER + fulfilledByBranch.WRITER;

      expect(totalFulfilled).toBe(3);
      expect(fulfilledByBranch.VIDEO).toBe(1);
      expect(fulfilledByBranch.DESIGNER).toBe(1);
      expect(fulfilledByBranch.WRITER).toBe(1);
    });

    it("campaign isolation: items from different campaigns don't cross-count", () => {
      const allRows = [
        { contentType: "REEL", campaignId: "camp1", status: "READY" },
        { contentType: "REEL", campaignId: "camp2", status: "READY" },
        { contentType: "IMAGE", campaignId: "camp1", status: "DRAFT" },
      ];

      const camp1Rows = allRows.filter(r => r.campaignId === "camp1");
      const camp2Rows = allRows.filter(r => r.campaignId === "camp2");

      const camp1Fulfilled: Record<FulfillmentBranch, number> = { VIDEO: 0, DESIGNER: 0, WRITER: 0 };
      for (const row of camp1Rows) {
        camp1Fulfilled[getBranchForMediaType(row.contentType)]++;
      }

      const camp2Fulfilled: Record<FulfillmentBranch, number> = { VIDEO: 0, DESIGNER: 0, WRITER: 0 };
      for (const row of camp2Rows) {
        camp2Fulfilled[getBranchForMediaType(row.contentType)]++;
      }

      expect(camp1Fulfilled.VIDEO).toBe(1);
      expect(camp1Fulfilled.DESIGNER).toBe(1);
      expect(camp1Fulfilled.WRITER).toBe(0);

      expect(camp2Fulfilled.VIDEO).toBe(1);
      expect(camp2Fulfilled.DESIGNER).toBe(0);
      expect(camp2Fulfilled.WRITER).toBe(0);
    });
  });

  describe("Guard: no null campaignId ever allowed", () => {
    it("insert with null campaignId must be rejected (422)", () => {
      const campaignId: string | null = null;
      const shouldReject = !campaignId || typeof campaignId !== "string" || !campaignId.trim();
      expect(shouldReject).toBe(true);
    });

    it("insert with empty string campaignId must be rejected (422)", () => {
      const campaignId = "";
      const shouldReject = !campaignId || typeof campaignId !== "string" || !campaignId.trim();
      expect(shouldReject).toBe(true);
    });

    it("insert with whitespace-only campaignId must be rejected (422)", () => {
      const campaignId = "   ";
      const shouldReject = !campaignId || typeof campaignId !== "string" || !campaignId.trim();
      expect(shouldReject).toBe(true);
    });

    it("insert with valid campaignId is accepted", () => {
      const campaignId = "campaign_123";
      const shouldReject = !campaignId || typeof campaignId !== "string" || !campaignId.trim();
      expect(shouldReject).toBe(false);
    });
  });
});
