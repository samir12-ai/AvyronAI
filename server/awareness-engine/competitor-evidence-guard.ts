import crypto from "crypto";
import { and, desc, eq, lte } from "drizzle-orm";
import { db } from "../db";
import { competitorUnderstandingSnapshots, ciCompetitors } from "@shared/schema";

export type CounterexampleCapabilityType =
  | "PREVIEW_SAMPLE"
  | "FREE_GENERATION_TRIAL"
  | "PAYMENT_TIMING_AFTER_PREVIEW"
  | "CONDITIONAL_DELIVERY_OR_GIFT_PAYMENT"
  | "MULTI_ASSET_DELIVERABLES";

export interface CompetitorCounterexampleRecord {
  competitorId: string;
  competitorName: string;
  sourceId: string;
  capabilityTypes: CounterexampleCapabilityType[];
  observedPricingAndTrial: string;
  observedDeliverables: string[];
  evidenceSnippet: string;
  createdAt?: string | null;
}

export interface VerifiedProductFactRecord {
  factId: string;
  statement: string;
  mechanismType:
    | "PREVIEW_SAMPLE"
    | "FREE_GENERATION_TRIAL"
    | "PAYMENT_TIMING_AFTER_PREVIEW"
    | "CONDITIONAL_DELIVERY_OR_GIFT_PAYMENT"
    | "SATISFACTION_OR_REFUND_POLICY"
    | "MULTI_ASSET_DELIVERABLES"
    | "GENERAL_CAPABILITY";
}

export interface AttributedCustomerExperienceRecord {
  signalId: string;
  statement: string;
  attributionScope: "COMPETITOR_SPECIFIC" | "UNATTRIBUTED_MARKET_VOICE" | "BUYER_OBJECTION";
  attributedCompetitors: string[];
}

export interface StrategicInterpretationRecord {
  sourceEngine: "differentiation" | "positioning" | "offer";
  outcomeType: string;
  epistemicStatus: string;
  statement: string;
  validationNeed: string | null;
}

export interface AuthoritativeCompetitorEvidenceContext {
  evidenceVersionHash: string;
  miSnapshotId: string | null;
  miSnapshotCreatedAt: string | null;
  differentiationSnapshotId: string | null;
  positioningSnapshotId: string | null;
  comparisonStatus: "COMPARISON_COMPLETED" | "INSUFFICIENT_EVIDENCE" | "NO_COMPETITORS_MONITORED";
  monitoredCompetitorCount: number;
  comparedCompetitorCount: number;
  verifiedProductFacts: VerifiedProductFactRecord[];
  attributedCustomerExperiences: AttributedCustomerExperienceRecord[];
  observedCompetitorCapabilities: CompetitorCounterexampleRecord[];
  previewOrTrialCounterexamples: CompetitorCounterexampleRecord[];
  multiAssetCounterexamples: CompetitorCounterexampleRecord[];
  strategicInterpretations: StrategicInterpretationRecord[];
  coverageUncertainty: {
    hasPartialOrMissingCompetitorEvidence: boolean;
    unknownDimensions: string[];
    scopeNotes: string[];
  };
  promptBlock: string;
}

export type AwarenessClaimViolationCode =
  | "CONTRADICTED_UNIVERSAL_MARKET_CLAIM"
  | "CONTRADICTED_UPFRONT_PAYMENT_OR_BLIND_PURCHASE_CLAIM"
  | "CONTRADICTED_ISOLATED_DELIVERABLE_CLAIM"
  | "CONFLATED_PREVIEW_FREE_GENERATION_OR_PAYMENT_TIMING"
  | "MISSING_EVIDENCE_CONVERTED_TO_UNIVERSAL_NEGATIVE"
  | "UNVERIFIED_COMPETITOR_INTERNAL_WORKFLOW_CLAIM";

export interface AwarenessClaimViolation {
  code: AwarenessClaimViolationCode;
  field: string;
  excerpt: string;
  reason: string;
  counterexampleCompetitors: string[];
  counterexampleSourceIds: string[];
}

export interface AwarenessClaimEvaluationResult {
  passed: boolean;
  evidenceVersionHash: string;
  violations: AwarenessClaimViolation[];
  judgeFeedbackBlock: string;
}

function classifyProductFactMechanism(text: string): VerifiedProductFactRecord["mechanismType"] {
  const lower = text.toLowerCase();
  if (/\b(?:pay\s+only\s+when\s+satisfied|money[-\s]?back\s+guarantee|100%\s+satisfaction\s+guarantee|full\s+refund)\b/i.test(lower)) {
    return "SATISFACTION_OR_REFUND_POLICY";
  }
  if (/\b(?:pay\s+(?:only\s+)?when\s+(?:gifting|obtaining|downloading|unlocking)|payment\s+required\s+to\s+obtain|pay\s+to\s+unlock\s+final|when\s+gifting\s+or\s+obtaining)\b/i.test(lower)) {
    return "CONDITIONAL_DELIVERY_OR_GIFT_PAYMENT";
  }
  if (/\b(?:free\s+trial(?:\s+song)?(?:\s+generation|\s+creation)?|create\s+a\s+free\s+trial|generate\s+.*\s+for\s+free|free\s+draft\s+generation)\b/i.test(lower)) {
    return "FREE_GENERATION_TRIAL";
  }
  if (/\b(?:pay\s+after\s+preview|listen\s+before\s+you\s+pay|hear\s+.*\s+before\s+paying|preview\s+before\s+purchase)\b/i.test(lower)) {
    return "PAYMENT_TIMING_AFTER_PREVIEW";
  }
  if (/\b(?:free\s+preview|audio\s+preview|sample\s+clip|preview\s+snippet)\b/i.test(lower)) {
    return "PREVIEW_SAMPLE";
  }
  if (/\b(?:video|slideshow|plaque|artwork|cover\s+art|lyric\s+sheet|printable|multi[-\s]?format|digital\s+card)\b/i.test(lower)) {
    return "MULTI_ASSET_DELIVERABLES";
  }
  return "GENERAL_CAPABILITY";
}

function classifyCompetitorCapabilityTypes(
  pricingAndTrialText: string,
  deliverablesText: string,
  fullText: string,
): CounterexampleCapabilityType[] {
  const types = new Set<CounterexampleCapabilityType>();
  const combined = `${pricingAndTrialText} ${fullText}`.toLowerCase();
  const delivLower = `${deliverablesText} ${fullText}`.toLowerCase();

  if (/\b(?:free\s+trial|trial\s+song|create\s+(?:your\s+)?(?:song\s+)?for\s+free|free\s+(?:song\s+)?generation|free\s+to\s+start|free\s+tier|generate\s+for\s+free)\b/i.test(combined)) {
    types.add("FREE_GENERATION_TRIAL");
  }
  if (/\b(?:free\s+preview|preview\s+before|listen\s+before|hear\s+(?:your\s+song\s+)?before|sample\s+preview|audio\s+preview|preview\s+clip)\b/i.test(combined)) {
    types.add("PREVIEW_SAMPLE");
  }
  if (/\b(?:pay\s+after\s+preview|pay[-\s]after[-\s]preview|only\s+pay\s+if\s+you\s+love|only\s+pay\s+after|pay\s+to\s+unlock|pay\s+when\s+ready|before\s+you\s+pay|before\s+paying|before\s+purchase)\b/i.test(combined)) {
    types.add("PAYMENT_TIMING_AFTER_PREVIEW");
  }
  if (/\b(?:pay\s+when\s+gifting|pay\s+for\s+final\s+download|unlock\s+full\s+song|conditional\s+delivery)\b/i.test(combined)) {
    types.add("CONDITIONAL_DELIVERY_OR_GIFT_PAYMENT");
  }
  if (/\b(?:video|lyric\s+video|slideshow|photo\s+montage|plaque|acrylic|artwork|cover\s+art|printable|sheet\s+music|qr\s+code|keepsake\s+bundle|streaming\s+distribution|spotify)\b/i.test(delivLower)) {
    types.add("MULTI_ASSET_DELIVERABLES");
  }
  return Array.from(types);
}

