import crypto from "crypto";
import { z } from "zod";

/**
 * ============================================================================
 * STRATEGIC DOCTRINE — "AI Proposes, Code Validates" (Phase 0 foundation)
 * ============================================================================
 *
 * The doctrine is the shared reasoning frame injected into every generation
 * prompt so the AI proposes candidate strategy outputs at the level of the
 * campaign's SPECIFIC product (the product_anchor), never the generic business
 * category. Deterministic code gates remain the sole judges of every candidate
 * (see server/shared/interchangeability-judge.ts and the per-engine gates).
 *
 * CROSS-CUTTING RESOLUTION RULE (see RESOLUTION_RULE): a claim that would hold
 * unchanged for a generic competitor in the same category is INVALID.
 *
 * PRICING EXCLUSION (see PRICING_EXCLUSION): pricing is NEVER derived from the
 * doctrine principles — it is user-supplied context only.
 *
 * DOCTRINE VERSIONING: DOCTRINE_VERSION is threaded into every engine input
 * hash (alongside sha256(product_anchor)) so editing the anchor OR bumping the
 * doctrine invalidates cached engine snapshots. Bump this on any change to the
 * principles, resolution rule, or block-rendering shape.
 */
export const DOCTRINE_VERSION = "doctrine-v1";

// ---------------------------------------------------------------------------
// Product Anchor — per-campaign specific product identity
// ---------------------------------------------------------------------------

export interface ProductAnchor {
  name: string;
  type: string;
  offeringType?: string;
  keyAttributes: string[];
  coreProblemSolved: string;
  differentiatingFeature: string;
  productSpecs?: string[];
  customerUseCases?: string[];
  problemSolved?: string;
  uniqueMechanism?: string;
  strategicAdvantage?: string;
  alternativeReplaced?: string;
  sourceFacts?: any[];
}

export const ProductAnchorSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  offeringType: z.string().optional(),
  keyAttributes: z.array(z.string()).default([]),
  coreProblemSolved: z.string().min(1),
  differentiatingFeature: z.string().min(1),
  productSpecs: z.array(z.string()).optional(),
  customerUseCases: z.array(z.string()).optional(),
  problemSolved: z.string().optional(),
  uniqueMechanism: z.string().optional(),
  strategicAdvantage: z.string().optional(),
  alternativeReplaced: z.string().optional(),
  sourceFacts: z.array(z.any()).optional(),
});

// ---------------------------------------------------------------------------
// Doctrine resolution level (D3 — strict enum, never a silent substitute)
// ---------------------------------------------------------------------------

export const DoctrineResolutionSchema = z.enum([
  "anchored",
  "business_level_degraded",
]);
export type DoctrineResolution = z.infer<typeof DoctrineResolutionSchema>;

// ---------------------------------------------------------------------------
// The six principles (P1 → P6)
// ---------------------------------------------------------------------------

export interface DoctrinePrinciple {
  id: "P1" | "P2" | "P3" | "P4" | "P5" | "P6";
  title: string;
  question: string;
}

export const STRATEGIC_DOCTRINE: readonly DoctrinePrinciple[] = [
  {
    id: "P1",
    title: "Exact target segment",
    question:
      "Who EXACTLY is the specific segment this product is for? Not a broad demographic — a describable group with a shared, verifiable situation.",
  },
  {
    id: "P2",
    title: "Segment problems in this specific market",
    question:
      "What real problems does that exact segment face IN THIS SPECIFIC MARKET right now? Ground each in observed signals, not category assumptions.",
  },
  {
    id: "P3",
    title: "Product–problem fit",
    question:
      "How does THIS SPECIFIC product (its keyAttributes and differentiatingFeature) solve those problems better than the segment's current alternatives?",
  },
  {
    id: "P4",
    title: "Channels where the segment actually is",
    question:
      "Where does that exact segment actually spend attention? Recommend only channels where this specific segment is reachable — not generic best-practice channels.",
  },
  {
    id: "P5",
    title: "Delivery & communication",
    question:
      "How must the message be delivered and communicated so THIS segment recognises THIS product as the answer to THEIR problem?",
  },
  {
    id: "P6",
    title: "Long-term relationship",
    question:
      "How does this earn a durable, long-term relationship with the segment beyond the first conversion?",
  },
] as const;

