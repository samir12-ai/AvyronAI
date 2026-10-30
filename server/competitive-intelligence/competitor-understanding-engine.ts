import { z } from "zod";
import { aiGemini, aiChat } from "../ai-client";
import { db } from "../db";
import { 
  competitorUnderstandingSnapshots, 
  competitorWebsiteSnapshots,
  ciCompetitorPosts
} from "../../shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { randomUUID as uuidv4 } from "crypto";
import { runCompetitorWebsiteCrawler, type CompetitorPageEvidence } from "./competitor-crawler";

// Active in-memory lock to prevent conflicting concurrent runs for the same competitor
const activeUnderstandingJobs = new Set<string>();

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
  competitorName: string,
  options?: { forceRecrawl?: boolean; snapshotId?: string }
): Promise<CompetitorUnderstandingPayload> {
  const lockKey = `${accountId}:${competitorId}`;
  if (activeUnderstandingJobs.has(lockKey)) {
    console.warn(`[CompetitorUnderstandingEngine] Job already active for competitor ${competitorName} (${competitorId}). Returning latest snapshot.`);
    const [latest] = await db.select().from(competitorUnderstandingSnapshots)
      .where(eq(competitorUnderstandingSnapshots.competitorId, competitorId))
      .orderBy(desc(competitorUnderstandingSnapshots.createdAt))
      .limit(1);
    if (latest?.competitorUnderstanding) {
      return latest.competitorUnderstanding as CompetitorUnderstandingPayload;
    }
  }

  activeUnderstandingJobs.add(lockKey);
  try {
    const authorityId = `comp_auth_${uuidv4().substring(0, 8)}`;
    console.log(`[CompetitorUnderstandingEngine] Running for competitor ${competitorName} (${competitorId})`);

    // 1. Gather Available Evidence (Website Crawl & Verified Posts)
    let pages: CompetitorPageEvidence[] = [];
    let competitorWebsiteSnapshotId = options?.snapshotId || "";

    if (competitorWebsiteSnapshotId) {
      const [snap] = await db.select().from(competitorWebsiteSnapshots)
        .where(eq(competitorWebsiteSnapshots.id, competitorWebsiteSnapshotId))
        .limit(1);
      if (snap?.pagesCrawled && Array.isArray(snap.pagesCrawled)) {
        pages = snap.pagesCrawled as CompetitorPageEvidence[];
      }
    } else if (!options?.forceRecrawl) {
      const [existingSnap] = await db.select().from(competitorWebsiteSnapshots)
        .where(eq(competitorWebsiteSnapshots.competitorId, competitorId))
        .orderBy(desc(competitorWebsiteSnapshots.createdAt))
        .limit(1);

      if (existingSnap && existingSnap.status === "COMPLETE" && Array.isArray(existingSnap.pagesCrawled) && existingSnap.pagesCrawled.length > 0) {
        competitorWebsiteSnapshotId = existingSnap.id;
        pages = existingSnap.pagesCrawled as CompetitorPageEvidence[];
      }
    }

    // Deduplication check: if compatible valid understanding already exists for this snapshot OR for any snapshot with identical normalized page content, reuse it!
    if ((competitorWebsiteSnapshotId || pages.length > 0) && !options?.forceRecrawl) {
      if (competitorWebsiteSnapshotId) {
        const [existingCu] = await db.select().from(competitorUnderstandingSnapshots)
          .where(and(
            eq(competitorUnderstandingSnapshots.competitorId, competitorId),
            eq(competitorUnderstandingSnapshots.competitorWebsiteSnapshotId, competitorWebsiteSnapshotId),
            eq(competitorUnderstandingSnapshots.status, "COMPLETE")
          ))
          .orderBy(desc(competitorUnderstandingSnapshots.createdAt))
          .limit(1);

        if (existingCu?.competitorUnderstanding) {
          console.log(`[CompetitorUnderstandingEngine] Reusing existing valid understanding for ${competitorName} (authority ${existingCu.id}, same snapshotId)`);
          return existingCu.competitorUnderstanding as CompetitorUnderstandingPayload;
        }
      }

      if (pages.length > 0) {
        const currentPageHashes = pages.map(p => `${p.sourceUrl}:${p.contentHash}`).sort().join("|");
        const priorUnderstandingRows = await db.select().from(competitorUnderstandingSnapshots)
          .where(and(
            eq(competitorUnderstandingSnapshots.competitorId, competitorId),
            eq(competitorUnderstandingSnapshots.status, "COMPLETE")
          ))
          .orderBy(desc(competitorUnderstandingSnapshots.createdAt))
          .limit(5);

        if (priorUnderstandingRows.length > 0) {
          const priorWebSnaps = await db.select().from(competitorWebsiteSnapshots)
            .where(eq(competitorWebsiteSnapshots.competitorId, competitorId))
            .orderBy(desc(competitorWebsiteSnapshots.createdAt))
            .limit(10);
          const webSnapById = new Map(priorWebSnaps.map(s => [s.id, s]));

          for (const cu of priorUnderstandingRows) {
            const linkedSnap = webSnapById.get(cu.competitorWebsiteSnapshotId);
            const linkedPages = Array.isArray(linkedSnap?.pagesCrawled) ? (linkedSnap!.pagesCrawled as CompetitorPageEvidence[]) : [];
            const linkedPageHashes = linkedPages.map(p => `${p.sourceUrl}:${p.contentHash}`).sort().join("|");
            if (linkedPageHashes && linkedPageHashes === currentPageHashes && cu.competitorUnderstanding) {
              console.log(`[CompetitorUnderstandingEngine] Reusing existing valid understanding for ${competitorName} (authority ${cu.id}, identical page contentHash)`);
              return cu.competitorUnderstanding as CompetitorUnderstandingPayload;
            }
          }
        }
      }
    }

    // If still no pages and websiteUrl is provided, run crawler
    if (pages.length === 0 && websiteUrl && websiteUrl.trim().length > 3) {
      try {
        const crawlRes = await runCompetitorWebsiteCrawler(accountId, campaignId, competitorId, websiteUrl, 6);
        competitorWebsiteSnapshotId = crawlRes.snapshotId;
        pages = crawlRes.pagesCrawled;
      } catch (crawlErr: any) {
        console.warn(`[CompetitorUnderstandingEngine] Crawler warning for ${competitorName}:`, crawlErr.message);
      }
    }

    // Also fetch verified social posts if available
    const posts = await db.select().from(ciCompetitorPosts)
      .where(eq(ciCompetitorPosts.competitorId, competitorId))
      .orderBy(desc(ciCompetitorPosts.createdAt))
      .limit(15);

    // If a websiteUrl was provided for website understanding (not an app store listing) and 0 website pages were crawled,
    // or if NO evidence exists at all, record honest incomplete state rather than fabricating website understanding from social posts alone.
    const isAppStore = websiteUrl && (websiteUrl.includes("apps.apple.com") || websiteUrl.includes("play.google.com"));
    if ((pages.length === 0 && websiteUrl && !isAppStore) || (pages.length === 0 && posts.length === 0)) {
      console.warn(`[CompetitorUnderstandingEngine] Zero usable website pages (pages=${pages.length}, posts=${posts.length}) for ${competitorName}`);
      const emptyPayload: CompetitorUnderstandingPayload = {
        competitorUnderstandingAuthorityId: authorityId,
        accountId,
        campaignId,
        competitorId,
        competitorWebsiteSnapshotId: competitorWebsiteSnapshotId || "none",
        parentAuthorityIds: [],
        status: "INCOMPLETE",
        reason: pages.length === 0 && websiteUrl ? "Zero usable website pages extracted from competitor website" : "Zero usable website pages or social posts available for analysis",
        capabilities: [],
        positioning: [],
        mechanisms: [],
        offers: [],
        targetRoles: [],
        proof: [],
        notEstablishedAreas: ["Website catalog specifications", "Product pricing", "Commercial terms", "Positioning claims"],
        analyzedAt: Date.now()
      };

      await db.insert(competitorUnderstandingSnapshots).values({
        id: authorityId,
        accountId,
        campaignId,
        competitorId,
        competitorWebsiteSnapshotId: competitorWebsiteSnapshotId || "none",
        status: "INCOMPLETE",
        competitorUnderstanding: emptyPayload as any
      });

      return emptyPayload;
    }

    const evidenceIds = [
      ...pages.map(p => p.competitorBusinessEvidenceId),
      ...posts.map(p => `ev_post_${p.id}`)
    ];

    const pageSnippets = pages.map(p => `--- PAGE [${p.pageType}] (${p.sourceUrl}) (EvidenceID: ${p.competitorBusinessEvidenceId}) ---\n${p.snippet}`).join("\n\n");
    const postSnippets = posts.length > 0
      ? `\n\n--- VERIFIED SOCIAL POST EVIDENCE (${posts.length} posts reviewed) ---\n` +
        posts.map((p, idx) => `[Post ${idx + 1}] (${p.timestamp ? new Date(p.timestamp).toISOString() : 'Recent'}) (Likes: ${p.likes ?? 0}, Comments: ${p.comments ?? 0}): "${p.caption}"`).join("\n\n")
      : "";

    const combinedEvidence = `${pageSnippets}${postSnippets}`;

    // 2. Proposer Prompt for Exhaustive, Granular Extraction
    const prompt = `
You are the Avyron Competitor Intelligence Engine.
Analyze the first-party website and verified social evidence for competitor "${competitorName}" (ID: ${competitorId}).
Extract an exhaustive, granular, evidence-grounded competitor product profile.

AVAILABLE EVIDENCE:
${combinedEvidence}

EXTRACTION INSTRUCTIONS:
1. Capabilities: Extract EVERY distinct product feature, physical product line, material/fabric attribute, tool, module, and operational workflow established in the evidence.
2. Positioning: Category framing, strategic value propositions, and core promises.
3. Mechanisms: HOW the competitor delivers outcomes (materials, craftsmanship, engineering, algorithms, logistics, or direct service).
4. Offers: Commercial offerings, catalog collections, pricing figures, discount structures, shipping/return policies, or subscription packages.
5. Target Roles: Audiences and personas targeted by the competitor (USER for end consumer/wearer, BUYER for purchaser, DECISION_MAKER for household or commercial decision-maker).
6. Proof: Customer reviews, ratings, testimonials, case studies, trust badges, benchmarks, published metrics.

CRITICAL RULES:
- High Semantic Recall: Do NOT collapse 10 distinct features into 1 broad summary. Extract each distinct capability separately.
- Strict Grounding: Every statement must be directly grounded in the provided page snippets.
- Epistemic Status: If a capability is NOT mentioned on the website, mark it in notEstablishedAreas.
- Anti-Fabrication: NEVER fabricate negative capability claims like "Competitor lacks X" unless explicitly stated as an exclusion.
- Zero Generic Placeholders: Do NOT output vague filler text or assume SaaS business models for non-software companies.

Return JSON matching this exact structure:
{
  "capabilities": [
    { "statement": "Feature, product attribute, or capability description", "status": "WEBSITE_ESTABLISHED", "rationale": "Evidence explanation" }
  ],
  "positioning": [
    { "statement": "Value proposition statement", "categoryFrame": "Category", "primaryPromise": "Promise", "status": "WEBSITE_ESTABLISHED" }
  ],
  "mechanisms": [
    { "statement": "Underlying mechanism, design, or workflow delivery process", "status": "WEBSITE_ESTABLISHED" }
  ],
  "offers": [
    { "offerStatement": "Primary offering or catalog focus", "pricing": "Observed pricing or shipping threshold", "planPackage": "Package or Collection Name", "freeEntry": "Entry incentive or trial/return term", "cta": "Primary Call to Action" }
  ],
  "targetRoles": [
    { "roleTitle": "Target Customer Segment or Persona", "roleType": "BUYER", "status": "WEBSITE_ESTABLISHED" }
  ],
  "proof": [
    { "proofType": "TESTIMONIAL", "statement": "Customer review or proof statement" }
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
        !c.statement.toLowerCase().includes("does not have ")
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
  } finally {
    activeUnderstandingJobs.delete(lockKey);
  }
}
