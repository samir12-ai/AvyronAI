/**
 * Phase 4-B — Progressive Business Context Layer (BCL).
 *
 * Deterministic, LLM-free preprocessor that produces a structured
 * `BusinessProfile` consumed by the awareness commercial reasoner and
 * downstream plan synthesis. Profile is built progressively across the
 * orchestration lifecycle:
 *
 *   - Stage 1 (orchestrator boot, before engine 1): foundational profile
 *     from manual `business_data_layer` + industry slug + ProductDNA
 *     (`content_dna`). Used by any pre-engine consumer.
 *
 *   - Stage 2 (immediately before awareness LLM, engine 7): folds in the
 *     output snapshots from engines 1-6 (MI, audience, positioning,
 *     differentiation, mechanism, offer) so the LLM receives a profile
 *     enriched by the orchestrator's own intelligence, not just static
 *     onboarding text. This is the targeted fix for the v3 measurement
 *     `confidence=0.25 unknown=6 → ZOD_REJECTED` cascade.
 *
 *   - Stage 3 (after integrity, engine 10; before plan synthesis): folds
 *     in funnel/persuasion/integrity outputs so synthesis-and-beyond
 *     consumers see the integrity-aware view (validated funnelType,
 *     friction-derived growthBottlenecks, trust-gap flags).
 *
 * Invariants across all stages:
 *   - Deterministic. No LLM in any stage.
 *   - Additive. Stage N never weakens a field grounded by Stage N-1.
 *     User input wins on contradictions; contradictions are LOGGED, not
 *     silently overwritten (B4 — explicit classification over hidden
 *     ambiguity).
 *   - UNKNOWN never auto-fills. Engine-derived fields require real
 *     snapshot evidence; absence remains explicit.
 *   - Same `BusinessProfile` shape at every stage — only `stage`,
 *     `confidence`, `unknownFields`, `inputSources`, `engineDerivedFields`,
 *     and `contradictions` differ.
 *
 * See `.local/validation/bcl-progressive-audit.md` for the data
 * availability + dependency map this implementation is derived from.
 */

import { eq, and, desc } from "drizzle-orm";
import { db } from "../db";
import {
  businessDataLayer,
  type BusinessDataLayer,
  audienceSnapshots,
  positioningSnapshots,
  differentiationSnapshots,
  mechanismSnapshots,
  offerSnapshots,
  miSnapshots,
  funnelSnapshots,
  persuasionSnapshots,
  integritySnapshots,
  contentDna,
} from "../../shared/schema";

export type BusinessModel =
  | "saas"
  | "dtc_ecommerce"
  | "local_service"
  | "agency_consulting"
  | "marketplace"
  | "unknown";

export type BuyerType =
  | "self_serve"
  | "committee"
  | "consumer"
  | "walk_in"
  | "unknown";

export type PricingComplexity =
  | "transactional"
  | "subscription_low"
  | "subscription_high"
  | "enterprise_contract"
  | "unknown";

export interface CommercialLens {
  primaryLevers: string[];
  marketDynamics: string[];
  buyerPsychology: string[];
}

export interface ReasoningFramework {
  name: string;
  emphasizeFields: string[];
  deprioritizeSignals: string[];
}

export interface BcL_Contradiction {
  field: string;
  userValue: string;
  engineValue: string;
  engineSource: string;
}

export interface BusinessProfile {
  /** Which enrichment stage produced this profile (1 = boot, 2 = pre-awareness, 3 = pre-synthesis). */
  stage: 1 | 2 | 3;
  industry: string;
  subIndustry: string | null;
  businessModel: BusinessModel;
  targetCustomer: string | null;
  buyerType: BuyerType;
  offerType: string | null;
  pricingComplexity: PricingComplexity;
  funnelType: string | null;
  growthBottlenecks: string[];
  commercialLens: CommercialLens;
  reasoningFramework: ReasoningFramework;
  /** 0-1 — fraction of canonical fields grounded across all consulted sources. */
  confidence: number;
  /** Canonical field names the layer could not determine from any source. */
  unknownFields: string[];
  /** Canonical fields that were RESOLVED by engine snapshots (not user input). */
  engineDerivedFields: string[];
  /** Engine-derived values that disagreed with user input (user input wins; we log). */
  contradictions: BcL_Contradiction[];
  /** Provenance of every consulted source. */
  inputSources: {
    manualUserData: boolean;
    productDna: boolean;
    industrySlug: boolean;
    miSnapshot: boolean;
    audienceSnapshot: boolean;
    positioningSnapshot: boolean;
    differentiationSnapshot: boolean;
    mechanismSnapshot: boolean;
    offerSnapshot: boolean;
    funnelSnapshot: boolean;
    persuasionSnapshot: boolean;
    integritySnapshot: boolean;
  };
}

export interface BuildBusinessProfileInput {
  industry?: string | null;
  businessData?: BusinessDataLayer | null;
  productDnaSummary?: string | null;
}

const UNKNOWN_STRINGS = new Set(["", "unknown", "n/a", "na", "tbd", "none"]);
function clean(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = s.trim();
  if (t.length === 0) return null;
  if (UNKNOWN_STRINGS.has(t.toLowerCase())) return null;
  return t;
}

function detectBusinessModel(args: {
  industry: string | null;
  businessType: string | null;
  coreOffer: string | null;
  productCategory: string | null;
}): BusinessModel {
  const raw = [args.industry, args.businessType, args.coreOffer, args.productCategory]
    .filter((x): x is string => Boolean(x))
    .join(" ")
    .toLowerCase();
  if (!raw) return "unknown";
  const blob = raw.replace(/[_-]+/g, " ");
  if (/\b(saas|software|platform|api|cloud tool|web app)\b/.test(blob)) return "saas";
  if (/\b(marketplace|two[ ]sided|aggregator)\b/.test(blob)) return "marketplace";
  if (/\b(agency|consult|coach|freelance|done[ ]for[ ]you|dfy)\b/.test(blob)) return "agency_consulting";
  if (/\b(dental|clinic|salon|spa|restaurant|repair|plumb|hvac|locksmith|gym|studio|local service|local services|home service)\b/.test(blob)) return "local_service";
  if (/\b(ecom|ecommerce|dtc|d2c|shop|store|retail|apparel|cpg|product line|skincare|cosmetic|fashion)\b/.test(blob)) return "dtc_ecommerce";
  return "unknown";
}