export const RESOLUTION_RULE =
  "RESOLUTION RULE (non-negotiable): every answer must resolve at the level of THIS campaign's specific product — described by the product anchor below — never at the level of the business category. A claim that would remain true, unchanged, if swapped onto a generic competitor in the same category is INVALID and will be rejected. Name the specific product, its specific attributes, and the specific segment.";

export const PRICING_EXCLUSION =
  "PRICING EXCLUSION: do NOT derive, recommend, or infer pricing from any of the principles above. Pricing is user-supplied context only and is out of scope for strategic reasoning.";

// ---------------------------------------------------------------------------
// Per-engine validated decision summaries (appended to SSC as engines complete)
// ---------------------------------------------------------------------------

export interface EngineDecisionSummary {
  engineId: string;
  /** One-paragraph, validated summary of what this engine decided. */
  summary: string;
  validatedAt: number;
}

// ---------------------------------------------------------------------------
// The doctrine object seeded into the SharedStrategicContext at run start
// ---------------------------------------------------------------------------

export interface StrategicDoctrine {
  version: string;
  /** D3 strict enum — how the doctrine resolved for this run. */
  resolution: DoctrineResolution;
  /** Present when resolution === "anchored". */
  productAnchor: ProductAnchor | null;
  /** Business-level fallback offer text, used when anchor is absent. */
  businessLevelOffer: string | null;
  /** Optional business-level category hint (never a substitute for anchor). */
  productCategory: string | null;
  /** Stable hash of the anchor JSON (or "" when null) for snapshot keying. */
  anchorHash: string;
}

/**
 * What buildDoctrineBlock consumes: the seeded doctrine plus the running list
 * of validated prior-engine decisions.
 */
export interface RunStrategicContext {
  doctrine: StrategicDoctrine;
  priorDecisions: EngineDecisionSummary[];
  performanceContext?: any | null;
  rawPerformanceContext?: any | null;
}

export function buildPerformanceBlock(perfCtx?: any | null): string {
  if (!perfCtx) return "";
  return `
═══ BUSINESS EXECUTION PERFORMANCE CONTEXT ═══
BUSINESS MODE: ${perfCtx.mode || "UNKNOWN"} (Confidence: ${perfCtx.confidence || "LOW"})
PRIMARY BOTTLENECK: ${perfCtx.primaryBottleneck || "NONE"}
FRESHNESS: ${perfCtx.freshness || "FRESH"}${perfCtx.isStale ? " [STALE CONTEXT]" : ""}
PERMISSIONS & DIRECTIVES: ${perfCtx.permissionDirective || "Use performance context as bounded execution feedback."}
ALLOWED SIGNALS: ${JSON.stringify(perfCtx.allowedSignals || {})}
═══`;
}

// ---------------------------------------------------------------------------
// Resolution — build the doctrine object, choosing anchored vs degraded.
// PARTIAL-DOCTRINE POLICY: anchor absent → fall back to the business-level
// offer AND stamp resolution = "business_level_degraded". NEVER inject
// "[not set]" placeholders — missing detail is omitted cleanly by the renderer.
// ---------------------------------------------------------------------------

export function resolveDoctrine(input: {
  productAnchor: ProductAnchor | null;
  businessLevelOffer: string | null;
  productCategory: string | null;
}): StrategicDoctrine {
  const anchor = input.productAnchor;
  if (anchor) {
    return {
      version: DOCTRINE_VERSION,
      resolution: "anchored",
      productAnchor: anchor,
      businessLevelOffer: input.businessLevelOffer ?? null,
      productCategory: input.productCategory ?? null,
      anchorHash: computeAnchorHash(anchor),
    };
  }
  return {
    version: DOCTRINE_VERSION,
    resolution: "business_level_degraded",
    productAnchor: null,
    businessLevelOffer: input.businessLevelOffer ?? null,
    productCategory: input.productCategory ?? null,
    anchorHash: computeAnchorHash(null),
  };
}

// ---------------------------------------------------------------------------
// deriveAnchorFromProductDna — helper for DNA enrichment / seed phase.
// Explicit if/else selection — no semantic-fallback chains (D1). Returns null
// when the DNA cannot honestly supply an anchor (D5 — never fabricate).
// ---------------------------------------------------------------------------

export interface ProductDnaLike {
  businessModel?: string | null;
  productCategory?: string | null;
  coreProblemSolved?: string | null;
  uniqueMechanism?: string | null;
  strategicAdvantage?: string | null;
  businessType?: string | null;
  coreOffer?: string | null;
  heroProduct?: string | null;
  productSpecs?: string | null;
  endConsumerUseCase?: string | null;
  replacedCompetitor?: string | null;
  targetAudienceSegment?: string | null;
}

