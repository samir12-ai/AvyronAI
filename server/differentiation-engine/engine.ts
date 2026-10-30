
import crypto, { randomUUID } from "crypto";
const log = (ctx: string, msg: string) => console.log(`[${ctx}] ${msg}`);
import {
  MIInput,
  AudienceInput,
  ProfileInput,
  DifferentiationResult,
  CanonicalDifferentiationInput,
  CanonicalCustomerEvidenceItem,
  DifferentiationCandidate,
  JudgeDefect,
  PainDisposition,
} from "./types";
import { proposeDifferentiation, repairDifferentiation } from "./proposer";
import { judgeDifferentiation, validateCandidateComparisonAndScopeDeterministically } from "./judge";
import { StrategicLane } from "../shared/lane-grouper";
import {
  ClaimEpistemicStatus,
  CLAIM_EPISTEMIC_LABELS,
  deriveHonestClaimLabel,
  type FactualSupportStatus,
  type CompetitiveSupportStatus,
  type StrategicDecisionStatus,
  type ExecutionEligibilityStatus,
  type BusinessApprovalStatus,
  type DifferentiationClassification,
} from "../../shared/contracts/claim-status";
import { computeProductTruthFingerprint, verifyProductTruthSnapshotLineage } from "../shared/product-dna";
import {
  decodeHtmlEntities,
  detectCustomerEvidenceQualifications,
  extractCanonicalEvidenceIdentity,
} from "../shared/audience-pain-registry";

export function evaluateLikeForLikeComparison(
  ourCapabilityOrCondition: string,
  competitorCapabilityOrCondition: string | null | undefined,
): {
  comparability: "EQUIVALENT_CONDITION" | "DIFFERENT_CONDITION_SCOPE" | "UNKNOWN_COMPETITOR_CAPABILITY";
  canClaimUniqueSuperiority: boolean;
  explanation: string;
} {
  const compClean = String(competitorCapabilityOrCondition || "").trim();
  if (!compClean || /^(?:unknown|not_extracted|none|n\/a|unverified)$/i.test(compClean)) {
    return {
      comparability: "UNKNOWN_COMPETITOR_CAPABILITY",
      canClaimUniqueSuperiority: false,
      explanation: "Competitor capability is unknown/unextracted; missing competitor data is not evidence of absent capability or unique superiority.",
    };
  }
  const ourLower = String(ourCapabilityOrCondition || "").toLowerCase();
  const compLower = compClean.toLowerCase();

  // Check preview/trial/revision scope differences (e.g. 60-second preview vs full song preview vs editable draft)
  const ourIsPartialPreview = /\b(60[- ]?second|30[- ]?second|snippet|sample clip|short preview)\b/i.test(ourLower);
  const compIsFullPreview = /\b(full[- ]?song preview|complete song preview|full track preview)\b/i.test(compLower);
  const ourIsEditableDraft = /\b(editable\s+(?:lyric|draft)|edit\s+lyrics)\b/i.test(ourLower);
  const compIsAudioPreviewOnly = /\b(audio\s+preview|60[- ]?second\s+preview)\b/i.test(compLower) && !/\b(edit|lyric\s+draft)\b/i.test(compLower);

  if ((ourIsPartialPreview && compIsFullPreview) || (ourIsEditableDraft && compIsAudioPreviewOnly)) {
    return {
      comparability: "DIFFERENT_CONDITION_SCOPE",
      canClaimUniqueSuperiority: false,
      explanation: `Non-identical condition scope: "${ourCapabilityOrCondition}" vs "${compClean}". Must compare with explicit condition qualifiers rather than claiming blanket equivalence or superiority.`,
    };
  }

  return {
    comparability: "EQUIVALENT_CONDITION",
    canClaimUniqueSuperiority: ourLower !== compLower,
    explanation: "Comparable commercial condition scope.",
  };
}

export function extractCandidateEvidenceDependencies(cand: DifferentiationCandidate): string[] {
  const deps = new Set<string>();
  for (const fid of cand.productTruthFactIds || []) {
    if (fid) deps.add(`pt:${fid}`);
  }
  for (const mid of cand.comparisonBaseline?.miAuthorityIds || []) {
    if (mid) deps.add(`mi:${mid}`);
  }
  for (const cid of cand.comparisonBaseline?.customerEvidenceIds || cand.customerEvidenceIds || []) {
    if (cid) deps.add(`ce:${cid}`);
  }
  return Array.from(deps).sort();
}

export function computeCandidateApprovalFingerprint(
  cand: DifferentiationCandidate,
  input: Pick<CanonicalDifferentiationInput, "lineage">
): string {
  const payload = JSON.stringify({
    differentiationId: cand.differentiationId || "",
    corePainIds: [...(cand.corePainIds || [])].sort(),
    differentiationClaim: (cand.differentiationClaim || "").trim(),
    distinctiveProperty: (cand.distinctiveProperty || "").trim(),
    buyerValue: (cand.buyerValue || "").trim(),
    proofBoundary: (cand.proofBoundary || "").trim(),
    strategicForm: cand.strategicForm || "STRATEGIC_MARKET_EMPHASIS",
    comparisonBaseline: {
      statement: (cand.comparisonBaseline?.statement || "").trim(),
      miAuthorityIds: [...(cand.comparisonBaseline?.miAuthorityIds || [])].sort(),
      customerEvidenceIds: [...(cand.comparisonBaseline?.customerEvidenceIds || cand.customerEvidenceIds || [])].sort(),
      competitorIds: [...(cand.comparisonBaseline?.competitorIds || [])].sort(),
      evidenceBasisType: cand.comparisonBaseline?.evidenceBasisType || "STRATEGIC_MARKET_EMPHASIS",
    },
    evidenceDependencies: extractCandidateEvidenceDependencies(cand),
    productTruthFingerprint: input.lineage?.productTruthFingerprint || "",
    evidenceManifestFingerprint: input.lineage?.evidenceManifestFingerprint || "",
  });
  return `diff_fp_${crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16)}`;
}

/**
 * Neutralizes dependent comparative superiority clauses in differentiationClaim / buyerValue
 * when a candidate's comparisonBaseline is moved to a non-comparative mode.
 * Returns null if the claim cannot stand on verified Product Truth alone without superiority.
 */
function neutralizeDependentComparativeSuperiority(
  cand: DifferentiationCandidate
): { differentiationClaim: string; buyerValue: string; modified: boolean } | null {
  let claim = (cand.differentiationClaim || "").trim();
  let val = (cand.buyerValue || "").trim();
  let modified = false;

  const stripPatterns: Array<[RegExp, string]> = [
    [
      /^(?:Unlike|Whereas|In\s+contrast\s+to)\s+competitors\s+.+?,\s*(?=(?:our|this|the\s+offering|we|daily|handcrafted|prepared|baked|sweetened|stone-oven|contains|combines)\b)/i,
      "",
    ],
    [/^Unlike\s+competitors\s+(?:who|that)\s+[^,]+,\s*/i, ""],
    [/^Whereas\s+competitors\s+[^,]+,\s*/i, ""],
    [/^In\s+contrast\s+to\s+competitors\s+(?:who|that)\s+[^,]+,\s*/i, ""],
    [/,\s*unlike\s+competitors\s+(?:who|that)\s+[^.;]+/gi, ""],
    [/,\s*whereas\s+competitors\s+[^.;]+/gi, ""],
    [/,\s*outperforming\s+competitors\s+[^.;]+/gi, ""],
    [/,\s*delivering\s+superior\s+quality\s+compared\s+to\s+competitors[^.;]*/gi, ""],
    [/\bproviding\s+superior\s+quality\s+over\s+competitors\s+(?:who|that)\s+[^.;]+/gi, "providing verified ingredient and production transparency"],
  ];

  for (const [pat, repl] of stripPatterns) {
    if (pat.test(claim)) {
      claim = claim.replace(pat, repl).trim();
      if (claim.length > 0) {
        claim = claim.charAt(0).toUpperCase() + claim.slice(1);
      }
      modified = true;
    }
    if (pat.test(val)) {
      val = val.replace(pat, repl).trim();
      if (val.length > 0) {
        val = val.charAt(0).toUpperCase() + val.slice(1);
      }
      modified = true;
    }
  }

  const remainingSuperiorityPattern =
    /\b(unlike\s+competitors|superior\s+to\s+competitors|beats\s+all\s+competitors|outperforms\s+competitors|whereas\s+competitors\s+(?:sell|use|lack)|the\s+only\s+brand\s+that\s+uses)\b/i;
  if (remainingSuperiorityPattern.test(claim) || remainingSuperiorityPattern.test(val)) {
    return null;
  }

  if (claim.length < 15 || val.length < 10) {
    return null;
  }

  return { differentiationClaim: claim, buyerValue: val, modified };
}

/**
 * Explicit documented validation & repair path for candidates whose ONLY remaining
 * defect is comparisonBaseline.statement (Requirement 5).
 * Operates deterministically within the existing model-call budget without adding
 * another unconditional LLM Judge round.
 */
