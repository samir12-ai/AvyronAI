/**
 * COMMERCIAL DNA — cross-engine unified strategic backbone
 *
 * Each marketing engine in this pipeline produces a commercial signal
 * (Phase 1-5: trustMechanism, gameDimension, valueArchitecture,
 * buyerPsychology, narrativeReframe). Individually those signals are useful;
 * stitched together they form the campaign's commercial DNA — the strategic
 * backbone that downstream content/funnel/channel work must obey.
 *
 * The CommercialDNA composition projects all 5 engine signals into ONE shape
 * a downstream engine can consume in O(1) without re-walking each upstream
 * signal. This is the schema referenced in Phase 6 of the marketing-logic
 * upgrade plan and consumed by the cross-engine validation script in Phase 7.
 *
 * Shape rules:
 *   - All fields nullable: each engine's contribution is optional and the
 *     pipeline must function with partial DNA.
 *   - Each contribution carries its source-of-truth signal name + emit
 *     timestamp so downstream readers can audit lineage.
 *   - composeCommercialDNA() is a pure projection — no side-effects, no AI
 *     calls, no I/O. Safe to call from any engine, any orchestrator step.
 *   - Backward-compatible: adding a new contribution slot (Phase 8+) does NOT
 *     break existing readers.
 */

import type {
  CommercialSignals,
  TrustMechanismSignal,
  GameDimensionSignal,
  ValueArchitectureSignal,
  BuyerPsychologySignal,
  NarrativeReframeSignal,
  ValidationQualitySignal,
  BudgetStrategySignal,
  ChannelOrchestrationSignal,
  IterationStrategySignal,
  RetentionEconomicsSignal,
  SystemJudgementSignal,
} from "../server/orchestrator/shared-strategic-context";

// ─── DNA contribution types — one per engine ───
export interface DnaPersuasionContribution {
  source: "persuasion.trustMechanism";
  trustModel: string;            // human-named trust model in play
  trustSourceCohort: string;     // who's transferring trust
  failureIfMisapplied: string;
  emittedAt: number;
}

export interface DnaPositioningContribution {
  source: "positioning.gameDimension";
  positioningGame: string;       // the game we're playing (named)
  competitorGame: string;        // the game competitors are playing
  defensibilityReason: string;
  emittedAt: number;
}

export interface DnaOfferContribution {
  source: "offer.valueArchitecture";
  primaryValueWedge: string;
  identityShift: { from: string; to: string; cost: string };
  commercialLeverage: string;    // the leverage point in the value chain
  topObjectionEconomics: string; // dollar/career framing of #1 objection
  emittedAt: number;
}

export interface DnaAudienceContribution {
  source: "audience.buyerPsychology";
  buyerTrigger: string;          // the real trigger event
  buyerBeliefAboutCategory: string;
  buyerIdentityAspiration: string;
  sophisticationTier: 1 | 2 | 3 | 4 | 5;
  cialdiniLeverages: string[];
  emittedAt: number;
}

export interface DnaAwarenessContribution {
  source: "awareness.narrativeReframe";
  newModelReclassification: string;
  namedPrinciple: string;
  bridgeMovement: string;        // analogy | first_principle | decisive_evidence | status_reframe | category_re_assignment
  discomfortCost: string;        // what the buyer must privately admit
  emittedAt: number;
}

// ─── The unified DNA ───
export interface CommercialDNA {
  campaignId: string;
  composedAt: number;            // when this projection was built

  // 5 engine contributions — null if engine hasn't emitted yet (mid-pipeline)
  persuasion: DnaPersuasionContribution | null;
  positioning: DnaPositioningContribution | null;
  offer: DnaOfferContribution | null;
  audience: DnaAudienceContribution | null;
  awareness: DnaAwarenessContribution | null;

  // Cross-engine consistency markers — quick read for downstream consumers
  // (content engines, funnel architect, channel selector)
  consistency: {
    contributingEngineCount: number;        // 0..5
    hasFullDna: boolean;                    // true if all 5 contributed
    sharedTriggerEvent: string | null;      // buyer trigger if known
    sharedDiscomfortCost: string | null;    // identity cost both audience+awareness should agree on
    contradictions: string[];               // human-readable contradictions detected
  };
}

/**
 * Compose CommercialDNA from a campaign's CommercialSignals registry.
 * Pure projection — no side effects.
 *
 * Safe to call at any point in the pipeline; partial DNA is valid output.
 */