export function deriveAnchorFromProductDna(dna: ProductDnaLike | null | undefined): ProductAnchor | null {
  if (!dna) return null;

  const sourceFacts: any[] = [];

  // Determine offering model
  let offeringType = dna.businessModel || "unknown";
  if (dna.heroProduct && dna.heroProduct.trim().length > 0) {
    offeringType = dna.coreOffer && dna.coreOffer.trim().length > 0 ? "mixed" : "product";
  }

  // Name
  let dnaName = "";
  if (dna.heroProduct && dna.heroProduct.trim().length > 0) {
    dnaName = dna.heroProduct.trim();
    sourceFacts.push({
      fact: dnaName,
      type: "GENERAL",
      source: "business_data_layer.heroProduct",
      provenance: "USER_PROVIDED",
    });
  } else if (dna.coreOffer && dna.coreOffer.trim().length > 0) {
    dnaName = String(dna.coreOffer).trim();
    sourceFacts.push({
      fact: dnaName,
      type: "GENERAL",
      source: "business_data_layer.coreOffer",
      provenance: "USER_PROVIDED",
    });
  }

  // Type
  const dnaType = dna.businessType ? String(dna.businessType).trim() : (dna.productCategory ? String(dna.productCategory).trim() : "");

  // Key attributes
  const keyAttrs: string[] = [];
  if (dna.productCategory && dna.productCategory.trim().length > 0) {
    keyAttrs.push(dna.productCategory.trim());
    sourceFacts.push({
      fact: dna.productCategory.trim(),
      type: "PRODUCT_ATTRIBUTE",
      source: "business_data_layer.productCategory",
      provenance: "USER_PROVIDED",
    });
  }

  // Structured fields with provenance
  const productSpecsList: string[] = [];
  if (dna.productSpecs && dna.productSpecs.trim().length > 0) {
    productSpecsList.push(dna.productSpecs.trim());
    sourceFacts.push({
      fact: dna.productSpecs.trim(),
      type: "PRODUCT_SPEC",
      source: "business_data_layer.productSpecs",
      provenance: "USER_PROVIDED",
    });
  }

  const useCasesList: string[] = [];
  if (dna.endConsumerUseCase && dna.endConsumerUseCase.trim().length > 0) {
    useCasesList.push(dna.endConsumerUseCase.trim());
    sourceFacts.push({
      fact: dna.endConsumerUseCase.trim(),
      type: "CUSTOMER_USE_CASE",
      source: "business_data_layer.endConsumerUseCase",
      provenance: "USER_PROVIDED",
    });
  }

  let problemSolvedVal = "";
  if (dna.coreProblemSolved && dna.coreProblemSolved.trim().length > 0) {
    problemSolvedVal = dna.coreProblemSolved.trim();
    sourceFacts.push({
      fact: problemSolvedVal,
      type: "PROBLEM_SOLVED",
      source: "business_data_layer.coreProblemSolved",
      provenance: "USER_PROVIDED",
    });
  }

  const audienceSegmentRaw = (dna as any).targetAudienceSegment ? String((dna as any).targetAudienceSegment).trim().toLowerCase() : "";
  const decisionMakerRaw = (dna as any).targetDecisionMaker ? String((dna as any).targetDecisionMaker).trim().toLowerCase() : "";

  let mechanismVal = "";
  if (dna.uniqueMechanism && dna.uniqueMechanism.trim().length > 0) {
    const mechLC = dna.uniqueMechanism.trim().toLowerCase();
    // If semantic origin is ambiguous and it mirrors the audience segment or decision maker, it's a legacy data contamination
    if (
      (audienceSegmentRaw.length > 0 && (mechLC === audienceSegmentRaw || mechLC.includes(audienceSegmentRaw))) ||
      (decisionMakerRaw.length > 0 && (mechLC === decisionMakerRaw || mechLC.includes(decisionMakerRaw)))
    ) {
      // mark it unresolved and exclude it
    } else {
      mechanismVal = dna.uniqueMechanism.trim();
      sourceFacts.push({
        fact: mechanismVal,
        type: "DELIVERY_MECHANISM",
        source: "business_data_layer.uniqueMechanism",
        provenance: "USER_PROVIDED",
      });
    }
  }

  let advantageVal = "";
  if (dna.strategicAdvantage && dna.strategicAdvantage.trim().length > 0) {
    const advLC = dna.strategicAdvantage.trim().toLowerCase();
    if (
      (audienceSegmentRaw.length > 0 && (advLC === audienceSegmentRaw || advLC.includes(audienceSegmentRaw))) ||
      (decisionMakerRaw.length > 0 && (advLC === decisionMakerRaw || advLC.includes(decisionMakerRaw)))
    ) {
      // mark it unresolved and exclude it
    } else {
      advantageVal = dna.strategicAdvantage.trim();
      sourceFacts.push({
        fact: advantageVal,
        type: "STRATEGIC_ADVANTAGE",
        source: "business_data_layer.strategicAdvantage",
        provenance: "USER_PROVIDED",
      });
    }
  }

  let replacedVal = "";
  if (dna.replacedCompetitor && dna.replacedCompetitor.trim().length > 0) {
    replacedVal = dna.replacedCompetitor.trim();
    sourceFacts.push({
      fact: replacedVal,
      type: "ALTERNATIVE_REPLACED",
      source: "business_data_layer.replacedCompetitor",
      provenance: "USER_PROVIDED",
    });
  }

  // Canonical base differentiator & problem
  let dnaDifferentiator = "";
  if (advantageVal.length > 0) {
    dnaDifferentiator = advantageVal;
  } else if (mechanismVal.length > 0) {
    dnaDifferentiator = mechanismVal;
  } else if (productSpecsList.length > 0) {
    dnaDifferentiator = productSpecsList.join("; ");
  } else if (replacedVal.length > 0) {
    dnaDifferentiator = `Replaces: ${replacedVal}`;
  }

  const dnaProblem = problemSolvedVal.length > 0 ? problemSolvedVal : (useCasesList.length > 0 ? useCasesList.join("; ") : "");

  if (dnaDifferentiator.length === 0 || dnaProblem.length === 0 || dnaName.length === 0 || dnaType.length === 0) {
    return null;
  }

  return {
    name: dnaName,
    type: dnaType,
    offeringType,
    keyAttributes: keyAttrs,
    coreProblemSolved: dnaProblem,
    differentiatingFeature: dnaDifferentiator,
    productSpecs: productSpecsList.length > 0 ? productSpecsList : undefined,
    customerUseCases: useCasesList.length > 0 ? useCasesList : undefined,
    problemSolved: problemSolvedVal.length > 0 ? problemSolvedVal : undefined,
    uniqueMechanism: mechanismVal.length > 0 ? mechanismVal : undefined,
    strategicAdvantage: advantageVal.length > 0 ? advantageVal : undefined,
    alternativeReplaced: replacedVal.length > 0 ? replacedVal : undefined,
    sourceFacts: sourceFacts.length > 0 ? sourceFacts : undefined,
  };
}

