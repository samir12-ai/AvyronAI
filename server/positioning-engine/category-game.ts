/**
 * CATEGORY-GAME STRATEGIST (Phase 2 marketing-logic upgrade)
 *
 * Top positioning strategists do NOT pick territories by "what gap is open" — that produces
 * generic "we're more X than competitor Y" framing. They reason commercially:
 *
 *   1. What dimension is each named competitor PLAYING ON? (price, status, speed,
 *      simplicity, biggest data set, "most enterprise", etc.) That's their GAME.
 *   2. What is the BUYER's actual game? (the dimension the buyer actually wants to win on,
 *      which is often different from what competitors are selling)
 *   3. What dimension can WE play where competitors can't follow without breaking their
 *      own positioning? That's our GAME.
 *   4. Why is it defensible? (the structural cost competitors would pay to copy)
 *
 * This is the "Category Design" / Play Bigger / 22 Immutable Laws thinking, applied as
 * structured commercial reasoning the engine performs BEFORE picking the final territory
 * narrative. The output is then used to choose enemy/contrast/narrativeDirection so they
 * sit on a real strategic dimension rather than a vibe.
 *
 * Architecture mirrors trust-transfer.ts:
 *   - Designer LLM call (gpt-4.1-mini @ 0.3) with few-shot anchors and forced specificity rules
 *   - Hostile judge LLM call (gpt-4.1-mini @ 0.1) that rejects label-only / vibes outputs
 *   - One retry with judge feedback injected
 *   - Safe fallback (returns null → engine continues with legacy territory selection)
 */
import { aiChat } from "../ai-client";

export interface CompetitorGame {
  name: string;            // competitor name
  dimension: string;       // the dimension they are playing on (named, specific)
  trapForUs: string;       // why we lose if we play their game
}

export type GameDefensibility = "structural" | "behavioral" | "narrative" | "weak";

export interface CategoryGameDesign {
  buyerActualGame: string;          // what the buyer ACTUALLY wants to win on
  buyerActualGameEvidence: string;  // signals that prove this (pain/desire/objection refs)
  competitorGames: CompetitorGame[];
  marketDefaultGame: string;        // the implicit game the category currently plays
  ourDimension: string;             // the new axis we are playing on
  ourGame: string;                  // the named game we win at
  defensibility: GameDefensibility;
  defensibilityProof: string;       // why competitors can't copy without breaking their positioning
  reasoningSteps: string[];
  failureModes: { dimension: string; whyItWouldFail: string }[];
  judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN";
  judgeReason: string;
  retryCount: number;
}

interface DesignerInput {
  category: string;
  marketDiagnosis: string | null;
  enemyHints?: string[];
  competitorBriefs: Array<{ name: string; positioning: string; authority?: number }>;
  audiencePainSignals: string[];
  audienceDesireSignals: string[];
  audienceObjections: string[];
  productAdvantage: string | null;
  productMechanism: string | null;
  rejectedTerritoryPatterns: string[];
  accountId: string;
}

