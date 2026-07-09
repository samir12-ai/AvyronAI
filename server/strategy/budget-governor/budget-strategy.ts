import { aiChat } from "../../ai-client";

export interface BudgetStrategy {
  action: "test" | "scale" | "hold" | "halt";
  spendPace: "aggressive" | "measured" | "cautious" | "frozen";
  learningBudgetCarveOutPct: number;
  capitalEfficiencyAssessment: string;
  killTriggerThreshold: string;
  expansionPrecondition: string;
  riskAdjustedReasoning: string;
  whatWouldChangeAction: string;
  reasoningSteps: string[];
  judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN";
  judgeReason?: string;
  retryCount: number;
  modelUsed: string;
  generatedAt: string;
}

const FEW_SHOT = `
═══ CALIBRATION EXAMPLES ═══
WEAK (REJECTED): "Test budget recommended because validation is provisional. Pace measured."
STRONG (ACCEPTED):
  spendPace: "cautious"
  learningBudgetCarveOutPct: 30
  capitalEfficiencyAssessment: "Spending $1 to learn $0.30 of usable signal — acceptable for tier 4 saturated audience where every test reveals new objection layer; would be wasteful in tier 2."
  killTriggerThreshold: "If CPA exceeds $180 (60% over $112 industry CAC) for 3 consecutive days OR conversion rate stays below 1.2% after 500 clicks → halt and re-run audience engine."
  expansionPrecondition: "20+ conversions with statistical confidence ≥0.85 AND post-purchase NPS ≥40 across 7 days before unlocking scale budget tier."

WEAK (REJECTED): "Scale recommended due to high validation."
STRONG (ACCEPTED):
  spendPace: "measured"
  learningBudgetCarveOutPct: 15
  capitalEfficiencyAssessment: "Validated state earns scale, but funnel strength is 0.62 — capital efficiency capped at 2.5x test budget until we see CAC payback ≤45 days on 50+ scaled conversions."
  killTriggerThreshold: "If scaled CPA drifts >25% above test CPA across any 5-day window → revert to test pace, do not halt."
  expansionPrecondition: "Single 30-day window with ROAS ≥3.5 AND repeat-purchase rate ≥18% before unlocking 5x scale tier."
═══`;

