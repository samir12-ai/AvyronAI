/**
 * Phase 4-B-prep — Business Context Layer (BCL).
 *
 * Deterministic, LLM-free preprocessor that runs BEFORE the awareness
 * commercial reasoner. Consumes the user's manual `business_data_layer`
 * row plus the industry slug and emits a structured `BusinessProfile`
 * that includes an auto-selected `commercialLens` and `reasoningFramework`.
 *
 * Why deterministic: the user's stated requirement is that no business
 * assumptions may be hallucinated. An LLM-driven profile builder would
 * violate that. Every field in `BusinessProfile` either comes from the
 * user's manual input, is derived by a documented rule from that input,
 * or is explicitly listed under `unknownFields[]` (B4 — explicit
 * classification over hidden ambiguity).
 *
 * The layer is additive. It produces a profile object the interpreter
 * injects into the LLM prompt BEFORE the evidence corpus, but the
 * existing integrity gates, AT4 language grounding, deterministic floor,
 * industry allowlist, and kill-switch all remain authoritative.
 */

import { eq, and, desc } from "drizzle-orm";
import { db } from "../db";
import { businessDataLayer, type BusinessDataLayer } from "../../shared/schema";

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
  /** Primary commercial levers this kind of business pulls. */
  primaryLevers: string[];
  /** Market-dynamic patterns the LLM should weigh first. */
  marketDynamics: string[];
  /** Buyer psychology cues that govern persuasion. */
  buyerPsychology: string[];
}

export interface ReasoningFramework {
  /** Human-readable framework name. */
  name: string;
  /** Output fields the LLM should weight most heavily. */
  emphasizeFields: string[];
  /** Signal categories that don't apply to this business model. */
  deprioritizeSignals: string[];
}

export interface BusinessProfile {
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
  /** 0-1 — how much of the profile is grounded in manual user input vs derived. */
  confidence: number;
  /** Canonical field names the layer could not determine from inputs. */
  unknownFields: string[];
  /** Provenance of each input source consulted. */
  inputSources: {
    manualUserData: boolean;
    productDna: boolean;
    industrySlug: boolean;
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
  // FIX (architect HIGH #1): `_` is a word char so `\b` does not separate
  // `saas` inside `b2b_saas`. Normalize slug separators to spaces BEFORE
  // applying word-boundary regex so canonical slugs (b2b_saas, dtc_ecom,
  // local_services) match their model.
  const blob = raw.replace(/[_-]+/g, " ");
  // Order matters: more specific patterns first.
  if (/\b(saas|software|platform|api|cloud tool|web app)\b/.test(blob)) return "saas";
  if (/\b(marketplace|two[ ]sided|aggregator)\b/.test(blob)) return "marketplace";
  if (/\b(agency|consult|coach|freelance|done[ ]for[ ]you|dfy)\b/.test(blob)) return "agency_consulting";
  if (/\b(dental|clinic|salon|spa|restaurant|repair|plumb|hvac|locksmith|gym|studio|local service|local services|home service)\b/.test(blob)) return "local_service";
  if (/\b(ecom|ecommerce|dtc|d2c|shop|store|retail|apparel|cpg|product line|skincare|cosmetic|fashion)\b/.test(blob)) return "dtc_ecommerce";
  return "unknown";
}

function detectBuyerType(args: {
  model: BusinessModel;
  decisionMaker: string | null;
  audienceSegment: string | null;
}): BuyerType {
  // FIX (architect HIGH #2): NEVER fabricate a buyer type from the model
  // alone — that is a hallucinated business assumption. Require direct
  // textual evidence in decisionMaker / audienceSegment. When absent,
  // return "unknown" so the field surfaces in unknownFields[] and
  // confidence drops accordingly.
  const dm = (args.decisionMaker ?? "").toLowerCase();
  const seg = (args.audienceSegment ?? "").toLowerCase();
  const combined = `${dm} ${seg}`;
  if (!combined.trim()) return "unknown";
  if (/\b(committee|vp|chief|cro|cmo|cto|director|head of|buying committee|stakeholder|enterprise buyer)\b/.test(combined)) {
    return "committee";
  }
  if (/\b(walk[- ]in|drop[- ]in|same[- ]day)\b/.test(combined)) {
    return "walk_in";
  }
  if (/\b(self[- ]serve|self[- ]signup|product[- ]led|free trial signup|solo|founder|smb owner)\b/.test(combined)) {
    return "self_serve";
  }
  if (/\b(consumer|customer|shopper|patient|individual|end user|buyer|household|family)\b/.test(combined)) {
    return "consumer";
  }
  return "unknown";
}

function detectPricingComplexity(args: {
  model: BusinessModel;
  priceRange: string | null;
}): PricingComplexity {
  // FIX (architect HIGH #2): require concrete pricing evidence. With no
  // price string at all, return "unknown" rather than guessing from model.
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
  // String present but no $ amount and no recurring keyword — can't classify honestly.
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

/**
 * Pure deterministic profile builder. Never queries the DB, never calls
 * an LLM. Used directly by tests and by `loadBusinessProfileFor`.
 */
export function buildBusinessProfile(input: BuildBusinessProfileInput): BusinessProfile {
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
  const buyer = detectBuyerType({
    model,
    decisionMaker,
    audienceSegment: targetSegment,
  });
  const pricing = detectPricingComplexity({ model, priceRange });

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

  // Confidence: fraction of canonical input fields that were grounded in
  // manual user data (8 canonical fields tracked above).
  const totalCanonical = 8;
  const grounded = totalCanonical - unknownFields.length;
  const confidence = Math.max(0, Math.min(1, grounded / totalCanonical));

  return {
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
    inputSources: {
      manualUserData: Boolean(bd),
      productDna: Boolean(clean(input.productDnaSummary ?? null)),
      industrySlug: Boolean(industrySlug),
    },
  };
}

/**
 * DB-loader convenience. Looks up the latest `business_data_layer` row
 * for `(accountId, campaignId)` and feeds it into `buildBusinessProfile`.
 * Missing row → slug-only profile. Never throws.
 */
export async function loadBusinessProfileFor(args: {
  accountId: string;
  campaignId: string;
  industry?: string | null;
  productDnaSummary?: string | null;
}): Promise<BusinessProfile> {
  let businessData: BusinessDataLayer | null = null;
  try {
    const rows = await db
      .select()
      .from(businessDataLayer)
      .where(
        and(
          eq(businessDataLayer.accountId, args.accountId),
          eq(businessDataLayer.campaignId, args.campaignId),
        ),
      )
      .orderBy(desc(businessDataLayer.updatedAt))
      .limit(1);
    businessData = rows[0] ?? null;
  } catch (err) {
    console.error("[BusinessContextLayer] LOAD_FAILED_NONFATAL", {
      accountId: args.accountId,
      campaignId: args.campaignId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return buildBusinessProfile({
    industry: args.industry ?? null,
    businessData,
    productDnaSummary: args.productDnaSummary ?? null,
  });
}

/**
 * Render the profile as a structured block for the LLM prompt. The
 * interpreter places this block BEFORE the evidence corpus so the model
 * reads the business + lens first, then interprets evidence through that
 * lens.
 */
export function renderBusinessProfileForPrompt(profile: BusinessProfile): string {
  return JSON.stringify(
    {
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
    },
    null,
    2,
  );
}
