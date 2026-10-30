import { describe, it, expect } from "vitest";
import { ENGINE_PRIORITY_ORDER, ENGINE_CONTEXT_KEY } from "../orchestrator/priority-matrix";
import { ENGINE_TIMEOUT_BUDGET_MS, getEngineTimeoutMs } from "../orchestrator/engine-timeout-policy";
import {
  verifyBatchAuthorshipRole,
  verifyBatchCustomerVoiceEligibility,
  verifyAuthorshipRole,
  verifyCustomerVoiceEligibility,
  runFinalEvidenceJudge,
} from "../market-voice/evidence-verifier";
import { type FetchedContentItem } from "@shared/contracts/market-voice";

describe("Market Voice Orchestration Boundary & Performance Contract", () => {
  describe("Priority Matrix & Dependency Graph", () => {
    it("places market_voice at priority 2 and audience at priority 3", () => {
      const mi = ENGINE_PRIORITY_ORDER.find(e => e.id === "market_intelligence");
      const mv = ENGINE_PRIORITY_ORDER.find(e => e.id === "market_voice");
      const aud = ENGINE_PRIORITY_ORDER.find(e => e.id === "audience");

      expect(mi?.priority).toBe(1);
      expect(mv?.priority).toBe(2);
      expect(aud?.priority).toBe(3);

      expect(mv?.tier).toBe("MARKET_REALITY");
      expect(aud?.tier).toBe("MARKET_REALITY");

      expect(mv?.dependencies).toEqual(["market_intelligence"]);
      expect(aud?.dependencies).toEqual(["market_intelligence", "market_voice"]);
    });

    it("registers market_voice in ENGINE_CONTEXT_KEY as marketVoice", () => {
      expect(ENGINE_CONTEXT_KEY.market_voice).toBe("marketVoice");
      expect(ENGINE_CONTEXT_KEY.audience).toBe("audience");
      expect(ENGINE_CONTEXT_KEY.market_intelligence).toBe("mi");
    });
  });

  describe("Watchdog Timeout Policy", () => {
    it("allocates 10m to market_voice and restores 15m to audience", () => {
      expect(ENGINE_TIMEOUT_BUDGET_MS.market_voice).toBe(600_000);
      expect(ENGINE_TIMEOUT_BUDGET_MS.audience).toBe(900_000);
      expect(getEngineTimeoutMs("market_voice")).toBe(600_000);
      expect(getEngineTimeoutMs("audience")).toBe(900_000);
    });
  });

  describe("Batch Authorship Verification", () => {
    it("handles empty items without error", async () => {
      const res = await verifyBatchAuthorshipRole([], { url: "https://example.com", title: "Test" });
      expect(res.size).toBe(0);
    });

    it("immediately classifies empty text items as UNKNOWN without calling LLM", async () => {
      const items: FetchedContentItem[] = [
        {
          itemId: "item_empty",
          sourceUrl: "https://example.com/item1",
          sourcePlatform: "reddit",
          verbatimText: "   ",
        },
      ];
      const res = await verifyBatchAuthorshipRole(items, { url: "https://example.com", title: "Test" });
      expect(res.get("item_empty")?.authorRole).toBe("UNKNOWN");
      expect(res.get("item_empty")?.isCustomerAuthored).toBe(false);
    });
  });

  describe("Batch Customer Voice Eligibility Verification", () => {
    it("immediately rejects non-customer roles without calling LLM", async () => {
      const candidates = [
        {
          item: {
            itemId: "item_brand",
            sourceUrl: "https://example.com/brand",
            sourcePlatform: "reddit",
            verbatimText: "Our summer dresses feature premium breathable cotton lining.",
          },
          authorRole: "BRAND_REPRESENTATIVE" as const,
        },
        {
          item: {
            itemId: "item_short",
            sourceUrl: "https://example.com/short",
            sourcePlatform: "reddit",
            verbatimText: "nice dress",
          },
          authorRole: "CUSTOMER_COMMUNITY_USER" as const,
        },
      ];

      const res = await verifyBatchCustomerVoiceEligibility(
        candidates,
        {
          offeringName: "Modest Linen Dress",
          category: "Fashion",
          targetMarket: "Lebanon",
          productTruthFacts: ["100% linen", "Opaque lining"],
        },
        { url: "https://example.com", title: "Discussion" }
      );

      expect(res.get("item_brand")?.isEligible).toBe(false);
      expect(res.get("item_brand")?.eligibility).toBe("NOT_CUSTOMER_VOICE");
      expect(res.get("item_short")?.isEligible).toBe(false);
      expect(res.get("item_short")?.eligibility).toBe("GENERIC_NOISE");
    });
  });

  describe("Hostile Final Evidence Judge Authority Contract", () => {
    it("approves genuine customer voice with proper market scope and ownership", () => {
      const item: FetchedContentItem = {
        itemId: "item_valid",
        sourceUrl: "https://reddit.com/r/modestdress/1",
        sourcePlatform: "reddit",
        verbatimText: "I struggle to find linen dresses that aren't completely see-through in the summer sun.",
      };

      const authorship = {
        authorRole: "CUSTOMER_COMMUNITY_USER" as const,
        confidence: 0.95,
        reasoning: "Authentic buyer asking question in community forum.",
        isCustomerAuthored: true,
      };

      const eligibility = {
        eligibility: "ELIGIBLE_CUSTOMER_VOICE" as const,
        isEligible: true,
        voiceType: "COMPLAINT" as const,
        detectedGeography: null,
        detectedLanguage: "en",
        reasoning: "Core category sheer fabric friction.",
        primaryEligibility: {
          verdict: "PRIMARY_ELIGIBLE" as const,
          isPrimaryEligible: true,
          reasoning: "First party product friction.",
          semanticScope: "CATEGORY_RECURRING" as const,
          transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH" as const,
          voiceType: "COMPLAINT" as const,
          detectedGeography: null,
          detectedLanguage: "en",
        },
      };

      const judge = runFinalEvidenceJudge(
        item,
        authorship,
        eligibility,
        {
          offeringName: "Modest Linen Dress",
          category: "Fashion",
          targetMarket: "Lebanon",
        }
      );

      expect(judge.verdict).toBe("APPROVE");
      expect(judge.canonicalOwner).toBe("market_voice_evidence");
      expect(judge.sourceScope).toBe("MARKET_CUSTOMER_VOICE");
      expect(judge.marketScope).toBe("GLOBAL_CATEGORY");
    });

    it("rejects brand-authored content with BRAND_CONTENT reason", () => {
      const item: FetchedContentItem = {
        itemId: "item_brand_post",
        sourceUrl: "https://brand.com/product",
        sourcePlatform: "web",
        verbatimText: "Our dresses are crafted with double layer chiffon for modesty.",
      };

      const authorship = {
        authorRole: "BRAND_REPRESENTATIVE" as const,
        confidence: 0.99,
        reasoning: "Official brand store description.",
        isCustomerAuthored: false,
      };

      const eligibility = {
        eligibility: "NOT_CUSTOMER_VOICE" as const,
        isEligible: false,
        reasoning: "Brand authored.",
      };

      const judge = runFinalEvidenceJudge(
        item,
        authorship,
        eligibility,
        {
          offeringName: "Modest Linen Dress",
          category: "Fashion",
          targetMarket: "Lebanon",
        }
      );

      expect(judge.verdict).toBe("REJECT");
      expect(judge.rejectionReason).toBe("BRAND_CONTENT");
      expect(judge.canonicalOwner).toBe("UNRESOLVED");
    });
  });
});