function detectBuyerType(args: {
  decisionMaker: string | null;
  audienceSegment: string | null;
}): BuyerType {
  const dm = (args.decisionMaker ?? "").toLowerCase();
  const seg = (args.audienceSegment ?? "").toLowerCase();
  const combined = `${dm} ${seg}`;
  if (!combined.trim()) return "unknown";
  if (/\b(committee|vp|chief|cro|cmo|cto|director|head of|buying committee|stakeholder|enterprise buyer)\b/.test(combined)) {
    return "committee";
  }
  if (/\b(walk[- ]in|drop[- ]in|same[- ]day)\b/.test(combined)) return "walk_in";
  if (/\b(self[- ]serve|self[- ]signup|product[- ]led|free trial signup|solo|founder|smb owner)\b/.test(combined)) {
    return "self_serve";
  }
  if (/\b(consumer|customer|shopper|patient|individual|end user|buyer|household|family)\b/.test(combined)) {
    return "consumer";
  }
  return "unknown";
}

function detectPricingComplexity(args: { priceRange: string | null }): PricingComplexity {
  const p = (args.priceRange ?? "").toLowerCase().trim();
  if (!p) return "unknown";
  const m = p.match(/\$\s?([\d,]+(?:\.\d+)?)/);
  const amount = m ? Number(m[1].replace(/,/g, "")) : NaN;
  const recurring = /\b(month|mo|annual|yr|year|subscription|recurring|mrr|arr|per user|seat)\b/.test(p);
  const perUnit = /\b(per item|per unit|per piece|per visit|each|one[- ]time)\b/.test(p);
  if (recurring) {
    if (Number.isFinite(amount)) {
      if (amount >= 1_000) return "enterprise_contract";
      if (amount >= 100) return "subscription_high";
      return "subscription_low";
    }
    return "subscription_low";
  }
  if (Number.isFinite(amount)) {
    if (amount >= 5_000) return "enterprise_contract";
    if (perUnit || amount < 5_000) return "transactional";
  }
  return "unknown";
}

const LENS_BY_MODEL: Record<Exclude<BusinessModel, "unknown">, CommercialLens> = {
  saas: {
    primaryLevers: ["activation", "onboarding", "time_to_value", "churn_risk", "roi_proof", "switching_cost"],
    marketDynamics: ["trial_to_paid_critical", "feature_parity_pressure", "vendor_consolidation_risk"],
    buyerPsychology: ["roi_required_for_renewal", "implementation_anxiety", "internal_champion_needed"],
  },
  dtc_ecommerce: {
    primaryLevers: ["offer_clarity", "conversion_rate", "product_desire", "retention", "trust_signals", "price_resistance"],
    marketDynamics: ["ad_creative_fatigue", "category_saturation", "amazon_alternative_pressure"],
    buyerPsychology: ["impulse_to_consideration_gap", "social_proof_dependence", "shipping_friction_aversion"],
  },
  local_service: {
    primaryLevers: ["reputation", "urgency_response", "location_intent", "trust_proof", "anxiety_reduction"],
    marketDynamics: ["review_dominance", "proximity_winner_take_most", "referral_loop_dependent"],
    buyerPsychology: ["risk_averse_purchase", "trust_before_price", "anxiety_about_quality"],
  },
  agency_consulting: {
    primaryLevers: ["authority", "differentiation", "lead_quality", "case_study_proof", "buying_confidence"],
    marketDynamics: ["commoditization_pressure", "founder_brand_dependent", "referral_concentration_risk"],
    buyerPsychology: ["expertise_signaling_required", "risk_of_wasted_retainer", "stakeholder_buy_in"],
  },
  marketplace: {
    primaryLevers: ["supply_density", "demand_velocity", "match_quality", "first_transaction_friction", "retention_loops"],
    marketDynamics: ["cold_start_pressure", "disintermediation_risk", "winner_take_most_geo"],
    buyerPsychology: ["trust_before_first_use", "switching_cost_low", "social_proof_critical"],
  },
};

const FRAMEWORK_BY_MODEL: Record<Exclude<BusinessModel, "unknown">, ReasoningFramework> = {
  saas: {
    name: "SaaS Activation & ROI-Proof",
    emphasizeFields: ["buyer_state", "trust_state", "commercial_pressures.switching_cost", "commercial_pressures.proof"],
    deprioritizeSignals: ["walk_in_intent", "geographic_proximity"],
  },
  dtc_ecommerce: {
    name: "DTC Offer-Clarity & Conversion",
    emphasizeFields: ["saturation_state", "commercial_pressures.differentiation", "commercial_pressures.price_anchoring", "commercial_pressures.trust"],
    deprioritizeSignals: ["enterprise_committee", "implementation_complexity"],
  },
  local_service: {
    name: "Local Reputation & Anxiety-Reduction",
    emphasizeFields: ["trust_state", "commercial_pressures.proof", "commercial_pressures.perceived_risk", "commercial_pressures.urgency"],
    deprioritizeSignals: ["feature_parity_pressure", "trial_to_paid", "ad_creative_fatigue"],
  },
  agency_consulting: {
    name: "Agency Authority & Case-Study Proof",
    emphasizeFields: ["trust_state", "commercial_pressures.differentiation", "commercial_pressures.proof", "commercial_pressures.decision_complexity"],
    deprioritizeSignals: ["impulse_purchase", "walk_in_intent"],
  },
  marketplace: {
    name: "Marketplace Cold-Start & Match-Quality",
    emphasizeFields: ["saturation_state", "trust_state", "commercial_pressures.trust", "commercial_pressures.category_saturation"],
    deprioritizeSignals: ["roi_proof_for_renewal", "implementation_anxiety"],
  },
};