export function composeCommercialDNA(
  campaignId: string,
  signals: CommercialSignals | null | undefined,
): CommercialDNA {
  const persuasion = projectPersuasion(signals?.trustMechanism);
  const positioning = projectPositioning(signals?.gameDimension);
  const offer = projectOffer(signals?.valueArchitecture);
  const audience = projectAudience(signals?.buyerPsychology);
  const awareness = projectAwareness(signals?.narrativeReframe);

  const present = [persuasion, positioning, offer, audience, awareness].filter(Boolean);
  const contributingEngineCount = present.length;

  // Cross-check: do audience + awareness agree on the buyer's identity cost?
  const audienceIdentityShift = audience?.buyerIdentityAspiration?.toLowerCase() || null;
  const awarenessDiscomfort = awareness?.discomfortCost?.toLowerCase() || null;
  const sharedDiscomfort = audience && awareness ? (awareness.discomfortCost || null) : null;

  // Cross-check: does Offer's identityShift align with Audience's identityAspiration?
  const contradictions: string[] = [];
  if (offer && audience) {
    const offerToIdentity = (offer.identityShift?.to || "").toLowerCase();
    const audienceTo = (audience.buyerIdentityAspiration || "").toLowerCase();
    // Treat as contradiction only if both are non-empty AND share zero non-trivial token overlap.
    if (offerToIdentity.length > 10 && audienceTo.length > 10) {
      const offerTokens = new Set(offerToIdentity.split(/[^a-z0-9]+/).filter(t => t.length > 4));
      const audTokens = new Set(audienceTo.split(/[^a-z0-9]+/).filter(t => t.length > 4));
      let overlap = 0;
      for (const t of offerTokens) if (audTokens.has(t)) overlap++;
      if (overlap === 0) {
        contradictions.push(
          `IDENTITY_DRIFT: Offer.identityShift.to ("${(offer.identityShift?.to || "").slice(0, 60)}") shares no terms with Audience.identityAspiration ("${(audience.buyerIdentityAspiration || "").slice(0, 60)}")`,
        );
      }
    }
  }

  if (persuasion && positioning) {
    // If positioning game is "outcome-aligned contracting" but trust model has nothing
    // about contract / outcome / penalty / refund, it's a coherence smell.
    const posGame = (positioning.positioningGame || "").toLowerCase();
    const trustModel = (persuasion.trustModel || "").toLowerCase();
    if (posGame.includes("outcome") || posGame.includes("contract")) {
      const trustMatchesGame = /(contract|outcome|penalty|refund|opt[\- ]out|attestation)/i.test(persuasion.trustModel || "");
      if (!trustMatchesGame) {
        contradictions.push(
          `GAME_TRUST_MISMATCH: Positioning game emphasizes outcomes/contracts but Persuasion trust model ("${(persuasion.trustModel || "").slice(0, 50)}") does not reference contract/outcome trust artifacts.`,
        );
      }
    }
  }

  // ── Phase 2 (May 2026) downstream contradiction detectors ──
  // These read the new commercial-decision signals (validationQuality, budgetStrategy,
  // channelOrchestration, iterationStrategy, retentionEconomics, systemJudgement)
  // and surface coherence breaks between strategy and the principal's commercial calls.
  const vq = signals?.validationQuality;
  const bs = signals?.budgetStrategy;
  const co = signals?.channelOrchestration;
  const it = signals?.iterationStrategy;
  const sj = signals?.systemJudgement;

  // IDENTITY_DRIFT_DOWNSTREAM — capital is asked to scale before validation says "usable_for_scale"
  if (bs && vq) {
    const wantsScaleCapital = bs.action === "scale" || bs.spendPace === "aggressive";
    if (wantsScaleCapital && vq.commercialUsability !== "usable_for_scale") {
      contradictions.push(
        `IDENTITY_DRIFT_DOWNSTREAM: Budget strategy asks for ${bs.spendPace} ${bs.action} pace but Validation says commercialUsability="${vq.commercialUsability}" — capital is moving ahead of evidence.`,
      );
    }
  }

  // READINESS_MISALIGNMENT — channel chose scale-grade entry while validation says learning-only
  if (co && vq) {
    const aggressiveEntry = /(beachhead.and.spread|dual.front|scale|expansion)/i.test(co.marketEntryPattern || "");
    const learningOnly = vq.commercialUsability === "usable_for_learning_only" || vq.commercialUsability === "not_usable";
    if (aggressiveEntry && learningOnly) {
      contradictions.push(
        `READINESS_MISALIGNMENT: Channel marketEntryPattern="${(co.marketEntryPattern || "").slice(0, 60)}" assumes scale-grade readiness but Validation usability is "${vq.commercialUsability}" — narrow to single-channel-validation first.`,
      );
    }
  }

  // LEARNING_LOOP_BROKEN — iteration plan is missing the kill heuristic while validation is provisional/learning
  if (it && vq) {
    const provisional = vq.commercialUsability === "usable_for_test" || vq.commercialUsability === "usable_for_learning_only";
    const killWeak = !it.killVsRetainHeuristic || it.killVsRetainHeuristic.length < 20 || /underperform|bad results|kill bad/i.test(it.killVsRetainHeuristic);
    if (provisional && killWeak) {
      contradictions.push(
        `LEARNING_LOOP_BROKEN: Validation is "${vq.commercialUsability}" so the campaign is in learning mode, but Iteration killVsRetainHeuristic is missing or generic ("${(it.killVsRetainHeuristic || "(none)").slice(0, 60)}") — the loop cannot close.`,
      );
    }
  }

  // SYSTEM_PRINCIPAL_OVERRIDE — surface when system judgement softens or escalates the deterministic verdict
  if (sj && bs) {
    if (/HALTED|PROOF_COLLECTION|HUMAN_REVIEW_REQUIRED|AWARENESS_BUILD_PHASE/.test(sj.recommendedExecutionMode) && bs.spendPace !== "frozen") {
      contradictions.push(
        `SYSTEM_PRINCIPAL_OVERRIDE: System judgement recommended "${sj.recommendedExecutionMode}" but Budget strategy spendPace is "${bs.spendPace}" — execution layer must respect the principal's mode downgrade.`,
      );
    }
  }

  return {
    campaignId,
    composedAt: Date.now(),
    persuasion,
    positioning,
    offer,
    audience,
    awareness,
    consistency: {
      contributingEngineCount,
      hasFullDna: contributingEngineCount === 5,
      sharedTriggerEvent: audience?.buyerTrigger || null,
      sharedDiscomfortCost: sharedDiscomfort,
      contradictions,
    },
  };
}

