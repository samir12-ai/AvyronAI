/**
 * NARRATIVE REFRAME ENGINEER (Phase 5 marketing-logic upgrade)
 *
 * Top awareness/copy strategists do NOT just declare an "awareness stage" or
 * write an "attention-grabbing hook". They re-engineer the buyer's mental
 * model:
 *
 *   1. CURRENT MODEL: the explanatory frame the buyer uses today to understand
 *      their problem (often inherited from a vendor narrative, often the very
 *      reason they're stuck).
 *   2. FALSE BRIDGE: the "obvious next step" the current model leads to —
 *      which is exactly the trap that has failed them before.
 *   3. NEW MODEL: a different explanatory frame that re-classifies the
 *      problem so a different bridge becomes obvious.
 *   4. BRIDGE MECHANISM: the specific reasoning move that takes them from
 *      current → new model (analogy, named first-principle, decisive piece of
 *      evidence, status reframe). Not a slogan.
 *   5. DISCOMFORT COST: what the buyer must privately admit / give up to
 *      adopt the new model — top reframes have a real psychological cost.
 *
 * Consumes upstream P4 buyerPsychology (beliefModel, rejectionHistory,
 * decisionTrigger) so the reframe attacks the buyer's actual current model
 * — not a generic category myth.
 *
 * Pattern (matches trust-transfer / category-game / value-architect /
 * buyer-psychology):
 *   - Designer (gpt-4.1-mini @ 0.3) with few-shot
 *   - Hostile judge (gpt-4.1-mini @ 0.1)
 *   - One retry with judge feedback
 *   - Safe fallback (returns null → engine continues with legacy + myth-breaker)
 */
import { aiChat } from "../ai-client";

export interface NarrativeReframe {
  currentModel: {
    statement: string;            // the frame the buyer uses today
    sourceOfBelief: string;       // where this frame came from (vendor, peer, training)
    whyItStuckSoFar: string;      // why they cling to it despite poor outcomes
  };
  falseBridge: {
    obviousNextStep: string;      // what the current model says they should do next
    whyItFails: string;           // the structural reason this trap keeps recurring
  };
  newModel: {
    reclassification: string;     // the new way to classify the problem
    namedPrinciple: string;       // the concrete principle / analogy / fact this rests on
    whatBecomesObvious: string;   // the new "obvious next step" once the model flips
  };
  bridgeMechanism: {
    movement: "analogy" | "first_principle" | "decisive_evidence" | "status_reframe" | "category_re_assignment";
    specificMove: string;         // the literal reasoning step — not a slogan
    whyBuyerCanAcceptIt: string;  // tied to their existing belief / rejection history
  };
  discomfortCost: {
    privateAdmission: string;     // what they must admit to themselves
    statusGivenUp: string;        // what identity claim they must surrender
    whyItIsWorthIt: string;       // the upgrade they get for paying that cost
  };
  reasoningSteps: string[];
  judgeVerdict: "ACCEPTED" | "REJECTED" | "JUDGE_ERROR" | "NOT_RUN";
  judgeReason: string;
  retryCount: number;
}

interface DesignerInput {
  // Awareness-engine context
  awarenessStage: string;
  primaryEntryRoute: string;
  triggerClass: string;
  positioningStatement?: string | null;
  coreOffer?: string | null;
  audiencePains: string[];
  audienceObjections: string[];
  // Upstream commercial signals (from SSC)
  buyerBeliefModel?: { aboutCategory?: string; aboutThemselves?: string; aboutAlternatives?: string } | null;
  buyerRejectionHistory?: string[];      // top rejection patterns
  buyerDecisionTrigger?: string | null;  // the trigger event
  buyerIdentityAspiration?: string | null;
  buyerSophisticationTier?: number | null;
  trustMechanism?: string | null;        // from Persuasion (cross-run)
  gameDimension?: string | null;         // from Positioning
  accountId: string;
  // Anchor doctrine (criteria A + F): pre-rendered doctrine/DNA anchor block
  // computed ONCE by the parent awareness engine. Injected into BOTH the
  // designer prompt and the judge prompt (anchor in first prompt AND judge).
  doctrineBlock?: string | null;
  anchorSource?: "doctrine" | "dna" | "none";
}

