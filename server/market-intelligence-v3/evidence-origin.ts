/**
 * Canonical evidence-origin contract (source-agnostic customer evidence).
 *
 * Philosophy change (Aug 2026, forensic audit of degraded_no_decisions):
 * a source is valuable because of WHAT the evidence represents, not WHICH
 * WEBSITE it came from. Avyron targets startups/SMBs whose competitors often
 * have no Trustpilot/G2 presence — formal review platforms are OPTIONAL
 * customer-origin sources, never architectural prerequisites.
 *
 * Semantic roles:
 *   CUSTOMER_ORIGIN      — provenance-validated customer/user expression
 *                          (reviews, validated social comments, testimonials)
 *   COMPETITOR_MESSAGING — competitor captions/copy/positioning language
 *   COMPETITOR_BEHAVIOR  — competitor actions (posting cadence, CTA usage…)
 *   INFERRED             — AI/heuristic synthesis over other evidence
 *   METADATA             — Avyron-generated labels (CTA detector output like
 *                          "LinkInBio") — NEVER standalone strategic signals
 *   NOISE                — spam/boilerplate/non-semantic fragments
 *
 * Mapping to the legacy SignalOriginType used by cross-signal lineage math:
 *   CUSTOMER_ORIGIN → "real"; COMPETITOR_* → "competitor"; INFERRED →
 *   "inferred". METADATA/NOISE never become extracted signals at all.
 * The `realRatio` field on decisions therefore now means
 * "customer-origin ratio" — the grounding formula itself is unchanged.
 *
 * Fail-closed rule: if provenance of a candidate customer artifact is
 * uncertain (unknown author that cannot be ruled out as the competitor,
 * empty/spam/low-signal text, CTA metadata), it is NOT promoted.
 */

import { evaluateComment, type FilterContext } from "../acquisition/comment-filter";
import type { SignalOriginType } from "./cross-signal-decision";

export type EvidenceOriginRole =
  | "CUSTOMER_ORIGIN"
  | "COMPETITOR_BEHAVIOR"
  | "COMPETITOR_MESSAGING"
  | "INFERRED"
  | "METADATA"
  | "NOISE";

export function roleToSignalOrigin(role: EvidenceOriginRole): SignalOriginType {
  switch (role) {
    case "CUSTOMER_ORIGIN": return "real";
    case "COMPETITOR_BEHAVIOR":
    case "COMPETITOR_MESSAGING": return "competitor";
    case "INFERRED": return "inferred";
    default: return "unknown"; // METADATA/NOISE — callers must exclude, never extract
  }
}

/**
 * Labels emitted by Avyron's own CTA detector (data-acquisition.ts pattern
 * tables). These are derived competitor-behavior METADATA. They must never
 * re-enter the pipeline as market-language evidence. Matching is
 * whitespace/case-insensitive so comma-split artifacts (" ClickAction")
 * are caught.
 */
const CTA_METADATA_LABELS = new Set([
  "dm", "linkinbio", "shop", "book", "contact", "signup", "download",
  "clickaction", "urgency", "dm_ar", "linkinbio_ar", "shop_ar", "contact_ar",
  "checkout", "learnmore", "discover", "seehow", "try", "startyour", "actnow",
  "join", "securespot", "whatwaiting", "discover_ar", "seehow_ar",
  "beforeafter", "journeystory", "hereshow", "personalstruggle", "lifechanger",
  "imagine", "secretreveal", "stepbystep", "realtalk", "behindscenes",
  "lessonlearned", "engagementquestion", "opinionhook", "truthreveal",
  "howtoguide", "journeystory_ar", "beforeafter_ar", "lessonlearned_ar",
  "secretreveal_ar", "stepbystep_ar",
]);

export function isCtaMetadataLabel(text: string): boolean {
  return CTA_METADATA_LABELS.has(text.trim().toLowerCase());
}