// ─── Per-engine projectors ───
function projectPersuasion(s: TrustMechanismSignal | undefined): DnaPersuasionContribution | null {
  if (!s) return null;
  return {
    source: "persuasion.trustMechanism",
    trustModel: (s as any).mechanism || (s as any).transferMechanism || (s as any).trustModel || "(unspecified)",
    trustSourceCohort: (s as any).trustSource || (s as any).sourceCohort || "(unspecified)",
    failureIfMisapplied: (s as any).failureIfMisapplied || "(unspecified)",
    emittedAt: (s as any).emittedAt || 0,
  };
}

function projectPositioning(s: GameDimensionSignal | undefined): DnaPositioningContribution | null {
  if (!s) return null;
  const a = s as any;
  // Canonical orchestrator emit shape: { ourDimension: string, ourGame: string, competitorGames: [{game}], defensibility: string, defensibilityProof: string }
  // Tolerate legacy/test shapes that nested ourGame as { dimension, game }.
  const positioningGame =
    a.ourDimension ||
    (typeof a.ourGame === "string" ? a.ourGame : (a.ourGame?.dimension || a.ourGame?.game)) ||
    a.dimension ||
    "(unspecified)";
  const competitorGame =
    a.competitorGames?.[0]?.game ||
    (typeof a.competitorGames?.[0] === "string" ? a.competitorGames[0] : null) ||
    a.competitorGame ||
    "(unspecified)";
  const defensibilityReason =
    a.defensibility?.reason ||
    (typeof a.defensibility === "string" ? a.defensibility : null) ||
    a.defensibilityProof ||
    "(unspecified)";
  return {
    source: "positioning.gameDimension",
    positioningGame,
    competitorGame,
    defensibilityReason,
    emittedAt: a.emittedAt || 0,
  };
}

function projectOffer(s: ValueArchitectureSignal | undefined): DnaOfferContribution | null {
  if (!s) return null;
  return {
    source: "offer.valueArchitecture",
    primaryValueWedge: s.primaryValueWedge || "(unspecified)",
    identityShift: {
      from: s.identityShift?.fromIdentity || "(unspecified)",
      to: s.identityShift?.toIdentity || "(unspecified)",
      cost: s.identityShift?.identityCost || "(unspecified)",
    },
    commercialLeverage: `${s.commercialLeverage?.pointInChain || "?"}: ${s.commercialLeverage?.leverageMechanism || "(unspecified)"}`,
    topObjectionEconomics: s.topObjectionEconomics?.[0]
      ? `${s.topObjectionEconomics[0].objection} → ${s.topObjectionEconomics[0].revenueAtStakeIfUnresolved}`
      : "(unspecified)",
    emittedAt: s.emittedAt || 0,
  };
}