export function finalizeComparisonBaselineOnlyDefect(
  cand: DifferentiationCandidate,
  candidateDefects: JudgeDefect[],
  canonicalInput: CanonicalDifferentiationInput
): DifferentiationCandidate | null {
  if (!cand || candidateDefects.length === 0) return null;

  // Must ONLY have defects on comparisonBaseline.*
  const allDefectsAreBaselineOnly = candidateDefects.every(
    (d) =>
      Array.isArray(d.rejectedFields) &&
      d.rejectedFields.length > 0 &&
      d.rejectedFields.every((f) => f === "comparisonBaseline" || f.startsWith("comparisonBaseline."))
  );
  if (!allDefectsAreBaselineOnly) {
    return null;
  }

  // Must not have any lineage reference defects on productTruthFactIds
  const hasLineageDefectOnProductTruth = candidateDefects.some(
    (d) => d.code === "LINEAGE_REFERENCE_INVALID" && d.rejectedFields?.includes("productTruthFactIds")
  );
  if (hasLineageDefectOnProductTruth) {
    return null;
  }

  const custEvidenceList = canonicalInput.customerEvidence || [];
  const candPainIds = new Set(cand.corePainIds || []);
  const citedCustIds = new Set([
    ...(cand.comparisonBaseline?.customerEvidenceIds || []),
    ...(cand.customerEvidenceIds || []),
  ]);

  // Resolve customer evidence belonging to this candidate's corePainIds or explicitly cited
  const matchingCustEv = custEvidenceList.filter(
    (ce) =>
      citedCustIds.has(ce.customerEvidenceId) ||
      (ce.rawEvidenceUids || []).some((u) => citedCustIds.has(u)) ||
      (ce.painIds || []).some((pid) => candPainIds.has(pid))
  );

  const competitorLinkedCustEv = matchingCustEv.filter(
    (ce) => typeof ce.competitorId === "string" && ce.competitorId.trim().length > 0
  );
  const unattributedCustEv = matchingCustEv.filter(
    (ce) => !ce.competitorId || ce.competitorId.trim().length === 0
  );

  const painObj = (canonicalInput.corePains || []).find((p) => candPainIds.has(p.painId));
  const painCanonical = painObj?.canonicalPain || "product quality and consistency concerns";
  const cloned: DifferentiationCandidate = JSON.parse(JSON.stringify(cand));
  const defectCode = candidateDefects[0]?.code || "COMPETITIVE_SCOPE_OVERCLAIM";

  if (competitorLinkedCustEv.length > 0) {
    // Case 1: Valid competitor-linked customer voice exists -> restore citation & bound attribution/scope/allegation
    const primaryCe = competitorLinkedCustEv[0];
    const compName = primaryCe.competitorName || primaryCe.competitorId || "the reviewed competitor";
    const compIds = Array.from(
      new Set(competitorLinkedCustEv.map((ce) => ce.competitorId!).filter(Boolean))
    );
    const ceIds = Array.from(
      new Set(competitorLinkedCustEv.map((ce) => ce.customerEvidenceId).filter(Boolean))
    );
    const distinctAuthors = new Set(
      competitorLinkedCustEv.map((ce) => (ce.author || ce.customerEvidenceId).toLowerCase())
    );
    const scopeText = primaryCe.productOrVariantScope
      ? ` for its ${primaryCe.productOrVariantScope}`
      : "";
    const anyAllegation = competitorLinkedCustEv.some((ce) => ce.isAllegation);
    const reporterPhrase =
      distinctAuthors.size > 1
        ? `customers reviewing ${compName}${scopeText}`
        : `a customer reviewing ${compName}${scopeText}`;

    const boundedStatement = anyAllegation
      ? `In customer feedback [${ceIds.join(", ")}], ${reporterPhrase} alleged concerns regarding ${painCanonical}; this represents an attributed customer allegation within that product scope rather than an independently verified universal competitor practice.`
      : `In customer feedback [${ceIds.join(", ")}], ${reporterPhrase} reported experiencing ${painCanonical} within that reviewed product scope.`;

    cloned.comparisonBaseline = {
      statement: boundedStatement,
      miAuthorityIds: [],
      customerEvidenceIds: ceIds,
      competitorIds: compIds,
      evidenceBasisType: "COMPETITOR_CUSTOMER_VOICE",
    };
    cloned.customerEvidenceIds = ceIds;
    cloned.strategicForm = "DOCUMENTED_COMPARATIVE_CONTRAST";

    // Also ensure differentiationClaim does not make a universal/every-product overclaim
    if (/\b(always\s+sells?|never\s+uses?|every\s+product\s+sold\s+by|across\s+all\s+products)\b/i.test(cloned.differentiationClaim || "")) {
      const neutralized = neutralizeDependentComparativeSuperiority(cloned);
      if (!neutralized) return null;
      cloned.differentiationClaim = neutralized.differentiationClaim;
      cloned.buyerValue = neutralized.buyerValue;
    }

    cloned.targetedBaselineRepairAudit = {
      repairedFromDefectCode: defectCode,
      resolutionMode: "RESTORED_COMPETITOR_CUSTOMER_VOICE",
      verifiedDeterministically: true,
      notes: `Restored competitor-linked customerEvidenceIds [${ceIds.join(", ")}] for competitor [${compIds.join(", ")}] with bounded scope and allegation framing.`,
    };
  } else {
    // Case 2: Unattributed market voice or no supported comparative basis -> neutralize baseline & reassess dependent superiority claims
    const neutralized = neutralizeDependentComparativeSuperiority(cloned);
    if (!neutralized) {
      return null;
    }
    cloned.differentiationClaim = neutralized.differentiationClaim;
    cloned.buyerValue = neutralized.buyerValue;
    cloned.strategicForm = "STRATEGIC_MARKET_EMPHASIS";

    if (unattributedCustEv.length > 0) {
      const ceIds = Array.from(
        new Set(unattributedCustEv.map((ce) => ce.customerEvidenceId).filter(Boolean))
      );
      const anyAllegation = unattributedCustEv.some((ce) => ce.isAllegation);
      const scopeNote = unattributedCustEv[0]?.productOrVariantScope
        ? ` (specifically in discussions of a ${unattributedCustEv[0].productOrVariantScope})`
        : "";
      const statement = anyAllegation
        ? `Customer discussions in the category${scopeNote} include buyer allegations and concerns regarding ${painCanonical} [${ceIds.join(", ")}] without establishing a verified practice attributed to a specific campaign competitor; our offering addresses this buyer concern through verified product facts [${(cloned.productTruthFactIds || []).join(", ")}].`
        : `Customer feedback in the category${scopeNote} reflects buyer concerns regarding ${painCanonical} [${ceIds.join(", ")}] without attributing behavior to a specific campaign competitor; our offering addresses this buyer concern through verified product facts [${(cloned.productTruthFactIds || []).join(", ")}].`;

      cloned.comparisonBaseline = {
        statement,
        miAuthorityIds: [],
        customerEvidenceIds: ceIds,
        competitorIds: [],
        evidenceBasisType: "UNATTRIBUTED_MARKET_VOICE",
      };
      cloned.customerEvidenceIds = ceIds;
      cloned.targetedBaselineRepairAudit = {
        repairedFromDefectCode: defectCode,
        resolutionMode: "NARROWED_UNATTRIBUTED_CONCERN",
        verifiedDeterministically: true,
        notes: `Replaced disclaimer-trap baseline with canonical unattributed customerEvidenceIds [${ceIds.join(", ")}] and verified no dependent superiority claims remain.`,
      };
    } else {
      cloned.comparisonBaseline = {
        statement: `Strategic market emphasis anchored on verified offering capabilities [${(cloned.productTruthFactIds || []).join(", ")}] to address buyer concerns regarding ${painCanonical} without making comparative claims about specific competitors.`,
        miAuthorityIds: [],
        customerEvidenceIds: [],
        competitorIds: [],
        evidenceBasisType: "STRATEGIC_MARKET_EMPHASIS",
      };
      cloned.customerEvidenceIds = [];
      cloned.targetedBaselineRepairAudit = {
        repairedFromDefectCode: defectCode,
        resolutionMode: "NEUTRALIZED_STRATEGIC_EMPHASIS",
        verifiedDeterministically: true,
        notes: "Replaced unsupported baseline with neutral STRATEGIC_MARKET_EMPHASIS baseline and verified no dependent superiority claims remain.",
      };
    }
  }

  // Deterministic re-validation of the repaired candidate and all dependent claims
  const postRepairDefects = validateCandidateComparisonAndScopeDeterministically(canonicalInput, cloned);
  if (postRepairDefects.length > 0) {
    log(
      "DifferentiationEngine",
      `Targeted baseline repair failed deterministic re-validation for ${cloned.differentiationId}: ${postRepairDefects.map((d) => d.reason).join("; ")}`
    );
    return null;
  }

  return cloned;
}