const UNKNOWN_LENS: CommercialLens = {
  primaryLevers: ["general_conversion", "trust_signals", "differentiation"],
  marketDynamics: ["unknown_business_model"],
  buyerPsychology: ["unknown_buyer_psychology"],
};

const UNKNOWN_FRAMEWORK: ReasoningFramework = {
  name: "Generic Commercial Reasoning (insufficient business context)",
  emphasizeFields: ["buyer_state", "trust_state"],
  deprioritizeSignals: [],
};

function inferGrowthBottlenecks(args: {
  model: BusinessModel;
  pricing: PricingComplexity;
  buyer: BuyerType;
  funnelObjective: string | null;
}): string[] {
  const out: string[] = [];
  if (args.model === "saas") {
    out.push("activation_friction_risk");
    if (args.pricing === "enterprise_contract") out.push("long_sales_cycle_risk");
    if (args.buyer === "committee") out.push("multi_stakeholder_consensus_risk");
  }
  if (args.model === "dtc_ecommerce") {
    out.push("creative_fatigue_risk", "first_purchase_trust_gap");
  }
  if (args.model === "local_service") {
    out.push("review_dependence_risk", "geographic_demand_ceiling");
  }
  if (args.model === "agency_consulting") {
    out.push("lead_quality_variance_risk", "founder_capacity_ceiling");
  }
  if (args.model === "marketplace") {
    out.push("cold_start_supply_gap", "disintermediation_risk");
  }
  if ((args.funnelObjective ?? "").toLowerCase().includes("lead")) {
    out.push("lead_to_revenue_conversion_gap");
  }
  return out;
}

// ============================================================================
// Stage 1 — Pre-engine foundational profile.
// ============================================================================

/**
 * Pure deterministic Stage-1 profile builder.
 *
 * Inputs are limited to what's available BEFORE engine 1 runs: manual
 * `business_data_layer`, industry slug, ProductDNA summary. Tests use
 * this function directly.
 *
 * NB. Exported as `buildBusinessProfile` for backwards compatibility
 * with existing tests + interpreter call sites.
 */
export function buildStage1Profile(input: BuildBusinessProfileInput): BusinessProfile {
  const bd = input.businessData ?? null;
  const industrySlug = clean(input.industry ?? null);
  const businessType = clean(bd?.businessType ?? null);
  const productCategory = clean(bd?.productCategory ?? null);
  const coreOffer = clean(bd?.coreOffer ?? null);
  const targetSegment = clean(bd?.targetAudienceSegment ?? null);
  const decisionMaker = clean(bd?.targetDecisionMaker ?? null);
  const priceRange = clean(bd?.priceRange ?? null);
  const funnelObjective = clean(bd?.funnelObjective ?? null);

  const model = detectBusinessModel({
    industry: industrySlug,
    businessType,
    coreOffer,
    productCategory,
  });
  const buyer = detectBuyerType({ decisionMaker, audienceSegment: targetSegment });
  const pricing = detectPricingComplexity({ priceRange });

  const lens = model === "unknown" ? UNKNOWN_LENS : LENS_BY_MODEL[model];
  const framework = model === "unknown" ? UNKNOWN_FRAMEWORK : FRAMEWORK_BY_MODEL[model];

  const unknownFields: string[] = [];
  if (!industrySlug && !businessType) unknownFields.push("industry");
  if (!productCategory) unknownFields.push("subIndustry");
  if (model === "unknown") unknownFields.push("businessModel");
  if (!targetSegment) unknownFields.push("targetCustomer");
  if (buyer === "unknown") unknownFields.push("buyerType");
  if (!coreOffer) unknownFields.push("offerType");
  if (pricing === "unknown") unknownFields.push("pricingComplexity");
  if (!funnelObjective) unknownFields.push("funnelType");

  const totalCanonical = 8;
  const grounded = totalCanonical - unknownFields.length;
  const confidence = Math.max(0, Math.min(1, grounded / totalCanonical));

  return {
    stage: 1,
    industry: industrySlug ?? businessType ?? "unknown",
    subIndustry: productCategory,
    businessModel: model,
    targetCustomer: targetSegment,
    buyerType: buyer,
    offerType: coreOffer,
    pricingComplexity: pricing,
    funnelType: funnelObjective,
    growthBottlenecks: inferGrowthBottlenecks({
      model,
      pricing,
      buyer,
      funnelObjective,
    }),
    commercialLens: lens,
    reasoningFramework: framework,
    confidence,
    unknownFields,
    engineDerivedFields: [],
    contradictions: [],
    inputSources: {
      manualUserData: Boolean(bd),
      productDna: Boolean(clean(input.productDnaSummary ?? null)),
      industrySlug: Boolean(industrySlug),
      miSnapshot: false,
      audienceSnapshot: false,
      positioningSnapshot: false,
      differentiationSnapshot: false,
      mechanismSnapshot: false,
      offerSnapshot: false,
      funnelSnapshot: false,
      persuasionSnapshot: false,
      integritySnapshot: false,
    },
  };
}

/** Back-compat alias — existing tests + interpreter call this. */
export const buildBusinessProfile = buildStage1Profile;

// ============================================================================
// Stage 2 + Stage 3 enrichment.
// ============================================================================

/**
 * One enrichment proposal from a snapshot reader. The merger applies
 * proposals against the prior-stage profile honoring contradiction
 * policy (user-input wins; engine-derived fills only where prior was
 * UNKNOWN; conflict logged not silently flipped).
 */
interface EnrichmentProposal {
  field:
    | "subIndustry"
    | "targetCustomer"
    | "buyerType"
    | "offerType"
    | "pricingComplexity"
    | "funnelType";
  value: string | BuyerType | PricingComplexity;
  source: string; // e.g. "audience_snapshot", "offer_snapshot"
  /** Optional supplementary bottlenecks this snapshot reveals. */
  bottlenecks?: string[];
}

