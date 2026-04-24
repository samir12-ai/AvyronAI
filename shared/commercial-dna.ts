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