const FEW_SHOT = `
EXAMPLE — STRONG (accepted):
{
  "currentModel": {
    "statement": "Pipeline acceleration is a tooling problem — buy better attribution software and the numbers will improve.",
    "sourceOfBelief": "Three years of vendor pitches from Drift, 6sense, and Marketo all framed pipeline as a software-purchase decision.",
    "whyItStuckSoFar": "Each tool gave a 30-day vanity dashboard bump that justified the purchase to the board, even though true 6-month pipeline never moved."
  },
  "falseBridge": {
    "obviousNextStep": "Buy yet another attribution platform — this time with AI — and re-attribute the existing pipeline.",
    "whyItFails": "The data being attributed is itself fabricated by SDR vanity behavior; better math on bad data still produces bad decisions, and the CMO ends up defending another fake number to the CFO."
  },
  "newModel": {
    "reclassification": "Pipeline is not a measurement problem — it is an incentive-alignment problem between marketing's attribution and the vendor's contract economics.",
    "namedPrinciple": "Goodhart's Law applied to vendor incentives: any pipeline metric a vendor's commission depends on stops being a real measure of buyer outcome.",
    "whatBecomesObvious": "Stop hiring vendors paid on logo-signing. Hire the one whose own revenue clock only starts when YOUR attributed revenue does."
  },
  "bridgeMechanism": {
    "movement": "first_principle",
    "specificMove": "Show the buyer their last 3 vendor contracts side-by-side and ask: 'In which of these does the vendor lose money if you don't hit your number?' The answer is always 'none' — and that becomes the entire reframe.",
    "whyBuyerCanAcceptIt": "Buyer already privately distrusts vendor incentives (rejection history shows Drift attribution disaster + Marketo CSM ghosting at month 4); this names the pattern they've felt but couldn't articulate."
  },
  "discomfortCost": {
    "privateAdmission": "The CMO must admit publicly that their last two vendor picks were structurally doomed from contract day-one — not bad execution.",
    "statusGivenUp": "Surrender the 'savvy buyer who picks the leading platforms' identity in front of peers and accept the 'first-mover on outcome-aligned contracting' identity instead.",
    "whyItIsWorthIt": "First-mover identity is defensible at the next CMO career step; 'savvy platform picker' identity got them put on a PIP."
  }
}

EXAMPLE — WEAK (rejected — the reframe is a slogan, not a model change):
{
  "currentModel": { "statement": "Buyers are skeptical", ... },
  "falseBridge": { "obviousNextStep": "Try harder to convince them", ... },
  "newModel": { "reclassification": "Authentic marketing wins", "namedPrinciple": "Be authentic", ... },
  "bridgeMechanism": { "movement": "first_principle", "specificMove": "Tell the truth in your ads.", ... }
}
WHY REJECTED: "Be authentic" is not a model change, it's a vibe. No named principle, no decisive evidence the buyer can point to, no specific reasoning move. The buyer's current model would not flip after reading this.
`.trim();

function safeJSON<T>(raw: string): T | null {
  if (!raw) return null;
  let cleaned = raw.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
  }
  return null;
}

function anchorSourceOf(input: DesignerInput): "doctrine" | "dna" | "none" {
  // Explicit if/else source classification — no semantic-fallback chains (D1).
  if (input.anchorSource === "doctrine") return "doctrine";
  if (input.anchorSource === "dna") return "dna";
  return "none";
}

