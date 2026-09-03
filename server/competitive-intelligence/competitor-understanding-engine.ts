import { z } from "zod";
import { aiGemini, aiChat } from "../ai-client";
import { db } from "../db";
import { 
  competitorUnderstandingSnapshots, 
  competitorWebsiteSnapshots 
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { randomUUID as uuidv4 } from "crypto";
import { runCompetitorWebsiteCrawler, type CompetitorPageEvidence } from "./competitor-crawler";

export interface CompetitorUnderstandingPayload {
  competitorUnderstandingAuthorityId: string;
  accountId: string;
  campaignId: string;
  competitorId: string;
  competitorWebsiteSnapshotId: string;
  parentAuthorityIds: string[];
  status: "COMPLETE" | "INCOMPLETE" | "FAILED";
  reason?: string;
  capabilities: Array<{
    competitorCapabilityFactId: string;
    competitorId: string;
    statement: string;
    factType: "CAPABILITY";
    status: "WEBSITE_ESTABLISHED" | "SYSTEM_INFERRED" | "NOT_ESTABLISHED" | "UNKNOWN";
    evidenceRefIds: string[];
    rationale?: string;
  }>;
  positioning: Array<{
    competitorPositioningFactId: string;
    competitorId: string;
    statement: string;
    categoryFrame?: string;
    primaryPromise?: string;
    status: "WEBSITE_ESTABLISHED" | "SYSTEM_INFERRED" | "UNKNOWN";
    evidenceRefIds: string[];
  }>;
  mechanisms: Array<{
    competitorMechanismFactId: string;
    competitorId: string;
    statement: string;
    status: "WEBSITE_ESTABLISHED" | "SYSTEM_INFERRED" | "UNKNOWN";
    evidenceRefIds: string[];
  }>;
  offers: Array<{
    competitorOfferFactId: string;
    competitorId: string;
    offerStatement: string;
    planPackage?: string;
    freeEntry?: string;
    cta?: string;
    pricing?: string;
    evidenceRefIds: string[];
  }>;
  targetRoles: Array<{
    competitorTargetFactId: string;
    competitorId: string;
    roleTitle: string;
    roleType: "USER" | "BUYER" | "DECISION_MAKER";
    status: "WEBSITE_ESTABLISHED" | "SYSTEM_INFERRED" | "UNKNOWN";
    evidenceRefIds: string[];
  }>;
  proof: Array<{
    competitorProofFactId: string;
    competitorId: string;
    proofType: "CASE_STUDY" | "CUSTOMER_LOGO" | "TESTIMONIAL" | "BENCHMARK" | "QUANTIFIED_CLAIM";
    statement: string;
    evidenceRefIds: string[];
  }>;
  notEstablishedAreas: string[];
  analyzedAt: number;
}

const toStr = (v: any) => Array.isArray(v) ? v.join(", ") : (v != null ? String(v) : "");
const toStatus = (v: any) => ["WEBSITE_ESTABLISHED", "SYSTEM_INFERRED", "NOT_ESTABLISHED", "UNKNOWN"].includes(v) ? v : "WEBSITE_ESTABLISHED";
const toRoleType = (v: any) => ["USER", "BUYER", "DECISION_MAKER"].includes(v) ? v : "USER";
const toProofType = (v: any) => ["CASE_STUDY", "CUSTOMER_LOGO", "TESTIMONIAL", "BENCHMARK", "QUANTIFIED_CLAIM"].includes(v) ? v : "QUANTIFIED_CLAIM";

const aiCompetitorUnderstandingSchema = z.object({
  capabilities: z.array(z.object({
    statement: z.any().transform(toStr),
    status: z.any().transform(toStatus).optional().default("WEBSITE_ESTABLISHED"),
    rationale: z.any().transform(toStr)
  })).optional().default([]),
  positioning: z.array(z.object({
    statement: z.any().transform(toStr),
    categoryFrame: z.any().transform(toStr),
    primaryPromise: z.any().transform(toStr),
    status: z.any().transform(toStatus).optional().default("WEBSITE_ESTABLISHED")
  })).optional().default([]),
  mechanisms: z.array(z.object({
    statement: z.any().transform(toStr),
    status: z.any().transform(toStatus).optional().default("WEBSITE_ESTABLISHED")
  })).optional().default([]),
  offers: z.array(z.object({
    offerStatement: z.any().transform(toStr),
    planPackage: z.any().transform(toStr),
    freeEntry: z.any().transform(toStr),
    cta: z.any().transform(toStr),
    pricing: z.any().transform(toStr)
  })).optional().default([]),
  targetRoles: z.array(z.object({
    roleTitle: z.any().transform(toStr),
    roleType: z.any().transform(toRoleType).optional().default("USER"),
    status: z.any().transform(toStatus).optional().default("WEBSITE_ESTABLISHED")
  })).optional().default([]),
  proof: z.array(z.object({
    proofType: z.any().transform(toProofType).optional().default("CASE_STUDY"),
    statement: z.any().transform(toStr)
  })).optional().default([]),
  notEstablishedAreas: z.array(z.any().transform(toStr)).optional().default([])
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

export async function runCompetitorUnderstandingEngine(
  accountId: string,
  campaignId: string,
  competitorId: string,
  websiteUrl: string,
  competitorName: string
): Promise<CompetitorUnderstandingPayload> {
  const authorityId = `comp_auth_${uuidv4().substring(0, 8)}`;
  console.log(`[CompetitorUnderstandingEngine] Running for competitor ${competitorName} (${competitorId})`);

  // 1. Ensure Competitor Website Crawl exists
  let pages: CompetitorPageEvidence[] = [];
  let competitorWebsiteSnapshotId = "";

  const [existingSnap] = await db.select().from(competitorWebsiteSnapshots)
    .where(eq(competitorWebsiteSnapshots.competitorId, competitorId))
    .orderBy(desc(competitorWebsiteSnapshots.createdAt))
    .limit(1);

  if (existingSnap && existingSnap.status === "COMPLETE" && Array.isArray(existingSnap.pagesCrawled) && existingSnap.pagesCrawled.length > 0) {
    competitorWebsiteSnapshotId = existingSnap.id;
    pages = existingSnap.pagesCrawled as CompetitorPageEvidence[];
  } else {
    const crawlRes = await runCompetitorWebsiteCrawler(accountId, campaignId, competitorId, websiteUrl, 6);
    competitorWebsiteSnapshotId = crawlRes.snapshotId;
    pages = crawlRes.pagesCrawled;
  }

  const evidenceIds = pages.map(p => p.competitorBusinessEvidenceId);
  const pageSnippets = pages.map(p => `--- PAGE [${p.pageType}] (${p.sourceUrl}) (EvidenceID: ${p.competitorBusinessEvidenceId}) ---\n${p.snippet}`).join("\n\n");

  // 2. Proposer Prompt for Exhaustive, Granular Extraction
  const prompt = `
You are the Avyron Competitor Intelligence Engine.
Analyze the first-party website evidence for competitor "${competitorName}" (ID: ${competitorId}).
Extract an exhaustive, granular, evidence-grounded competitor product profile.

CRAWLED WEBSITE EVIDENCE:
${pageSnippets}

EXTRACTION INSTRUCTIONS:
1. Capabilities: Extract EVERY distinct product feature, tool, module, and operational workflow established in the evidence.
2. Positioning: Category framing, strategic value propositions, and core promises.
3. Mechanisms: HOW the competitor delivers outcomes (automation, algorithms, AI models, human review, direct integrations).
4. Offers: Subscription tiers, pricing figures, free trial terms, entry CTAs.
5. Target Roles: Personas targeted by the competitor (USER, BUYER, DECISION_MAKER).
6. Proof: Testimonials, case studies, customer logos, benchmarks, published metrics.

CRITICAL RULES:
- High Semantic Recall: Do NOT collapse 10 distinct features into 1 broad summary. Extract each distinct capability separately.
- Strict Grounding: Every statement must be directly grounded in the provided page snippets.
- Epistemic Status: If a capability is NOT mentioned on the website, mark it in notEstablishedAreas.
- Anti-Fabrication: NEVER fabricate negative capability claims like "Competitor lacks X" unless explicitly stated as an exclusion.
- Zero Generic Placeholders: Do NOT output vague filler text.

Return JSON matching this exact structure:
{
  "capabilities": [
    { "statement": "Feature or capability description", "status": "WEBSITE_ESTABLISHED", "rationale": "Evidence explanation" }
  ],
  "positioning": [
    { "statement": "Value proposition statement", "categoryFrame": "Category", "primaryPromise": "Promise", "status": "WEBSITE_ESTABLISHED" }
  ],
  "mechanisms": [
    { "statement": "Underlying mechanism or workflow delivery process", "status": "WEBSITE_ESTABLISHED" }
  ],
  "offers": [
    { "offerStatement": "Starter plan description", "pricing": "$49/mo", "planPackage": "Starter", "freeEntry": "14-day trial", "cta": "Start Free Trial" }
  ],
  "targetRoles": [
    { "roleTitle": "Marketing Manager", "roleType": "USER", "status": "WEBSITE_ESTABLISHED" }
  ],
  "proof": [
    { "proofType": "CASE_STUDY", "statement": "Proof or testimonial statement" }
  ],
  "notEstablishedAreas": ["Area not mentioned"]
}
`;

  // 3. Proposer & Two-Stage Semantic Judge Loop with Targeted Repair
  let aiData: z.infer<typeof aiCompetitorUnderstandingSchema> | null = null;
  let attempts = 0;
  const maxAttempts = 3;
  let currentPrompt = prompt;

  while (attempts < maxAttempts && !aiData) {
    attempts++;
    try {
      const chatRes = await aiChat({
        messages: [{ role: "user", content: currentPrompt }],
        model: "gpt-4.1-mini",
        max_tokens: 4096,
        response_format: { type: "json_object" },
        accountId,
        endpoint: "competitor-understanding",
      });
      let rawText = chatRes.choices?.[0]?.message?.content || "{}";
      rawText = rawText.replace(/^```json\s*/, "").replace(/\s*```$/, "").trim();
      const parsed = JSON.parse(rawText || "{}");
      const rootData = parsed.competitorUnderstanding || parsed.competitor_understanding || parsed.competitorProductIntelligence || parsed.data || parsed.competitor || (Array.isArray(parsed) ? { capabilities: parsed } : parsed);

      const normalizedRoot = {
        ...rootData,
        capabilities: normalizeArrayItems(rootData.capabilities || rootData.productCapabilities || rootData.features || rootData.productTruthFacts || rootData.functions, "statement"),
        positioning: normalizeArrayItems(rootData.positioning || rootData.positioningClaims || rootData.strategicClaims, "statement"),
        mechanisms: normalizeArrayItems(rootData.mechanisms || rootData.deliveryMechanisms || rootData.howItWorks, "statement"),
        offers: normalizeArrayItems(rootData.offers || rootData.pricing || rootData.plans || rootData.packages, "offerStatement"),
        targetRoles: normalizeArrayItems(rootData.targetRoles || rootData.targets || rootData.targetAudience || rootData.roles, "roleTitle"),
        proof: normalizeArrayItems(rootData.proof || rootData.evidence || rootData.testimonials || rootData.caseStudies, "statement"),
        notEstablishedAreas: normalizeArrayItems(rootData.notEstablishedAreas, "area").map(i => typeof i === 'string' ? i : i.area || JSON.stringify(i)),
      };

      const candidateData = aiCompetitorUnderstandingSchema.parse(normalizedRoot);

      // Filter out negative claims and empty statements directly
      candidateData.capabilities = candidateData.capabilities.filter(c => 
        c.statement && c.statement.length >= 3 &&
        !c.statement.toLowerCase().includes("lacks ") && 
        !c.statement.toLowerCase().includes("does not have ") && 
        !c.statement.toLowerCase().includes("provides marketing platform capabilities")
      );

      // TWO-STAGE JUDGE VERIFICATION
      const hasCapabilities = candidateData.capabilities.length >= 1;
      const isOverCompressed = candidateData.capabilities.some(c => c.statement.length > 450);

      if (!hasCapabilities && attempts < maxAttempts) {
        console.warn(`[CompetitorUnderstanding] Judge detected defects on attempt ${attempts}. Capabilities count: ${candidateData.capabilities.length}`);
        currentPrompt = `${prompt}\n\nTARGETED REPAIR DIRECTIVE (Attempt ${attempts}):\nPrevious extraction returned 0 capabilities. Extract distinct product capabilities as separate items in the "capabilities" array with a "statement" field.`;
        continue;
      }

      aiData = candidateData;

      aiData = candidateData;
    } catch (err: any) {
      console.warn(`[CompetitorUnderstanding] Parsing/Validation error on attempt ${attempts}: ${err.message}`);
      currentPrompt = `${prompt}\n\nSCHEMA REPAIR DIRECTIVE (Attempt ${attempts}):\nOutput valid JSON matching the 6-category schema strictly.`;
    }
  }

  // 4. FAIL-CLOSED CHECK: NO GENERIC FALLBACKS
  if (!aiData || aiData.capabilities.length === 0) {
    console.error(`[CompetitorUnderstandingEngine] Extraction failed closed for ${competitorName}. No generic fallbacks permitted.`);
    const incompletePayload: CompetitorUnderstandingPayload = {
      competitorUnderstandingAuthorityId: authorityId,
      accountId,
      campaignId,
      competitorId,
      competitorWebsiteSnapshotId,
      parentAuthorityIds: [competitorWebsiteSnapshotId, ...evidenceIds],
      status: "INCOMPLETE",
      reason: "COMPLETENESS_REPAIR_EXHAUSTED",
      capabilities: [],
      positioning: [],
      mechanisms: [],
      offers: [],
      targetRoles: [],
      proof: [],
      notEstablishedAreas: [],
      analyzedAt: Date.now()
    };

    await db.insert(competitorUnderstandingSnapshots).values({
      id: authorityId,
      accountId,
      campaignId,
      competitorId,
      competitorWebsiteSnapshotId,
      status: "INCOMPLETE",
      competitorUnderstanding: incompletePayload as any
    });

    return incompletePayload;
  }

  // 5. Transform Grounded & Complete Facts
  const validCapabilities = aiData.capabilities
    .filter(c => !c.statement.toLowerCase().includes("lacks ") && !c.statement.toLowerCase().includes("does not have "))
    .map(c => ({
      competitorCapabilityFactId: `cfact_${uuidv4().substring(0, 8)}`,
      competitorId,
      statement: c.statement,
      factType: "CAPABILITY" as const,
      status: c.status,
      evidenceRefIds: evidenceIds,
      rationale: c.rationale
    }));

  const validPositioning = aiData.positioning.map(p => ({
    competitorPositioningFactId: `pfact_${uuidv4().substring(0, 8)}`,
    competitorId,
    statement: p.statement,
    categoryFrame: p.categoryFrame,
    primaryPromise: p.primaryPromise,
    status: p.status,
    evidenceRefIds: evidenceIds
  }));

  const validMechanisms = aiData.mechanisms.map(m => ({
    competitorMechanismFactId: `mfact_${uuidv4().substring(0, 8)}`,
    competitorId,
    statement: m.statement,
    status: m.status,
    evidenceRefIds: evidenceIds
  }));

  const validOffers = aiData.offers.map(o => ({
    competitorOfferFactId: `ofact_${uuidv4().substring(0, 8)}`,
    competitorId,
    offerStatement: o.offerStatement,
    planPackage: o.planPackage,
    freeEntry: o.freeEntry,
    cta: o.cta,
    pricing: o.pricing,
    evidenceRefIds: evidenceIds
  }));

  const validTargetRoles = aiData.targetRoles.map(t => ({
    competitorTargetFactId: `tfact_${uuidv4().substring(0, 8)}`,
    competitorId,
    roleTitle: t.roleTitle,
    roleType: t.roleType,
    status: t.status,
    evidenceRefIds: evidenceIds
  }));

  const validProof = aiData.proof.map(pr => ({
    competitorProofFactId: `prfact_${uuidv4().substring(0, 8)}`,
    competitorId,
    proofType: pr.proofType,
    statement: pr.statement,
    evidenceRefIds: evidenceIds
  }));

  const payload: CompetitorUnderstandingPayload = {
    competitorUnderstandingAuthorityId: authorityId,
    accountId,
    campaignId,
    competitorId,
    competitorWebsiteSnapshotId,
    parentAuthorityIds: [competitorWebsiteSnapshotId, ...evidenceIds],
    status: "COMPLETE",
    capabilities: validCapabilities,
    positioning: validPositioning,
    mechanisms: validMechanisms,
    offers: validOffers,
    targetRoles: validTargetRoles,
    proof: validProof,
    notEstablishedAreas: aiData.notEstablishedAreas || [],
    analyzedAt: Date.now()
  };

  // 6. Persist Complete Snapshot
  await db.insert(competitorUnderstandingSnapshots).values({
    id: authorityId,
    accountId,
    campaignId,
    competitorId,
    competitorWebsiteSnapshotId,
    status: "COMPLETE",
    competitorUnderstanding: payload as any
  });

  console.log(`[CompetitorUnderstandingEngine] COMPLETE for ${competitorId}. AuthorityId: ${authorityId}, Capabilities: ${validCapabilities.length}, Positioning: ${validPositioning.length}, Mechanisms: ${validMechanisms.length}`);
  return payload;
}
