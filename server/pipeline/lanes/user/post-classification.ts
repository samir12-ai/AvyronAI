/**
 * Phase 7.2 — Paid vs Organic post classification (broadened, three-state).
 *
 * Locked by Samir 2026-04-20 (rev 2):
 *   - Rule-based only. No AI, no scoring, no probabilistic logic.
 *   - Deterministic and explainable: every classification carries the single
 *     rule code that fired.
 *   - Three states: "paid" | "organic" | "uncertain".
 *   - LABEL ONLY. Output MUST NOT feed Q1, Q2, the DNA working verdict, the
 *     outcome-regression check, or any verdict boundary. It is descriptive
 *     metadata for the explanation layer.
 *   - Coverage and consistency matter more than perfect accuracy.
 *
 * Doctrine placement: User Lane. Pure function, no DB I/O, no persistence.
 *
 * Rule priority (first match wins):
 *   1. STRONG paid marker present  -> "paid"        (disclosure or explicit
 *                                                    promo code / discount)
 *   2. WEAK promo marker in caption -> "uncertain"  (generic sale language)
 *   3. Heavy CTA in cta field       -> "uncertain"
 *   4. Metrics spike vs peer median -> "uncertain"  (only when peer context
 *                                                    provided and baseline
 *                                                    is non-trivial)
 *   5. Otherwise                    -> "organic"
 *
 * Adding/removing markers is a one-line edit. Spike threshold and baseline
 * floor are explicit constants below.
 */

/* ---------------- Markers (case-insensitive substring match) ---------------- */

/** Definitive paid signals: disclosure language + explicit promo-code phrasing. */
const STRONG_PAID_MARKERS: ReadonlyArray<string> = [
  // Disclosure (FTC / IG branded-content / TikTok branded-content conventions)
  "#ad",
  "#sponsored",
  "#paidpartnership",
  "#paidpartner",
  "paid partnership",
  "paid partner",
  "sponsored by",
  "in partnership with",
  "in collaboration with",
  // Explicit promo-code phrasing (the word "code" tied to a redemption verb)
  "use code ",
  "promo code",
  "discount code",
  "coupon code",
  "code: ",
];

/** Definitive paid signals expressed as patterns (discount math). */
const STRONG_PAID_PATTERNS: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: "percent_off", re: /\b\d{1,2}\s*%\s*off\b/i },
  { id: "dollar_off", re: /\$\d+(\.\d{1,2})?\s*off\b/i },
  { id: "save_dollar", re: /\bsave\s*\$\d+/i },
  { id: "save_percent", re: /\bsave\s*\d{1,2}\s*%/i },
];

/** Weak promotional language: pushes the post toward "uncertain", not "paid". */
const WEAK_PROMO_MARKERS: ReadonlyArray<string> = [
  "discount",
  "coupon",
  "limited time",
  "limited-time",
  "today only",
  "ends today",
  "ends tonight",
  "flash sale",
  "exclusive offer",
  "special offer",
  "link in bio",
  "swipe up",
];

/** Heavy CTA phrases checked in the structured `cta` field (not the caption). */
const HEAVY_CTA_MARKERS: ReadonlyArray<string> = [
  "shop now",
  "buy now",
  "order now",
  "click the link",
  "tap the link",
  "swipe up",
  "while supplies last",
  "limited stock",
];

/* ---------------- Spike thresholds (behavioral / context signal) ---------------- */

/**
 * A post is considered to "spike" relative to peers when its engagement or
 * reach is >= SPIKE_MULTIPLIER x the peer median.
 *
 * BASELINE_FLOOR avoids treating tiny denominators as a spike (e.g., median=1
 * makes any post above 3 a "spike"). Peer median must be at least this large
 * for the rule to fire at all.
 */
const SPIKE_MULTIPLIER = 3;
const BASELINE_FLOOR = 5;

/* ---------------- Public API ---------------- */

export type PostClassification = "paid" | "organic" | "uncertain";

export interface ClassifiablePost {
  caption: string | null | undefined;
  /** Optional structured CTA field from published_posts.cta. */
  cta?: string | null | undefined;
  /** Optional engagement count from published_posts.engagement. */
  engagement?: number | null;
  /** Optional reach count from published_posts.reach. */
  reach?: number | null;
}