function buildDesigner(args: {
  action: string;
  decisionConfidence: number;
  validationState: string;
  reconciledValidationConfidence: number;
  offerStrength: number;
  funnelStrength: number;
  channelRisk: number;
  testBudgetMin: number; testBudgetMax: number;
  scaleBudgetMin: number; scaleBudgetMax: number;
  estimatedCAC: number; benchmarkCAC: number;
  cacRealistic: boolean;
  killFlag: boolean;
  killReasons: string[];
  riskFactors: string[];
  performanceConversions: number; performanceSpend: number;
  marketIntensity: number;
  judgeFeedback?: string;
}): string {
  const judge = args.judgeFeedback ? `\n═══ PRIOR ATTEMPT REJECTED ═══\n${args.judgeFeedback}\nRewrite with concrete dollar/%/timeframe specifics.\n` : "";
  return `You are a Capital Allocation Principal — a senior performance-marketing CFO. Your job is NOT to repeat the budget action — it is to design the COMMERCIAL SPEND STRATEGY that converts the action into capital-efficient execution.

A weak system says: "test pace, measured."
A strong system says: "spend pace cautious because [specific evidence]; learning carveout 30% because [tier analysis]; kill if CPA >$X for Y days; unlock expansion only when [specific milestone]."
${judge}
${FEW_SHOT}

═══ INPUT DATA ═══
Decision action: ${args.action}
Decision confidence: ${args.decisionConfidence.toFixed(3)}
Validation state: ${args.validationState} (reconciled confidence ${args.reconciledValidationConfidence.toFixed(3)})
Offer strength: ${args.offerStrength.toFixed(2)} | Funnel strength: ${args.funnelStrength.toFixed(2)} | Channel risk: ${args.channelRisk.toFixed(2)}
Test budget range: $${args.testBudgetMin}–$${args.testBudgetMax}
Scale budget range: $${args.scaleBudgetMin}–$${args.scaleBudgetMax}
CAC: estimated $${args.estimatedCAC.toFixed(0)} vs benchmark $${args.benchmarkCAC.toFixed(0)} (realistic: ${args.cacRealistic})
Kill flag: ${args.killFlag} | Kill reasons: ${args.killReasons.join("; ") || "(none)"}
Live performance: ${args.performanceConversions} conversions, $${args.performanceSpend.toFixed(0)} spend
Market intensity: ${args.marketIntensity.toFixed(2)}

Top risk factors:
${args.riskFactors.slice(0, 6).map(r => `- ${r}`).join("\n") || "(none)"}

═══ HARD RULES ═══
1. spendPace MUST be one of: aggressive | measured | cautious | frozen — chosen from action+evidence not relabeled.
2. learningBudgetCarveOutPct MUST be 0–60, justified by sophistication tier and validation state.
3. capitalEfficiencyAssessment MUST cite SPECIFIC ratios/metrics ("$1 spent → $X learned", "CAC payback ≤Y days").
4. killTriggerThreshold MUST be a CONCRETE numeric trigger (CPA $, ROAS, days, click count) — NEVER "if performance bad".
5. expansionPrecondition MUST name a SPECIFIC milestone (conversions count + statistical confidence + secondary metric).
6. If action is "halt" or killFlag is true: spendPace MUST be "frozen", carveOut MUST be 0, expansionPrecondition MUST describe what would re-enable spend.
7. If action is "scale" but reconciledValidationConfidence < 0.70 — refuse to recommend "aggressive"; cap at "measured".

Return ONLY valid JSON:
{
  "spendPace": "aggressive|measured|cautious|frozen",
  "learningBudgetCarveOutPct": <number>,
  "capitalEfficiencyAssessment": "<specific assessment with metrics>",
  "killTriggerThreshold": "<concrete numeric trigger>",
  "expansionPrecondition": "<specific milestone>",
  "riskAdjustedReasoning": "<one paragraph: why this pace given risk profile>",
  "whatWouldChangeAction": "<single sentence: what evidence shift would move action up/down a tier>",
  "reasoningSteps": ["Step 1: ...", "Step 2: ..."]
}`;
}

function buildJudge(json: string): string {
  return `Hostile reviewer of a Budget Strategy.

═══ AUTOMATIC REJECTION ═══
- spendPace not justified by action+evidence pair (e.g., "aggressive" with weak validation)
- killTriggerThreshold lacks concrete number (CPA $, days, count) or says "if results bad"
- expansionPrecondition is vague ("when performance improves") — must name conversions count + confidence + secondary metric
- capitalEfficiencyAssessment uses generic words without ratios
- learningBudgetCarveOutPct contradicts spendPace (e.g., "frozen" pace with 30% carveout)
- whatWouldChangeAction is missing or generic

═══ DESIGN ═══
${json}

Return ONLY JSON: { "verdict": "ACCEPTED|REJECTED", "reason": "...", "specificFix": "..." }`;
}

function safeJson(text: string): any { if (!text) return null; const c = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim(); try { return JSON.parse(c); } catch { return null; } }

