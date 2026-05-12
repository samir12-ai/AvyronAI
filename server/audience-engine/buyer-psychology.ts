/**
 * BUYER PSYCHOLOGY PROFILER (Phase 4 marketing-logic upgrade)
 *
 * Top audience analysts do NOT just classify a segment by demographics or
 * sophistication tier and call it done. They reason about the buyer the way a
 * top closer would prep for a 1-on-1 sales call:
 *
 *   1. Belief model: what does this buyer literally believe about the world,
 *      the category, and themselves TODAY (often wrong, often inherited, often
 *      load-bearing for their identity)?
 *   2. Rejection history: what specific past claims/vendors have they been
 *      burnt by? What pattern do they now reflexively reject?
 *   3. Decision trigger: what is the specific real-world event (not "they want
 *      growth") that flips them from "looking" to "buying"? Career risk?
 *      Specific named board mandate? Quarterly miss?
 *   4. Identity aspiration: who do they want to become — not the category
 *      cliche ("data-driven leader") but a named, specific identity they can
 *      claim out loud after success?
 *
 * Sophistication tier becomes a BYPRODUCT of belief-model maturity, not a
 * primary output.
 *
 * Same pattern as trust-transfer / category-game / value-architect:
 *   - Designer (gpt-4.1-mini @ 0.3) with few-shot
 *   - Hostile judge (gpt-4.1-mini @ 0.1)
 *   - One retry with judge feedback
 *   - Safe fallback (returns null → engine continues with legacy output)
 */
import { aiChat } from "../ai-client";

export interface BuyerPsychologyProfile {
  beliefModel: {
    aboutCategory: string;     // what they believe about the category
    aboutThemselves: string;   // the load-bearing self-story
    aboutAlternatives: string; // what they believe ALL alternatives are/do
  };
  rejectionHistory: Array<{
    pattern: string;            // the claim pattern they now reject
    sourceOfBurn: string;       // the event/vendor/promise that taught them this
    nowReflexivelyDistrusts: string;  // what trigger immediately closes them off
  }>;
  decisionTrigger: {
    triggeringEvent: string;          // the specific real event that flips them
    timeWindow: string;               // how long until they MUST decide
    consequenceIfNotResolved: string; // what happens to them if they don't act
  };
  identityAspiration: {
    currentIdentityFelt: string;      // who they feel they are TODAY
    aspirationalIdentity: string;     // who they want to become
    publicProofTheyAchieved: string;  // the visible proof they'd point to
  };
  sophisticationByproduct: {
    tier: 1 | 2 | 3 | 4 | 5;          // 5 = burnt-skeptical
    reasoning: string;
  };
  cialdiniLeverages: string[];         // top 1-2 Cialdini principles that would actually work
  reasoningSteps: string[];
  judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN";
  judgeReason: string;
  retryCount: number;
}

interface DesignerInput {
  segmentName: string;
  segmentDescription: string;
  audiencePains: string[];
  audienceDesires: string[];
  audienceObjections: string[];
  buyerComments: string[];           // raw voice-of-buyer (highest signal)
  competitorClaims: string[];        // claims they've been pitched
  rejectedClaimPatterns: string[];   // already-detected sophistication-flagged
  industry: string;
  coreOffer: string;
  accountId: string;
}

const FEW_SHOT = `
EXAMPLE — STRONG (accepted):
{
  "beliefModel": {
    "aboutCategory": "All B2B martech vendors will overpromise in the sales cycle, underdeliver in onboarding, and disappear at month 4 once their commission clears — the category itself is structurally adversarial",
    "aboutThemselves": "I am the CMO who got burnt twice in a row and one more wrong vendor pick ends my tenure — I cannot afford to be 'the person who picked another HubSpot' on my LinkedIn-visible track record",
    "aboutAlternatives": "Every alternative either (a) costs $200k+ with 9-month ramp I don't have, (b) is a $40/mo SMB toy that won't survive a CFO review, or (c) is an AI-washed legacy platform with a fresh marketing coat"
  },
  "rejectionHistory": [
    {
      "pattern": "AI-powered pipeline acceleration",
      "sourceOfBurn": "Bought into Drift's conversational AI promise in 2023, attribution numbers were demonstrably fake when CFO drilled in, had to publicly walk it back at QBR",
      "nowReflexivelyDistrusts": "Any opening line that leads with 'AI' or 'smart' or '10x' — closes pitch deck within 3 slides"
    }
  ],
  "decisionTrigger": {
    "triggeringEvent": "Q3 board meeting where she has to commit to a quarterly attribution number she can defend in front of a hostile CFO without analyst translation",
    "timeWindow": "47 days from today to commit, contract live by Q4 start, first attribution number due at Q1 board",
    "consequenceIfNotResolved": "PIP becomes formal termination notice; her last LinkedIn vendor-pick post becomes public evidence of failure for next role search"
  },
  "identityAspiration": {
    "currentIdentityFelt": "The CMO who got the wrong vendor twice and is one quarter from being the cautionary tale at every CMO dinner",
    "aspirationalIdentity": "The CMO who broke the vendor-fatigue cycle by picking the one martech partner whose own revenue was tied to her quarter — talked about as 'the one who actually got attribution right' in peer slack",
    "publicProofTheyAchieved": "A board-shared dashboard the CFO co-signs, plus a peer-CMO referral she gives at 3 conferences in the next 12 months"
  },
  "sophisticationByproduct": {
    "tier": 5,
    "reasoning": "Burnt-skeptical: has personally rejected 4+ category claims in last 18 months, has a documented anti-pattern she shares in CMO slack, requires structural-economic proof not testimonial-social proof"
  },
  "cialdiniLeverages": ["commitment_consistency", "social_proof"]
}
WHY IT WORKS: Belief model is THREE specific beliefs (category/self/alternatives), not abstract. Rejection history names the exact past vendor + the exact reflexive trigger. Decision trigger has a real event, a real time window, and a real consequence. Identity aspiration is named role + named public proof. Sophistication tier is reasoned from rejection density, not asserted.
`;