async function callDesigner(input: DesignerInput, judgeFeedback?: string, attempt: number = 1): Promise<any | null> {
  const upstreamBlock = [
    input.buyerBeliefModel ? `Buyer's CURRENT belief about category: ${input.buyerBeliefModel.aboutCategory || "(unknown)"}` : null,
    input.buyerBeliefModel ? `Buyer's CURRENT belief about themselves: ${input.buyerBeliefModel.aboutThemselves || "(unknown)"}` : null,
    input.buyerBeliefModel ? `Buyer's CURRENT belief about alternatives: ${input.buyerBeliefModel.aboutAlternatives || "(unknown)"}` : null,
    input.buyerRejectionHistory?.length ? `Top rejection patterns (already burnt by): ${input.buyerRejectionHistory.slice(0, 3).join(" | ")}` : null,
    input.buyerDecisionTrigger ? `Decision trigger event: ${input.buyerDecisionTrigger}` : null,
    input.buyerIdentityAspiration ? `Aspirational identity: ${input.buyerIdentityAspiration}` : null,
    input.buyerSophisticationTier ? `Sophistication tier: ${input.buyerSophisticationTier} (1=naive, 5=burnt-skeptical)` : null,
    input.trustMechanism ? `Persuasion trust mechanism in play: ${input.trustMechanism}` : null,
    input.gameDimension ? `Positioning game we're playing: ${input.gameDimension}` : null,
  ].filter(Boolean).join("\n");

  const anchorPresent = input.doctrineBlock && input.doctrineBlock.length > 0;
  console.log(`[NarrativeReframe] ANCHOR_EVIDENCE | engine=awareness_narrative_reframe | site=first_prompt | attempt=${attempt} | present=${anchorPresent ? "yes" : "no"} | source=${anchorSourceOf(input)}`);

  const sys = `${anchorPresent ? `${input.doctrineBlock}\n\n` : ""}You are a senior brand & narrative strategist who has rebuilt the messaging of three Fortune-100 categories from scratch.

You do NOT write hooks, slogans, or "attention-grabbing copy". You re-engineer the buyer's MENTAL MODEL.

For this segment you must produce a NarrativeReframe in EXACT JSON shape:
{
  "currentModel": { "statement","sourceOfBelief","whyItStuckSoFar" },
  "falseBridge":  { "obviousNextStep","whyItFails" },
  "newModel":     { "reclassification","namedPrinciple","whatBecomesObvious" },
  "bridgeMechanism": { "movement": one of [analogy|first_principle|decisive_evidence|status_reframe|category_re_assignment], "specificMove","whyBuyerCanAcceptIt" },
  "discomfortCost":  { "privateAdmission","statusGivenUp","whyItIsWorthIt" },
  "reasoningSteps": [string, ...]
}

Hard rules:
- "namedPrinciple" must be a concrete named principle, analogy, law, or piece of evidence — NOT a vibe ("be authentic", "stay focused", "data-driven").
- "specificMove" must be a literal reasoning step the buyer can do in their head in <30 seconds.
- "whyBuyerCanAcceptIt" must reference the buyer's ACTUAL current beliefs or rejection history above — not a generic "buyers want X".
- "discomfortCost" must hurt — if the cost is "they need to think a little differently" you have failed. The cost should be a status, identity, or sunk-cost surrender.
- Do NOT mention forbidden domains (medical, legal, political, financial regulated advice).
- CAPABILITY & PRODUCT TRUTH BOUNDARY:
  - "newModel", "whatBecomesObvious", and "bridgeMechanism" MUST strictly align with the Product Truth facts and capabilities of THIS product.
  - You MUST NOT invent or claim product capabilities (such as automated billing/refund dashboards, payment dispute reconciliation, or customer support management) unless explicitly stated in the Product Anchor above.
  - If buyer pains mention competitor billing/refund complaints, do NOT frame our product as a refund/billing automation tool. Frame the reframe around our ACTUAL capabilities (e.g. modular autonomous digital agents, workflow automation, and verified continuous intelligence).

${FEW_SHOT}

${judgeFeedback ? `\nPRIOR ATTEMPT WAS REJECTED. Fix per judge feedback:\n${judgeFeedback}\n` : ""}`;

  const usr = `AWARENESS CONTEXT:
- Awareness stage: ${input.awarenessStage}
- Primary entry route: ${input.primaryEntryRoute}
- Trigger class: ${input.triggerClass}
- Positioning: ${input.positioningStatement || "(n/a)"}
- Core offer: ${input.coreOffer || "(n/a)"}

BUYER PAINS (top): ${input.audiencePains.slice(0, 5).map(p => `\n  - ${p}`).join("")}
BUYER OBJECTIONS (top): ${input.audienceObjections.slice(0, 4).map(o => `\n  - ${o}`).join("")}

UPSTREAM COMMERCIAL SIGNALS (use these to make the reframe specific to THIS buyer):
${upstreamBlock || "(no upstream signals available — reason from pains/objections only)"}

Return ONLY valid JSON in the schema above. No prose, no markdown, no commentary.`;

  try {
    const resp = await aiChat({
      messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
      model: "gpt-4.1-mini",
      temperature: 0.3,
      max_tokens: 1800,
    });
    const raw = resp?.choices?.[0]?.message?.content || "";
    return safeJSON(raw);
  } catch (e: any) {
    console.warn(`[NarrativeReframe] designer call failed: ${e.message}`);
    return null;
  }
}

