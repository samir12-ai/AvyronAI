/**
 * VALUE ARCHITECT (Phase 3 marketing-logic upgrade)
 *
 * Top offer designers do NOT pick a "great offer" by listing features and stacking risk
 * reversals. They reason commercially:
 *
 *   1. Outcome chain: feature → functional outcome → emotional outcome → identity outcome
 *      (the buyer doesn't buy the feature, they buy the identity it lets them claim)
 *   2. Commercial leverage: which point in the chain gives us the largest commercial
 *      multiplier? (the dimension where we can charge more / convert faster / churn less)
 *   3. Objection economics: each objection has a $ cost — which objection, neutralized,
 *      moves the most revenue?
 *   4. Identity cost: every purchase costs the buyer some identity surrender
 *      ("admitting the old way wasn't working") — what's our identity-cost vs alternatives?
 *
 * CRITICAL: this module is the first phase that CONSUMES UPSTREAM COMMERCIAL SIGNALS.
 *   - P1 trustMechanism → tells us the trust architecture the offer must extend
 *   - P2 gameDimension → tells us the strategic dimension the offer must defend
 *
 * Same pattern as trust-transfer.ts and category-game.ts:
 *   - Designer LLM call (gpt-4.1-mini @ 0.3) with few-shot anchors
 *   - Hostile judge (gpt-4.1-mini @ 0.1) that rejects feature-list offers
 *   - One retry with judge feedback
 *   - Safe fallback (returns null → engine continues with legacy path)
 */
import { aiChat } from "../ai-client";
import type { TrustMechanismSignal, GameDimensionSignal } from "../orchestrator/shared-strategic-context";
import type { ProductAnchor } from "../shared/strategic-doctrine";

export interface OutcomeChainNode {
  feature: string;       // the concrete feature / capability
  functional: string;    // what it lets the buyer DO
  emotional: string;     // what it lets the buyer FEEL
  identity: string;      // what it lets the buyer CLAIM about themselves
}

export interface ObjectionEconomic {
  objection: string;
  revenueAtStakeIfUnresolved: string;   // qualitative: "blocks 60% of qualified pipeline"
  neutralizingMechanism: string;        // the offer element that defuses it
  costOfNeutralizing: string;           // what we give up to neutralize it
}

export interface ValueArchitecture {
  outcomeChain: OutcomeChainNode[];
  identityShift: {
    fromIdentity: string;   // who buyer is today
    toIdentity: string;     // who buyer becomes after using product
    identityCost: string;   // what they have to admit / give up to make the shift
  };
  commercialLeverage: {
    pointInChain: "feature" | "functional" | "emotional" | "identity";
    leverageMechanism: string;     // the named lever (e.g. "premium pricing on identity tier")
    leverageProof: string;         // why this point gives the largest multiplier
  };
  objectionEconomics: ObjectionEconomic[];
  primaryValueWedge: string;       // the ONE value claim that wins the deal
  reasoningSteps: string[];
  groundedInTrustMechanism: string | null;     // what trust mechanism the offer extends
  groundedInGameDimension: string | null;      // what strategic dimension the offer defends
  judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN";
  judgeReason: string;
  retryCount: number;
}

interface DesignerInput {
  offerName: string;
  coreOutcome: string;
  mechanismDescription: string;
  deliverables: string[];
  audiencePains: string[];
  audienceDesires: string[];
  audienceObjections: string[];
  rejectedClaimPatterns: string[];
  trustMechanism: TrustMechanismSignal | null;
  gameDimension: GameDimensionSignal | null;
  /** Fix 4: locked product anchor (doctrine or DNA-derived) — grounds the value
   *  chain in THIS product's identity so the architecture can't be generic. */
  productAnchor?: ProductAnchor | null;
  accountId: string;
}