/** Stable 16-char sha256 of the anchor JSON; "" (empty) when anchor is null. */
export function computeAnchorHash(anchor: ProductAnchor | null): string {
  if (!anchor) return "";
  const canonical = JSON.stringify({
    name: anchor.name,
    type: anchor.type,
    offeringType: anchor.offeringType ?? "",
    keyAttributes: [...(anchor.keyAttributes ?? [])].sort(),
    coreProblemSolved: anchor.coreProblemSolved,
    differentiatingFeature: anchor.differentiatingFeature,
    productSpecs: [...(anchor.productSpecs ?? [])].sort(),
    customerUseCases: [...(anchor.customerUseCases ?? [])].sort(),
    problemSolved: anchor.problemSolved ?? "",
    uniqueMechanism: anchor.uniqueMechanism ?? "",
    strategicAdvantage: anchor.strategicAdvantage ?? "",
    alternativeReplaced: anchor.alternativeReplaced ?? "",
    sourceFacts: anchor.sourceFacts ?? [],
  });
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// buildDoctrineBlock — renders the doctrine + anchor + priorDecisions into a
// prompt-ready block. Cleanly omits any principle whose specifics cannot be
// grounded in the degraded path — it NEVER emits "[not set]".
// ---------------------------------------------------------------------------

export function buildDoctrineBlock(ctx: RunStrategicContext): string {
  const { doctrine, priorDecisions } = ctx;
  const lines: string[] = [];

  lines.push("=== STRATEGIC DOCTRINE ===");
  lines.push(RESOLUTION_RULE);
  lines.push("");
  lines.push("Answer the following principles for THIS campaign:");
  for (const p of STRATEGIC_DOCTRINE) {
    lines.push(`- ${p.id} (${p.title}): ${p.question}`);
  }
  lines.push("");
  lines.push(PRICING_EXCLUSION);
  lines.push("");

  if (doctrine.resolution === "anchored" && doctrine.productAnchor) {
    const a = doctrine.productAnchor;
    lines.push("=== PRODUCT ANCHOR (resolve every answer to THIS product) ===");
    lines.push(`Product name: ${a.name}`);
    lines.push(`Product type: ${a.type}`);
    if (a.offeringType) lines.push(`Offering model: ${a.offeringType}`);
    if (a.productSpecs && a.productSpecs.length > 0) {
      lines.push(`Product specifications: ${a.productSpecs.join("; ")}`);
    }
    if (a.customerUseCases && a.customerUseCases.length > 0) {
      lines.push(`Customer use cases: ${a.customerUseCases.join("; ")}`);
    }
    if (a.problemSolved) lines.push(`Problem solved: ${a.problemSolved}`);
    if (a.uniqueMechanism) lines.push(`Delivery mechanism: ${a.uniqueMechanism}`);
    if (a.strategicAdvantage) lines.push(`Strategic advantage: ${a.strategicAdvantage}`);
    if (a.alternativeReplaced) lines.push(`Alternatives replaced: ${a.alternativeReplaced}`);
    if (a.keyAttributes && a.keyAttributes.length > 0) {
      lines.push(`Key attributes: ${a.keyAttributes.join("; ")}`);
    }
    lines.push(`Core problem solved: ${a.coreProblemSolved}`);
    lines.push(`Differentiating feature: ${a.differentiatingFeature}`);
    lines.push(
      "AUTHORITY BOUNDARY: this anchor is the authority for WHAT THE PRODUCT CAN DO — it is NOT the authority for what problem the customer has. Never select, invent, or reframe the customer's problem from anchor language; the customer problem comes only from the authoritative audience pain data provided elsewhere in this prompt.",
    );
  } else {
    // business_level_degraded — omit anchor specifics cleanly; provide only
    // the business-level context that genuinely exists.
    lines.push("=== BUSINESS-LEVEL CONTEXT (degraded — no product anchor set) ===");
    lines.push(
      "No product anchor is set for this campaign, so specifics resolve to the business level. Push for the most product-specific answer the available context allows; do not invent product detail.",
    );
    if (doctrine.businessLevelOffer) {
      lines.push(`Business core offer: ${doctrine.businessLevelOffer}`);
    }
    if (doctrine.productCategory) {
      lines.push(`Business category: ${doctrine.productCategory}`);
    }
  }

  if (Array.isArray(priorDecisions) && priorDecisions.length > 0) {
    lines.push("");
    lines.push("=== PRIOR VALIDATED DECISIONS (do not contradict these) ===");
    for (const d of priorDecisions) {
      lines.push(`- [${d.engineId}] ${d.summary}`);
    }
  }

  if (ctx.performanceContext) {
    lines.push("");
    lines.push(buildPerformanceBlock(ctx.performanceContext));
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Shared strict JSON parse with optional Zod validation. Returns null on any
// parse/validation failure (never throws) — callers treat null as "AI output
// unusable → retry or fall back", consistent with the fail-closed doctrine.
// This is the single shared helper the judge + candidate parsers reuse.
// ---------------------------------------------------------------------------

export function safeJsonParse<T = unknown>(
  text: unknown,
  schema?: z.ZodType<T, z.ZodTypeDef, any>,
): T | null {
  if (text == null) return null;
  let raw: unknown;
  if (typeof text === "string") {
    const trimmed = stripCodeFence(text);
    if (trimmed === "") return null;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return null;
    }
  } else {
    raw = text;
  }
  if (schema) {
    const parsed = schema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }
  return raw as T;
}

/** Strip a leading/trailing ```json … ``` fence some models emit. */
function stripCodeFence(s: string): string {
  const t = s.trim();
  if (!t.startsWith("```")) return t;
  return t
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

/**
 * Parse a raw product_anchor value (jsonb column or already-parsed object)
 * into a validated ProductAnchor, or null when absent/invalid.
 */
export function parseProductAnchor(raw: unknown): ProductAnchor | null {
  const parsed = safeJsonParse<ProductAnchor>(raw, ProductAnchorSchema);
  // B2/B4: distinguish "no anchor stored" (raw null → clean business-level
  // degrade) from "anchor stored but corrupt" (raw present, schema-invalid).
  // The latter is a data-integrity signal that must be visible, not silent.
  if (parsed === null && raw != null) {
    console.error(
      "[Doctrine] PRODUCT_ANCHOR_INVALID — stored anchor failed schema validation; degrading to business_level_degraded",
    );
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// buildSubEngineAnchorContext — computes the pre-rendered anchor block +
// explicit anchor source for a designer/judge sub-engine call site (criteria
// A + B + F). F5a: when the doctrine anchor is absent, derives one from
// Product DNA — deriveAnchorFromProductDna returns null unless differentiator
// + problem + name + type all exist (D5 — never fabricate).
// ---------------------------------------------------------------------------

export interface SubEngineAnchorContext {
  doctrineBlock: string | null;
  anchorSource: "doctrine" | "dna" | "none";
}

export function buildSubEngineAnchorContext(
  strategic: RunStrategicContext | null | undefined,
  productDna: ProductDnaLike | null | undefined,
  groundingRule: string,
  logTag: string,
): SubEngineAnchorContext {
  let block = "";
  if (strategic) {
    block = buildDoctrineBlock(strategic);
  } else {
    console.log(`[${logTag}] DOCTRINE_ABSENT — no strategic context threaded; omitting doctrine block`);
  }
  let anchor: ProductAnchor | null = strategic ? strategic.doctrine.productAnchor : null;
  if (!anchor && productDna) {
    const derived = deriveAnchorFromProductDna(productDna);
    if (derived) {
      anchor = derived;
      console.log(`[${logTag}] ANCHOR_FROM_DNA | doctrine anchor absent — prompt anchor derived from Product DNA (F5a)`);
    }
  }
  // Explicit if/else source classification — no semantic-fallback chains (D1).
  let anchorSource: "doctrine" | "dna" | "none" = "none";
  if (strategic && strategic.doctrine.productAnchor) {
    anchorSource = "doctrine";
  } else if (anchor) {
    anchorSource = "dna";
  }
  const dnaBlock = anchorSource === "dna" && anchor
    ? `
=== PRODUCT ANCHOR (derived from Product DNA — resolve every output to THIS product) ===
Product name: ${anchor.name}
Product type: ${anchor.type}${anchor.keyAttributes.length > 0 ? `\nKey attributes: ${anchor.keyAttributes.join("; ")}` : ""}
Core problem solved: ${anchor.coreProblemSolved}
Differentiating feature: ${anchor.differentiatingFeature}
`
    : "";
  const rule = anchor ? `\n${groundingRule}\n` : "";
  const text = `${block}${dnaBlock}${rule}`;
  if (text.length > 0) {
    return { doctrineBlock: text, anchorSource };
  }
  return { doctrineBlock: null, anchorSource };
}

// ---------------------------------------------------------------------------
// LaneStrategicResponse — Structured integration contract composed from
// canonical upstream engine decisions (Positioning, Differentiation,
// Mechanism, Offer, Funnel, Channel). Not an independent authority.
// ---------------------------------------------------------------------------

export const LaneStrategicResponseSchema = z.object({
  laneId: z.string().min(1),
  audienceContext: z.string().min(1),
  observedProblem: z.string().min(1),
  evidenceSummary: z.array(z.string()).default([]),
  commercialMeaning: z.string().min(1),
  strategicDecision: z.string().min(1),
  strategicResponse: z.string().min(1),
  positioningImplication: z.string().min(1),
  messagingImplication: z.string().min(1),
  offerImplication: z.string().min(1),
  proofRequirement: z.object({
    claimToProve: z.string().min(1),
    proofTypeNeeded: z.string().min(1),
    existingProofAsset: z.string().optional(),
    proofGap: z.string().optional(),
  }),
  funnelImplication: z.string().min(1),
  contentImplication: z.object({
    strategicTheme: z.string().min(1),
    desiredPerceptionShift: z.string().min(1),
    funnelRole: z.string().min(1),
  }),
  tradeoff: z.string().min(1),
  whatNotToDo: z.string().min(1),
  confidence: z.number().default(0.85),
  lineage: z.array(z.string()).default([]),
});

export type LaneStrategicResponse = z.infer<typeof LaneStrategicResponseSchema>;