async function callJudge(candidate: any, input: DesignerInput, attempt: number = 1): Promise<{ status: "ACCEPTED" | "REJECTED" | "JUDGE_ERROR"; reason: string }> {
  const judgeAnchorPresent = input.doctrineBlock && input.doctrineBlock.length > 0;
  console.log(`[NarrativeReframe] ANCHOR_EVIDENCE | engine=awareness_narrative_reframe | site=judge | attempt=${attempt} | present=${judgeAnchorPresent ? "yes" : "no"} | source=${anchorSourceOf(input)}`);

  const sys = `${judgeAnchorPresent ? `${input.doctrineBlock}\n\n` : ""}You are a hostile narrative-strategy critic. You reject any reframe that is a slogan or vibe rather than a real mental-model shift.

Reject if ANY of:
1. "namedPrinciple" is a vibe ("be authentic", "be data-driven", "modern marketing", "trust matters").
2. "specificMove" is a slogan or a thing to "communicate" rather than a reasoning step the buyer does in their head.
3. "whyBuyerCanAcceptIt" doesn't reference the buyer's actual current beliefs or rejection history.
4. "discomfortCost.privateAdmission" doesn't actually hurt — if it could be said in a sales deck without embarrassment, it's not a real cost.
5. "newModel" merely re-words "currentModel" without changing the classification of the problem.
6. The reframe could apply to ANY product in ANY category — it must be specific to this buyer's situation.
7. CAPABILITY INVENTIONS: Claims capabilities (e.g. automated refund processing, billing tools, dispute management, or customer service portals) outside the Product Anchor / Product Truth.

Return JSON: {"verdict":"ACCEPTED"|"REJECTED","reason":"<one sentence>"}`;

  const usr = `BUYER CURRENT BELIEFS:
- About category: ${input.buyerBeliefModel?.aboutCategory || "(n/a)"}
- About self: ${input.buyerBeliefModel?.aboutThemselves || "(n/a)"}
- Rejection history: ${(input.buyerRejectionHistory || []).slice(0, 3).join(" | ") || "(n/a)"}

CANDIDATE REFRAME:
${JSON.stringify(candidate, null, 2)}

Judge this candidate. Return ONLY the JSON verdict.`;

  try {
    const resp = await aiChat({
      messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
      model: "gpt-4.1-mini",
      temperature: 0.1,
      max_tokens: 400,
    });
    const raw = resp?.choices?.[0]?.message?.content || "";
    const parsed = safeJSON<{ verdict: string; reason: string }>(raw);
    if (!parsed) {
      return { status: "JUDGE_ERROR", reason: "judge response unparseable" };
    }
    const verdict = parsed.verdict;
    const v = (verdict ? verdict.toUpperCase() : "").includes("REJECT") ? "REJECTED" : "ACCEPTED";
    return { status: v as "ACCEPTED" | "REJECTED", reason: parsed.reason || "" };
  } catch (e: any) {
    console.warn(`[NarrativeReframe] judge call failed: ${e.message} — treating as JUDGE_ERROR`);
    return { status: "JUDGE_ERROR", reason: e.message };
  }
}

