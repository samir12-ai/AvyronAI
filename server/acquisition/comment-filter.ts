/**
 * P-6.12 Phase 7 — unified comment quality filter for ALL platforms.
 *
 * Principles (rebuilt from the audit of the legacy filterSpamComments):
 *  - Short comments can be high-signal: "How much?" is purchase intent.
 *    Questions and price/intent phrases are ALWAYS accepted regardless of length.
 *  - Emoji-only comments are engagement, not audience insight: kept but
 *    flagged ACCEPTED_LOW_SIGNAL so evidence readers can down-weight them.
 *  - Owner replies are competitive signal, not audience evidence: kept with
 *    authorType='owner' + ACCEPTED_OWNER_REPLY; audience evidence reads
 *    exclude them at the data layer.
 *  - Dedup is by platform comment ID ONLY. The same text from different users
 *    is a real pattern (e.g. many people asking the price) — never collapse it.
 *  - Multilingual is first-class: "meaningful characters" counts any Unicode
 *    letter/number (Arabic, Turkish, etc.), never just [a-z].
 *  - Rejected comments are never persisted; per-run stats record every
 *    rejection by reason so filtering is observable, not silent.
 */

export type AuthorType = "owner" | "audience" | "unknown";

export type AcceptStatus = "ACCEPTED" | "ACCEPTED_OWNER_REPLY" | "ACCEPTED_LOW_SIGNAL";

export type FilterReason =
  | "OK"
  | "OWNER_REPLY"
  | "INTENT_QUESTION"       // accepted: question/price intent (length-exempt)
  | "EMOJI_ONLY"            // accepted LOW_SIGNAL
  | "VERY_SHORT"            // accepted LOW_SIGNAL: <2 meaningful chars, not emoji-only
  | "TAG_ONLY"              // accepted LOW_SIGNAL: only @mentions/#tags (friend-tagging = reach signal)
  | "REJECTED_EMPTY"
  | "REJECTED_DUPLICATE_ID"
  | "REJECTED_REPEATED_CHARS"
  | "REJECTED_BOT_SPAM"
  | "REJECTED_PROMO_SPAM";

export interface CommentCandidate {
  commentId: string;
  username: string | null;
  text: string;
}

export interface FilterDecision {
  accepted: boolean;
  status: AcceptStatus | null;
  reason: FilterReason;
  authorType: AuthorType;
}

export interface FilterStats {
  evaluated: number;
  accepted: number;
  acceptedOwner: number;
  acceptedLowSignal: number;
  rejected: number;
  byReason: Record<string, number>;
}

export function emptyFilterStats(): FilterStats {
  return { evaluated: 0, accepted: 0, acceptedOwner: 0, acceptedLowSignal: 0, rejected: 0, byReason: {} };
}

// Ported from the legacy data-acquisition SPAM_BOT_PATTERNS (kept: these are
// evidence-based engagement-farming signatures observed in real IG comments).
const BOT_SPAM_PATTERNS = [
  /\bfollow\s*(me|back|4follow|for\s*follow)\b/i,
  /\b(dm|message)\s*(me|for)\s*(promo|collab|deal|info)\b/i,
  /\bcheck\s*(my|out\s*my)\s*(page|profile|bio|link)\b/i,
  /\blink\s*in\s*(my\s*)?bio\b/i,
  /\b(free|earn)\s*(money|cash|gift|followers|likes)\b/i,
  /\bgrow\s*your\s*(account|followers|page)\b/i,
  /\b(buy|get)\s*(followers|likes|views)\b/i,
  /\bI\s*can\s*help\s*you\s*(grow|get|gain)\b/i,
  /\b(promo|promote)\s*(available|dm|prices?)\b/i,
  /\bwant\s*to\s*be\s*featured\b/i,
  /\bcongrat[sz]?\s*you\s*(won|are\s*selected)\b/i,
];

// Promotional/link spam: URLs + messenger handles pushed in comments.
const PROMO_SPAM_PATTERNS = [
  /https?:\/\//i,
  /\b(wa\.me|t\.me|bit\.ly|linktr\.ee)\b/i,
  /\b(click|tap)\s*(the\s*)?(link|here)\b/i,
];

// Intent signals that make ANY length acceptable (purchase/visit questions).
const INTENT_PATTERNS = [
  /\?/,
  /\bhow\s*much\b/i,
  /\bprice|cost|delivery|location|address|open|menu|book|order\b/i,
  /(بكم|كم\s*السعر|السعر|وين|فين|التوصيل|العنوان)/i, // Arabic price/where/delivery
  /\b(fiyat|ne\s*kadar|nerede|adres|sipariş)\b/i, // Turkish price/where/order
];

const EMOJI_ONLY_RE =
  /^[\s\p{Emoji}\p{Emoji_Presentation}\p{Emoji_Modifier}\p{Emoji_Modifier_Base}\p{Emoji_Component}\u200d\ufe0f\u2764\u2665\u2600-\u26FF\u2700-\u27BF]*$/u;

/** Unicode-aware meaningful character count (letters + numbers, any script). */
function meaningfulCharCount(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]/gu);
  return matches ? matches.length : 0;
}

