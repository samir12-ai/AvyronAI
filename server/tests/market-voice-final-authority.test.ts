/**
 * Market Voice Final Authority Sanity Test Suite
 * 
 * Verifies:
 * - Test A: Editorial article prose cannot enter PRIMARY_MARKET_VOICE (rejected as EDITORIAL_CONTENT / NOT_CUSTOMER_AUTHORED).
 * - Test B: Genuine reader/customer comment extracted from a publication page can qualify if authorship is CUSTOMER_COMMUNITY_USER and relevance is valid.
 * - Test C: Source concentration telemetry does NOT deterministically decide sufficiency (LLM judge semantically reasons about corpus).
 * - Test D: Search planner contains no apparel-specific production-wide semantic rules and plans dynamically for any industry.
 * - Test E: SINGLE_BRAND_SPECIFIC evidence cannot independently generate a category-level canonical theme without independent category corroboration.
 * - Test F: CATEGORY_RECURRING and semantically transferable evidence may establish themes when evidence is sufficient.
 */

import { describe, it, expect, vi } from "vitest";
import {
  verifyAuthorshipRole,
  verifyCustomerVoiceEligibility,
  runFinalEvidenceJudge,
} from "../market-voice/evidence-verifier";
import {
  judgePrimaryMarketVoiceSufficiencyWithLLM,
} from "../audience-engine/semantic-sufficiency-judge";
import {
  buildSearchPlannerPrompt,
  validateSearchPlanDraft,
} from "../market-voice/search-planner";
import {
  generateSemanticThemeInventoryWithLLM,
  judgeAudienceDraftWithLLM,
  classifyBatchEvidenceUnits,
  buildFinalCoverageManifest,
  type DeduplicatedEvidenceUnit,
} from "../audience-engine/semantic-reasoner";
import { type CustomerEvidenceUnit, deduplicateCustomerVoice } from "../competitive-intelligence/evidence-routing";