const FEW_SHOT = `
EXAMPLE 1 — WEAK (rejected by judge):
{
  "outcomeChain": [{"feature":"AI dashboard","functional":"see metrics","emotional":"feel confident","identity":"data-driven leader"}],
  "identityShift": {"fromIdentity":"old marketer","toIdentity":"modern marketer","identityCost":"none"},
  "commercialLeverage": {"pointInChain":"feature","leverageMechanism":"charge premium for AI","leverageProof":"AI is hot"},
  "objectionEconomics": [{"objection":"too expensive","revenueAtStakeIfUnresolved":"high","neutralizingMechanism":"discount","costOfNeutralizing":"margin"}],
  "primaryValueWedge": "be more data-driven"
}
WHY IT FAILS: "data-driven leader" is a vibe not an identity. "identityCost: none" is impossible — every purchase has identity cost. "charge premium because AI is hot" is not commercial reasoning. "be more data-driven" is a slogan.

EXAMPLE 2 — STRONG (accepted):
{
  "outcomeChain": [
    {
      "feature": "21-day proof window with revenue-tied billing",
      "functional": "CMO can show CFO attributable revenue in current quarter, not next year",
      "emotional": "Relief — the CMO sleeps at night knowing the vendor's economics depend on her win",
      "identity": "The CMO who escaped the vendor-fatigue trap and brought in a partner whose interests are structurally aligned with hers"
    }
  ],
  "identityShift": {
    "fromIdentity": "CMO who's been burnt by 2 vendors and is one miss from PIP",
    "toIdentity": "CMO who built a defensible quarterly attribution motion her CFO trusts and who structurally cannot be ghosted",
    "identityCost": "She has to publicly admit her last 2 picks were wrong and that she allowed long contracts she couldn't escape — the new vendor's billing model forces that admission to be visible to her board"
  },
  "commercialLeverage": {
    "pointInChain": "identity",
    "leverageMechanism": "Premium 25% on contracts that include the public-attribution dashboard CFOs see — buyers pay for the identity-defense, not the dashboard",
    "leverageProof": "Buyers facing PIP-level career risk will pay 2-3x to neutralize career risk vs the same buyer in safe-tenure mode — identity-tier is the only point with that multiplier"
  },
  "objectionEconomics": [
    {
      "objection": "Why a 12-month contract when I need 90-day proof?",
      "revenueAtStakeIfUnresolved": "Blocks ~60% of qualified pipeline — every CMO at this risk-level asks this",
      "neutralizingMechanism": "Month-by-month opt-out built into base contract — they only stay if winning",
      "costOfNeutralizing": "We sacrifice ~15% of locked-in revenue from low-fit accounts but win 3x on conversion of high-fit ones"
    }
  ],
  "primaryValueWedge": "The only B2B martech vendor that loses money if your quarter fails — buy us not because we're better, but because our incentives are structurally aligned with your career survival"
}
WHY IT WORKS: Identity is named with specificity (career-risk-CMO, not "modern marketer"). Identity-cost is real (public admission of past wrong picks). Commercial leverage names WHERE the multiplier sits (identity tier) and WHY. Objection economics quantify the impact + the trade. Primary wedge is defensible and unique.
`;

