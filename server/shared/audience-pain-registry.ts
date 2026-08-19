import crypto from "crypto";

export type AudiencePainClass =
  | "CORE_PURCHASE"
  | "OBJECTION"
  | "POST_PURCHASE_FRICTION"
  | "SUPPORTING";

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
  /** Whether the associated role is covered by Target Authority */
  targetCovered?: boolean;
  eligible: boolean;
  allowedUses: PainUse[];
  prohibitedUses: PainUse[];
  evidenceUids: string[];
  sourceSignalIds: string[];
  /** Source channel/type labels carried from the Audience signal (e.g. review, comment). */
  sourceTypes: string[];
  /** 0..1 deterministic evidence-volume score. Records support; never gates eligibility by itself. */
  evidenceStrength: number;
  /** AEL root-cause identifiers behind this pain, where the Audience engine supplied them. */
  rootCauseIds: string[];
  /** Dynamic target audience segments associated with this pain. */
  segmentIds: string[];
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
    : String(pain?.canonical ?? pain?.pain ?? pain?.text ?? pain?.label ?? pain?.name ?? "").trim();
}

function normalizeStatement(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stableId(snapshotId: string, text: string): string {
  const normalized = normalizeStatement(text);
  return `pain_${crypto.createHash("sha256").update(`${snapshotId}:${normalized}`).digest("hex").slice(0, 16)}`;
}

/** Evidence-only semantic classifier with an auditable reason. It only
 * classifies the supplied Audience wording; it never creates or combines
 * pain statements. */
export function classifyAudiencePainDetailed(text: string): { classification: AudiencePainClass; reason: string } {
  const value = text.toLowerCase();
  const postPurchase = value.match(/\b(refund|refunds|return|returns|cancel|cancels|canceled|cancelled|canceling|cancelling|cancellation|cancellations|churn|onboard|onboarding|support|access|delivery|shipping|bug|bugs|billing|unauthorized)\b/);
  if (postPurchase) {
    return { classification: "POST_PURCHASE_FRICTION", reason: `post-purchase keyword "${postPurchase[0]}" in supplied wording` };
  }
  const objection = value.match(/\b(price|pricing|cost|afford|risk|trust|proof|skeptic|objection|time|complex)\b/);
  if (objection) {
    return { classification: "OBJECTION", reason: `pre-purchase objection keyword "${objection[0]}" in supplied wording` };
  }
  const core = value.match(/\b(cannot|can't|struggle|lack|need|want|slow|inefficient|inconsistent|poor|problem)\b/);
  if (core) {
    return { classification: "CORE_PURCHASE", reason: `unmet-outcome keyword "${core[0]}" in supplied wording` };
  }
  return { classification: "SUPPORTING", reason: "no purchase/objection/post-purchase markers in supplied wording" };
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
    const evidenceUids = values(raw?.evidenceUids ?? raw?.evidence ?? raw?.groundingRefs);
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
      if (Array.isArray(segments) && segments.length > 0) {
        segmentIds.push("UNMATCHED");
      }
    }
    const strategicRole = typeof raw?.strategicRole === "string" ? raw.strategicRole : undefined;
    const evidenceStrength = Number.isFinite(raw?.evidenceStrength)
      ? Math.max(0, Math.min(1, raw.evidenceStrength))
      : Math.min(1, (evidenceUids.length + sourceSignalIds.length) / 4);

    const allowedUses = Array.isArray(raw?.allowedUses)
      ? raw.allowedUses.filter((use: unknown): use is PainUse => typeof use === "string" && (USES_BY_CLASS[classification] as string[]).includes(use))
      : USES_BY_CLASS[classification];

    const makeRecordForSegment = (targetSegmentId: string | null, suffixId?: string) => {
      const segList = targetSegmentId ? [targetSegmentId] : segmentIds;
      let defaultFit: "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN" = "ELIGIBLE";
      if (segList.includes("UNMATCHED")) {
        defaultFit = "UNKNOWN";
      }

      const productFit = raw?.productFit === "INELIGIBLE" || raw?.productFit === "UNKNOWN"
        ? raw.productFit
        : (segList.includes("UNMATCHED")
            ? "UNKNOWN"
            : (raw?.productFit === "ELIGIBLE" ? "ELIGIBLE" : defaultFit));

      const pid = suffixId 
        ? `${typeof raw?.painId === "string" ? raw.painId : stableId(lineage.audienceSnapshotId, canonical)}_${suffixId}`
        : (typeof raw?.painId === "string" ? raw.painId : stableId(lineage.audienceSnapshotId, canonical));

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
        eligible: raw?.eligible === false ? false : productFit === "ELIGIBLE" && canonical.length > 0,
        allowedUses,
        prohibitedUses: (Object.keys(USES_BY_CLASS) as AudiencePainClass[])
          .flatMap((kind) => USES_BY_CLASS[kind])
          .filter((use, position, all) => all.indexOf(use) === position && !allowedUses.includes(use)),
        evidenceUids,
        sourceSignalIds,
        sourceTypes,
        evidenceStrength,
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
  const registry = pains as AuthoritativeAudiencePain[];
  const pain = registry.find((pain) => pain.eligible && pain.allowedUses.includes(use));
  if (!pain) {
    throw new Error(`NO_ELIGIBLE_PAIN: No authoritative pain found for use '${use}'`);
  }
  return pain;
}

export function selectPainsForUse(pains: any[], use: PainUse): AuthoritativeAudiencePain[] {
  const registry = pains as AuthoritativeAudiencePain[];
  return registry.filter((pain) => pain?.eligible && Array.isArray(pain.allowedUses) && pain.allowedUses.includes(use));
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
    if (!Array.isArray(pain?.allowedUses) || pain.allowedUses.length === 0) issues.push(`PAIN_ALLOWED_USES_MISSING:${pain.painId}`);
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
      isCovered: boolean;
      matchedSegmentNames?: string[];
    }>;
  },
  audienceSegments?: Array<{ name: string; id?: string }>
): AuthoritativeAudiencePain[] {
  if (targetCoverage.status === "GAP" || targetCoverage.status === "NOT_EVALUATED") {
    return registry.map((p) => ({ ...p, targetCovered: false }));
  }

  const coveredSegmentNames = new Set(
    (targetCoverage.matches || [])
      .filter((m) => m.isCovered)
      .flatMap((m) => m.matchedSegmentNames || [])
  );

  return registry.map((pain) => {
    const isCovered = pain.segmentIds.some((segId) => {
      if (coveredSegmentNames.has(segId)) return true;
      const seg = audienceSegments?.find((s) => s.id === segId || s.name === segId);
      return seg ? coveredSegmentNames.has(seg.name) : false;
    });

    return {
      ...pain,
      targetCovered: isCovered,
    };
  });
}