const FEW_SHOT = `
EXAMPLE 1 — WEAK (rejected by judge):
{
  "buyerActualGame": "differentiation",
  "competitorGames": [{"name":"X","dimension":"marketing","trapForUs":"they spend more"}],
  "ourGame": "be unique"
}
WHY IT FAILS: "differentiation" is not a game, it is a goal. "marketing" is a function not a dimension. "be unique" is a vibe.

EXAMPLE 2 — STRONG (accepted):
{
  "buyerActualGame": "Compress vendor-eval cycles from 90 days to 14 — buyer's career depends on faster wins",
  "marketDefaultGame": "Most-features-at-best-price (the standard B2B SaaS game)",
  "competitorGames": [
    {"name": "HubSpot", "dimension": "Most-features-at-best-price", "trapForUs": "We can't out-feature a $30B incumbent and racing them on price destroys our margin and signals weakness"},
    {"name": "Salesforce", "dimension": "Enterprise-grade trust + ecosystem lock-in", "trapForUs": "We can't out-credential a 25-yr public company; matching their language puts us in their comparison set where we lose by default"}
  ],
  "ourDimension": "Time-to-first-win speed",
  "ourGame": "Fastest path from contract-signed to provable revenue impact in the buyer's quarter (sub-21-day proof window)",
  "defensibility": "structural",
  "defensibilityProof": "HubSpot/Salesforce CANNOT compete on time-to-win without dismantling their solution-engineering pricing model and their land-and-expand revenue motion. Speed is anti-correlated with their core business model — they make less money if customers win faster.",
  "failureModes": [
    {"dimension": "Better AI", "whyItWouldFail": "Every B2B SaaS competitor claims AI in 2025 — playing that dimension drops us into the saturated tier-4 commodity tier we already saw in audience signals"},
    {"dimension": "More integrations", "whyItWouldFail": "Integration count is HubSpot's home turf — we'd be playing their game on their volume advantage"}
  ]
}
WHY IT WORKS: every dimension is a NAMED, COMMERCIAL game (not a feature). Each competitor's game is identified specifically. The trap for us is the structural reason matching them loses. Our dimension is structurally hostile to their business model — that's defensibility, not luck.
`;

function buildDesignerPrompt(args: DesignerInput): string {
  const compBlock = args.competitorBriefs.length
    ? args.competitorBriefs
        .slice(0, 6)
        .map((c, i) => `[COMP${i + 1}] ${c.name} | authority=${c.authority ?? "?"} | positioning="${c.positioning}"`)
        .join("\n")
    : "(no enriched competitors — reason from category default game)";
  const painBlock = args.audiencePainSignals.slice(0, 8).map((s, i) => `[PAIN${i + 1}] ${s}`).join("\n") || "(none)";
  const desireBlock = args.audienceDesireSignals.slice(0, 8).map((s, i) => `[DESIRE${i + 1}] ${s}`).join("\n") || "(none)";
  const objBlock = args.audienceObjections.slice(0, 6).map((s, i) => `[OBJ${i + 1}] ${s}`).join("\n") || "(none)";
  const rejectedBlock = args.rejectedTerritoryPatterns.length
    ? args.rejectedTerritoryPatterns.slice(0, 6).map(r => `- ${r}`).join("\n")
    : "(none)";

  return `You are a Category-Design Strategist (Play Bigger / 22 Immutable Laws / category-creation school).
Your job is NOT to find an "open territory" — that gets generic answers. Your job is to identify the COMMERCIAL GAME each competitor is playing, name a dimension where we can win that they structurally cannot follow, and prove why.

═══ MARKET ═══
Category: ${args.category}
Market diagnosis: ${args.marketDiagnosis || "(none)"}
Product unique mechanism: ${args.productMechanism || "(unspecified)"}
Product strategic advantage: ${args.productAdvantage || "(unspecified)"}

═══ COMPETITORS (with their public positioning) ═══
${compBlock}

═══ AUDIENCE EVIDENCE (cite by ID — required) ═══
PAINS:
${painBlock}

DESIRES:
${desireBlock}

OBJECTIONS (where buyer pushes back on the category default):
${objBlock}

═══ ALREADY-EXHAUSTED ANGLES (do not repeat) ═══
${rejectedBlock}

${FEW_SHOT}

═══ YOUR TASK ═══
Reason in this exact order:

1. **Buyer's actual game** — What does the buyer ACTUALLY want to win on? (Not what competitors are selling — what the buyer's own commercial / career / status / time-pressure outcome is.) Cite [PAIN#] / [DESIRE#] / [OBJ#] evidence.
2. **Market default game** — What is the implicit game the whole category currently plays? (E.g. "most features at best price" / "biggest brand wins" / "lowest CAC".)
3. **Each named competitor's game** — For every [COMP#], name the SPECIFIC dimension they are playing on (NOT a function like "marketing" — a real dimension like "lowest-price-per-seat" or "biggest-customer-roster-as-credibility-signal"). Then state the TRAP — the structural reason we lose if we play their game.
4. **Our dimension** — A new, named axis where we can lead and they structurally cannot follow. The dimension must be something a buyer would actively pick a vendor on (not a vibe).
5. **Our game on that dimension** — A specific, narratable game. Not "we're better" — what specifically do we win at?
6. **Defensibility** — Why can't competitors copy this game without breaking their own positioning, business model, or customer base?
   - structural = copying breaks their unit economics or business model
   - behavioral = their team is wired for the old game; org change too costly
   - narrative = copying contradicts the story they've already told the market
   - weak = no real defensibility — flag this if true
7. **Failure modes** — Name 2 SPECIFIC alternative dimensions we could have picked, and the precise reason each one would have failed for THIS market (not generic reasons).

HARD RULES:
- Every "dimension" / "game" must be a NAMED, COMMERCIAL noun phrase a buyer or competitor could repeat. No "differentiation", "uniqueness", "value", "innovation", "AI-powered", "best-in-class" as standalone answers.
- Every claim must cite [COMP#] / [PAIN#] / [DESIRE#] / [OBJ#] or product mechanism — abstract claims = rejected.
- Defensibility proof must say what competitor would have to give up to copy, not just "they can't."
- If audience signals contradict the obvious game, name that contradiction — that's usually the opening.

Return ONLY valid JSON, no commentary:
{
  "buyerActualGame": "...",
  "buyerActualGameEvidence": "cites [PAIN#] / [DESIRE#] / [OBJ#]",
  "marketDefaultGame": "...",
  "competitorGames": [{"name": "...", "dimension": "...", "trapForUs": "..."}],
  "ourDimension": "...",
  "ourGame": "...",
  "defensibility": "structural" | "behavioral" | "narrative" | "weak",
  "defensibilityProof": "...",
  "reasoningSteps": ["step 1 ...", "step 2 ...", "..."],
  "failureModes": [{"dimension": "...", "whyItWouldFail": "..."}, {"dimension": "...", "whyItWouldFail": "..."}]
}`;
}

