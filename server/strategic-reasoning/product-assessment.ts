import { db } from "../db";
import { productAssessments } from "@shared/schema";
import { aiGemini, aiChat } from "../ai-client";
import crypto from "crypto";
import { computePainContentHash } from "../shared/audience-pain-registry";

export function computeProductTruthHash(facts: Array<{ productTruthFactId?: string; factId?: string; statement?: string; [key: string]: any }>): string {
  const normalized = facts.map(f => `${f.productTruthFactId || f.factId || (f as any).id || ""}:${f.statement || (f as any).rawValue || (f as any).verifiedCapability || ""}`).sort().join("|");
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export interface ProductAssessmentInput {
  painId: string;
  canonicalPain: string;
  campaignOfferingId: string;
  businessUnderstandingAuthorityId: string;
  productTruthFacts: Array<{
    productTruthFactId?: string;
    factId?: string;
    statement?: string;
    verifiedCapability?: string;
    boundaryLimitation?: string;
    [key: string]: any;
  }>;
  accountId: string;
  campaignId: string;
  jobId: string;
  painContentHash?: string;
  productTruthHash?: string;
  existingAssessment?: {
    productAssessmentAuthorityId: string;
    status: string;
    fitType: "DIRECT_FIT" | "STRATEGIC_FIT" | "NOT_FIT" | "UNKNOWN";
    jobId: string;
    accountId: string;
    campaignId: string;
    painId: string;
    campaignOfferingId: string;
    productTruthFactIds: string[];
    reason?: string;
    painContentHash?: string;
    productTruthHash?: string;
  };
}

export interface RequirementBreakdown {
  requirement: string;
  status: "SUPPORTED" | "UNKNOWN" | "CONTRADICTED" | "REQUIRES_DEVELOPMENT";
  evidenceFactIds?: string[];
  notes?: string;
}

export interface ProductAssessmentResult {
  productAssessmentAuthorityId: string;
  painId: string;
  campaignOfferingId: string;
  businessUnderstandingAuthorityId: string;
  productTruthFactIds: string[];
  fitType: "DIRECT_FIT" | "STRATEGIC_FIT" | "NOT_FIT" | "UNKNOWN";
  status: "COMPLETE" | "INCOMPLETE";
  parentAuthorityIds: string[];
  reason: string;
  jobId: string;
  painClaim?: string;
  painContentHash?: string;
  productTruthHash?: string;
  evidenceHash?: string;
  segmentId?: string;
  audienceSnapshotId?: string;
  requirementBreakdown?: RequirementBreakdown[];
  proposedPrerequisites?: string[];
  unprovenParts?: string[];
}

export function canReuseProductAssessment(
  existingAssessment: any,
  targetPain: {
    painId?: string;
    id?: string;
    statement?: string;
    canonicalPain?: string;
    canonical?: string;
    contentHash?: string;
    painContentHash?: string;
    evidenceHash?: string;
    evidenceUids?: string[];
    segmentId?: string;
    audienceSnapshotId?: string;
  },
  currentPtHash?: string,
  opts?: {
    jobId?: string;
    accountId?: string;
    campaignId?: string;
    campaignOfferingId?: string;
    audienceSnapshotId?: string;
    segmentId?: string;
    ruleVersion?: string;
  }
): boolean {
  if (!existingAssessment) return false;
  if (existingAssessment.status && existingAssessment.status !== "COMPLETE") return false;
  if (opts?.jobId && existingAssessment.jobId && existingAssessment.jobId !== opts.jobId) return false;
  if (opts?.accountId && existingAssessment.accountId && existingAssessment.accountId !== opts.accountId) return false;
  if (opts?.campaignId && existingAssessment.campaignId && existingAssessment.campaignId !== opts.campaignId) return false;
  if (opts?.campaignOfferingId && existingAssessment.campaignOfferingId && existingAssessment.campaignOfferingId !== opts.campaignOfferingId) return false;

  const targetSnapId = opts?.audienceSnapshotId || targetPain.audienceSnapshotId;
  if (targetSnapId && existingAssessment.audienceSnapshotId && existingAssessment.audienceSnapshotId !== targetSnapId) return false;
  if (opts?.audienceSnapshotId && targetPain.audienceSnapshotId && opts.audienceSnapshotId !== targetPain.audienceSnapshotId) return false;

  const targetSegId = opts?.segmentId || targetPain.segmentId;
  if (targetSegId && existingAssessment.segmentId && existingAssessment.segmentId !== targetSegId) return false;
  if (opts?.segmentId && targetPain.segmentId && opts.segmentId !== targetPain.segmentId) return false;

  const targetPid = targetPain.painId || targetPain.id;
  if (existingAssessment.painId && targetPid && existingAssessment.painId !== targetPid) return false;

  const targetHash = targetPain.contentHash || targetPain.painContentHash || computePainContentHash(targetPain.statement || targetPain.canonicalPain || targetPain.canonical || "");
  if (existingAssessment.painContentHash && existingAssessment.painContentHash !== targetHash) return false;

  const targetEvHash = targetPain.evidenceHash;
  if (targetEvHash && existingAssessment.evidenceHash && existingAssessment.evidenceHash !== targetEvHash) return false;

  if (currentPtHash && existingAssessment.productTruthHash && existingAssessment.productTruthHash !== currentPtHash) return false;

  if (opts?.ruleVersion && existingAssessment.ruleVersion && existingAssessment.ruleVersion !== opts.ruleVersion) return false;

  return true;
}

export async function runProductAssessmentForPain(
  input: ProductAssessmentInput
): Promise<ProductAssessmentResult> {
  const {
    painId,
    canonicalPain,
    campaignOfferingId,
    businessUnderstandingAuthorityId,
    productTruthFacts = [],
    accountId,
    campaignId,
    jobId,
    existingAssessment,
  } = input;

  const productAssessmentAuthorityId = `pa_${jobId}_${painId}`;
  const factIds = productTruthFacts
    .map((f) => f.productTruthFactId || f.factId || (f as any).id || "")
    .filter(Boolean);
  const painContentHash = input.painContentHash || computePainContentHash(canonicalPain);
  const currentPtHash = input.productTruthHash || computeProductTruthHash(productTruthFacts);

  // 1. Fail-closed validation
  if (!businessUnderstandingAuthorityId || !campaignOfferingId || !painId || !jobId || factIds.length === 0) {
    const incompleteRes: ProductAssessmentResult = {
      productAssessmentAuthorityId,
      painId,
      campaignOfferingId: campaignOfferingId || "UNKNOWN",
      businessUnderstandingAuthorityId: businessUnderstandingAuthorityId || "UNKNOWN",
      productTruthFactIds: factIds,
      fitType: "UNKNOWN",
      status: "INCOMPLETE",
      parentAuthorityIds: [],
      reason: "Missing required Business Understanding, Campaign Offering, or Product Truth Facts",
      jobId,
      painClaim: canonicalPain,
      painContentHash,
      productTruthHash: currentPtHash,
    };
    return incompleteRes;
  }

  // 2. Check if a valid same-job Product Assessment authority can be reused
  const canReuse = (
    existingAssessment &&
    existingAssessment.status === "COMPLETE" &&
    existingAssessment.jobId === jobId &&
    existingAssessment.accountId === accountId &&
    existingAssessment.campaignId === campaignId &&
    existingAssessment.painId === painId &&
    existingAssessment.campaignOfferingId === campaignOfferingId &&
    Array.isArray(existingAssessment.productTruthFactIds) &&
    existingAssessment.productTruthFactIds.length > 0 &&
    ["DIRECT_FIT", "STRATEGIC_FIT", "NOT_FIT", "UNKNOWN"].includes(existingAssessment.fitType) &&
    (!existingAssessment.painContentHash || existingAssessment.painContentHash === painContentHash) &&
    (!existingAssessment.productTruthHash || existingAssessment.productTruthHash === currentPtHash)
  );

  if (canReuse) {
    return {
      productAssessmentAuthorityId: existingAssessment.productAssessmentAuthorityId,
      painId,
      campaignOfferingId,
      businessUnderstandingAuthorityId,
      productTruthFactIds: existingAssessment.productTruthFactIds,
      fitType: existingAssessment.fitType,
      status: "COMPLETE",
      parentAuthorityIds: [businessUnderstandingAuthorityId, ...existingAssessment.productTruthFactIds, painId],
      reason: existingAssessment.reason || "Reused valid same-job Product Assessment authority",
      jobId,
      painClaim: canonicalPain,
      painContentHash,
      productTruthHash: currentPtHash,
    };
  }

  // 3. Execute semantic LLM evaluation against offering Product Truth Facts
  const prompt = `
You are the Product Assessment Engine. Evaluate whether the offering's verified Product Truth facts address the audience pain claim.

CAMPAIGN OFFERING ID: ${campaignOfferingId}
OFFERING PRODUCT TRUTH FACTS:
${JSON.stringify(productTruthFacts, null, 2)}

AUDIENCE PAIN CLAIM:
"${canonicalPain}"

EVALUATION CRITERIA:
- DIRECT_FIT: Verified capabilities directly perform OR directly enable the function required to solve/address this pain without unproven assumptions.
  * MULTI-REQUIREMENT / COMPOUND PAIN RULE: DIRECT_FIT requires verified capabilities to directly address ALL material requirements or clauses of the pain claim. If verified capabilities directly address only a subset or fragment of the pain's requirements, you must NOT return DIRECT_FIT.
- STRATEGIC_FIT: The capability partially, indirectly, or conditionally supports strategic reasoning/decisions related to the pain, or directly addresses only a subset of a multi-clause pain, but does not directly perform or directly enable the full required operational function.
- NOT_FIT: The offering does not legitimately address the pain, or the pain is explicitly out of scope / contradicts capability boundaries.
- UNKNOWN: Insufficient verified Product Truth authority to determine fit.

STRICT GROUNDING & EPISTEMIC BOUNDARY RULES:
1. ABSENCE OF CONTRADICTION IS NOT PROOF: The absence of contradictory evidence in product truth must NEVER be treated as positive support. If a capability or guarantee is not explicitly documented in verified facts, it does NOT exist.
2. MARKETING SLOGANS ARE NOT TECHNICAL PROOF: Generic marketing slogans or promotional descriptors (e.g. "premium fabrics", "high quality", "curated collection") do NOT establish natural fiber composition, breathability, opacity, durability, or specific physical/technical performance.
3. AMBIGUOUS TIMELINES ARE NOT GUARANTEES: Vague phrases such as "24 Hours For an Exchange Product" do NOT constitute a guaranteed exchange turnaround SLA without explicit terms stating an exact service guarantee.
4. COMPOUND PAIN DECOMPOSITION: If a pain claim has multiple clauses (e.g. fabric comfort AND exchange speed), evaluate every clause. If any material clause is unproven, return STRATEGIC_FIT with an explicit partial breakdown. A compound need CANNOT receive DIRECT_FIT unless ALL material clauses are directly supported.
5. PACKAGING VS TRANSIT CRUSHING: Food-grade, decorative, or protective packaging proves material quality, but does NOT establish crush-proof courier transit or impact survival. If the pain involves courier transit damage, packaging alone without explicit transit testing or certified drop protection must return STRATEGIC_FIT (partial risk reduction), never DIRECT_FIT, with courier transit protection preserved as an unresolved requirement.
6. PRODUCTION SPEED VS TRANSIT CONDITION / WAREHOUSE STORAGE: Daily production or dispatch speed does not guarantee condition on arrival, and does not establish that competitors use warehouse storage without explicit competitor evidence.
7. CLIENT CLAIMS VS COMPETITOR COMPLAINTS: Do not use client claims to refute customer complaints about competitors. Customer complaints about other market alternatives remain valid customer needs.
8. POST-PURCHASE EXPERIENCE & PRE-PURCHASE HESITATION: Do NOT automatically classify a pain as NOT_FIT solely because the reported customer experience happened during or after fulfillment (e.g., vocal pronunciation accuracy, digital delivery verification). Assess whether the experience informs pre-purchase buyer hesitation, switching, or retention, and whether a verified product capability (such as a free trial preview before paying upon gifting or downloadable digital files) partially mitigates that risk before payment (which qualifies as STRATEGIC_FIT). Conversely, if the pain requires operational customer service SLAs, phone support, or refund policies that are completely absent from Verified Product Truth, return NOT_FIT with a contextual explanation.

REASONING & SEMANTIC FRAMING RULES:
- When describing positive fit (DIRECT_FIT or STRATEGIC_FIT), explain how verified capabilities directly address, mitigate, or solve the customer problem.
- Do NOT use phrasing such as "the product/facts contradict the pain claim" to explain positive fit. Product capabilities address or solve a customer problem; they do NOT disprove or invalidate the empirical existence of the market pain.
- Preferred semantic framing: "directly addresses", "directly mitigates", "directly solves".

Output JSON format:
{
  "fitType": "DIRECT_FIT" | "STRATEGIC_FIT" | "NOT_FIT" | "UNKNOWN",
  "reason": "Concise causal justification based directly on the cited facts",
  "requirementBreakdown": [
    {
      "requirement": "Description of specific requirement/clause",
      "status": "SUPPORTED" | "UNKNOWN" | "CONTRADICTED" | "REQUIRES_DEVELOPMENT",
      "evidenceFactIds": ["FACT-1"],
      "notes": "Explanation"
    }
  ],
  "proposedPrerequisites": ["Explicit prerequisite needed if proposing strategic capability"],
  "unprovenParts": ["Any parts of the pain claim that remain unproven by product truth"]
}
`;

  let fitType: "DIRECT_FIT" | "STRATEGIC_FIT" | "NOT_FIT" | "UNKNOWN" = "UNKNOWN";
  let reason = "Evaluation failed";
  let requirementBreakdown: RequirementBreakdown[] | undefined;
  let proposedPrerequisites: string[] | undefined;
  let unprovenParts: string[] | undefined;

  try {
    const chatRes = await aiChat({
      messages: [{ role: "user", content: prompt }],
      model: "gpt-4.1-mini",
      max_tokens: 1024,
      response_format: { type: "json_object" },
      accountId: accountId || "system",
      endpoint: "product-assessment-engine",
    });
    const parsed = JSON.parse(chatRes.choices[0]?.message?.content || "{}");
    if (["DIRECT_FIT", "STRATEGIC_FIT", "NOT_FIT", "UNKNOWN"].includes(parsed.fitType)) {
      fitType = parsed.fitType;
      let cleanReason = parsed.reason || "Evaluated by Product Assessment Engine";
      if (fitType === "DIRECT_FIT" || fitType === "STRATEGIC_FIT") {
        cleanReason = cleanReason
          .replace(/directly contradicts the pain claim/gi, "directly addresses and mitigates the customer pain claim")
          .replace(/contradicts the pain claim/gi, "addresses and mitigates the customer pain claim")
          .replace(/contradicts the claimed issue/gi, "mitigates and resolves the claimed issue")
          .replace(/contradicts the pain/gi, "addresses and mitigates the pain");
      }
      reason = cleanReason;

      if (Array.isArray(parsed.requirementBreakdown)) {
        requirementBreakdown = parsed.requirementBreakdown
          .filter((item: any) => item && typeof item.requirement === "string")
          .map((item: any) => ({
            requirement: String(item.requirement).trim(),
            status: ["SUPPORTED", "UNKNOWN", "CONTRADICTED", "REQUIRES_DEVELOPMENT"].includes(item.status)
              ? item.status
              : "UNKNOWN",
            evidenceFactIds: Array.isArray(item.evidenceFactIds) ? item.evidenceFactIds.map(String) : [],
            notes: item.notes ? String(item.notes) : undefined,
          }));
      }

      if (Array.isArray(parsed.proposedPrerequisites)) {
        proposedPrerequisites = parsed.proposedPrerequisites
          .filter((p: any) => typeof p === "string" && p.trim().length > 0)
          .map((p: any) => String(p).trim());
      }

      if (Array.isArray(parsed.unprovenParts)) {
        unprovenParts = parsed.unprovenParts
          .filter((u: any) => typeof u === "string" && u.trim().length > 0)
          .map((u: any) => String(u).trim());
      }

      // Deterministic Compound Need & Epistemic Boundary Enforcement
      if (fitType === "DIRECT_FIT") {
        const hasUnresolvedReq = requirementBreakdown?.some(r => ["UNKNOWN", "CONTRADICTED", "REQUIRES_DEVELOPMENT"].includes(r.status));
        if (hasUnresolvedReq || (unprovenParts && unprovenParts.length > 0)) {
          fitType = "STRATEGIC_FIT";
          reason = `Compound pain has unresolved requirements (${unprovenParts?.join("; ") || "unverified clauses"}). Partial support addresses a subset of requirements only.`;
        } else {
          const painLower = canonicalPain.toLowerCase();
          const mentionsTransitCrushing = painLower.includes("crush") || ((painLower.includes("transit") || painLower.includes("courier")) && (painLower.includes("damage") || painLower.includes("crush") || painLower.includes("broken")));
          if (mentionsTransitCrushing) {
            const citedFacts = productTruthFacts.filter(f => factIds.includes(f.productTruthFactId || f.factId || ""));
            const factsText = citedFacts.map(f => (f.statement || "") + " " + (f.verifiedCapability || "")).join(" ").toLowerCase();
            const hasCrushProofTest = factsText.includes("crush-proof") || factsText.includes("drop test") || factsText.includes("transit certified");
            if (!hasCrushProofTest) {
              fitType = "STRATEGIC_FIT";
              if (!unprovenParts) unprovenParts = [];
              if (!unprovenParts.some(u => u.includes("crush") || u.includes("transit"))) {
                unprovenParts.push("Courier transit crush-proof protection under carrier handling");
              }
              if (requirementBreakdown) {
                const transitReq = requirementBreakdown.find(r => r.requirement.toLowerCase().includes("crush") || r.requirement.toLowerCase().includes("transit"));
                if (transitReq) {
                  transitReq.status = "REQUIRES_DEVELOPMENT";
                  transitReq.notes = "Protective packaging mitigates handling risk but lacks certified crush-proof transit verification.";
                } else {
                  requirementBreakdown.push({
                    requirement: "Crush-proof transit protection during courier delivery",
                    status: "REQUIRES_DEVELOPMENT",
                    notes: "Packaging material alone does not guarantee condition upon courier delivery.",
                  });
                }
              }
              reason = "Protective packaging reduces handling risk but does not guarantee crush-proof courier transit without certified testing.";
            }
          }
        }
      }
    }
  } catch (chatErr: any) {
    console.error(`[ProductAssessment] Evaluation failed: ${chatErr.message}`);
    return {
      productAssessmentAuthorityId,
      painId,
      campaignOfferingId,
      fitType: "UNKNOWN",
      status: "INCOMPLETE",
      parentAuthorityIds: [businessUnderstandingAuthorityId, painId],
      reason: `Product Assessment evaluation error: ${chatErr.message}`,
      jobId,
    };
  }

  const parentAuthorityIds = [businessUnderstandingAuthorityId, ...factIds, painId];

  const result: ProductAssessmentResult = {
    productAssessmentAuthorityId,
    painId,
    campaignOfferingId,
    businessUnderstandingAuthorityId,
    productTruthFactIds: factIds,
    fitType,
    status: "COMPLETE",
    parentAuthorityIds,
    reason,
    jobId,
    painClaim: canonicalPain,
    painContentHash,
    productTruthHash: currentPtHash,
    requirementBreakdown,
    proposedPrerequisites,
    unprovenParts,
  };

  try {
    await db.insert(productAssessments).values({
      id: productAssessmentAuthorityId,
      jobId,
      campaignId,
      accountId,
      painId,
      campaignOfferingId,
      businessUnderstandingAuthorityId,
      productTruthFactIds: factIds as any,
      fitType,
      status: "COMPLETE",
      parentAuthorityIds: parentAuthorityIds as any,
      payload: { ...result, painClaim: canonicalPain, painContentHash, productTruthHash: currentPtHash } as any,
    });
  } catch (dbErr: any) {
    console.warn(`[ProductAssessment] Failed to persist assessment ${productAssessmentAuthorityId}: ${dbErr.message}`);
  }

  return result;
}
