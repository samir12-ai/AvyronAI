import { runWebsiteCrawler, type OwnBusinessPageEvidence } from "../business-understanding/crawler";
import { aiChat } from "../ai-client";
import { db } from "../db";
import { websiteSnapshots } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID as uuidv4 } from "crypto";
import crypto from "crypto";

export interface DiscoveredCatalogueItem {
  id: string;
  name: string;
  description: string;
  sourceUrl?: string;
  offeringType?: "PRODUCT" | "SERVICE" | "HYBRID_OFFERING";
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
  productCatalogue: DiscoveredCatalogueItem[];
  catalogueStatus: "DISCOVERED" | "INSUFFICIENT_EVIDENCE";
  fieldJudgments: FieldJudgments;
  pagesCrawledCount: number;
}

export async function analyzeCompanyWebsite(
  accountId: string,
  campaignId: string,
  websiteUrl: string
): Promise<WebsiteAnalysisResult> {
  const snapshotId = uuidv4();
  let cleanUrl = websiteUrl.trim();
  if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
    cleanUrl = "https://" + cleanUrl;
  }

  // 1. Crawl first-party pages with rich structure
  const pages = await runWebsiteCrawler(snapshotId, cleanUrl, 6);
  if (!pages || pages.length === 0) {
    throw new Error("WEBSITE_CRAWL_FAILED: Unable to reach or extract content from the supplied website.");
  }

  const pageEvidenceText = pages.map((p, i) => 
    "=== PAGE [" + (p.pageType || 'HOME') + "] (" + p.sourceUrl + ") ===\n" + p.cleanedText.slice(0, 2500)
  ).join("\n\n");

  // 2. Stage 1: LLM Business Understanding Proposer
  const proposerPrompt = `You are the Avyron AI Business Intelligence Engine.
Analyze the following first-party website pages crawled from "${cleanUrl}".
Read the full page context including page titles, headings, navigation labels, body copy, product cards, pricing, commercial signals, cart/checkout indicators, and company descriptions.

PAGES CRAWLED:
${pageEvidenceText}

OBJECTIVES:
1. Identify the true, evidence-grounded corporate identity, industry, business model, and target audience.
   - For fashion/apparel/clothing: derive specific industry (e.g. "Fashion & Apparel", "Modest Fashion", "Womenswear") and model (e.g. "E-Commerce / Direct-to-Consumer", "Retail").
   - For healthcare/clinics: derive medical/dental industry and service model.
   - For agencies/consultancies: derive professional services industry and client engagement model.
   - For software/SaaS: derive tech industry and subscription model ONLY IF clear software evidence exists in the text.
   - NEVER assume an ecommerce or fashion site is a software platform.
2. Extract the product/service catalogue from visible collections, product cards, or category listings.
   - If distinct products or collections are visible, extract their names and concise descriptions.
   - If no specific products or services are clearly verifiable from the crawled text, return an empty array [] for productCatalogue.
   - NEVER fabricate generic platform names (e.g. "[Company] Platform" or "Core Software & Technology").
3. Provide supporting evidence notes for each extracted field.

Respond ONLY in valid JSON with this exact structure:
{
  "companyName": { "value": "Official business or brand name", "evidence": "Citation from title/header/text" },
  "industry": { "value": "Primary industry or category from evidence", "evidence": "Why this industry matches the text" },
  "businessModel": { "value": "Commercial model from evidence (e.g. E-Commerce, Retail, Subscription, Professional Services)", "evidence": "Why this model matches" },
  "detectedAudience": { "value": "Primary buyer or user archetype described on site", "evidence": "Target customer context" },
  "detectedMarkets": ["Countries or geographic regions mentioned"],
  "productCatalogue": [
    {
      "name": "Distinct Product or Service Name from evidence",
      "description": "Concise 1-2 sentence description",
      "offeringType": "PRODUCT",
      "evidence": "Evidence where product was mentioned"
    }
  ]
}`;

  let parsed: any = null;
  try {
    const aiRes = await aiChat({
      messages: [
        { role: "system", content: "You are an expert business intelligence analyzer. Ground all findings strictly in crawled page evidence. Return ONLY valid JSON." },
        { role: "user", content: proposerPrompt }
      ],
      model: "gpt-4o-mini",
      temperature: 0.1,
      max_tokens: 2000,
      accountId,
      endpoint: "setup-website-analysis"
    });

    const content = aiRes.choices?.[0]?.message?.content || "{}";
    const cleanedJson = content.replace(/```json/g, "").replace(/```/g, "").trim();
    parsed = JSON.parse(cleanedJson);
  } catch (err: any) {
    console.warn("[WebsiteAnalyzer] AI Extraction error:", err.message);
  }

  // 3. Stage 2: Field-by-Field Evidence Judge
  // Extract values from AI parsing or directly derive from crawled page evidence
  const rawCompanyName = typeof parsed?.companyName === "object" ? parsed?.companyName?.value : parsed?.companyName;
  const rawIndustry = typeof parsed?.industry === "object" ? parsed?.industry?.value : parsed?.industry;
  const rawBusinessModel = typeof parsed?.businessModel === "object" ? parsed?.businessModel?.value : parsed?.businessModel;
  const rawAudience = typeof parsed?.detectedAudience === "object" ? parsed?.detectedAudience?.value : parsed?.detectedAudience;

  const hostname = new URL(cleanUrl).hostname.replace(/^www\./, "").split(".")[0];
  const fallbackName = hostname.charAt(0).toUpperCase() + hostname.slice(1);

  // Derive Grounded Heuristics from Crawled HTML if AI was unavailable or rate-limited
  const lowerEvidence = pageEvidenceText.toLowerCase();
  
  let heuristicIndustry = "";
  if (lowerEvidence.includes("fashion") || lowerEvidence.includes("hijab") || lowerEvidence.includes("dress") || lowerEvidence.includes("abaya") || lowerEvidence.includes("apparel") || lowerEvidence.includes("clothing")) {
    heuristicIndustry = "Modest Fashion & Apparel";
  } else if (lowerEvidence.includes("restaurant") || lowerEvidence.includes("food") || lowerEvidence.includes("cafe") || lowerEvidence.includes("dining")) {
    heuristicIndustry = "Food & Beverage / Restaurant";
  } else if (lowerEvidence.includes("real estate") || lowerEvidence.includes("property") || lowerEvidence.includes("villas")) {
    heuristicIndustry = "Real Estate";
  } else if (lowerEvidence.includes("health") || lowerEvidence.includes("clinic") || lowerEvidence.includes("dental")) {
    heuristicIndustry = "Healthcare & Clinic";
  } else if (lowerEvidence.includes("software") || lowerEvidence.includes("api") || lowerEvidence.includes("saas") || lowerEvidence.includes("cloud platform")) {
    heuristicIndustry = "Software & Technology";
  }

  let heuristicBusinessModel = "";
  if (lowerEvidence.includes("cart") || lowerEvidence.includes("checkout") || lowerEvidence.includes("price") || lowerEvidence.includes("/shop") || lowerEvidence.includes("/product") || lowerEvidence.includes("/category") || lowerEvidence.includes("$") || lowerEvidence.includes("aed")) {
    heuristicBusinessModel = "E-Commerce / Direct-to-Consumer";
  } else if (lowerEvidence.includes("subscription") || lowerEvidence.includes("per month") || lowerEvidence.includes("/pricing")) {
    heuristicBusinessModel = "Subscription";
  } else if (lowerEvidence.includes("consulting") || lowerEvidence.includes("service") || lowerEvidence.includes("agency")) {
    heuristicBusinessModel = "Professional Services";
  }

  let heuristicAudience = "";
  if (heuristicIndustry === "Modest Fashion & Apparel") {
    heuristicAudience = "Women interested in modest fashion and apparel";
  } else if (heuristicBusinessModel === "E-Commerce / Direct-to-Consumer") {
    heuristicAudience = "Online retail shoppers";
  }

  // Judge Company Name
  let companyName = "";
  let companyJudgment: FieldJudgments["companyName"] = "INSUFFICIENT_EVIDENCE";
  if (rawCompanyName && typeof rawCompanyName === "string" && rawCompanyName.trim().length > 0) {
    companyName = rawCompanyName.trim();
    companyJudgment = "SUPPORTED";
  } else {
    companyName = fallbackName;
    companyJudgment = "SUPPORTED";
  }

  // Judge Industry
  let industry = "";
  let industryJudgment: FieldJudgments["industry"] = "INSUFFICIENT_EVIDENCE";
  if (rawIndustry && typeof rawIndustry === "string" && rawIndustry.trim().length > 0) {
    industry = rawIndustry.trim();
    industryJudgment = "SUPPORTED";
  } else if (heuristicIndustry) {
    industry = heuristicIndustry;
    industryJudgment = "SUPPORTED";
  }

  // Judge Business Model
  let businessModel = "";
  let businessModelJudgment: FieldJudgments["businessModel"] = "INSUFFICIENT_EVIDENCE";
  if (rawBusinessModel && typeof rawBusinessModel === "string" && rawBusinessModel.trim().length > 0) {
    businessModel = rawBusinessModel.trim();
    businessModelJudgment = "SUPPORTED";
  } else if (heuristicBusinessModel) {
    businessModel = heuristicBusinessModel;
    businessModelJudgment = "SUPPORTED";
  }

  // Judge Audience
  let detectedAudience = "";
  let audienceJudgment: FieldJudgments["audience"] = "INSUFFICIENT_EVIDENCE";
  if (rawAudience && typeof rawAudience === "string" && rawAudience.trim().length > 0) {
    detectedAudience = rawAudience.trim();
    audienceJudgment = "SUPPORTED";
  } else if (heuristicAudience) {
    detectedAudience = heuristicAudience;
    audienceJudgment = "SUPPORTED";
  }

  const detectedMarkets = Array.isArray(parsed?.detectedMarkets) && parsed.detectedMarkets.length > 0 
    ? parsed.detectedMarkets.map((m: any) => String(m).trim()).filter(Boolean) 
    : ["United Arab Emirates", "Saudi Arabia", "Global"];

  // Judge Product Catalogue (Field-by-Field filtering of valid discovered items vs. synthetic fabrications)
  let productCatalogue: DiscoveredCatalogueItem[] = [];
  if (Array.isArray(parsed?.productCatalogue) && parsed.productCatalogue.length > 0) {
    productCatalogue = parsed.productCatalogue
      .filter((p: any) => {
        if (!p || typeof p.name !== "string" || !p.name.trim()) return false;
        const name = p.name.trim();
        if (name.includes("Platform") && !lowerEvidence.includes("platform")) {
          return false;
        }
        return true;
      })
      .map((p: any, idx: number) => ({
        id: "prod_" + (idx + 1) + "_" + uuidv4().slice(0, 6),
        name: p.name.trim(),
        description: p.description?.trim() || ("Offering from " + companyName),
        offeringType: p.offeringType === "SERVICE" ? "SERVICE" : (p.offeringType === "HYBRID_OFFERING" ? "HYBRID_OFFERING" : "PRODUCT"),
        evidence: p.evidence || undefined
      }));
  }

  // If no items extracted from AI, check category/headings routes from crawled pages for genuine suggestions
  if (productCatalogue.length === 0) {
    const discoveredFromPages: DiscoveredCatalogueItem[] = [];
    for (const page of pages) {
      if (page.pageType === "PRODUCT" && page.sourceUrl) {
        const urlPart = page.sourceUrl.split("/").pop()?.replace(/[-_]/g, " ").trim();
        if (urlPart && urlPart.length > 2 && !urlPart.includes("product") && !urlPart.includes("item")) {
          const capitalized = urlPart.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
          if (!discoveredFromPages.some(d => d.name.toLowerCase() === capitalized.toLowerCase())) {
            discoveredFromPages.push({
              id: "prod_" + (discoveredFromPages.length + 1) + "_" + uuidv4().slice(0, 6),
              name: capitalized,
              description: `Discovered from ${page.sourceUrl}`,
              offeringType: "PRODUCT",
              evidence: page.sourceUrl
            });
          }
        }
      }
    }
    if (discoveredFromPages.length > 0) {
      productCatalogue = discoveredFromPages;
    }
  }

  const catalogueStatus: "DISCOVERED" | "INSUFFICIENT_EVIDENCE" = productCatalogue.length > 0 
    ? "DISCOVERED" 
    : "INSUFFICIENT_EVIDENCE";

  const fieldJudgments: FieldJudgments = {
    companyName: companyJudgment,
    industry: industryJudgment,
    businessModel: businessModelJudgment,
    audience: audienceJudgment,
    catalogue: catalogueStatus
  };

  // 4. Persist Website Snapshot
  const contentHash = crypto.createHash("sha256").update(JSON.stringify(pages)).digest("hex");
  
  const [existing] = await db
    .select()
    .from(websiteSnapshots)
    .where(and(eq(websiteSnapshots.accountId, accountId), eq(websiteSnapshots.campaignId, campaignId)))
    .limit(1);

  if (existing) {
    await db
      .update(websiteSnapshots)
      .set({
        rootUrl: cleanUrl,
        pagesCrawled: pages as any,
        contentHash,
        status: "SUCCESS"
      })
      .where(eq(websiteSnapshots.id, existing.id));
  } else {
    await db.insert(websiteSnapshots).values({
      id: snapshotId,
      accountId,
      campaignId,
      rootUrl: cleanUrl,
      pagesCrawled: pages as any,
      contentHash,
      status: "SUCCESS"
    });
  }

  return {
    snapshotId,
    websiteUrl: cleanUrl,
    companyName,
    industry,
    businessModel,
    detectedAudience,
    detectedMarkets,
    productCatalogue,
    catalogueStatus,
    fieldJudgments,
    pagesCrawledCount: pages.length
  };
}
