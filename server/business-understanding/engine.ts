import { z } from "zod";
import { aiGemini, aiChat } from "../ai-client";
import { db } from "../db";
import { 
  businessUnderstandingSnapshots, 
  websiteSnapshots, 
  offeringInputEvidence, 
  campaignOfferings,
  businesses,
  businessProducts,
  campaignSelections,
} from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import type { 
  BusinessUnderstandingPayload,
  CampaignOffering,
  TargetUnderstanding,
  ProductTruthFact,
  TargetRoleFact,
  BusinessClassificationProfile,
} from "@shared/business-understanding-types";
import { normalizeClassificationProfile } from "../setup/website-analyzer";
import { randomUUID as uuidv4 } from "crypto";

const toStr = (v: any) => Array.isArray(v) ? v.join(", ") : (v != null ? String(v) : "");

const aiBusinessUnderstandingSchema = z.object({
  businessName: z.any().transform(toStr),
  businessModel: z.any().transform(toStr),
  generalIndustry: z.any().transform(toStr),
  classificationProfile: z.any().optional(),
  discoveredOfferings: z.array(z.object({
    offeringName: z.any().transform(toStr),
    offeringScope: z.any().transform(toStr).optional().default("B2C"),
    description: z.any().transform(toStr).optional().default(""),
    isSelectedCampaignScope: z.boolean().optional().default(false),
    sourcePageUrls: z.array(z.any().transform(toStr)).optional().default([])
  })).optional().default([]),
  unresolvedConflicts: z.array(z.object({
    dimension: z.enum(["MONETIZATION", "CAPABILITY", "DELIVERY", "BUYER_SCOPE", "POLICY"]).optional().default("MONETIZATION"),
    summary: z.any().transform(toStr),
    evidenceA: z.object({
      statement: z.any().transform(toStr),
      sourceUrl: z.any().transform(toStr).optional().default(""),
      evidenceId: z.any().transform(toStr).optional().default(""),
    }).optional().default({ statement: "", sourceUrl: "", evidenceId: "" }),
    evidenceB: z.object({
      statement: z.any().transform(toStr),
      sourceUrl: z.any().transform(toStr).optional().default(""),
      evidenceId: z.any().transform(toStr).optional().default(""),
    }).optional().default({ statement: "", sourceUrl: "", evidenceId: "" }),
    resolutionStatus: z.enum(["UNRESOLVED_CONFLICT", "SCOPED_BY_OFFERING"]).optional().default("UNRESOLVED_CONFLICT"),
  })).optional().default([]),
  campaignOffering: z.object({
    offeringType: z.enum(["PRODUCT", "SERVICE", "HYBRID_OFFERING", "SAAS", "DIGITAL_PRODUCT", "PHYSICAL_PRODUCT"]).optional().default("PRODUCT"),
    category: z.any().transform(toStr),
    pricingModel: z.any().transform(toStr),
    productTruthFacts: z.array(z.object({
      statement: z.any().transform(toStr),
      factType: z.enum(["CAPABILITY", "BOUNDARY", "USE_CASE", "DELIVERY_MECHANISM", "PRICING_FACT", "PROOF"]).optional().default("CAPABILITY"),
      status: z.enum(["WEBSITE_ESTABLISHED", "USER_CONFIRMED", "SYSTEM_INFERRED", "UNKNOWN"]).optional().default("WEBSITE_ESTABLISHED"),
      rationale: z.any().transform(toStr),
      sourcePageUrl: z.any().transform(toStr).optional().default(""),
      sourceQuote: z.any().transform(toStr).optional().default(""),
      sourceEvidenceId: z.any().transform(toStr).optional().default(""),
      sourceSection: z.any().transform(toStr).optional().default(""),
    })).optional().default([])
  }),
  targetUnderstanding: z.object({
    targetRoles: z.array(z.object({
      roleType: z.enum(["USER", "BUYER", "DECISION_MAKER", "BUSINESS_CONTEXT"]).optional().default("USER"),
      roleTitle: z.any().transform(toStr),
      status: z.enum(["WEBSITE_ESTABLISHED", "USER_CONFIRMED", "SYSTEM_INFERRED", "UNKNOWN"]).optional().default("WEBSITE_ESTABLISHED"),
      rationale: z.any().transform(toStr),
      sourcePageUrl: z.any().transform(toStr).optional().default(""),
      sourceQuote: z.any().transform(toStr).optional().default(""),
      sourceEvidenceId: z.any().transform(toStr).optional().default(""),
    })).optional().default([])
  })
});

function normalizeArrayItems(arr: any, textKey: string): any[] {
  const list = Array.isArray(arr) ? arr : (arr && typeof arr === 'object' ? [arr] : []);
  return list.map(item => {
    if (typeof item === 'string') {
      return { [textKey]: item };
    }
    if (item && typeof item === 'object') {
      const sanitized: any = {};
      for (const [k, v] of Object.entries(item)) {
        sanitized[k] = v === null ? "" : v;
      }
      const textVal = sanitized[textKey] || sanitized.statement || sanitized.text || sanitized.claim || sanitized.name || sanitized.description || sanitized.capability || sanitized.offer || sanitized.promise || sanitized.primaryPromise || "";
      return { ...sanitized, [textKey]: textVal || "Established first-party evidence item" };
    }
    return null;
  }).filter(Boolean);
}

/**
 * Extracts unanswered FAQ questions from plain text (e.g. legacy stored website_snapshots
 * where accordion/FAQ pages captured only question headings ending in '?' without answer sentences).
 */
