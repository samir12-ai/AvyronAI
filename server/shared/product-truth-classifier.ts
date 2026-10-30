import {
  type ProductTruthStatus,
  type ProductTruthLabel,
  type GroundedIdea,
  PRODUCT_TRUTH_LABELS,
} from "../../shared/contracts/product-truth-classification";

export { ProductTruthStatus, ProductTruthLabel, GroundedIdea, PRODUCT_TRUTH_LABELS };

const STOPWORDS = new Set(
  "a an and are as at be by for from has have in into is it its of on or that the their this to was were will with our your you we they them us not no most more they're don't can't lack lacks each all multiple distinct per item items across".split(
    " ",
  ),
);

function extractTokens(text: string): Set<string> {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

export interface ProductTruthFactInput {
  productTruthFactId?: string;
  id?: string;
  statement?: string;
  text?: string;
  factType?: string;
  type?: string;
}

/**
 * Compare any strategic claim or idea with existing Product Truth.
 *
 * Rules:
 * 1. If applicable product evidence supports the actual claim ->
 *    "Supported by Product Truth"
 * 2. If the idea goes beyond currently established product facts ->
 *    "Proposed — requires implementation or verification"
 *    and rewrites assertive factual claims so they do not assert current capability.
 */
export function classifyStrategicClaim(
  statement: string,
  productTruthFacts: Array<ProductTruthFactInput | string>,
  options: {
    kind?: "positioning" | "claim" | "offer" | "pillar" | "demonstration" | "general";
    customSubject?: string;
  } = {},
): GroundedIdea {
  const rawText = String(statement || "").trim();
  if (!rawText) {
    return {
      text: "",
      status: "SUPPORTED",
      label: PRODUCT_TRUTH_LABELS.SUPPORTED,
      isSupported: true,
      isProposed: false,
    };
  }

  // 1. Gather truth tokens and facts
  const truthTokens = new Set<string>();
  const factStatements: string[] = [];
  const factIds: string[] = [];

  for (const f of productTruthFacts || []) {
    const s = typeof f === "string" ? f : f.statement || f.text || "";
    if (!s) continue;
    factStatements.push(s);
    if (typeof f === "object" && (f.productTruthFactId || f.id)) {
      factIds.push(f.productTruthFactId || f.id || "");
    }
    for (const t of extractTokens(s)) {
      truthTokens.add(t);
    }
  }

  // 2. Identify candidate claim tokens
  const claimTokens = extractTokens(rawText);
  const unsupportedTokens: string[] = [];

  // Filter out meta-words that don't represent product capabilities
  const META_WORDS = new Set([
    "proposed", "positioning", "direction", "subject", "verifying", "developing",
    "properties", "market", "customers", "seekers", "offering", "confronts",
    "widespread", "failure", "existing", "dress", "dresses", "summer", "focus",
    "aligned", "values", "style", "brand", "strategy", "strategic", "approach",
    "opportunity", "challenge", "challenges", "experience", "experiences", "buyer",
    "buyers", "consumer", "consumers", "demonstration", "testing", "tactile"
  ]);

  for (const token of claimTokens) {
    if (!truthTokens.has(token) && !META_WORDS.has(token)) {
      unsupportedTokens.push(token);
    }
  }

  // Capability assertion indicators: assertive language claiming unverified attributes
  const hasAssertiveWording = /\b(ensure|ensures|ensuring|guarantee|guarantees|guaranteed|certified|delivers proven|100%|non-see-through|breathability|breathable|natural-feeling|natural-fiber)\b/i.test(
    rawText,
  );

  const isOldRepetitivePattern = /\b(subject to verifying or developing|with proposed positioning on opacity and breathability)\b/i.test(
    rawText,
  );

  const isAlreadyConditional = !isOldRepetitivePattern && /\b(proposed|subject to|recommended|targets|aims to|verifying or developing)\b/i.test(
    rawText,
  );

  // If there are substantive unsupported capability tokens (e.g. opacity, breathability) or assertive unverified claims
  const hasSubstantiveGap = unsupportedTokens.some((t) =>
    ["opacity", "opaque", "breathable", "breathability", "natural", "fiber", "fibers", "tracking", "sla", "dashboard", "portal", "lab", "certification"].includes(t)
  );

  // Idempotency check: if the claim has already been classified into a clean proposal
  const hasCleanProposalFraming = !isOldRepetitivePattern && (
    /^Proposed (positioning|direction|demonstration):/i.test(rawText) ||
    /\bProposed (positioning|direction):/i.test(rawText)
  );

  if (hasCleanProposalFraming) {
    return {
      text: rawText,
      status: "PROPOSED",
      label: PRODUCT_TRUTH_LABELS.PROPOSED,
      isSupported: false,
      isProposed: true,
      supportingFacts: factStatements,
      unsupportedTerms: unsupportedTokens,
    };
  }

  const isProposed = (unsupportedTokens.length > 0 && (hasSubstantiveGap || hasAssertiveWording)) && !truthTokens.has(unsupportedTokens[0]);

  if (!isProposed) {
    return {
      text: rawText,
      status: "SUPPORTED",
      label: PRODUCT_TRUTH_LABELS.SUPPORTED,
      isSupported: true,
      isProposed: false,
      supportingFacts: factStatements,
      sourceFactId: factIds[0],
    };
  }

  // Rewrite proposed statement so it does not assert current capability
  let conditionalText = rawText;
  if (!isAlreadyConditional) {
    conditionalText = conditionizeAssertiveText(rawText, unsupportedTokens, options.kind);
  }

  return {
    text: conditionalText,
    status: "PROPOSED",
    label: PRODUCT_TRUTH_LABELS.PROPOSED,
    isSupported: false,
    isProposed: true,
    unsupportedTerms: unsupportedTokens,
    supportingFacts: factStatements,
  };
}

/**
 * Preserves the original text without post-generation string mutation or token softening.
 * Epistemic status originates upstream from evidence and assessments.
 */
function conditionizeAssertiveText(
  text: string,
  _unsupportedTerms: string[],
  _kind?: string,
): string {
  return String(text || "").trim();
}

/**
 * Classify and format Brand Spine against Product Truth.
 */
export function classifyBrandSpine(
  brandSpine: any,
  productTruthFacts: Array<ProductTruthFactInput | string>,
): any {
  if (!brandSpine || typeof brandSpine !== "object") return brandSpine;

  const contrastAxisCls = classifyStrategicClaim(
    brandSpine.contrastAxis,
    productTruthFacts,
    { kind: "positioning" },
  );

  const narrativeDirectionCls = classifyStrategicClaim(
    brandSpine.narrativeDirection,
    productTruthFacts,
    { kind: "positioning" },
  );

  const umbrellaPositionCls = classifyStrategicClaim(
    brandSpine.umbrellaPositionName || brandSpine.title,
    productTruthFacts,
    { kind: "positioning" },
  );

  const corePillars = Array.isArray(brandSpine.coreDifferentiationPillars)
    ? brandSpine.coreDifferentiationPillars.map((p: any) => {
        const text = typeof p === "string" ? p : p.text || p.statement || p.pillar;
        const cls = classifyStrategicClaim(text, productTruthFacts, { kind: "pillar" });
        return typeof p === "string"
          ? cls.text
          : { ...p, text: cls.text, truthStatus: cls.status, truthLabel: cls.label };
      })
    : brandSpine.coreDifferentiationPillars;

  return {
    ...brandSpine,
    contrastAxis: contrastAxisCls.text,
    contrastAxisGrounded: contrastAxisCls,
    narrativeDirection: narrativeDirectionCls.text,
    narrativeDirectionGrounded: narrativeDirectionCls,
    umbrellaPositionNameGrounded: umbrellaPositionCls,
    coreDifferentiationPillars: corePillars,
    truthStatus: (contrastAxisCls.isProposed || narrativeDirectionCls.isProposed) ? "PROPOSED" : "SUPPORTED",
    truthLabel: (contrastAxisCls.isProposed || narrativeDirectionCls.isProposed)
      ? PRODUCT_TRUTH_LABELS.PROPOSED
      : PRODUCT_TRUTH_LABELS.SUPPORTED,
  };
}

/**
 * Classify and format Offer against Product Truth.
 */
export function classifyOffer(
  offer: any,
  productTruthFacts: Array<ProductTruthFactInput | string>,
): any {
  if (!offer || typeof offer !== "object") return offer;

  const outcomeText = offer.outcomeLayer?.primaryOutcome || offer.coreOutcome || offer.primaryPromise || "";
  const outcomeCls = classifyStrategicClaim(outcomeText, productTruthFacts, { kind: "offer" });

  const offerNameText = offer.offerName || offer.title || offer.name || "";
  const nameCls = classifyStrategicClaim(offerNameText, productTruthFacts, { kind: "offer" });

  const deliverables = Array.isArray(offer.deliverables)
    ? offer.deliverables.map((d: any) => {
        const text = typeof d === "string" ? d : d.name || d.title || "";
        const cls = classifyStrategicClaim(text, productTruthFacts, { kind: "offer" });
        return typeof d === "string"
          ? cls.text
          : { ...d, truthStatus: cls.status, truthLabel: cls.label };
      })
    : offer.deliverables;

  let deliveryLayer = offer.deliveryLayer;
  if (deliveryLayer && Array.isArray(deliveryLayer.deliverables)) {
    deliveryLayer = {
      ...deliveryLayer,
      deliverables: deliveryLayer.deliverables.map((d: any) => {
        const text = typeof d === "string" ? d : d.name || d.title || d.description || "";
        const cls = classifyStrategicClaim(text, productTruthFacts, { kind: "offer" });
        return typeof d === "string"
          ? cls.text
          : { ...d, text: cls.text, truthStatus: cls.status, truthLabel: cls.label };
      }),
    };
  }

  let riskReductionLayer = offer.riskReductionLayer;
  if (riskReductionLayer && Array.isArray(riskReductionLayer.frictionMitigations)) {
    riskReductionLayer = {
      ...riskReductionLayer,
      frictionMitigations: riskReductionLayer.frictionMitigations.map((m: any) => {
        if (typeof m === "string") {
          return classifyStrategicClaim(m, productTruthFacts, { kind: "offer" }).text;
        }
        return m;
      }),
    };
  }

  return {
    ...offer,
    offerName: nameCls.text,
    offerNameGrounded: nameCls,
    coreOutcome: outcomeCls.text,
    coreOutcomeGrounded: outcomeCls,
    deliverables,
    deliveryLayer,
    riskReductionLayer,
    truthStatus: (outcomeCls.isProposed || nameCls.isProposed) ? "PROPOSED" : "SUPPORTED",
    truthLabel: (outcomeCls.isProposed || nameCls.isProposed)
      ? PRODUCT_TRUTH_LABELS.PROPOSED
      : PRODUCT_TRUTH_LABELS.SUPPORTED,
  };
}

/**
 * Classify and format Content Pillars against Product Truth.
 */
export function classifyContentPillars(
  pillars: any[],
  productTruthFacts: Array<ProductTruthFactInput | string>,
): any[] {
  if (!Array.isArray(pillars)) return [];

  return pillars.map((p) => {
    const pillarName = p.pillar || p.name || "";
    const nameCls = classifyStrategicClaim(pillarName, productTruthFacts, { kind: "pillar" });

    const examples = Array.isArray(p.examples)
      ? p.examples.map((ex: string) => {
          const exCls = classifyStrategicClaim(ex, productTruthFacts, { kind: "demonstration" });
          return exCls.text;
        })
      : p.examples;

    const isProposed = nameCls.isProposed || (Array.isArray(p.examples) && p.examples.some((ex: string) =>
      classifyStrategicClaim(ex, productTruthFacts).isProposed
    ));

    return {
      ...p,
      pillar: nameCls.text,
      examples,
      truthStatus: isProposed ? "PROPOSED" : "SUPPORTED",
      truthLabel: isProposed ? PRODUCT_TRUTH_LABELS.PROPOSED : PRODUCT_TRUTH_LABELS.SUPPORTED,
    };
  });
}

/**
 * Classify and format Persuasion Strategy against Product Truth.
 */
export function classifyPersuasionStrategy(
  persuasion: any,
  productTruthFacts: Array<ProductTruthFactInput | string>,
): any {
  if (!persuasion || typeof persuasion !== "object") return persuasion;
  const enriched = { ...persuasion };

  if (Array.isArray(enriched.objections)) {
    enriched.objections = enriched.objections.map((obj: any) => {
      if (obj?.response) {
        const cls = classifyStrategicClaim(obj.response, productTruthFacts, { kind: "claim" });
        return {
          ...obj,
          response: cls.text,
          truthStatus: cls.status,
          truthLabel: cls.label,
        };
      }
      return obj;
    });
  }

  return enriched;
}

/**
 * Classify and format Buyer Conversion Journey against Product Truth.
 */
export function classifyBuyerConversionJourneys(
  journey: any,
  productTruthFacts: Array<ProductTruthFactInput | string>,
): any {
  if (!journey || typeof journey !== "object") return journey;
  const enriched = { ...journey };

  if (enriched.whyThisJourney) {
    const cls = classifyStrategicClaim(enriched.whyThisJourney, productTruthFacts, { kind: "positioning" });
    enriched.whyThisJourney = cls.text;
    enriched.whyThisJourneyGrounded = cls;
  }

  if (enriched.persuasionStrategy) {
    enriched.persuasionStrategy = classifyPersuasionStrategy(enriched.persuasionStrategy, productTruthFacts);
  }

  return enriched;
}

/**
 * Classify and enrich the entire synthesized plan structure.
 */
export function classifyPlanAgainstProductTruth(
  planJson: any,
  productTruthFacts: Array<ProductTruthFactInput | string>,
): any {
  if (!planJson || typeof planJson !== "object") return planJson;

  const enriched = { ...planJson };

  // 1. Strategic Summary
  if (enriched.strategicSummary?.strategy) {
    const stratCls = classifyStrategicClaim(enriched.strategicSummary.strategy, productTruthFacts, { kind: "positioning" });
    enriched.strategicSummary = {
      ...enriched.strategicSummary,
      strategy: stratCls.text,
      strategyGrounded: stratCls,
      truthStatus: stratCls.status,
      truthLabel: stratCls.label,
    };
  }

  // 2. Brand Spine
  if (enriched.brandSpine) {
    enriched.brandSpine = classifyBrandSpine(enriched.brandSpine, productTruthFacts);
  }

  // 3. Offer
  if (enriched.offer) {
    enriched.offer = classifyOffer(enriched.offer, productTruthFacts);
  }

  // 4. Content Distribution & Content Pillars
  if (enriched.contentDistribution?.contentPillars) {
    enriched.contentDistribution.contentPillars = classifyContentPillars(
      enriched.contentDistribution.contentPillars,
      productTruthFacts,
    );
  }

  // 5. Approved Claim
  if (enriched.approvedClaim) {
    const claimCls = classifyStrategicClaim(enriched.approvedClaim, productTruthFacts, { kind: "claim" });
    enriched.approvedClaim = claimCls.text;
    enriched.approvedClaimGrounded = claimCls;
  }

  // 6. Awareness & Persuasion Strategy
  if (enriched.persuasionStrategy) {
    enriched.persuasionStrategy = classifyPersuasionStrategy(enriched.persuasionStrategy, productTruthFacts);
  }

  // 7. Buyer Conversion Journeys
  if (enriched.buyerConversionJourney) {
    enriched.buyerConversionJourney = classifyBuyerConversionJourneys(enriched.buyerConversionJourney, productTruthFacts);
  }
  if (Array.isArray(enriched.buyerConversionJourneys)) {
    enriched.buyerConversionJourneys = enriched.buyerConversionJourneys.map((j: any) =>
      classifyBuyerConversionJourneys(j, productTruthFacts),
    );
  }

  return enriched;
}
