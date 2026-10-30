import { runWebsiteCrawler, type OwnBusinessPageEvidence } from "../business-understanding/crawler";
import { aiChat } from "../ai-client";
import { db } from "../db";
import { websiteSnapshots } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID as uuidv4 } from "crypto";
import crypto from "crypto";
import { isDocumentCandidateUrl, sanitizePostgresText } from "../shared/web-ingestion-guard";
import type {
  BusinessClassificationProfile,
  DeliveryCategory,
  BuyerSegmentCategory,
  MonetizationCategory,
} from "@shared/business-understanding-types";

export interface DiscoveredCatalogueItem {
  id: string;
  name: string;
  description: string;
  sourceUrl?: string;
  offeringType?: "PRODUCT" | "SERVICE" | "HYBRID_OFFERING" | "SAAS" | "DIGITAL_PRODUCT" | "PHYSICAL_PRODUCT";
  evidence?: string;
}

export interface FieldJudgments {
  companyName: "SUPPORTED" | "UNSUPPORTED" | "INSUFFICIENT_EVIDENCE";
  industry: "SUPPORTED" | "UNSUPPORTED" | "INSUFFICIENT_EVIDENCE";
  businessModel: "SUPPORTED" | "UNSUPPORTED" | "INSUFFICIENT_EVIDENCE";
  audience: "SUPPORTED" | "UNSUPPORTED" | "INSUFFICIENT_EVIDENCE";
  catalogue: "DISCOVERED" | "INSUFFICIENT_EVIDENCE";
}

export interface WebsiteAnalysisResult {
  snapshotId: string;
  websiteUrl: string;
  companyName: string;
  industry: string;
  businessModel: string;
  detectedAudience: string;
  detectedMarkets: string[];
  classificationProfile: BusinessClassificationProfile;
  evidenceGaps: string[];
  productCatalogue: DiscoveredCatalogueItem[];
  catalogueStatus: "DISCOVERED" | "INSUFFICIENT_EVIDENCE";
  fieldJudgments: FieldJudgments;
  pagesCrawledCount: number;
}

const VALID_DELIVERY_CATEGORIES: DeliveryCategory[] = [
  "SAAS_OR_WEB_APPLICATION",
  "DIGITAL_PRODUCT_OR_SERVICE",
  "PHYSICAL_PRODUCT",
  "PROFESSIONAL_OR_LOCAL_SERVICE",
  "MARKETPLACE_OR_PLATFORM",
  "HYBRID",
  "UNCERTAIN",
];

const VALID_BUYER_SEGMENTS: BuyerSegmentCategory[] = [
  "B2C",
  "B2B",
  "B2B_AND_B2C",
  "HYBRID",
  "UNCERTAIN",
];

const VALID_MONETIZATION_CATEGORIES: MonetizationCategory[] = [
  "SUBSCRIPTION",
  "ONE_TIME_PURCHASE",
  "USAGE_OR_TRANSACTION_BASED",
  "FREEMIUM_OR_TRIAL_TO_PAID",
  "QUOTE_OR_CONTRACT_BASED",
  "HYBRID",
  "UNKNOWN",
];