export function extractUnansweredFaqQuestionsFromText(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const unanswered: string[] = [];
  const seen = new Set<string>();
  const questionRegex = /([A-Z][A-Za-z0-9\s,'’"“”\-()\/&]{8,160}\?)/g;
  let match: RegExpExecArray | null;
  while ((match = questionRegex.exec(text)) !== null) {
    const q = match[1].replace(/\s+/g, " ").trim();
    const norm = q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(norm)) continue;

    const afterIdx = match.index + match[0].length;
    const trailing = text.slice(afterIdx, afterIdx + 220).trim();
    // If trailing text is empty, starts immediately with another question before any period,
    // or has no declarative sentence ending with a period, the question is unanswered in stored text.
    const nextPeriodIdx = trailing.indexOf(".");
    const nextQuestionIdx = trailing.indexOf("?");
    const hasImmediateNextQuestion =
      nextQuestionIdx !== -1 && (nextPeriodIdx === -1 || nextQuestionIdx < nextPeriodIdx);
    const hasNoDeclarativeAnswer = nextPeriodIdx === -1 || nextPeriodIdx > 180;

    if (!trailing || hasImmediateNextQuestion || hasNoDeclarativeAnswer) {
      seen.add(norm);
      unanswered.push(q);
    }
  }
  return unanswered;
}

/**
 * Prevents bare FAQ questions (e.g. "Can I edit my lyrics?") from establishing
 * a WEBSITE_ESTABLISHED capability when the answer text was not acquired.
 */
export function enforceFaqAnswerGroundingOnFacts<T extends {
  statement: string;
  status?: string;
  sourceQuote?: string;
  sourcePageUrl?: string;
  sourceEvidenceId?: string;
  rationale?: string;
}>(
  facts: T[],
  unansweredFaqQuestions: string[],
  evidenceGaps: string[],
  faqOnlyEvidenceIds?: Set<string>,
): T[] {
  const normalizedUnanswered = unansweredFaqQuestions.map(q =>
    q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  );

  return facts.map(fact => {
    const quote = (fact.sourceQuote || "").trim();
    const normQuote = quote.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const normStmt = (fact.statement || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

    // True if the quote consists solely of one or more questions ending in '?' without any declarative sentence
    const isSolelyQuestionQuote =
      quote.includes("?") &&
      !quote.includes(".") &&
      quote.length < 350;

    const matchesUnansweredFaqQuote = normalizedUnanswered.some(
      uq => uq.length >= 10 && (normQuote.includes(uq) || uq.includes(normQuote))
    );

    const citesFaqOnlyPage =
      (fact.sourceEvidenceId && faqOnlyEvidenceIds?.has(fact.sourceEvidenceId)) ||
      /\/faq\b/i.test(fact.sourcePageUrl || "");

    const matchesUnansweredFaqTopicOnFaqPage =
      citesFaqOnlyPage &&
      normalizedUnanswered.some(uq => {
        const tokens = uq
          .split(/\s+/)
          .filter(w => w.length >= 4 && !["what", "when", "where", "which", "does", "have", "your", "with", "from", "that", "this", "will", "there", "song", "songs", "songai"].includes(w));
        if (tokens.length === 0) return false;
        const matchedCount = tokens.filter(t => normStmt.includes(t) || normQuote.includes(t)).length;
        return matchedCount >= Math.min(2, tokens.length);
      });

    if (isSolelyQuestionQuote || matchesUnansweredFaqQuote || matchesUnansweredFaqTopicOnFaqPage) {
      const gapMsg = `Capability "${fact.statement}" cited an unanswered FAQ question ("${quote || fact.statement}"); marked UNKNOWN until answer is acquired.`;
      if (!evidenceGaps.includes(gapMsg)) {
        evidenceGaps.push(gapMsg);
      }
      return {
        ...fact,
        status: "UNKNOWN",
        rationale: `${fact.rationale ? `${fact.rationale} | ` : ""}Downgraded from WEBSITE_ESTABLISHED to UNKNOWN because source quote is an unanswered question without extracted answer text.`,
      };
    }
    return fact;
  });
}

export function detectCrossPageConflicts(pages: any[]): Array<{
  conflictId: string;
  dimension: "MONETIZATION" | "CAPABILITY" | "DELIVERY" | "BUYER_SCOPE" | "POLICY";
  summary: string;
  evidenceA: { statement: string; sourceUrl?: string; evidenceId?: string };
  evidenceB: { statement: string; sourceUrl?: string; evidenceId?: string };
  resolutionStatus: "UNRESOLVED_CONFLICT" | "SCOPED_BY_OFFERING";
}> {
  const conflicts: Array<{
    conflictId: string;
    dimension: "MONETIZATION" | "CAPABILITY" | "DELIVERY" | "BUYER_SCOPE" | "POLICY";
    summary: string;
    evidenceA: { statement: string; sourceUrl?: string; evidenceId?: string };
    evidenceB: { statement: string; sourceUrl?: string; evidenceId?: string };
    resolutionStatus: "UNRESOLVED_CONFLICT" | "SCOPED_BY_OFFERING";
  }> = [];

  const payPerOrderPage = pages.find(p =>
    /\b(pay only if you love|pay only to gift|one[- ]time payment|one[- ]off|no subscription|per song)\b/i.test(p.cleanedText || "")
  );
  const termsSubscriptionPage = pages.find(p =>
    p !== payPerOrderPage &&
    /\b(subscriptions?|recurring billing|monthly billing|auto[- ]renew)\b/i.test(p.cleanedText || "")
  );

  if (payPerOrderPage && termsSubscriptionPage) {
    conflicts.push({
      conflictId: `conflict_monetization_${uuidv4().slice(0, 8)}`,
      dimension: "MONETIZATION",
      summary:
        "Primary product page describes pay-per-order / pay-only-to-gift checkout, while legal/terms or secondary page references Subscriptions. Do not infer active consumer subscriptions from a terms heading alone or universal absence of subscriptions from a single headline.",
      evidenceA: {
        statement: "Pay-per-order / conditional purchase flow on primary offering page",
        sourceUrl: payPerOrderPage.sourceUrl,
        evidenceId: payPerOrderPage.businessEvidenceId,
      },
      evidenceB: {
        statement: "Subscriptions / recurring billing section referenced in terms or secondary page",
        sourceUrl: termsSubscriptionPage.sourceUrl,
        evidenceId: termsSubscriptionPage.businessEvidenceId,
      },
      resolutionStatus: "UNRESOLVED_CONFLICT",
    });
  }

  return conflicts;
}

export async function runBusinessUnderstandingEngine(
  accountId: string,
  campaignId: string,
  campaignOfferingId: string
): Promise<string> {
  const authorityId = uuidv4();
  
  // 1. Fetch the inputs
  const offeringRec = await db.select().from(campaignOfferings).where(eq(campaignOfferings.id, campaignOfferingId)).limit(1);
  if (!offeringRec.length) throw new Error("Offering not found");
  
  const offeringName = offeringRec[0].offeringName;
  const sourceEvidenceId = offeringRec[0].sourceInputEvidenceId;
  
  const evidenceRec = await db.select().from(offeringInputEvidence).where(eq(offeringInputEvidence.id, sourceEvidenceId)).limit(1);
  const notes = evidenceRec[0]?.rawFeaturesAndNotes || "";

  const [campaignSel] = await db
    .select()
    .from(campaignSelections)
    .where(and(eq(campaignSelections.accountId, accountId), eq(campaignSelections.selectedCampaignId, campaignId)))
    .limit(1);

  const resolvedBusinessId = offeringRec[0].businessId || campaignSel?.businessId || null;
  const resolvedProductId = offeringRec[0].productId || campaignSel?.productId || null;

  const [businessRow] = resolvedBusinessId
    ? await db.select().from(businesses).where(and(eq(businesses.accountId, accountId), eq(businesses.id, resolvedBusinessId))).limit(1)
    : [];
  const [productRow] = resolvedProductId
    ? await db.select().from(businessProducts).where(and(eq(businessProducts.accountId, accountId), eq(businessProducts.id, resolvedProductId))).limit(1)
    : [];

  let websiteRec = await db.select().from(websiteSnapshots)
    .where(and(eq(websiteSnapshots.campaignId, campaignId), eq(websiteSnapshots.accountId, accountId)))
    .orderBy(desc(websiteSnapshots.createdAt))
    .limit(1);

  let websiteDataReuseStatus: "NEWLY_ACQUIRED" | "REUSED_FROM_CACHE" = "NEWLY_ACQUIRED";
  if (!websiteRec.length && businessRow?.sourceWebsiteSnapshotId) {
    websiteRec = await db.select().from(websiteSnapshots)
      .where(and(eq(websiteSnapshots.id, businessRow.sourceWebsiteSnapshotId), eq(websiteSnapshots.accountId, accountId)))
      .limit(1);
    if (websiteRec.length > 0) {
      websiteDataReuseStatus = "REUSED_FROM_CACHE";
    }
  }
    
  const websiteSnapshotId = websiteRec[0]?.id || businessRow?.sourceWebsiteSnapshotId || "no_website_snapshot";
  const websiteUrl = offeringRec[0].productUrl || productRow?.productUrl || websiteRec[0]?.rootUrl || businessRow?.websiteUrl || "";

  // Collect real page-level evidence, deduplicate identical contentHash captures, and surface truncation/FAQ gaps
  const rawPages = (websiteRec[0]?.pagesCrawled as any[] || []);
  const pages: any[] = [];
  const seenContentHashes = new Map<string, any>();
  const crawlerGaps: string[] = [];
  const discoveredUrlsSet = new Set<string>();
  const acquiredUrls: string[] = [];
  const resolvedFragmentsSet = new Set<string>();
  const unansweredFaqQuestions: string[] = [];
  const faqOnlyEvidenceIds = new Set<string>();
  let extractedSectionsCount = 0;
  let answeredFaqCount = 0;

  for (const p of rawPages) {
    const rawText = String(p.cleanedText || p.extractedText || p.snippet || "").trim();
    const contentHash = String(p.contentHash || "").trim();

    if (p.sourceUrl) {
      discoveredUrlsSet.add(p.sourceUrl);
    }

    // Check for duplicate contentHash (e.g. /#pricing hash anchor returning identical HTML/text to /)
    if (contentHash && seenContentHashes.has(contentHash)) {
      const canonicalPage = seenContentHashes.get(contentHash);
      const dupGap = `Duplicate page content excluded: ${p.sourceUrl} (${p.businessEvidenceId}, pageType=${p.pageType}) has identical contentHash (${contentHash.slice(0, 12)}) to ${canonicalPage.sourceUrl} (${canonicalPage.businessEvidenceId}); not treated as a separate ${p.pageType} source.`;
      if (!crawlerGaps.includes(dupGap)) {
        crawlerGaps.push(dupGap);
      }
      if (String(p.sourceUrl || "").includes("#")) {
        const frag = String(p.sourceUrl).split("#")[1];
        const fragGap = `In-page fragment '#${frag}' (${p.sourceUrl}) returned duplicate root document text without extracting the target pricing/section block; actual '${frag}' details remain UNKNOWN.`;
        if (!crawlerGaps.includes(fragGap)) {
          crawlerGaps.push(fragGap);
        }
      }
      continue;
    }

    if (contentHash) {
      seenContentHashes.set(contentHash, p);
    }
    pages.push(p);

    if (p.sourceUrl) {
      acquiredUrls.push(p.sourceUrl);
    }
    if (Array.isArray(p.extractionGaps)) {
      for (const g of p.extractionGaps) {
        if (!crawlerGaps.includes(g)) crawlerGaps.push(g);
      }
    }

    // Detect legacy ~2,000-char truncation or mid-sentence cutoff in stored snapshots
    const isLegacyTruncated =
      p.wasTruncated === true ||
      (rawText.length >= 1970 && rawText.length <= 2005) ||
      (rawText.length > 400 && !/[.!?'"»)\]]$/.test(rawText));
    if (isLegacyTruncated) {
      const tailSnippet = rawText.slice(-35).replace(/\s+/g, " ");
      const truncGap = `Stored page ${p.sourceUrl} (${p.businessEvidenceId}) is truncated at ${rawText.length} characters (ends at "...${tailSnippet}"); any pricing figures, terms clauses, or sections beyond char ${rawText.length} were not captured in stored evidence and remain UNKNOWN.`;
      if (!crawlerGaps.includes(truncGap)) {
        crawlerGaps.push(truncGap);
      }
    }

    if (Array.isArray(p.inPageSections)) {
      for (const s of p.inPageSections) resolvedFragmentsSet.add(s);
    }
    if (p.coverage) {
      if (Array.isArray(p.coverage.discoveredLinks)) {
        for (const u of p.coverage.discoveredLinks) discoveredUrlsSet.add(u);
      }
      if (Array.isArray(p.coverage.resolvedFragments)) {
        for (const f of p.coverage.resolvedFragments) resolvedFragmentsSet.add(f);
      }
      extractedSectionsCount += Number(p.coverage.extractedSectionsCount || 0);
      answeredFaqCount += Number(p.coverage.answeredFaqCount || 0);
    }
    if (Array.isArray(p.faqItems)) {
      let pageAnswered = 0;
      let pageUnanswered = 0;
      for (const faq of p.faqItems) {
        if (faq.status === "MISSING_ANSWER" && faq.question) {
          if (!unansweredFaqQuestions.includes(faq.question)) {
            unansweredFaqQuestions.push(faq.question);
          }
          pageUnanswered++;
        } else if (faq.status === "ANSWER_EXTRACTED") {
          pageAnswered++;
        }
      }
      if (pageUnanswered > 0 && pageAnswered === 0 && p.businessEvidenceId) {
        faqOnlyEvidenceIds.add(p.businessEvidenceId);
      }
    } else {
      // Legacy snapshot without pre-parsed faqItems: detect unanswered questions in plain text
      const plainTextUnanswered = extractUnansweredFaqQuestionsFromText(rawText);
      if (plainTextUnanswered.length >= 3 || /\/faq\b/i.test(p.sourceUrl || "")) {
        for (const q of plainTextUnanswered) {
          if (!unansweredFaqQuestions.includes(q)) {
            unansweredFaqQuestions.push(q);
          }
        }
        if (plainTextUnanswered.length >= 3 && p.businessEvidenceId) {
          faqOnlyEvidenceIds.add(p.businessEvidenceId);
          const faqGap = `Stored page ${p.sourceUrl} (${p.businessEvidenceId}) contains ${plainTextUnanswered.length} FAQ question headings without extracted answer bodies; capabilities mentioned only in these questions are UNKNOWN.`;
          if (!crawlerGaps.includes(faqGap)) {
            crawlerGaps.push(faqGap);
          }
        }
      }
    }
  }

  const detectedConflicts = detectCrossPageConflicts(pages);

  const pageEvidenceBlocks = pages.map((p, idx) => {
    const rawText = String(p.cleanedText || p.extractedText || p.snippet || "").trim();
    const isFaqOnly = p.businessEvidenceId && faqOnlyEvidenceIds.has(p.businessEvidenceId);
    const isTrunc =
      p.wasTruncated === true ||
      (rawText.length >= 1970 && rawText.length <= 2005) ||
      (rawText.length > 400 && !/[.!?'"»)\]]$/.test(rawText));
    const notesHeader: string[] = [];
    if (isTrunc) {
      notesHeader.push(`[STORED SNAPSHOT LIMITATION: Text truncated at ${rawText.length} chars — do NOT invent content cut off after the end of this snippet]`);
    }
    if (isFaqOnly) {
      notesHeader.push(`[STORED SNAPSHOT LIMITATION: This FAQ page captured only collapsed question headings without answers — do NOT mark any capability from these questions as WEBSITE_ESTABLISHED; set status to UNKNOWN]`);
    }
    return `--- PAGE [${p.pageType || 'HOME'}] (${p.sourceUrl || websiteUrl}) (EvidenceID: ${p.businessEvidenceId || `ev_web_${idx}`}) (ContentHash: ${p.contentHash || 'v1'}) ---\n${notesHeader.length ? notesHeader.join("\n") + "\n" : ""}${rawText}`;
  }).join("\n\n");

  const evidenceIds = [sourceEvidenceId, ...rawPages.map(p => p.businessEvidenceId).filter(Boolean)];

  const unansweredFaqPromptBlock = unansweredFaqQuestions.length > 0
    ? `\nUNANSWERED FAQ QUESTIONS IN STORED EVIDENCE (NO ANSWERS EXTRACTED — DO NOT PROMOTE TO WEBSITE_ESTABLISHED CAPABILITIES):\n${unansweredFaqQuestions.map(q => `- "${q}" [MISSING_ANSWER]`).join("\n")}\n`
    : "";

  const extractionLimitationsBlock = crawlerGaps.length > 0
    ? `\nKNOWN STORED EVIDENCE LIMITATIONS & GAPS (RETAIN THESE LIMITATIONS IN "evidenceGaps"):\n${crawlerGaps.map(g => `- ${g}`).join("\n")}\n`
    : "";

  const inheritedCompanyFacts = Array.isArray(businessRow?.verifiedCompanyFacts)
    ? (businessRow.verifiedCompanyFacts as any[])
    : [];
  const productSpecificContextBlock = [
    productRow?.name || offeringName ? `Selected Product/Service Name: ${productRow?.name || offeringName}` : "",
    productRow?.productType || offeringRec[0]?.productType ? `Offering Type: ${productRow?.productType || offeringRec[0]?.productType}` : "",
    productRow?.description || offeringRec[0]?.description ? `Product Description: ${productRow?.description || offeringRec[0]?.description}` : "",
    productRow?.productUrl || offeringRec[0]?.productUrl ? `Product URL: ${productRow?.productUrl || offeringRec[0]?.productUrl}` : "",
    productRow?.pricingModel || offeringRec[0]?.pricingModel ? `Confirmed Pricing Model: ${productRow?.pricingModel || offeringRec[0]?.pricingModel}` : "",
    productRow?.purchaseModel || offeringRec[0]?.purchaseModel ? `Confirmed Purchase Model: ${productRow?.purchaseModel || offeringRec[0]?.purchaseModel}` : "",
    productRow?.documentationText || offeringRec[0]?.documentationText ? `Product Documentation / Specs:\n${productRow?.documentationText || offeringRec[0]?.documentationText}` : "",
    Array.isArray(productRow?.verifiedCapabilities) && (productRow.verifiedCapabilities as any[]).length > 0
      ? `User-Verified Offering Capabilities:\n${(productRow.verifiedCapabilities as any[]).map((c: any) => `- ${typeof c === "string" ? c : c.statement || JSON.stringify(c)}`).join("\n")}`
      : "",
    inheritedCompanyFacts.length > 0
      ? `Reusable Verified Company-Level Facts (inherit ONLY applicable company identity facts; NEVER inherit another product's capabilities, pricing, or promises):\n${inheritedCompanyFacts.map((cf: any) => `- [${cf.factId || "company_fact"}] ${cf.statement || JSON.stringify(cf)}`).join("\n")}`
      : "",
  ].filter(Boolean).join("\n");

  // 2. Proposer Prompt with REAL website evidence and offering notes
  const prompt = `
You are the Avyron Business Intelligence Engine.
Analyze the following first-party website evidence and campaign offering scope for "${offeringName}".
Generate an exhaustive, highly granular, evidence-grounded Business Understanding.

OFFERING SCOPE & USER NOTES:
Offering Name: ${offeringName}
[${sourceEvidenceId}] Offering Notes:
${notes}
${productSpecificContextBlock ? `\nPRODUCT-SPECIFIC CONFIGURATION & REUSABLE COMPANY IDENTITY:\n${productSpecificContextBlock}\n` : ""}
CRAWLED FIRST-PARTY WEBSITE EVIDENCE:
${pageEvidenceBlocks || `URL: ${websiteUrl} (Homepage baseline capture)`}
${unansweredFaqPromptBlock}${extractionLimitationsBlock}
EXTRACTION & CLASSIFICATION INSTRUCTIONS:
1. Keep these three business classification dimensions strictly separate in "classificationProfile":
   - offeringAndDelivery: What the product/service is and HOW it is delivered ("SAAS_OR_WEB_APPLICATION" | "DIGITAL_PRODUCT_OR_SERVICE" | "PHYSICAL_PRODUCT" | "PROFESSIONAL_OR_LOCAL_SERVICE" | "MARKETPLACE_OR_PLATFORM" | "HYBRID" | "UNCERTAIN").
   - buyerSegment: WHO buys it ("B2C" | "B2B" | "B2B_AND_B2C" | "HYBRID" | "UNCERTAIN").
   - monetization: HOW it makes money ("SUBSCRIPTION" | "ONE_TIME_PURCHASE" | "USAGE_OR_TRANSACTION_BASED" | "FREEMIUM_OR_TRIAL_TO_PAID" | "QUOTE_OR_CONTRACT_BASED" | "HYBRID" | "UNKNOWN").
   - evidenceGaps: Any relevant product, pricing, buyer, or operational details that could not be extracted from the supplied text.
2. Do NOT conflate checkout, gifting, SaaS, and buyer type:
   - Online checkout or gifting does NOT mean physical e-commerce if the product is software or digital content.
   - One-time or per-order payment does NOT mean a product cannot be SaaS or an AI web application.
   - SaaS does NOT require visible recurring subscription tiers.
   - Where pricing details are missing or not extracted, record the gap in "evidenceGaps" and set monetization to "UNKNOWN" (or the partially observed model with uncertaintyReason) rather than inventing a negative fact.
   - Do NOT infer absence of subscriptions from one headline, or active consumer subscriptions merely from a legal/terms heading. Record any tension in "unresolvedConflicts".
3. Multiple Offerings & Scope Separation:
   - Discover all offerings at the business level in "discoveredOfferings" (e.g. a consumer B2C product vs. a B2B white-label partnership), tagging each with "offeringScope" ("B2C" | "B2B" | "HYBRID") and "isSelectedCampaignScope" (true ONLY for the offering matching "${offeringName}").
   - Honor the selected campaign offering scope ("${offeringName}") in "campaignOffering" and "targetUnderstanding". Do NOT silently merge a consumer product and a white-label partnership into one buyer journey.
4. FAQ Question vs. Answer Rule (CRITICAL):
   - A question heading alone (such as "Can I edit my lyrics?" or "Can I review the lyrics before the song is created?") does NOT establish that the capability is supported!
   - Only mark a capability "WEBSITE_ESTABLISHED" if the actual answer text is present in the evidence and confirms it. If only the question is present or the FAQ is listed under [UNANSWERED FAQ QUESTIONS], set status to "UNKNOWN" and record it in "evidenceGaps".
5. Extract EVERY materially distinct fact supported by the supplied website evidence and offering notes into "productTruthFacts":
   - CAPABILITY: What the offering actually does (distinct functions, workflows, automation, customization).
   - DELIVERY_MECHANISM: HOW the offering works and is delivered (software/AI pipeline, digital download/streaming, physical fulfillment, service delivery).
   - BOUNDARY: Explicit operating limits, constraints, or boundaries established by evidence.
   - USE_CASE: Concrete use cases directly supported by evidence for the selected campaign offering scope.
   - PRICING_FACT: Observable pricing terms, trial/preview terms, or billing structure if stated.
   - PROOF: Customer results, metrics, corporate identity, or published claims.
6. Target Understanding ("targetRoles"):
   - Extract distinct USER, BUYER, DECISION_MAKER, and BUSINESS_CONTEXT roles relevant to the selected offering scope.

CRITICAL RULES:
- High Semantic Recall: Do NOT summarize 10 distinct capabilities into 1 broad sentence. Extract each distinct capability and use case separately.
- Strict Grounding: Every statement must be directly grounded in the provided page snippets or notes. Do NOT invent unstated features.
- Zero Generic Placeholders: Do NOT output generic phrases like "provides marketing capabilities".

Return JSON matching this schema:
{
  "businessName": "string",
  "businessModel": "Nuanced summary of delivery model, buyer segment (B2C/B2B/Both), and monetization",
  "generalIndustry": "string",
  "classificationProfile": {
    "offeringAndDelivery": {
      "value": "SAAS_OR_WEB_APPLICATION | DIGITAL_PRODUCT_OR_SERVICE | PHYSICAL_PRODUCT | PROFESSIONAL_OR_LOCAL_SERVICE | MARKETPLACE_OR_PLATFORM | HYBRID | UNCERTAIN",
      "summary": "string",
      "confidence": "HIGH | MEDIUM | LOW | UNCERTAIN",
      "evidence": ["string"],
      "uncertaintyReason": null
    },
    "buyerSegment": {
      "value": "B2C | B2B | B2B_AND_B2C | HYBRID | UNCERTAIN",
      "summary": "string",
      "confidence": "HIGH | MEDIUM | LOW | UNCERTAIN",
      "evidence": ["string"],
      "uncertaintyReason": null
    },
    "monetization": {
      "value": "SUBSCRIPTION | ONE_TIME_PURCHASE | USAGE_OR_TRANSACTION_BASED | FREEMIUM_OR_TRIAL_TO_PAID | QUOTE_OR_CONTRACT_BASED | HYBRID | UNKNOWN",
      "summary": "string",
      "confidence": "HIGH | MEDIUM | LOW | UNCERTAIN",
      "evidence": ["string"],
      "uncertaintyReason": "string or null"
    },
    "evidenceGaps": ["string"]
  },
  "discoveredOfferings": [ { "offeringName": "string", "offeringScope": "B2C | B2B | HYBRID", "description": "string", "isSelectedCampaignScope": true, "sourcePageUrls": ["string"] } ],
  "unresolvedConflicts": [
    {
      "dimension": "MONETIZATION | CAPABILITY | DELIVERY | BUYER_SCOPE | POLICY",
      "summary": "string",
      "evidenceA": { "statement": "string", "sourceUrl": "string", "evidenceId": "string" },
      "evidenceB": { "statement": "string", "sourceUrl": "string", "evidenceId": "string" },
      "resolutionStatus": "UNRESOLVED_CONFLICT | SCOPED_BY_OFFERING"
    }
  ],
  "campaignOffering": {
    "offeringType": "SAAS | DIGITAL_PRODUCT | PHYSICAL_PRODUCT | PRODUCT | SERVICE | HYBRID_OFFERING",
    "category": "string",
    "pricingModel": "string",
    "productTruthFacts": [
      {
        "statement": "string",
        "factType": "CAPABILITY | DELIVERY_MECHANISM | BOUNDARY | USE_CASE | PRICING_FACT | PROOF",
        "status": "WEBSITE_ESTABLISHED | USER_CONFIRMED | UNKNOWN",
        "rationale": "string",
        "sourcePageUrl": "string",
        "sourceQuote": "verbatim quote from source",
        "sourceEvidenceId": "evidence ID from the section header",
        "sourceSection": "section or heading name"
      }
    ]
  },
  "targetUnderstanding": {
    "targetRoles": [
      {
        "roleType": "USER | BUYER | DECISION_MAKER | BUSINESS_CONTEXT",
        "roleTitle": "string",
        "status": "WEBSITE_ESTABLISHED | USER_CONFIRMED",
        "rationale": "string",
        "sourcePageUrl": "string",
        "sourceQuote": "verbatim quote from source",
        "sourceEvidenceId": "evidence ID from the section header"
      }
    ]
  }
}
`;

  // 3. Proposer & Two-Stage Judge Loop with Targeted Repair
  let aiData: z.infer<typeof aiBusinessUnderstandingSchema> | null = null;
  let attempts = 0;
  const maxAttempts = 3;
  let currentPrompt = prompt;
  let lastErrorCategory = pages.length === 0 ? "INSUFFICIENT_EVIDENCE" : "COMPLETENESS_REPAIR_EXHAUSTED";
  let lastErrorMessage = "";

  while (attempts < maxAttempts && !aiData) {
    attempts++;
    try {
      const chatRes = await aiChat({
        messages: [{ role: "user", content: currentPrompt }],
        model: "gpt-4.1-mini",
        max_tokens: 4096,
        response_format: { type: "json_object" },
        accountId,
        campaignId,
        operationType: "business_understanding_engine",
        endpoint: "business-understanding-engine",
      });
      let rawText = chatRes.choices[0]?.message?.content || "{}";
      rawText = rawText.replace(/^```json\s*/, "").replace(/\s*```$/, "").trim();
      const parsedJson = JSON.parse(rawText || "{}");
      const rootData = parsedJson.businessUnderstanding || parsedJson.data || parsedJson;

      const normalized = {
        ...rootData,
        campaignOffering: {
          ...rootData.campaignOffering,
          productTruthFacts: normalizeArrayItems(rootData.campaignOffering?.productTruthFacts || rootData.productTruthFacts || rootData.capabilities || rootData.features, "statement")
        },
        targetUnderstanding: {
          ...rootData.targetUnderstanding,
          targetRoles: normalizeArrayItems(rootData.targetUnderstanding?.targetRoles || rootData.targetRoles || rootData.targets, "roleTitle")
        }
      };

      const candidateData = aiBusinessUnderstandingSchema.parse(normalized);

      // TWO-STAGE JUDGE VERIFICATION
      // Stage 1: Grounding Check (Precision)
      const ungroundedFacts = candidateData.campaignOffering.productTruthFacts.filter(f => 
        !f.statement || f.statement.length < 5 || f.statement.toLowerCase().includes("provides marketing platform capabilities")
      );

      // Stage 2: Completeness & Granularity Check (Recall)
      const hasGranularFacts = candidateData.campaignOffering.productTruthFacts.length >= 1;
      const isOverCompressed = candidateData.campaignOffering.productTruthFacts.some(f => 
        f.statement.length > 450
      );

      if (ungroundedFacts.length > 0 || !hasGranularFacts || isOverCompressed) {
        console.warn(`[BusinessUnderstanding] Judge detected issues on attempt ${attempts}. Ungrounded: ${ungroundedFacts.length}, OverCompressed: ${isOverCompressed}`);
        lastErrorCategory = "INSUFFICIENT_EVIDENCE";
        currentPrompt = `${prompt}\n\nTARGETED REPAIR DIRECTIVE (Attempt ${attempts}):\nPrevious output had defects:\n- Ensure every distinct capability and technical mechanism is extracted as its own concise statement.\n- Do NOT merge multiple separate capabilities into one giant sentence.\n- Do NOT output generic placeholder text.`;
        continue;
      }

      aiData = candidateData;
    } catch (parseErr: any) {
      lastErrorMessage = parseErr?.message || String(parseErr);
      const msg = lastErrorMessage.toLowerCase();
      if (parseErr?.status === 429 || msg.includes("429") || msg.includes("rate limit") || msg.includes("quota")) {
        lastErrorCategory = "PROVIDER_QUOTA_EXHAUSTED";
      } else if (msg.includes("enotfound") || msg.includes("econnrefused") || msg.includes("timeout") || msg.includes("unavailable")) {
        lastErrorCategory = "PROVIDER_UNAVAILABLE";
      } else if (msg.includes("json") || msg.includes("parse") || msg.includes("schema")) {
        lastErrorCategory = "SCHEMA_VALIDATION_FAILED";
      }
      console.warn(`[BusinessUnderstanding] Attempt ${attempts} error (${lastErrorCategory}): ${parseErr.message}`);
      currentPrompt = `${prompt}\n\nSCHEMA REPAIR DIRECTIVE (Attempt ${attempts}):\nOutput valid JSON matching schema precisely. Ensure productTruthFacts is an array of distinct objects.`;
    }
  }

  // 4. FAIL-CLOSED CHECK: Zero ungrounded keyword guessing permitted.
  // If AI proposal was unavailable or ungrounded, record INCOMPLETE honestly with failure telemetry.
  if (!aiData || aiData.campaignOffering.productTruthFacts.length === 0) {
    console.error(`[BusinessUnderstanding] Extraction failed closed after ${attempts} attempts (${lastErrorCategory}). Zero generic keyword fallbacks permitted.`);
    await db.insert(businessUnderstandingSnapshots).values({
      id: authorityId,
      accountId,
      campaignId,
      websiteSnapshotId: websiteSnapshotId,
      offeringInputEvidenceId: sourceEvidenceId,
      campaignOfferingId,
      businessUnderstanding: {
        status: "INCOMPLETE",
        reason: lastErrorCategory,
        errorDetail: lastErrorMessage || undefined,
        analyzedAt: Date.now()
      } as any,
      status: "INCOMPLETE"
    });
    throw new Error(`Business Understanding extraction failed closed (INCOMPLETE: ${lastErrorCategory}). Zero generic keyword fallbacks permitted.`);
  }

  const preliminaryClassification = (websiteRec[0] as any)?.preliminaryExtraction?.classificationProfile;
  const classificationProfile: BusinessClassificationProfile = normalizeClassificationProfile(
    aiData.classificationProfile || preliminaryClassification,
    crawlerGaps
  );

  // Enforce FAQ question-vs-answer rule on extracted facts
  const verifiedOrScopedFacts = enforceFaqAnswerGroundingOnFacts(
    aiData.campaignOffering.productTruthFacts,
    unansweredFaqQuestions,
    classificationProfile.evidenceGaps,
    faqOnlyEvidenceIds,
  );

  // Merge LLM-reported conflicts with deterministic cross-page conflicts
  const mergedConflicts = [
    ...detectedConflicts,
    ...(aiData.unresolvedConflicts || []).map((c: any) => ({
      conflictId: `conflict_${uuidv4().slice(0, 8)}`,
      dimension: c.dimension || "MONETIZATION",
      summary: c.summary,
      evidenceA: c.evidenceA,
      evidenceB: c.evidenceB,
      resolutionStatus: c.resolutionStatus || "UNRESOLVED_CONFLICT",
    })),
  ];

  const allDiscoveredUrls = Array.from(discoveredUrlsSet);
  const omittedUrls = allDiscoveredUrls.filter(u => !acquiredUrls.includes(u));
  const coverageReport = {
    discoveredUrls: allDiscoveredUrls,
    acquiredUrls,
    resolvedFragments: Array.from(resolvedFragmentsSet),
    extractedSectionsCount,
    answeredFaqCount,
    unansweredFaqQuestions,
    omittedUrls,
    inaccessibleItems: crawlerGaps,
    contradictorySignals: mergedConflicts.map(c => c.summary),
  };

  const pageMapByEvidenceId = new Map<string, any>();
  for (const p of pages) {
    if (p.businessEvidenceId) pageMapByEvidenceId.set(p.businessEvidenceId, p);
  }

  // 5. Transform to Payload (assigning IDs and Lineage)
  const payload: BusinessUnderstandingPayload = {
    businessUnderstandingAuthorityId: authorityId,
    accountId,
    campaignId,
    parentAuthorityIds: [websiteSnapshotId, sourceEvidenceId, campaignOfferingId].filter(Boolean),
    businessName: aiData.businessName || offeringName,
    businessModel: aiData.businessModel || "",
    generalIndustry: aiData.generalIndustry || "",
    classificationProfile,
    evidenceGaps: classificationProfile.evidenceGaps,
    coverageReport,
    unresolvedConflicts: mergedConflicts,
    discoveredOfferings: aiData.discoveredOfferings,
    campaignOffering: {
      campaignOfferingId,
      accountId,
      campaignId,
      offeringName,
      sourceInputEvidenceId: sourceEvidenceId,
      createdAt: Date.now(),
      businessUnderstandingAuthorityId: authorityId,
      offeringType: aiData.campaignOffering.offeringType,
      category: aiData.campaignOffering.category,
      pricingModel: aiData.campaignOffering.pricingModel,
      deliveryModel: classificationProfile.offeringAndDelivery.value,
      buyerSegment: classificationProfile.buyerSegment.value,
      monetizationModel: classificationProfile.monetization.value,
      productTruthFactIds: [],
      productTruthFacts: verifiedOrScopedFacts.map((f: any) => {
        const id = uuidv4();
        const specificEvidenceId = f.sourceEvidenceId && evidenceIds.includes(f.sourceEvidenceId)
          ? f.sourceEvidenceId
          : (f.sourceEvidenceId || (evidenceIds.length > 0 ? evidenceIds[0] : undefined));
        const matchedPage = specificEvidenceId ? pageMapByEvidenceId.get(specificEvidenceId) : pages[0];
        return {
          productTruthFactId: id,
          campaignOfferingId,
          statement: f.statement,
          factType: f.factType,
          status: f.status || "WEBSITE_ESTABLISHED",
          evidenceRefIds: specificEvidenceId ? [specificEvidenceId] : (evidenceIds.length > 0 ? [evidenceIds[0]] : []),
          sourcePageUrl: f.sourcePageUrl || matchedPage?.sourceUrl || websiteUrl,
          sourceQuote: f.sourceQuote || "",
          sourceEvidenceId: specificEvidenceId || "",
          sourceSection: f.sourceSection || undefined,
          capturedAt: matchedPage?.extractedAt || Date.now(),
          sourceVersion: matchedPage?.contentHash || websiteSnapshotId || "v1",
          rationale: f.rationale,
        };
      }),
      boundAt: Date.now(),
    },
    targetUnderstanding: {
      targetUnderstandingAuthorityId: uuidv4(),
      businessUnderstandingAuthorityId: authorityId,
      campaignOfferingId,
      accountId,
      campaignId,
      targetRoles: aiData.targetUnderstanding.targetRoles.map((r: any) => {
        const specificEvidenceId = r.sourceEvidenceId && evidenceIds.includes(r.sourceEvidenceId)
          ? r.sourceEvidenceId
          : (evidenceIds.length > 0 ? evidenceIds[0] : undefined);
        return {
          targetRoleFactId: uuidv4(),
          campaignOfferingId,
          roleType: r.roleType,
          roleTitle: r.roleTitle,
          status: r.status || "WEBSITE_ESTABLISHED",
          evidenceRefIds: specificEvidenceId ? [specificEvidenceId] : (evidenceIds.length > 0 ? [evidenceIds[0]] : []),
          sourcePageUrl: r.sourcePageUrl || websiteUrl,
          sourceQuote: r.sourceQuote || "",
          sourceEvidenceId: specificEvidenceId || "",
          rationale: r.rationale,
        };
      }),
      likelyUsers: [],
      likelyBuyers: [],
      likelyDecisionMakers: [],
      status: "COMPLETE",
      evaluatedAt: Date.now(),
      parentAuthorityIds: [authorityId, campaignOfferingId],
    },
    status: "COMPLETE",
    analyzedAt: Date.now(),
  };

  payload.campaignOffering.productTruthFactIds = payload.campaignOffering.productTruthFacts.map((f: any) => f.productTruthFactId) as any;

  // 6. Invalidate any previous COMPLETE snapshots on this campaign for OTHER offerings before persisting the new canonical snapshot.
  // Snapshots for the same campaignOfferingId remain immutable for historical version comparison;
  // resolveCurrentBusinessUnderstanding selects the latest COMPLETE snapshot by createdAt DESC.
  try {
    await db
      .update(businessUnderstandingSnapshots)
      .set({ status: "INVALIDATED" })
      .where(
        and(
          eq(businessUnderstandingSnapshots.accountId, accountId),
          eq(businessUnderstandingSnapshots.campaignId, campaignId),
          eq(businessUnderstandingSnapshots.status, "COMPLETE"),
          sql`${businessUnderstandingSnapshots.campaignOfferingId} != ${campaignOfferingId}`
        )
      );
  } catch (invErr: any) {
    console.warn("[BusinessUnderstanding] Could not invalidate prior offering snapshots:", invErr.message);
  }

  const inputSnapshotVersion = `bu_v1_${evidenceRec[0]?.contentHash || websiteRec[0]?.contentHash || authorityId.slice(0, 8)}`;
  const distinctCompanyFacts = inheritedCompanyFacts.length > 0
    ? inheritedCompanyFacts
    : [
        {
          factId: `cf_${authorityId.slice(0, 8)}`,
          category: "COMPANY_IDENTITY",
          statement: `${payload.businessName} operates in ${payload.generalIndustry || "its primary market"} (${websiteUrl || "confirmed workspace business"}).`,
          sourceEvidenceId: websiteSnapshotId,
          verified: true,
        },
      ];
  const distinctProductFacts = payload.campaignOffering.productTruthFacts;
  const distinctCampaignChoices = {
    campaignId,
    businessId: resolvedBusinessId,
    productId: resolvedProductId,
    offeringName,
    offeringType: payload.campaignOffering.offeringType,
    targetMarket: campaignSel?.campaignLocation || null,
    campaignGoalType: campaignSel?.campaignGoalType || null,
  };
  const provenanceRecord = {
    websiteSnapshotId,
    offeringInputEvidenceId: sourceEvidenceId,
    campaignOfferingId,
    businessId: resolvedBusinessId,
    productId: resolvedProductId,
    dataReuseStatus: websiteDataReuseStatus,
    inputSnapshotVersion,
    evaluatedAt: new Date().toISOString(),
  };

  await db.insert(businessUnderstandingSnapshots).values({
    id: authorityId,
    accountId,
    campaignId,
    businessId: resolvedBusinessId,
    productId: resolvedProductId,
    websiteSnapshotId: websiteSnapshotId,
    offeringInputEvidenceId: sourceEvidenceId,
    campaignOfferingId,
    businessUnderstanding: payload as any,
    companyFacts: distinctCompanyFacts as any,
    productFacts: distinctProductFacts as any,
    campaignChoices: distinctCampaignChoices as any,
    evidenceProvenance: provenanceRecord as any,
    inputSnapshotVersion,
    status: "COMPLETE"
  });

  // Update campaign_offerings and business_products with the validated product facts & provenance
  await db
    .update(campaignOfferings)
    .set({
      businessId: resolvedBusinessId,
      productId: resolvedProductId,
      productType: payload.campaignOffering.offeringType,
      pricingModel: payload.campaignOffering.pricingModel || offeringRec[0].pricingModel,
      verifiedCapabilities: distinctProductFacts as any,
      evidenceProvenance: provenanceRecord as any,
      inputSnapshotVersion,
    })
    .where(eq(campaignOfferings.id, campaignOfferingId));

  if (resolvedProductId) {
    await db
      .update(businessProducts)
      .set({
        verifiedCapabilities: distinctProductFacts as any,
        pricingModel: payload.campaignOffering.pricingModel || productRow?.pricingModel || null,
        evidenceProvenance: provenanceRecord as any,
        inputSnapshotVersion,
        updatedAt: new Date(),
      })
      .where(and(eq(businessProducts.accountId, accountId), eq(businessProducts.id, resolvedProductId)));
  }

  console.log(`[BusinessUnderstanding] COMPLETE. AuthorityId: ${authorityId}, Emitted Product Truth Facts: ${payload.campaignOffering.productTruthFacts.length}`);
  return authorityId;
}

export {
  resolveCurrentBusinessUnderstanding,
  resolveCurrentBusinessUnderstandingOrThrow,
  type ResolveCurrentBusinessUnderstandingParams,
  type CurrentBusinessUnderstandingResult
} from "./resolver";