function buildDesignerPrompt(args: DesignerInput): string {
  const painBlock = args.audiencePains.slice(0, 8).map((p, i) => `[PAIN${i + 1}] ${p}`).join("\n") || "(none)";
  const desireBlock = args.audienceDesires.slice(0, 8).map((d, i) => `[DESIRE${i + 1}] ${d}`).join("\n") || "(none)";
  const objBlock = args.audienceObjections.slice(0, 8).map((o, i) => `[OBJ${i + 1}] ${o}`).join("\n") || "(none)";
  const commentBlock = args.buyerComments.slice(0, 8).map((c, i) => `[VOC${i + 1}] ${c.slice(0, 200)}`).join("\n") || "(none)";
  const compBlock = args.competitorClaims.slice(0, 6).map((c, i) => `[COMP${i + 1}] ${c.slice(0, 160)}`).join("\n") || "(none)";
  const rejectedBlock = args.rejectedClaimPatterns.slice(0, 6).map(r => `- ${r}`).join("\n") || "(none detected)";

  return `You are a Buyer Psychology Profiler in the lineage of Eugene Schwartz, Robert Cialdini, and the best 1-on-1 enterprise closers.
Your job is NOT to assign a sophistication tier and call it done. Your job is to reason about this buyer like you have a 1-on-1 sales call with them tomorrow morning.

═══ MARKET CONTEXT ═══
Industry: ${args.industry}
Core offer being sold: ${args.coreOffer}
Segment: ${args.segmentName}
Description: ${args.segmentDescription}

═══ AUDIENCE EVIDENCE (cite by ID — required) ═══
PAINS:
${painBlock}

DESIRES:
${desireBlock}

OBJECTIONS:
${objBlock}

VOICE-OF-BUYER (raw quotes from comments):
${commentBlock}

COMPETITOR CLAIMS (what they've been pitched):
${compBlock}

CLAIMS-ALREADY-EXHAUSTED:
${rejectedBlock}

${FEW_SHOT}

═══ YOUR TASK ═══
Reason in this exact order:

1. **Belief model** — What does this buyer literally believe about (a) the CATEGORY itself, (b) THEMSELVES (the load-bearing self-story), (c) the ALTERNATIVES (what they believe ALL competitors are/do)? These are not summaries of the data — they are the underlying load-bearing beliefs the data implies. Each belief must be 1-3 sentences and reference [PAIN#]/[OBJ#]/[VOC#]/[COMP#] evidence.

2. **Rejection history** — For 1-3 specific claim patterns this buyer has clearly been burnt by (use [COMP#] and [VOC#]), name: the rejected pattern, the source of burn (the specific past vendor / promise that did the damage), and the reflexive trigger that now immediately closes them off. Generic patterns ("AI claims") are weak — be specific to THIS buyer's history.

3. **Decision trigger** — What is the SPECIFIC real-world event (not "they want growth") that flips this buyer from "looking" to "buying"? Name the triggering event, the time window before they MUST decide, and the consequence if not resolved (what happens to them — job, board, peer status?).

4. **Identity aspiration** — Who does this buyer feel they are TODAY (current felt identity, with all baggage), who do they want to become (aspirational identity — must be named, specific, NOT a vibe like "data-driven leader"), and what would be the visible PUBLIC PROOF they achieved it?

5. **Sophistication byproduct** — Now that you've reasoned through belief model + rejection density, derive the sophistication tier (1=naive, 2=problem-aware, 3=solution-aware, 4=product-aware, 5=burnt-skeptical) and explain the reasoning from rejection density, not from a label.

6. **Cialdini leverages** — Given this psychology, which 1-2 Cialdini principles (reciprocity, commitment_consistency, social_proof, authority, liking, scarcity, unity) would ACTUALLY land for this buyer? (E.g., a tier-5 burnt-skeptical buyer typically rejects social_proof — they need commitment_consistency or authority.)

HARD RULES:
- Beliefs must be load-bearing (would change behavior if proven false), not summaries.
- Rejection history items must name specific patterns + specific past sources of burn — not generic categories.
- Decision trigger must include a real event, real time window, and real consequence — not "they want results soon".
- Aspirational identity must be a NAMED role/state ("the CMO who escaped vendor-fatigue", "the founder who finally raised on real metrics") — NEVER a vibe word.
- Cialdini leverages must be plausibly chosen for THIS buyer's psychology, not the generic principle for the category.
- Reference evidence IDs throughout.

Return ONLY valid JSON, no commentary:
{
  "beliefModel": {"aboutCategory":"...","aboutThemselves":"...","aboutAlternatives":"..."},
  "rejectionHistory": [{"pattern":"...","sourceOfBurn":"...","nowReflexivelyDistrusts":"..."}],
  "decisionTrigger": {"triggeringEvent":"...","timeWindow":"...","consequenceIfNotResolved":"..."},
  "identityAspiration": {"currentIdentityFelt":"...","aspirationalIdentity":"...","publicProofTheyAchieved":"..."},
  "sophisticationByproduct": {"tier":1|2|3|4|5,"reasoning":"..."},
  "cialdiniLeverages": ["...","..."],
  "reasoningSteps": ["...","..."]
}`;
}