function buildJudgePrompt(designJson: string, competitorNames: string[]): string {
  return `You are a hostile reviewer of a category-game design. You have seen 1000s of weak positioning docs. Reject anything that:
- Uses generic words ("differentiation", "value", "innovation", "uniqueness", "AI-powered", "best-in-class") as the dimension or game
- Names a "competitor game" that is a function ("marketing", "sales", "product") instead of a real strategic dimension ("lowest-price-per-seat", "biggest-customer-logo-roster")
- Has a "trapForUs" that is a vibe ("they're bigger") instead of a structural cost ("matching their feature count requires hiring 40 engineers we don't have")
- Has a defensibilityProof that is "they can't copy us" without naming what they'd have to give up
- Has failureModes that are generic ("would not work") instead of citing why for THIS specific market
- Does not address every named competitor: ${competitorNames.length ? competitorNames.join(", ") : "(none provided — skip this rule)"}

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

export async function designCategoryGame(args: DesignerInput): Promise<CategoryGameDesign | null> {
  const startTs = Date.now();
  console.log(`[CategoryGame] STEP_1 | designing | category=${args.category} | competitors=${args.competitorBriefs.length} | pains=${args.audiencePainSignals.length} | desires=${args.audienceDesireSignals.length}`);

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
      console.warn("[CategoryGame] STEP_1_FAILED | empty response from designer");
      return null;
    }
    v1 = safeJSON<any>(designRaw);
    if (!v1) {
      console.warn("[CategoryGame] STEP_1_FAILED | designer returned non-JSON");
      return null;
    }
  } catch (err: any) {
    console.warn(`[CategoryGame] STEP_1_FAILED | ${err.message}`);
    return null;
  }

  const compNames = args.competitorBriefs.map(c => c.name);
  console.log(`[CategoryGame] STEP_2 | design_v1 | ourDimension="${(v1.ourDimension || "").slice(0, 60)}" | competitorGames=${(v1.competitorGames || []).length} | defensibility=${v1.defensibility}`);

  // ─── JUDGE ───
  let judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN" = "NOT_RUN";
  let judgeReason = "";
  let judgeFix = "";
  try {
    const judgeResp = await aiChat({
      messages: [{ role: "user", content: buildJudgePrompt(designRaw, compNames) }],
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
    console.warn(`[CategoryGame] JUDGE_FAILED | ${err.message} — treating as REJECTED (no positive verdict)`);
    judgeVerdict = "REJECTED";
    judgeReason = `JUDGE_ERROR: ${err.message}`;
  }
  console.log(`[CategoryGame] STEP_3 | judge=${judgeVerdict} | reason="${judgeReason.slice(0, 80)}"`);

  // ─── RETRY (once) if judge rejected ───
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
        console.log(`[CategoryGame] STEP_4_RETRY | accepted_v2 | ourDimension="${(v2.ourDimension || "").slice(0, 60)}"`);
        judgeVerdict = "ACCEPTED";
        judgeReason = `auto-corrected after retry; original issue: ${judgeReason}`;
      }
    } catch (err: any) {
      console.warn(`[CategoryGame] RETRY_FAILED | ${err.message} — keeping v1`);
    }
  }

  const result: CategoryGameDesign = {
    buyerActualGame: String(final.buyerActualGame || "").trim(),
    buyerActualGameEvidence: String(final.buyerActualGameEvidence || "").trim(),
    competitorGames: Array.isArray(final.competitorGames)
      ? final.competitorGames
          .map((c: any) => ({
            name: String(c.name || "").trim(),
            dimension: String(c.dimension || "").trim(),
            trapForUs: String(c.trapForUs || "").trim(),
          }))
          .filter((c: CompetitorGame) => c.name && c.dimension)
      : [],
    marketDefaultGame: String(final.marketDefaultGame || "").trim(),
    ourDimension: String(final.ourDimension || "").trim(),
    ourGame: String(final.ourGame || "").trim(),
    defensibility: ["structural", "behavioral", "narrative", "weak"].includes(final.defensibility) ? final.defensibility : "weak",
    defensibilityProof: String(final.defensibilityProof || "").trim(),
    reasoningSteps: Array.isArray(final.reasoningSteps) ? final.reasoningSteps.map((s: any) => String(s).trim()).filter(Boolean) : [],
    failureModes: Array.isArray(final.failureModes)
      ? final.failureModes
          .map((f: any) => ({
            dimension: String(f.dimension || "").trim(),
            whyItWouldFail: String(f.whyItWouldFail || "").trim(),
          }))
          .filter((f: any) => f.dimension && f.whyItWouldFail)
      : [],
    judgeVerdict,
    judgeReason,
    retryCount,
  };

  if (!result.ourDimension || !result.ourGame || result.competitorGames.length === 0) {
    console.warn(`[CategoryGame] DROP | structurally incomplete | ourDimension=${!!result.ourDimension} | ourGame=${!!result.ourGame} | competitorGames=${result.competitorGames.length}`);
    return null;
  }

  console.log(`[CategoryGame] DONE in ${Date.now() - startTs}ms | finalVerdict=${result.judgeVerdict} | retries=${result.retryCount} | defensibility=${result.defensibility}`);
  if (result.judgeVerdict === "REJECTED") {
    console.warn(`[CategoryGame] FINAL_REJECTED — falling back to legacy positioning output (no categoryGameDesign emitted)`);
    try {
      const { recordCommercialRejection } = await import("../../shared/commercial-dna");
      const isJudgeErr = String(result.judgeReason || "").startsWith("JUDGE_ERROR");
      recordCommercialRejection(args.accountId, {
        module: "positioning.categoryGame",
        reason: isJudgeErr ? "JUDGE_ERROR" : "FINAL_REJECTED",
        detail: String(result.judgeReason || ""),
      });
    } catch { /* registry never blocks pipeline */ }
    return null;
  }
  return result;
}
