import assert from "node:assert/strict";
import {
  normalizeDocumentUrl,
  extractAnchorDocumentLinks,
} from "../../shared/web-ingestion-guard";
import {
  cleanHtmlToText,
  extractStructuredHtmlSections,
} from "../../business-understanding/crawler";
import {
  analyzeCompanyWebsite,
  normalizeClassificationProfile,
} from "../../setup/website-analyzer";
import {
  checkDiscoverySessionCompatibility,
  type PinnedDiscoveryContext,
} from "../context-binder";
import {
  verifyCompetitorIdentity,
  verifyCompetitorRelevance,
  runCompetitorFinalJudge,
  classifyEvidenceSourceType,
} from "../competitor-quality-pipeline";
import { evaluateCompetitorDiscoveryReadiness } from "../discovery-readiness";
import {
  runCompetitorDiscoveryEngine,
  planDiscoveryMissions,
  DiscoveryBudgetTracker,
} from "../competitor-discovery-engine";
import { resolveMarketLocalization } from "../../shared/market-localization";
import { withStrictLlmMock } from "../../orchestrator/replay/llm-strict-mock";
import type {
  CandidateProvenance,
  DiscoveryMission,
} from "@shared/contracts/discovery-contracts";
import type { BusinessClassificationProfile } from "@shared/business-understanding-types";

/**
 * Helper to create an in-memory LLM mock compatible with `withStrictLlmMock`.
 * Inspects the prompt/messages and returns a deterministic JSON completion without network calls.
 */
