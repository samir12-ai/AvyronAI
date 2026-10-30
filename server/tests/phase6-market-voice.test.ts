import { describe, it, expect } from "vitest";
import {
  buildSearchPlannerPrompt,
  judgeSearchPlanWithLLM,
} from "../market-voice/search-planner";
import {
  runFinalEvidenceJudge,
} from "../market-voice/evidence-verifier";
import type {
  MarketVoicePlannerContext,
  FetchedContentItem,
  AuthorshipVerificationResult,
  CustomerVoiceEligibilityResult,
} from "@shared/contracts/market-voice";

describe("Phase 6: Balanced Customer Voice & Domain-Neutral Search Planning", () => {
  describe("Search Planner Prompt Construction", () => {
    it("builds a prompt for physical CPG offering without hardcoded confectionery/sweets domain strings", () => {
      const cpgContext: MarketVoicePlannerContext = {
        accountId: "acc_test_cpg",
        campaignId: "camp_test_cpg",
        campaignOfferingId: "off_test_cpg",
        offeringName: "Organic Olive Oil 500ml",
        heroProductCanonicalText: "Organic Extra Virgin Olive Oil",
        heroProductAuthoritySource: "campaign_offerings",
        heroProductAuthorityId: "off_test_cpg",
        category: "Gourmet Foods / Specialty Oils",
        targetMarketGeography: "GR",
        currentYear: 2026,
      };

      const { system, user } = buildSearchPlannerPrompt(cpgContext);

      // Verify no hardcoded sweets or fashion strings remain in prompt
      expect(system).not.toContain("baklava");
      expect(system).not.toContain("kadayif");
      expect(system).not.toContain("tatlı");
      expect(system).not.toContain("fıstıklı");
      expect(system).not.toContain("dresses");

      // Verify balanced customer voice instructions are present
      expect(system).toContain("BALANCED DISCOVERY & STRICT NEUTRALITY");
      expect(system).toContain("desires, satisfactions, hesitations, feature requests, and alternatives");
      expect(system).toContain("QUERY ABSTRACTION");
      expect(system).toContain("TARGET_MARKET");
      expect(system).toContain("GLOBAL_CATEGORY");

      expect(user).toContain("Organic Extra Virgin Olive Oil");
      expect(user).toContain("Gourmet Foods / Specialty Oils");
    });

    it("builds a prompt for B2B SaaS offering with seat/tier abstraction and balanced voice", () => {
      const saasContext: MarketVoicePlannerContext = {
        accountId: "acc_test_saas",
        campaignId: "camp_test_saas",
        campaignOfferingId: "off_test_saas",
        offeringName: "Cloud Analytics Platform 10 Seats",
        heroProductCanonicalText: "Cloud Analytics Enterprise Tier",
        heroProductAuthoritySource: "campaign_offerings",
        heroProductAuthorityId: "off_test_saas",
        category: "B2B SaaS / Business Intelligence",
        targetMarketGeography: "US",
        currentYear: 2026,
      };

      const { system, user } = buildSearchPlannerPrompt(saasContext);

      expect(system).not.toContain("baklava");
      expect(system).not.toContain("kadayif");
      expect(system).not.toContain("dresses");
      expect(system).toContain("Functional Performance, Reliability & Core Capability");
      expect(system).toContain("Buyer Requirements, Sizing/Fit, Compatibility & Workflow Integration");

      expect(user).toContain("Cloud Analytics Enterprise Tier");
    });

    it("builds a prompt for Professional Services offering cleanly", () => {
      const serviceContext: MarketVoicePlannerContext = {
        accountId: "acc_test_serv",
        campaignId: "camp_test_serv",
        campaignOfferingId: "off_test_serv",
        offeringName: "Cybersecurity Compliance Audit",
        heroProductCanonicalText: "SOC2 Compliance Readiness Audit",
        heroProductAuthoritySource: "campaign_offerings",
        heroProductAuthorityId: "off_test_serv",
        category: "Professional Services / Information Security",
        targetMarketGeography: "GB",
        currentYear: 2026,
      };

      const { system, user } = buildSearchPlannerPrompt(serviceContext);

      expect(system).not.toContain("baklava");
      expect(system).not.toContain("dresses");
      expect(user).toContain("SOC2 Compliance Readiness Audit");
    });
  });

  describe("Evidence Verifier: Final Evidence Judge & Sentiment Polarity", () => {
    const dummyItem: FetchedContentItem = {
      itemId: "item_001",
      sourceUrl: "https://community-discussions.example.com/threads/123",
      sourcePlatform: "web_community",
      verbatimText: "We switched to this provider last month; onboarding was smooth but report export took longer than expected.",
      authorIdentifier: "user_42",
      likesCount: 5,
    };

    const validAuthor: AuthorshipVerificationResult = {
      authorRole: "CUSTOMER_COMMUNITY_USER",
      confidence: 0.95,
      reasoning: "Authentic user comment in discussion forum",
      isCustomerAuthored: true,
    };

    it("defaults sentimentPolarity to UNCLASSIFIED, never NEGATIVE (Correction #4)", () => {
      const eligibility: CustomerVoiceEligibilityResult = {
        eligibility: "ELIGIBLE_CUSTOMER_VOICE",
        isEligible: true,
        voiceType: "EXPERIENCE",
        reasoning: "Firsthand customer onboarding feedback",
        primaryEligibility: {
          verdict: "PRIMARY_ELIGIBLE",
          isPrimaryEligible: true,
          reasoning: "Direct product experience",
          semanticScope: "CATEGORY_RECURRING",
          transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
          voiceType: "EXPERIENCE",
        },
      };

      const decision = runFinalEvidenceJudge(
        dummyItem,
        validAuthor,
        eligibility,
        {
          offeringName: "Cloud Analytics",
          category: "B2B SaaS",
          targetMarket: "US",
        }
      );

      expect(decision.verdict).toBe("APPROVE");
      expect(decision.sentimentPolarity).toBe("UNCLASSIFIED");
      expect(decision.sentimentPolarity).not.toBe("NEGATIVE");
    });

    it("preserves explicit positive or neutral sentiment polarity when provided", () => {
      const eligibility: CustomerVoiceEligibilityResult = {
        eligibility: "ELIGIBLE_CUSTOMER_VOICE",
        isEligible: true,
        voiceType: "RECOMMENDATION",
        sentimentPolarity: "POSITIVE",
        reasoning: "Customer explicitly praised speed and accuracy",
        primaryEligibility: {
          verdict: "PRIMARY_ELIGIBLE",
          isPrimaryEligible: true,
          reasoning: "Direct positive recommendation",
          semanticScope: "CATEGORY_RECURRING",
          transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
          voiceType: "RECOMMENDATION",
          sentimentPolarity: "POSITIVE",
        },
      };

      const decision = runFinalEvidenceJudge(
        dummyItem,
        validAuthor,
        eligibility,
        {
          offeringName: "Cloud Analytics",
          category: "B2B SaaS",
          targetMarket: "US",
        }
      );

      expect(decision.verdict).toBe("APPROVE");
      expect(decision.sentimentPolarity).toBe("POSITIVE");
    });

    it("dynamically resolves TARGET_MARKET for non-LB countries when geography matches", () => {
      const deItem: FetchedContentItem = {
        ...dummyItem,
        geographyHint: "DE",
      };

      const eligibility: CustomerVoiceEligibilityResult = {
        eligibility: "ELIGIBLE_CUSTOMER_VOICE",
        isEligible: true,
        voiceType: "QUESTION",
        detectedGeography: "DE",
        reasoning: "German buyer asking about regional data sovereignty",
        primaryEligibility: {
          verdict: "PRIMARY_ELIGIBLE",
          isPrimaryEligible: true,
          reasoning: "Target market question",
          semanticScope: "MARKET_TRANSFERABLE",
          transferability: "SAME_MARKET",
          voiceType: "QUESTION",
        },
      };

      const decision = runFinalEvidenceJudge(
        deItem,
        validAuthor,
        eligibility,
        {
          offeringName: "Cloud Analytics",
          category: "B2B SaaS",
          targetMarket: "DE",
        }
      );

      expect(decision.verdict).toBe("APPROVE");
      expect(decision.marketScope).toBe("TARGET_MARKET");
      expect(decision.geography).toBe("DE");
    });

    it("supports balanced voice types: HESITATION, ALTERNATIVE, RECOMMENDATION, QUESTION, EXPERIENCE", () => {
      const voiceTypes = ["HESITATION", "RECOMMENDATION", "QUESTION", "COMPARISON", "EXPERIENCE", "OUTCOME"] as const;

      for (const voiceType of voiceTypes) {
        const eligibility: CustomerVoiceEligibilityResult = {
          eligibility: "ELIGIBLE_CUSTOMER_VOICE",
          isEligible: true,
          voiceType,
          reasoning: `Customer expressed ${voiceType.toLowerCase()}`,
          primaryEligibility: {
            verdict: "PRIMARY_ELIGIBLE",
            isPrimaryEligible: true,
            reasoning: `Customer expressed ${voiceType.toLowerCase()}`,
            semanticScope: "CATEGORY_RECURRING",
            transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
            voiceType,
          },
        };

        const decision = runFinalEvidenceJudge(
          dummyItem,
          validAuthor,
          eligibility,
          {
            offeringName: "Enterprise Tool",
            category: "Software",
            targetMarket: "US",
          }
        );

        expect(decision.verdict).toBe("APPROVE");
        expect(decision.finalReason).toContain(voiceType);
      }
    });

    it("strictly rejects own-brand source content even if author appears to be customer", () => {
      const ownBrandItem: FetchedContentItem = {
        ...dummyItem,
        sourceUrl: "https://acme-analytics.com/blog/customer-stories",
      };

      const eligibility: CustomerVoiceEligibilityResult = {
        eligibility: "ELIGIBLE_CUSTOMER_VOICE",
        isEligible: true,
        voiceType: "EXPERIENCE",
        reasoning: "Story describes product use",
        primaryEligibility: {
          verdict: "PRIMARY_ELIGIBLE",
          isPrimaryEligible: true,
          reasoning: "Story describes product use",
          semanticScope: "SINGLE_BRAND_SPECIFIC",
          transferability: "SAME_MARKET",
        },
      };

      const decision = runFinalEvidenceJudge(
        ownBrandItem,
        validAuthor,
        eligibility,
        {
          offeringName: "Acme Analytics",
          category: "Software",
          targetMarket: "US",
          canonicalDomain: "acme-analytics.com",
        }
      );

      expect(decision.verdict).toBe("REJECT");
      expect(decision.rejectionReason).toBe("OWN_BRAND_CONTENT");
    });

    it("strictly rejects non-customer author roles (brand rep, editorial, SEO)", () => {
      const nonCustomerAuthor: AuthorshipVerificationResult = {
        authorRole: "BRAND_REPRESENTATIVE",
        confidence: 0.99,
        reasoning: "Official corporate account",
        isCustomerAuthored: false,
      };

      const eligibility: CustomerVoiceEligibilityResult = {
        eligibility: "ELIGIBLE_CUSTOMER_VOICE",
        isEligible: true,
        voiceType: "EXPERIENCE",
        reasoning: "Valid text",
      };

      const decision = runFinalEvidenceJudge(
        dummyItem,
        nonCustomerAuthor,
        eligibility,
        {
          offeringName: "Acme Analytics",
          category: "Software",
          targetMarket: "US",
        }
      );

      expect(decision.verdict).toBe("REJECT");
      expect(decision.rejectionReason).toBe("BRAND_CONTENT");
    });
  });
});