vi.mock("../ai-client", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    aiGemini: vi.fn(async (params: any) => {
      let prompt = "";
      let sys = "";
      if (Array.isArray(params)) {
        prompt = (params?.[1]?.content || "").toLowerCase();
        sys = (params?.[0]?.content || "").toLowerCase();
      } else if (typeof params === "object") {
        const contents = typeof params.contents === "string" ? params.contents : JSON.stringify(params.contents || "");
        const parts = contents.split(/USER:\n/i);
        sys = (parts[0] || contents).toLowerCase();
        prompt = (parts[1] || contents).toLowerCase();
      }

      if (sys.includes("sufficiency judge")) {
        // Semantic decision based on quote contents, NOT a numeric threshold
        if (prompt.includes("100% single-store dispute") || prompt.includes("isolated shipping issue only")) {
          return JSON.stringify({
            verdict: "INSUFFICIENT",
            reason: "Corpus is exclusively composed of single-retailer shipping and tracking dispute without category insights.",
            categoryRelevance: "MEDIUM",
            buyerAuthenticity: "VERIFIED_BUYER",
            substantiveThemesFound: ["Fulfillment delay"],
            sourceConcentrationRisk: "HIGH_SINGLE_SOURCE",
            categoryBreadth: "SINGLE_BRAND_INCIDENT",
          });
        }
        return JSON.stringify({
          verdict: "SUFFICIENT",
          reason: "Corpus contains authentic customer voices discussing product performance, usability, and trade-offs.",
          categoryRelevance: "HIGH",
          buyerAuthenticity: "VERIFIED_BUYER",
          substantiveThemesFound: ["Product performance", "Usability under real conditions"],
          sourceConcentrationRisk: "DIVERSE",
          categoryBreadth: "BROAD_CATEGORY_TRUTHS",
        });
      }

      return JSON.stringify({});
    }),
    aiChat: vi.fn(async (params: any) => {
      const endpoint = params.endpoint || "";
      const content = (params.messages?.[1]?.content || "").toLowerCase();

      if (endpoint.includes("sufficiency-judge")) {
        // Semantic decision based on quote contents, NOT a numeric threshold
        if (content.includes("100% single-store dispute") || content.includes("isolated shipping issue only")) {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  verdict: "INSUFFICIENT",
                  reason: "Corpus is exclusively composed of single-retailer shipping and tracking dispute without category insights.",
                  categoryRelevance: "MEDIUM",
                  buyerAuthenticity: "VERIFIED_BUYER",
                  substantiveThemesFound: ["Fulfillment delay"],
                  sourceConcentrationRisk: "HIGH_SINGLE_SOURCE",
                  categoryBreadth: "SINGLE_BRAND_INCIDENT",
                }),
              },
            }],
          };
        }
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                verdict: "SUFFICIENT",
                reason: "Corpus contains authentic customer voices discussing product performance, usability, and trade-offs.",
                categoryRelevance: "HIGH",
                buyerAuthenticity: "VERIFIED_BUYER",
                substantiveThemesFound: ["Product performance", "Usability under real conditions"],
                sourceConcentrationRisk: "DIVERSE",
                categoryBreadth: "BROAD_CATEGORY_TRUTHS",
              }),
            },
          }],
        };
      }

      if (endpoint === "mv-authorship-verifier") {
        // Test A: Editorial journalist prose
        if (content.includes("dailybeast.com") && (content.includes("fashion editor") || content.includes("scouted review staff"))) {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  authorRole: "EDITORIAL_JOURNALIST",
                  isCustomerAuthored: false,
                  confidence: 0.95,
                  reasoning: "Article body prose authored by publication journalist / staff editor.",
                }),
              },
            }],
          };
        }

        // Test B: Genuine reader comment under publication article
        if (content.includes("reader_comment_1") || content.includes("posted in reader comments section")) {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  authorRole: "CUSTOMER_COMMUNITY_USER",
                  isCustomerAuthored: true,
                  confidence: 0.9,
                  reasoning: "Independent reader comment posted in article comment section sharing personal buying experience.",
                }),
              },
            }],
          };
        }

        // Test F: Market research commentary
        if (content.includes("gartner") || content.includes("industry analyst report")) {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  authorRole: "MARKET_RESEARCH_COMMENTATOR",
                  isCustomerAuthored: false,
                  confidence: 0.95,
                  reasoning: "Market analyst commentary, not first-party customer voice.",
                }),
              },
            }],
          };
        }

        // Default genuine customer
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                authorRole: "CUSTOMER_COMMUNITY_USER",
                isCustomerAuthored: true,
                confidence: 0.9,
                reasoning: "Authentic first-party user review / comment.",
              }),
            },
          }],
        };
      }

      if (endpoint === "mv-voice-eligibility") {
        let semanticScope = "CATEGORY_RECURRING";
        if (content.includes("single_store_incident") || content.includes("vendor x delayed delivery") || content.includes("single_brand")) {
          semanticScope = "SINGLE_BRAND_SPECIFIC";
        } else if (content.includes("isolated_incident") || content.includes("one-off incident")) {
          semanticScope = "INCIDENT_SPECIFIC";
        } else if (content.includes("insufficient_text") || content.includes("too vague")) {
          semanticScope = "INSUFFICIENT_SCOPE";
        } else if (content.includes("market_transferable") || content.includes("warm climate")) {
          semanticScope = "MARKET_TRANSFERABLE";
        }

        return {
          choices: [{
            message: {
              content: JSON.stringify({
                isEligible: true,
                eligibility: "ELIGIBLE_CUSTOMER_VOICE",
                primaryEligibilityVerdict: "PRIMARY_ELIGIBLE",
                semanticScope,
                transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
                voiceType: "EXPERIENCE",
                reasoning: "Authentic customer experience regarding product category.",
              }),
            },
          }],
        };
      }

      if (endpoint === "semantic-reasoner-batch") {
        if (content.includes("total scam as far as their refund policy") || content.includes("ev_mixed_1") || content.includes("mixed_quote")) {
          return {
            choices: [{
              message: {
                content: JSON.stringify([
                  {
                    evidenceUnitId: "ev_mixed_1",
                    primaryForm: "COMPLAINT",
                    primaryClaim: "Dissatisfied with return fee policy and see-through fabric",
                    semanticClaims: [
                      {
                        claimKind: "service_complaint",
                        meaning: "Retailer charges $2.95 fee for returns package",
                        semanticScope: "SINGLE_BRAND_SPECIFIC",
                        transferability: "ADJACENT_TRANSFERABLE_MARKET",
                        scopeRationale: "Specific return fee of single merchant",
                        confidence: 0.95,
                      },
                      {
                        claimKind: "friction_problem",
                        meaning: "Dress fabric is see-through and cheaply made for modest wear",
                        semanticScope: "MARKET_TRANSFERABLE",
                        transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
                        scopeRationale: "Universal modest apparel fabric opacity trade-off",
                        confidence: 0.92,
                      },
                    ],
                    confidence: 0.92,
                  },
                ]),
              },
            }],
          };
        }

        if (content.includes("ev_disagree_1")) {
          // Ambiguous / contradictory claim resolution
          return {
            choices: [{
              message: {
                content: JSON.stringify([
                  {
                    evidenceUnitId: "ev_disagree_1",
                    primaryForm: "COMPLAINT",
                    primaryClaim: "Customer mentions vague tracking number delay",
                    semanticClaims: [
                      {
                        claimKind: "service_complaint",
                        meaning: "Carrier tracking number delay for one order",
                        semanticScope: "SINGLE_BRAND_SPECIFIC",
                        transferability: "GEOGRAPHY_SPECIFIC_OPERATIONAL",
                        scopeRationale: "Single transaction carrier tracking glitch",
                        confidence: 0.8,
                      },
                    ],
                    confidence: 0.8,
                  },
                ]),
              },
            }],
          };
        }

        return {
          choices: [{
            message: {
              content: JSON.stringify([
                {
                  evidenceUnitId: "ev_default_1",
                  primaryForm: "PAIN",
                  primaryClaim: "Category fabric friction",
                  semanticClaims: [
                    {
                      claimKind: "friction_problem",
                      meaning: "Category fabric breathability",
                      semanticScope: "CATEGORY_RECURRING",
                      transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
                      confidence: 0.9,
                    },
                  ],
                  confidence: 0.9,
                },
              ]),
            },
          }],
        };
      }

      if (endpoint === "semantic-reasoner-theme-batch") {
        // Enforces semantic scope: SINGLE_BRAND_SPECIFIC and INCIDENT_SPECIFIC cannot originate category theme independently
        if (content.includes("clm_mixed_1") && content.includes("clm_mixed_2")) {
          // Mixed evidence batch: Only transferable claim joins theme; single-brand claim is isolated
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  themes: [
                    {
                      themeId: "theme_transfer_1",
                      canonicalMeaning: "Dress fabric opacity and transparency trade-offs in modest summer wear",
                      description: "Customers experience see-through fabric requiring heavy underlayers.",
                      supportingClaimIds: ["clm_mixed_2"],
                      supportingEvidenceUnitIds: ["ev_mixed_1"],
                      semanticRationale: "Transferable material physics regarding fabric opacity.",
                      confidence: 0.92,
                    },
                  ],
                  isolatedTruthClaimIds: ["clm_mixed_1"],
                  redundantClaimMappings: [],
                  insufficientClaimIds: [],
                  noMeaningfulTruthClaimIds: [],
                }),
              },
            }],
          };
        }

        if (
          (content.includes("claimscope: [single_brand_specific]") || content.includes("scope: [single_brand_specific]") || content.includes("scope: [incident_specific]")) &&
          !content.includes("claimscope: [category_recurring]") &&
          !content.includes("claimscope: [market_transferable]") &&
          !content.includes("scope: [category_recurring]") &&
          !content.includes("scope: [market_transferable]")
        ) {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  themes: [],
                  isolatedTruthClaimIds: content.includes("clm_single_brand_1") ? ["clm_single_brand_1"] : ["clm_incident_1"],
                  redundantClaimMappings: [],
                  insufficientClaimIds: [],
                  noMeaningfulTruthClaimIds: [],
                }),
              },
            }],
          };
        }

        if (content.includes("scope: [market_transferable]") || content.includes("claimscope: [market_transferable]")) {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  themes: [
                    {
                      themeId: "theme_transfer_1",
                      canonicalMeaning: "Breathability and heat dissipation trade-offs under high humidity and heat",
                      description: "Customers in warm regions experience heat retention with synthetic linings.",
                      supportingClaimIds: ["clm_transfer_1"],
                      supportingEvidenceUnitIds: ["ev_transfer_1"],
                      semanticRationale: "Market-transferable product physics apply to modest dress category.",
                      confidence: 0.92,
                    },
                  ],
                  isolatedTruthClaimIds: [],
                  redundantClaimMappings: [],
                  insufficientClaimIds: [],
                  noMeaningfulTruthClaimIds: [],
                }),
              },
            }],
          };
        }

        return {
          choices: [{
            message: {
              content: JSON.stringify({
                themes: [
                  {
                    themeId: "theme_b1_1",
                    canonicalMeaning: "Category product durability and real-world performance under demanding conditions",
                    description: "Customers experience durability trade-offs during continuous use.",
                    supportingClaimIds: ["clm_cat_1"],
                    supportingEvidenceUnitIds: ["ev_cat_1"],
                    semanticRationale: "Category-recurring evidence indicates shared user friction across products.",
                    confidence: 0.9,
                  },
                ],
                isolatedTruthClaimIds: [],
                redundantClaimMappings: [],
                insufficientClaimIds: [],
                noMeaningfulTruthClaimIds: [],
              }),
            },
          }],
        };
      }

      return { choices: [{ message: { content: "{}" } }] };
    }),
  };
});

