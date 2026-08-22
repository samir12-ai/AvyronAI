import { randomUUID } from 'crypto';
import crypto from "crypto";

export type AudiencePainClass =
  | "CORE_PURCHASE"
  | "OBJECTION"
  | "POST_PURCHASE_FRICTION"
  | "SUPPORTING"
  | "UNKNOWN";

export type PainUse =
  | "positioning"
  | "differentiation"
  | "mechanism"
  | "offer_core"
  | "offer_objection"
  | "awareness"
  | "funnel"
  | "persuasion"
  | "channel"
  | "retention";

export const DETERMINISTIC_CLASSIFIER_VERSION = "deterministic_v1";

export type ProductFitType = "DIRECT_FIT" | "STRATEGIC_FIT" | "NOT_FIT" | "UNKNOWN";

export interface AuthoritativeAudiencePain {
  painId: string;
  canonical: string;
  /** Verbatim source wording exactly as supplied by the Audience engine. */
  originalStatement: string;
  /** Normalized form (lowercase, collapsed non-alphanumerics) used for stable ID derivation. */
  normalizedStatement: string;
  classification: AudiencePainClass;
  rank: number;
  productFit: "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN";
  /** Granular Product Fit Taxonomy distinguishing direct vs strategic fit */
  fitType?: ProductFitType;
  /** Explains how existing Product Truth addresses an upstream strategic cause of the pain */
  strategicBridge?: string;
  /** Explicit statement of what the product does NOT solve (boundary enforcement) */
  boundary?: string;
  /** Exact Product Truth fact IDs cited to justify fit */
  productTruthFactIds?: string[];
  /** Structural ID for the Product Fit decision */
  productFitAuthorityId?: string;
  /** Whether the associated role is covered by Target Authority */
  targetCovered?: boolean;
  /** Target coverage semantic decision */
  coverageDecision?: "COVERED" | "RELATED_BUT_UNPROVEN" | "NOT_COVERED";
  /** Structural ID for the Target Coverage decision */
  targetCoverageAuthorityId?: string;
  eligible: boolean;
  allowedUses: PainUse[];
  prohibitedUses: PainUse[];
  evidenceUids: string[];
  sourceSignalIds: string[];
  /** Structural ID for the final CORE Strategic Priority decision */
  coreDecisionId?: string;
  strategicPainDecisionAuthorityId?: string;
  targetAssessmentAuthorityId?: string;
  productAssessmentAuthorityId?: string;
  targetUnderstandingAuthorityId?: string;
  businessUnderstandingAuthorityId?: string;
  campaignOfferingId?: string;
  segmentId?: string;
  /** Source channel/type labels carried from the Audience signal (e.g. review, comment). */
  sourceTypes: string[];
  /** DEPRECATED: Non-authoritative backward compatibility field. Never used for semantic gating. */
  evidenceStrength?: number;
  /** Factual count of total citations across evidence UIDs and source signals */
  citationCount?: number;
  /** Factual count of unique evidence UIDs */
  uniqueEvidenceCount?: number;
  /** Factual count of unique source types/channels */
  uniqueSourceCount?: number;
  /** Factual count of unique competitors or source entities */
  uniqueCompetitorCount?: number;
  /** Factual occurrence count */
  occurrenceCount?: number;
  /** Grounded evidence quotes / summaries if available */
  evidenceSummaries?: string[];
  /** AEL root-cause identifiers behind this pain, where the Audience engine supplied them. */
  rootCauseIds: string[];
  /** Dynamic target audience segments associated with this pain. */
  segmentIds: string[];
  /** Segment name if available */
  segmentName?: string;
  /** Strategic role designation (e.g. CORE_BUYER, CORE_USER, OBJECTION) */
  strategicRole?: string;
  /** Which classifier produced `classification` (deterministic_v1 | llm_v1+judge_v1). */
  classifierVersion: string;
  /** Human-auditable reason for the classification decision. */
  classificationReason: string;
  lineage: { accountId: string; audienceSnapshotId: string };
}

export interface MarketPainPortfolio {
  campaignId: string;
  accountId: string;
  audienceSnapshotId: string;
  pains: AuthoritativeAudiencePain[];
}

export interface PainPortfolioViews {
  marketPortfolio: MarketPainPortfolio;
  productAligned: AuthoritativeAudiencePain[];
  generalMarket: AuthoritativeAudiencePain[];
  reconciliation: {
    total: number;
    directFit: number;
    strategicFit: number;
    notFit: number;
    unknown: number;
    sumMatchesTotal: boolean;
  };
}

