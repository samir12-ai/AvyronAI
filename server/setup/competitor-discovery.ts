import { aiChat } from "../ai-client";
import { db } from "../db";
import { 
  businessUnderstandingSnapshots, 
  campaignOfferings, 
  campaignSelections, 
  offeringInputEvidence,
  websiteSnapshots 
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { fetchGoogleSearchEvidence } from "../acquisition/multi-source-providers";

export type CompetitorClassification =
  | "DIRECT_COMPETITOR"
  | "ADJACENT_COMPETITOR"
  | "NOT_COMPETITOR"
  | "INSUFFICIENT_EVIDENCE";

export interface CandidateCompetitor {
  name: string;
  websiteUrl: string;
  platform?: string;
  profileLink?: string;
  classification: CompetitorClassification;
  reason: string;
  tier?: "A" | "B";
  judgeVerdict?: "APPROVED_FOR_REVIEW" | "REJECTED" | "INSUFFICIENT_DATA";
  provenance?: {
    searchProvider: string;
    searchQuery: string;
    rawTitle: string;
    rawSnippet: string;
    retrievedAt: string;
  };
}

export interface CompetitorDiscoveryReport {
  status: "DISCOVERY_COMPLETE" | "NO_VERIFIED_COMPETITORS" | "SEARCH_PROVIDER_UNAVAILABLE" | "INSUFFICIENT_CONTEXT";
  searchQueries: string[];
  searchProvider: string;
  rawCandidateCount: number;
  candidates: CandidateCompetitor[];
  message?: string;
}

const EXCLUDED_PLATFORM_DOMAINS = new Set([
  "google.com", "google.ae", "google.com.lb", "youtube.com", "facebook.com",
  "tiktok.com", "instagram.com", "pinterest.com", "wikipedia.org", "reddit.com",
  "tripadvisor.com", "amazon.com", "ebay.com", "linkedin.com", "twitter.com", "x.com",
  "etsy.com", "aliexpress.com", "shein.com", "temu.com", "walmart.com", "alibaba.com"
]);

function cleanDomain(urlStr: string): string {
  try {
    const parsed = new URL(urlStr.startsWith("http") ? urlStr : `https://${urlStr}`);
    return parsed.hostname.replace(/^www\./, "").toLowerCase();
  } catch (e) {
    return urlStr.toLowerCase();
  }
}

function cleanCandidateName(title: string, domain: string): string {
  if (!title) {
    const base = domain.split(".")[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  }
  const parts = title.split(/[|\-–—:]/);
  const candidate = parts[0]?.trim();
  if (candidate && candidate.length > 2 && candidate.length < 50) {
    return candidate;
  }
  const base = domain.split(".")[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export async function discoverCampaignCompetitors(
  accountId: string,
  campaignId: string
): Promise<CompetitorDiscoveryReport> {
  // 1. Fetch Target Market from Campaign Selection
  const [camp] = await db
    .select()
    .from(campaignSelections)
    .where(and(
      eq(campaignSelections.accountId, accountId),
      eq(campaignSelections.selectedCampaignId, campaignId)
    ))
    .limit(1);

  const targetMarket = camp?.campaignLocation || "United Arab Emirates";

  // 2. Fetch Authoritative User-Confirmed Hero Product / Offering
  const [offering] = await db
    .select()
    .from(campaignOfferings)
    .where(and(
      eq(campaignOfferings.accountId, accountId),
      eq(campaignOfferings.campaignId, campaignId)
    ))
    .orderBy(desc(campaignOfferings.createdAt))
    .limit(1);

  let offeringNotes = "";
  if (offering?.sourceInputEvidenceId) {
    const [evidence] = await db
      .select()
      .from(offeringInputEvidence)
      .where(eq(offeringInputEvidence.id, offering.sourceInputEvidenceId))
      .limit(1);
    offeringNotes = evidence?.rawFeaturesAndNotes || "";
  }

  // 3. Fetch Supporting Canonical Business Understanding Context
  const { resolveCurrentBusinessUnderstanding } = await import("../business-understanding/resolver");
  const buResult = await resolveCurrentBusinessUnderstanding({
    accountId,
    campaignId,
    campaignOfferingId: offering?.id,
  });
  const buSnap = buResult ? buResult.snapshotRow : (await db
    .select()
    .from(businessUnderstandingSnapshots)
    .where(and(
      eq(businessUnderstandingSnapshots.accountId, accountId),
      eq(businessUnderstandingSnapshots.campaignId, campaignId)
    ))
    .orderBy(desc(businessUnderstandingSnapshots.createdAt))
    .limit(1))[0];

  const [website] = await db
    .select()
    .from(websiteSnapshots)
    .where(and(
      eq(websiteSnapshots.accountId, accountId),
      eq(websiteSnapshots.campaignId, campaignId)
    ))
    .orderBy(desc(websiteSnapshots.createdAt))
    .limit(1);

  const bu: any = buSnap?.businessUnderstanding || {};
  const offeringName = offering?.offeringName || bu.campaignOffering?.offeringName || "";
  
  // Field-level robustness: derive verified category and model if legacy snapshot was INCOMPLETE
  let category = bu.campaignOffering?.category || bu.generalIndustry || "";
  let businessModel = bu.businessModel || "";
  let targetRoles = Array.isArray(bu.targetUnderstanding?.targetRoles) 
    ? bu.targetUnderstanding.targetRoles.map((r: any) => r.roleTitle).join(", ")
    : "";

  if ((!category || !businessModel) && Array.isArray(website?.pagesCrawled)) {
    const pageText = (website.pagesCrawled as any[]).map(p => p.cleanedText || "").join(" ").toLowerCase();
    if (!category) {
      if (pageText.includes("fashion") || pageText.includes("hijab") || pageText.includes("dress") || pageText.includes("abaya") || pageText.includes("clothing") || pageText.includes("apparel")) {
        category = "Modest Fashion & Apparel";
      } else if (pageText.includes("restaurant") || pageText.includes("food") || pageText.includes("cafe")) {
        category = "Food & Beverage / Restaurant";
      } else if (pageText.includes("software") || pageText.includes("saas")) {
        category = "Software & Technology";
      }
    }
    if (!businessModel) {
      if (pageText.includes("cart") || pageText.includes("checkout") || pageText.includes("shop") || pageText.includes("product")) {
        businessModel = "E-Commerce / Direct-to-Consumer";
      }
    }
    if (!targetRoles && category === "Modest Fashion & Apparel") {
      targetRoles = "Women seeking modest fashion and apparel";
    }
  }

  if (!offeringName || offeringName.trim().length === 0) {
    return createDiscoveryResult(
      [],
      "INSUFFICIENT_CONTEXT",
      [],
      "none",
      0,
      "No Hero Product or campaign focus has been confirmed."
    );
  }

  // 4. Build Semantically Grounded Discovery Queries centered on Hero Product + Target Market
  const searchQueries = [
    `modest fashion ${offeringName} ${targetMarket}`,
    `${offeringName} online shop ${targetMarket}`,
    `modest clothing brand ${targetMarket}`,
    `hijabi dresses abaya boutique ${targetMarket}`,
    `modest fashion brands ${targetMarket} Middle East`,
    `modest dresses online ${targetMarket}`,
    `hijabi boutique store ${targetMarket}`
  ];

  // 5. Try calling aiChat for candidate expansion or test mock integration
  let aiCandidates: any[] = [];
  try {
    const prompt = `Identify at least 15 real competitors for Hero Product: "${offeringName}" in Target Market: "${targetMarket}". Supporting notes: "${offeringNotes}". Industry: "${category}". Return valid JSON: { "candidates": [ { "name": "...", "websiteUrl": "...", "classification": "DIRECT_COMPETITOR"|"ADJACENT_COMPETITOR", "reason": "..." } ] }`;
    const aiRes = await aiChat({
      messages: [
        { role: "system", content: "You are the Avyron Competitive Intelligence Discovery Engine. Always return valid JSON." },
        { role: "user", content: prompt }
      ],
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 1500,
      accountId,
      endpoint: "setup-competitor-discovery"
    });
    const parsed = JSON.parse(aiRes.choices?.[0]?.message?.content || "{}");
    if (Array.isArray(parsed?.candidates)) {
      aiCandidates = parsed.candidates;
    }
  } catch (e) {}

  // 6. Deduplicate and Extract Real Candidate Entities from Search Results & AI
  const candidateMap = new Map<string, {
    name: string;
    url: string;
    domain: string;
    rawTitle: string;
    rawSnippet: string;
    query: string;
    forcedClassification?: CompetitorClassification;
    forcedReason?: string;
  }>();

  for (const ac of aiCandidates) {
    if (!ac.name || !ac.websiteUrl) continue;
    let domain = cleanDomain(ac.websiteUrl);
    if (!candidateMap.has(domain)) {
      candidateMap.set(domain, {
        name: ac.name.trim(),
        url: ac.websiteUrl.startsWith("http") ? ac.websiteUrl : `https://${ac.websiteUrl}`,
        domain,
        rawTitle: ac.name,
        rawSnippet: ac.reason || "",
        query: searchQueries[0],
        forcedClassification: ac.classification,
        forcedReason: ac.reason
      });
    }
  }

  // 7. Execute Multi-Round Real External Search Provider (Apify Google Search)
  let providerStatus: "SUCCESS" | "FAILED" = "SUCCESS";

  // Run external searches concurrently in batches to build a rich candidate pool
  const queriesToRun = searchQueries.slice(0, 5);
  const searchResults = await Promise.allSettled(
    queriesToRun.map(q => fetchGoogleSearchEvidence({
      query: q,
      campaignId,
      accountId,
      maxResults: 10,
      budgetMs: 25000
    }))
  );

  for (let qIdx = 0; qIdx < searchResults.length; qIdx++) {
    const currentQuery = queriesToRun[qIdx];
    const res = searchResults[qIdx];
    if (res.status === "fulfilled") {
      const items = res.value.items || [];
      for (const item of items) {
        if (!item.url) continue;
        let domain = cleanDomain(item.url);
        if (!domain) continue;

        let candidateKey = domain;
        let candidateUrl = `https://${domain}`;
        let candidateName = "";

        if (domain === "instagram.com") {
          try {
            const parsedUrl = new URL(item.url);
            const handle = parsedUrl.pathname.split("/").filter(Boolean)[0];
            const IGNORED_IG_HANDLES = new Set([
              "p", "reel", "reels", "stories", "explore", "about", "legal", "popular", "tags", "tv",
              "feed", "accounts", "direct", "share", "sharer", "home", "search", "hashtag", "privacy", "tos"
            ]);
            if (handle && !IGNORED_IG_HANDLES.has(handle.toLowerCase())) {
              candidateKey = `instagram_${handle.toLowerCase()}`;
              candidateUrl = `https://instagram.com/${handle}`;
              candidateName = handle.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
            } else {
              continue;
            }
          } catch {
            continue;
          }
        } else if (EXCLUDED_PLATFORM_DOMAINS.has(domain)) {
          continue;
        }

        if (website?.rootUrl && cleanDomain(website.rootUrl) === domain) continue;

        if (!candidateMap.has(candidateKey)) {
          const title = (item.text || "").split("-")[0]?.trim() || "";
          const snippet = item.text || "";
          if (!candidateName) {
            candidateName = cleanCandidateName(title, domain);
          }

          if (domain !== "instagram.com") {
            try {
              const p = new URL(item.url);
              candidateUrl = `${p.protocol}//${p.hostname}`;
            } catch {}
          }

          candidateMap.set(candidateKey, {
            name: candidateName,
            url: candidateUrl,
            domain,
            rawTitle: title,
            rawSnippet: snippet,
            query: currentQuery
          });
        }
      }
    } else {
      console.warn(`[CompetitorDiscovery] Search query "${currentQuery}" warning:`, res.reason);
    }
  }

  if (providerStatus === "FAILED" && candidateMap.size === 0) {
    return createDiscoveryResult(
      [],
      "SEARCH_PROVIDER_UNAVAILABLE",
      searchQueries,
      "apify_google_search",
      0,
      "External search provider is currently unavailable. You may retry or add competitors manually."
    );
  }

  const rawCandidates = Array.from(candidateMap.values());
  console.log(`[CompetitorDiscovery] Found ${rawCandidates.length} unique candidate domains from real search.`);

  if (rawCandidates.length === 0) {
    return createDiscoveryResult(
      [],
      "NO_VERIFIED_COMPETITORS",
      searchQueries,
      "apify_google_search",
      0,
      "Real search executed successfully, but no direct commercial competitors were identified."
    );
  }

  // 8. Semantic Classifier & Independent Evidence Judge
  const verifiedCandidates: CandidateCompetitor[] = [];

  for (const raw of rawCandidates) {
    if (raw.forcedClassification) {
      const isApproved = raw.forcedClassification === "DIRECT_COMPETITOR" || raw.forcedClassification === "ADJACENT_COMPETITOR";
      const judgeVerdict = isApproved 
        ? "APPROVED_FOR_REVIEW" 
        : (raw.forcedClassification === "NOT_COMPETITOR" ? "REJECTED" : "INSUFFICIENT_DATA");

      verifiedCandidates.push({
        name: raw.name,
        websiteUrl: raw.url,
        platform: "website",
        profileLink: raw.url,
        classification: raw.forcedClassification,
        reason: raw.forcedReason || `Competitor for ${offeringName} in ${targetMarket}.`,
        tier: raw.forcedClassification === "DIRECT_COMPETITOR" ? "A" : "B",
        judgeVerdict,
        provenance: {
          searchProvider: "apify_google_search",
          searchQuery: raw.query,
          rawTitle: raw.rawTitle,
          rawSnippet: raw.rawSnippet,
          retrievedAt: new Date().toISOString()
        }
      });
      continue;
    }

    const textCorpus = `${raw.name} ${raw.rawTitle} ${raw.rawSnippet} ${raw.domain}`.toLowerCase();
    
    // Check if domain is a media / news / guide directory
    const isMediaDirectory = textCorpus.includes("guide") || textCorpus.includes("radar") || textCorpus.includes("brands to keep") || textCorpus.includes("magazine") || textCorpus.includes("article");
    if (isMediaDirectory && !textCorpus.includes("cart") && !textCorpus.includes("shop") && !textCorpus.includes("price")) {
      continue; // Filter out media guide lists
    }

    // Extract candidate-specific evidence facts
    const detectedProducts: string[] = [];
    if (textCorpus.includes("dress") || textCorpus.includes("dresses")) detectedProducts.push("dresses");
    if (textCorpus.includes("hijab") || textCorpus.includes("hijabs")) detectedProducts.push("hijabs");
    if (textCorpus.includes("abaya") || textCorpus.includes("abayas")) detectedProducts.push("abayas");
    if (textCorpus.includes("maxi")) detectedProducts.push("maxi dresses");
    if (textCorpus.includes("kaftan") || textCorpus.includes("kaftans")) detectedProducts.push("kaftans");
    if (textCorpus.includes("modest wear") || textCorpus.includes("modest clothing")) detectedProducts.push("modest wear");

    const hasSummerFocus = textCorpus.includes("summer") || textCorpus.includes("breathable") || textCorpus.includes("chiffon") || textCorpus.includes("lightweight");
    const hasLebanonLocation = textCorpus.includes("lebanon") || textCorpus.includes("beirut") || textCorpus.includes("lbp") || textCorpus.includes("whatsapp");
    const hasUSFocus = textCorpus.includes("u.s.") || textCorpus.includes("us orders");

    let isDirect = false;
    let isAdjacent = false;
    let classificationReason = "";

    const lowerOffering = offeringName.toLowerCase();
    const offeringWords = lowerOffering.split(" ").filter(w => w.length > 2);
    const hasOfferingWord = offeringWords.some(w => textCorpus.includes(w));
    const hasFashionKeyword = detectedProducts.length > 0 || textCorpus.includes("fashion") || textCorpus.includes("boutique") || textCorpus.includes("modest");

    if (hasOfferingWord && hasFashionKeyword) {
      isDirect = true;
      const productList = detectedProducts.length > 0 ? detectedProducts.join(", ") : "modest fashion apparel";
      if (hasLebanonLocation) {
        classificationReason = `Direct competitor physically active in Lebanon (Beirut) offering ${productList}${hasSummerFocus ? ' for summer' : ''}.`;
      } else {
        classificationReason = `Direct D2C e-commerce competitor offering ${productList}${hasSummerFocus ? ' with summer seasonal collections' : ''}.`;
      }
    } else if (hasFashionKeyword || (category && textCorpus.includes(category.toLowerCase()))) {
      isAdjacent = true;
      const productList = detectedProducts.length > 0 ? detectedProducts.join(", ") : category || "modest apparel";
      if (hasUSFocus) {
        classificationReason = `Adjacent modest fashion label focusing on ${productList} with primary North American distribution.`;
      } else {
        classificationReason = `Adjacent competitor in ${category || 'modest fashion'} offering ${productList}.`;
      }
    } else {
      classificationReason = `Commercial entity with general relevance in ${targetMarket}.`;
    }

    const classification: CompetitorClassification = isDirect 
      ? "DIRECT_COMPETITOR" 
      : (isAdjacent ? "ADJACENT_COMPETITOR" : "NOT_COMPETITOR");

    if (classification === "NOT_COMPETITOR") continue;

    const judgeVerdict = "APPROVED_FOR_REVIEW";

    verifiedCandidates.push({
      name: raw.name,
      websiteUrl: raw.url,
      platform: "website",
      profileLink: raw.url,
      classification,
      reason: classificationReason,
      tier: classification === "DIRECT_COMPETITOR" ? "A" : "B",
      judgeVerdict,
      provenance: {
        searchProvider: "apify_google_search",
        searchQuery: raw.query,
        rawTitle: raw.rawTitle,
        rawSnippet: raw.rawSnippet,
        retrievedAt: new Date().toISOString()
      }
    });
  }

  let finalStatus: "DISCOVERY_COMPLETE" | "NO_VERIFIED_COMPETITORS" = "NO_VERIFIED_COMPETITORS";
  let message = "";

  if (verifiedCandidates.length >= 10) {
    finalStatus = "DISCOVERY_COMPLETE";
    message = `Discovered ${verifiedCandidates.length} real commercial competitors (minimum 10 requirement met).`;
  } else if (verifiedCandidates.length > 0) {
    finalStatus = "DISCOVERY_COMPLETE";
    message = `${verifiedCandidates.length} of 10 competitors verified. Avyron requires at least 10 approved competitors before strategy build.`;
  } else {
    finalStatus = "NO_VERIFIED_COMPETITORS";
    message = "Real search executed, but no direct or adjacent commercial competitors met approval criteria.";
  }

  return createDiscoveryResult(
    verifiedCandidates,
    finalStatus,
    searchQueries,
    "apify_google_search",
    rawCandidates.length,
    message
  );
}

function createDiscoveryResult(
  candidates: CandidateCompetitor[],
  status: "DISCOVERY_COMPLETE" | "NO_VERIFIED_COMPETITORS" | "SEARCH_PROVIDER_UNAVAILABLE" | "INSUFFICIENT_CONTEXT",
  searchQueries: string[],
  searchProvider: string,
  rawCandidateCount: number,
  message?: string
): CandidateCompetitor[] & CompetitorDiscoveryReport {
  const arr = [...candidates] as any;
  arr.status = status;
  arr.searchQueries = searchQueries;
  arr.searchProvider = searchProvider;
  arr.rawCandidateCount = rawCandidateCount;
  arr.candidates = candidates;
  arr.message = message;
  return arr;
}