function parseStrategy(p: any, model: string, retry: number): BudgetStrategy | null {
  if (!p || !p.spendPace) return null;
  const sp = String(p.spendPace);
  if (!["aggressive", "measured", "cautious", "frozen"].includes(sp)) return null;
  const carve = Number(p.learningBudgetCarveOutPct);
  if (!isFinite(carve) || carve < 0 || carve > 100) return null;
  return {
    action: "test",
    spendPace: sp as any,
    learningBudgetCarveOutPct: Math.round(carve),
    capitalEfficiencyAssessment: String(p.capitalEfficiencyAssessment || "").trim(),
    killTriggerThreshold: String(p.killTriggerThreshold || "").trim(),
    expansionPrecondition: String(p.expansionPrecondition || "").trim(),
    riskAdjustedReasoning: String(p.riskAdjustedReasoning || "").trim(),
    whatWouldChangeAction: String(p.whatWouldChangeAction || "").trim(),
    reasoningSteps: Array.isArray(p.reasoningSteps) ? p.reasoningSteps.map(String) : [],
    judgeVerdict: "NOT_RUN",
    retryCount: retry,
    modelUsed: model,
    generatedAt: new Date().toISOString(),
  };
}

export async function designBudgetStrategy(args: {
  action: "test" | "scale" | "hold" | "halt";
  decisionConfidence: number;
  validationState: string;
  reconciledValidationConfidence: number;
  offerStrength: number;
  funnelStrength: number;
  channelRisk: number;
  testBudgetMin: number; testBudgetMax: number;
  scaleBudgetMin: number; scaleBudgetMax: number;
  estimatedCAC: number; benchmarkCAC: number;
  cacRealistic: boolean;
  killFlag: boolean;
  killReasons: string[];
  riskFactors: string[];
  performanceConversions: number; performanceSpend: number;
  marketIntensity: number;
  accountId: string;
  // Anchor doctrine (criteria A + F): pre-rendered doctrine/DNA anchor block
  // computed by the orchestrator and threaded down. Prepended to BOTH the
  // designer prompts and the judge prompts (anchor in first prompt AND judge).
  doctrineBlock?: string | null;
  anchorSource?: "doctrine" | "dna" | "none";
}): Promise<BudgetStrategy | null> {
  const start = Date.now();
  const MODEL = "gpt-4.1-mini";
  // Explicit if/else source classification — no semantic-fallback chains (D1).
  let bsAnchorSource: "doctrine" | "dna" | "none" = "none";
  if (args.anchorSource === "doctrine") bsAnchorSource = "doctrine";
  else if (args.anchorSource === "dna") bsAnchorSource = "dna";
  const bsAnchorPresent = args.doctrineBlock && args.doctrineBlock.length > 0;
  const bsAnchorPrefix = bsAnchorPresent ? `${args.doctrineBlock}\n\n` : "";

  console.log(`[BudgetStrategy] STEP_1 | designing | action=${args.action} | conf=${args.decisionConfidence.toFixed(2)} | killFlag=${args.killFlag}`);

  let prompt = `${bsAnchorPrefix}${buildDesigner(args)}`;
  console.log(`[BudgetStrategy] ANCHOR_EVIDENCE | engine=strategy_budget | site=first_prompt | attempt=1 | present=${bsAnchorPresent ? "yes" : "no"} | source=${bsAnchorSource}`);
  let raw = "";
  try {
    const r = await aiChat({ model: MODEL, messages: [{ role: "user", content: prompt }], temperature: 0.3, max_tokens: 1200, endpoint: "budget-governor-strategy", accountId: args.accountId });
    raw = r.choices[0]?.message?.content?.trim() || "";
  } catch (err: any) { console.error(`[BudgetStrategy] DESIGN_FAILED | ${err.message}`); return null; }

  let s = parseStrategy(safeJson(raw), MODEL, 0);
  if (!s) { console.error(`[BudgetStrategy] PARSE_FAILED | raw=${raw.slice(0, 200)}`); return null; }
  s.action = args.action;

  // Hard guard: if action=halt or killFlag, force frozen pace
  if (args.action === "halt" || args.killFlag) { s.spendPace = "frozen"; s.learningBudgetCarveOutPct = 0; }
  if (args.action === "scale" && args.reconciledValidationConfidence < 0.70 && s.spendPace === "aggressive") { s.spendPace = "measured"; }

  console.log(`[BudgetStrategy] STEP_2 | v1 | pace=${s.spendPace} | carveout=${s.learningBudgetCarveOutPct}%`);

  let verdict: "ACCEPTED" | "REJECTED" = "ACCEPTED"; let reason = ""; let fix = "";
  try {
    console.log(`[BudgetStrategy] ANCHOR_EVIDENCE | engine=strategy_budget | site=judge | attempt=1 | present=${bsAnchorPresent ? "yes" : "no"} | source=${bsAnchorSource}`);
    const jr = await aiChat({ model: MODEL, messages: [{ role: "user", content: `${bsAnchorPrefix}${buildJudge(JSON.stringify(s, null, 2))}` }], temperature: 0.1, max_tokens: 400, endpoint: "budget-governor-strategy-judge", accountId: args.accountId });
    const jp = safeJson(jr.choices[0]?.message?.content?.trim() || "");
    if (jp) { verdict = jp.verdict === "REJECTED" ? "REJECTED" : "ACCEPTED"; reason = String(jp.reason || ""); fix = String(jp.specificFix || ""); }
  } catch (err: any) { console.warn(`[BudgetStrategy] JUDGE_FAILED | ${err.message}`); }

  console.log(`[BudgetStrategy] STEP_3 | judge=${verdict}${reason ? ` | "${reason.slice(0,80)}"` : ""}`);

  if (verdict === "REJECTED" && (reason || fix)) {
    const fb = [reason, fix].filter(Boolean).join(" — ");
    console.log(`[BudgetStrategy] STEP_4 | retry`);
    try {
      console.log(`[BudgetStrategy] ANCHOR_EVIDENCE | engine=strategy_budget | site=first_prompt | attempt=2 | present=${bsAnchorPresent ? "yes" : "no"} | source=${bsAnchorSource}`);
      const r2 = await aiChat({ model: MODEL, messages: [{ role: "user", content: `${bsAnchorPrefix}${buildDesigner({ ...args, judgeFeedback: fb })}` }], temperature: 0.3, max_tokens: 1200, endpoint: "budget-governor-strategy-retry", accountId: args.accountId });
      const s2 = parseStrategy(safeJson(r2.choices[0]?.message?.content?.trim() || ""), MODEL, 1);
      if (s2) {
        s2.action = args.action;
        if (args.action === "halt" || args.killFlag) { s2.spendPace = "frozen"; s2.learningBudgetCarveOutPct = 0; }
        if (args.action === "scale" && args.reconciledValidationConfidence < 0.70 && s2.spendPace === "aggressive") s2.spendPace = "measured";
        s = s2;
        try {
          console.log(`[BudgetStrategy] ANCHOR_EVIDENCE | engine=strategy_budget | site=judge | attempt=2 | present=${bsAnchorPresent ? "yes" : "no"} | source=${bsAnchorSource}`);
          const jr2 = await aiChat({ model: MODEL, messages: [{ role: "user", content: `${bsAnchorPrefix}${buildJudge(JSON.stringify(s, null, 2))}` }], temperature: 0.1, max_tokens: 400, endpoint: "budget-governor-strategy-judge-retry", accountId: args.accountId });
          const jp2 = safeJson(jr2.choices[0]?.message?.content?.trim() || "");
          if (jp2) { verdict = jp2.verdict === "REJECTED" ? "REJECTED" : "ACCEPTED"; reason = String(jp2.reason || ""); }
        } catch {}
      }
    } catch (err: any) { console.warn(`[BudgetStrategy] RETRY_FAILED | ${err.message}`); }
  }

  s.judgeVerdict = verdict; s.judgeReason = reason || undefined;
  console.log(`[BudgetStrategy] DONE in ${Date.now() - start}ms | verdict=${verdict} | retries=${s.retryCount}`);
  if (verdict === "REJECTED") { console.warn(`[BudgetStrategy] FINAL_REJECTED — falling back`); return null; }
  return s;
}