function normalizeHandle(h: string | null | undefined): string {
  return (h || "").trim().toLowerCase().replace(/^@/, "");
}

export interface FilterContext {
  /** Competitor/brand handles — case-insensitive match marks authorType='owner'. */
  ownerHandles: string[];
  /** Platform comment IDs already persisted (or already seen this batch). */
  seenCommentIds: Set<string>;
}

export function evaluateComment(candidate: CommentCandidate, ctx: FilterContext): FilterDecision {
  const text = (candidate.text || "").trim();
  const username = normalizeHandle(candidate.username);
  const owners = ctx.ownerHandles.map(normalizeHandle).filter(Boolean);

  const authorType: AuthorType = !username ? "unknown" : owners.includes(username) ? "owner" : "audience";

  // 1. Identity dedup — by platform comment ID only.
  if (candidate.commentId && ctx.seenCommentIds.has(candidate.commentId)) {
    return { accepted: false, status: null, reason: "REJECTED_DUPLICATE_ID", authorType };
  }

  // 2. Empty.
  if (!text) {
    return { accepted: false, status: null, reason: "REJECTED_EMPTY", authorType };
  }

  // 3. Owner replies: kept, classified, excluded from audience evidence downstream.
  if (authorType === "owner") {
    return { accepted: true, status: "ACCEPTED_OWNER_REPLY", reason: "OWNER_REPLY", authorType };
  }

  // 4. Spam — checked before length so long spam never sneaks through.
  for (const p of BOT_SPAM_PATTERNS) {
    if (p.test(text)) return { accepted: false, status: null, reason: "REJECTED_BOT_SPAM", authorType };
  }
  for (const p of PROMO_SPAM_PATTERNS) {
    if (p.test(text)) return { accepted: false, status: null, reason: "REJECTED_PROMO_SPAM", authorType };
  }

  // 5. Keyboard mashing: one character repeated 5+ times with nothing else.
  const stripped = text.replace(/[\s@#]/g, "");
  if (/^(.)\1{4,}$/u.test(stripped) && !EMOJI_ONLY_RE.test(text)) {
    return { accepted: false, status: null, reason: "REJECTED_REPEATED_CHARS", authorType };
  }

  // 6. Intent signals are length-exempt ("How much?", "بكم", "Fiyat?").
  for (const p of INTENT_PATTERNS) {
    if (p.test(text)) return { accepted: true, status: "ACCEPTED", reason: "INTENT_QUESTION", authorType };
  }

  // 7. Emoji-only → engagement signal, low audience-insight value.
  if (EMOJI_ONLY_RE.test(text)) {
    return { accepted: true, status: "ACCEPTED_LOW_SIGNAL", reason: "EMOJI_ONLY", authorType };
  }

  // 8. Tag-only (@mentions/#tags) → friend-tagging: real reach signal, low text signal.
  const tagStrippedCount = meaningfulCharCount(text.replace(/@[\w.]+/g, "").replace(/#[\w\u0600-\u06FF]+/g, ""));
  if (tagStrippedCount === 0 && meaningfulCharCount(text) > 0) {
    return { accepted: true, status: "ACCEPTED_LOW_SIGNAL", reason: "TAG_ONLY", authorType };
  }

  // 9. Very short non-emoji, non-question text ("ok", "❤ok") → keep, flag.
  if (meaningfulCharCount(text) < 3) {
    return { accepted: true, status: "ACCEPTED_LOW_SIGNAL", reason: "VERY_SHORT", authorType };
  }

  return { accepted: true, status: "ACCEPTED", reason: "OK", authorType };
}

export interface FilteredComment<T extends CommentCandidate> {
  comment: T;
  decision: FilterDecision;
}

/**
 * Evaluate a batch. Accepted comments have their IDs added to ctx.seenCommentIds
 * (in-batch dedup); the caller pre-seeds the set with DB-persisted IDs.
 */
export function filterComments<T extends CommentCandidate>(
  comments: T[],
  ctx: FilterContext,
): { accepted: FilteredComment<T>[]; stats: FilterStats } {
  const stats = emptyFilterStats();
  const accepted: FilteredComment<T>[] = [];

  for (const comment of comments) {
    stats.evaluated++;
    const decision = evaluateComment(comment, ctx);
    stats.byReason[decision.reason] = (stats.byReason[decision.reason] || 0) + 1;

    if (!decision.accepted) {
      stats.rejected++;
      continue;
    }

    if (comment.commentId) ctx.seenCommentIds.add(comment.commentId);
    stats.accepted++;
    if (decision.status === "ACCEPTED_OWNER_REPLY") stats.acceptedOwner++;
    if (decision.status === "ACCEPTED_LOW_SIGNAL") stats.acceptedLowSignal++;
    accepted.push({ comment, decision });
  }

  return { accepted, stats };
}

export function formatFilterStats(stats: FilterStats): string {
  const reasons = Object.entries(stats.byReason)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  return `evaluated=${stats.evaluated} accepted=${stats.accepted} (owner=${stats.acceptedOwner} lowSignal=${stats.acceptedLowSignal}) rejected=${stats.rejected} | ${reasons}`;
}