function projectAudience(s: BuyerPsychologySignal | undefined): DnaAudienceContribution | null {
  if (!s) return null;
  return {
    source: "audience.buyerPsychology",
    buyerTrigger: s.decisionTrigger?.triggeringEvent || "(unspecified)",
    buyerBeliefAboutCategory: s.beliefModel?.aboutCategory || "(unspecified)",
    buyerIdentityAspiration: s.identityAspiration?.aspirationalIdentity || "(unspecified)",
    sophisticationTier: s.sophisticationTier,
    cialdiniLeverages: s.cialdiniLeverages || [],
    emittedAt: s.emittedAt || 0,
  };
}

function projectAwareness(s: NarrativeReframeSignal | undefined): DnaAwarenessContribution | null {
  if (!s) return null;
  return {
    source: "awareness.narrativeReframe",
    newModelReclassification: s.newModelReclassification || "(unspecified)",
    namedPrinciple: s.namedPrinciple || "(unspecified)",
    bridgeMovement: s.bridgeMovement || "first_principle",
    discomfortCost: s.discomfortCost?.privateAdmission || "(unspecified)",
    emittedAt: s.emittedAt || 0,
  };
}

/**
 * Convenience: human-readable summary of the DNA — useful for log lines and
 * for pasting into LLM prompts in downstream content/funnel engines.
 */
export function summarizeCommercialDNA(dna: CommercialDNA): string {
  const lines: string[] = [
    `# Commercial DNA — campaign=${dna.campaignId} (${dna.consistency.contributingEngineCount}/5 engines contributed${dna.consistency.hasFullDna ? ", FULL" : ""})`,
  ];
  if (dna.audience) {
    lines.push(`## Buyer (Audience)`);
    lines.push(`- Trigger: ${dna.audience.buyerTrigger}`);
    lines.push(`- Believes about category: ${dna.audience.buyerBeliefAboutCategory}`);
    lines.push(`- Aspires to be: ${dna.audience.buyerIdentityAspiration}`);
    lines.push(`- Sophistication tier: ${dna.audience.sophisticationTier} | Cialdini: ${dna.audience.cialdiniLeverages.join(", ") || "(none)"}`);
  }
  if (dna.positioning) {
    lines.push(`## Game (Positioning)`);
    lines.push(`- Our game: ${dna.positioning.positioningGame}`);
    lines.push(`- Competitor game: ${dna.positioning.competitorGame}`);
    lines.push(`- Defensibility: ${dna.positioning.defensibilityReason}`);
  }
  if (dna.offer) {
    lines.push(`## Value (Offer)`);
    lines.push(`- Primary wedge: ${dna.offer.primaryValueWedge}`);
    lines.push(`- Identity: ${dna.offer.identityShift.from} → ${dna.offer.identityShift.to} (cost: ${dna.offer.identityShift.cost})`);
    lines.push(`- Leverage: ${dna.offer.commercialLeverage}`);
    lines.push(`- #1 objection economics: ${dna.offer.topObjectionEconomics}`);
  }
  if (dna.awareness) {
    lines.push(`## Reframe (Awareness)`);
    lines.push(`- New classification: ${dna.awareness.newModelReclassification}`);
    lines.push(`- Named principle: ${dna.awareness.namedPrinciple}`);
    lines.push(`- Bridge movement: ${dna.awareness.bridgeMovement}`);
    lines.push(`- Discomfort cost: ${dna.awareness.discomfortCost}`);
  }
  if (dna.persuasion) {
    lines.push(`## Trust (Persuasion)`);
    lines.push(`- Trust model: ${dna.persuasion.trustModel}`);
    lines.push(`- Trust source cohort: ${dna.persuasion.trustSourceCohort}`);
    lines.push(`- Failure if misapplied: ${dna.persuasion.failureIfMisapplied}`);
  }
  if (dna.consistency.contradictions.length > 0) {
    lines.push(`## ⚠ Cross-engine contradictions`);
    for (const c of dna.consistency.contradictions) lines.push(`- ${c}`);
  }
  return lines.join("\n");
}