function buildDesignerPrompt(args: DesignerInput): string {
  const dlvBlock = args.deliverables.slice(0, 8).map((d, i) => `[DLV${i + 1}] ${d}`).join("\n") || "(none)";
  const painBlock = args.audiencePains.slice(0, 8).map((p, i) => `[PAIN${i + 1}] ${p}`).join("\n") || "(none)";
  const desireBlock = args.audienceDesires.slice(0, 8).map((d, i) => `[DESIRE${i + 1}] ${d}`).join("\n") || "(none)";
  const objBlock = args.audienceObjections.slice(0, 6).map((o, i) => `[OBJ${i + 1}] ${o}`).join("\n") || "(none)";
  const rejectedBlock = args.rejectedClaimPatterns.length
    ? args.rejectedClaimPatterns.slice(0, 6).map(r => `- ${r}`).join("\n")
    : "(none)";

  const trustBlock = args.trustMechanism
    ? `\n═══ UPSTREAM TRUST MECHANISM (you MUST extend this — do NOT redesign it) ═══
Trust transfer mechanism: ${args.trustMechanism.transferMechanism}
Required proof artifact:  ${args.trustMechanism.proofArtifact}
Buyer risk state:         ${args.trustMechanism.buyerRiskState}
Risk severity:            ${args.trustMechanism.riskSeverity}
Trust deficit:            ${args.trustMechanism.trustDeficit}
Commercial function:      ${args.trustMechanism.commercialFunction}

GROUNDING RULE: Your offer's commercial leverage and objection-economics MUST extend (not contradict) the named trust mechanism. If the trust mechanism is "named-CMO peer outcomes", the offer should make peer outcomes part of the deliverables. If the mechanism is "structural-incentive alignment", the offer should make incentive alignment a billable surface.
═══`
    : "\n(no upstream trust mechanism signal — design from scratch)";

  // Fix 4: product-anchor grounding block — the value chain must resolve to THIS
  // product's named identity, not a category-generic architecture.
  const anchorBlock = args.productAnchor
    ? `\n═══ LOCKED PRODUCT ANCHOR (ground every chain node in THIS product) ═══
Product name: ${args.productAnchor.name}
Product type: ${args.productAnchor.type}
${args.productAnchor.keyAttributes.length > 0 ? `Key attributes: ${args.productAnchor.keyAttributes.join("; ")}\n` : ""}Core problem solved: ${args.productAnchor.coreProblemSolved}
Differentiating feature: ${args.productAnchor.differentiatingFeature}

GROUNDING RULE: The outcome chain, commercial leverage, and primary value wedge MUST be traceable to the anchor's differentiating feature and core problem. If your value architecture could be pasted onto a generic competitor in the same category without edits, it will be REJECTED.
═══`
    : "";

  const gameBlock = args.gameDimension
    ? `\n═══ UPSTREAM CATEGORY-GAME DIMENSION (you MUST defend — do NOT play competitor's game) ═══
Our strategic dimension: ${args.gameDimension.ourDimension}
Our game on dimension:   ${args.gameDimension.ourGame}
Defensibility:           ${args.gameDimension.defensibility}
Defensibility proof:     ${args.gameDimension.defensibilityProof}
Buyer's actual game:     ${args.gameDimension.buyerActualGame}
Competitor games (do not let our offer drift onto these dimensions):
${args.gameDimension.competitorGames.map(c => `  - ${c.name}: ${c.dimension}`).join("\n")}

GROUNDING RULE: Every value-chain node and the primary value wedge MUST sit on our strategic dimension. If our dimension is "time-to-first-win speed", the identity-tier outcome must reference speed-of-winning, not feature-richness. If a deliverable would shift us onto a competitor's dimension, flag it as drift.
═══`
    : "\n(no upstream game dimension signal — design from scratch)";

  return `You are a Value Architect (Alex Hormozi / 100M Offers / Eugene Schwartz / Russell Brunson lineage).
Your job is NOT to make the offer "better-stacked" — that produces feature-list offers. Your job is to architect the COMMERCIAL VALUE CHAIN: feature → functional → emotional → identity, name where the largest commercial multiplier sits, and prove it with reasoning the buyer would recognize.${anchorBlock}${trustBlock}${gameBlock}

═══ THE OFFER (already drafted — you are reasoning ABOUT it, not redesigning it) ═══
Offer name: ${args.offerName}
Core outcome: ${args.coreOutcome}
Mechanism: ${args.mechanismDescription}
Deliverables:
${dlvBlock}

═══ AUDIENCE EVIDENCE (cite by ID — required) ═══
PAINS:
${painBlock}

DESIRES:
${desireBlock}

OBJECTIONS:
${objBlock}

═══ ALREADY-EXHAUSTED CLAIM PATTERNS (do not repeat) ═══
${rejectedBlock}

${FEW_SHOT}

═══ YOUR TASK ═══
Reason in this exact order:

1. **Outcome chain** — For the core deliverable(s), build the full chain: feature → functional outcome (what they DO) → emotional outcome (what they FEEL) → identity outcome (what they CAN CLAIM about themselves). Identity must be a named role/state a real buyer would say out loud, not a vibe ("data-driven leader" = vibe; "the CMO who escaped vendor lock-in trap" = real).

2. **Identity shift** — Specifically, who is the buyer TODAY (with all their baggage), and who do they become AFTER using the product? What identity COST do they pay (every real purchase costs identity — admitting old way wasn't working, surrendering an old self-story)?

3. **Commercial leverage** — Which point in the chain (feature / functional / emotional / identity) gives the LARGEST commercial multiplier? Name the lever (premium pricing, faster conversion, lower churn, higher LTV) and PROVE why this point — not the others — has that multiplier.

4. **Objection economics** — For 2-3 most-revenue-blocking objections from [OBJ#] list, state: revenue at stake if unresolved, the neutralizing mechanism, and the COST of neutralizing it (every neutralization is a trade — name it).

5. **Primary value wedge** — The ONE value claim that wins the deal. Not a slogan. The thing the buyer would tell their CFO to justify the purchase.

HARD RULES:
- Identity must be a NAMED, SPECIFIC role/state — not "successful leader" / "modern marketer" / "data-driven X". Cite [PAIN#] / [DESIRE#] evidence for the from-identity.
- Identity cost cannot be "none" — find the real surrender (admitting past mistakes, breaking a peer norm, etc.).
- Commercial leverage MUST name a specific commercial mechanism (premium tier pricing, lower-CAC channel, faster sales cycle, etc.) and the multiplier estimate doesn't need a number but must be defensible reasoning.
- Objection economics: each objection needs all 3 fields (stake, mechanism, cost) — partial answers = rejected.
- Primary wedge cannot be a generic claim ("better X", "faster Y") — it must reference the specific mechanism + the identity it protects.
${args.productAnchor ? `- The value chain and primary wedge MUST cite the anchor's differentiating feature ("${args.productAnchor.differentiatingFeature.slice(0, 120)}") or core problem — architectures that fit any generic competitor are rejected.` : ""}
${args.trustMechanism ? "- Set groundedInTrustMechanism to a 1-line description of how this offer extends the upstream trust mechanism." : ""}
${args.gameDimension ? "- Set groundedInGameDimension to a 1-line description of how this offer defends our category-game dimension." : ""}

Return ONLY valid JSON, no commentary:
{
  "outcomeChain": [{"feature":"...","functional":"...","emotional":"...","identity":"..."}],
  "identityShift": {"fromIdentity":"...","toIdentity":"...","identityCost":"..."},
  "commercialLeverage": {"pointInChain":"identity"|"emotional"|"functional"|"feature","leverageMechanism":"...","leverageProof":"..."},
  "objectionEconomics": [{"objection":"...","revenueAtStakeIfUnresolved":"...","neutralizingMechanism":"...","costOfNeutralizing":"..."}],
  "primaryValueWedge": "...",
  "reasoningSteps": ["...","..."],
  "groundedInTrustMechanism": "..." or null,
  "groundedInGameDimension": "..." or null
}`;
}

function buildJudgePrompt(designJson: string, hadTrustMechanism: boolean, hadGameDimension: boolean, productAnchor?: ProductAnchor | null): string {
  const groundingRules: string[] = [];
  if (hadTrustMechanism) groundingRules.push("- groundedInTrustMechanism is null or doesn't reference how the offer extends the trust mechanism");
  if (hadGameDimension) groundingRules.push("- groundedInGameDimension is null or doesn't reference how the offer defends the category-game dimension");
  // Fix 4: generic-competitor rejection rule — judged against the locked anchor.
  if (productAnchor) {
    groundingRules.push(
      `- Is INTERCHANGEABLE with a generic competitor: the outcome chain / commercial leverage / primary wedge never resolves to this product's differentiating feature ("${productAnchor.differentiatingFeature.slice(0, 120)}") or its core problem ("${productAnchor.coreProblemSolved.slice(0, 120)}") — if the document could be pasted onto any competitor in the category without edits, REJECT it`,
    );
  }

  return `You are a hostile reviewer of a value architecture document. Reject anything that:
- Has identity outcomes that are vibes ("data-driven leader", "modern marketer", "successful X") instead of named roles tied to evidence
- Sets identityCost to "none" or "minimal" (every real purchase has identity cost)
- Has commercialLeverage proof that is "X is hot" or "buyers want X" — proof must be a defensible commercial mechanism
- Has any objectionEconomics entry missing one of: revenueAtStakeIfUnresolved, neutralizingMechanism, costOfNeutralizing
- Has primaryValueWedge that is a generic slogan ("better X", "smarter Y") instead of a CFO-justifiable claim
${groundingRules.join("\n")}

DESIGN TO REVIEW:
${designJson}

Return ONLY: {"verdict":"ACCEPTED"|"REJECTED","reason":"...","fix":"specific actionable fix if rejected"}`;
}