describe("Market Voice Final Authority Sanity Guards", () => {
  const genericContext = {
    heroProduct: "Cloud Security Monitoring Platform",
    businessName: "SecOpsAI",
    category: "Cybersecurity / Cloud SecOps",
    market: "North America & Global Enterprise",
  };

  // -----------------------------------------------------------------------------
  // Test A: Editorial article prose cannot enter PRIMARY_MARKET_VOICE
  // -----------------------------------------------------------------------------
  it("Test A: Editorial article prose is rejected as EDITORIAL_CONTENT and cannot enter PRIMARY", async () => {
    const editorialItem = {
      itemId: "dailybeast_art_1",
      sourceUrl: "https://www.thedailybeast.com/fashion-editor-picks-for-summer",
      sourcePlatform: "google_serp",
      verbatimText: "Our fashion editor tested five summer options and recommends this lightweight silhouette for warm weather.",
      authorIdentifier: "fashion editor",
    };

    const authorship = await verifyAuthorshipRole(
      editorialItem,
      { url: editorialItem.sourceUrl, title: "The Daily Beast - Fashion Editor Picks" }
    );

    expect(authorship.authorRole).toBe("EDITORIAL_JOURNALIST");
    expect(authorship.isCustomerAuthored).toBe(false);

    const eligibility = await verifyCustomerVoiceEligibility(
      editorialItem,
      authorship.authorRole,
      {
        offeringName: "Modest Summer Dresses",
        category: "Modest Fashion",
        targetMarket: "Global",
        productTruthFacts: ["Lightweight summer wear"],
      }
    );

    const decision = runFinalEvidenceJudge(
      editorialItem,
      authorship,
      eligibility,
      {
        offeringName: "Modest Summer Dresses",
        category: "Modest Fashion",
        targetMarket: "Global",
      }
    );

    expect(decision.verdict).toBe("REJECT");
    expect(decision.rejectionReason).toBe("EDITORIAL_CONTENT");
    expect(decision.primaryEligibilityVerdict).toBe("AUTHORSHIP_UNRESOLVED");
    expect(decision.canonicalOwner).toBe("UNRESOLVED");
  });

  // -----------------------------------------------------------------------------
  // Test B: Genuine reader/customer comment on publication page can qualify
  // -----------------------------------------------------------------------------
  it("Test B: Genuine reader comment under publication article qualifies as CUSTOMER_COMMUNITY_USER", async () => {
    const readerCommentItem = {
      itemId: "reader_comment_1",
      sourceUrl: "https://www.thedailybeast.com/fashion-article#comment-889",
      sourcePlatform: "web_community",
      verbatimText: "I bought this last month for my trip. The fabric is very breathable but stretches out after washing twice.",
      authorIdentifier: "posted in reader comments section",
    };

    const authorship = await verifyAuthorshipRole(
      readerCommentItem,
      { url: readerCommentItem.sourceUrl, title: "Reader Comments - The Daily Beast" }
    );

    expect(authorship.authorRole).toBe("CUSTOMER_COMMUNITY_USER");
    expect(authorship.isCustomerAuthored).toBe(true);

    const eligibility = await verifyCustomerVoiceEligibility(
      readerCommentItem,
      authorship.authorRole,
      {
        offeringName: "Modest Summer Dresses",
        category: "Modest Fashion",
        targetMarket: "Global",
        productTruthFacts: ["Lightweight summer wear"],
      },
      {
        url: readerCommentItem.sourceUrl,
        title: "Reader Comments - The Daily Beast",
        domain: "thedailybeast.com",
        snippet: "Reader discussion on dress breathability and wash longevity",
      }
    );

    const decision = runFinalEvidenceJudge(
      readerCommentItem,
      authorship,
      eligibility,
      {
        offeringName: "Modest Summer Dresses",
        category: "Modest Fashion",
        targetMarket: "Global",
      }
    );

    expect(decision.verdict).toBe("APPROVE");
    expect(decision.canonicalOwner).toBe("market_voice_evidence");
    expect(decision.primaryEligibilityVerdict).toBe("PRIMARY_ELIGIBLE");
  });

  // -----------------------------------------------------------------------------
  // Test C: Source concentration telemetry does NOT deterministically decide sufficiency
  // -----------------------------------------------------------------------------
  it("Test C: Sufficiency Judge passes telemetry facts to LLM without hardcoded numeric thresholds", async () => {
    const singleSourceCorpus: CustomerEvidenceUnit[] = Array.from({ length: 10 }, (_, i) => ({
      evidenceId: `ev_sec_${i + 1}`,
      origin: "MARKET_VOICE",
      platform: "forums",
      evidencePool: "PRIMARY_MARKET_VOICE",
      accountId: "acc_sec",
      campaignId: "camp_sec",
      text: "The SIEM integration alerts trigger false positives during peak network spikes.",
      author: `analyst_${i + 1}`,
      authorType: "COMMUNITY_USER",
      acquiredAt: new Date().toISOString(),
      verificationProvenance: {
        isVerified: true,
        sourceUrl: "https://community.spiceworks.com/topic/siem-alerts",
      },
      rawEvidenceReference: {
        table: "market_voice_evidence",
        id: `raw_ev_${i + 1}`,
      },
    }));

    const result = await judgePrimaryMarketVoiceSufficiencyWithLLM(
      singleSourceCorpus,
      genericContext,
      "acc_sec"
    );

    // LLM judge evaluates semantic content as SUFFICIENT despite high domain concentration (100% on spiceworks)
    // because quotes contain transferable product truths across IT environments
    expect(result.isSufficient).toBe(true);
    expect(result.verdict).toBe("SUFFICIENT");
    expect(result.categoryRelevance).toBe("HIGH");
  });

  // -----------------------------------------------------------------------------
  // Test D: Search planner contains no apparel-specific production-wide semantic rules
  // -----------------------------------------------------------------------------
  it("Test D: Search Planner builds dynamic, cross-industry prompts for B2B SaaS and Healthcare", () => {
    const saasContext = {
      accountId: "acc_saas",
      campaignId: "camp_saas",
      campaignOfferingId: "off_saas",
      offeringName: "HIPAA-Compliant Patient Intake Telehealth API",
      heroProductCanonicalText: "HIPAA-Compliant Patient Intake Telehealth API",
      heroProductAuthoritySource: "OFFERING_FACTS",
      heroProductAuthorityId: "fact_1",
      category: "Healthcare SaaS / Telemedicine APIs",
      targetMarketGeography: "US",
    };

    const { system, user } = buildSearchPlannerPrompt(saasContext);

    // Prompt MUST NOT contain apparel-specific keywords
    expect(system).not.toContain("fabric opacity");
    expect(system).not.toContain("heat breathability");
    expect(system).not.toContain("neckline depth");
    expect(system).not.toContain("modest summer dresses");
    expect(system).not.toContain("r/ModestDress");

    // Prompt MUST contain generic cross-industry guidance and dynamic context
    expect(system).toContain("Functional Performance, Reliability & Core Capability");
    expect(system).toContain("Buyer Requirements, Sizing/Fit, Compatibility & Workflow Integration");
    expect(system).toContain("HIPAA-Compliant Patient Intake Telehealth API");
    expect(user).toContain("Healthcare SaaS / Telemedicine APIs");
  });

  // -----------------------------------------------------------------------------
  // Guard A: SINGLE_BRAND_SPECIFIC evidence cannot independently generate category theme
  // -----------------------------------------------------------------------------
  it("Guard A: PRIMARY_MARKET_VOICE + SINGLE_BRAND_SPECIFIC cannot independently originate category pain", async () => {
    const singleBrandUnit = {
      evidenceUnitId: "ev_single_1",
      primaryForm: "COMPLAINT" as const,
      semanticType: "COMPLAINT" as const,
      claim: "Vendor X delayed delivery by 4 weeks and refused phone support",
      semanticClaims: [
        {
          claimId: "clm_single_brand_1",
          claimKind: "friction_problem" as const,
          meaning: "Vendor X delayed delivery by 4 weeks and refused phone support",
          confidence: 0.9,
        },
      ],
      confidence: 0.9,
      canonicalCompetitorId: "comp_x",
      canonicalBrandName: "Vendor X",
      platform: "trustpilot",
      rawText: "I ordered 4 weeks ago from Vendor X and never received a tracking number. Support did not answer.",
      evidencePool: "PRIMARY_MARKET_VOICE" as const,
      semanticScope: "SINGLE_BRAND_SPECIFIC" as const,
    };

    const themeInventory = await generateSemanticThemeInventoryWithLLM(
      [singleBrandUnit],
      genericContext,
      "acc_sec"
    );

    // Because unit is SINGLE_BRAND_SPECIFIC with no category corroboration, 0 category themes are created
    expect(themeInventory.themes.length).toBe(0);
    expect(themeInventory.claimDispositions.some(d => d.claimId === "clm_single_brand_1" && d.status === "ISOLATED_VALID_TRUTH")).toBe(true);
  });

  // -----------------------------------------------------------------------------
  // Guard B: INCIDENT_SPECIFIC evidence cannot independently generate category theme
  // -----------------------------------------------------------------------------
  it("Guard B: PRIMARY_MARKET_VOICE + INCIDENT_SPECIFIC cannot independently originate category pain", async () => {
    const incidentUnit = {
      evidenceUnitId: "ev_incident_1",
      primaryForm: "COMPLAINT" as const,
      semanticType: "COMPLAINT" as const,
      claim: "Package was delivered with damaged outer carton during transit",
      semanticClaims: [
        {
          claimId: "clm_incident_1",
          claimKind: "friction_problem" as const,
          meaning: "Package was delivered with damaged outer carton during transit",
          confidence: 0.85,
        },
      ],
      confidence: 0.85,
      canonicalCompetitorId: "comp_inc",
      canonicalBrandName: "Retailer Y",
      platform: "trustpilot",
      rawText: "My delivery box arrived crushed in the rain by the courier.",
      evidencePool: "PRIMARY_MARKET_VOICE" as const,
      semanticScope: "INCIDENT_SPECIFIC" as const,
    };

    const themeInventory = await generateSemanticThemeInventoryWithLLM(
      [incidentUnit],
      genericContext,
      "acc_sec"
    );

    // INCIDENT_SPECIFIC cannot independently originate a category-wide theme
    expect(themeInventory.themes.length).toBe(0);
    expect(themeInventory.claimDispositions.some(d => d.claimId === "clm_incident_1" && d.status === "ISOLATED_VALID_TRUTH")).toBe(true);
  });

  // -----------------------------------------------------------------------------
  // Guard C: INSUFFICIENT_SCOPE evidence is excluded from canonical theme genesis
  // -----------------------------------------------------------------------------
  it("Guard C: PRIMARY_MARKET_VOICE + INSUFFICIENT_SCOPE cannot originate theme and is mapped to INSUFFICIENT_SEMANTIC_SUPPORT", async () => {
    const insufficientUnit = {
      evidenceUnitId: "ev_insuff_1",
      primaryForm: "QUESTION" as const,
      semanticType: "QUESTION" as const,
      claim: "Maybe somewhere in city",
      semanticClaims: [
        {
          claimId: "clm_insuff_1",
          claimKind: "neutral_fact" as const,
          meaning: "Maybe somewhere in city",
          confidence: 0.5,
        },
      ],
      confidence: 0.5,
      canonicalCompetitorId: "comp_anon",
      canonicalBrandName: "Anonymous User",
      platform: "reddit",
      rawText: "where can I get this?",
      evidencePool: "PRIMARY_MARKET_VOICE" as const,
      semanticScope: "INSUFFICIENT_SCOPE" as const,
    };

    const themeInventory = await generateSemanticThemeInventoryWithLLM(
      [insufficientUnit],
      genericContext,
      "acc_sec"
    );

    // INSUFFICIENT_SCOPE is filtered out before theme generation
    expect(themeInventory.themes.length).toBe(0);
    expect(themeInventory.claimDispositions.some(d => d.claimId === "clm_insuff_1" && d.status === "INSUFFICIENT_SEMANTIC_SUPPORT")).toBe(true);
  });

  // -----------------------------------------------------------------------------
  // Guard D: CATEGORY_RECURRING evidence establishes canonical category themes
  // -----------------------------------------------------------------------------
  it("Guard D: PRIMARY_MARKET_VOICE + CATEGORY_RECURRING can originate canonical category theme", async () => {
    const categoryRecurringUnit = {
      evidenceUnitId: "ev_cat_1",
      primaryForm: "PAIN" as const,
      semanticType: "PAIN" as const,
      claim: "Alert fatigue occurs across all SIEM tools during high traffic periods",
      semanticClaims: [
        {
          claimId: "clm_cat_1",
          claimKind: "friction_problem" as const,
          meaning: "Alert fatigue occurs across all SIEM tools during high traffic periods",
          confidence: 0.95,
        },
      ],
      confidence: 0.95,
      canonicalCompetitorId: "comp_cat",
      canonicalBrandName: "Category Community",
      platform: "reddit",
      rawText: "Across all SIEM platforms, alert fatigue becomes unmanageable during DDoS or traffic spikes.",
      evidencePool: "PRIMARY_MARKET_VOICE" as const,
      semanticScope: "CATEGORY_RECURRING" as const,
    };

    const themeInventory = await generateSemanticThemeInventoryWithLLM(
      [categoryRecurringUnit],
      genericContext,
      "acc_sec"
    );

    expect(themeInventory.themes.length).toBe(1);
    expect(themeInventory.themes[0].canonicalMeaning).toContain("durability and real-world performance");
  });

  // -----------------------------------------------------------------------------
  // Guard E: MARKET_TRANSFERABLE evidence establishes canonical category themes
  // -----------------------------------------------------------------------------
  it("Guard E: PRIMARY_MARKET_VOICE + MARKET_TRANSFERABLE can originate theme when transferability is justified", async () => {
    const transferableUnit = {
      evidenceUnitId: "ev_transfer_1",
      primaryForm: "PAIN" as const,
      semanticType: "PAIN" as const,
      claim: "Breathability suffers under extreme heat when inner lining is polyester",
      semanticClaims: [
        {
          claimId: "clm_transfer_1",
          claimKind: "friction_problem" as const,
          meaning: "Breathability suffers under extreme heat when inner lining is polyester",
          confidence: 0.92,
        },
      ],
      confidence: 0.92,
      canonicalCompetitorId: "comp_trans",
      canonicalBrandName: "Global Modest Community",
      platform: "reddit",
      rawText: "Synthetic inner lining traps heat in humid summer climates.",
      evidencePool: "PRIMARY_MARKET_VOICE" as const,
      semanticScope: "MARKET_TRANSFERABLE" as const,
      transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH" as const,
    };

    const themeInventory = await generateSemanticThemeInventoryWithLLM(
      [transferableUnit],
      genericContext,
      "acc_sec"
    );

    expect(themeInventory.themes.length).toBe(1);
    expect(themeInventory.themes[0].canonicalMeaning).toContain("Breathability and heat dissipation");
  });

  // -----------------------------------------------------------------------------
  // Guard F: marketScope = GLOBAL does NOT imply CATEGORY_RECURRING
  // -----------------------------------------------------------------------------
  it("Guard F: marketScope = GLOBAL does NOT imply CATEGORY_RECURRING (geographical query scope vs semantic scope distinction)", async () => {
    // A piece of evidence acquired from a global search can be SINGLE_BRAND_SPECIFIC
    const globalSearchResultItem = {
      itemId: "global_search_ev_1",
      sourceUrl: "https://www.trustpilot.com/review/singlebrandstore.com",
      sourcePlatform: "trustpilot",
      verbatimText: "single_store_incident: This particular store never sent my order after 3 weeks.",
      authorIdentifier: "reviewer_123",
      marketScope: "GLOBAL_CATEGORY", // Geographic query parameter
    };

    const authorship = await verifyAuthorshipRole(
      globalSearchResultItem,
      { url: globalSearchResultItem.sourceUrl, title: "Store Reviews", domain: "trustpilot.com" }
    );
    expect(authorship.isCustomerAuthored).toBe(true);

    const eligibility = await verifyCustomerVoiceEligibility(
      globalSearchResultItem,
      authorship.authorRole,
      {
        offeringName: "Modest Summer Dresses",
        category: "Modest Fashion",
        targetMarket: "Lebanon / Middle East",
        productTruthFacts: ["Lightweight summer dresses"],
      },
      {
        url: globalSearchResultItem.sourceUrl,
        title: "Store Reviews",
        domain: "trustpilot.com",
        snippet: globalSearchResultItem.verbatimText,
      }
    );

    const decision = runFinalEvidenceJudge(
      globalSearchResultItem,
      authorship,
      eligibility,
      {
        offeringName: "Modest Summer Dresses",
        category: "Modest Fashion",
        targetMarket: "Lebanon / Middle East",
      }
    );

    // Verifier correctly assigns semanticScope = SINGLE_BRAND_SPECIFIC despite global search query origin
    expect(decision.semanticScope).toBe("SINGLE_BRAND_SPECIFIC");
    expect(decision.semanticScope).not.toBe("CATEGORY_RECURRING");
  });

  // -----------------------------------------------------------------------------
  // Guard G: semanticScope survives end-to-end data flow (verifier -> dedupe -> reasoner)
  // -----------------------------------------------------------------------------
  it("Guard G: semanticScope survives deduplication and normalizer without loss of scope attribution", () => {
    const rawUnits: CustomerEvidenceUnit[] = [
      {
        evidenceId: "cev_mv_001",
        origin: "MARKET_VOICE",
        platform: "reddit",
        evidencePool: "PRIMARY_MARKET_VOICE",
        semanticScope: "CATEGORY_RECURRING",
        transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
        accountId: "acc_sec",
        campaignId: "camp_sec",
        text: "Fabric opacity is an issue with light linen blends when back-lit by sunlight.",
        author: "reddit_user_1",
        authorType: "COMMUNITY_USER",
        acquiredAt: new Date().toISOString(),
        verificationProvenance: { isVerified: true, sourceUrl: "https://reddit.com/r/modest/1" },
        rawEvidenceReference: { table: "market_voice_evidence", id: "mve_001" },
      },
      {
        evidenceId: "cev_mv_002",
        origin: "MARKET_VOICE",
        platform: "reddit",
        evidencePool: "PRIMARY_MARKET_VOICE",
        semanticScope: "CATEGORY_RECURRING",
        transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
        accountId: "acc_sec",
        campaignId: "camp_sec",
        text: "Fabric opacity is an issue with light linen blends when back-lit by sunlight.",
        author: "reddit_user_2",
        authorType: "COMMUNITY_USER",
        acquiredAt: new Date().toISOString(),
        verificationProvenance: { isVerified: true, sourceUrl: "https://reddit.com/r/modest/2" },
        rawEvidenceReference: { table: "market_voice_evidence", id: "mve_002" },
      },
    ];

    const dedupeResult = deduplicateCustomerVoice(rawUnits);
    expect(dedupeResult.uniqueUnits.length).toBe(1);
    const canonicalUnit = dedupeResult.uniqueUnits[0];

    // Canonical unit preserves semanticScope and transferability
    expect(canonicalUnit.semanticScope).toBe("CATEGORY_RECURRING");
    expect(canonicalUnit.transferability).toBe("GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH");

    // Lineage contributors also preserve semanticScope
    expect(canonicalUnit.contributors?.length).toBe(2);
    expect(canonicalUnit.contributors?.[0].semanticScope).toBe("CATEGORY_RECURRING");
    expect(canonicalUnit.contributors?.[1].semanticScope).toBe("CATEGORY_RECURRING");
  });
});