export interface PostContext {
  /**
   * Peer engagement baseline. Caller is responsible for computing this
   * (e.g., median engagement over the last N posts of the same account /
   * platform). When absent, the spike rule is skipped.
   */
  peerEngagementMedian?: number | null;
  /**
   * Peer reach baseline. Same contract as peerEngagementMedian.
   */
  peerReachMedian?: number | null;
}

export interface PostClassificationResult {
  label: PostClassification;
  /**
   * Identifier of the single rule that fired. Stable strings — safe to surface
   * to the explanation layer.
   *
   *   "disclosure_marker:<marker>"        STRONG paid (disclosure)
   *   "promo_code_marker:<marker>"        STRONG paid (explicit promo code)
   *   "discount_pattern:<id>"             STRONG paid (discount math)
   *   "weak_promo_language:<marker>"      uncertain
   *   "heavy_cta:<marker>"                uncertain
   *   "metrics_spike:engagement"          uncertain
   *   "metrics_spike:reach"               uncertain
   *   "no_signal"                         organic
   */
  reason: string;
}

function findMarker(haystack: string, markers: ReadonlyArray<string>): string | null {
  for (const m of markers) {
    if (haystack.includes(m)) return m;
  }
  return null;
}

export function classifyPost(
  post: ClassifiablePost,
  ctx?: PostContext,
): PostClassificationResult {
  const caption = (post.caption ?? "").toLowerCase();
  const cta = (post.cta ?? "").toLowerCase();

  // Rule 1a — STRONG paid: disclosure / explicit promo-code phrasing in caption.
  const strongMarker = findMarker(caption, STRONG_PAID_MARKERS);
  if (strongMarker) {
    const isCodePhrase =
      strongMarker.includes("code") || strongMarker.includes("use code");
    return {
      label: "paid",
      reason: (isCodePhrase ? "promo_code_marker:" : "disclosure_marker:") + strongMarker.trim(),
    };
  }

  // Rule 1b — STRONG paid: discount math patterns ("20% off", "$10 off", ...).
  for (const p of STRONG_PAID_PATTERNS) {
    if (p.re.test(caption)) {
      return { label: "paid", reason: "discount_pattern:" + p.id };
    }
  }

  // Rule 2 — WEAK promo language in caption -> uncertain.
  const weakMarker = findMarker(caption, WEAK_PROMO_MARKERS);
  if (weakMarker) {
    return { label: "uncertain", reason: "weak_promo_language:" + weakMarker };
  }

  // Rule 3 — Heavy CTA in the structured cta field -> uncertain.
  if (cta) {
    const ctaMarker = findMarker(cta, HEAVY_CTA_MARKERS);
    if (ctaMarker) {
      return { label: "uncertain", reason: "heavy_cta:" + ctaMarker };
    }
  }

  // Rule 4 — Behavioral / context spike vs peer baseline -> uncertain.
  // Only fires when caller supplied a non-trivial peer median.
  if (ctx) {
    const eMed = ctx.peerEngagementMedian;
    const rMed = ctx.peerReachMedian;
    const eng = post.engagement ?? null;
    const rch = post.reach ?? null;
    if (typeof eMed === "number" && eMed >= BASELINE_FLOOR && typeof eng === "number" && eng >= SPIKE_MULTIPLIER * eMed) {
      return { label: "uncertain", reason: "metrics_spike:engagement" };
    }
    if (typeof rMed === "number" && rMed >= BASELINE_FLOOR && typeof rch === "number" && rch >= SPIKE_MULTIPLIER * rMed) {
      return { label: "uncertain", reason: "metrics_spike:reach" };
    }
  }

  // Rule 5 — No signal fired -> organic.
  return { label: "organic", reason: "no_signal" };
}

/**
 * Convenience: classify a batch of posts with a shared context. Same rules,
 * applied per row. Returns parallel array (same length, same order).
 */
export function classifyPosts(
  posts: ReadonlyArray<ClassifiablePost>,
  ctx?: PostContext,
): PostClassificationResult[] {
  return posts.map((p) => classifyPost(p, ctx));
}