export interface PainRegistryValidation {
  valid: boolean;
  issues: string[];
}

const USES_BY_CLASS: Record<AudiencePainClass, PainUse[]> = {
  CORE_PURCHASE: ["positioning", "differentiation", "mechanism", "offer_core", "awareness", "funnel", "persuasion", "channel"],
  OBJECTION: ["offer_objection", "awareness", "funnel", "persuasion"],
  POST_PURCHASE_FRICTION: ["retention"],
  SUPPORTING: ["awareness", "funnel", "persuasion", "channel"],
  UNKNOWN: [],
};

export function allowedUsesForClass(classification: AudiencePainClass): PainUse[] {
  return [...USES_BY_CLASS[classification]];
}

export function prohibitedUsesForClass(classification: AudiencePainClass): PainUse[] {
  const allowed = USES_BY_CLASS[classification];
  return (Object.keys(USES_BY_CLASS) as AudiencePainClass[])
    .flatMap((kind) => USES_BY_CLASS[kind])
    .filter((use, position, all) => all.indexOf(use) === position && !allowed.includes(use));
}

function painText(pain: any): string {
  return typeof pain === "string"
    ? pain
    : String(pain?.canonical ?? pain?.claim ?? pain?.pain ?? pain?.text ?? pain?.label ?? pain?.name ?? "").trim();
}

