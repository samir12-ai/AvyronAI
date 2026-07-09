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
  keyAttributes: string[];
  coreProblemSolved: string;
  differentiatingFeature: string;
}

export const ProductAnchorSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  keyAttributes: z.array(z.string()).default([]),
  coreProblemSolved: z.string().min(1),
  differentiatingFeature: z.string().min(1),
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
// F5a — DNA-fallback anchor derivation (shared by offer / channel batteries;
// mirrors the inline logic shipped in positioning + audience engines).
// Guard: only when a genuine differentiator + core problem + name + type ALL
// exist — an anchor fabricated from empty strings would flip the judge to the
// strict test with hollow context (worse than the weak anchor-free test).
// Explicit if/else selection — no semantic-fallback chains (D1). Returns null
// when the DNA cannot honestly supply an anchor (D5 — never fabricate).
// ---------------------------------------------------------------------------

export interface ProductDnaLike {
  productCategory?: string | null;
  coreProblemSolved?: string | null;
  uniqueMechanism?: string | null;
  strategicAdvantage?: string | null;
  businessType?: string | null;
  coreOffer?: string | null;
}

export function deriveAnchorFromProductDna(dna: ProductDnaLike | null | undefined): ProductAnchor | null {
  if (!dna) return null;
  let dnaDifferentiator = "";
  if (dna.strategicAdvantage && dna.strategicAdvantage.trim().length > 0) {
    dnaDifferentiator = dna.strategicAdvantage.trim();
  } else if (dna.uniqueMechanism && dna.uniqueMechanism.trim().length > 0) {
    dnaDifferentiator = dna.uniqueMechanism.trim();
  }
  const dnaProblem = dna.coreProblemSolved ? dna.coreProblemSolved.trim() : "";
  const dnaName = dna.coreOffer ? String(dna.coreOffer).trim() : "";
  const dnaType = dna.businessType ? String(dna.businessType).trim() : "";
  if (dnaDifferentiator.length === 0 || dnaProblem.length === 0 || dnaName.length === 0 || dnaType.length === 0) {
    return null;
  }
  return {
    name: dnaName,
    type: dnaType,
    keyAttributes: dna.productCategory ? [dna.productCategory] : [],
    coreProblemSolved: dnaProblem,
    differentiatingFeature: dnaDifferentiator,
  };
}

/** Stable 16-char sha256 of the anchor JSON; "" (empty) when anchor is null. */
export function computeAnchorHash(anchor: ProductAnchor | null): string {
  if (!anchor) return "";
  const canonical = JSON.stringify({
    name: anchor.name,
    type: anchor.type,
    keyAttributes: [...(anchor.keyAttributes ?? [])].sort(),
    coreProblemSolved: anchor.coreProblemSolved,
    differentiatingFeature: anchor.differentiatingFeature,
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
    if (a.keyAttributes.length > 0) {
      lines.push(`Key attributes: ${a.keyAttributes.join("; ")}`);
    }
    lines.push(`Core problem solved: ${a.coreProblemSolved}`);
    lines.push(`Differentiating feature: ${a.differentiatingFeature}`);
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

  if (priorDecisions.length > 0) {
    lines.push("");
    lines.push("=== PRIOR VALIDATED DECISIONS (do not contradict these) ===");
    for (const d of priorDecisions) {
      lines.push(`- [${d.engineId}] ${d.summary}`);
    }
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