function createContextualLlmMock(
  handler: (promptText: string, model: string) => Record<string, any>
) {
  let totalCalls = 0;
  const promptsSeen: string[] = [];

  const mock = {
    getCallCount: () => totalCalls,
    getPromptsSeen: () => promptsSeen,
    resolve: (_provider: "openai" | "gemini", model: string, payload: any) => {
      totalCalls++;
      const messages = Array.isArray(payload?.messages) ? payload.messages : [];
      const fullPrompt = messages
        .map((m: any) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
        .join("\n");
      promptsSeen.push(fullPrompt);
      const responseObj = handler(fullPrompt, model);
      return {
        id: `mock_chat_${totalCalls}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify(responseObj),
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 100,
          total_tokens: 200,
        },
      };
    },
  };

  return mock;
}

async function runAllTests() {
  console.log("=== Running Songai Setup & Competitor Discovery Offline Verification Suite ===\n");

  // ============================================================================
  // SCENARIO 1: Fragment URL deduplication & preservation of key HTML sections
  // ============================================================================
  console.log("Test 1: Fragment URL deduplication and structured HTML section preservation...");
  {
    const base = "https://thesongai.com/";
    const fragPricing = normalizeDocumentUrl("https://thesongai.com/#pricing");
    const fragFaq = normalizeDocumentUrl("/#faq", base);
    const rootNorm = normalizeDocumentUrl("https://thesongai.com");

    assert.equal(fragPricing?.canonicalUrl, "https://thesongai.com/", "Fragment #pricing must normalize to canonical root document URL");
    assert.equal(fragPricing?.fragment, "pricing", "Fragment identifier must be extracted separately");
    assert.equal(fragFaq?.canonicalUrl, "https://thesongai.com/", "Relative fragment /#faq must normalize to canonical root document URL");
    assert.equal(rootNorm?.canonicalUrl, "https://thesongai.com/", "Root URL must match normalized fragment URL");

    const sampleHtmlWithFragments = `
      <html>
        <head>
          <title>SongAI — AI Personalized Song & Audio Platform</title>
          <meta name="description" content="Create studio-quality custom songs and commercial audio with AI." />
        </head>
        <body>
          <nav>
            <a href="https://thesongai.com/#how-it-works">How It Works</a>
            <a href="https://thesongai.com/#pricing">Pricing</a>
            <a href="https://thesongai.com/#b2b">For Businesses & Brands</a>
            <a href="https://thesongai.com/enterprise">Enterprise Studio</a>
          </nav>
          <main>
            <h1>Turn Stories & Brand Briefs into Studio Songs</h1>
            <p>${"Introductory storytelling paragraph about custom music creation. ".repeat(110)}</p>
            <section id="delivery">
              <h2>Instant Digital Delivery</h2>
              <p>Delivered online via high-resolution MP3, WAV, and shareable web streaming player within 24 hours. No physical shipping required.</p>
            </section>
            <section id="b2b">
              <h2>For Businesses, Agencies, and Corporate Teams</h2>
              <p>B2B audio branding, custom commercial jingles, employee recognition songs, and bulk API/SaaS studio workflows for marketing agencies.</p>
            </section>
            <section id="pricing">
              <h2>Simple, Transparent Pricing</h2>
              <p>Personal Song Creation: $49 one-time purchase. Pro Creator & Agency SaaS Workspace: $199/month subscription with commercial licensing.</p>
            </section>
            <section id="faq">
              <h2>Frequently Asked Questions</h2>
              <p>Q: Can companies use SongAI for commercial campaigns? A: Yes, full commercial rights are included in our Business and Agency plans.</p>
            </section>
          </main>
        </body>
      </html>
    `;

    const links = extractAnchorDocumentLinks(sampleHtmlWithFragments, base);
    const uniqueUrls = links.map((l) => l.url);
    assert.equal(
      uniqueUrls.filter((u) => u === "https://thesongai.com/").length,
      0,
      "Self-links and #fragment links to the base URL must not be queued as separate crawl pages"
    );
    assert.deepEqual(
      uniqueUrls,
      ["https://thesongai.com/enterprise"],
      "Only genuinely distinct document URLs should be extracted for crawling"
    );

    const extractedText = cleanHtmlToText(sampleHtmlWithFragments, 7500);
    const structured = extractStructuredHtmlSections(sampleHtmlWithFragments);

    assert.ok(
      extractedText.includes("$49 one-time purchase") && extractedText.includes("$199/month subscription"),
      "cleanHtmlToText must preserve bottom-of-page pricing section even after >6,000 chars of intro text"
    );
    assert.ok(
      extractedText.includes("For Businesses, Agencies, and Corporate Teams"),
      "cleanHtmlToText must preserve B2B buyer-segment section"
    );
    assert.ok(
      extractedText.includes("Instant Digital Delivery"),
      "cleanHtmlToText must preserve digital delivery model section"
    );
    const allHighSignal = structured.highSignalBlocks.join("\n");
    assert.ok(
      allHighSignal.includes("[SECTION #pricing]") && allHighSignal.includes("[SECTION #b2b]"),
      "extractStructuredHtmlSections must isolate #pricing and #b2b sections"
    );
    assert.ok(
      structured.extractionGaps.some((g) => g.includes("#how-it-works")),
      "extractStructuredHtmlSections must report an extractionGap when a linked in-page section (#how-it-works) is missing from static HTML"
    );
  }
  console.log("  ✓ Passed Scenario 1\n");

  // ============================================================================
  // SCENARIO 2: Non-retail business with online checkout/gifting is NOT forced into physical e-commerce
  // ============================================================================
  console.log("Test 2: Evidence-based multi-dimensional business classification (no forced E-Commerce from $/checkout/gift)...");
  {
    // 2a. Verify fallback normalizer does not force "cart"/"checkout"/"$"/"gift" into physical e-commerce
    const fallbackProfile = normalizeClassificationProfile(undefined, [
      "Buy now for $49 at checkout — create a personalized song gift or commercial brand anthem in our web app.",
    ]);
    assert.notEqual(
      fallbackProfile.offeringAndDelivery.category,
      "PHYSICAL_PRODUCT",
      "Checkout/$49/gift vocabulary must never force PHYSICAL_PRODUCT classification"
    );

    // 2b. Verify analyzeWebsite with contextual LLM output preserves separate dimensions (SaaS/Digital, B2B_AND_B2C, Hybrid/One-time)
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        `<html><head><title>SongAI Platform</title></head><body>
          <h1>AI Custom Song & Commercial Audio SaaS</h1>
          <p>Create custom songs for loved ones ($49 checkout) or launch B2B brand audio campaigns for marketing teams.</p>
        </body></html>`,
        { status: 200, headers: { "content-type": "text/html" } }
      )) as any;

    try {
      const llmMock = createContextualLlmMock(() => ({
        companyName: "SongAI Media",
        industry: "AI Music Generation & Custom Audio SaaS",
        offerings: ["AI Custom Song Generator", "B2B Brand Audio Studio"],
        detectedAudience: "B2C gift buyers and B2B marketing teams, agencies, and HR leaders",
        valueProposition: "Studio-quality personalized songs and brand audio generated on demand via web platform.",
        businessModel: "Hybrid SaaS & Digital On-Demand Audio Platform",
        detectedMarkets: ["United Arab Emirates"],
        summary: "SongAI provides an online AI-assisted music creation platform serving both consumers and business teams.",
        classificationProfile: {
          offeringAndDelivery: {
            category: "SAAS_OR_WEB_APPLICATION",
            confidence: "HIGH",
            reasoning: "Delivered entirely online as a web-based AI music creation application.",
            supportingEvidence: ["AI Custom Song & Commercial Audio SaaS", "web platform"],
          },
          buyerSegment: {
            category: "B2B_AND_B2C",
            confidence: "HIGH",
            reasoning: "Serves both individual gift buyers (B2C) and marketing teams/agencies (B2B).",
            supportingEvidence: ["loved ones ($49 checkout)", "B2B brand audio campaigns for marketing teams"],
          },
          monetization: {
            category: "ONE_TIME_PURCHASE",
            confidence: "MEDIUM",
            reasoning: "Website shows $49 per-song checkout; recurring subscription tiers are not yet detailed on homepage.",
            supportingEvidence: ["$49 checkout"],
            uncertaintyNote: "Enterprise/B2B subscription pricing is not listed on the public landing page.",
          },
          evidenceGaps: ["B2B subscription tier pricing is not publicly listed on the homepage."],
        },
      }));

      const analysis = await withStrictLlmMock(llmMock as any, () =>
        analyzeCompanyWebsite("test_acc", "test_camp", "https://thesongai.com", { skipPersistence: true })
      );

      assert.equal(analysis.classificationProfile.offeringAndDelivery.category, "SAAS_OR_WEB_APPLICATION");
      assert.equal(analysis.classificationProfile.buyerSegment.category, "B2B_AND_B2C");
      assert.equal(analysis.classificationProfile.monetization.category, "ONE_TIME_PURCHASE");
      assert.ok(
        !analysis.businessModel.toLowerCase().includes("direct-to-consumer"),
        "businessModel must not be overwritten by deterministic D2C/E-Commerce keyword rules"
      );
      assert.deepEqual(analysis.detectedMarkets, ["United Arab Emirates"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
  console.log("  ✓ Passed Scenario 2\n");

  // ============================================================================
  // SCENARIO 3: Missing pricing/subscription details surfaced as uncertainty/evidenceGaps
  // ============================================================================
  console.log("Test 3: Missing pricing/subscription details surfaced as UNKNOWN + evidenceGaps (not negative facts)...");
  {
    const uncertainProfile = normalizeClassificationProfile({
      offeringAndDelivery: {
        category: "SAAS_OR_WEB_APPLICATION",
        confidence: "HIGH",
        reasoning: "Browser-based AI music studio.",
        supportingEvidence: ["Web studio interface"],
      },
      buyerSegment: {
        category: "B2B_AND_B2C",
        confidence: "MEDIUM",
        reasoning: "Mentions personal songs and business campaigns.",
        supportingEvidence: ["Personal & corporate audio"],
      },
      monetization: {
        category: "UNKNOWN",
        confidence: "INSUFFICIENT_EVIDENCE",
        reasoning: "No pricing table or checkout terms were found in the extracted HTML.",
        supportingEvidence: [],
        uncertaintyNote: "Pricing and billing model (subscription vs. per-song purchase) could not be verified from extracted pages.",
      },
      evidenceGaps: [
        "Public pricing page could not be extracted; monetization model remains UNKNOWN rather than assumed one-time or subscription.",
      ],
    });

    assert.equal(uncertainProfile.monetization.category, "UNKNOWN");
    assert.equal(uncertainProfile.monetization.confidence, "INSUFFICIENT_EVIDENCE");
    assert.ok(
      uncertainProfile.monetization.uncertaintyNote?.includes("could not be verified"),
      "Uncertainty note must be preserved when pricing evidence is missing"
    );
    assert.equal(uncertainProfile.evidenceGaps.length, 1);
    assert.ok(uncertainProfile.evidenceGaps[0].includes("monetization model remains UNKNOWN"));
  }
  console.log("  ✓ Passed Scenario 3\n");

  // ============================================================================
  // SCENARIO 4 & 5: Canonical BU replaces stale preliminary classification & full BU facts/roles reach discovery
  // ============================================================================
  console.log("Test 4 & 5: Canonical BU overrides preliminary classification and passes all facts (>5) + source IDs + B2B/B2C roles to discovery...");
  {
    const canonicalClassification: BusinessClassificationProfile = normalizeClassificationProfile({
      offeringAndDelivery: {
        category: "SAAS_OR_WEB_APPLICATION",
        confidence: "HIGH",
        reasoning: "Cloud AI song & audio generation platform with instant digital delivery.",
        supportingEvidence: ["[src_1] Cloud AI music studio", "[src_2] Instant MP3/WAV download"],
      },
      buyerSegment: {
        category: "B2B_AND_B2C",
        confidence: "HIGH",
        reasoning: "Serves both consumer gifting and B2B marketing, agency, and corporate HR buyers.",
        supportingEvidence: ["[src_3] Personal song gifts", "[src_7] Corporate audio branding & agency workflows"],
      },
      monetization: {
        category: "HYBRID",
        confidence: "HIGH",
        reasoning: "Offers per-song checkout for consumers and SaaS workspace plans for business teams.",
        supportingEvidence: ["[src_4] Per-song checkout", "[src_8] Business workspace plan"],
      },
      evidenceGaps: ["Enterprise SLA pricing requires custom quote."],
    });

    // 8 canonical facts (previously truncated at .slice(0, 5), which dropped facts #6, #7, #8!)
    const allEightCanonicalFacts = [
      "Fact 1: Generates personalized studio-quality songs from user prompts [src_1]",
      "Fact 2: Supports multiple genres including Pop, R&B, Khaliji, and Indie [src_2]",
      "Fact 3: Delivers digital MP3/WAV audio and lyrics online within 24 hours [src_3]",
      "Fact 4: Offers consumer gifting experiences for birthdays, weddings, and anniversaries [src_4]",
      "Fact 5: Provides browser-based lyric editing and vocal style selection [src_5]",
      "Fact 6: Provides B2B commercial licensing for brand campaigns and social media ads [src_6]",
      "Fact 7: Serves marketing agencies and corporate HR teams with custom brand anthems [src_7]",
      "Fact 8: Supports multi-seat SaaS workspace collaboration for business accounts [src_8]",
    ];

    const allFourCanonicalRoles = [
      "Consumer Gift Buyers (Birthdays, Weddings, Anniversaries) [role_1]",
      "B2B Marketing Directors & Brand Managers [role_2]",
      "Creative & Advertising Agencies [role_3]",
      "Corporate HR & Employee Engagement Leads [role_4]",
    ];

    const pinnedContext: PinnedDiscoveryContext = {
      accountId: "acc_songai_test",
      campaignId: "camp_songai_uae",
      buSnapshotId: "bu_snap_canonical_v2",
      campaignOfferingId: "off_songai_platform_v2",
      businessName: "SongAI Media",
      offeringName: "SongAI — Personalized AI Song & Commercial Audio Platform",
      category: "AI Music Generation & Custom Audio SaaS",
      generalIndustry: "Generative AI & Digital Audio Software",
      targetMarket: "United Arab Emirates",
      businessModel: "Hybrid B2B/B2C AI Audio SaaS & On-Demand Custom Song Platform",
      offeringType: "SAAS_OR_WEB_APPLICATION",
      pricingModel: "HYBRID",
      classificationProfile: canonicalClassification,
      evidenceGaps: canonicalClassification.evidenceGaps,
      productTruthFacts: allEightCanonicalFacts,
      targetRoles: allFourCanonicalRoles,
    };

    const budget = new DiscoveryBudgetTracker(10, 60000);
    const plannerMock = createContextualLlmMock(() => ({
      missions: [
        {
          id: "m_1",
          title: "Direct AI Song SaaS Platforms Serving UAE & Online",
          targetProvider: "GOOGLE",
          query: "AI custom song generator platform personalized music online UAE",
          searchLanguage: "en",
          marketScope: "REGIONAL_OR_GLOBAL",
          competitorCategoryTarget: "Direct AI Music & Custom Song Platforms",
          buyerSegmentTarget: "B2B_AND_B2C",
          rationale: "Finds direct software competitors matching SAAS_OR_WEB_APPLICATION delivery model.",
          priority: 1,
        },
        {
          id: "m_2",
          title: "B2B Audio Branding & Custom Jingle Studios in UAE",
          targetProvider: "GOOGLE",
          query: "custom brand anthem audio branding sonic identity agency Dubai UAE",
          searchLanguage: "en",
          marketScope: "MARKET_SPECIFIC",
          competitorCategoryTarget: "B2B Commercial Audio & Jingle Studios in UAE",
          buyerSegmentTarget: "B2B",
          rationale: "Covers B2B marketing and agency buyer segments in UAE.",
          priority: 2,
        },
      ],
    }));

    const planned = await withStrictLlmMock(plannerMock as any, () =>
      planDiscoveryMissions(pinnedContext, budget, 2, 4)
    );

    const plannerPrompt = plannerMock.getPromptsSeen()[0];
    assert.ok(
      plannerPrompt.includes("SAAS_OR_WEB_APPLICATION"),
      "Mission planner prompt must receive canonical offeringAndDelivery dimension"
    );
    assert.ok(
      plannerPrompt.includes("B2B_AND_B2C"),
      "Mission planner prompt must receive canonical buyerSegment dimension"
    );
    assert.ok(
      plannerPrompt.includes("Fact 6: Provides B2B commercial licensing") &&
        plannerPrompt.includes("Fact 8: Supports multi-seat SaaS workspace collaboration for business accounts [src_8]"),
      "All 8 canonical productTruthFacts (including facts #6-#8 and source IDs) must reach discovery planning without slice(0, 5) truncation"
    );
    assert.ok(
      plannerPrompt.includes("B2B Marketing Directors & Brand Managers [role_2]") &&
        plannerPrompt.includes("Corporate HR & Employee Engagement Leads [role_4]"),
      "All B2B and B2C buyer roles with source IDs must reach discovery planning"
    );
    assert.ok(
      !plannerPrompt.includes("75%") && !plannerPrompt.includes("stores, boutiques"),
      "Mission planner prompt must not contain hardcoded 75% Arabic ratios or physical retail/boutique mandates"
    );
    assert.equal(planned.length, 2);

    // Also verify market localization no longer injects physical shipping phrases for UAE
    const uaeLoc = resolveMarketLocalization("United Arab Emirates");
    assert.ok(
      uaeLoc.localKeywords.every(
        (kw) => !kw.includes("shipping") && !kw.includes("delivery") && !kw.includes("توصيل")
      ),
      "UAE market localization must not inject physical shipping keywords"
    );
  }
  console.log("  ✓ Passed Scenarios 4 & 5\n");

  // ============================================================================
  // SCENARIO 6: Changing target market invalidates/blocks reuse of incompatible discovery sessions
  // ============================================================================
  console.log("Test 6: Target market change invalidates incompatible discovery sessions...");
  {
    const oldUsSession = {
      id: "sess_us_1",
      targetMarket: "United States",
      campaignOfferingId: "off_songai_platform_v2",
      buSnapshotId: "bu_snap_canonical_v2",
    };

    const marketCheck = checkDiscoverySessionCompatibility(oldUsSession, {
      targetMarket: "United Arab Emirates",
      campaignOfferingId: "off_songai_platform_v2",
      buSnapshotId: "bu_snap_canonical_v2",
    });
    assert.equal(marketCheck.valid, false, "Session from 'United States' must be incompatible when market changes to 'United Arab Emirates'");
    assert.ok(marketCheck.reason?.includes("Target market changed"));

    const offeringCheck = checkDiscoverySessionCompatibility(
      {
        id: "sess_uae_old_off",
        targetMarket: "United Arab Emirates",
        campaignOfferingId: "off_old_v1",
        buSnapshotId: "bu_snap_canonical_v2",
      },
      {
        targetMarket: "United Arab Emirates",
        campaignOfferingId: "off_songai_platform_v2",
        buSnapshotId: "bu_snap_canonical_v2",
      }
    );
    assert.equal(offeringCheck.valid, false, "Session from older offering must be rejected");

    const validCheck = checkDiscoverySessionCompatibility(
      {
        id: "sess_uae_current",
        targetMarket: "uae",
        campaignOfferingId: "off_songai_platform_v2",
        buSnapshotId: "bu_snap_canonical_v2",
      },
      {
        targetMarket: "United Arab Emirates",
        campaignOfferingId: "off_songai_platform_v2",
        buSnapshotId: "bu_snap_canonical_v2",
      }
    );
    assert.equal(validCheck.valid, true, "Canonical UAE alias ('uae' vs 'United Arab Emirates') with matching offering & BU snapshot must be compatible");
  }
  console.log("  ✓ Passed Scenario 6\n");

  // ============================================================================
  // SCENARIO 7 & 8: Separate competitive relevance from market availability (Singy kept with UNVERIFIED market),
  //                 distinguish vendor blog vs third-party listicle, preserve customer review provenance
  // ============================================================================
  console.log("Test 7 & 8: Competitor relevance vs. market availability separation, vendor blog vs. listicle distinction, and review provenance...");
  {
    const campaignCtx = {
      businessName: "SongAI Media",
      offeringName: "SongAI — Personalized AI Song & Commercial Audio Platform",
      category: "AI Music Generation & Custom Audio SaaS",
      targetMarket: "United Arab Emirates",
      businessModel: "Hybrid B2B/B2C AI Audio SaaS",
      offeringType: "SAAS_OR_WEB_APPLICATION",
      pricingModel: "HYBRID",
      productTruthFacts: [
        "Generates personalized studio-quality songs online [src_1]",
        "Serves B2C gifting and B2B brand audio campaigns [src_2]",
      ],
      targetRoles: ["Consumer Gift Buyers", "B2B Marketing Teams"],
    };

    const qualityMock = createContextualLlmMock((prompt) => {
      // Case A: Singy (singy.ai) — Direct AI song competitor, but NO explicit UAE market evidence
      if (prompt.includes("singy.ai")) {
        if (prompt.includes("Identity, Entity Role")) {
          return {
            isRealBusiness: true,
            entityRole: "BRAND_DIRECT_SELLER",
            sourcePageType: "VENDOR_STOREFRONT_OR_PRODUCT_PAGE",
            canonicalName: "Singy AI",
            canonicalDomain: "singy.ai",
            confidence: 0.95,
            reasoning: "First-party AI personalized song platform.",
          };
        }
        return {
          isRelevant: true,
          classification: "DIRECT_COMPETITOR",
          geographicClassification: "UNVERIFIED",
          geographicReasoning: "Singy AI is an online digital platform, but the snippet contains no explicit UAE billing, localization, or UAE customer proof.",
          marketAvailabilityUncertainty: "Global web app accessible online; explicit UAE billing or localized UAE campaign support is unverified.",
          tier: "A",
          reason: "Direct AI custom song generator competing for the same digital song creation use case.",
        };
      }

      // Case B: SongUp (songupai.com/blog/top-custom-song-platforms) — Vendor's OWN comparison blog post
      if (prompt.includes("songupai.com")) {
        if (prompt.includes("Identity, Entity Role")) {
          return {
            isRealBusiness: true,
            entityRole: "MEDIA_PUBLISHER", // Even if LLM mistakenly says MEDIA_PUBLISHER, our guardrail must fix it because sourcePageType is VENDOR_BLOG_OR_COMPARISON_POST!
            sourcePageType: "VENDOR_BLOG_OR_COMPARISON_POST",
            canonicalName: "SongUp AI",
            canonicalDomain: "songupai.com",
            confidence: 0.9,
            reasoning: "Comparison blog post hosted on SongUp AI's own commercial domain.",
          };
        }
        return {
          isRelevant: true,
          classification: "DIRECT_COMPETITOR",
          geographicClassification: "CROSS_BORDER_SERVING_MARKET",
          geographicReasoning: "Snippet explicitly mentions serving customers in Dubai and UAE via digital delivery.",
          tier: "A",
          reason: "SongUp AI sells custom AI songs directly and actively targets UAE buyers.",
        };
      }

      // Case C: Third-party editorial review listicle (musictechreviews.io/best-ai-song-generators)
      if (prompt.includes("musictechreviews.io")) {
        return {
          isRealBusiness: false,
          entityRole: "MEDIA_PUBLISHER",
          sourcePageType: "THIRD_PARTY_LISTICLE_OR_REVIEW",
          mentionedCompetitorLeads: [
            { name: "Songfinch", domain: "songfinch.com", reason: "Ranked #1 custom song platform in article" },
            { name: "Suno", domain: "suno.com", reason: "Ranked #2 AI music generator in article" },
          ],
          canonicalName: "MusicTech Reviews",
          canonicalDomain: "musictechreviews.io",
          confidence: 0.95,
          reasoning: "Independent editorial publication reviewing AI music tools; does not sell songs or software itself.",
        };
      }

      return {};
    });

    await withStrictLlmMock(qualityMock as any, async () => {
      // 7a: Verify Singy AI (Direct competitor + UNVERIFIED market availability)
      const singyInput = {
        candidateKey: "singy.ai",
        name: "Singy AI",
        domain: "singy.ai",
        websiteUrl: "https://singy.ai",
        evidenceText: "Singy AI — Create personalized AI songs online in minutes. Read verified buyer reviews on Trustpilot.",
      };
      const singyIdentity = await verifyCompetitorIdentity(singyInput, { accountId: "test_acc" });
      const singyRelevance = await verifyCompetitorRelevance(singyInput, singyIdentity, campaignCtx, { accountId: "test_acc" });
      const singyDecision = runCompetitorFinalJudge(singyInput, singyIdentity, singyRelevance, {
        offeringName: campaignCtx.offeringName,
        targetMarket: campaignCtx.targetMarket,
      });

      assert.equal(singyDecision.verdict, "APPROVED", "Relevant direct competitor with UNVERIFIED geography must be APPROVED, not dropped");
      assert.equal(singyRelevance.classification, "DIRECT_COMPETITOR");
      assert.equal(singyDecision.strategicRole, "DIRECT");
      assert.equal(
        singyDecision.geographicClassification,
        "UNVERIFIED",
        "Online accessibility alone must NOT auto-promote Singy AI to LOCAL_MARKET or CROSS_BORDER_SERVING_MARKET"
      );
      assert.ok(
        singyDecision.marketAvailabilityUncertainty && singyDecision.marketAvailabilityUncertainty.length > 10,
        "Approved competitor with UNVERIFIED market must carry explicit marketAvailabilityUncertainty"
      );

      // 8a: Verify SongUp AI vendor blog post is treated as BRAND_DIRECT_SELLER, not rejected as media publisher
      const songupInput = {
        candidateKey: "songupai.com",
        name: "Top 10 Custom Song Platforms in 2026 | SongUp AI Blog",
        domain: "songupai.com",
        websiteUrl: "https://songupai.com/blog/top-custom-song-platforms",
        evidenceText: "Compare the top custom song platforms. SongUp AI delivers custom AI songs and brand jingles to customers in Dubai, UAE and worldwide.",
      };
      const songupIdentity = await verifyCompetitorIdentity(songupInput, { accountId: "test_acc" });
      assert.equal(songupIdentity.sourcePageType, "VENDOR_BLOG_OR_COMPARISON_POST");
      assert.equal(songupIdentity.isRealBusiness, true, "Vendor owning a blog post must be recognized as a real business");
      assert.equal(
        songupIdentity.entityRole,
        "BRAND_DIRECT_SELLER",
        "Guardrail must ensure VENDOR_BLOG_OR_COMPARISON_POST is classified as BRAND_DIRECT_SELLER, not MEDIA_PUBLISHER"
      );
      const songupRelevance = await verifyCompetitorRelevance(songupInput, songupIdentity, campaignCtx, { accountId: "test_acc" });
      const songupDecision = runCompetitorFinalJudge(songupInput, songupIdentity, songupRelevance, {
        offeringName: campaignCtx.offeringName,
        targetMarket: campaignCtx.targetMarket,
      });
      assert.equal(songupDecision.verdict, "APPROVED");
      assert.equal(songupDecision.geographicClassification, "CROSS_BORDER_SERVING_MARKET");

      // 8b: Verify Third-Party Listicle is rejected as a competitor itself, while extracting mentionedCompetitorLeads
      const listicleInput = {
        candidateKey: "musictechreviews.io",
        name: "Best AI Song Generators Reviewed (2026)",
        domain: "musictechreviews.io",
        websiteUrl: "https://musictechreviews.io/best-ai-song-generators",
        evidenceText: "Our editorial team tested Songfinch (songfinch.com) and Suno (suno.com) to find the best custom song tools.",
      };
      const listicleIdentity = await verifyCompetitorIdentity(listicleInput, { accountId: "test_acc" });
      assert.equal(listicleIdentity.sourcePageType, "THIRD_PARTY_LISTICLE_OR_REVIEW");
      assert.equal(listicleIdentity.isRealBusiness, false);
      assert.equal(listicleIdentity.mentionedCompetitorLeads?.length, 2, "Must extract Songfinch and Suno leads from third-party listicle");
      assert.equal(listicleIdentity.mentionedCompetitorLeads?.[0].domain, "songfinch.com");

      // 8c: Verify customer review provenance is preserved
      const reviewProvenanceType = classifyEvidenceSourceType(
        [
          {
            searchProvider: "GOOGLE",
            url: "https://www.trustpilot.com/review/singy.ai",
            rawTitle: "Singy AI Reviews | Customer Rating 4.8/5 on Trustpilot",
            rawSnippet: "Verified customer review: Ordered a custom song for our company event, delivered in 12 hours.",
          },
        ],
        "VENDOR_STOREFRONT_OR_PRODUCT_PAGE"
      );
      assert.equal(
        reviewProvenanceType,
        "CUSTOMER_REVIEW_EXCERPT",
        "Customer review snippets must preserve CUSTOMER_REVIEW_EXCERPT provenance"
      );
    });
  }
  console.log("  ✓ Passed Scenarios 7 & 8\n");

  // ============================================================================
  // SCENARIO 9: Shared Readiness Logic (READY_WITH_LIMITED_EVIDENCE vs BLOCKED, no 10-local rule)
  // ============================================================================
  console.log("Test 9: Shared contextual readiness logic (no universal 10-local-competitor blocker)...");
  {
    const sampleApprovedCandidates: any[] = [
      {
        candidateKey: "singy.ai",
        name: "Singy AI",
        domain: "singy.ai",
        websiteUrl: "https://singy.ai",
        classification: "DIRECT_COMPETITOR",
        geographicClassification: "UNVERIFIED",
        marketAvailabilityUncertainty: "Accessible online globally; UAE-specific billing unverified.",
        judgeVerdict: "APPROVED",
        selected: true,
        occurrences: [],
      },
      {
        candidateKey: "songupai.com",
        name: "SongUp AI",
        domain: "songupai.com",
        websiteUrl: "https://songupai.com",
        classification: "DIRECT_COMPETITOR",
        geographicClassification: "CROSS_BORDER_SERVING_MARKET",
        judgeVerdict: "APPROVED",
        selected: true,
        occurrences: [],
      },
      {
        candidateKey: "fnp.ae",
        name: "Ferns N Petals UAE",
        domain: "fnp.ae",
        websiteUrl: "https://www.fnp.ae",
        classification: "SUBSTITUTE_COMPETITOR",
        geographicClassification: "LOCAL_MARKET",
        judgeVerdict: "APPROVED",
        selected: true,
        occurrences: [],
      },
    ];

    // 9a: Only 1 local substitute + 2 direct competitors (1 cross-border, 1 unverified market) -> READY_WITH_LIMITED_EVIDENCE (canProceed: true!)
    const readinessMock = createContextualLlmMock(() => ({
      verdict: "READY_WITH_LIMITED_EVIDENCE",
      confidence: "MEDIUM",
      reason:
        "Selected set covers direct AI song SaaS platforms (Singy AI, SongUp AI) and a local UAE gifting substitute (FNP UAE). While Singy AI's UAE-specific billing is unverified, this set is sufficient to proceed to downstream strategy.",
      evidenceSummary: [
        "2 direct AI song competitors selected (1 cross-border serving UAE, 1 online with unverified UAE billing).",
        "1 local UAE gifting substitute selected (fnp.ae).",
      ],
      materialGaps: ["Direct B2B commercial audio studio in UAE remains lightly covered."],
      recommendedNextSearchAngles: ["Search for Dubai commercial audio production and sonic branding agencies."],
    }));

    const readyResult = await withStrictLlmMock(readinessMock as any, () =>
      evaluateCompetitorDiscoveryReadiness(
        {
          hasCanonicalBusinessUnderstanding: true,
          hasConfirmedOffering: true,
          contextCompatible: true,
          businessName: "SongAI Media",
          offeringName: "SongAI — Personalized AI Song & Commercial Audio Platform",
          category: "AI Music Generation & Custom Audio SaaS",
          targetMarket: "United Arab Emirates",
          approvedCandidates: sampleApprovedCandidates,
          selectedDomains: ["singy.ai", "songupai.com", "fnp.ae"],
        },
        { accountId: "test_acc", useLlmAssessment: true }
      )
    );

    assert.equal(readyResult.canProceed, true, "Must allow proceeding without requiring 10 local competitors");
    assert.equal(readyResult.verdict, "READY_WITH_LIMITED_EVIDENCE");
    assert.equal(readyResult.counts.localCount, 1);
    assert.equal(readyResult.counts.directCount, 2);
    assert.equal(readyResult.counts.unverifiedMarketCount, 1);

    // 9b: Zero selected competitors -> BLOCKED
    const zeroSelectedResult = await evaluateCompetitorDiscoveryReadiness(
      {
        hasCanonicalBusinessUnderstanding: true,
        hasConfirmedOffering: true,
        contextCompatible: true,
        businessName: "SongAI Media",
        offeringName: "SongAI Platform",
        category: "AI Music SaaS",
        targetMarket: "United Arab Emirates",
        approvedCandidates: sampleApprovedCandidates,
        selectedDomains: [],
      },
      { accountId: "test_acc", useLlmAssessment: false }
    );
    assert.equal(zeroSelectedResult.verdict, "BLOCKED");
    assert.equal(zeroSelectedResult.canProceed, false);

    // 9c: Search provider failure -> BLOCKED
    const providerFailResult = await evaluateCompetitorDiscoveryReadiness(
      {
        hasCanonicalBusinessUnderstanding: true,
        hasConfirmedOffering: true,
        contextCompatible: true,
        providerUnavailable: true,
        providerErrorCount: 4,
        businessName: "SongAI Media",
        offeringName: "SongAI Platform",
        category: "AI Music SaaS",
        targetMarket: "United Arab Emirates",
        approvedCandidates: [],
      },
      { accountId: "test_acc", useLlmAssessment: false }
    );
    assert.equal(providerFailResult.verdict, "BLOCKED");
    assert.equal(providerFailResult.canProceed, false);
    assert.ok(providerFailResult.reason.toLowerCase().includes("search providers failed"));
  }
  console.log("  ✓ Passed Scenario 9\n");

  // ============================================================================
  // SCENARIO 10: End-to-End Incremental "Continue Discovery" (resumeSession: true)
  //              Reuses cached evaluations, preserves user selections, plans non-duplicate queries
  // ============================================================================
  console.log("Test 10: Incremental 'Continue Discovery' reuses prior evaluations, preserves selections, and avoids duplicate LLM/search work...");
  {
    const pinnedContext: PinnedDiscoveryContext = {
      accountId: "acc_songai_test",
      campaignId: "camp_songai_uae",
      buSnapshotId: "bu_snap_canonical_v2",
      campaignOfferingId: "off_songai_platform_v2",
      businessName: "SongAI Media",
      offeringName: "SongAI — Personalized AI Song & Commercial Audio Platform",
      category: "AI Music Generation & Custom Audio SaaS",
      generalIndustry: "Generative AI & Digital Audio Software",
      targetMarket: "United Arab Emirates",
      businessModel: "Hybrid B2B/B2C AI Audio SaaS",
      offeringType: "SAAS_OR_WEB_APPLICATION",
      pricingModel: "HYBRID",
      productTruthFacts: [
        "Generates custom songs and commercial audio via AI web studio [src_1]",
        "Serves B2C gift buyers and B2B marketing teams in UAE [src_2]",
      ],
      targetRoles: ["Consumer Gift Buyers", "B2B Marketing Teams"],
    };

    const priorSession = {
      id: "sess_round1",
      accountId: "acc_songai_test",
      campaignId: "camp_songai_uae",
      campaignOfferingId: "off_songai_platform_v2",
      buSnapshotId: "bu_snap_canonical_v2",
      targetMarket: "United Arab Emirates",
      searchMissions: [
        {
          id: "m_1",
          title: "Round 1 Mission",
          targetProvider: "GOOGLE",
          query: "personalized song gift UAE",
          searchLanguage: "en",
          rationale: "Initial query",
          priority: 1,
        },
      ],
      candidates: [
        {
          candidateKey: "singy.ai",
          canonicalEntityId: "ent_singy",
          name: "Singy AI",
          domain: "singy.ai",
          websiteUrl: "https://singy.ai",
          isCommercialBusiness: true,
          entityRole: "BRAND_DIRECT_SELLER",
          sourcePageType: "VENDOR_STOREFRONT_OR_PRODUCT_PAGE",
          classification: "DIRECT_COMPETITOR",
          geographicClassification: "UNVERIFIED",
          marketAvailabilityUncertainty: "Online platform; UAE billing unverified.",
          judgeVerdict: "APPROVED",
          judgeReason: "Approved direct AI song competitor.",
          tier: "A",
          selected: true,
          occurrences: [
            {
              missionId: "m_1",
              query: "personalized song gift UAE",
              searchLanguage: "en",
              searchProvider: "GOOGLE",
              url: "https://singy.ai",
              rawTitle: "Singy AI Custom Songs",
              rawSnippet: "Create custom AI songs.",
              discoveredAt: new Date().toISOString(),
            },
          ],
        },
        {
          candidateKey: "fnp.ae",
          canonicalEntityId: "ent_fnp",
          name: "Ferns N Petals UAE",
          domain: "fnp.ae",
          websiteUrl: "https://www.fnp.ae",
          isCommercialBusiness: true,
          entityRole: "MULTI_BRAND_RETAILER",
          sourcePageType: "VENDOR_STOREFRONT_OR_PRODUCT_PAGE",
          classification: "SUBSTITUTE_COMPETITOR",
          geographicClassification: "LOCAL_MARKET",
          judgeVerdict: "APPROVED",
          judgeReason: "Local UAE gifting substitute.",
          tier: "C",
          selected: false, // User explicitly deselected fnp.ae!
          occurrences: [
            {
              missionId: "m_1",
              query: "personalized song gift UAE",
              searchLanguage: "en",
              searchProvider: "GOOGLE",
              url: "https://www.fnp.ae/gifts",
              rawTitle: "FNP UAE Gifts",
              rawSnippet: "Personalized physical gifts in Dubai.",
              discoveredAt: new Date().toISOString(),
            },
          ],
        },
        {
          candidateKey: "musictechreviews.io",
          canonicalEntityId: "ent_mtr",
          name: "MusicTech Reviews",
          domain: "musictechreviews.io",
          websiteUrl: "https://musictechreviews.io/best-ai-songs",
          isCommercialBusiness: false,
          entityRole: "MEDIA_PUBLISHER",
          sourcePageType: "THIRD_PARTY_LISTICLE_OR_REVIEW",
          mentionedCompetitorLeads: [
            { name: "Songfinch", domain: "songfinch.com", reason: "Top custom song service" },
          ],
          classification: "NOT_COMPETITOR",
          geographicClassification: "UNVERIFIED",
          judgeVerdict: "REJECTED",
          judgeReason: "Third-party editorial review site.",
          tier: "B",
          selected: false,
          occurrences: [
            {
              missionId: "m_1",
              query: "personalized song gift UAE",
              searchLanguage: "en",
              searchProvider: "GOOGLE",
              url: "https://musictechreviews.io/best-ai-songs",
              rawTitle: "Best AI Song Generators",
              rawSnippet: "Reviewing Songfinch (songfinch.com) and Singy.",
              discoveredAt: new Date().toISOString(),
            },
          ],
        },
      ],
    };

    const identityCallsForDomains: string[] = [];

    const incrementalMock = createContextualLlmMock((prompt) => {
      // 1. Mission planner call for Continue Discovery
      if (prompt.includes("Contextual Competitor Discovery Strategist")) {
        return {
          missions: [
            // Intentionally include the old query to verify deduplication filters it out
            {
              id: "m_dup",
              title: "Duplicate Query",
              targetProvider: "GOOGLE",
              query: "personalized song gift UAE",
              searchLanguage: "en",
              rationale: "Duplicate test",
              priority: 1,
            },
            // New incremental mission targeting the extracted lead & B2B gap
            {
              id: "m_new_2",
              title: "Verify Songfinch & B2B Custom Song Platforms",
              targetProvider: "GOOGLE",
              query: "songfinch custom song platform corporate gifting UAE",
              searchLanguage: "en",
              marketScope: "REGIONAL_OR_GLOBAL",
              competitorCategoryTarget: "Direct Custom Song Platforms",
              buyerSegmentTarget: "B2B_AND_B2C",
              rationale: "Verifies lead extracted from prior listicle and targets B2B gifting.",
              priority: 1,
            },
          ],
        };
      }

      // 2. Identity verification should ONLY be called for the NEW domain (songfinch.com)!
      if (prompt.includes("Identity, Entity Role")) {
        const match = prompt.match(/- Domain: ([^\n]+)/);
        if (match) identityCallsForDomains.push(match[1].trim());
        return {
          isRealBusiness: true,
          entityRole: "BRAND_DIRECT_SELLER",
          sourcePageType: "VENDOR_STOREFRONT_OR_PRODUCT_PAGE",
          canonicalName: "Songfinch",
          canonicalDomain: "songfinch.com",
          confidence: 0.95,
          reasoning: "First-party personalized song creation platform.",
        };
      }

      // 3. Relevance verification for songfinch.com
      if (prompt.includes("Competitive & Market Availability Assessor")) {
        return {
          isRelevant: true,
          classification: "DIRECT_COMPETITOR",
          geographicClassification: "INTERNATIONAL_REFERENCE",
          geographicReasoning: "Global custom song platform serving online buyers internationally.",
          tier: "A",
          reason: "Direct custom song platform competing for personalized song creation.",
        };
      }

      // 4. Readiness assessment
      return {
        verdict: "READY_WITH_LIMITED_EVIDENCE",
        confidence: "HIGH",
        reason: "Strong set of direct custom song platforms (Singy AI, Songfinch) selected with transparent market availability notes.",
        evidenceSummary: ["2 direct custom song platforms selected (Singy AI, Songfinch)."],
        materialGaps: [],
        recommendedNextSearchAngles: [],
      };
    });

    const executedQueries: string[] = [];
    const report = await withStrictLlmMock(incrementalMock as any, () =>
      runCompetitorDiscoveryEngine({
        accountId: "acc_songai_test",
        campaignId: "camp_songai_uae",
        pinnedContext,
        resumeSession: true,
        skipPersistence: true,
        rootUrlOverride: "https://thesongai.com",
        existingSessionOverride: priorSession,
        selectedDomains: ["singy.ai"], // User kept singy.ai selected and fnp.ae deselected
        customSearchExecutor: async (missions: DiscoveryMission[], budget: DiscoveryBudgetTracker) => {
          const results: CandidateProvenance[] = [];
          for (const m of missions) {
            budget.recordProviderCall();
            executedQueries.push(m.query);
            results.push({
              missionId: m.id,
              searchQuery: m.query,
              searchProvider: "GOOGLE",
              url: "https://www.songfinch.com/for-business",
              domain: "songfinch.com",
              rawTitle: "Songfinch — Custom Songs for Gifts & Business Teams",
              rawSnippet: "Create custom songs from real artists and AI studio tools for consumers and corporate gifting.",
              retrievedAt: new Date().toISOString(),
            });
          }
          return results;
        },
      })
    );

    assert.deepEqual(
      executedQueries,
      ["songfinch custom song platform corporate gifting UAE"],
      "Continue Discovery must filter out duplicate queries from prior rounds and execute only new queries"
    );
    assert.deepEqual(
      identityCallsForDomains,
      ["songfinch.com"],
      "Continue Discovery must reuse cached candidate evaluations for singy.ai, fnp.ae, and musictechreviews.io without re-running identity LLM calls"
    );
    assert.equal(
      report.telemetry?.reusedCandidatesCount,
      3,
      "Telemetry must record all 3 reused candidates from the prior session"
    );

    // Check that Singy AI is still in unverifiedMarketCandidates AND approvedCandidates!
    assert.equal(report.unverifiedMarketCandidates?.length, 1);
    assert.equal(report.unverifiedMarketCandidates?.[0].domain, "singy.ai");
    assert.ok(
      report.approvedCandidates.some((c) => c.domain === "singy.ai"),
      "Approved competitor with UNVERIFIED market (singy.ai) must be retained in approvedCandidates"
    );
    assert.ok(
      report.approvedCandidates.some((c) => c.domain === "songfinch.com"),
      "Newly discovered competitor (songfinch.com) must be merged into approvedCandidates"
    );

    // Verify user selections were preserved
    const singyAfter = report.approvedCandidates.find((c) => c.domain === "singy.ai");
    const fnpAfter = report.approvedCandidates.find((c) => c.domain === "fnp.ae");
    const songfinchAfter = report.approvedCandidates.find((c) => c.domain === "songfinch.com");
    assert.equal(singyAfter?.selected, true, "User selection for singy.ai must be preserved");
    assert.equal(fnpAfter?.selected, false, "User deselection for fnp.ae must be preserved");
    assert.equal(songfinchAfter?.selected, true, "Newly discovered approved competitor defaults to selected");

    // Verify readiness allows proceeding without 10 local competitors
    assert.equal(report.isBuildEligible, true);
    assert.equal(report.readiness?.verdict, "READY_WITH_LIMITED_EVIDENCE");
    assert.equal(report.requiredLocalCount, 0, "Universal 10-local requirement must be removed (requiredLocalCount === 0)");
  }
  console.log("  ✓ Passed Scenario 10\n");

  console.log("=== ALL 10 OFFLINE VERIFICATION SCENARIOS PASSED SUCCESSFULLY ===");
}

runAllTests().catch((err) => {
  console.error("Offline verification test failed:", err);
  process.exit(1);
});