export function normalizeClassificationProfile(
  raw: any,
  crawlerGaps: string[] = []
): BusinessClassificationProfile {
  const rawDel = raw?.offeringAndDelivery || {};
  const rawBuy = raw?.buyerSegment || {};
  const rawMon = raw?.monetization || {};

  const delCandidate = rawDel.value || rawDel.category;
  const buyCandidate = rawBuy.value || rawBuy.category;
  const monCandidate = rawMon.value || rawMon.category;

  const delVal: DeliveryCategory = VALID_DELIVERY_CATEGORIES.includes(delCandidate)
    ? delCandidate
    : "UNCERTAIN";
  const buyVal: BuyerSegmentCategory = VALID_BUYER_SEGMENTS.includes(buyCandidate)
    ? buyCandidate
    : "UNCERTAIN";
  const monVal: MonetizationCategory = VALID_MONETIZATION_CATEGORIES.includes(monCandidate)
    ? monCandidate
    : "UNKNOWN";

  const validConf = ["HIGH", "MEDIUM", "LOW", "UNCERTAIN", "INSUFFICIENT_EVIDENCE"];
  const toEvidenceArr = (v: any): string[] =>
    Array.isArray(v)
      ? v.map((x) => String(x || "").trim()).filter(Boolean)
      : typeof v === "string" && v.trim()
      ? [v.trim()]
      : [];

  const rawGaps = Array.isArray(raw?.evidenceGaps)
    ? raw.evidenceGaps.map((g: any) => String(g || "").trim()).filter(Boolean)
    : [];

  const mergedGaps = Array.from(
    new Set([...(Array.isArray(crawlerGaps) ? crawlerGaps : []), ...rawGaps])
  );

  const delSummary =
    String(rawDel.summary || rawDel.reasoning || "").trim() ||
    "Delivery model could not be determined with certainty from extracted pages.";
  const delEvidence = toEvidenceArr(rawDel.evidence ?? rawDel.supportingEvidence);
  const delUncertainty =
    rawDel.uncertaintyReason || rawDel.uncertaintyNote
      ? String(rawDel.uncertaintyReason || rawDel.uncertaintyNote).trim()
      : null;

  const buySummary =
    String(rawBuy.summary || rawBuy.reasoning || "").trim() ||
    "Buyer segment could not be determined with certainty from extracted pages.";
  const buyEvidence = toEvidenceArr(rawBuy.evidence ?? rawBuy.supportingEvidence);
  const buyUncertainty =
    rawBuy.uncertaintyReason || rawBuy.uncertaintyNote
      ? String(rawBuy.uncertaintyReason || rawBuy.uncertaintyNote).trim()
      : null;

  const monSummary =
    String(rawMon.summary || rawMon.reasoning || "").trim() ||
    "Monetization model is not explicitly established in extracted pages.";
  const monEvidence = toEvidenceArr(rawMon.evidence ?? rawMon.supportingEvidence);
  const monUncertainty =
    rawMon.uncertaintyReason || rawMon.uncertaintyNote
      ? String(rawMon.uncertaintyReason || rawMon.uncertaintyNote).trim()
      : null;

  return {
    offeringAndDelivery: {
      value: delVal,
      category: delVal,
      summary: delSummary,
      reasoning: delSummary,
      confidence: validConf.includes(rawDel.confidence)
        ? rawDel.confidence
        : delVal === "UNCERTAIN"
          ? "UNCERTAIN"
          : "MEDIUM",
      evidence: delEvidence,
      supportingEvidence: delEvidence,
      uncertaintyReason: delUncertainty,
      uncertaintyNote: delUncertainty,
    },
    buyerSegment: {
      value: buyVal,
      category: buyVal,
      summary: buySummary,
      reasoning: buySummary,
      confidence: validConf.includes(rawBuy.confidence)
        ? rawBuy.confidence
        : buyVal === "UNCERTAIN"
          ? "UNCERTAIN"
          : "MEDIUM",
      evidence: buyEvidence,
      supportingEvidence: buyEvidence,
      uncertaintyReason: buyUncertainty,
      uncertaintyNote: buyUncertainty,
    },
    monetization: {
      value: monVal,
      category: monVal,
      summary: monSummary,
      reasoning: monSummary,
      confidence: validConf.includes(rawMon.confidence)
        ? rawMon.confidence
        : monVal === "UNKNOWN"
          ? "UNCERTAIN"
          : "MEDIUM",
      evidence: monEvidence,
      supportingEvidence: monEvidence,
      uncertaintyReason: monUncertainty,
      uncertaintyNote: monUncertainty,
    },
    evidenceGaps: mergedGaps,
  };
}