function validateShape(c: any): boolean {
  if (!c || typeof c !== "object") return false;
  if (!c.currentModel?.statement || !c.currentModel?.sourceOfBelief || !c.currentModel?.whyItStuckSoFar) return false;
  if (!c.falseBridge?.obviousNextStep || !c.falseBridge?.whyItFails) return false;
  if (!c.newModel?.reclassification || !c.newModel?.namedPrinciple || !c.newModel?.whatBecomesObvious) return false;
  if (!c.bridgeMechanism?.movement || !c.bridgeMechanism?.specificMove || !c.bridgeMechanism?.whyBuyerCanAcceptIt) return false;
  if (!c.discomfortCost?.privateAdmission || !c.discomfortCost?.statusGivenUp || !c.discomfortCost?.whyItIsWorthIt) return false;
  const validMoves = new Set(["analogy", "first_principle", "decisive_evidence", "status_reframe", "category_re_assignment"]);
  if (!validMoves.has(c.bridgeMechanism.movement)) c.bridgeMechanism.movement = "first_principle";
  return true;
}

export async function engineerNarrativeReframe(input: DesignerInput): Promise<NarrativeReframe | null> {
  const t0 = Date.now();
  console.log(`[NarrativeReframe] STEP_1 | engineering | stage=${input.awarenessStage} | entry=${input.primaryEntryRoute} | hasBeliefModel=${!!input.buyerBeliefModel} | rejections=${input.buyerRejectionHistory?.length || 0}`);

  let candidate = await callDesigner(input, undefined, 1);
  if (!validateShape(candidate)) {
    console.warn(`[NarrativeReframe] DESIGN_V1_INVALID — retrying with shape feedback`);
    candidate = await callDesigner(input, "Prior attempt did not return all required fields. Return EXACTLY the schema with every nested field populated.", 2);
    if (!validateShape(candidate)) {
      console.warn(`[NarrativeReframe] DESIGN_V2_INVALID — falling back (engine continues without reframe)`);
      return null;
    }
  }
  console.log(`[NarrativeReframe] STEP_2 | design_v1 | movement=${candidate.bridgeMechanism.movement} | newModel="${(candidate.newModel.reclassification || "").slice(0, 60)}"`);

  let { status, reason } = await callJudge(candidate, input, 1);
  let retryCount = 0;
  if (status === "REJECTED") {
    retryCount = 1;
    console.log(`[NarrativeReframe] STEP_3 | judge=REJECTED | reason="${reason.slice(0, 100)}" | retrying`);
    const retry = await callDesigner(input, reason, 3);
    if (validateShape(retry)) {
      candidate = retry;
      const second = await callJudge(candidate, input, 2);
      status = second.status;
      reason = second.reason;
    }
  }
  console.log(`[NarrativeReframe] STEP_3 | judge=${status} | reason="${reason.slice(0, 100)}"`);

  const profile: NarrativeReframe = {
    currentModel: candidate.currentModel,
    falseBridge: candidate.falseBridge,
    newModel: candidate.newModel,
    bridgeMechanism: candidate.bridgeMechanism,
    discomfortCost: candidate.discomfortCost,
    reasoningSteps: Array.isArray(candidate.reasoningSteps) ? candidate.reasoningSteps : [],
    judgeVerdict: status,
    judgeReason: reason,
    retryCount,
  };

  console.log(`[NarrativeReframe] DONE in ${Date.now() - t0}ms | finalStatus=${status} | retries=${retryCount} | movement=${profile.bridgeMechanism.movement}`);
  if (status === "REJECTED" || status === "JUDGE_ERROR") {
    console.warn(`[NarrativeReframe] FINAL_${status} — falling back to legacy awareness output (no narrativeReframe emitted)`);
    try {
      const { recordCommercialRejection } = await import("../../shared/commercial-dna");
      recordCommercialRejection(input.accountId, {
        module: "awareness.narrativeReframe",
        reason: status === "JUDGE_ERROR" ? "JUDGE_ERROR" : "FINAL_REJECTED",
        detail: reason || "",
      });
    } catch (regErr: any) {
      console.error(`[NarrativeReframe] REGISTRY_WRITE_FAILED | ${regErr.message}`);
    }
    return null;
  }
  return profile;
}