function normalizeStatement(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stableId(snapshotId: string, text: string): string {
  const normalized = normalizeStatement(text);
  return `pain_${crypto.createHash("sha256").update(`${snapshotId}:${normalized}`).digest("hex").slice(0, 16)}`;
}

export function classifyAudiencePainDetailed(text: string): { classification: AudiencePainClass; reason: string } {
  // Deterministic keyword hijacking has been removed.
  // The LLM + Semantic Judge are the sole authority on semantic function.
  // We return UNKNOWN. If the LLM fails to classify, the pain remains UNKNOWN.
  return { classification: "UNKNOWN", reason: "no deterministic rules allowed; requires llm authority" };
}

export function classifyAudiencePain(text: string): AudiencePainClass {
  return classifyAudiencePainDetailed(text).classification;
}

function values(value: any): string[] {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  return raw.map((item) => {
    if (typeof item === "string") return item;
    return item?.uid ?? item?.evidenceUid ?? item?.id ?? item?.signalId ?? item?.rootCauseId ?? "";
  }).filter((item): item is string => typeof item === "string" && item.length > 0);
}

/**
 * Extract canonical Judge-approved pain claims directly from audienceSegments.
 * Preserves claimId, canonical text, evidenceIds, segment context, and role.
 * Does NOT perform fuzzy text matching or merge with legacy painMap.
 */
export function extractCanonicalSegmentPains(segments: any[]): any[] {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const extracted: any[] = [];
  segments.forEach((seg: any, sIdx: number) => {
    const segName = seg.name ? String(seg.name).trim() : `Segment ${sIdx + 1}`;
    const cleanSegName = segName.toLowerCase();
    const segId = seg.id || `seg_${crypto.createHash("sha256").update(cleanSegName).digest("hex").slice(0, 16)}`;
    const role = seg.role || seg.roleClaim?.value || seg.demographics?.role || "PRACTITIONER";
    const roleClaimId = seg.roleClaim?.claimId || seg.roleClaimId;
    const segmentDefinition = typeof seg.segmentDefinition === "object" ? seg.segmentDefinition?.claim : seg.segmentDefinition;
    const segmentDefClaimId = typeof seg.segmentDefinition === "object" ? seg.segmentDefinition?.claimId : undefined;

    const pains = Array.isArray(seg.pains) ? seg.pains : [];
    pains.forEach((p: any, pIdx: number) => {
      const claimText = typeof p === "string" ? p : (p.description || p.claim || p.text || p.canonical || p.pain || "");
      if (!claimText || String(claimText).trim().length === 0) return;
      const cleanClaim = String(claimText).trim();
      const claimId = typeof p === "object" ? (p.claimId || p.painId || p.id) : undefined;
      const evidenceIds = typeof p === "object" ? (p.evidenceIds || p.evidenceUids || p.evidence || []) : [];
      
      extracted.push({
        painId: claimId || `pain_${sIdx + 1}_${pIdx + 1}`,
        claimId,
        canonical: cleanClaim,
        originalStatement: cleanClaim,
        role,
        strategicRole: role,
        roleClaimId,
        segmentId: segId,
        segmentName: segName,
        segmentIds: [segId],
        segmentDefinition,
        segmentDefClaimId,
        evidenceUids: Array.isArray(evidenceIds) ? evidenceIds : [evidenceIds],
        evidenceIds: Array.isArray(evidenceIds) ? evidenceIds : [evidenceIds],
      });
    });
  });
  return extracted;
}

export function buildAudiencePainRegistry(
  pains: any[],
  lineage: { accountId: string; audienceSnapshotId: string },
  segments?: any[],
): AuthoritativeAudiencePain[] {
  const segmentIdByName = new Map<string, string>();
  const segmentNameById = new Map<string, string>();
  if (Array.isArray(segments)) {
    segments.forEach((seg: any) => {
      if (seg?.name) {
        const cleanName = seg.name.trim();
        const derivedId = seg.id || `seg_${crypto.createHash("sha256").update(cleanName).digest("hex").slice(0, 16)}`;
        segmentIdByName.set(cleanName.toLowerCase(), derivedId);
        segmentNameById.set(derivedId, cleanName);
        segmentNameById.set(cleanName, cleanName);
        seg.id = derivedId;
      }
    });
  }

  const result = pains.flatMap((raw, index) => {
    const canonical = painText(raw);
    const suppliedClass = raw?.classification && Object.hasOwn(USES_BY_CLASS, raw.classification)
      ? raw.classification as AudiencePainClass
      : null;
    const detailed = classifyAudiencePainDetailed(canonical);
    const classification = suppliedClass ?? detailed.classification;
    const classificationReason = typeof raw?.classificationReason === "string" && raw.classificationReason.length > 0
      ? raw.classificationReason
      : suppliedClass
        ? "classification supplied by upstream registry record"
        : detailed.reason;
    const classifierVersion = typeof raw?.classifierVersion === "string" && raw.classifierVersion.length > 0
      ? raw.classifierVersion
      : DETERMINISTIC_CLASSIFIER_VERSION;
    const evidenceUids = values(raw?.evidenceUids ?? raw?.evidenceIds ?? raw?.evidence ?? raw?.groundingRefs);
    const sourceSignalIds = values(raw?.sourceSignalIds ?? raw?.signalIds ?? raw?.sourceSignals ?? raw?.parentSignalId);
    const sourceTypes = values(raw?.sourceTypes ?? raw?.sourceType);
    const rootCauseIds = values(raw?.rootCauseIds ?? raw?.rootCauses ?? raw?.deepCauseIds);
    const segmentIds: string[] = [];
    const rawSegIds = values(raw?.segmentIds ?? raw?.segments ?? raw?.audienceSegmentIds ?? raw?.targetSegmentIds ?? raw?.segmentId);
    if (rawSegIds.length > 0) {
      segmentIds.push(...rawSegIds);
    } else if (Array.isArray(segments)) {
      segments.forEach((seg: any) => {
        if (seg?.name) {
          const segId = segmentIdByName.get(seg.name.toLowerCase().trim());
          if (segId) {
            const profiles = [
              ...(Array.isArray(seg.painProfile) ? seg.painProfile : []),
              ...(Array.isArray(seg.objectionProfile) ? seg.objectionProfile : []),
              ...(Array.isArray(seg.motivationProfile) ? seg.motivationProfile : []),
              ...(Array.isArray(seg.desireProfile) ? seg.desireProfile : []),
            ].map(p => String(p).toLowerCase().trim());
            const canonicalLC = canonical.toLowerCase().trim();
            const match = profiles.some(profileText => {
              if (profileText === canonicalLC) return true;
              if (canonicalLC.includes(profileText) || profileText.includes(canonicalLC)) return true;
              const words1 = canonicalLC.split(/[^a-z0-9]+/).filter(w => w.length > 4);
              const words2 = profileText.split(/[^a-z0-9]+/).filter(w => w.length > 4);
              return words1.some(w => words2.includes(w));
            });
            if (match) {
              segmentIds.push(segId);
            }
          }
        }
      });
    }
    if (segmentIds.length === 0) {
      if (Array.isArray(segments)) {
        segmentIds.push("UNMATCHED");
      }
    }
    const strategicRole = typeof raw?.strategicRole === "string"
      ? raw.strategicRole
      : typeof raw?.role === "string"
        ? raw.role
        : undefined;
    
    // Factual counts derived directly from structural evidence identity
    const uniqueEvidenceUids = Array.from(new Set(evidenceUids));
    const uniqueSourceSignals = Array.from(new Set(sourceSignalIds));
    const uniqueSourceTypes = Array.from(new Set(sourceTypes || []));
    const citationCount = uniqueEvidenceUids.length + uniqueSourceSignals.length;
    const uniqueEvidenceCount = uniqueEvidenceUids.length;
    const uniqueSourceCount = uniqueSourceTypes.length;
    const uniqueCompetitorCount = Number.isFinite(raw?.uniqueCompetitorCount) ? raw.uniqueCompetitorCount : undefined;
    const occurrenceCount = Number.isFinite(raw?.occurrenceCount)
      ? raw.occurrenceCount
      : Math.max(1, citationCount);

    // DEPRECATED backward-compatibility field: preserved only if explicit, never fabricated as 1.0 or / 4
    const evidenceStrength = Number.isFinite(raw?.evidenceStrength)
      ? Math.max(0, Math.min(1, raw.evidenceStrength))
      : undefined;

    const allowedUses = Array.isArray(raw?.allowedUses)
      ? raw.allowedUses.filter((use: unknown): use is PainUse => typeof use === "string" && (USES_BY_CLASS[classification] as string[]).includes(use))
      : USES_BY_CLASS[classification];

    const makeRecordForSegment = (targetSegmentId: string | null, suffixId?: string) => {
      const segList = targetSegmentId ? [targetSegmentId] : segmentIds;
      const defaultFit: "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN" = 
        raw?.productFit === "ELIGIBLE" || raw?.productFit === "INELIGIBLE"
          ? raw.productFit
          : "UNKNOWN";

      const productFit = raw?.productFit === "INELIGIBLE" || raw?.productFit === "UNKNOWN"
        ? raw.productFit
        : (segList.includes("UNMATCHED")
            ? "UNKNOWN"
            : (raw?.productFit === "ELIGIBLE" ? "ELIGIBLE" : defaultFit));

      const pid = suffixId 
        ? `${typeof raw?.painId === "string" ? raw.painId : (typeof raw?.claimId === "string" ? raw.claimId : stableId(lineage.audienceSnapshotId, canonical))}_${suffixId}`
        : (typeof raw?.painId === "string" ? raw.painId : (typeof raw?.claimId === "string" ? raw.claimId : stableId(lineage.audienceSnapshotId, canonical)));

      return {
        painId: pid,
        canonical,
        originalStatement: typeof raw?.originalStatement === "string" && raw.originalStatement.length > 0
          ? raw.originalStatement
          : canonical,
        normalizedStatement: normalizeStatement(canonical),
        classification,
        rank: Number.isFinite(raw?.rank) ? raw.rank : index + 1,
        productFit,
        fitType: raw?.fitType || (productFit === "ELIGIBLE" ? "DIRECT_FIT" : (productFit === "INELIGIBLE" ? "NOT_FIT" : "UNKNOWN")),
        targetCovered: typeof raw?.targetCovered === "boolean" ? raw.targetCovered : false,
        targetCoverageAuthorityId: raw?.targetCoverageAuthorityId,
        productFitAuthorityId: raw?.productFitAuthorityId,
        coreDecisionId: raw?.coreDecisionId,
        strategicBridge: raw?.strategicBridge,
        boundary: raw?.boundary,
        productTruthFactIds: raw?.productTruthFactIds,
        eligible: raw?.eligible === false ? false : productFit === "ELIGIBLE" && canonical.length > 0,
        allowedUses,
        prohibitedUses: (Object.keys(USES_BY_CLASS) as AudiencePainClass[])
          .flatMap((kind) => USES_BY_CLASS[kind])
          .filter((use, position, all) => all.indexOf(use) === position && !allowedUses.includes(use)),
        evidenceUids: uniqueEvidenceUids,
        sourceSignalIds: uniqueSourceSignals,
        sourceTypes,
        evidenceStrength,
        citationCount,
        uniqueEvidenceCount,
        uniqueSourceCount,
        uniqueCompetitorCount,
        occurrenceCount,
        evidenceSummaries: Array.isArray(raw?.evidenceSummaries) ? raw.evidenceSummaries : undefined,
        rootCauseIds,
        segmentIds: segList,
        strategicRole,
        classifierVersion,
        classificationReason,
        lineage,
      };
    };

    if (segmentIds.length > 1) {
      return segmentIds.map((segId, i) => makeRecordForSegment(segId, `seg${i}`));
    }
    return [makeRecordForSegment(segmentIds[0] || null)];
  });
  
  // Sort primarily by upstream rank (or appearance order) and reassign a strict sequential rank
  result.sort((a, b) => a.rank - b.rank);
  return result.map((r, i) => ({ ...r, rank: i + 1 }));
}

export function selectPainForUse(pains: any[], use: PainUse): AuthoritativeAudiencePain {
  const registry = (pains || []) as AuthoritativeAudiencePain[];
  const pain = registry.find((pain) => Array.isArray(pain.allowedUses) && pain.allowedUses.includes(use) && pain.classification !== "UNKNOWN" && (pain.classification as any) !== "EXCLUDE");
  if (!pain) {
    throw new Error(`NO_ELIGIBLE_PAIN: No authoritative pain found for use '${use}'`);
  }
  return pain;
}

export function selectPainsForUse(pains: any[], use: PainUse): AuthoritativeAudiencePain[] {
  const registry = (pains || []) as AuthoritativeAudiencePain[];
  return registry.filter((pain) => Array.isArray(pain.allowedUses) && pain.allowedUses.includes(use) && pain.classification !== "UNKNOWN" && (pain.classification as any) !== "EXCLUDE");
}

/**
 * Attach `selectedPainRoles` to an engine result OUTSIDE the engine entry
 * wrapper. The five pain-routing engines (positioning, differentiation,
 * mechanism, funnel, persuasion) attach roles via their entry wrappers, but
 * orchestrator snapshot-REUSE branches assign `reused.hydrated` directly and
 * skip those wrappers — without this, reuse runs would silently drop pain
 * routing from plan_json.audiencePainRoles. Selection is deterministic given
 * the registry, so re-deriving here yields the same roles a fresh run would.
 * Mirrors each wrapper's role structure exactly; keep them in lockstep.
 */
export function attachSelectedPainRoles(
  engine: "positioning" | "differentiation" | "mechanism" | "funnel" | "persuasion",
  result: any,
  painRegistry: any[] | undefined,
): void {
  if (!result || !Array.isArray(painRegistry) || painRegistry.length === 0) return;
  switch (engine) {
    case "positioning": {
      const corePain = selectPainForUse(painRegistry, "positioning");
      result.selectedPainRoles = {
        core: corePain
          ? { painId: corePain.painId, canonical: corePain.canonical, rank: corePain.rank, role: "purchase_motivation" as const, classification: corePain.classification }
          : null,
      };
      break;
    }
    case "differentiation": {
      const corePain = selectPainForUse(painRegistry, "differentiation");
      result.selectedPainRoles = {
        core: corePain
          ? { painId: corePain.painId, canonical: corePain.canonical, rank: corePain.rank, role: "core_differentiation" as const, classification: corePain.classification }
          : null,
      };
      break;
    }
    case "mechanism": {
      const corePain = selectPainForUse(painRegistry, "mechanism");
      result.selectedPainRoles = {
        core: corePain
          ? {
              painId: corePain.painId,
              canonical: corePain.canonical,
              rank: corePain.rank,
              role: "mechanism_root_cause" as const,
              classification: corePain.classification,
              rootCauseIds: corePain.rootCauseIds || [],
            }
          : null,
      };
      break;
    }
    case "funnel": {
      const funnelEligible = selectPainsForUse(painRegistry, "funnel");
      const objections = funnelEligible.filter((pain) => pain.classification === "OBJECTION");
      const primary = objections[0] ?? funnelEligible[0] ?? null;
      result.selectedPainRoles = {
        primary: primary
          ? { painId: primary.painId, canonical: primary.canonical, rank: primary.rank, role: "conversion_barrier" as const, classification: primary.classification }
          : null,
        objections: objections.map((pain) => ({
          painId: pain.painId, canonical: pain.canonical, rank: pain.rank, role: "conversion_barrier" as const, classification: pain.classification,
        })),
      };
      break;
    }
    case "persuasion": {
      const persuasionEligible = selectPainsForUse(painRegistry, "persuasion");
      const motivations = persuasionEligible.filter((pain) => pain.classification === "CORE_PURCHASE");
      const objections = persuasionEligible.filter((pain) => pain.classification === "OBJECTION");
      result.selectedPainRoles = {
        motivations: motivations.map((pain) => ({
          painId: pain.painId, canonical: pain.canonical, rank: pain.rank, role: "purchase_motivation" as const, classification: pain.classification,
        })),
        objections: objections.map((pain) => ({
          painId: pain.painId, canonical: pain.canonical, rank: pain.rank, role: "pre_purchase_objection" as const, classification: pain.classification,
        })),
      };
      break;
    }
  }
}

export function validateAudiencePainRegistry(
  pains: any,
  expected: { accountId: string; audienceSnapshotId: string },
): PainRegistryValidation {
  const issues: string[] = [];
  if (!Array.isArray(pains) || pains.length === 0) return { valid: false, issues: ["PAIN_REGISTRY_MISSING"] };
  const ids = new Set<string>();
  for (const pain of pains as AuthoritativeAudiencePain[]) {
    if (!pain?.painId || !pain?.canonical) issues.push("PAIN_ID_OR_TEXT_MISSING");
    if (ids.has(pain?.painId)) issues.push(`PAIN_ID_DUPLICATE:${pain.painId}`);
    ids.add(pain?.painId);
    if (pain?.lineage?.accountId !== expected.accountId || pain?.lineage?.audienceSnapshotId !== expected.audienceSnapshotId) {
      issues.push(`PAIN_LINEAGE_MISMATCH:${pain?.painId ?? "unknown"}`);
    }
    if (pain?.eligible && (!Array.isArray(pain?.allowedUses) || pain.allowedUses.length === 0)) {
      issues.push(`PAIN_ALLOWED_USES_MISSING:${pain.painId}`);
    }
    if (pain?.classification === "POST_PURCHASE_FRICTION" && pain.allowedUses.includes("offer_core")) {
      issues.push(`POST_PURCHASE_CORE_FORBIDDEN:${pain.painId}`);
    }
    if (pain?.classification === "POST_PURCHASE_FRICTION" && pain.allowedUses.includes("positioning")) {
      issues.push(`POST_PURCHASE_POSITIONING_FORBIDDEN:${pain.painId}`);
    }
    if (pain?.eligible && pain.productFit !== "ELIGIBLE") issues.push(`PRODUCT_FIT_MISMATCH:${pain.painId}`);
  }
  return { valid: issues.length === 0, issues };
}

export function buildMarketPainPortfolio(
  pains: AuthoritativeAudiencePain[],
  context: { campaignId: string; accountId: string; audienceSnapshotId: string }
): MarketPainPortfolio {
  return {
    campaignId: context.campaignId,
    accountId: context.accountId,
    audienceSnapshotId: context.audienceSnapshotId,
    pains: [...pains],
  };
}

export function splitMarketPainPortfolio(
  portfolio: MarketPainPortfolio | AuthoritativeAudiencePain[],
  context?: { campaignId: string; accountId: string; audienceSnapshotId: string }
): PainPortfolioViews {
  const pains: AuthoritativeAudiencePain[] = Array.isArray(portfolio) ? portfolio : portfolio.pains;
  const ctx = Array.isArray(portfolio)
    ? (context || {
        campaignId: pains[0]?.lineage?.accountId || "",
        accountId: pains[0]?.lineage?.accountId || "",
        audienceSnapshotId: pains[0]?.lineage?.audienceSnapshotId || "",
      })
    : {
        campaignId: portfolio.campaignId,
        accountId: portfolio.accountId,
        audienceSnapshotId: portfolio.audienceSnapshotId,
      };

  const productAligned = pains.filter((p) => p.fitType === "DIRECT_FIT" || p.fitType === "STRATEGIC_FIT" || (!p.fitType && p.productFit === "ELIGIBLE"));
  const generalMarket = pains.filter((p) => p.fitType === "NOT_FIT" || p.fitType === "UNKNOWN" || (!p.fitType && p.productFit !== "ELIGIBLE"));

  let directFit = 0;
  let strategicFit = 0;
  let notFit = 0;
  let unknown = 0;

  for (const p of pains) {
    if (p.fitType === "DIRECT_FIT") directFit++;
    else if (p.fitType === "STRATEGIC_FIT") strategicFit++;
    else if (p.fitType === "NOT_FIT") notFit++;
    else if (p.fitType === "UNKNOWN") unknown++;
    else {
      if (p.productFit === "ELIGIBLE") directFit++;
      else if (p.productFit === "INELIGIBLE") notFit++;
      else unknown++;
    }
  }

  return {
    marketPortfolio: {
      campaignId: ctx.campaignId,
      accountId: ctx.accountId,
      audienceSnapshotId: ctx.audienceSnapshotId,
      pains,
    },
    productAligned,
    generalMarket,
    reconciliation: {
      total: pains.length,
      directFit,
      strategicFit,
      notFit,
      unknown,
      sumMatchesTotal: directFit + strategicFit + notFit + unknown === pains.length,
    },
  };
}

/**
 * Attaches frozen Target Coverage authority to the audience pain registry.
 * Strictly consumes previously evaluated Target Coverage matches — does NOT
 * recompute, infer, or guess target relevance from role enums or keywords.
 */
export function attachTargetCoverageToPainRegistry(
  registry: AuthoritativeAudiencePain[],
  targetCoverage: {
    status: "FULL" | "PARTIAL" | "GAP" | "NOT_EVALUATED";
    matches?: Array<{
      coverageDecision?: "COVERED" | "RELATED_BUT_UNPROVEN" | "NOT_COVERED";
      isCovered?: boolean;
      matchedSegmentNames?: string[];
    }>;
  },
  audienceSegments?: Array<{ name: string; id?: string }>
): AuthoritativeAudiencePain[] {
  if (targetCoverage.status === "GAP") {
    return registry.map((p) => ({ ...p, targetCovered: false }));
  }
  if (targetCoverage.status === "NOT_EVALUATED") {
    return registry.map((p) => ({ ...p, targetCovered: undefined }));
  }

  const coverageMap = new Map<string, {cov: boolean | undefined, dec: "COVERED" | "RELATED_BUT_UNPROVEN" | "NOT_COVERED"}>();
  (targetCoverage.matches || []).forEach(m => {
    const isCov = m.coverageDecision === 'COVERED' ? true : m.coverageDecision === 'RELATED_BUT_UNPROVEN' ? undefined : m.isCovered === true ? true : false;
    const dec = m.coverageDecision || (m.isCovered ? "COVERED" : "NOT_COVERED");
    (m.matchedSegmentNames || []).forEach(n => {
       const key = String(n).trim().toLowerCase();
       const existing = coverageMap.get(key);
       if (isCov === true) coverageMap.set(key, {cov: true, dec});
       else if (isCov === undefined && (!existing || existing.cov !== true)) coverageMap.set(key, {cov: undefined, dec});
       else if (isCov === false && !existing) coverageMap.set(key, {cov: false, dec});
    });
  });

  const segmentIdToName = new Map<string, string>();
  if (Array.isArray(audienceSegments)) {
    audienceSegments.forEach((seg) => {
      if (seg?.name) {
        const cleanName = String(seg.name).trim();
        const lowerName = cleanName.toLowerCase();
        const derivedId = `seg_${crypto.createHash("sha256").update(lowerName).digest("hex").slice(0, 16)}`;
        segmentIdToName.set(derivedId, cleanName);
        segmentIdToName.set(lowerName, cleanName);
        if (seg.id) {
          segmentIdToName.set(seg.id, cleanName);
        }
      }
    });
  }

  return registry.map((pain) => {
    let isCovered: boolean | undefined = false;
    let coverageDec: "COVERED" | "RELATED_BUT_UNPROVEN" | "NOT_COVERED" | undefined = undefined;
    const segNamesToCheck = [...(pain.segmentIds || []), pain.segmentName].filter(Boolean);
    for (const segId of segNamesToCheck) {
      const segName = segmentIdToName.get(segId) || segmentIdToName.get(String(segId).trim().toLowerCase()) || String(segId);
      const key = segName.trim().toLowerCase();
      if (coverageMap.has(key)) {
         const val = coverageMap.get(key)!;
         if (val.cov === true) { isCovered = true; coverageDec = val.dec; break; }
         if (val.cov === undefined) { isCovered = undefined; coverageDec = val.dec; }
         if (val.cov === false && isCovered !== true && isCovered !== undefined) { isCovered = false; coverageDec = val.dec; }
      }
    }

    return {
      ...pain,
      targetCovered: isCovered,
      coverageDecision: coverageDec,
      targetCoverageAuthorityId: randomUUID(),
    };
  });
}