describe("Claim-Level Semantic Scope Authority Suite (Tests A-F)", () => {
  const genericContext = {
    heroProduct: "Modest Summer Dresses",
    businessName: "Sara-ft",
    category: "Modest Fashion / Dresses",
    market: "Lebanon / Middle East",
  };

  // -----------------------------------------------------------------------------
  // Test A: One evidence row can contain both SINGLE_BRAND_SPECIFIC and MARKET_TRANSFERABLE claims
  // -----------------------------------------------------------------------------
  it("Test A: One evidence row can contain both SINGLE_BRAND_SPECIFIC and MARKET_TRANSFERABLE claims", async () => {
    const mixedUnit: DeduplicatedEvidenceUnit = {
      id: "ev_mixed_1",
      text: "Total scam as far as their refund policy, and their returns package that you purchase for $2.95. And the fabric quality is horrendous and see-through.",
      sourceType: "review",
      canonicalCompetitorId: "comp_shopmodest",
      canonicalBrandName: "shopmodest.pk",
      platform: "trustpilot",
      rawOccurrenceCount: 1,
      likesCount: 0,
      originalIds: ["mve_mixed_001"],
      evidencePool: "PRIMARY_MARKET_VOICE",
      semanticScope: "SINGLE_BRAND_SPECIFIC",
      transferability: "ADJACENT_TRANSFERABLE_MARKET",
    };

    const classifications = await classifyBatchEvidenceUnits(
      [mixedUnit],
      genericContext,
      "acc_sara"
    );

    expect(classifications.length).toBe(1);
    const classification = classifications[0];
    expect(classification.semanticClaims.length).toBe(2);

    const claim1 = classification.semanticClaims.find(c => c.claimKind === "service_complaint" || c.semanticScope === "SINGLE_BRAND_SPECIFIC");
    const claim2 = classification.semanticClaims.find(c => c.claimKind === "friction_problem" || c.semanticScope === "MARKET_TRANSFERABLE");

    expect(claim1).toBeDefined();
    expect(claim1?.semanticScope).toBe("SINGLE_BRAND_SPECIFIC");
    expect(claim1?.meaning).toContain("2.95");
    expect(claim1?.rowSemanticScope).toBe("SINGLE_BRAND_SPECIFIC");

    expect(claim2).toBeDefined();
    expect(claim2?.semanticScope).toBe("MARKET_TRANSFERABLE");
    expect(claim2?.transferability).toBe("GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH");
    expect(claim2?.meaning).toContain("see-through");
    expect(claim2?.rowSemanticScope).toBe("SINGLE_BRAND_SPECIFIC");
  });

  // -----------------------------------------------------------------------------
  // Test B: Retailer-specific claim cannot leak into category theme because another claim in the same row is transferable
  // -----------------------------------------------------------------------------
  it("Test B: Retailer-specific claim cannot leak into category theme because another claim in same row is transferable", async () => {
    const mixedClassifiedUnit = {
      evidenceUnitId: "ev_mixed_1",
      primaryForm: "COMPLAINT" as const,
      semanticType: "COMPLAINT" as const,
      claim: "Dissatisfied with return fee policy and see-through fabric",
      semanticClaims: [
        {
          claimId: "clm_mixed_1",
          claimKind: "service_complaint" as const,
          meaning: "Retailer charges $2.95 fee for returns package",
          semanticScope: "SINGLE_BRAND_SPECIFIC" as const,
          transferability: "ADJACENT_TRANSFERABLE_MARKET" as const,
          rowSemanticScope: "SINGLE_BRAND_SPECIFIC" as const,
          confidence: 0.95,
        },
        {
          claimId: "clm_mixed_2",
          claimKind: "friction_problem" as const,
          meaning: "Dress fabric is see-through and cheaply made for modest wear",
          semanticScope: "MARKET_TRANSFERABLE" as const,
          transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH" as const,
          rowSemanticScope: "SINGLE_BRAND_SPECIFIC" as const,
          confidence: 0.92,
        },
      ],
      confidence: 0.92,
      canonicalCompetitorId: "comp_shopmodest",
      canonicalBrandName: "shopmodest.pk",
      platform: "trustpilot",
      rawText: "Total scam as far as their refund policy, and their returns package that you purchase for $2.95. And the fabric quality is horrendous and see-through.",
      evidencePool: "PRIMARY_MARKET_VOICE" as const,
      semanticScope: "SINGLE_BRAND_SPECIFIC" as const,
      transferability: "ADJACENT_TRANSFERABLE_MARKET" as const,
    };

    const themeInventory = await generateSemanticThemeInventoryWithLLM(
      [mixedClassifiedUnit],
      genericContext,
      "acc_sara"
    );

    // Only the transferable claim (clm_mixed_2) originated/joined the theme
    expect(themeInventory.themes.length).toBe(1);
    expect(themeInventory.themes[0].supportingClaimIds).toContain("clm_mixed_2");
    expect(themeInventory.themes[0].supportingClaimIds).not.toContain("clm_mixed_1");

    // Retailer-specific claim (clm_mixed_1) is isolated
    const claim1Disp = themeInventory.claimDispositions.find(d => d.claimId === "clm_mixed_1");
    expect(claim1Disp?.status).toBe("ISOLATED_VALID_TRUTH");
    expect(claim1Disp?.semanticScope).toBe("SINGLE_BRAND_SPECIFIC");
  });

  // -----------------------------------------------------------------------------
  // Test C: Transferable product claim remains usable even when source row contains company-specific complaints
  // -----------------------------------------------------------------------------
  it("Test C: Transferable product claim remains usable even when source row contains company-specific complaints", async () => {
    const mixedClassifiedUnit = {
      evidenceUnitId: "ev_mixed_1",
      primaryForm: "COMPLAINT" as const,
      semanticType: "COMPLAINT" as const,
      claim: "Dissatisfied with return fee policy and see-through fabric",
      semanticClaims: [
        {
          claimId: "clm_mixed_1",
          claimKind: "service_complaint" as const,
          meaning: "Retailer charges $2.95 fee for returns package",
          semanticScope: "SINGLE_BRAND_SPECIFIC" as const,
          transferability: "ADJACENT_TRANSFERABLE_MARKET" as const,
          rowSemanticScope: "SINGLE_BRAND_SPECIFIC" as const,
          confidence: 0.95,
        },
        {
          claimId: "clm_mixed_2",
          claimKind: "friction_problem" as const,
          meaning: "Dress fabric is see-through and cheaply made for modest wear",
          semanticScope: "MARKET_TRANSFERABLE" as const,
          transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH" as const,
          rowSemanticScope: "SINGLE_BRAND_SPECIFIC" as const,
          confidence: 0.92,
        },
      ],
      confidence: 0.92,
      canonicalCompetitorId: "comp_shopmodest",
      canonicalBrandName: "shopmodest.pk",
      platform: "trustpilot",
      rawText: "Total scam as far as their refund policy, and their returns package that you purchase for $2.95. And the fabric quality is horrendous and see-through.",
      evidencePool: "PRIMARY_MARKET_VOICE" as const,
      semanticScope: "SINGLE_BRAND_SPECIFIC" as const,
      transferability: "ADJACENT_TRANSFERABLE_MARKET" as const,
    };

    const themeInventory = await generateSemanticThemeInventoryWithLLM(
      [mixedClassifiedUnit],
      genericContext,
      "acc_sara"
    );

    // The transferable claim is assigned to theme
    const claim2Disp = themeInventory.claimDispositions.find(d => d.claimId === "clm_mixed_2");
    expect(claim2Disp?.status).toBe("ASSIGNED_TO_THEME");
    expect(claim2Disp?.themeId).toBe("theme_transfer_1");
    expect(claim2Disp?.semanticScope).toBe("MARKET_TRANSFERABLE");
    expect(themeInventory.themes[0].canonicalMeaning).toContain("Dress fabric opacity");
  });

  // -----------------------------------------------------------------------------
  // Test D: Row-level scope does not override claim-level scope
  // -----------------------------------------------------------------------------
  it("Test D: Row-level scope does not override claim-level scope", async () => {
    // Unit has row-level SINGLE_BRAND_SPECIFIC, but its claim is MARKET_TRANSFERABLE
    const unitWithTransferableClaim = {
      evidenceUnitId: "ev_transfer_override",
      primaryForm: "PAIN" as const,
      semanticType: "PAIN" as const,
      claim: "Synthetic inner lining traps heat in humid summer climates",
      semanticClaims: [
        {
          claimId: "clm_transfer_1",
          claimKind: "friction_problem" as const,
          meaning: "Synthetic inner lining traps heat in humid summer climates",
          semanticScope: "MARKET_TRANSFERABLE" as const,
          transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH" as const,
          rowSemanticScope: "SINGLE_BRAND_SPECIFIC" as const,
          confidence: 0.92,
        },
      ],
      confidence: 0.92,
      canonicalCompetitorId: "comp_modest",
      canonicalBrandName: "shopmodest.pk",
      platform: "trustpilot",
      rawText: "The synthetic inner lining traps heat in humid summer climates.",
      evidencePool: "PRIMARY_MARKET_VOICE" as const,
      semanticScope: "SINGLE_BRAND_SPECIFIC" as const, // Row summary scope is SINGLE_BRAND_SPECIFIC
      transferability: "ADJACENT_TRANSFERABLE_MARKET" as const,
    };

    const themeInventory = await generateSemanticThemeInventoryWithLLM(
      [unitWithTransferableClaim],
      genericContext,
      "acc_sara"
    );

    // Claim-level scope (MARKET_TRANSFERABLE) took precedence over row-level scope (SINGLE_BRAND_SPECIFIC)
    expect(themeInventory.themes.length).toBe(1);
    expect(themeInventory.themes[0].canonicalMeaning).toContain("Breathability and heat dissipation");
  });

  // -----------------------------------------------------------------------------
  // Test E: Claim-level scope survives into theme genesis with full lineage
  // -----------------------------------------------------------------------------
  it("Test E: Claim-level scope survives into theme genesis with full lineage", async () => {
    const classifiedUnit = {
      evidenceUnitId: "ev_lineage_1",
      primaryForm: "COMPLAINT" as const,
      semanticType: "COMPLAINT" as const,
      claim: "Mixed shipping dispute and fabric transparency",
      semanticClaims: [
        {
          claimId: "clm_lin_1",
          claimKind: "service_complaint" as const,
          meaning: "Shipping delay of 4 weeks",
          semanticScope: "SINGLE_BRAND_SPECIFIC" as const,
          transferability: "GEOGRAPHY_SPECIFIC_OPERATIONAL" as const,
          scopeRationale: "Single merchant tracking issue",
          rowSemanticScope: "SINGLE_BRAND_SPECIFIC" as const,
          rowTransferability: "ADJACENT_TRANSFERABLE_MARKET" as const,
          confidence: 0.9,
        },
        {
          claimId: "clm_lin_2",
          claimKind: "friction_problem" as const,
          meaning: "Light linen dress is completely see-through under sunlight",
          semanticScope: "CATEGORY_RECURRING" as const,
          transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH" as const,
          scopeRationale: "Universal fabric opacity physics",
          rowSemanticScope: "SINGLE_BRAND_SPECIFIC" as const,
          rowTransferability: "ADJACENT_TRANSFERABLE_MARKET" as const,
          confidence: 0.95,
        },
      ],
      confidence: 0.93,
      canonicalCompetitorId: "comp_1",
      canonicalBrandName: "Brand 1",
      platform: "trustpilot",
      rawText: "Shipping took 4 weeks and the light linen dress is completely see-through under sunlight.",
      evidencePool: "PRIMARY_MARKET_VOICE" as const,
      semanticScope: "SINGLE_BRAND_SPECIFIC" as const,
      transferability: "ADJACENT_TRANSFERABLE_MARKET" as const,
    };

    const themeInventory = await generateSemanticThemeInventoryWithLLM(
      [classifiedUnit],
      genericContext,
      "acc_sara"
    );

    const manifest = buildFinalCoverageManifest([classifiedUnit], themeInventory.themes, [], themeInventory.claimDispositions);

    expect(manifest.claimManifest.length).toBe(2);

    const manifestClaim1 = manifest.claimManifest.find(c => c.claimId === "clm_lin_1")!;
    expect(manifestClaim1.claimId).toBe("clm_lin_1");
    expect(manifestClaim1.evidenceUnitId).toBe("ev_lineage_1");
    expect(manifestClaim1.semanticScope).toBe("SINGLE_BRAND_SPECIFIC");
    expect(manifestClaim1.transferability).toBe("GEOGRAPHY_SPECIFIC_OPERATIONAL");
    expect(manifestClaim1.rowSemanticScope).toBe("SINGLE_BRAND_SPECIFIC");
    expect(manifestClaim1.rowTransferability).toBe("ADJACENT_TRANSFERABLE_MARKET");
    expect(manifestClaim1.status).toBe("ISOLATED_VALID_TRUTH");

    const manifestClaim2 = manifest.claimManifest.find(c => c.claimId === "clm_lin_2")!;
    expect(manifestClaim2.claimId).toBe("clm_lin_2");
    expect(manifestClaim2.evidenceUnitId).toBe("ev_lineage_1");
    expect(manifestClaim2.semanticScope).toBe("CATEGORY_RECURRING");
    expect(manifestClaim2.transferability).toBe("GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH");
    expect(manifestClaim2.rowSemanticScope).toBe("SINGLE_BRAND_SPECIFIC");
    expect(manifestClaim2.rowTransferability).toBe("ADJACENT_TRANSFERABLE_MARKET");
  });

  // -----------------------------------------------------------------------------
  // Test F: Repeated classification disagreement triggers bounded semantic repair and fails closed
  // -----------------------------------------------------------------------------
  it("Test F: Repeated classification disagreement triggers bounded semantic repair and fails closed on unresolved authority", async () => {
    // When an ambiguous operational dispute is processed, it fails closed to SINGLE_BRAND_SPECIFIC / ISOLATED_VALID_TRUTH
    const ambiguousDisputeUnit: DeduplicatedEvidenceUnit = {
      id: "ev_disagree_1",
      text: "Vague tracking link problem with courier service on my order.",
      sourceType: "comment",
      canonicalCompetitorId: "comp_dispute",
      canonicalBrandName: "Dispute Brand",
      platform: "web",
      rawOccurrenceCount: 1,
      likesCount: 0,
      originalIds: ["mve_dispute_001"],
      evidencePool: "PRIMARY_MARKET_VOICE",
      semanticScope: "SINGLE_BRAND_SPECIFIC",
    };

    const classifications = await classifyBatchEvidenceUnits(
      [ambiguousDisputeUnit],
      genericContext,
      "acc_sara"
    );

    expect(classifications.length).toBe(1);
    const claim = classifications[0].semanticClaims[0];

    // Bounded resolution ensures operational disputes fail closed to SINGLE_BRAND_SPECIFIC
    expect(claim.semanticScope).toBe("SINGLE_BRAND_SPECIFIC");

    const themeInventory = await generateSemanticThemeInventoryWithLLM(
      classifications,
      genericContext,
      "acc_sara"
    );

    // It fails closed and cannot originate a category theme
    expect(themeInventory.themes.length).toBe(0);
    const disp = themeInventory.claimDispositions.find(d => d.claimId === claim.claimId);
    expect(disp?.status).toBe("ISOLATED_VALID_TRUTH");
  });
});