function meaningfulTokenCount(text: string): number {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(w => w.length > 1).length;
}

export interface CustomerCommentCandidate {
  commentId: string;
  username: string | null;
  text: string;
  /** authorType persisted at acquisition time ('owner'|'audience'|'unknown'), null on pre-migration rows. */
  authorType?: string | null;
  platform: "instagram" | "tiktok";
  competitorId: string;
}

export type CustomerValidationReason =
  | "OK"
  | "REJECTED_EMPTY"
  | "REJECTED_SPAM"
  | "REJECTED_LOW_SIGNAL"
  | "REJECTED_OWNER_AUTHOR"
  | "REJECTED_UNVERIFIED_AUTHOR"
  | "REJECTED_CTA_METADATA"
  | "REJECTED_NOT_SUBSTANTIVE"
  | "REJECTED_DUPLICATE";

export interface CustomerValidationResult {
  eligible: boolean;
  reason: CustomerValidationReason;
}

/**
 * Deterministic promotion gate: a social comment qualifies as
 * CUSTOMER_ORIGIN only when every provenance/content check passes.
 * Uncertain → rejected (fail closed).
 */
export function validateCustomerComment(
  candidate: CustomerCommentCandidate,
  ctx: { ownerHandles: string[] },
): CustomerValidationResult {
  const text = (candidate.text || "").trim();
  if (!text) return { eligible: false, reason: "REJECTED_EMPTY" };

  // Author provenance — fail closed.
  // 'owner' (stored or handle-matched) → competitor's own voice, never customer.
  // No stored authorType AND no username to check → cannot rule out owner.
  if (candidate.authorType === "owner") return { eligible: false, reason: "REJECTED_OWNER_AUTHOR" };
  if (candidate.authorType !== "audience") {
    if (!candidate.username) return { eligible: false, reason: "REJECTED_UNVERIFIED_AUTHOR" };
  }

  // Reuse the unified acquisition filter for spam/owner/low-signal semantics.
  const filterCtx: FilterContext = { ownerHandles: ctx.ownerHandles, seenCommentIds: new Set() };
  const decision = evaluateComment(
    { commentId: candidate.commentId, username: candidate.username, text },
    filterCtx,
  );
  if (decision.authorType === "owner") return { eligible: false, reason: "REJECTED_OWNER_AUTHOR" };
  if (!decision.accepted) return { eligible: false, reason: "REJECTED_SPAM" };
  // Emoji-only / tag-only / very-short are engagement, not customer expression.
  if (decision.status === "ACCEPTED_LOW_SIGNAL") return { eligible: false, reason: "REJECTED_LOW_SIGNAL" };

  // Never promote Avyron-generated CTA labels or non-semantic fragments.
  if (isCtaMetadataLabel(text)) return { eligible: false, reason: "REJECTED_CTA_METADATA" };
  if (meaningfulTokenCount(text) < 3 && decision.reason !== "INTENT_QUESTION") {
    return { eligible: false, reason: "REJECTED_NOT_SUBSTANTIVE" };
  }

  return { eligible: true, reason: "OK" };
}

export interface CustomerEvidenceArtifact {
  /** Stable artifact identity (platform comment ID). */
  artifactId: string;
  /** Independent-voice key: distinct authors = distinct voices, platform-agnostic. */
  voiceKey: string;
  text: string;
  platform: "instagram" | "tiktok";
  competitorId: string;
  category: "pain" | "objection" | "trust" | "content";
  /** Pain Registry entries whose underlying evidence this artifact IS (lineage tag only — never a second source; see circularity ban). */
  linkedPainIds: string[];
}

export interface CustomerEvidenceStats {
  candidates: number;
  eligible: number;
  rejectedByReason: Record<string, number>;
  dedupedCrossPost: number;
  linkedToPains: number;
}