export async function analyzeCompanyWebsite(
  accountId: string,
  campaignId: string,
  websiteUrl: string,
  options?: { skipPersistence?: boolean }
): Promise<WebsiteAnalysisResult> {
  let cleanUrl = websiteUrl.trim();
  if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
    cleanUrl = "https://" + cleanUrl;
  }

  let snapshotId = "offline_" + uuidv4();

  if (!options?.skipPersistence) {
    // 1. Upsert websiteSnapshots record prior to crawl so it reliably exists for progress/failure tracking
    const [existing] = await db
      .select()
      .from(websiteSnapshots)
      .where(and(eq(websiteSnapshots.accountId, accountId), eq(websiteSnapshots.campaignId, campaignId)))
      .limit(1);

    snapshotId = existing ? existing.id : uuidv4();

    if (existing) {
      await db
        .update(websiteSnapshots)
        .set({
          rootUrl: cleanUrl,
          status: "RUNNING",
          failureCode: null
        })
        .where(eq(websiteSnapshots.id, existing.id));
    } else {
      await db.insert(websiteSnapshots).values({
        id: snapshotId,
        accountId,
        campaignId,
        rootUrl: cleanUrl,
        pagesCrawled: [],
        contentHash: "",
        status: "RUNNING"
      });
    }
  }

  // 2. Crawl first-party pages with structured section preservation and fragment deduplication
  const pages = await runWebsiteCrawler(snapshotId, cleanUrl, 6);
  if (!pages || pages.length === 0) {
    throw new Error("WEBSITE_CRAWL_FAILED: Unable to reach or extract content from the supplied website.");
  }

  const crawlerGaps: string[] = [];
  for (const p of pages) {
    if (Array.isArray(p.extractionGaps)) {
      crawlerGaps.push(...p.extractionGaps);
    }
  }

  const pageEvidenceText = pages
    .map(
      (p) =>
        `=== PAGE [${p.pageType || "HOME"}] (${p.sourceUrl}) (EvidenceID: ${p.businessEvidenceId}) ===\n` +
        p.cleanedText.slice(0, 6500)
    )
    .join("\n\n");

  // 3. Evidence-Grounded Multi-Dimensional LLM Classification
  const proposerPrompt = `You are the Avyron AI Business Intelligence Engine.
Analyze the following first-party website pages crawled from "${cleanUrl}".
Read all extracted sections including titles, headings, key pricing/delivery/buyer sections, body text, and extraction gap notes.

PAGES CRAWLED:
${pageEvidenceText}

CLASSIFICATION PRINCIPLES (STRICT):
1. Keep these three classification dimensions strictly separate:
   - Dimension A (offeringAndDelivery): What the product/service is and HOW it is delivered:
     "SAAS_OR_WEB_APPLICATION" | "DIGITAL_PRODUCT_OR_SERVICE" | "PHYSICAL_PRODUCT" | "PROFESSIONAL_OR_LOCAL_SERVICE" | "MARKETPLACE_OR_PLATFORM" | "HYBRID" | "UNCERTAIN"
   - Dimension B (buyerSegment): WHO buys it:
     "B2C" | "B2B" | "B2B_AND_B2C" | "HYBRID" | "UNCERTAIN"
   - Dimension C (monetization): HOW it makes money:
     "SUBSCRIPTION" | "ONE_TIME_PURCHASE" | "USAGE_OR_TRANSACTION_BASED" | "FREEMIUM_OR_TRIAL_TO_PAID" | "QUOTE_OR_CONTRACT_BASED" | "HYBRID" | "UNKNOWN"
2. Do NOT conflate sales channel, delivery mechanism, buyer type, and billing model:
   - Online checkout or gifting does NOT automatically mean physical e-commerce. A software tool, AI web app, or digital service can have online checkout or gifting use cases.
   - One-time or per-order payment does NOT mean a product cannot be SaaS or a software/web application.
   - SaaS / software applications do NOT require visible recurring subscription tiers to be classified as software.
   - If both consumer (personal/individual) and business (corporate/team/client/event) buyers or use cases are supported in the evidence, classify buyerSegment as "B2B_AND_B2C".
   - Missing or unextracted pricing details do NOT establish a particular monetization model; set monetization.value to "UNKNOWN" and record what could not be verified in "evidenceGaps".
3. Extract distinct offerings/products/services supported by the evidence into "productCatalogue". Do NOT invent unstated offerings.

Respond ONLY in valid JSON matching this structure:
{
  "companyName": { "value": "Official business or brand name", "evidence": "Citation from page text" },
  "industry": { "value": "Specific industry / category grounded in evidence", "evidence": "Why this industry matches" },
  "businessModel": { "value": "Nuanced summary combining delivery model, buyer segment (B2C/B2B/Both), and monetization from evidence", "evidence": "Supporting evidence" },
  "detectedAudience": { "value": "Target users and buyers (including both B2C and B2B segments if evidenced)", "evidence": "Supporting evidence" },
  "detectedMarkets": ["Countries or regions explicitly evidenced on the site, or empty array [] if none stated"],
  "classificationProfile": {
    "offeringAndDelivery": {
      "value": "SAAS_OR_WEB_APPLICATION | DIGITAL_PRODUCT_OR_SERVICE | PHYSICAL_PRODUCT | PROFESSIONAL_OR_LOCAL_SERVICE | MARKETPLACE_OR_PLATFORM | HYBRID | UNCERTAIN",
      "summary": "Concise description of what the offering is and how it is delivered",
      "confidence": "HIGH | MEDIUM | LOW | UNCERTAIN",
      "evidence": ["Verbatim or specific facts from crawled pages"],
      "uncertaintyReason": null
    },
    "buyerSegment": {
      "value": "B2C | B2B | B2B_AND_B2C | HYBRID | UNCERTAIN",
      "summary": "Who buys and uses the offering (e.g., individual consumers, corporate/business buyers, or both)",
      "confidence": "HIGH | MEDIUM | LOW | UNCERTAIN",
      "evidence": ["Verbatim or specific facts from crawled pages"],
      "uncertaintyReason": null
    },
    "monetization": {
      "value": "SUBSCRIPTION | ONE_TIME_PURCHASE | USAGE_OR_TRANSACTION_BASED | FREEMIUM_OR_TRIAL_TO_PAID | QUOTE_OR_CONTRACT_BASED | HYBRID | UNKNOWN",
      "summary": "How the business charges (e.g., free preview + pay-on-completion, subscription, one-time purchase, or unknown)",
      "confidence": "HIGH | MEDIUM | LOW | UNCERTAIN",
      "evidence": ["Verbatim or specific facts from crawled pages"],
      "uncertaintyReason": "If pricing details were truncated or not stated, explain what is missing"
    },
    "evidenceGaps": ["Any relevant product, pricing, buyer, or delivery details that could not be verified from the crawled text"]
  },
  "productCatalogue": [
    {
      "name": "Distinct Offering Name from evidence",
      "description": "Concise 1-2 sentence description including delivery and buyer use cases",
      "offeringType": "SAAS | DIGITAL_PRODUCT | PHYSICAL_PRODUCT | SERVICE | HYBRID_OFFERING | PRODUCT",
      "evidence": "Evidence where offering was described"
    }
  ]
}`;

  let parsed: any = null;
  try {
    const aiRes = await aiChat({
      messages: [
        {
          role: "system",
          content:
            "You are an expert business intelligence analyzer. Ground all findings strictly in crawled page evidence without forcing e-commerce or physical-retail assumptions. Return ONLY valid JSON."
        },
        { role: "user", content: proposerPrompt }
      ],
      model: "gpt-4o-mini",
      temperature: 0.1,
      max_tokens: 2500,
      accountId,
      endpoint: "setup-website-analysis"
    });

    const content = aiRes.choices?.[0]?.message?.content || "{}";
    const cleanedJson = content.replace(/```json/g, "").replace(/```/g, "").trim();
    parsed = JSON.parse(cleanedJson);
  } catch (err: any) {
    console.warn("[WebsiteAnalyzer] AI Extraction error:", err.message);
    crawlerGaps.push(`Preliminary AI classification unavailable (${err.message}); full canonical Business Understanding is required.`);
  }

  const rawCompanyName = typeof parsed?.companyName === "object" ? parsed?.companyName?.value : parsed?.companyName;
  const rawIndustry = typeof parsed?.industry === "object" ? parsed?.industry?.value : parsed?.industry;
  const rawBusinessModel = typeof parsed?.businessModel === "object" ? parsed?.businessModel?.value : parsed?.businessModel;
  const rawAudience = typeof parsed?.detectedAudience === "object" ? parsed?.detectedAudience?.value : parsed?.detectedAudience;

  const hostname = new URL(cleanUrl).hostname.replace(/^www\./, "").split(".")[0];
  const fallbackName = hostname.charAt(0).toUpperCase() + hostname.slice(1);

  const classificationProfile = normalizeClassificationProfile(parsed?.classificationProfile, crawlerGaps);

  // Company Name
  let companyName = "";
  let companyJudgment: FieldJudgments["companyName"] = "INSUFFICIENT_EVIDENCE";
  if (rawCompanyName && typeof rawCompanyName === "string" && rawCompanyName.trim().length > 0) {
    companyName = rawCompanyName.trim();
    companyJudgment = "SUPPORTED";
  } else {
    companyName = fallbackName;
    companyJudgment = "INSUFFICIENT_EVIDENCE";
  }

  // Industry — strictly from LLM evidence analysis, never from keyword guessing
  let industry = "";
  let industryJudgment: FieldJudgments["industry"] = "INSUFFICIENT_EVIDENCE";
  if (rawIndustry && typeof rawIndustry === "string" && rawIndustry.trim().length > 0) {
    industry = rawIndustry.trim();
    industryJudgment = "SUPPORTED";
  } else {
    industry = "Uncertain (Pending Canonical Business Understanding)";
    industryJudgment = "INSUFFICIENT_EVIDENCE";
  }

  // Business Model — strictly from LLM evidence analysis or synthesized from classificationProfile
  let businessModel = "";
  let businessModelJudgment: FieldJudgments["businessModel"] = "INSUFFICIENT_EVIDENCE";
  if (rawBusinessModel && typeof rawBusinessModel === "string" && rawBusinessModel.trim().length > 0) {
    businessModel = rawBusinessModel.trim();
    businessModelJudgment = "SUPPORTED";
  } else if (classificationProfile.offeringAndDelivery.value !== "UNCERTAIN") {
    businessModel = [
      classificationProfile.offeringAndDelivery.summary,
      classificationProfile.buyerSegment.value !== "UNCERTAIN" ? `(${classificationProfile.buyerSegment.value})` : "",
    ]
      .filter(Boolean)
      .join(" ");
    businessModelJudgment = "SUPPORTED";
  } else {
    businessModel = "Uncertain (Pending Canonical Business Understanding)";
    businessModelJudgment = "INSUFFICIENT_EVIDENCE";
  }

  // Audience
  let detectedAudience = "";
  let audienceJudgment: FieldJudgments["audience"] = "INSUFFICIENT_EVIDENCE";
  if (rawAudience && typeof rawAudience === "string" && rawAudience.trim().length > 0) {
    detectedAudience = rawAudience.trim();
    audienceJudgment = "SUPPORTED";
  } else if (classificationProfile.buyerSegment.summary) {
    detectedAudience = classificationProfile.buyerSegment.summary;
    audienceJudgment = classificationProfile.buyerSegment.value !== "UNCERTAIN" ? "SUPPORTED" : "INSUFFICIENT_EVIDENCE";
  }

  const detectedMarkets =
    Array.isArray(parsed?.detectedMarkets) && parsed.detectedMarkets.length > 0
      ? parsed.detectedMarkets.map((m: any) => String(m).trim()).filter(Boolean)
      : [];

  const validOfferingTypes = new Set([
    "PRODUCT",
    "SERVICE",
    "HYBRID_OFFERING",
    "SAAS",
    "DIGITAL_PRODUCT",
    "PHYSICAL_PRODUCT",
  ]);

  let productCatalogue: DiscoveredCatalogueItem[] = [];
  if (Array.isArray(parsed?.productCatalogue) && parsed.productCatalogue.length > 0) {
    productCatalogue = parsed.productCatalogue
      .filter((p: any) => p && typeof p.name === "string" && p.name.trim().length > 0)
      .map((p: any, idx: number) => ({
        id: "prod_" + (idx + 1) + "_" + uuidv4().slice(0, 6),
        name: p.name.trim(),
        description: p.description?.trim() || ("Offering from " + companyName),
        offeringType: validOfferingTypes.has(p.offeringType) ? p.offeringType : "PRODUCT",
        evidence: p.evidence || undefined
      }));
  }

  // If no items extracted from AI, check explicit product routes from crawled pages
  if (productCatalogue.length === 0) {
    const discoveredFromPages: DiscoveredCatalogueItem[] = [];
    for (const page of pages) {
      if (page.pageType === "PRODUCT" && page.sourceUrl && isDocumentCandidateUrl(page.sourceUrl)) {
        try {
          const parsedUrl = new URL(page.sourceUrl);
          const pathname = parsedUrl.pathname;
          const rawSlug = pathname.split("/").filter(Boolean).pop() || "";
          const cleanSlug = rawSlug.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]/g, " ").trim();
          if (cleanSlug && cleanSlug.length > 2 && !cleanSlug.toLowerCase().includes("product") && !cleanSlug.toLowerCase().includes("item")) {
            const capitalized = cleanSlug.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
            if (!discoveredFromPages.some(d => d.name.toLowerCase() === capitalized.toLowerCase())) {
              discoveredFromPages.push({
                id: "prod_" + (discoveredFromPages.length + 1) + "_" + uuidv4().slice(0, 6),
                name: sanitizePostgresText(capitalized),
                description: `Discovered from ${page.sourceUrl}`,
                offeringType: "PRODUCT",
                evidence: page.sourceUrl
              });
            }
          }
        } catch {}
      }
    }
    if (discoveredFromPages.length > 0) {
      productCatalogue = discoveredFromPages;
    }
  }

  const catalogueStatus: "DISCOVERED" | "INSUFFICIENT_EVIDENCE" =
    productCatalogue.length > 0 ? "DISCOVERED" : "INSUFFICIENT_EVIDENCE";

  const fieldJudgments: FieldJudgments = {
    companyName: companyJudgment,
    industry: industryJudgment,
    businessModel: businessModelJudgment,
    audience: audienceJudgment,
    catalogue: catalogueStatus
  };

  // 4. Persist Website Snapshot as SUCCESS with preliminary extraction for Step 1/Step 2 pre-BU context
  const contentHash = crypto.createHash("sha256").update(JSON.stringify(pages)).digest("hex");
  const preliminaryExtraction = {
    companyName,
    industry,
    businessModel,
    detectedAudience,
    detectedMarkets,
    classificationProfile,
    evidenceGaps: classificationProfile.evidenceGaps,
    productCatalogue,
    catalogueStatus,
    fieldJudgments,
    extractedAt: new Date().toISOString()
  };

  if (!options?.skipPersistence) {
    await db
      .update(websiteSnapshots)
      .set({
        rootUrl: cleanUrl,
        pagesCrawled: pages as any,
        contentHash,
        status: "SUCCESS",
        preliminaryExtraction: preliminaryExtraction as any
      })
      .where(eq(websiteSnapshots.id, snapshotId));
  }

  return {
    snapshotId,
    websiteUrl: cleanUrl,
    companyName,
    industry,
    businessModel,
    detectedAudience,
    detectedMarkets,
    classificationProfile,
    evidenceGaps: classificationProfile.evidenceGaps,
    productCatalogue,
    catalogueStatus,
    fieldJudgments,
    pagesCrawledCount: pages.length
  };
}