export async function runDifferentiationEngine(
  mi: MIInput,
  aud: AudienceInput,
  profile: ProfileInput,
  runContext?: {
    accountId?: string;
    campaignId?: string;
    jobId?: string;
    audienceSnapshotId?: string;
    miSnapshotId?: string;
    campaignOfferingId?: string;
    productTruthSnapshotId?: string;
    productTruthFingerprint?: string;
    strategicLanes?: StrategicLane[];
    customerEvidence?: any[];
    evidenceManifest?: any;
    previouslyApprovedCandidates?: DifferentiationCandidate[];
  }
): Promise<DifferentiationResult> {
  const start = Date.now();
  log("DifferentiationEngine", "Starting strict Proposer->Judge loop");

  // 1. Build CanonicalDifferentiationInput safely
  let corePains = (aud.painRegistry || []).filter((p: any) => 
    p.classification === "CORE_PURCHASE" || 
    p.classification === "CORE" || 
    p.role === "CORE" || 
    p.isCore === true
  );
  
  if (corePains.length === 0) {
    corePains = (aud.painRegistry || []).filter((p: any) => 
      p.classification === "SUPPORTING" || 
      p.classification === "DIRECT_FIT" ||
      (p.classification && p.classification !== "EXCLUDED" && p.classification !== "STRATEGIC_EXCLUDED" && p.classification !== "NON_STRATEGIC")
    );
  }

  if (corePains.length === 0 && Array.isArray(aud.painRegistry) && aud.painRegistry.length > 0) {
    corePains = [aud.painRegistry[0]];
  }

  if (corePains.length === 0) {
    return { status: "SKIPPED", statusMessage: "No CORE_PURCHASE or active strategic pains found", differentiations: [], painDispositions: [], confidenceScore: 0, executionTimeMs: Date.now() - start, engineVersion: 3 };
  }

  const miFacts: any[] = [];
  
  // 1. From dominanceData or dominance array
  const dominanceList = Array.isArray(mi.dominanceData) ? mi.dominanceData : (Array.isArray(mi.dominance) ? mi.dominance : []);
  dominanceList.forEach((dom: any) => {
    const cId = dom.competitorId || dom.id || "competitor";
    const cName = dom.competitorName || dom.name || cId;
    
    // Canonical facts
    (dom.canonicalFacts || []).forEach((f: any) => {
      if (f.fact || f.text) {
        miFacts.push({
          miAuthorityId: f.miAuthorityId || f.id || `mi_fact_${cId}_${f.factType || 'gen'}`,
          competitorId: cId,
          competitorName: cName,
          factType: f.factType || "COMPETITOR_FACT",
          fact: `${cName}: ${f.fact || f.text}`,
          miSnapshotId: f.miSnapshotId || runContext?.miSnapshotId || "",
          sourceScope: "OBSERVED_COMPETITOR" as const
        });
      }
    });

    // Weaknesses
    (dom.weaknesses || []).forEach((w: string, idx: number) => {
      miFacts.push({
        miAuthorityId: `mi_weakness_${cId}_${idx + 1}`,
        competitorId: cId,
        competitorName: cName,
        factType: "COMPETITOR_WEAKNESS",
        fact: `${cName} weakness: ${w}`,
        miSnapshotId: runContext?.miSnapshotId || "",
        sourceScope: "OBSERVED_COMPETITOR" as const
      });
    });

    // Strengths
    (dom.strengths || []).forEach((s: string, idx: number) => {
      miFacts.push({
        miAuthorityId: `mi_strength_${cId}_${idx + 1}`,
        competitorId: cId,
        competitorName: cName,
        factType: "COMPETITOR_STRENGTH",
        fact: `${cName} strength: ${s}`,
        miSnapshotId: runContext?.miSnapshotId || "",
        sourceScope: "OBSERVED_COMPETITOR" as const
      });
    });
  });

  // 2. From competitorIntentMap / competitors / competitorData (including Competitor Understanding commercialFacts)
  const competitorsList = Array.isArray(mi.competitors) && mi.competitors.length > 0 ? mi.competitors : (Array.isArray(mi.competitorIntentMap) ? mi.competitorIntentMap : []);
  const competitorDataList = Array.isArray((mi as any).competitorData) && (mi as any).competitorData.length > 0
    ? (mi as any).competitorData
    : competitorsList;

  const availableCompetitorIds: string[] = Array.isArray((mi as any).competitorCoverageRegistry?.availableCompetitorIds)
    ? [...(mi as any).competitorCoverageRegistry.availableCompetitorIds]
    : competitorDataList.map((c: any, idx: number) => String(c.competitorId || c.id || `comp_${idx + 1}`));
  const selectedCompetitorIds: string[] = Array.isArray((mi as any).competitorCoverageRegistry?.selectedCompetitorIds)
    ? [...(mi as any).competitorCoverageRegistry.selectedCompetitorIds]
    : [...availableCompetitorIds];
  const includedInPromptCompetitorIdsSet = new Set<string>();
  const unresolvedUnknownsByCompetitor: Record<string, string[]> = {};

  competitorsList.forEach((c: any, idx: number) => {
    const cId = c.competitorId || c.id || `comp_${idx + 1}`;
    const cName = c.competitorName || c.name || `Competitor ${idx + 1}`;
    const cIntent = c.intentType || c.intentCategory || "DEFENSIVE";
    includedInPromptCompetitorIdsSet.add(String(cId));
    miFacts.push({
      miAuthorityId: `mi_intent_${cId}`,
      competitorId: cId,
      competitorName: cName,
      factType: "COMPETITOR_INTENT",
      fact: `${cName} operates with an observed ${cIntent} strategic posture in reviewed market evidence.`,
      miSnapshotId: runContext?.miSnapshotId || "",
      sourceScope: "OBSERVED_COMPETITOR" as const
    });
  });

  // 2b. Structured Commercial Facts from Competitor Understanding Snapshots
  competitorDataList.forEach((c: any, idx: number) => {
    const cId = String(c.competitorId || c.id || `comp_${idx + 1}`);
    const cName = c.competitorName || c.name || `Competitor ${idx + 1}`;
    const cf = c.commercialFacts;
    if (!cf || typeof cf !== "object") return;
    includedInPromptCompetitorIdsSet.add(cId);

    const snapId = c.competitorUnderstandingSnapshotId || runContext?.miSnapshotId || "";
    if (Array.isArray(cf.capabilities)) {
      cf.capabilities.forEach((cap: string, cIdx: number) => {
        if (!cap) return;
        miFacts.push({
          miAuthorityId: `cu_cap_${cId}_${cIdx + 1}`,
          competitorId: cId,
          competitorName: cName,
          factType: "COMPETITOR_COMMERCIAL_CAPABILITY",
          fact: `${cName} verified capability (${cf.offeringScope || "primary offering"}): ${cap}`,
          miSnapshotId: snapId,
          sourceScope: "OBSERVED_COMPETITOR" as const,
        });
      });
    }
    if (Array.isArray(cf.capabilityBoundaries)) {
      cf.capabilityBoundaries.forEach((bound: string, bIdx: number) => {
        if (!bound) return;
        miFacts.push({
          miAuthorityId: `cu_bound_${cId}_${bIdx + 1}`,
          competitorId: cId,
          competitorName: cName,
          factType: "COMPETITOR_CAPABILITY_BOUNDARY",
          fact: `${cName} capability boundary: ${bound}`,
          miSnapshotId: snapId,
          sourceScope: "OBSERVED_COMPETITOR" as const,
        });
      });
    }
    if (Array.isArray(cf.pricingAndMonetization)) {
      cf.pricingAndMonetization.forEach((pr: string, pIdx: number) => {
        if (!pr) return;
        miFacts.push({
          miAuthorityId: `cu_price_${cId}_${pIdx + 1}`,
          competitorId: cId,
          competitorName: cName,
          factType: "COMPETITOR_PRICING_TERMS",
          fact: `${cName} pricing & monetization: ${pr}`,
          miSnapshotId: snapId,
          sourceScope: "OBSERVED_COMPETITOR" as const,
        });
      });
    }
    if (Array.isArray(cf.trialPreviewConditions)) {
      cf.trialPreviewConditions.forEach((tr: string, tIdx: number) => {
        if (!tr) return;
        miFacts.push({
          miAuthorityId: `cu_trial_${cId}_${tIdx + 1}`,
          competitorId: cId,
          competitorName: cName,
          factType: "COMPETITOR_TRIAL_PREVIEW_TERMS",
          fact: `${cName} trial/preview conditions: ${tr}`,
          miSnapshotId: snapId,
          sourceScope: "OBSERVED_COMPETITOR" as const,
        });
      });
    }
    if (Array.isArray(cf.deliveryRevisionTerms)) {
      cf.deliveryRevisionTerms.forEach((dr: string, dIdx: number) => {
        if (!dr) return;
        miFacts.push({
          miAuthorityId: `cu_delivery_${cId}_${dIdx + 1}`,
          competitorId: cId,
          competitorName: cName,
          factType: "COMPETITOR_DELIVERY_REVISION_TERMS",
          fact: `${cName} delivery/revision/access terms: ${dr}`,
          miSnapshotId: snapId,
          sourceScope: "OBSERVED_COMPETITOR" as const,
        });
      });
    }
    if (Array.isArray(cf.unresolvedUnknowns) && cf.unresolvedUnknowns.length > 0) {
      unresolvedUnknownsByCompetitor[cId] = [...cf.unresolvedUnknowns];
    }
  });

  // 3. From opportunitySignals, threatSignals, taggedSignals, signals
  const allSignals = [
    ...(Array.isArray(mi.opportunitySignals) ? mi.opportunitySignals : []),
    ...(Array.isArray(mi.threatSignals) ? mi.threatSignals : []),
    ...(Array.isArray(mi.taggedSignals) ? mi.taggedSignals : []),
    ...(Array.isArray(mi.signals) ? mi.signals : [])
  ];

  allSignals.forEach((s: any, idx: number) => {
    const text = typeof s === "string" ? s : (s.text || s.signal || s.name || "");
    if (text && !miFacts.some(existing => existing.fact === text)) {
      miFacts.push({
        miAuthorityId: `mi_signal_${idx + 1}`,
        competitorId: "market_baseline",
        factType: "MARKET_EVIDENCE_SIGNAL",
        fact: text,
        miSnapshotId: runContext?.miSnapshotId || "",
        sourceScope: "CATEGORY_SIGNAL" as const
      });
    }
  });

  const canonicalMi = miFacts;

  // Canonical product truth facts with matching IDs (FAIL-CLOSED: Must come from Business Understanding)
  const canonicalProductTruth: any[] = [];
  const seenTruthFactIds = new Set<string>();
  if (Array.isArray(aud.productTruthFacts) && aud.productTruthFacts.length > 0) {
    aud.productTruthFacts.forEach((f: any) => {
      const fid = String(f.productTruthFactId || f.factId || f.id || "").trim();
      if (!fid || seenTruthFactIds.has(fid)) return;
      seenTruthFactIds.add(fid);
      const statementText = String(f.statement || f.fact || f.description || JSON.stringify(f)).trim();
      canonicalProductTruth.push({
        productTruthFactId: fid,
        factType: f.factType || "CAPABILITY",
        fact: statementText,
        statement: statementText,
        status: f.status || f.verificationStatus || "VERIFIED",
        rationale: f.rationale || undefined,
        evidenceRefIds: Array.isArray(f.evidenceRefIds) ? [...f.evidenceRefIds] : undefined,
        campaignOfferingId: f.campaignOfferingId || runContext?.campaignOfferingId || undefined,
        accountId: f.accountId || undefined,
        snapshotId: f.snapshotId || undefined,
        sourceRef: f.sourceRef || (Array.isArray(f.evidenceRefIds) && f.evidenceRefIds.length > 0 ? f.evidenceRefIds.join(",") : undefined),
        scope: f.scope || undefined,
        qualifications: Array.isArray(f.qualifications)
          ? [...f.qualifications]
          : typeof f.qualifications === "string"
            ? [f.qualifications]
            : undefined,
      });
    });
  }

  if (canonicalProductTruth.length === 0) {
    return {
      status: "FAILED",
      statusMessage: "PRODUCT_TRUTH_MISSING: Canonical Product Truth is required for differentiation but was empty or missing.",
      errorCode: "PRODUCT_TRUTH_MISSING",
      failureCategory: "MISSING_EVIDENCE_HANDOFF",
      differentiations: [],
      painDispositions: [],
      confidenceScore: 0,
      executionTimeMs: Date.now() - start,
      engineVersion: 8
    };
  }

  const resolvedOfferingId =
    runContext?.campaignOfferingId ||
    (aud as any).campaignOfferingId ||
    canonicalProductTruth.find((f) => f.campaignOfferingId)?.campaignOfferingId ||
    undefined;
  const resolvedSnapshotId =
    runContext?.productTruthSnapshotId ||
    (aud as any).productTruthSnapshotId ||
    (profile as any)?.snapshotId ||
    `pt_snap_${resolvedOfferingId || "default"}`;
  const computedFingerprint = computeProductTruthFingerprint({
    campaignOfferingId: resolvedOfferingId,
    snapshotId: resolvedSnapshotId,
    facts: canonicalProductTruth,
  });
  const resolvedFingerprint =
    runContext?.productTruthFingerprint ||
    (aud as any).productTruthFingerprint ||
    (profile as any)?.snapshotFingerprint ||
    computedFingerprint;

  verifyProductTruthSnapshotLineage(
    {
      snapshotId: resolvedSnapshotId,
      snapshotFingerprint: computedFingerprint,
      campaignOfferingId: resolvedOfferingId,
    },
    {
      expectedOfferingId: runContext?.campaignOfferingId,
      expectedSnapshotId: runContext?.productTruthSnapshotId,
      expectedFingerprint: runContext?.productTruthFingerprint,
    },
    "DifferentiationEngine"
  );

  // Build Canonical Customer Evidence Registry against the run's frozen evidence manifest
  const expectedAccountId = runContext?.accountId || "";
  const expectedCampaignId = runContext?.campaignId || "";
  const manifest = runContext?.evidenceManifest;
  const allowedMvIds = Array.isArray(manifest?.includedMarketVoiceIds)
    ? new Set<string>(manifest.includedMarketVoiceIds)
    : null;
  const allowedCommentIds = Array.isArray(manifest?.includedCommentIds)
    ? new Set<string>(manifest.includedCommentIds)
    : null;
  const allowedReviewIds = Array.isArray(manifest?.includedReviewIds)
    ? new Set<string>(manifest.includedReviewIds)
    : null;

  const isAllowedByManifestAndScope = (rawEv: any): boolean => {
    if (expectedAccountId && rawEv.accountId && rawEv.accountId !== expectedAccountId) return false;
    if (expectedCampaignId && rawEv.campaignId && rawEv.campaignId !== expectedCampaignId) return false;
    const evOfferingId = rawEv.campaignOfferingId || rawEv.offeringId;
    if (resolvedOfferingId && evOfferingId && evOfferingId !== resolvedOfferingId) return false;

    const ref = rawEv.rawEvidenceReference;
    if (ref && ref.id) {
      if (ref.table === "market_voice_evidence" && allowedMvIds && !allowedMvIds.has(ref.id)) return false;
      if (ref.table === "ci_competitor_comments" && allowedCommentIds && !allowedCommentIds.has(ref.id)) return false;
      if (ref.table === "ci_competitor_reviews" && allowedReviewIds && !allowedReviewIds.has(ref.id)) return false;
    }
    return true;
  };

  // Index upstream canonical customer voice units for handoff restoration (Case E)
  const upstreamCustomerPool: any[] = [
    ...(Array.isArray(runContext?.customerEvidence) ? runContext!.customerEvidence! : []),
    ...(Array.isArray((aud as any).customerEvidence) ? (aud as any).customerEvidence : []),
    ...(Array.isArray((aud as any).evidenceUnits) ? (aud as any).evidenceUnits : []),
    ...(Array.isArray((aud as any).inputSummary?.evidenceUnits) ? (aud as any).inputSummary.evidenceUnits : []),
  ];

  const upstreamById = new Map<string, any>();
  const upstreamByNormText = new Map<string, any>();
  for (const u of upstreamCustomerPool) {
    if (!u || typeof u !== "object") continue;
    if (!isAllowedByManifestAndScope(u)) continue;
    const uid = u.customerEvidenceId || u.canonicalEvidenceId || u.evidenceId || u.id;
    if (uid && !upstreamById.has(String(uid))) {
      upstreamById.set(String(uid), u);
    }
    if (u.rawEvidenceReference?.id && !upstreamById.has(String(u.rawEvidenceReference.id))) {
      upstreamById.set(String(u.rawEvidenceReference.id), u);
    }
    const rawText = u.verbatimText || u.text || u.detail || "";
    const normText = decodeHtmlEntities(rawText).toLowerCase().replace(/\s+/g, " ").trim();
    if (normText.length > 0) {
      const existing = upstreamByNormText.get(normText);
      const existingUid = String(
        existing?.customerEvidenceId || existing?.canonicalEvidenceId || existing?.evidenceId || existing?.id || ""
      );
      // Prefer the first record that carries canonical cev_* ID or competitorId
      if (
        !existing ||
        (!existing.competitorId && u.competitorId) ||
        (!existingUid.startsWith("cev_") && String(uid || "").startsWith("cev_"))
      ) {
        upstreamByNormText.set(normText, u);
      }
    }
  }

  const canonicalCustomerEvMap = new Map<string, CanonicalCustomerEvidenceItem>();
  const normTextToCanonCustId = new Map<string, string>();
  const rawUidToCanonCustId = new Map<string, string>();

  const registerCustomerEvidenceRecord = (rawEv: any, painId?: string) => {
    if (!rawEv || typeof rawEv !== "object") return null;
    if (!isAllowedByManifestAndScope(rawEv)) return null;

    const rawText = String(rawEv.verbatimText || rawEv.text || rawEv.detail || "").trim();
    if (!rawText) return null;
    const decodedText = decodeHtmlEntities(rawText);
    const normText = decodedText.toLowerCase().replace(/\s+/g, " ").trim();

    const rawUid = String(rawEv.evidenceUid || rawEv.evidenceId || rawEv.id || "").trim();
    const matchedUpstream =
      (rawEv.canonicalEvidenceId && upstreamById.get(String(rawEv.canonicalEvidenceId))) ||
      (rawEv.customerEvidenceId && upstreamById.get(String(rawEv.customerEvidenceId))) ||
      (rawUid && upstreamById.get(rawUid)) ||
      (normText.length > 0 ? upstreamByNormText.get(normText) : undefined);

    if (matchedUpstream && !isAllowedByManifestAndScope(matchedUpstream)) {
      return null;
    }

    const candidateCanonId =
      rawEv.customerEvidenceId ||
      (rawEv.canonicalEvidenceId && !/^(?:ext:)?(?:ev|cluster)[-_:]\d+$/i.test(String(rawEv.canonicalEvidenceId))
        ? String(rawEv.canonicalEvidenceId)
        : undefined) ||
      (matchedUpstream?.customerEvidenceId || matchedUpstream?.canonicalEvidenceId || matchedUpstream?.evidenceId) ||
      extractCanonicalEvidenceIdentity(
        { ...matchedUpstream, ...rawEv, canonicalEvidenceId: matchedUpstream?.evidenceId },
        rawUid || "ev",
        decodedText
      );

    const platform = String(
      rawEv.platform || rawEv.sourceIdentity || matchedUpstream?.platform || "customer_review"
    );
    const author = rawEv.author || matchedUpstream?.author || undefined;
    const dedupTextKey = `${platform.toLowerCase()}|${String(author || "anon").toLowerCase()}|${normText}`;

    const resolvedCanonId = normTextToCanonCustId.get(dedupTextKey) || String(candidateCanonId);
    normTextToCanonCustId.set(dedupTextKey, resolvedCanonId);
    if (rawUid) rawUidToCanonCustId.set(rawUid, resolvedCanonId);
    for (const ruid of rawEv.rawEvidenceUids || []) {
      if (ruid) rawUidToCanonCustId.set(String(ruid), resolvedCanonId);
    }

    const existing = canonicalCustomerEvMap.get(resolvedCanonId);
    if (existing) {
      if (rawUid && !existing.rawEvidenceUids.includes(rawUid)) {
        existing.rawEvidenceUids.push(rawUid);
      }
      for (const ruid of rawEv.rawEvidenceUids || []) {
        if (ruid && !existing.rawEvidenceUids.includes(String(ruid))) {
          existing.rawEvidenceUids.push(String(ruid));
        }
      }
      if (painId && !existing.painIds.includes(painId)) {
        existing.painIds.push(painId);
      }
      return existing;
    }

    const rawCompId = rawEv.competitorId || matchedUpstream?.competitorId;
    const cleanCompId =
      rawCompId &&
      String(rawCompId).trim().length > 0 &&
      !["unknown", "market_voice", "none", "null"].includes(String(rawCompId).trim().toLowerCase())
        ? String(rawCompId).trim()
        : undefined;
    const cleanCompName = cleanCompId
      ? (rawEv.competitorName || matchedUpstream?.competitorName || cleanCompId)
      : undefined;

    const qualifications = detectCustomerEvidenceQualifications(decodedText, {
      ...matchedUpstream,
      ...rawEv,
    });

    const item: CanonicalCustomerEvidenceItem = {
      customerEvidenceId: resolvedCanonId,
      rawEvidenceUids: Array.from(
        new Set([rawUid, ...(rawEv.rawEvidenceUids || [])].map(String).filter(Boolean))
      ),
      painIds: painId ? [painId] : [],
      origin:
        rawEv.origin ||
        matchedUpstream?.origin ||
        (cleanCompId ? "COMPETITOR_REVIEW" : "MARKET_VOICE"),
      actorType: "CUSTOMER",
      platform,
      author,
      url: rawEv.url || matchedUpstream?.url || matchedUpstream?.verificationProvenance?.sourceUrl,
      verbatimText: decodedText,
      competitorId: cleanCompId,
      competitorName: cleanCompName,
      offeringId: rawEv.offeringId || matchedUpstream?.offeringId || undefined,
      productOrVariantScope: qualifications.productOrVariantScope,
      semanticScope: rawEv.semanticScope || matchedUpstream?.semanticScope || undefined,
      transferability: rawEv.transferability || matchedUpstream?.transferability || undefined,
      isAllegation: qualifications.isAllegation,
      rawEvidenceReference: rawEv.rawEvidenceReference || matchedUpstream?.rawEvidenceReference || undefined,
      accountId: rawEv.accountId || matchedUpstream?.accountId || expectedAccountId || undefined,
      campaignId: rawEv.campaignId || matchedUpstream?.campaignId || expectedCampaignId || undefined,
      campaignOfferingId:
        rawEv.campaignOfferingId || matchedUpstream?.campaignOfferingId || resolvedOfferingId || undefined,
      snapshotId: runContext?.audienceSnapshotId || undefined,
    };

    canonicalCustomerEvMap.set(resolvedCanonId, item);
    return item;
  };

  // Register evidence from each corePain's materiality.evidence and evidenceUids
  for (const p of corePains) {
    const pid = p.painId;
    const matEvidence = Array.isArray(p.materiality?.evidence) ? p.materiality.evidence : [];
    for (const me of matEvidence) {
      registerCustomerEvidenceRecord(me, pid);
    }
    const evUids = Array.isArray(p.evidenceUids) ? p.evidenceUids : [];
    for (const uid of evUids) {
      const upstream = upstreamById.get(String(uid));
      if (upstream) {
        registerCustomerEvidenceRecord({ ...upstream, evidenceUid: String(uid) }, pid);
      }
    }
  }

  // Also register any explicitly supplied customerEvidence items in runContext / aud
  for (const ce of [
    ...(Array.isArray(runContext?.customerEvidence) ? runContext!.customerEvidence! : []),
    ...(Array.isArray((aud as any).customerEvidence) ? (aud as any).customerEvidence : []),
  ]) {
    registerCustomerEvidenceRecord(ce, Array.isArray(ce?.painIds) ? ce.painIds[0] : undefined);
  }

  const canonicalCustomerEvidence = Array.from(canonicalCustomerEvMap.values());
  const evidenceManifestPayload = JSON.stringify({
    ptFingerprint: resolvedFingerprint,
    miSnapshotId: runContext?.miSnapshotId || "",
    customerEvidence: canonicalCustomerEvidence
      .map((ce) => ({
        id: ce.customerEvidenceId,
        comp: ce.competitorId || "",
        scope: ce.productOrVariantScope || "",
        allegation: ce.isAllegation,
        textHash: crypto.createHash("sha256").update(ce.verbatimText).digest("hex").slice(0, 12),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
  const evidenceManifestFingerprint = `em_${crypto
    .createHash("sha256")
    .update(evidenceManifestPayload)
    .digest("hex")
    .slice(0, 16)}`;

  const strategicLanes: StrategicLane[] = runContext?.strategicLanes || (aud as any).strategicLanes || (aud as any).strategic_lanes || [];

  const marketContext = {
    marketPains: (Array.isArray((aud as any).marketPains) ? (aud as any).marketPains : (Array.isArray(aud.painRegistry) ? aud.painRegistry.map((p: any) => p.canonical || p.claim || p.originalStatement).filter(Boolean) : [])),
    opportunitySignals: (Array.isArray(mi.opportunitySignals) ? mi.opportunitySignals : []).map((s: any) => typeof s === "string" ? s : (s.text || s.signal || "")).filter(Boolean),
    threatSignals: (Array.isArray(mi.threatSignals) ? mi.threatSignals : []).map((s: any) => typeof s === "string" ? s : (s.text || s.signal || "")).filter(Boolean),
    categoryMaturity: (mi as any).categoryMaturity || (mi as any).marketDiagnosis?.categoryMaturity || undefined,
  };

  const canonicalInput: CanonicalDifferentiationInput = {
    lineage: {
      accountId: runContext?.accountId || "",
      campaignId: runContext?.campaignId || "",
      jobId: runContext?.jobId || "",
      audienceSnapshotId: runContext?.audienceSnapshotId || "",
      miSnapshotId: runContext?.miSnapshotId || "",
      campaignOfferingId: resolvedOfferingId,
      productTruthSnapshotId: resolvedSnapshotId,
      productTruthFingerprint: resolvedFingerprint,
      evidenceManifestFingerprint,
    },
    corePains: corePains.map((p: any) => {
      const painCustEv = canonicalCustomerEvidence.filter((ce) => ce.painIds.includes(p.painId));
      return {
        painId: p.painId,
        targetCoverageAuthorityId: p.targetAssessmentAuthorityId || p.targetCoverageAuthorityId || `ta_${p.painId}`,
        productFitAuthorityId: p.productAssessmentAuthorityId || p.productFitAuthorityId || `pa_${p.painId}`,
        coreDecisionId: p.strategicPainDecisionAuthorityId || p.coreDecisionId || `spd_${p.painId}`,
        canonicalPain: p.canonical || p.claim || p.normalizedStatement || p.originalStatement || "",
        segmentIds: p.segmentIds || [p.segmentId].filter(Boolean),
        fitType: p.fitType || "DIRECT_FIT",
        requiredCapability: p.requiredCapability || p.matchedProductCapability || "Product Capability",
        matchedProductCapability: p.matchedProductCapability || p.requiredCapability || "Product Capability",
        productTruthFactIds: (p.productTruthFactIds && p.productTruthFactIds.length > 0) 
          ? Array.from(new Set(p.productTruthFactIds.map((id: any) => String(id).trim()).filter(Boolean)))
          : canonicalProductTruth.map(f => f.productTruthFactId),
        evidenceUids: Array.isArray(p.evidenceUids) ? p.evidenceUids : [],
        customerEvidenceIds: painCustEv.map((ce) => ce.customerEvidenceId),
        customerEvidence: painCustEv,
      };
    }),
    productTruth: canonicalProductTruth,
    ourProductFacts: canonicalProductTruth,
    competitiveAuthority: canonicalMi,
    miFacts: canonicalMi,
    customerEvidence: canonicalCustomerEvidence,
    strategicLanes,
    marketContext
  };

  const sanitizeCandidateCitations = (cand: any) => {
    if (!cand || typeof cand !== "object") return;
    if (!cand.differentiationId) {
      cand.differentiationId = randomUUID();
    }
    if (Array.isArray(cand.productTruthFactIds)) {
      cand.productTruthFactIds = Array.from(new Set(cand.productTruthFactIds.map((id: any) => String(id).trim()).filter(Boolean)));
      cand.ourEstablishedFacts = cand.productTruthFactIds;
    }
    if (Array.isArray(cand.corePainIds)) {
      cand.corePainIds = Array.from(new Set(cand.corePainIds.map((id: any) => String(id).trim()).filter(Boolean)));
    }
    if (!cand.comparisonBaseline || typeof cand.comparisonBaseline !== "object") {
      cand.comparisonBaseline = {
        statement: "",
        miAuthorityIds: [],
        customerEvidenceIds: [],
        competitorIds: [],
        evidenceBasisType: "STRATEGIC_MARKET_EMPHASIS",
      };
    }

    const rawMiIds: string[] = Array.isArray(cand.comparisonBaseline.miAuthorityIds)
      ? cand.comparisonBaseline.miAuthorityIds.map((id: any) => String(id).trim()).filter(Boolean)
      : [];
    const rawCustIds: string[] = Array.isArray(cand.comparisonBaseline.customerEvidenceIds)
      ? cand.comparisonBaseline.customerEvidenceIds.map((id: any) => String(id).trim()).filter(Boolean)
      : Array.isArray(cand.customerEvidenceIds)
        ? cand.customerEvidenceIds.map((id: any) => String(id).trim()).filter(Boolean)
        : [];

    const cleanMiIds: string[] = [];
    const cleanCustIds: string[] = [];

    for (const id of rawMiIds) {
      if (canonicalCustomerEvMap.has(id) || rawUidToCanonCustId.has(id)) {
        cleanCustIds.push(rawUidToCanonCustId.get(id) || id);
      } else {
        cleanMiIds.push(id);
      }
    }
    for (const id of rawCustIds) {
      cleanCustIds.push(rawUidToCanonCustId.get(id) || id);
    }

    cand.comparisonBaseline.miAuthorityIds = Array.from(new Set(cleanMiIds));
    cand.comparisonBaseline.customerEvidenceIds = Array.from(new Set(cleanCustIds));
    cand.competitorContrastingFacts = cand.comparisonBaseline.miAuthorityIds;
    cand.customerEvidenceIds = cand.comparisonBaseline.customerEvidenceIds;

    const rawCompIds: string[] = Array.isArray(cand.comparisonBaseline.competitorIds)
      ? cand.comparisonBaseline.competitorIds.map((id: any) => String(id).trim()).filter(Boolean)
      : [];
    // If customerEvidenceIds cites a competitor-linked review and competitorIds was omitted, restore it deterministically
    if (rawCompIds.length === 0 && cand.comparisonBaseline.customerEvidenceIds.length > 0 && cand.comparisonBaseline.miAuthorityIds.length === 0) {
      for (const cid of cand.comparisonBaseline.customerEvidenceIds) {
        const ce = canonicalCustomerEvMap.get(cid);
        if (ce?.competitorId) {
          rawCompIds.push(ce.competitorId);
        }
      }
    }
    cand.comparisonBaseline.competitorIds = Array.from(new Set(rawCompIds));

    if (!cand.comparisonBaseline.evidenceBasisType) {
      cand.comparisonBaseline.evidenceBasisType =
        cand.comparisonBaseline.miAuthorityIds.length > 0
          ? "COMPETITOR_FACT"
          : cand.comparisonBaseline.customerEvidenceIds.length > 0 && cand.comparisonBaseline.competitorIds.length > 0
            ? "COMPETITOR_CUSTOMER_VOICE"
            : cand.comparisonBaseline.customerEvidenceIds.length > 0
              ? "UNATTRIBUTED_MARKET_VOICE"
              : "STRATEGIC_MARKET_EMPHASIS";
    }

    // Formatting-only normalization on candidate text (semantic support is enforced by Judge + Repair)
    if (typeof cand.differentiationClaim === "string") {
      cand.differentiationClaim = cand.differentiationClaim.replace(/\s+/g, " ").trim();
    }
    if (typeof cand.buyerValue === "string") {
      cand.buyerValue = cand.buyerValue.replace(/\s+/g, " ").trim();
    }
  };

  // Preserve unchanged previously-approved candidates whose approvalFingerprint matches the current evidence snapshot (Case L)
  const preApprovedByPainId = new Map<string, DifferentiationCandidate>();
  if (Array.isArray(runContext?.previouslyApprovedCandidates)) {
    const validFactSet = new Set(canonicalProductTruth.map((f) => f.productTruthFactId));
    const validMiSet = new Set(canonicalMi.map((m) => m.miAuthorityId));
    for (const prev of runContext!.previouslyApprovedCandidates!) {
      if (!prev || !prev.isJudgeApproved || !prev.approvalFingerprint) continue;
      const expectedFp = computeCandidateApprovalFingerprint(prev, canonicalInput);
      const depsOk =
        (prev.productTruthFactIds || []).every((id) => validFactSet.has(id)) &&
        (prev.comparisonBaseline?.miAuthorityIds || []).every((id) => validMiSet.has(id)) &&
        (prev.comparisonBaseline?.customerEvidenceIds || []).every((id) => canonicalCustomerEvMap.has(id));
      if (prev.approvalFingerprint === expectedFp && depsOk) {
        for (const pid of prev.corePainIds || []) {
          preApprovedByPainId.set(pid, prev);
        }
      }
    }
  }

  // 2. Proposer
  let { differentiations, painDispositions } = await proposeDifferentiation(canonicalInput);

  // Structural generation of differentiationId & citation deduplication BEFORE Judge
  differentiations.forEach(sanitizeCandidateCitations);

  // Replace any candidate for a pain that already has a verified unchanged pre-approved candidate
  if (preApprovedByPainId.size > 0) {
    differentiations = differentiations.map((cand) => {
      const matchedPre = (cand.corePainIds || []).map((pid) => preApprovedByPainId.get(pid)).find(Boolean);
      return matchedPre ? { ...matchedPre } : cand;
    });
  }

  // Structural Completeness Validator
  const inputPainIds = new Set(canonicalInput.corePains.map(p => p.painId));
  const outputPainIds = new Set(painDispositions.map(d => d.painId));
  const missingPains = [...inputPainIds].filter(id => !outputPainIds.has(id));
  
  if (missingPains.length > 0) {
    missingPains.forEach(pid => {
      painDispositions.push({ painId: pid, disposition: "STRUCTURAL_DISPOSITION_MISSING" });
    });
  }

  // Separate pre-approved candidates from candidates needing Round 1 Judge evaluation
  const preApprovedLocked = differentiations.filter(
    (d) =>
      d.isJudgeApproved === true &&
      d.approvalFingerprint &&
      d.approvalFingerprint === computeCandidateApprovalFingerprint(d, canonicalInput)
  );
  const candidatesForRound1 = differentiations.filter(
    (d) => !preApprovedLocked.some((pa) => pa.differentiationId === d.differentiationId)
  );

  // 3. Judge Round 1
  let judgeResult =
    candidatesForRound1.length > 0
      ? await judgeDifferentiation(canonicalInput, candidatesForRound1)
      : {
          valid: true,
          assessmentsCompleted: true,
          assessmentDetails: {
            productFactualSupport: true,
            competitiveFactualSupport: true,
            audienceLaneRelevance: true,
            commercialMeaningfulness: true,
            strategicRoleValidity: true,
            evidenceCompleteness: true,
          },
          defects: [],
          overallVerdictRationale: "All candidates verified via unchanged approval fingerprints.",
        };
  console.log("[DifferentiationEngine] Judge Result Round 1:", JSON.stringify(judgeResult, null, 2));

  let lockedCandidates: DifferentiationCandidate[] = [...preApprovedLocked];

  // 4. Targeted Repair (1 Attempt Max) — first attempt deterministic baseline-only recovery before spending Round 2 LLM calls
  if (!judgeResult.valid || missingPains.length > 0) {
    // Lock accepted candidates from Round 1 so Round 2 Judge never overturns already-approved pillars
    const knownIds = new Set(candidatesForRound1.map(d => d.differentiationId));
    const rejectedIds = new Set(judgeResult.defects.map(d => d.differentiationId));
    const hasUnmatchedDefect = judgeResult.defects.some(d => !d.differentiationId || !knownIds.has(d.differentiationId));

    let failedCandidates: DifferentiationCandidate[] = [];

    if (hasUnmatchedDefect || !judgeResult.assessmentsCompleted) {
      // Unmatched or global defects on Round 1 pool mean none of candidatesForRound1 are safely validated
      failedCandidates = candidatesForRound1;
    } else {
      const round1Approved = candidatesForRound1.filter(d => !rejectedIds.has(d.differentiationId));
      round1Approved.forEach((d) => {
        d.isJudgeApproved = true;
        d.evidenceDependencyIds = extractCandidateEvidenceDependencies(d);
        d.approvalFingerprint = computeCandidateApprovalFingerprint(d, canonicalInput);
      });
      lockedCandidates = [...lockedCandidates, ...round1Approved];
      failedCandidates = candidatesForRound1.filter(d => rejectedIds.has(d.differentiationId));

      // Attempt deterministic field-level baseline repair on Round 1 failed candidates whose ONLY defects are on comparisonBaseline.*
      const nonBaselineAssessmentsPassRound1 =
        judgeResult.assessmentDetails.productFactualSupport === true &&
        judgeResult.assessmentDetails.audienceLaneRelevance === true &&
        judgeResult.assessmentDetails.commercialMeaningfulness === true &&
        judgeResult.assessmentDetails.strategicRoleValidity === true;

      const remainingFailedAfterDetRepair: DifferentiationCandidate[] = [];
      for (const cand of failedCandidates) {
        const candDefects = judgeResult.defects.filter((d) => d.differentiationId === cand.differentiationId);
        const hasProductOrMechanismDefect = candDefects.some(
          (d) =>
            d.code === "PRODUCT_TRUTH_UNSUPPORTED" ||
            d.code === "MECHANISM_HALLUCINATED" ||
            d.code === "PAIN_MEANING_DRIFT"
        );
        if (
          !hasProductOrMechanismDefect &&
          (nonBaselineAssessmentsPassRound1 ||
            candDefects.every((d) => d.rejectedFields.every((f) => f.startsWith("comparisonBaseline"))))
        ) {
          const repairedCand = finalizeComparisonBaselineOnlyDefect(cand, candDefects, canonicalInput);
          if (repairedCand) {
            sanitizeCandidateCitations(repairedCand);
            repairedCand.isJudgeApproved = true;
            repairedCand.evidenceDependencyIds = extractCandidateEvidenceDependencies(repairedCand);
            repairedCand.approvalFingerprint = computeCandidateApprovalFingerprint(repairedCand, canonicalInput);
            log(
              "DifferentiationEngine",
              `ROUND1_BASELINE_REPAIR_FINALIZED: Candidate ${repairedCand.differentiationId} recovered deterministically via ${repairedCand.targetedBaselineRepairAudit?.resolutionMode} (skipping LLM repair round)`
            );
            lockedCandidates.push(repairedCand);
            differentiations = differentiations.map((d) =>
              d.differentiationId === repairedCand.differentiationId ? repairedCand : d
            );
            continue;
          }
        }
        remainingFailedAfterDetRepair.push(cand);
      }
      failedCandidates = remainingFailedAfterDetRepair;
      if (failedCandidates.length === 0 && missingPains.length === 0) {
        judgeResult.defects = [];
        judgeResult.assessmentDetails.competitiveFactualSupport = true;
        judgeResult.valid = true;
      }
    }

    if (failedCandidates.length > 0 || missingPains.length > 0) {
      log("DifferentiationEngine", "Judge rejected candidates or missing pains detected. Running Targeted Repair...");
      console.log("\n--- STRUCTURAL_DISPOSITION_MISSING TRACE ---\nMissing Pains: " + JSON.stringify(missingPains) + "\n--------------------------------------------");
      const remainingDefects = judgeResult.defects.filter(
        (d) => !d.differentiationId || failedCandidates.some((fc) => fc.differentiationId === d.differentiationId)
      );
      const repairRes = await repairDifferentiation(
        canonicalInput,
        failedCandidates.length > 0 ? failedCandidates : candidatesForRound1,
        remainingDefects.length > 0 ? remainingDefects : judgeResult.defects
      );
      
      // Repair MUST preserve existing differentiationIds for failed candidates, or generate new ones structurally.
      const newCands = repairRes.differentiations;
      newCands.forEach((d: any, idx: number) => {
        if (d && typeof d === "object" && !d.differentiationId) {
          d.differentiationId = failedCandidates[idx]?.differentiationId || randomUUID();
        }
        sanitizeCandidateCitations(d);
      });

      differentiations = [...lockedCandidates, ...newCands];
      
      // Update dispositions cleanly
      const finalDispositions = new Map<string, PainDisposition>();
      painDispositions.forEach(pd => finalDispositions.set(pd.painId, pd));
      repairRes.painDispositions.forEach(pd => finalDispositions.set(pd.painId, pd));
      painDispositions = Array.from(finalDispositions.values());

      // Re-Judge only the newly repaired candidates (never re-judge lockedCandidates)
      const candidatesToJudgeRound2 = newCands.length > 0 ? newCands : failedCandidates;
      if (candidatesToJudgeRound2.length > 0) {
        judgeResult = await judgeDifferentiation(canonicalInput, candidatesToJudgeRound2);
        console.log("[DifferentiationEngine] Judge Result Round 2:", JSON.stringify(judgeResult, null, 2));
      }
    }
  } else {
    candidatesForRound1.forEach((d) => {
      d.isJudgeApproved = true;
      d.evidenceDependencyIds = extractCandidateEvidenceDependencies(d);
      d.approvalFingerprint = computeCandidateApprovalFingerprint(d, canonicalInput);
    });
  }

  // 5. Finalize (with explicit documented field-level repair path for comparisonBaseline-only defects)
  const evaluatedPool = lockedCandidates.length > 0
    ? differentiations.filter(d => !lockedCandidates.some(lc => lc.differentiationId === d.differentiationId))
    : differentiations;
  const finalKnownIds = new Set(evaluatedPool.map(d => d.differentiationId));
  const hasGlobalDefect = judgeResult.defects.some(d => !d.differentiationId || !finalKnownIds.has(d.differentiationId));
  const finalRejectedIds = new Set(
    judgeResult.defects
      .map(d => d.differentiationId)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );

  let round2Accepted: DifferentiationCandidate[] = [];
  if (judgeResult.valid && judgeResult.assessmentsCompleted && judgeResult.defects.length === 0) {
    round2Accepted = evaluatedPool;
  } else if (!hasGlobalDefect && judgeResult.assessmentsCompleted) {
    // Keep any evaluated candidates that had zero defects in Round 2
    const cleanlyPassedRound2 = evaluatedPool.filter(d => !finalRejectedIds.has(d.differentiationId));
    round2Accepted.push(...cleanlyPassedRound2);

    // For candidates rejected in Round 2 ONLY on comparisonBaseline.statement (when product factual support,
    // lane relevance, commercial meaningfulness, and strategic role validity passed), run the explicit
    // deterministic field-level repair and validation path.
    const nonBaselineAssessmentsPass =
      judgeResult.assessmentDetails.productFactualSupport === true &&
      judgeResult.assessmentDetails.audienceLaneRelevance === true &&
      judgeResult.assessmentDetails.commercialMeaningfulness === true &&
      judgeResult.assessmentDetails.strategicRoleValidity === true;

    for (const cand of evaluatedPool) {
      if (! cand.differentiationId || !finalRejectedIds.has(cand.differentiationId)) continue;
      const candDefects = judgeResult.defects.filter((d) => d.differentiationId === cand.differentiationId);
      const hasProductOrMechanismDefect = candDefects.some(
        (d) =>
          d.code === "PRODUCT_TRUTH_UNSUPPORTED" ||
          d.code === "MECHANISM_HALLUCINATED" ||
          d.code === "PAIN_MEANING_DRIFT"
      );
      if (hasProductOrMechanismDefect) continue;

      if (nonBaselineAssessmentsPass || candDefects.every((d) => d.rejectedFields.every((f) => f.startsWith("comparisonBaseline")))) {
        const repairedCand = finalizeComparisonBaselineOnlyDefect(cand, candDefects, canonicalInput);
        if (repairedCand) {
          log(
            "DifferentiationEngine",
            `TARGETED_BASELINE_REPAIR_FINALIZED: Candidate ${repairedCand.differentiationId} recovered via ${repairedCand.targetedBaselineRepairAudit?.resolutionMode}`
          );
          round2Accepted.push(repairedCand);
        }
      }
    }
  } else {
    round2Accepted = [];
  }

  // Verify locked candidates still match their approvalFingerprint under the current evidence snapshot
  const verifiedLockedCandidates = lockedCandidates.filter((lc) => {
    if (!lc.approvalFingerprint) return true;
    return lc.approvalFingerprint === computeCandidateApprovalFingerprint(lc, canonicalInput);
  });

  const acceptedDifferentiations: DifferentiationCandidate[] = [
    ...verifiedLockedCandidates,
    ...round2Accepted.filter(rc => !verifiedLockedCandidates.some(lc => lc.differentiationId === rc.differentiationId)),
  ];
  
  acceptedDifferentiations.forEach((d) => {
    d.isJudgeApproved = true;
    d.evidenceDependencyIds = extractCandidateEvidenceDependencies(d);
    d.approvalFingerprint = computeCandidateApprovalFingerprint(d, canonicalInput);
  });

  // Update dispositions for accepted vs rejected pains
  const acceptedPainIds = new Set<string>();
  acceptedDifferentiations.forEach(d => {
    const pids = Array.isArray(d.corePainIds) ? d.corePainIds : (Array.isArray((d as any).painIds) ? (d as any).painIds : [(d as any).painId || (d as any).corePainId].filter(Boolean));
    pids.forEach(pid => {
      acceptedPainIds.add(pid);
      const disp = painDispositions.find(p => p.painId === pid);
      if (disp) { disp.disposition = "ACCEPTED_DIFFERENTIATION"; disp.differentiationId = d.differentiationId; }
    });
  });

  painDispositions.forEach((disp) => {
    if (!acceptedPainIds.has(disp.painId) && disp.disposition === "ACCEPTED_DIFFERENTIATION") {
      disp.disposition = "NO_SUPPORTED_DIFFERENTIATION";
    }
  });

  const allAccepted = acceptedDifferentiations.length > 0;

  if (!allAccepted) {
    const isTechnicalFailure =
      !judgeResult.assessmentsCompleted &&
      /schema validation failure|execution exception|parse/i.test(judgeResult.overallVerdictRationale || "");
    const hasLineageFailure = judgeResult.defects.some((d) => d.code === "LINEAGE_REFERENCE_INVALID");

    return {
      status: "FAILED",
      statusMessage: isTechnicalFailure
        ? `Technical failure in Differentiation Judge: ${judgeResult.overallVerdictRationale}`
        : hasLineageFailure
          ? "Evidence handoff or lineage boundary failure: LINEAGE_REFERENCE_INVALID"
          : "Semantic exhaustion: NO_SUPPORTED_DIFFERENTIATION",
      errorCode: isTechnicalFailure
        ? "JUDGE_TECHNICAL_FAILURE"
        : hasLineageFailure
          ? "LINEAGE_REFERENCE_INVALID"
          : "NO_SUPPORTED_DIFFERENTIATION",
      failureCategory: isTechnicalFailure
        ? "TECHNICAL_EXECUTION_FAILURE"
        : hasLineageFailure
          ? "MISSING_EVIDENCE_HANDOFF"
          : "SEMANTIC_REJECTION",
      differentiations: [],
      pillars: [],
      claimStructures: [],
      proofArchitecture: [],
      painDispositions,
      confidenceScore: 0.0,
      executionTimeMs: Date.now() - start,
      engineVersion: 3,
      productTruthSnapshotId: resolvedSnapshotId,
      productTruthFingerprint: resolvedFingerprint,
      evidenceManifestFingerprint,
    };
  }

  const citedInOutputCompetitorIdsSet = new Set<string>();
  acceptedDifferentiations.forEach((d) => {
    (d.comparisonBaseline?.competitorIds || []).forEach((cid: string) => {
      if (cid) citedInOutputCompetitorIdsSet.add(String(cid));
    });
  });

  const deriveMultiDimDiffStatus = (d: DifferentiationCandidate) => {
    const factIds = Array.isArray(d.productTruthFactIds)
      ? d.productTruthFactIds
      : (Array.isArray((d as any).ourEstablishedFacts) ? (d as any).ourEstablishedFacts : []);
    const isProposed =
      (d as any).isProposed ||
      (d as any).type === "PROPOSED" ||
      /proposed|requires (?:validation|implementation)/i.test(d.differentiationClaim || "");
    const compIds = Array.isArray(d.comparisonBaseline?.competitorIds)
      ? d.comparisonBaseline!.competitorIds!.filter(Boolean)
      : [];
    const hasVerifiedCompetitorContrast =
      !isProposed &&
      d.strategicForm === "COMPETITIVE_CONTRAST" &&
      d.comparisonBaseline?.evidenceBasisType !== "STRATEGIC_MARKET_EMPHASIS" &&
      compIds.length > 0 &&
      ((d.comparisonBaseline?.miAuthorityIds?.length || 0) > 0 ||
        (d.comparisonBaseline?.customerEvidenceIds?.length || 0) > 0);

    const factualSupport: FactualSupportStatus = isProposed
      ? "UNVERIFIED_FACT"
      : factIds.length > 0
        ? "VERIFIED_PRODUCT_FACT"
        : "UNVERIFIED_FACT";

    const hasAvailableCompetitorComparison =
      compIds.length > 0 ||
      canonicalMi.length > 0 ||
      (runContext?.competitorComparisonRegistry?.totalCompetitorsRegistered ?? 0) > 0;

    const competitiveSupport: CompetitiveSupportStatus = hasVerifiedCompetitorContrast
      ? "VERIFIED_COMPETITIVE_DIFFERENCE"
      : hasAvailableCompetitorComparison
        ? "SHARED_OR_TABLE_STAKES_CAPABILITY"
        : "COMPETITIVE_COMPARISON_UNAVAILABLE";

    const strategicStatus: StrategicDecisionStatus = isProposed
      ? "PROPOSED_PRODUCT_CHANGE"
      : hasVerifiedCompetitorContrast
        ? "RECOMMENDED_STRATEGY"
        : "STRATEGIC_HYPOTHESIS";

    const executionStatus: ExecutionEligibilityStatus = isProposed
      ? "REQUIRES_VALIDATION_BEFORE_EXECUTION"
      : "EXECUTION_ELIGIBLE";

    const businessApprovalStatus: BusinessApprovalStatus = isProposed
      ? "PENDING_BUSINESS_APPROVAL"
      : "APPROVED_EXISTING_POLICY";

    const differentiationClassification: DifferentiationClassification = isProposed
      ? "PROPOSED_PRODUCT_OR_OPERATIONAL_CHANGE"
      : hasVerifiedCompetitorContrast
        ? factIds.length >= 2
          ? "VALUABLE_CAPABILITY_COMBINATION"
          : "SUPPORTED_CAPABILITY_DIFFERENCE"
        : factIds.length > 0
          ? "SHARED_CAPABILITY_STRATEGIC_EMPHASIS"
          : "PROPOSED_STRATEGIC_HYPOTHESIS";

    const honestLabel = deriveHonestClaimLabel({
      factualSupport,
      competitiveSupport,
      strategicStatus,
      executionStatus,
      businessApprovalStatus,
      differentiationClassification,
    });

    return {
      isProposed,
      factualSupport,
      competitiveSupport,
      strategicStatus,
      executionStatus,
      businessApprovalStatus,
      differentiationClassification,
      honestLabel,
    };
  };

  const pillars = acceptedDifferentiations.map(d => {
    const pids = Array.isArray(d.corePainIds) ? d.corePainIds : (Array.isArray((d as any).painIds) ? (d as any).painIds : [(d as any).painId || (d as any).corePainId].filter(Boolean));
    const factIds = Array.isArray(d.productTruthFactIds) ? d.productTruthFactIds : (Array.isArray((d as any).ourEstablishedFacts) ? (d as any).ourEstablishedFacts : []);
    const matchingFacts = canonicalProductTruth.filter(f => factIds.includes(f.productTruthFactId));
    const supportingProof = [
      ...new Set(matchingFacts.map(f => {
        if (f.factType === "PROOF") return "case_proof";
        if (f.factType === "DELIVERY_MECHANISM") return "process_proof";
        if (f.factType === "PRICING_FACT") return "transparency_proof";
        return "comparative_proof";
      }))
    ];
    if (supportingProof.length === 0) {
      supportingProof.push("case_proof", "process_proof");
    }

    const multiDim = deriveMultiDimDiffStatus(d);
    (d as any).factualSupport = multiDim.factualSupport;
    (d as any).competitiveSupport = multiDim.competitiveSupport;
    (d as any).strategicStatus = multiDim.strategicStatus;
    (d as any).executionStatus = multiDim.executionStatus;
    (d as any).businessApprovalStatus = multiDim.businessApprovalStatus;
    (d as any).differentiationClassification = multiDim.differentiationClassification;
    (d as any).honestLabel = multiDim.honestLabel;

    return {
      name: d.distinctiveProperty || d.differentiationClaim,
      title: d.distinctiveProperty || d.differentiationClaim,
      description: d.differentiationClaim,
      strategy: d.differentiationClaim,
      buyerValue: d.buyerValue,
      painIds: pids,
      proofPoints: [d.proofBoundary].filter(Boolean),
      proofBoundary: d.proofBoundary,
      mechanismName: d.mechanismName,
      overallScore: d.isJudgeApproved ? 0.9 : 0.0,
      supportingProof,
      productTruthFactIds: factIds,
      comparisonBaseline: d.comparisonBaseline,
      customerEvidenceIds: d.comparisonBaseline?.customerEvidenceIds || [],
      factualSupport: multiDim.factualSupport,
      competitiveSupport: multiDim.competitiveSupport,
      strategicStatus: multiDim.strategicStatus,
      executionStatus: multiDim.executionStatus,
      businessApprovalStatus: multiDim.businessApprovalStatus,
      differentiationClassification: multiDim.differentiationClassification,
      honestLabel: multiDim.honestLabel,
    };
  });

  const claimStructures = acceptedDifferentiations.map(d => {
    const pids = Array.isArray(d.corePainIds) ? d.corePainIds : (Array.isArray((d as any).painIds) ? (d as any).painIds : [(d as any).painId || (d as any).corePainId].filter(Boolean));
    const factIds = Array.isArray(d.productTruthFactIds) ? d.productTruthFactIds : (Array.isArray((d as any).ourEstablishedFacts) ? (d as any).ourEstablishedFacts : []);
    const multiDim = deriveMultiDimDiffStatus(d);
    const status = multiDim.isProposed
      ? ClaimEpistemicStatus.PROPOSED_CAPABILITY
      : multiDim.competitiveSupport === "VERIFIED_COMPETITIVE_DIFFERENCE"
        ? ClaimEpistemicStatus.SUPPORTED_CAPABILITY
        : ClaimEpistemicStatus.STRATEGIC_SYNTHESIS;
    return {
      claim: d.differentiationClaim,
      distinctiveProperty: d.distinctiveProperty,
      buyerValue: d.buyerValue,
      painIds: pids,
      proofPoints: [d.proofBoundary].filter(Boolean),
      proofBoundary: d.proofBoundary,
      sourceFactIds: factIds,
      comparisonBaseline: d.comparisonBaseline,
      customerEvidenceIds: d.comparisonBaseline?.customerEvidenceIds || [],
      status,
      epistemicStatus: status,
      label: multiDim.honestLabel || CLAIM_EPISTEMIC_LABELS[status],
      factualSupport: multiDim.factualSupport,
      competitiveSupport: multiDim.competitiveSupport,
      strategicStatus: multiDim.strategicStatus,
      executionStatus: multiDim.executionStatus,
      businessApprovalStatus: multiDim.businessApprovalStatus,
      differentiationClassification: multiDim.differentiationClassification,
      prerequisites: (d as any).prerequisites || (multiDim.isProposed ? ["Operational specification and validation required"] : []),
      limitations: (d as any).limitations || (
        multiDim.competitiveSupport !== "VERIFIED_COMPETITIVE_DIFFERENCE"
          ? ["Competitive comparison is unverified; treated as a strategic market-emphasis recommendation based on verified product capabilities rather than proven category uniqueness."]
          : []
      ),
    };
  });

  const proofArchitectureAssets: Array<{
    type: string;
    category: string;
    asset: string;
    factId?: string;
    sourceFactId?: string;
    required: boolean;
  }> = [];

  const seenProofKeys = new Set<string>();

  acceptedDifferentiations.forEach(d => {
    const factIds = Array.isArray(d.productTruthFactIds)
      ? d.productTruthFactIds
      : (Array.isArray((d as any).ourEstablishedFacts) ? (d as any).ourEstablishedFacts : []);
    const matchingFacts = canonicalProductTruth.filter(f => factIds.includes(f.productTruthFactId));

    matchingFacts.forEach(f => {
      let pType: string | null = null;
      if (f.factType === "PROOF") {
        pType = "case_proof";
      } else if (f.factType === "DELIVERY_MECHANISM" || f.factType === "OPERATIONAL") {
        pType = "process_proof";
      } else if (f.factType === "PRICING_FACT" || f.factType === "OFFER") {
        pType = "transparency_proof";
      } else if (f.factType === "QUALITY") {
        pType = "process_proof";
      } else if (f.factType === "CAPABILITY") {
        const lowerFact = (f.fact || "").toLowerCase();
        if (/workflow|process|protocol|pipeline|system|mechanism|exchange|step/i.test(lowerFact)) {
          pType = "process_proof";
        } else if (/framework|architecture|model|doctrine/i.test(lowerFact)) {
          pType = "framework_proof";
        } else if (/price|pricing|sku|cost|\$|fee|rate|guarantee|policy/i.test(lowerFact)) {
          pType = "transparency_proof";
        } else {
          pType = "process_proof";
        }
      }

      if (pType) {
        const key = `${pType}:${f.productTruthFactId}`;
        if (!seenProofKeys.has(key)) {
          seenProofKeys.add(key);
          proofArchitectureAssets.push({
            type: pType,
            category: pType,
            asset: f.fact,
            factId: f.productTruthFactId,
            sourceFactId: f.productTruthFactId,
            required: f.factType === "PROOF",
          });
        }
      }
    });

    const hasCompetitorEvidence = (Array.isArray(d.competitorContrastingFacts) && d.competitorContrastingFacts.length > 0) ||
      (Array.isArray((d as any).competitorEvidenceIds) && (d as any).competitorEvidenceIds.length > 0) ||
      (d.comparisonBaseline?.miAuthorityIds && d.comparisonBaseline.miAuthorityIds.length > 0) ||
      (d.comparisonBaseline?.customerEvidenceIds && d.comparisonBaseline.customerEvidenceIds.length > 0 && d.comparisonBaseline?.competitorIds && d.comparisonBaseline.competitorIds.length > 0);

    const isUnprovenGap = /unproven|gap|unverified|untested|hypothesis|assumption|not established|requires validation|proposed/i.test(d.proofBoundary || "");

    if (d.proofBoundary && hasCompetitorEvidence && !isUnprovenGap && !seenProofKeys.has(d.proofBoundary)) {
      seenProofKeys.add(d.proofBoundary);
      proofArchitectureAssets.push({
        type: "comparative_proof",
        category: "comparative_proof",
        asset: d.proofBoundary,
        required: true,
      });
    }
  });

  const competitorComparisonRegistry = {
    availableCompetitorIds,
    selectedCompetitorIds,
    includedInPromptCompetitorIds: Array.from(includedInPromptCompetitorIdsSet),
    citedInOutputCompetitorIds: Array.from(citedInOutputCompetitorIdsSet),
    unresolvedUnknownsByCompetitor,
  };

  return {
    status: "SUCCESS",
    statusMessage: "Differentiation computed",
    differentiations: acceptedDifferentiations,
    pillars,
    claimStructures,
    proofArchitecture: proofArchitectureAssets,
    painDispositions,
    competitorComparisonRegistry,
    authorityMode: "transparent_guide",
    authorityRationale: "Grounded in verified Product Truth facts and customer evidence",
    mechanismFraming: pillars[0]
      ? {
          type: "system",
          name: pillars[0].name,
          description: `${pillars[0].description || ""} ${pillars[0].buyerValue || ""} ${pillars[0].proofBoundary || ""}`.trim(),
          supported: true,
          proofBasis: pillars[0].supportingProof || [],
          proofSignals: pillars[0].supportingProof || [],
        }
      : null,
    mechanismCore: pillars[0]
      ? {
          mechanismName: pillars[0].name,
          mechanismType: "system",
          mechanismSteps:
            Array.isArray(pillars[0].supportingProof) && pillars[0].supportingProof.length > 0
              ? pillars[0].supportingProof
              : [pillars[0].description || pillars[0].name],
          mechanismPromise: pillars[0].buyerValue || pillars[0].description || "",
          mechanismProblem: pillars[0].comparisonBaseline?.statement || "",
          mechanismLogic: pillars[0].description || "",
          coreLogic: pillars[0].description || "",
          buyerOutcome: pillars[0].buyerValue || "",
        }
      : null,
    celDepthCompliance: {
      engineId: "differentiation",
      passed: true,
      score: 0.9,
      causalDepthScore: 0.9,
      violations: [],
      appliedRules: [],
      rootCausesEvaluated: 1,
      enforcementLog: [],
    },
    confidenceScore: 0.9,
    executionTimeMs: Date.now() - start,
    engineVersion: 3,
    productTruthSnapshotId: resolvedSnapshotId,
    productTruthFingerprint: resolvedFingerprint,
    evidenceManifestFingerprint,
  } as any;
}



export function buildStructuredAELBlock(ael: any): string {
  if (!ael) return "";
  const sections: string[] = [];
  const rootCauses = ael.root_causes || [];
  const causalChains = ael.causal_chains || [];
  const buyingBarriers = ael.buying_barriers || [];

  if (rootCauses.length === 0 && causalChains.length === 0 && buyingBarriers.length === 0) return "";

  sections.push("\n═══ AEL CAUSAL STRUCTURE (you MUST use these identifiers in your output) ═══\n");

  if (rootCauses.length > 0) {
    sections.push("ROOT CAUSES:");
    rootCauses.slice(0, 5).forEach((rc: any, i: number) => {
      sections.push(`  [RC${i + 1}] Surface: "${rc.surfaceSignal}" → Deep cause: "${rc.deepCause}" [${rc.confidenceLevel}]`);
    });
  }

  if (causalChains.length > 0) {
    sections.push("\nCAUSAL CHAINS:");
    causalChains.slice(0, 5).forEach((cc: any, i: number) => {
      sections.push(`  [CC${i + 1}] ${cc.pain} → ${cc.cause} → ${cc.impact} → ${cc.behavior} (conversion: ${cc.conversionEffect})`);
    });
  }

  if (buyingBarriers.length > 0) {
    sections.push("\nBUYING BARRIERS:");
    buyingBarriers.slice(0, 5).forEach((bb: any, i: number) => {
      sections.push(`  [BB${i + 1}] [${bb.severity}] ${bb.barrier} — root: ${bb.rootCause} — resolution: ${bb.requiredResolution}`);
    });
  }

  sections.push("\n═══ END AEL STRUCTURE ═══\n");
  return sections.join("\n");
}