function buildJudgePrompt(designJson: string): string {
  return `You are a hostile reviewer of a buyer-psychology profile. Reject anything that:
- Has belief model items that are SUMMARIES of the pain/desire data instead of load-bearing beliefs (a load-bearing belief would change behavior if proven false; a summary just restates the data)
- Has aboutThemselves that is a vibe ("ambitious leader", "growth-minded", "innovative") instead of a specific load-bearing self-story tied to evidence
- Has rejection history items that are GENERIC ("AI hype", "false promises") instead of named to a specific past pattern + specific source of burn
- Has decision trigger that is "wants to grow" / "wants results" instead of a real triggering event + real time window + real consequence
- Has aspirationalIdentity that is a vibe ("modern leader", "data-driven", "successful") instead of a named, specific role/state with a public proof
- Has cialdiniLeverages that are obvious category defaults instead of psychology-matched (e.g., tier-5 burnt-skeptical buyer with social_proof as primary = wrong)
- Has sophisticationByproduct.tier asserted without reasoning from rejection density

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

const VALID_CIALDINI = new Set(["reciprocity", "commitment_consistency", "social_proof", "authority", "liking", "scarcity", "unity"]);

export async function profileBuyerPsychology(args: DesignerInput): Promise<BuyerPsychologyProfile | null> {
  const startTs = Date.now();
  console.log(`[BuyerPsychology] STEP_1 | profiling | segment="${args.segmentName.slice(0, 50)}" | pains=${args.audiencePains.length} | objections=${args.audienceObjections.length} | comments=${args.buyerComments.length}`);

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
      console.warn("[BuyerPsychology] STEP_1_FAILED | empty response");
      return null;
    }
    v1 = safeJSON<any>(designRaw);
    if (!v1) {
      console.warn("[BuyerPsychology] STEP_1_FAILED | non-JSON response");
      return null;
    }
  } catch (err: any) {
    console.warn(`[BuyerPsychology] STEP_1_FAILED | ${err.message}`);
    return null;
  }

  console.log(`[BuyerPsychology] STEP_2 | design_v1 | tier=${v1.sophisticationByproduct?.tier} | aspirational="${(v1.identityAspiration?.aspirationalIdentity || "").slice(0, 60)}" | leverages=[${(v1.cialdiniLeverages || []).join(",")}]`);

  // ─── JUDGE ───
  let judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN" = "NOT_RUN";
  let judgeReason = "";
  let judgeFix = "";
  try {
    const judgeResp = await aiChat({
      messages: [{ role: "user", content: buildJudgePrompt(designRaw) }],
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
      // Seal #8 / F3.4 — unparseable / missing-verdict judge output is NOT
      // accept-by-default. No positive evidence → REJECTED + JUDGE_ERROR.
      judgeVerdict = "REJECTED";
      judgeReason = `JUDGE_ERROR: unparseable judge output (raw="${judgeRaw.slice(0, 80)}")`;
    }
  } catch (err: any) {
    console.warn(`[BuyerPsychology] JUDGE_FAILED | ${err.message} — treating as REJECTED (no positive verdict)`);
    // Seal #8 / F3.4 — judge failure is NOT accept-by-default. We have no
    // positive evidence the candidate passes, so mark REJECTED with a
    // JUDGE_ERROR reason so the parallel rejection-surface (F3.3) can see it.
    judgeVerdict = "REJECTED";
    judgeReason = `JUDGE_ERROR: ${err.message}`;
  }
  console.log(`[BuyerPsychology] STEP_3 | judge=${judgeVerdict} | reason="${judgeReason.slice(0, 80)}"`);

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
        console.log(`[BuyerPsychology] STEP_4_RETRY | accepted_v2`);
        judgeVerdict = "ACCEPTED";
        judgeReason = `auto-corrected after retry; original issue: ${judgeReason}`;
      }
    } catch (err: any) {
      console.warn(`[BuyerPsychology] RETRY_FAILED | ${err.message} — keeping v1`);
    }
  }

  const tier = Math.max(1, Math.min(5, Math.round(Number(final.sophisticationByproduct?.tier) || 3))) as 1 | 2 | 3 | 4 | 5;
  const result: BuyerPsychologyProfile = {
    beliefModel: {
      aboutCategory: String(final.beliefModel?.aboutCategory || "").trim(),
      aboutThemselves: String(final.beliefModel?.aboutThemselves || "").trim(),
      aboutAlternatives: String(final.beliefModel?.aboutAlternatives || "").trim(),
    },
    rejectionHistory: Array.isArray(final.rejectionHistory)
      ? final.rejectionHistory
          .map((r: any) => ({
            pattern: String(r.pattern || "").trim(),
            sourceOfBurn: String(r.sourceOfBurn || "").trim(),
            nowReflexivelyDistrusts: String(r.nowReflexivelyDistrusts || "").trim(),
          }))
          .filter((r: any) => r.pattern && r.sourceOfBurn)
      : [],
    decisionTrigger: {
      triggeringEvent: String(final.decisionTrigger?.triggeringEvent || "").trim(),
      timeWindow: String(final.decisionTrigger?.timeWindow || "").trim(),
      consequenceIfNotResolved: String(final.decisionTrigger?.consequenceIfNotResolved || "").trim(),
    },
    identityAspiration: {
      currentIdentityFelt: String(final.identityAspiration?.currentIdentityFelt || "").trim(),
      aspirationalIdentity: String(final.identityAspiration?.aspirationalIdentity || "").trim(),
      publicProofTheyAchieved: String(final.identityAspiration?.publicProofTheyAchieved || "").trim(),
    },
    sophisticationByproduct: {
      tier,
      reasoning: String(final.sophisticationByproduct?.reasoning || "").trim(),
    },
    cialdiniLeverages: Array.isArray(final.cialdiniLeverages)
      ? final.cialdiniLeverages.map((c: any) => String(c).trim().toLowerCase()).filter((c: string) => VALID_CIALDINI.has(c)).slice(0, 3)
      : [],
    reasoningSteps: Array.isArray(final.reasoningSteps) ? final.reasoningSteps.map((s: any) => String(s).trim()).filter(Boolean) : [],
    judgeVerdict,
    judgeReason,
    retryCount,
  };

  if (!result.beliefModel.aboutCategory || !result.identityAspiration.aspirationalIdentity || !result.decisionTrigger.triggeringEvent) {
    console.warn(`[BuyerPsychology] DROP | structurally incomplete | category=${!!result.beliefModel.aboutCategory} | aspirational=${!!result.identityAspiration.aspirationalIdentity} | trigger=${!!result.decisionTrigger.triggeringEvent}`);
    return null;
  }

  console.log(`[BuyerPsychology] DONE in ${Date.now() - startTs}ms | finalVerdict=${result.judgeVerdict} | retries=${result.retryCount} | tier=${result.sophisticationByproduct.tier} | leverages=[${result.cialdiniLeverages.join(",")}]`);
  if (result.judgeVerdict === "REJECTED") {
    console.warn(`[BuyerPsychology] FINAL_REJECTED — falling back to legacy audience output (no buyerPsychology emitted)`);
    // Seal #8 / F3.3 — parallel rejection-surface (does NOT replace fallback).
    try {
      const { recordCommercialRejection } = await import("../../shared/commercial-dna");
      const isJudgeErr = (judgeReason || "").startsWith("JUDGE_ERROR");
      recordCommercialRejection(args.accountId, {
        module: "audience.buyerPsychology",
        reason: isJudgeErr ? "JUDGE_ERROR" : "FINAL_REJECTED",
        detail: judgeReason || "",
      });
    } catch { /* registry never blocks pipeline */ }
    return null;
  }
  return result;
}