/**
 * Safe JSON parse — text columns in our snapshots hold JSON strings.
 */
function tryJson<T = unknown>(raw: string | null | undefined, label?: string): T | null {
  if (!raw || typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t || t === "null" || t === "undefined") return null;
  try {
    return JSON.parse(t) as T;
  } catch (err) {
    // Explicit non-fatal log (Seal #15 — no silent catches). Snapshot
    // text columns occasionally hold non-JSON debug payloads; we drop
    // the value rather than corrupting the profile, but the operator
    // sees it.
    console.warn(
      `[BCL] SNAPSHOT_JSON_PARSE_FAILED field=${label ?? "<unknown>"} preview=${t.slice(0, 40)} error=${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Lift one or two short string hints out of a snapshot JSON payload.
 * Used only for surfacing audience-segment / offer-name text into the
 * BCL — never used to materialise a structured field directly.
 */
function summariseStrings(values: unknown[], max = 2, cap = 140): string | null {
  const out: string[] = [];
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) out.push(v.trim());
    if (out.length >= max) break;
  }
  if (out.length === 0) return null;
  const joined = out.join(" | ");
  return joined.length > cap ? joined.slice(0, cap - 1) + "…" : joined;
}

interface SnapshotBundle {
  mi?: typeof miSnapshots.$inferSelect | null;
  audience?: typeof audienceSnapshots.$inferSelect | null;
  positioning?: typeof positioningSnapshots.$inferSelect | null;
  differentiation?: typeof differentiationSnapshots.$inferSelect | null;
  mechanism?: typeof mechanismSnapshots.$inferSelect | null;
  offer?: typeof offerSnapshots.$inferSelect | null;
  funnel?: typeof funnelSnapshots.$inferSelect | null;
  persuasion?: typeof persuasionSnapshots.$inferSelect | null;
  integrity?: typeof integritySnapshots.$inferSelect | null;
}

/** Deterministic mapping rules from audience snapshot → BCL canonical fields. */
function readAudienceSnapshot(
  snap: typeof audienceSnapshots.$inferSelect,
): { proposals: EnrichmentProposal[]; bottlenecks: string[] } {
  const proposals: EnrichmentProposal[] = [];
  const bottlenecks: string[] = [];

  const segments = tryJson<unknown>(snap.audienceSegments);
  if (Array.isArray(segments)) {
    const segmentTitles: string[] = [];
    for (const s of segments) {
      if (s && typeof s === "object") {
        const obj = s as Record<string, unknown>;
        const t = typeof obj.title === "string" ? obj.title : typeof obj.name === "string" ? obj.name : null;
        if (t && t.trim()) segmentTitles.push(t.trim());
      } else if (typeof s === "string" && s.trim()) {
        segmentTitles.push(s.trim());
      }
    }
    const summary = summariseStrings(segmentTitles, 2);
    if (summary) {
      proposals.push({
        field: "targetCustomer",
        value: summary,
        source: "audience_snapshot.audienceSegments",
      });
      const buyerInf = detectBuyerType({ decisionMaker: null, audienceSegment: summary });
      if (buyerInf !== "unknown") {
        proposals.push({
          field: "buyerType",
          value: buyerInf,
          source: "audience_snapshot.audienceSegments",
        });
      }
    }
  }

  // Pains marked as activation barriers → bottleneck additions.
  const pains = tryJson<unknown>(snap.audiencePains);
  if (Array.isArray(pains)) {
    let activationFlag = false;
    for (const p of pains) {
      if (!p || typeof p !== "object") continue;
      const obj = p as Record<string, unknown>;
      const text = [obj.label, obj.description, obj.signal]
        .filter((x): x is string => typeof x === "string")
        .join(" ")
        .toLowerCase();
      if (/activation|onboarding|first[- ]use|sign[- ]up|trial/.test(text)) {
        activationFlag = true;
        break;
      }
    }
    if (activationFlag) bottlenecks.push("activation_barrier_signal_in_audience");
  }

  return { proposals, bottlenecks };
}

/** Deterministic mapping rules from offer snapshot → BCL canonical fields. */
function readOfferSnapshot(
  snap: typeof offerSnapshots.$inferSelect,
): { proposals: EnrichmentProposal[]; bottlenecks: string[] } {
  const proposals: EnrichmentProposal[] = [];
  const bottlenecks: string[] = [];

  const primary = tryJson<Record<string, unknown>>(snap.primaryOffer);
  if (primary) {
    const offerName =
      (typeof primary.headline === "string" && primary.headline) ||
      (typeof primary.name === "string" && primary.name) ||
      (typeof primary.offerType === "string" && primary.offerType) ||
      null;
    if (offerName && offerName.trim()) {
      proposals.push({
        field: "offerType",
        value: offerName.trim().slice(0, 140),
        source: "offer_snapshot.primaryOffer",
      });
    }

    // Pricing tier inference from any pricing-shaped fields the offer
    // snapshot exposes. We only emit a proposal when the evidence is
    // concrete (an amount + recurrence keyword); otherwise stay UNKNOWN.
    const priceText = [
      typeof primary.price === "string" ? primary.price : null,
      typeof primary.pricing === "string" ? primary.pricing : null,
      typeof primary.priceRange === "string" ? primary.priceRange : null,
      typeof primary.ticket === "string" ? primary.ticket : null,
    ]
      .filter((x): x is string => Boolean(x))
      .join(" ");
    if (priceText.trim()) {
      const inferred = detectPricingComplexity({ priceRange: priceText });
      if (inferred !== "unknown") {
        proposals.push({
          field: "pricingComplexity",
          value: inferred,
          source: "offer_snapshot.primaryOffer.pricing",
        });
      }
    }
  }

  if (typeof snap.offerStrengthScore === "number" && snap.offerStrengthScore < 0.4) {
    bottlenecks.push("weak_offer_strength_score");
  }

  return { proposals, bottlenecks };
}

/** Deterministic mapping from positioning + differentiation → bottlenecks. */
function readPositioningDiffSnapshot(
  positioning: typeof positioningSnapshots.$inferSelect | null,
  differentiation: typeof differentiationSnapshots.$inferSelect | null,
): { proposals: EnrichmentProposal[]; bottlenecks: string[] } {
  const bottlenecks: string[] = [];

  if (positioning) {
    const enemy = clean(positioning.enemyDefinition);
    if (!enemy) bottlenecks.push("positioning_enemy_undefined");
    if (typeof positioning.confidenceScore === "number" && positioning.confidenceScore < 0.4) {
      bottlenecks.push("low_positioning_confidence");
    }
  }
  if (differentiation) {
    const proofArch = tryJson<unknown>(differentiation.proofArchitecture);
    if (Array.isArray(proofArch) && proofArch.length === 0) {
      bottlenecks.push("missing_proof_architecture");
    }
  }

  return { proposals: [], bottlenecks };
}

/** Deterministic mapping from MI snapshot → subIndustry hint. */
function readMiSnapshot(
  snap: typeof miSnapshots.$inferSelect,
): { proposals: EnrichmentProposal[]; bottlenecks: string[] } {
  const proposals: EnrichmentProposal[] = [];
  const bottlenecks: string[] = [];

  const market = tryJson<Record<string, unknown>>(snap.marketState);
  if (market) {
    const cat =
      (typeof market.category === "string" && market.category) ||
      (typeof market.subCategory === "string" && market.subCategory) ||
      (typeof market.industryCategory === "string" && market.industryCategory) ||
      null;
    if (cat && cat.trim()) {
      proposals.push({
        field: "subIndustry",
        value: cat.trim().slice(0, 140),
        source: "mi_snapshot.marketState.category",
      });
    }
  }

  // Threat signals → bottleneck hints (only labels, capped).
  const threats = tryJson<unknown>(snap.threatSignals);
  if (Array.isArray(threats) && threats.length >= 3) {
    bottlenecks.push("high_competitive_threat_density");
  }

  return { proposals, bottlenecks };
}

/** Deterministic mapping from funnel snapshot → funnelType + friction. */
function readFunnelSnapshot(
  snap: typeof funnelSnapshots.$inferSelect,
): { proposals: EnrichmentProposal[]; bottlenecks: string[] } {
  const proposals: EnrichmentProposal[] = [];
  const bottlenecks: string[] = [];

  const primary = tryJson<Record<string, unknown>>(snap.primaryFunnel);
  if (primary) {
    const funnelLabel =
      (typeof primary.funnelType === "string" && primary.funnelType) ||
      (typeof primary.name === "string" && primary.name) ||
      (typeof primary.label === "string" && primary.label) ||
      null;
    if (funnelLabel && funnelLabel.trim()) {
      proposals.push({
        field: "funnelType",
        value: funnelLabel.trim().slice(0, 140),
        source: "funnel_snapshot.primaryFunnel",
      });
    }
  }

  const friction = tryJson<unknown>(snap.frictionMap);
  if (Array.isArray(friction)) {
    for (const f of friction.slice(0, 3)) {
      if (!f || typeof f !== "object") continue;
      const obj = f as Record<string, unknown>;
      const label =
        (typeof obj.label === "string" && obj.label) ||
        (typeof obj.name === "string" && obj.name) ||
        (typeof obj.friction === "string" && obj.friction) ||
        null;
      if (label && label.trim()) {
        bottlenecks.push(`funnel_friction:${label.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 40)}`);
      }
    }
  }

  return { proposals, bottlenecks };
}

/** Deterministic mapping from persuasion snapshot → bottlenecks (objection patterns). */
function readPersuasionSnapshot(
  snap: typeof persuasionSnapshots.$inferSelect,
): { proposals: EnrichmentProposal[]; bottlenecks: string[] } {
  const bottlenecks: string[] = [];
  const layers = tryJson<unknown>(snap.layerResults);
  if (Array.isArray(layers)) {
    let unresolvedObjections = 0;
    for (const l of layers) {
      if (!l || typeof l !== "object") continue;
      const obj = l as Record<string, unknown>;
      const status = typeof obj.status === "string" ? obj.status.toLowerCase() : "";
      if (status === "unresolved" || status === "weak") unresolvedObjections++;
    }
    if (unresolvedObjections > 0) {
      bottlenecks.push(`persuasion_unresolved_objections:${unresolvedObjections}`);
    }
  }
  return { proposals: [], bottlenecks };
}

/** Deterministic mapping from integrity snapshot → trust gaps. */
function readIntegritySnapshot(
  snap: typeof integritySnapshots.$inferSelect,
): { proposals: EnrichmentProposal[]; bottlenecks: string[]; trustRepairFlag: boolean } {
  const bottlenecks: string[] = [];
  let trustRepairFlag = false;

  if (snap.safeToExecute === false) trustRepairFlag = true;

  const flagged = tryJson<unknown>(snap.flaggedInconsistencies);
  if (Array.isArray(flagged) && flagged.length > 0) {
    bottlenecks.push(`integrity_flagged_inconsistencies:${flagged.length}`);
    if (flagged.length >= 3) trustRepairFlag = true;
  }
  if (typeof snap.overallIntegrityScore === "number" && snap.overallIntegrityScore < 0.5) {
    bottlenecks.push("low_overall_integrity_score");
    trustRepairFlag = true;
  }

  return { proposals: [], bottlenecks, trustRepairFlag };
}

// ============================================================================
// Merge — apply proposals to a prior-stage profile honoring policy.
// ============================================================================

function recomputeUnknowns(p: BusinessProfile): string[] {
  const out: string[] = [];
  if (p.industry === "unknown") out.push("industry");
  if (!p.subIndustry) out.push("subIndustry");
  if (p.businessModel === "unknown") out.push("businessModel");
  if (!p.targetCustomer) out.push("targetCustomer");
  if (p.buyerType === "unknown") out.push("buyerType");
  if (!p.offerType) out.push("offerType");
  if (p.pricingComplexity === "unknown") out.push("pricingComplexity");
  if (!p.funnelType) out.push("funnelType");
  return out;
}

function recomputeConfidence(p: BusinessProfile): number {
  // 8 canonical fields. User-grounded counts 1.0; engine-derived counts 0.6
  // (engine inferences are real signal but lower-trust than direct manual
  // input). Pure unknown counts 0.
  const fields = [
    { name: "industry", grounded: p.industry !== "unknown" },
    { name: "subIndustry", grounded: Boolean(p.subIndustry) },
    { name: "businessModel", grounded: p.businessModel !== "unknown" },
    { name: "targetCustomer", grounded: Boolean(p.targetCustomer) },
    { name: "buyerType", grounded: p.buyerType !== "unknown" },
    { name: "offerType", grounded: Boolean(p.offerType) },
    { name: "pricingComplexity", grounded: p.pricingComplexity !== "unknown" },
    { name: "funnelType", grounded: Boolean(p.funnelType) },
  ];
  let score = 0;
  for (const f of fields) {
    if (!f.grounded) continue;
    score += p.engineDerivedFields.includes(f.name) ? 0.6 : 1.0;
  }
  return Math.max(0, Math.min(1, score / fields.length));
}

/**
 * Apply an enrichment proposal to a profile. Returns a new profile.
 * Policy:
 *   - If the prior value is UNKNOWN-shaped (null / "unknown" enum), the
 *     proposal fills it AND the field is recorded under
 *     `engineDerivedFields` + the source flagged in `inputSources`.
 *   - If the prior value is grounded (user-input or earlier engine), the
 *     proposal is COMPARED. Matching values → no-op (still flag the
 *     extra source). Differing values → user-input wins; contradiction
 *     recorded in `profile.contradictions`.
 */
function applyProposal(profile: BusinessProfile, proposal: EnrichmentProposal): BusinessProfile {
  const next = { ...profile };
  const sourceFlag = inputSourceFlagForSource(proposal.source);
  if (sourceFlag) {
    next.inputSources = { ...next.inputSources, [sourceFlag]: true };
  }

  const isUnknown = (() => {
    switch (proposal.field) {
      case "buyerType":
        return next.buyerType === "unknown";
      case "pricingComplexity":
        return next.pricingComplexity === "unknown";
      default:
        return next[proposal.field] == null || next[proposal.field] === "";
    }
  })();

  if (isUnknown) {
    (next as any)[proposal.field] = proposal.value;
    if (!next.engineDerivedFields.includes(proposal.field)) {
      next.engineDerivedFields = [...next.engineDerivedFields, proposal.field];
    }
    return next;
  }

  // Grounded value present. Compare without overwriting.
  const prior = String((next as any)[proposal.field] ?? "").toLowerCase().trim();
  const proposed = String(proposal.value).toLowerCase().trim();
  if (prior && proposed && prior !== proposed) {
    next.contradictions = [
      ...next.contradictions,
      {
        field: proposal.field,
        userValue: String((next as any)[proposal.field]),
        engineValue: String(proposal.value),
        engineSource: proposal.source,
      },
    ];
  }
  return next;
}

function inputSourceFlagForSource(source: string): keyof BusinessProfile["inputSources"] | null {
  if (source.startsWith("mi_snapshot")) return "miSnapshot";
  if (source.startsWith("audience_snapshot")) return "audienceSnapshot";
  if (source.startsWith("positioning_snapshot")) return "positioningSnapshot";
  if (source.startsWith("differentiation_snapshot")) return "differentiationSnapshot";
  if (source.startsWith("mechanism_snapshot")) return "mechanismSnapshot";
  if (source.startsWith("offer_snapshot")) return "offerSnapshot";
  if (source.startsWith("funnel_snapshot")) return "funnelSnapshot";
  if (source.startsWith("persuasion_snapshot")) return "persuasionSnapshot";
  if (source.startsWith("integrity_snapshot")) return "integritySnapshot";
  return null;
}

function mergeBottlenecks(prior: string[], add: string[]): string[] {
  const seen = new Set(prior);
  const out = [...prior];
  for (const b of add) {
    if (!seen.has(b)) {
      seen.add(b);
      out.push(b);
    }
  }
  return out;
}

// ============================================================================
// Public stage enrichers.
// ============================================================================

/**
 * Stage 2 — fold in engines 1–6. Tolerates any subset of snapshots being
 * absent (sparse-data tolerance is mandatory).
 */
export function enrichStage2Profile(
  stage1: BusinessProfile,
  snapshots: SnapshotBundle,
): BusinessProfile {
  let next: BusinessProfile = { ...stage1, stage: 2 };

  const allProposals: EnrichmentProposal[] = [];
  let extraBottlenecks: string[] = [];

  if (snapshots.mi) {
    const r = readMiSnapshot(snapshots.mi);
    allProposals.push(...r.proposals);
    extraBottlenecks = mergeBottlenecks(extraBottlenecks, r.bottlenecks);
    next.inputSources = { ...next.inputSources, miSnapshot: true };
  }
  if (snapshots.audience) {
    const r = readAudienceSnapshot(snapshots.audience);
    allProposals.push(...r.proposals);
    extraBottlenecks = mergeBottlenecks(extraBottlenecks, r.bottlenecks);
    next.inputSources = { ...next.inputSources, audienceSnapshot: true };
  }
  if (snapshots.positioning || snapshots.differentiation) {
    const r = readPositioningDiffSnapshot(snapshots.positioning ?? null, snapshots.differentiation ?? null);
    allProposals.push(...r.proposals);
    extraBottlenecks = mergeBottlenecks(extraBottlenecks, r.bottlenecks);
    if (snapshots.positioning) next.inputSources = { ...next.inputSources, positioningSnapshot: true };
    if (snapshots.differentiation) next.inputSources = { ...next.inputSources, differentiationSnapshot: true };
  }
  if (snapshots.mechanism) {
    // Mechanism is a businessModel reinforcer only — we don't propose a
    // value override (the user's industry slug + onboarding data are
    // primary). Flag the source consulted.
    next.inputSources = { ...next.inputSources, mechanismSnapshot: true };
  }
  if (snapshots.offer) {
    const r = readOfferSnapshot(snapshots.offer);
    allProposals.push(...r.proposals);
    extraBottlenecks = mergeBottlenecks(extraBottlenecks, r.bottlenecks);
    next.inputSources = { ...next.inputSources, offerSnapshot: true };
  }

  for (const p of allProposals) {
    next = applyProposal(next, p);
  }

  next.growthBottlenecks = mergeBottlenecks(next.growthBottlenecks, extraBottlenecks);
  next.unknownFields = recomputeUnknowns(next);
  next.confidence = recomputeConfidence(next);

  // If businessModel was UNKNOWN at Stage 1 but Stage 2 now has enough
  // subIndustry / offer text to re-detect a model, retry the detection.
  if (next.businessModel === "unknown") {
    const reModel = detectBusinessModel({
      industry: next.industry === "unknown" ? null : next.industry,
      businessType: null,
      coreOffer: next.offerType,
      productCategory: next.subIndustry,
    });
    if (reModel !== "unknown") {
      next.businessModel = reModel;
      next.commercialLens = LENS_BY_MODEL[reModel];
      next.reasoningFramework = FRAMEWORK_BY_MODEL[reModel];
      if (!next.engineDerivedFields.includes("businessModel")) {
        next.engineDerivedFields = [...next.engineDerivedFields, "businessModel"];
      }
      next.unknownFields = recomputeUnknowns(next);
      next.confidence = recomputeConfidence(next);
    }
  }

  logStage(next);
  return next;
}

/**
 * Stage 3 — fold in funnel/persuasion/integrity. Same invariants as
 * Stage 2: tolerant of missing snapshots, deterministic, additive only.
 */
export function enrichStage3Profile(
  stage2: BusinessProfile,
  snapshots: SnapshotBundle,
): BusinessProfile {
  let next: BusinessProfile = { ...stage2, stage: 3 };

  const allProposals: EnrichmentProposal[] = [];
  let extraBottlenecks: string[] = [];
  let trustRepair = false;

  if (snapshots.funnel) {
    const r = readFunnelSnapshot(snapshots.funnel);
    allProposals.push(...r.proposals);
    extraBottlenecks = mergeBottlenecks(extraBottlenecks, r.bottlenecks);
    next.inputSources = { ...next.inputSources, funnelSnapshot: true };
  }
  if (snapshots.persuasion) {
    const r = readPersuasionSnapshot(snapshots.persuasion);
    allProposals.push(...r.proposals);
    extraBottlenecks = mergeBottlenecks(extraBottlenecks, r.bottlenecks);
    next.inputSources = { ...next.inputSources, persuasionSnapshot: true };
  }
  if (snapshots.integrity) {
    const r = readIntegritySnapshot(snapshots.integrity);
    extraBottlenecks = mergeBottlenecks(extraBottlenecks, r.bottlenecks);
    if (r.trustRepairFlag) trustRepair = true;
    next.inputSources = { ...next.inputSources, integritySnapshot: true };
  }

  for (const p of allProposals) {
    next = applyProposal(next, p);
  }

  next.growthBottlenecks = mergeBottlenecks(next.growthBottlenecks, extraBottlenecks);
  if (trustRepair) {
    next.growthBottlenecks = mergeBottlenecks(next.growthBottlenecks, ["trust_repair_required"]);
  }
  next.unknownFields = recomputeUnknowns(next);
  next.confidence = recomputeConfidence(next);

  logStage(next);
  return next;
}

function logStage(p: BusinessProfile): void {
  // No try/catch — `console.log` only throws on broken stdout, in which
  // case the whole orchestrator is already unrecoverable. A silent catch
  // here would mask a real outage (Seal #15).
  console.log(
    `[BCL] STAGE=${p.stage} model=${p.businessModel} lens=${p.reasoningFramework.name} confidence=${p.confidence.toFixed(2)} unknown=${p.unknownFields.length} engineDerived=[${p.engineDerivedFields.join(",")}] contradictions=${p.contradictions.length}`,
  );
}

// ============================================================================
// DB loaders.
// ============================================================================

async function loadLatestRow<T>(
  query: () => Promise<T[]>,
  label: string,
): Promise<T | null> {
  try {
    const rows = await query();
    return rows[0] ?? null;
  } catch (err) {
    console.error(`[BCL] LOAD_FAILED_NONFATAL source=${label}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Stage-1 DB loader. Looks up the latest `business_data_layer` row +
 * (optionally) the latest `content_dna` summary for `(accountId,
 * campaignId)`. Missing rows → slug-only profile. Never throws.
 */
export async function loadStage1ProfileFor(args: {
  accountId: string;
  campaignId: string;
  industry?: string | null;
  productDnaSummary?: string | null;
}): Promise<BusinessProfile> {
  const bd = await loadLatestRow(
    () =>
      db
        .select()
        .from(businessDataLayer)
        .where(
          and(
            eq(businessDataLayer.accountId, args.accountId),
            eq(businessDataLayer.campaignId, args.campaignId),
          ),
        )
        .orderBy(desc(businessDataLayer.updatedAt))
        .limit(1),
    "business_data_layer",
  );

  // ProductDNA — caller may supply an already-computed summary string; if
  // not, fall back to the latest content_dna row's narrativeDna or
  // messagingCore as a coarse summary. Best-effort, never blocks.
  let productDnaSummary = clean(args.productDnaSummary ?? null);
  if (!productDnaSummary) {
    const dna = await loadLatestRow(
      () =>
        db
          .select()
          .from(contentDna)
          .where(
            and(
              eq(contentDna.accountId, args.accountId),
              eq(contentDna.campaignId, args.campaignId),
            ),
          )
          .orderBy(desc(contentDna.generatedAt))
          .limit(1),
      "content_dna",
    );
    if (dna) {
      productDnaSummary = clean(dna.narrativeDna) ?? clean(dna.messagingCore) ?? null;
    }
  }

  const stage1 = buildStage1Profile({
    industry: args.industry ?? null,
    businessData: bd,
    productDnaSummary,
  });
  logStage(stage1);
  return stage1;
}

/** Back-compat alias — old call sites used `loadBusinessProfileFor`. */
export const loadBusinessProfileFor = loadStage1ProfileFor;

/**
 * Stage-2 snapshot loader. Fetches the latest snapshot per engine for
 * `(accountId, campaignId)`. If a `jobId` is supplied, prefers
 * snapshots from that run; otherwise falls back to the most recent.
 * Tolerant of missing tables / empty rows.
 */
export async function loadStage2SnapshotsFor(args: {
  accountId: string;
  campaignId: string;
  jobId?: string | null;
}): Promise<SnapshotBundle> {
  const { accountId, campaignId, jobId } = args;
  const jobScoped = jobId && jobId.trim().length > 0 ? jobId : null;

  // Per-engine loader: prefer job-scoped row when `jobScoped` set,
  // FALL BACK to most-recent for (accountId, campaignId) on miss. This
  // matches the documented "prefer jobId, fallback to latest" semantics
  // — a strict job-only query would return null for engines that ran in
  // an earlier orchestration (e.g. when this orchestrator run only
  // re-executed a sibling engine subset).
  async function loadEngineSnapshot<T extends { accountId: any; campaignId: any; jobId: any; createdAt: any }>(
    table: T,
    label: string,
  ) {
    if (jobScoped) {
      const scoped = await loadLatestRow(
        () =>
          db
            .select()
            .from(table as any)
            .where(
              and(
                eq((table as any).accountId, accountId),
                eq((table as any).campaignId, campaignId),
                eq((table as any).jobId, jobScoped),
              ),
            )
            .orderBy(desc((table as any).createdAt))
            .limit(1),
        `${label}#job`,
      );
      if (scoped) return scoped;
    }
    return loadLatestRow(
      () =>
        db
          .select()
          .from(table as any)
          .where(and(eq((table as any).accountId, accountId), eq((table as any).campaignId, campaignId)))
          .orderBy(desc((table as any).createdAt))
          .limit(1),
      `${label}#latest`,
    );
  }

  const [mi, audience, positioning, differentiation, mechanism, offer] = await Promise.all([
    loadEngineSnapshot(miSnapshots as any, "mi_snapshots"),
    loadEngineSnapshot(audienceSnapshots as any, "audience_snapshots"),
    loadEngineSnapshot(positioningSnapshots as any, "positioning_snapshots"),
    loadEngineSnapshot(differentiationSnapshots as any, "differentiation_snapshots"),
    loadEngineSnapshot(mechanismSnapshots as any, "mechanism_snapshots"),
    loadEngineSnapshot(offerSnapshots as any, "offer_snapshots"),
  ]);

  return { mi: mi as any, audience: audience as any, positioning: positioning as any, differentiation: differentiation as any, mechanism: mechanism as any, offer: offer as any };
}

/** Stage-3 snapshot loader. Funnel + persuasion + integrity. */
export async function loadStage3SnapshotsFor(args: {
  accountId: string;
  campaignId: string;
  jobId?: string | null;
}): Promise<SnapshotBundle> {
  const { accountId, campaignId, jobId } = args;
  const jobScoped = jobId && jobId.trim().length > 0 ? jobId : null;

  // Prefer job-scoped, fall back to latest. Matches Stage-2 loader semantics.
  async function loadEngineSnapshot<T extends { accountId: any; campaignId: any; jobId: any; createdAt: any }>(
    table: T,
    label: string,
  ) {
    if (jobScoped) {
      const scoped = await loadLatestRow(
        () =>
          db
            .select()
            .from(table as any)
            .where(
              and(
                eq((table as any).accountId, accountId),
                eq((table as any).campaignId, campaignId),
                eq((table as any).jobId, jobScoped),
              ),
            )
            .orderBy(desc((table as any).createdAt))
            .limit(1),
        `${label}#job`,
      );
      if (scoped) return scoped;
    }
    return loadLatestRow(
      () =>
        db
          .select()
          .from(table as any)
          .where(and(eq((table as any).accountId, accountId), eq((table as any).campaignId, campaignId)))
          .orderBy(desc((table as any).createdAt))
          .limit(1),
      `${label}#latest`,
    );
  }

  const [funnel, persuasion, integrity] = await Promise.all([
    loadEngineSnapshot(funnelSnapshots as any, "funnel_snapshots"),
    loadEngineSnapshot(persuasionSnapshots as any, "persuasion_snapshots"),
    loadEngineSnapshot(integritySnapshots as any, "integrity_snapshots"),
  ]);

  return { funnel: funnel as any, persuasion: persuasion as any, integrity: integrity as any };
}

// ============================================================================
// Prompt rendering.
// ============================================================================

/**
 * Render the profile as a structured block for the LLM prompt. Order
 * matters: the awareness interpreter places this block BEFORE the
 * evidence corpus so the model reads the business + lens first.
 */
export function renderBusinessProfileForPrompt(profile: BusinessProfile): string {
  return JSON.stringify(
    {
      stage: profile.stage,
      industry: profile.industry,
      sub_industry: profile.subIndustry,
      business_model: profile.businessModel,
      target_customer: profile.targetCustomer,
      buyer_type: profile.buyerType,
      offer_type: profile.offerType,
      pricing_complexity: profile.pricingComplexity,
      funnel_type: profile.funnelType,
      growth_bottlenecks: profile.growthBottlenecks,
      commercial_lens: profile.commercialLens,
      reasoning_framework: profile.reasoningFramework,
      profile_confidence: profile.confidence,
      unknown_fields: profile.unknownFields,
      engine_derived_fields: profile.engineDerivedFields,
      contradictions: profile.contradictions,
    },
    null,
    2,
  );
}