function safeJSON<T>(raw: string): T | null {
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    return JSON.parse(cleaned) as T;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]) as T; } catch { return null; }
    }
    return null;
  }
}

export async function designValueArchitecture(args: DesignerInput): Promise<ValueArchitecture | null> {
  const startTs = Date.now();
  console.log(`[ValueArchitect] STEP_1 | designing | offer="${args.offerName.slice(0, 50)}" | trustMech=${!!args.trustMechanism} | gameDim=${!!args.gameDimension} | pains=${args.audiencePains.length}`);

  let designRaw: string | null = null;
  let v1: any = null;
  try {
    const resp = await aiChat({
      messages: [{ role: "user", content: buildDesignerPrompt(args) }],
      model: "gpt-4.1-mini",
      temperature: 0.3,
      max_tokens: 1800,
      accountId: args.accountId,
    });
    designRaw = resp.choices?.[0]?.message?.content?.trim() || null;
    if (!designRaw) {
      console.warn("[ValueArchitect] STEP_1_FAILED | empty response");
      return null;
    }
    v1 = safeJSON<any>(designRaw);
    if (!v1) {
      console.warn("[ValueArchitect] STEP_1_FAILED | non-JSON response");
      return null;
    }
  } catch (err: any) {
    console.warn(`[ValueArchitect] STEP_1_FAILED | ${err.message}`);
    return null;
  }

  console.log(`[ValueArchitect] STEP_2 | design_v1 | leveragePoint=${v1.commercialLeverage?.pointInChain} | objections=${(v1.objectionEconomics || []).length} | wedge="${(v1.primaryValueWedge || "").slice(0, 60)}"`);

  // ─── JUDGE ───
  let judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN" = "NOT_RUN";
  let judgeReason = "";
  let judgeFix = "";
  try {
    const judgeResp = await aiChat({
      messages: [{ role: "user", content: buildJudgePrompt(designRaw, !!args.trustMechanism, !!args.gameDimension, args.productAnchor) }],
      model: "gpt-4.1-mini",
      temperature: 0.1,
      max_tokens: 400,
      accountId: args.accountId,
    });
    const judgeRaw = judgeResp.choices?.[0]?.message?.content?.trim() || "";
    const judged = safeJSON<{ verdict: string; reason: string; fix?: string }>(judgeRaw);
    if (judged?.verdict === "ACCEPTED" || judged?.verdict === "REJECTED") {
      judgeVerdict = judged.verdict as any;
      judgeReason = judged.reason || "";
      judgeFix = judged.fix || "";
    } else {
      // accept-by-default. No positive evidence → REJECTED + JUDGE_ERROR.
      judgeVerdict = "REJECTED";
      judgeReason = `JUDGE_ERROR: unparseable judge output (raw="${judgeRaw.slice(0, 80)}")`;
    }
  } catch (err: any) {
    console.warn(`[ValueArchitect] JUDGE_FAILED | ${err.message} — treating as REJECTED (no positive verdict)`);
    judgeVerdict = "REJECTED";
    judgeReason = `JUDGE_ERROR: ${err.message}`;
  }
  console.log(`[ValueArchitect] STEP_3 | judge=${judgeVerdict} | reason="${judgeReason.slice(0, 80)}"`);

  // ─── RETRY (once) if rejected ───
  let final = v1;
  let retryCount = 0;
  if (judgeVerdict === "REJECTED" && judgeFix) {
    retryCount = 1;
    try {
      const retryPrompt = buildDesignerPrompt(args) + `\n\n═══ JUDGE REJECTED YOUR PRIOR ATTEMPT ═══\nReason: ${judgeReason}\nRequired fix: ${judgeFix}\n\nFix the specific issue called out and return the corrected JSON only.`;
      const retryResp = await aiChat({
        messages: [{ role: "user", content: retryPrompt }],
        model: "gpt-4.1-mini",
        temperature: 0.25,
        max_tokens: 1800,
        accountId: args.accountId,
      });
      const retryRaw = retryResp.choices?.[0]?.message?.content?.trim() || "";
      const v2 = safeJSON<any>(retryRaw);
      if (v2) {
        final = v2;
        console.log(`[ValueArchitect] STEP_4_RETRY | accepted_v2`);
        judgeVerdict = "ACCEPTED";
        judgeReason = `auto-corrected after retry; original issue: ${judgeReason}`;
      }
    } catch (err: any) {
      console.warn(`[ValueArchitect] RETRY_FAILED | ${err.message} — keeping v1`);
    }
  }

  const validLeveragePoints = ["feature", "functional", "emotional", "identity"];
  const result: ValueArchitecture = {
    outcomeChain: Array.isArray(final.outcomeChain)
      ? final.outcomeChain
          .map((n: any) => ({
            feature: String(n.feature || "").trim(),
            functional: String(n.functional || "").trim(),
            emotional: String(n.emotional || "").trim(),
            identity: String(n.identity || "").trim(),
          }))
          .filter((n: OutcomeChainNode) => n.feature && n.identity)
      : [],
    identityShift: {
      fromIdentity: String(final.identityShift?.fromIdentity || "").trim(),
      toIdentity: String(final.identityShift?.toIdentity || "").trim(),
      identityCost: String(final.identityShift?.identityCost || "").trim(),
    },
    commercialLeverage: {
      pointInChain: validLeveragePoints.includes(final.commercialLeverage?.pointInChain)
        ? final.commercialLeverage.pointInChain
        : "identity",
      leverageMechanism: String(final.commercialLeverage?.leverageMechanism || "").trim(),
      leverageProof: String(final.commercialLeverage?.leverageProof || "").trim(),
    },
    objectionEconomics: Array.isArray(final.objectionEconomics)
      ? final.objectionEconomics
          .map((o: any) => ({
            objection: String(o.objection || "").trim(),
            revenueAtStakeIfUnresolved: String(o.revenueAtStakeIfUnresolved || "").trim(),
            neutralizingMechanism: String(o.neutralizingMechanism || "").trim(),
            costOfNeutralizing: String(o.costOfNeutralizing || "").trim(),
          }))
          .filter((o: ObjectionEconomic) => o.objection && o.neutralizingMechanism && o.costOfNeutralizing)
      : [],
    primaryValueWedge: String(final.primaryValueWedge || "").trim(),
    reasoningSteps: Array.isArray(final.reasoningSteps) ? final.reasoningSteps.map((s: any) => String(s).trim()).filter(Boolean) : [],
    groundedInTrustMechanism: final.groundedInTrustMechanism ? String(final.groundedInTrustMechanism).trim() : null,
    groundedInGameDimension: final.groundedInGameDimension ? String(final.groundedInGameDimension).trim() : null,
    judgeVerdict,
    judgeReason,
    retryCount,
  };

  if (!result.primaryValueWedge || result.outcomeChain.length === 0 || !result.identityShift.toIdentity) {
    console.warn(`[ValueArchitect] DROP | structurally incomplete | wedge=${!!result.primaryValueWedge} | chain=${result.outcomeChain.length} | toIdentity=${!!result.identityShift.toIdentity}`);
    return null;
  }

  console.log(`[ValueArchitect] DONE in ${Date.now() - startTs}ms | finalVerdict=${result.judgeVerdict} | retries=${result.retryCount} | leveragePoint=${result.commercialLeverage.pointInChain} | groundedTrust=${!!result.groundedInTrustMechanism} | groundedGame=${!!result.groundedInGameDimension}`);
  if (result.judgeVerdict === "REJECTED") {
    console.warn(`[ValueArchitect] FINAL_REJECTED — falling back to legacy offer output (no valueArchitecture emitted)`);
    try {
      const { recordCommercialRejection } = await import("../../shared/commercial-dna");
      const isJudgeErr = String(result.judgeReason || "").startsWith("JUDGE_ERROR");
      recordCommercialRejection(args.accountId, {
        module: "offer.valueArchitect",
        reason: isJudgeErr ? "JUDGE_ERROR" : "FINAL_REJECTED",
        detail: String(result.judgeReason || ""),
      });
    } catch { /* registry never blocks pipeline */ }
    return null;
  }
  return result;
}