/**
 * Seal #8 / F3.3 — Commercial-reasoning rejection registry.
 *
 * Doctrine recap: when a commercial-reasoning module's judge returns
 * FINAL_REJECTED (or its judge call throws / unparseable), the module STILL
 * returns null and the engine STILL falls through to its legacy output —
 * pipeline never breaks. But that silent fallthrough hid the rejection from
 * downstream plan synthesis.
 *
 * This registry adds a PARALLEL rejection-surface (it does NOT replace the
 * fallthrough): each module records its rejection here, the orchestrator
 * collects and attaches the rejections to ctx after all engines run, and
 * plan synthesis can then reflect the degraded reasoning quality
 * (`commercialReasoningRejected` field + `validationState=weak` downgrade).
 *
 * The registry is keyed per orchestrator run; callers must call
 * `clearCommercialRejections(runKey)` at run start (orchestrator) or pass
 * unique runKeys to avoid cross-run leakage.
 */
export type CommercialRejectionModule =
  | "persuasion.trustTransfer"
  | "positioning.categoryGame"
  | "offer.valueArchitect"
  | "audience.buyerPsychology"
  | "awareness.narrativeReframe";

export type CommercialRejectionReason =
  | "FINAL_REJECTED"      // judge issued REJECTED on both v1 and retry
  | "JUDGE_ERROR"         // judge call threw or returned unparseable JSON
  | "DESIGN_INVALID";     // designer output failed schema validation

export interface CommercialRejection {
  module: CommercialRejectionModule;
  reason: CommercialRejectionReason;
  detail: string;
  emittedAt: number;
}

// Seal #8 / F3.3 architect-pass-4 fix — bounded LRU cap so registry cannot
// grow unboundedly when orchestrator early-exit paths skip the end-of-run
// `clearCommercialRejections(jobId)` cleanup. JS Map preserves insertion
// order; on overflow we evict the oldest entry (FIFO/LRU-on-write).
const __COMMERCIAL_REGISTRY_MAX_KEYS = 1000;
const __commercialRejections = new Map<string, CommercialRejection[]>();

// Seal #8 / F3.3 architect-pass-2 fix — concurrency hardening.
// Per-run AsyncLocalStorage scope so parallel orchestrator runs for the SAME
// account can't clobber each other's rejection registry. Orchestrator wraps
// the synthesis path with `runWithCommercialRunKey(jobId, ...)`, and inside
// that scope the registry key is jobId-derived rather than accountId-derived.
// When no ALS context is set (tests, ad-hoc) we fall back to the explicit
// runKey arg (preserves backward compat with all current call sites).
import { AsyncLocalStorage } from "node:async_hooks";
const __commercialRunKeyALS = new AsyncLocalStorage<string>();
export function runWithCommercialRunKey<T>(runKey: string, fn: () => T | Promise<T>): T | Promise<T> {
  if (!runKey) return fn();
  return __commercialRunKeyALS.run(runKey, fn);
}
/**
 * Imperative ALS entry — orchestrator calls this once jobId is known so every
 * downstream module's `recordCommercialRejection(args.accountId, ...)` is
 * routed to the jobId-scoped registry slot. Avoids needing to wrap the entire
 * 800-line orchestrator body in a callback. Each orchestrator run executes in
 * its own async chain (top-level handler), so `enterWith` per-run is safe.
 */
export function enterCommercialRunKey(runKey: string): void {
  if (!runKey) return;
  __commercialRunKeyALS.enterWith(runKey);
}
function __resolveRunKey(explicit: string): string {
  // ALS wins when set — guarantees orchestrator's per-run jobId scope is
  // honored even if a downstream module passes accountId.
  return __commercialRunKeyALS.getStore() || explicit;
}

export function recordCommercialRejection(
  runKey: string,
  rejection: Omit<CommercialRejection, "emittedAt">,
): void {
  const key = __resolveRunKey(runKey);
  if (!key) return;
  const arr = __commercialRejections.get(key) || [];
  arr.push({ ...rejection, emittedAt: Date.now() });
  __commercialRejections.set(key, arr);
  // Bounded LRU eviction: if size exceeds cap, drop oldest insertion.
  if (__commercialRejections.size > __COMMERCIAL_REGISTRY_MAX_KEYS) {
    const oldest = __commercialRejections.keys().next().value;
    if (oldest !== undefined) __commercialRejections.delete(oldest);
  }
}

/** Test-only: introspect registry size for cap-enforcement assertions. */
export function __commercialRegistrySize(): number {
  return __commercialRejections.size;
}
export function __commercialRegistryMaxKeys(): number {
  return __COMMERCIAL_REGISTRY_MAX_KEYS;
}

export function getCommercialRejections(runKey: string): CommercialRejection[] {
  const key = __resolveRunKey(runKey);
  return __commercialRejections.get(key) ? [...__commercialRejections.get(key)!] : [];
}

export function clearCommercialRejections(runKey: string): void {
  const key = __resolveRunKey(runKey);
  __commercialRejections.delete(key);
}