const OBJECTION_RE = /but |however |doesn'?t work|not worth|too expensive|overpriced|scam|waste|disappointed|refund|predatory|won'?t|charge/i;
const TRUST_RE = /scam|fake|fraud|trust|misleading|never paid|dishonest|rip.?off/i;
const PAIN_RE = /struggle|frustrat|tired of|sick of|can'?t|confus|don'?t (know|understand)|overwhelm|stuck|exhaust|hate|problem|difficult|hard to|waited|waiting/i;

function categorizeCustomerText(text: string): CustomerEvidenceArtifact["category"] {
  if (TRUST_RE.test(text)) return "trust";
  if (OBJECTION_RE.test(text)) return "objection";
  if (PAIN_RE.test(text)) return "pain";
  return "content";
}

function normalizeForDedup(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

export interface ApprovedPainLineageRef {
  painId: string;
  evidenceUids: string[];
}

/**
 * Build validated CUSTOMER_ORIGIN artifacts from stored comment rows.
 *
 * - Every candidate passes validateCustomerComment (fail closed).
 * - Dedup: by artifactId, then by normalized text + author (same voice
 *   repeating/cross-posting = ONE artifact; different authors with the same
 *   text remain distinct voices).
 * - Pain Registry linkage: an artifact matching a pain's evidenceUid gets
 *   the painId as lineage. The pain's own interpreted statement is NEVER
 *   ingested as evidence, so the registry can never corroborate its own
 *   underlying artifact (circularity ban).
 */
export function buildCustomerEvidence(
  candidates: CustomerCommentCandidate[],
  opts: { ownerHandles: string[]; approvedPains?: ApprovedPainLineageRef[] },
): { artifacts: CustomerEvidenceArtifact[]; stats: CustomerEvidenceStats } {
  const stats: CustomerEvidenceStats = {
    candidates: candidates.length,
    eligible: 0,
    rejectedByReason: {},
    dedupedCrossPost: 0,
    linkedToPains: 0,
  };
  const seenArtifactIds = new Set<string>();
  const seenTextVoice = new Set<string>();
  const artifacts: CustomerEvidenceArtifact[] = [];

  const painUids = (opts.approvedPains || []).map(p => ({
    painId: p.painId,
    uids: p.evidenceUids.map(normalizeForDedup).filter(u => u.length >= 15),
  }));

  for (const cand of candidates) {
    const verdict = validateCustomerComment(cand, { ownerHandles: opts.ownerHandles });
    if (!verdict.eligible) {
      stats.rejectedByReason[verdict.reason] = (stats.rejectedByReason[verdict.reason] || 0) + 1;
      continue;
    }
    const artifactId = cand.commentId;
    if (seenArtifactIds.has(artifactId)) {
      stats.rejectedByReason["REJECTED_DUPLICATE"] = (stats.rejectedByReason["REJECTED_DUPLICATE"] || 0) + 1;
      continue;
    }
    const norm = normalizeForDedup(cand.text);
    const voiceKey = `customer:${(cand.username || artifactId).toLowerCase()}`;
    const textVoiceKey = `${voiceKey}::${norm}`;
    if (seenTextVoice.has(textVoiceKey)) {
      stats.dedupedCrossPost++;
      continue;
    }

    const linkedPainIds: string[] = [];
    for (const p of painUids) {
      if (p.uids.some(uid => norm.startsWith(uid) || uid.startsWith(norm.slice(0, Math.max(15, norm.length))))) {
        linkedPainIds.push(p.painId);
      }
    }
    if (linkedPainIds.length > 0) stats.linkedToPains++;

    seenArtifactIds.add(artifactId);
    seenTextVoice.add(textVoiceKey);
    stats.eligible++;
    artifacts.push({
      artifactId,
      voiceKey,
      text: cand.text.trim().slice(0, 300),
      platform: cand.platform,
      competitorId: cand.competitorId,
      category: categorizeCustomerText(cand.text),
      linkedPainIds,
    });
  }

  return { artifacts, stats };
}