function safeJsonParse<T>(val: unknown, fallback: T): T {
  if (val === null || val === undefined) return fallback;
  if (typeof val === "object") return val as T;
  if (typeof val !== "string") return fallback;
  try {
    return JSON.parse(val) as T;
  } catch {
    return fallback;
  }
}

export interface BuildAuthoritativeCompetitorEvidenceArgs {
  campaignId?: string | null;
  accountId?: string | null;
  mi?: any;
  audience?: any;
  positioning?: any;
  differentiation?: any;
  offer?: any;
  productTruthFacts?: string[];
  doctrineBlock?: string | null;
  cuSnapshotsOverride?: any[];
}

export async function buildAuthoritativeCompetitorEvidenceContext(
  args: BuildAuthoritativeCompetitorEvidenceArgs,
): Promise<AuthoritativeCompetitorEvidenceContext> {
  const {
    campaignId,
    accountId,
    mi,
    audience,
    positioning,
    differentiation,
    offer,
    productTruthFacts = [],
    doctrineBlock,
    cuSnapshotsOverride,
  } = args;

  const miSnapshotId: string | null =
    (mi as any)?.id || (mi as any)?.snapshotId || (mi as any)?.miSnapshotId || null;
  const miSnapshotCreatedAt: string | null =
    (mi as any)?.createdAt
      ? new Date((mi as any).createdAt).toISOString()
      : null;
  const differentiationSnapshotId: string | null =
    (differentiation as any)?.id || (differentiation as any)?.snapshotId || null;
  const positioningSnapshotId: string | null =
    (positioning as any)?.id || (positioning as any)?.snapshotId || null;

  // 1. Verified Product Facts (our product only)
  const verifiedProductFacts: VerifiedProductFactRecord[] = [];
  const seenProductFactText = new Set<string>();
  const addProductFact = (rawText: string, prefix = "PF") => {
    const clean = String(rawText || "").trim();
    if (!clean || clean.length < 5) return;
    const key = clean.toLowerCase();
    if (seenProductFactText.has(key)) return;
    seenProductFactText.add(key);
    verifiedProductFacts.push({
      factId: `${prefix}-${verifiedProductFacts.length + 1}`,
      statement: clean,
      mechanismType: classifyProductFactMechanism(clean),
    });
  };

  for (const f of productTruthFacts) {
    addProductFact(f, "PF");
  }
  if (offer) {
    if (typeof offer.coreOutcome === "string") addProductFact(offer.coreOutcome, "OF");
    if (typeof offer.mechanismDescription === "string") addProductFact(offer.mechanismDescription, "OF");
    if (Array.isArray(offer.deliverables)) {
      for (const d of offer.deliverables) {
        addProductFact(typeof d === "string" ? d : d?.name || d?.description || "", "OD");
      }
    }
  }
  if (doctrineBlock) {
    const lines = doctrineBlock
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.startsWith("- ") || l.startsWith("* ") || /^\d+\./.test(l));
    for (const line of lines.slice(0, 8)) {
      addProductFact(line.replace(/^[-*]\s+|\d+\.\s+/, ""), "DOC");
    }
  }

  // 2. Attributed Customer Experiences (from audience pains and objections)
  const attributedCustomerExperiences: AttributedCustomerExperienceRecord[] = [];
  const rawPains = Array.isArray(audience?.audiencePains) ? audience.audiencePains : [];
  for (let i = 0; i < Math.min(rawPains.length, 10); i++) {
    const p = rawPains[i];
    const text =
      typeof p === "string"
        ? p
        : p?.painStatement || p?.statement || p?.label || p?.canonical || p?.description || "";
    if (!text) continue;
    const signalId = p?.id || p?.painId || p?.signalId || `PAIN-${i + 1}`;
    const attributedCompetitors: string[] = Array.isArray(p?.competitorNames)
      ? p.competitorNames
      : Array.isArray(p?.attributedCompetitors)
      ? p.attributedCompetitors
      : [];
    const scope: AttributedCustomerExperienceRecord["attributionScope"] =
      attributedCompetitors.length > 0 || p?.scope === "COMPETITOR_SPECIFIC"
        ? "COMPETITOR_SPECIFIC"
        : "UNATTRIBUTED_MARKET_VOICE";
    attributedCustomerExperiences.push({
      signalId: String(signalId),
      statement: String(text).trim(),
      attributionScope: scope,
      attributedCompetitors,
    });
  }

  const rawObjections = audience?.objectionMap
    ? Array.isArray(audience.objectionMap)
      ? audience.objectionMap
      : Object.values(audience.objectionMap)
    : [];
  for (let i = 0; i < Math.min(rawObjections.length, 8); i++) {
    const o = rawObjections[i];
    const text =
      typeof o === "string"
        ? o
        : o?.objection || o?.statement || o?.description || o?.label || "";
    if (!text) continue;
    attributedCustomerExperiences.push({
      signalId: o?.id || o?.objectionId || `OBJ-${i + 1}`,
      statement: String(text).trim(),
      attributionScope: "BUYER_OBJECTION",
      attributedCompetitors: [],
    });
  }

  // 3. Observed Competitor Capabilities & Counterexamples
  const counterexampleMap = new Map<string, CompetitorCounterexampleRecord>();
  const upsertCompetitorRecord = (rec: CompetitorCounterexampleRecord) => {
    const key = (rec.competitorName || rec.competitorId).trim().toLowerCase();
    if (!key) return;
    const existing = counterexampleMap.get(key);
    if (!existing) {
      counterexampleMap.set(key, {
        ...rec,
        capabilityTypes: Array.from(new Set(rec.capabilityTypes)),
        observedDeliverables: Array.from(new Set(rec.observedDeliverables.filter(Boolean))),
      });
      return;
    }
    const mergedTypes = Array.from(new Set([...existing.capabilityTypes, ...rec.capabilityTypes]));
    const mergedDeliv = Array.from(new Set([...existing.observedDeliverables, ...rec.observedDeliverables].filter(Boolean)));
    counterexampleMap.set(key, {
      competitorId: existing.competitorId !== "unknown" ? existing.competitorId : rec.competitorId,
      competitorName: existing.competitorName || rec.competitorName,
      sourceId: existing.sourceId !== "unknown" ? existing.sourceId : rec.sourceId,
      capabilityTypes: mergedTypes,
      observedPricingAndTrial:
        existing.observedPricingAndTrial.length >= rec.observedPricingAndTrial.length
          ? existing.observedPricingAndTrial
          : rec.observedPricingAndTrial,
      observedDeliverables: mergedDeliv,
      evidenceSnippet:
        existing.evidenceSnippet.length >= rec.evidenceSnippet.length
          ? existing.evidenceSnippet
          : rec.evidenceSnippet,
      createdAt: existing.createdAt || rec.createdAt || null,
    });
  };

  // 3a. Extract from positioning primaryTerritory.semanticCollision if already populated
  const primaryTerritory =
    Array.isArray(positioning?.territories) && positioning.territories.length > 0
      ? positioning.territories[0]
      : positioning?.territory
      ? safeJsonParse(positioning.territory, null)
      : null;
  const sc = primaryTerritory?.semanticCollision || (positioning as any)?.semanticCollision || null;

  if (sc) {
    if (Array.isArray(sc.competitorProfiles)) {
      for (const prof of sc.competitorProfiles) {
        const cName = prof.competitorName || prof.name || "";
        if (!cName) continue;
        const pricingText = prof.pricingAndTrialModel || prof.pricingModel || "";
        const delivList = Array.isArray(prof.deliverablesAndFormats)
          ? prof.deliverablesAndFormats
          : typeof prof.deliverablesAndFormats === "string"
          ? [prof.deliverablesAndFormats]
          : [];
        const snippet = prof.corePromise || prof.evidenceSnippet || pricingText || delivList.join(", ");
        const capTypes = classifyCompetitorCapabilityTypes(pricingText, delivList.join(", "), snippet);
        if (prof.offersPreviewOrTrial && !capTypes.includes("PREVIEW_SAMPLE") && !capTypes.includes("FREE_GENERATION_TRIAL")) {
          capTypes.push("PREVIEW_SAMPLE");
        }
        if (prof.offersMultiFormatDeliverables && !capTypes.includes("MULTI_ASSET_DELIVERABLES")) {
          capTypes.push("MULTI_ASSET_DELIVERABLES");
        }
        upsertCompetitorRecord({
          competitorId: prof.competitorId || `comp_${cName.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
          competitorName: cName,
          sourceId: prof.sourceSnapshotId || prof.sourceId || `pos_sc_${cName.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
          capabilityTypes: capTypes,
          observedPricingAndTrial: pricingText || (prof.offersPreviewOrTrial ? "Offers free preview or trial model before purchase" : "Not specified"),
          observedDeliverables: delivList,
          evidenceSnippet: snippet,
        });
      }
    }

    if (Array.isArray(sc.previewOrTrialCounterexamples)) {
      for (const item of sc.previewOrTrialCounterexamples) {
        if (typeof item === "string") {
          const nameMatch = item.match(/^([^:(]+?)(?:\s*\(([^)]+)\))?(?:\s*:\s*(.+))?$/);
          const cName = (nameMatch?.[1] || item).trim();
          const detail = (nameMatch?.[3] || item).trim();
          const capTypes = classifyCompetitorCapabilityTypes(detail, "", detail);
          if (capTypes.length === 0) capTypes.push("PREVIEW_SAMPLE", "PAYMENT_TIMING_AFTER_PREVIEW");
          upsertCompetitorRecord({
            competitorId: `comp_${cName.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
            competitorName: cName,
            sourceId: nameMatch?.[2] || `pos_sc_preview_${cName.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
            capabilityTypes: capTypes,
            observedPricingAndTrial: detail,
            observedDeliverables: [],
            evidenceSnippet: item,
          });
        } else if (item && typeof item === "object") {
          const cName = item.competitorName || item.name || "";
          if (!cName) continue;
          const detail = item.observedPricingAndTrial || item.pricingAndTrialModel || item.detail || "Offers free preview/trial or pay-after-preview model";
          const capTypes = classifyCompetitorCapabilityTypes(detail, "", detail);
          if (capTypes.length === 0) capTypes.push("PREVIEW_SAMPLE", "PAYMENT_TIMING_AFTER_PREVIEW");
          upsertCompetitorRecord({
            competitorId: item.competitorId || `comp_${cName.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
            competitorName: cName,
            sourceId: item.sourceId || item.sourceSnapshotId || `pos_sc_preview_${cName.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
            capabilityTypes: capTypes,
            observedPricingAndTrial: detail,
            observedDeliverables: Array.isArray(item.observedDeliverables) ? item.observedDeliverables : [],
            evidenceSnippet: item.evidenceSnippet || detail,
          });
        }
      }
    }

    if (Array.isArray(sc.multiFormatDeliverableCounterexamples)) {
      for (const item of sc.multiFormatDeliverableCounterexamples) {
        if (typeof item === "string") {
          const nameMatch = item.match(/^([^:(]+?)(?:\s*\(([^)]+)\))?(?:\s*:\s*(.+))?$/);
          const cName = (nameMatch?.[1] || item).trim();
          const detail = (nameMatch?.[3] || item).trim();
          upsertCompetitorRecord({
            competitorId: `comp_${cName.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
            competitorName: cName,
            sourceId: nameMatch?.[2] || `pos_sc_deliv_${cName.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
            capabilityTypes: ["MULTI_ASSET_DELIVERABLES"],
            observedPricingAndTrial: "Not specified",
            observedDeliverables: [detail],
            evidenceSnippet: item,
          });
        } else if (item && typeof item === "object") {
          const cName = item.competitorName || item.name || "";
          if (!cName) continue;
          const deliv = Array.isArray(item.observedDeliverables)
            ? item.observedDeliverables
            : item.deliverables
            ? [String(item.deliverables)]
            : ["Multi-format deliverables"];
          upsertCompetitorRecord({
            competitorId: item.competitorId || `comp_${cName.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
            competitorName: cName,
            sourceId: item.sourceId || item.sourceSnapshotId || `pos_sc_deliv_${cName.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
            capabilityTypes: ["MULTI_ASSET_DELIVERABLES"],
            observedPricingAndTrial: item.observedPricingAndTrial || "Not specified",
            observedDeliverables: deliv,
            evidenceSnippet: item.evidenceSnippet || deliv.join(", "),
          });
        }
      }
    }
  }

  // 3b. Parse positioning rationale if it lists monitored competitor counterexamples
  const rationaleText = String(primaryTerritory?.rationale || (positioning as any)?.rationale || "");
  if (rationaleText) {
    const previewMatch = rationaleText.match(/Monitored competitors offering free preview\/trial models\s*\(\d+\):\s*([^.]+)\./i);
    if (previewMatch?.[1]) {
      const names = previewMatch[1].split(",").map(s => s.trim()).filter(Boolean);
      for (const cName of names) {
        upsertCompetitorRecord({
          competitorId: `comp_${cName.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
          competitorName: cName,
          sourceId: positioningSnapshotId ? `pos:${positioningSnapshotId}` : "pos_rationale",
          capabilityTypes: ["PREVIEW_SAMPLE", "FREE_GENERATION_TRIAL", "PAYMENT_TIMING_AFTER_PREVIEW"],
          observedPricingAndTrial: "Monitored competitor offering free preview/trial or pay-after-preview model",
          observedDeliverables: [],
          evidenceSnippet: `Recorded in Positioning rationale: ${cName} offers free preview/trial model`,
        });
      }
    }
    const multiMatch = rationaleText.match(/Monitored competitors offering video\/visual\/multi-format deliverables\s*\(\d+\):\s*([^.]+)\./i);
    if (multiMatch?.[1]) {
      const names = multiMatch[1].split(",").map(s => s.trim()).filter(Boolean);
      for (const cName of names) {
        upsertCompetitorRecord({
          competitorId: `comp_${cName.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
          competitorName: cName,
          sourceId: positioningSnapshotId ? `pos:${positioningSnapshotId}` : "pos_rationale",
          capabilityTypes: ["MULTI_ASSET_DELIVERABLES"],
          observedPricingAndTrial: "Not specified",
          observedDeliverables: ["video/visual/multi-format deliverables"],
          evidenceSnippet: `Recorded in Positioning rationale: ${cName} offers video/visual/multi-format deliverables`,
        });
      }
    }
  }

  // 3c. Extract from MI multiSourceSignals / competitorData
  const multiSource = safeJsonParse((mi as any)?.multiSourceSignals, {}) as Record<string, any>;
  for (const [compKey, msVal] of Object.entries(multiSource || {})) {
    if (!msVal || typeof msVal !== "object") continue;
    const cName = (msVal as any).competitorName || compKey;
    const website = (msVal as any).website || {};
    const headlines = Array.isArray(website.headlineExtractions) ? website.headlineExtractions.join(" | ") : "";
    const posLang = Array.isArray(website.positioningLanguage) ? website.positioningLanguage.join(" | ") : "";
    const offers = Array.isArray(website.offerings) ? website.offerings.join(" | ") : "";
    const combined = [headlines, posLang, offers].filter(Boolean).join(" — ");
    if (!combined) continue;
    const capTypes = classifyCompetitorCapabilityTypes(combined, offers, combined);
    if (capTypes.length > 0) {
      upsertCompetitorRecord({
        competitorId: (msVal as any).competitorId || `comp_${cName.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
        competitorName: cName,
        sourceId: miSnapshotId ? `mi:${miSnapshotId}` : "mi_multi_source",
        capabilityTypes: capTypes,
        observedPricingAndTrial: combined.slice(0, 220),
        observedDeliverables: offers ? [offers.slice(0, 160)] : [],
        evidenceSnippet: combined.slice(0, 260),
      });
    }
  }

  // 3d. Query or use provided competitor_understanding_snapshots bounded to the MI snapshot timestamp
  let cuRows: any[] = Array.isArray(cuSnapshotsOverride) ? cuSnapshotsOverride : [];
  let monitoredCountFromDb = 0;
  if (!cuSnapshotsOverride && campaignId && accountId) {
    try {
      const conditions = [
        eq(competitorUnderstandingSnapshots.campaignId, campaignId),
        eq(competitorUnderstandingSnapshots.accountId, accountId),
      ];
      if (miSnapshotCreatedAt) {
        conditions.push(lte(competitorUnderstandingSnapshots.createdAt, new Date(miSnapshotCreatedAt)));
      }
      cuRows = await db
        .select()
        .from(competitorUnderstandingSnapshots)
        .where(and(...conditions))
        .orderBy(desc(competitorUnderstandingSnapshots.createdAt));

      const compRows = await db
        .select({ id: ciCompetitors.id, name: ciCompetitors.name })
        .from(ciCompetitors)
        .where(
          and(
            eq(ciCompetitors.campaignId, campaignId),
            eq(ciCompetitors.accountId, accountId),
          ),
        );
      monitoredCountFromDb = compRows.length;
    } catch {
      // Non-fatal in unit test or offline environments
    }
  }

  const seenCuCompetitor = new Set<string>();
  for (const row of cuRows) {
    const cId = row.competitorId || "";
    const profile = safeJsonParse(row.profileData || row.profile || row.data, {}) as Record<string, any>;
    const cName =
      row.competitorName ||
      profile?.competitorName ||
      profile?.companyName ||
      profile?.name ||
      cId;
    if (!cName) continue;
    const dedupKey = String(cId || cName).toLowerCase();
    if (seenCuCompetitor.has(dedupKey)) continue;
    seenCuCompetitor.add(dedupKey);

    const offerArch = profile?.offerArchitecture || profile?.offer || {};
    const prodProfile = profile?.productProfile || profile?.product || {};
    const posData = profile?.positioning || {};
    const pricingText = [
      offerArch?.pricingModel,
      offerArch?.entryOffer,
      offerArch?.riskReversal,
      offerArch?.trialOrPreview,
      prodProfile?.pricingModel,
      prodProfile?.freeTrial,
    ]
      .filter(Boolean)
      .map(x => (typeof x === "string" ? x : JSON.stringify(x)))
      .join(" | ");

    const deliverablesText = [
      prodProfile?.coreDeliverables,
      prodProfile?.keyFeatures,
      offerArch?.deliverables,
      offerArch?.bonuses,
    ]
      .filter(Boolean)
      .map(x => (Array.isArray(x) ? x.join(", ") : typeof x === "string" ? x : JSON.stringify(x)))
      .join(" | ");

    const fullSnippet = [
      posData?.corePromise,
      posData?.valueProposition,
      pricingText,
      deliverablesText,
      row.positioningSummary,
    ]
      .filter(Boolean)
      .join(" — ");

    const capTypes = classifyCompetitorCapabilityTypes(pricingText, deliverablesText, fullSnippet);
    if (capTypes.length > 0 || pricingText || deliverablesText) {
      upsertCompetitorRecord({
        competitorId: cId || `comp_${String(cName).toLowerCase().replace(/[^a-z0-9]/g, "")}`,
        competitorName: String(cName),
        sourceId: row.id ? `cu:${row.id}` : `cu_${String(cName).toLowerCase().replace(/[^a-z0-9]/g, "")}`,
        capabilityTypes: capTypes,
        observedPricingAndTrial: pricingText.slice(0, 260) || "Standard commercial checkout (no explicit preview/trial extracted)",
        observedDeliverables: deliverablesText ? [deliverablesText.slice(0, 220)] : [],
        evidenceSnippet: fullSnippet.slice(0, 320),
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      });
    }
  }

  const allCompetitorRecords = Array.from(counterexampleMap.values()).sort((a, b) =>
    a.competitorName.localeCompare(b.competitorName),
  );
  const previewOrTrialCounterexamples = allCompetitorRecords.filter(r =>
    r.capabilityTypes.some(t =>
      t === "PREVIEW_SAMPLE" ||
      t === "FREE_GENERATION_TRIAL" ||
      t === "PAYMENT_TIMING_AFTER_PREVIEW" ||
      t === "CONDITIONAL_DELIVERY_OR_GIFT_PAYMENT",
    ),
  );
  const multiAssetCounterexamples = allCompetitorRecords.filter(r =>
    r.capabilityTypes.includes("MULTI_ASSET_DELIVERABLES"),
  );

  // 4. Strategic Interpretations & Upstream Hypotheses
  const strategicInterpretations: StrategicInterpretationRecord[] = [];
  if (primaryTerritory) {
    const outcomeType =
      (primaryTerritory as any).positioningOutcomeType ||
      (sc?.semanticCollisionScore >= 0.35 ? "SHARED_CAPABILITY_STRATEGIC_EMPHASIS" : "SUPPORTED_COMPETITIVE_DISTINCTION");
    const epistemicStatus = primaryTerritory.epistemicStatus || "STRATEGIC_HYPOTHESIS";
    strategicInterpretations.push({
      sourceEngine: "positioning",
      outcomeType,
      epistemicStatus,
      statement: `${primaryTerritory.name || "Primary Territory"}: ${primaryTerritory.contrastAxis || primaryTerritory.narrativeDirection || ""}`.trim(),
      validationNeed: Array.isArray(primaryTerritory.validationNeeds) && primaryTerritory.validationNeeds.length > 0
        ? primaryTerritory.validationNeeds[0]
        : outcomeType === "SHARED_CAPABILITY_STRATEGIC_EMPHASIS"
        ? "Core category capabilities (such as story-driven creation, free previews/trials, and multi-format deliverables) overlap with monitored competitors; treat this angle as a strategic emphasis rather than exclusive category ownership."
        : null,
    });
  }
  if (differentiation && Array.isArray(differentiation.pillars)) {
    for (const p of differentiation.pillars.slice(0, 3)) {
      const pName = p?.name || p?.pillarName || p?.title || "Differentiation Pillar";
      const pClaim = p?.claim || p?.description || p?.strategicRole || "";
      if (pClaim) {
        strategicInterpretations.push({
          sourceEngine: "differentiation",
          outcomeType: p?.classification || p?.role || "STRATEGIC_EMPHASIS",
          epistemicStatus: p?.epistemicStatus || "STRATEGIC_HYPOTHESIS",
          statement: `${pName}: ${pClaim}`,
          validationNeed: null,
        });
      }
    }
  }

  const comparedCompetitorCount =
    typeof sc?.comparedCompetitorCount === "number"
      ? sc.comparedCompetitorCount
      : allCompetitorRecords.length;
  const monitoredCompetitorCount = Math.max(
    monitoredCountFromDb,
    typeof sc?.directCompetitorCount === "number"
      ? (sc.directCompetitorCount || 0) + (sc.adjacentCompetitorCount || 0) + (sc.referenceCompetitorCount || 0)
      : 0,
    comparedCompetitorCount,
  );

  const comparisonStatus: AuthoritativeCompetitorEvidenceContext["comparisonStatus"] =
    sc?.comparisonStatus === "COMPARISON_COMPLETED" || allCompetitorRecords.length > 0
      ? "COMPARISON_COMPLETED"
      : monitoredCompetitorCount > 0
      ? "INSUFFICIENT_EVIDENCE"
      : "NO_COMPETITORS_MONITORED";

  const unknownDimensions: string[] = [];
  const scopeNotes: string[] = [];
  if (comparisonStatus !== "COMPARISON_COMPLETED") {
    unknownDimensions.push("Full competitor pricing, preview/trial availability, and deliverable comparison");
    scopeNotes.push("Competitor capability coverage is incomplete or unverified; missing competitor evidence MUST remain unknown and NEVER be converted into a claim that no competitor offers a capability.");
  } else {
    unknownDimensions.push("Internal competitor production pipelines and unpublished prompt/audio engineering workflows");
    scopeNotes.push(
      `Compared ${comparedCompetitorCount} monitored competitor(s) (${previewOrTrialCounterexamples.length} with documented preview/free-trial/pay-after-preview models; ${multiAssetCounterexamples.length} with documented multi-asset/visual deliverables).`,
    );
    scopeNotes.push(
      "Missing or unmonitored competitor details remain UNKNOWN and must never be asserted as universal market absences.",
    );
  }

  const hashPayload = JSON.stringify({
    miSnapshotId,
    differentiationSnapshotId,
    positioningSnapshotId,
    comparisonStatus,
    verifiedProductFacts: verifiedProductFacts.map(f => ({ id: f.factId, m: f.mechanismType, s: f.statement })),
    previewCounterexamples: previewOrTrialCounterexamples.map(c => ({
      id: c.competitorId,
      n: c.competitorName,
      src: c.sourceId,
      t: c.capabilityTypes,
    })),
    multiAssetCounterexamples: multiAssetCounterexamples.map(c => ({
      id: c.competitorId,
      n: c.competitorName,
      src: c.sourceId,
    })),
    strategicOutcomeTypes: strategicInterpretations.map(s => `${s.sourceEngine}:${s.outcomeType}`),
  });
  const evidenceVersionHash = `aev_${crypto.createHash("sha256").update(hashPayload).digest("hex").slice(0, 16)}`;

  const promptLines: string[] = [
    `═══ AUTHORITATIVE COMPETITOR & EPISTEMIC EVIDENCE CONTRACT (version=${evidenceVersionHash}) ═══`,
    `Comparison Status: ${comparisonStatus} (monitored=${monitoredCompetitorCount}, compared=${comparedCompetitorCount})`,
    ``,
    `1. VERIFIED PRODUCT FACTS (Our Product Only — preserve exact preview vs free generation vs payment timing):`,
    ...(verifiedProductFacts.length > 0
      ? verifiedProductFacts.map(f => `   - [${f.factId} | ${f.mechanismType}] ${f.statement}`)
      : [`   - (Use upstream positioning/offer facts without inventing unverified guarantees)`]),
    ``,
    `2. ATTRIBUTED CUSTOMER EXPERIENCES (Scoped Buyer Voice — do not generalize into universal competitor laws):`,
    ...(attributedCustomerExperiences.length > 0
      ? attributedCustomerExperiences.slice(0, 8).map(
          e => `   - [${e.signalId} | ${e.attributionScope}${e.attributedCompetitors.length ? `:${e.attributedCompetitors.join(",")}` : ""}] ${e.statement}`,
        )
      : [`   - (No customer experience quotes attached)`]),
    ``,
    `3. OBSERVED COMPETITOR CAPABILITIES & COUNTEREXAMPLES (Authoritative Market Counterevidence):`,
  ];

  if (previewOrTrialCounterexamples.length > 0) {
    promptLines.push(
      `   • Competitors with documented PREVIEW / FREE TRIAL / PAY-AFTER-PREVIEW models (${previewOrTrialCounterexamples.length}):`,
    );
    for (const c of previewOrTrialCounterexamples) {
      promptLines.push(
        `     - ${c.competitorName} [id=${c.competitorId}, source=${c.sourceId}, types=${c.capabilityTypes.join("+")}]: ${c.observedPricingAndTrial}`,
      );
    }
  } else {
    promptLines.push(
      `   • Preview/Trial Competitor Counterexamples: NONE RECORDED (${comparisonStatus === "COMPARISON_COMPLETED" ? "none observed in sample, but unmonitored market remains unknown" : "competitor evidence incomplete/unknown — do NOT claim no competitor offers previews or trials"}).`,
    );
  }

  if (multiAssetCounterexamples.length > 0) {
    promptLines.push(
      `   • Competitors with documented MULTI-FORMAT / VISUAL / KEEPSAKE deliverables (${multiAssetCounterexamples.length}):`,
    );
    for (const c of multiAssetCounterexamples) {
      promptLines.push(
        `     - ${c.competitorName} [id=${c.competitorId}, source=${c.sourceId}]: ${c.observedDeliverables.join("; ") || c.evidenceSnippet}`,
      );
    }
  }

  promptLines.push(
    ``,
    `4. STRATEGIC INTERPRETATIONS & EPISTEMIC BOUNDARIES:`,
    ...(strategicInterpretations.length > 0
      ? strategicInterpretations.map(
          s => `   - [${s.sourceEngine.toUpperCase()} | ${s.outcomeType} | ${s.epistemicStatus}] ${s.statement}${s.validationNeed ? ` (Note: ${s.validationNeed})` : ""}`,
        )
      : [`   - Frame competitive positioning as a strategic emphasis grounded in verified product capabilities.`]),
    `   - Coverage & Uncertainty: ${scopeNotes.join(" ")}`,
    ``,
    `MANDATORY EVIDENCE-FIDELITY RULES FOR AWARENESS GENERATION & REVIEW:`,
    `  A. NO CONTRADICTED UNIVERSAL MARKET CLAIMS: Never assert that "every service", "all competitors", "no competitor", "only our service", or "the standard industry model" forces upfront payment before generation/preview or delivers only isolated audio tracks when Section 3 lists competitor counterexamples.`,
    `  B. PRESERVE PREVIEW vs FREE GENERATION vs PAYMENT TIMING DISTINCTIONS: Do NOT conflate hearing a preview clip, generating a free trial draft, paying when gifting/obtaining the final deliverable, and an unconditional "pay only when satisfied" guarantee. State our product's exact trial and payment trigger accurately.`,
    `  C. MISSING COMPETITOR EVIDENCE REMAINS UNKNOWN: Where competitor data is partial or unverified, never convert missing evidence into a universal negative claim ("no competitor does X").`,
    `  D. DISTINGUISH BUYER PERCEPTION FROM COMPETITOR INTERNAL WORKFLOWS: Customer complaints that songs sounded generic or formulaic are valid attributed buyer experiences, but do not assert unverified internal competitor workflows unless explicitly documented in Section 3.`,
    `══════════════════════════════════════════════════════════════════════════════════`,
  );

  return {
    evidenceVersionHash,
    miSnapshotId,
    miSnapshotCreatedAt,
    differentiationSnapshotId,
    positioningSnapshotId,
    comparisonStatus,
    monitoredCompetitorCount,
    comparedCompetitorCount,
    verifiedProductFacts,
    attributedCustomerExperiences,
    observedCompetitorCapabilities: allCompetitorRecords,
    previewOrTrialCounterexamples,
    multiAssetCounterexamples,
    strategicInterpretations,
    coverageUncertainty: {
      hasPartialOrMissingCompetitorEvidence: comparisonStatus !== "COMPARISON_COMPLETED",
      unknownDimensions,
      scopeNotes,
    },
    promptBlock: promptLines.join("\n"),
  };
}

/**
 * Evaluates an Awareness candidate (`NarrativeReframe` or `MythBreakerReasoning`)
 * against the authoritative competitor evidence context.
 */
export function evaluateAwarenessComparativeClaims(
  candidate: Record<string, any> | null | undefined,
  evidenceCtx: AuthoritativeCompetitorEvidenceContext,
): AwarenessClaimEvaluationResult {
  if (!candidate || typeof candidate !== "object") {
    return {
      passed: true,
      evidenceVersionHash: evidenceCtx.evidenceVersionHash,
      violations: [],
      judgeFeedbackBlock: "",
    };
  }

  const fieldsToInspect: Array<{ field: string; text: string }> = [];
  const collectField = (field: string, val: unknown) => {
    if (typeof val === "string" && val.trim().length > 0) {
      fieldsToInspect.push({ field, text: val.trim() });
    } else if (Array.isArray(val)) {
      val.forEach((item, idx) => {
        if (typeof item === "string" && item.trim().length > 0) {
          fieldsToInspect.push({ field: `${field}[${idx}]`, text: item.trim() });
        }
      });
    }
  };

  // NarrativeReframe fields
  if (candidate.currentModel) {
    collectField("currentModel.statement", candidate.currentModel.statement);
    collectField("currentModel.sourceOfBelief", candidate.currentModel.sourceOfBelief);
    collectField("currentModel.whyItStuckSoFar", candidate.currentModel.whyItStuckSoFar);
  }
  if (candidate.falseBridge) {
    collectField("falseBridge.obviousNextStep", candidate.falseBridge.obviousNextStep);
    collectField("falseBridge.statement", candidate.falseBridge.statement);
    collectField("falseBridge.whyItFails", candidate.falseBridge.whyItFails);
  }
  if (candidate.newModel) {
    collectField("newModel.reclassification", candidate.newModel.reclassification);
    collectField("newModel.namedPrinciple", candidate.newModel.namedPrinciple);
    collectField("newModel.whatBecomesObvious", candidate.newModel.whatBecomesObvious);
    collectField("newModel.statement", candidate.newModel.statement);
    collectField("newModel.supportingTruth", candidate.newModel.supportingTruth);
    collectField("newModel.emotionalPayoff", candidate.newModel.emotionalPayoff);
  }
  if (candidate.bridgeMechanism) {
    collectField("bridgeMechanism.specificMove", candidate.bridgeMechanism.specificMove);
    collectField("bridgeMechanism.whyBuyerCanAcceptIt", candidate.bridgeMechanism.whyBuyerCanAcceptIt);
  }
  if (candidate.discomfortCost) {
    collectField("discomfortCost.privateAdmission", candidate.discomfortCost.privateAdmission);
    collectField("discomfortCost.statusGivenUp", candidate.discomfortCost.statusGivenUp);
    collectField("discomfortCost.whyItIsWorthIt", candidate.discomfortCost.whyItIsWorthIt);
  }

  // MythBreakerReasoning fields
  collectField("mythBreakerStatement", candidate.mythBreakerStatement);
  collectField("beliefToContradict", candidate.beliefToContradict);
  collectField("rootCauseContradicted", candidate.rootCauseContradicted);
  collectField("contradictionLogic", candidate.contradictionLogic);
  collectField("evidenceForBelief", candidate.evidenceForBelief);
  collectField("reasoningSteps", candidate.reasoningSteps);

  const violations: AwarenessClaimViolation[] = [];
  const previewCompNames = evidenceCtx.previewOrTrialCounterexamples.map(c => c.competitorName);
  const previewCompSources = evidenceCtx.previewOrTrialCounterexamples.map(c => c.sourceId);
  const multiAssetCompNames = evidenceCtx.multiAssetCounterexamples.map(c => c.competitorName);
  const multiAssetCompSources = evidenceCtx.multiAssetCounterexamples.map(c => c.sourceId);

  const hasVerifiedSatisfactionGuarantee = evidenceCtx.verifiedProductFacts.some(
    f => f.mechanismType === "SATISFACTION_OR_REFUND_POLICY",
  );
  const hasConditionalDeliveryOrTrial = evidenceCtx.verifiedProductFacts.some(
    f =>
      f.mechanismType === "FREE_GENERATION_TRIAL" ||
      f.mechanismType === "CONDITIONAL_DELIVERY_OR_GIFT_PAYMENT" ||
      f.mechanismType === "PAYMENT_TIMING_AFTER_PREVIEW" ||
      f.mechanismType === "PREVIEW_SAMPLE",
  );

  for (const { field, text } of fieldsToInspect) {
    // 1. Check contradicted upfront-payment / blind-purchase universal or industry-standard claims
    const assertsUniversalOrIndustryUpfrontPayment =
      /\b(?:every\s+(?:other\s+)?(?:service|platform|provider|competitor|company|option)|all\s+(?:other\s+)?(?:services|platforms|providers|competitors|options)|no\s+(?:other\s+)?(?:service|platform|competitor)|none\s+of\s+the\s+(?:services|competitors|platforms)|the\s+standard\s+industry\s+model|industry[-\s]wide\s+model|entire\s+(?:industry|market|category)|across\s+the\s+entire\s+market|only\s+(?:service|platform|provider)\s+that)\b[^.?!]{0,140}\b(?:forces?\s+financial\s+commitment|requires?\s+(?:full\s+)?(?:upfront\s+)?payment\s+before|pay\s+upfront|upfront\s+payment\s+before\s+(?:generation|hearing|showing|listening|preview)|blind[-\s]purchase|financial\s+commitment\s+before\s+generation|without\s+a\s+free\s+(?:trial|preview)|before\s+showing\s+you\s+anything)/i.test(
        text,
      ) ||
      /\b(?:forces?\s+financial\s+commitment\s+before\s+generation|requires?\s+(?:full\s+)?payment\s+before\s+showing\s+you\s+anything|standard\s+industry\s+model\s*\(\s*pay\s+upfront|blind[-\s]purchase\s+custom\s+song\s+services)\b/i.test(
        text,
      );

    if (assertsUniversalOrIndustryUpfrontPayment) {
      if (evidenceCtx.previewOrTrialCounterexamples.length > 0) {
        violations.push({
          code: "CONTRADICTED_UPFRONT_PAYMENT_OR_BLIND_PURCHASE_CLAIM",
          field,
          excerpt: text,
          reason: `Claim asserts that every service or the standard industry model forces upfront financial commitment before generation/preview, which is directly contradicted by ${evidenceCtx.previewOrTrialCounterexamples.length} monitored competitor(s) offering free previews, free trials, or pay-after-preview models (${previewCompNames.join(", ")}).`,
          counterexampleCompetitors: previewCompNames,
          counterexampleSourceIds: previewCompSources,
        });
      } else if (evidenceCtx.coverageUncertainty.hasPartialOrMissingCompetitorEvidence) {
        violations.push({
          code: "MISSING_EVIDENCE_CONVERTED_TO_UNIVERSAL_NEGATIVE",
          field,
          excerpt: text,
          reason: `Claim asserts a universal market-wide payment/trial negative despite incomplete or missing competitor evidence (comparisonStatus=${evidenceCtx.comparisonStatus}). Missing competitor evidence must remain unknown rather than proof of absence.`,
          counterexampleCompetitors: [],
          counterexampleSourceIds: [],
        });
      }
    }

    // 2. Check general universal comparative claims ("every competitor", "no competitor", "only service in the market")
    const hasBroadUniversalQuantifier =
      /\b(?:every\s+(?:single\s+)?(?:other\s+)?(?:service|competitor|platform|provider)\s+in\s+this\s+(?:specific\s+)?(?:market|category|industry)|no\s+competitor\s+(?:in\s+this\s+market\s+)?(?:offers?|provides?|allows?|lets?)|none\s+of\s+the\s+competitors\s+(?:offer|provide|allow)|we\s+are\s+the\s+only\s+(?:service|platform|provider)\s+(?:that|in\s+the\s+market))\b/i.test(
        text,
      );
    if (hasBroadUniversalQuantifier && !assertsUniversalOrIndustryUpfrontPayment) {
      if (evidenceCtx.coverageUncertainty.hasPartialOrMissingCompetitorEvidence) {
        violations.push({
          code: "MISSING_EVIDENCE_CONVERTED_TO_UNIVERSAL_NEGATIVE",
          field,
          excerpt: text,
          reason: `Broad universal market claim in "${field}" converts partial or missing competitor evidence into a universal market assertion.`,
          counterexampleCompetitors: [],
          counterexampleSourceIds: [],
        });
      } else if (
        evidenceCtx.strategicInterpretations.some(
          s => s.outcomeType === "SHARED_CAPABILITY_STRATEGIC_EMPHASIS",
        ) ||
        evidenceCtx.previewOrTrialCounterexamples.length > 0
      ) {
        violations.push({
          code: "CONTRADICTED_UNIVERSAL_MARKET_CLAIM",
          field,
          excerpt: text,
          reason: `Broad universal claim in "${field}" contradicts upstream SHARED_CAPABILITY_STRATEGIC_EMPHASIS posture and observed competitor capabilities (${previewCompNames.concat(multiAssetCompNames).slice(0, 6).join(", ") || "monitored competitors"}).`,
          counterexampleCompetitors: previewCompNames.length > 0 ? previewCompNames : multiAssetCompNames,
          counterexampleSourceIds: previewCompSources.length > 0 ? previewCompSources : multiAssetCompSources,
        });
      }
    }

    // 3. Check contradicted isolated audio / single-format deliverable claim
    const assertsIsolatedAudioMarket =
      /\b(?:isolated\s+audio\s+tracks?|audio[-\s]only\s+files?\s+with\s+no\s+visual|every\s+(?:other\s+)?(?:service|competitor)\s+only\s+delivers?\s+an?\s+(?:mp3|audio\s+file))\b/i.test(
        text,
      );
    if (assertsIsolatedAudioMarket && evidenceCtx.multiAssetCounterexamples.length > 0) {
      violations.push({
        code: "CONTRADICTED_ISOLATED_DELIVERABLE_CLAIM",
        field,
        excerpt: text,
        reason: `Claim characterizes market alternatives as delivering only isolated audio tracks, which is contradicted by ${evidenceCtx.multiAssetCounterexamples.length} monitored competitor(s) offering video, slideshow, lyric, plaque, or visual deliverables (${multiAssetCompNames.join(", ")}).`,
        counterexampleCompetitors: multiAssetCompNames,
        counterexampleSourceIds: multiAssetCompSources,
      });
    }

    // 4. Check conflation of preview vs free generation vs payment timing / satisfaction guarantee
    const claimsPayOnlyWhenSatisfied =
      /\b(?:pay\s+only\s+when\s+(?:you\s+are\s+|100%\s+|fully\s+)?satisfied|satisfaction[-\s]contingent\s+payment|only\s+pay\s+if\s+satisfied)\b/i.test(
        text,
      );
    const conflatesPreviewAsFullFreeGeneration =
      /\b(?:audio\s+preview\s+snippet\s+is\s+identical\s+to\s+full\s+free\s+generation|preview\s+clip\s+means\s+full\s+free\s+song\s+ownership)\b/i.test(
        text,
      );
    const claimsUnqualifiedRiskFree =
      /\brisk[-\s]free\b/i.test(text) &&
      !/\b(?:trial|preview|before\s+paying|when\s+gifting|when\s+obtaining|final\s+product|unlock)\b/i.test(text);

    if (
      (claimsPayOnlyWhenSatisfied && !hasVerifiedSatisfactionGuarantee && hasConditionalDeliveryOrTrial) ||
      conflatesPreviewAsFullFreeGeneration ||
      (claimsUnqualifiedRiskFree && !hasVerifiedSatisfactionGuarantee)
    ) {
      violations.push({
        code: "CONFLATED_PREVIEW_FREE_GENERATION_OR_PAYMENT_TIMING",
        field,
        excerpt: text,
        reason: `Claim conflates distinct trial/preview/payment mechanics (e.g. rewriting free trial generation or payment upon gifting/obtaining the final product into an unverified "pay only when satisfied" guarantee or unqualified "risk-free" promise).`,
        counterexampleCompetitors: previewCompNames,
        counterexampleSourceIds: previewCompSources,
      });
    }

    // 5. Check unverified competitor internal production workflow claims
    const claimsUnverifiedCompetitorWorkflow =
      /\b(?:competitors\s+use\s+mass[-\s]produced\s+automated\s+prompt\s+workflows|template[-\s]bound\s+music\s+generation\s+services\s+produce|rigid\s+templated\s+production\s+pipelines\s+that\s+fail|rushed\s+one[-\s]line\s+prompts)\b/i.test(
        text,
      ) && !/\b(?:buyers\s+(?:worry|fear|perceive|report|assume)|some\s+customers\s+(?:find|report|worry))\b/i.test(text);

    if (claimsUnverifiedCompetitorWorkflow) {
      violations.push({
        code: "UNVERIFIED_COMPETITOR_INTERNAL_WORKFLOW_CLAIM",
        field,
        excerpt: text,
        reason: `Claim states unverified competitor internal production workflows as objective market fact rather than attributing generic-output concerns to buyer perception and customer experience signals.`,
        counterexampleCompetitors: previewCompNames,
        counterexampleSourceIds: previewCompSources,
      });
    }
  }

  const passed = violations.length === 0;
  const judgeFeedbackBlock = passed
    ? ""
    : [
        `EVIDENCE CONTRADICTION & FIDELITY VIOLATIONS DETECTED (evidenceVersion=${evidenceCtx.evidenceVersionHash}):`,
        ...violations.map(
          (v, idx) =>
            `  ${idx + 1}. [${v.code}] in ${v.field}: "${v.excerpt}" — ${v.reason}${
              v.counterexampleCompetitors.length > 0
                ? ` [Counterexamples: ${v.counterexampleCompetitors.join(", ")}; Sources: ${v.counterexampleSourceIds.join(", ")}]`
                : ""
            }`,
        ),
        `REQUIRED REPAIR: Rewrite the contradicted assertion AND its dependent reasoning fields using the authoritative evidence context. Do NOT merely delete "every" or "all" while keeping the false implication that competitors lack previews/trials or force blind upfront payment.`,
      ].join("\n");

  return {
    passed,
    evidenceVersionHash: evidenceCtx.evidenceVersionHash,
    violations,
    judgeFeedbackBlock,
  };
}

/**
 * Repairs a contradicted `NarrativeReframe` and its dependent reasoning chain
 * using the authoritative competitor evidence context so no false implication remains.
 */
export function repairContradictedNarrativeReframe<T extends Record<string, any>>(
  candidate: T,
  evidenceCtx: AuthoritativeCompetitorEvidenceContext,
  evaluation?: AwarenessClaimEvaluationResult,
): T {
  const evalResult = evaluation ?? evaluateAwarenessComparativeClaims(candidate, evidenceCtx);
  if (evalResult.passed) return candidate;

  const repaired = JSON.parse(JSON.stringify(candidate)) as T;
  const previewNames = evidenceCtx.previewOrTrialCounterexamples.map(c => c.competitorName);
  const previewSummary =
    previewNames.length > 0
      ? `several monitored services in this category (${previewNames.slice(0, 6).join(", ")}) also offer free previews, trial generations, or pay-after-preview options`
      : `competitor trial and preview models across the wider market vary or remain partially unverified`;

  const verifiedTrialFact =
    evidenceCtx.verifiedProductFacts.find(
      f =>
        f.mechanismType === "FREE_GENERATION_TRIAL" ||
        f.mechanismType === "CONDITIONAL_DELIVERY_OR_GIFT_PAYMENT" ||
        f.mechanismType === "PAYMENT_TIMING_AFTER_PREVIEW" ||
        f.mechanismType === "PREVIEW_SAMPLE",
    )?.statement ||
    evidenceCtx.verifiedProductFacts[0]?.statement ||
    "evaluating a guided draft or trial output before paying to obtain or gift the final deliverable package";

  const multiAssetFact =
    evidenceCtx.verifiedProductFacts.find(f => f.mechanismType === "MULTI_ASSET_DELIVERABLES")?.statement || null;

  const primaryCustomerPain =
    evidenceCtx.attributedCustomerExperiences[0]?.statement ||
    "some buyers report that automated or personalized outputs can feel generic and miss specific personal memories";

  const violatedFields = new Set(evalResult.violations.map(v => v.field.split("[")[0]));
  const hasUpfrontOrUniversalViolation = evalResult.violations.some(
    v =>
      v.code === "CONTRADICTED_UPFRONT_PAYMENT_OR_BLIND_PURCHASE_CLAIM" ||
      v.code === "CONTRADICTED_UNIVERSAL_MARKET_CLAIM" ||
      v.code === "MISSING_EVIDENCE_CONVERTED_TO_UNIVERSAL_NEGATIVE",
  );
  const hasConflationViolation = evalResult.violations.some(
    v => v.code === "CONFLATED_PREVIEW_FREE_GENERATION_OR_PAYMENT_TIMING",
  );

  // Repair currentModel and its dependent chain together whenever currentModel or bridgeMechanism is contradicted
  if (repaired.currentModel && (
    hasUpfrontOrUniversalViolation ||
    violatedFields.has("currentModel.statement") ||
    violatedFields.has("currentModel.sourceOfBelief") ||
    violatedFields.has("currentModel.whyItStuckSoFar")
  )) {
    repaired.currentModel = {
      ...repaired.currentModel,
      statement:
        `Even when services offer previews or trial generations, buyers worry that automated creation will flatten their specific memories into a generic output that lacks authentic emotional resonance.`,
      sourceOfBelief:
        `Attributed buyer feedback where customers report hearing generic or impersonal outputs (${primaryCustomerPain.slice(0, 140)}), combined with uncertainty over how deeply a guided workflow captures personal detail before final purchase.`,
      whyItStuckSoFar:
        `While ${previewSummary}, buyer hesitation persists because hearing a brief sample alone does not prove whether a service can translate nuanced personal stories and relationship details into a meaningful final keepsake.`,
    };
  }

  if (repaired.falseBridge && (
    hasUpfrontOrUniversalViolation ||
    violatedFields.has("falseBridge.obviousNextStep") ||
    violatedFields.has("falseBridge.statement") ||
    violatedFields.has("falseBridge.whyItFails")
  )) {
    const cleanNextStep =
      `Typing a longer prompt into a generic generator or relying on an unstructured preview clip without guided story capture.`;
    repaired.falseBridge = {
      ...repaired.falseBridge,
      ...(repaired.falseBridge.obviousNextStep !== undefined ? { obviousNextStep: cleanNextStep } : {}),
      ...(repaired.falseBridge.statement !== undefined ? { statement: cleanNextStep } : {}),
      whyItFails:
        `Without structured story intake and guided creative translation before final delivery purchase, buyers still struggle to see their specific memories reflected in the finished work.`,
    };
  }

  if (repaired.newModel && (
    hasUpfrontOrUniversalViolation ||
    hasConflationViolation ||
    violatedFields.has("newModel.reclassification") ||
    violatedFields.has("newModel.namedPrinciple") ||
    violatedFields.has("newModel.whatBecomesObvious") ||
    violatedFields.has("newModel.statement") ||
    violatedFields.has("newModel.supportingTruth") ||
    violatedFields.has("newModel.emotionalPayoff")
  )) {
    const reclassText =
      `Evaluate how your specific personal story and memories are translated through a guided trial creation workflow before deciding to pay when gifting or obtaining the final product${multiAssetFact ? " and optional keepsake formats" : ""}.`;
    const principleText =
      `Grounded in verified product workflow (${verifiedTrialFact}) while recognizing that ${previewSummary}; the strategic emphasis is on personal story fidelity rather than claiming exclusive trial availability.`;
    const obviousText =
      `Test your actual relationship details in the guided trial creation first, then decide whether to pay when gifting or obtaining the completed package.`;
    repaired.newModel = {
      ...repaired.newModel,
      ...(repaired.newModel.reclassification !== undefined ? { reclassification: reclassText } : {}),
      ...(repaired.newModel.namedPrinciple !== undefined ? { namedPrinciple: principleText } : {}),
      ...(repaired.newModel.whatBecomesObvious !== undefined ? { whatBecomesObvious: obviousText } : {}),
      ...(repaired.newModel.statement !== undefined ? { statement: reclassText } : {}),
      ...(repaired.newModel.supportingTruth !== undefined ? { supportingTruth: principleText } : {}),
      ...(repaired.newModel.emotionalPayoff !== undefined ? { emotionalPayoff: obviousText } : {}),
    };
  }

  if (repaired.bridgeMechanism && (
    hasUpfrontOrUniversalViolation ||
    hasConflationViolation ||
    violatedFields.has("bridgeMechanism.specificMove") ||
    violatedFields.has("bridgeMechanism.whyBuyerCanAcceptIt")
  )) {
    repaired.bridgeMechanism = {
      ...repaired.bridgeMechanism,
      specificMove:
        `Invite the buyer to enter specific relationship memories in the guided trial creation workflow and evaluate how faithfully their personal story is captured before paying when gifting or obtaining the final deliverable${multiAssetFact ? " (with optional artwork, video, or keepsake formats)" : ""}, rather than claiming competitors lack previews or trials.`,
      ...(repaired.bridgeMechanism.whyBuyerCanAcceptIt !== undefined
        ? {
            whyBuyerCanAcceptIt:
              `Acknowledges the buyer's real experience that ${previewSummary}, while directly addressing their core skepticism about whether automated outputs can capture personal story detail before final purchase.`,
          }
        : {}),
    };
  }

  return repaired;
}

/**
 * Repairs a contradicted `MythBreakerReasoning` and its dependent reasoning steps
 * using the authoritative competitor evidence context.
 */
export function repairContradictedMythBreaker<T extends Record<string, any>>(
  candidate: T,
  evidenceCtx: AuthoritativeCompetitorEvidenceContext,
  evaluation?: AwarenessClaimEvaluationResult,
): T {
  const evalResult = evaluation ?? evaluateAwarenessComparativeClaims(candidate, evidenceCtx);
  if (evalResult.passed) return candidate;

  const repaired = JSON.parse(JSON.stringify(candidate)) as T;
  const previewNames = evidenceCtx.previewOrTrialCounterexamples.map(c => c.competitorName);
  const previewContext =
    previewNames.length > 0
      ? `While several monitored services (${previewNames.slice(0, 6).join(", ")}) also offer free previews or trial models`
      : `Where competitor preview and trial models across the market vary or remain partially unverified`;

  const verifiedTrialFact =
    evidenceCtx.verifiedProductFacts.find(
      f =>
        f.mechanismType === "FREE_GENERATION_TRIAL" ||
        f.mechanismType === "CONDITIONAL_DELIVERY_OR_GIFT_PAYMENT" ||
        f.mechanismType === "PAYMENT_TIMING_AFTER_PREVIEW" ||
        f.mechanismType === "PREVIEW_SAMPLE",
    )?.statement ||
    evidenceCtx.verifiedProductFacts[0]?.statement ||
    "guided free trial creation where payment applies when gifting or obtaining the final deliverable";

  repaired.beliefToContradict =
    `That personalized creation without an expensive custom studio commission inevitably produces a generic output that misses your specific memories.`;
  repaired.mythBreakerStatement =
    `${previewContext}, you do not have to settle for a generic output: our guided workflow translates your specific personal memories into a free trial creation that you can evaluate before paying when gifting or obtaining the final product.`;
  repaired.contradictionLogic =
    `Addresses attributed buyer skepticism about generic outputs by pairing structured story capture with ${verifiedTrialFact}, while accurately acknowledging observed competitor preview/trial capabilities rather than asserting a false market-wide upfront-payment monopoly.`;
  if (Array.isArray(repaired.reasoningSteps)) {
    repaired.reasoningSteps = [
      `Acknowledge attributed buyer friction: some customers report generic-sounding outputs when personal details are not deeply captured.`,
      `Preserve market accuracy: ${previewContext}, so differentiation rests on guided story fidelity rather than claiming no competitor offers previews or trials.`,
      `Ground the resolution in verified product mechanics: ${verifiedTrialFact}.`,
    ];
  }

  return repaired;
}
