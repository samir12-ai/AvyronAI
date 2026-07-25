import { aiChat } from "../ai-client";
import type { SystemVerdict, ExecutionMode, BlockReason, Downgrade, Contradiction, RepairAction } from "./types";

export interface SystemJudgement {
  verdict: SystemVerdict;
  recommendedExecutionMode: ExecutionMode;
  commercialReadinessAssessment: string;
  biggestRisk: string;
  conditionsToUpgrade: string[];
  principalCall: string;
  whatHumanReviewerWouldAsk: string[];
  reasoningSteps: string[];
  judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN";
  judgeReason?: string;
  retryCount: number;
  modelUsed: string;
  generatedAt: string;
}

const VALID_MODES: ExecutionMode[] = [
  "FULL_EXECUTION", "RESTRICTED_EXECUTION", "TEST_ONLY", "REVIEW_REQUIRED", "HALTED",
  "LIMITED_SPEND", "PROOF_COLLECTION", "CHANNEL_VALIDATION_REQUIRED", "AWARENESS_BUILD_PHASE", "HUMAN_REVIEW_REQUIRED",
];

const FEW_SHOT = `
═══ CALIBRATION EXAMPLES ═══
WEAK (REJECTED): "Pass verdict, full execution, all systems good."
STRONG (ACCEPTED):
  recommendedExecutionMode: "LIMITED_SPEND"
  commercialReadinessAssessment: "Strategy is internally consistent (PASS) but funnel strength 0.62 + signal-backed claim ratio 0.71 means we're shipping a thesis not a proven model — capital should fund LEARNING not GROWTH this cycle."
  biggestRisk: "Scale-pace spend on a thesis that hasn't been touched by the market — high probability we burn $5-15k validating what a $1.5k learning loop would have surfaced first."
  conditionsToUpgrade: ["Reach 20+ conversions with statistical confidence ≥0.85", "Funnel strength rises to ≥0.75 after one iteration cycle", "Signal-backed claim ratio reaches ≥0.85 via additional proof collection"]
  principalCall: "Switch from full execution to limited-spend learning mode for 14 days — preserve capital, harvest proof, then re-evaluate."

WEAK (REJECTED): "Block, halt, integrity failed."
STRONG (ACCEPTED):
  recommendedExecutionMode: "PROOF_COLLECTION"
  commercialReadinessAssessment: "BLOCK is correct — strategy is making 7 of 12 claims with zero signal grounding. Cannot ship at any spend tier without burning trust signal."
  biggestRisk: "Shipping unsigned claims to a tier-4 saturated audience would PERMANENTLY damage source trust — this is not a 'try test budget' situation, it's a 'rebuild evidence base' situation."
  principalCall: "Suspend all execution, run a 7-day proof harvest sprint targeting the 7 unsigned claims, return for re-validation."

WEAK (REJECTED for label-style principalCall): "Halt all execution."
STRONG (ACCEPTED — HALTED is a correct call when the kill flag is on):
  recommendedExecutionMode: "HALTED"
  commercialReadinessAssessment: "BLOCK is correct — budget governor kill flag is true, channel confidence 0.35 is below 0.50 minimum, and confidence spread 0.70 exceeds 0.50 threshold. The system is signaling that no learning loop is currently fundable; spend would compound the gap, not close it."
  biggestRisk: "Pushing any spend now means burning $2-5k validating a thesis the data already says is unfundable — the right move is to stop the bleed and rebuild the inputs."
  conditionsToUpgrade: ["Channel selection confidence rises above 0.50 with at least one validated paid path", "Confidence spread across engines drops below 0.50", "Budget governor releases the kill flag after CAC assumption is re-grounded"]
  principalCall: "Pull all live spend, freeze the budget at zero, and re-open only after channel confidence and CAC assumptions have been rebuilt with fresh data — we don't fund what the system can't underwrite."
  whatHumanReviewerWouldAsk: ["Which channel data point would have to change to release the kill flag?", "What is the cheapest evidence path back to channel confidence above 0.50?"]
═══`;

function buildDesigner(args: {
  verdict: SystemVerdict;
  proposedExecutionMode: ExecutionMode;
  blockReasons: BlockReason[];
  downgrades: Downgrade[];
  contradictions: Contradiction[];
  repairActions: RepairAction[];
  structuralChecksFailed: string[];
  validationState: string | null;
  budgetAction: string | null;
  channelConfidence: number | null;
  signalBackedRatio: number | null;
  funnelStrength: number | null;
  commercialDnaPresent: number; // 0..5
  judgeFeedback?: string;
}): string {
  const judge = args.judgeFeedback ? `\n═══ PRIOR REJECTED ═══\n${args.judgeFeedback}\nRewrite with concrete commercial framing — name the risk and the principal's call.\n` : "";
  const blockSummary = args.blockReasons.map(b => `${b.code}: ${b.description}`).slice(0, 6).join("\n") || "(none)";
  const downgradeSummary = args.downgrades.map(d => `${d.from}→${d.to} (${d.code}): ${d.reason}`).slice(0, 6).join("\n") || "(none)";
  const contraSummary = args.contradictions.map(c => `${c.engineA}↔${c.engineB}: ${c.description}`).slice(0, 4).join("\n") || "(none)";
  const repairSummary = args.repairActions.filter(r => r.executed).map(r => `${r.code} → ${r.succeeded ? "SUCCESS" : "FAILED"}: ${r.detail}`).slice(0, 4).join("\n") || "(none)";

  return `You are the System Judgement Principal — the final voice between automated outputs and human-grade execution. Your job is NOT to relabel the verdict — it is to translate the full system state into a COMMERCIAL execution call a CMO would sign off on.

A weak system says: "verdict PASS, full execution."
A strong system says: "verdict is internally PASS but commercial readiness is LIMITED_SPEND — funnel strength 0.62 means capital should fund learning not growth; conditions to upgrade are X, Y, Z."
${judge}
${FEW_SHOT}

═══ EXECUTION MODE OPTIONS ═══
Legacy: FULL_EXECUTION, RESTRICTED_EXECUTION, TEST_ONLY, REVIEW_REQUIRED, HALTED
Phase 2 commercial: LIMITED_SPEND (small fixed-spend learning loop), PROOF_COLLECTION (suspend exec, harvest proof), CHANNEL_VALIDATION_REQUIRED (pilot 1 channel before scale), AWARENESS_BUILD_PHASE (market not ready for conversion-grade exec), HUMAN_REVIEW_REQUIRED (exceeds automation envelope)

═══ INPUT STATE ═══
Verdict (computed): ${args.verdict}
Proposed execution mode (computed): ${args.proposedExecutionMode}
Validation state: ${args.validationState ?? "?"} | Budget action: ${args.budgetAction ?? "?"} | Channel confidence: ${args.channelConfidence ?? "?"}
Signal-backed claim ratio: ${args.signalBackedRatio ?? "?"} | Funnel strength: ${args.funnelStrength ?? "?"}
Commercial DNA contributing engines: ${args.commercialDnaPresent}/5

Block reasons:
${blockSummary}

Downgrades:
${downgradeSummary}

Contradictions:
${contraSummary}

Repair actions:
${repairSummary}

Failed structural checks:
${args.structuralChecksFailed.slice(0, 8).map(c => `- ${c}`).join("\n") || "(none)"}

═══ HARD RULES ═══
1. recommendedExecutionMode MUST be one of the listed options. You MAY recommend a Phase 2 mode that DIFFERS from the proposed mode — that is your job as principal — but you MUST NOT downgrade BLOCK to anything except HALTED, PROOF_COLLECTION, AWARENESS_BUILD_PHASE, or HUMAN_REVIEW_REQUIRED.
2. If verdict=BLOCK: recommendedExecutionMode MUST be HALTED, PROOF_COLLECTION, AWARENESS_BUILD_PHASE, or HUMAN_REVIEW_REQUIRED — never less restrictive.
3. commercialReadinessAssessment MUST cite SPECIFIC numeric inputs (e.g., "funnel 0.62", "signal ratio 0.71") that drive your call.
4. biggestRisk MUST name the SINGLE highest-leverage downside in dollar/trust terms — NEVER "performance may suffer".
5. conditionsToUpgrade MUST be 2-4 SPECIFIC measurable conditions that would shift to next-tier mode.
6. principalCall MUST be ONE sentence stating the call as a CMO would phrase it to their team.
7. whatHumanReviewerWouldAsk MUST be 2-4 questions that surface the riskiest assumptions.

Return ONLY valid JSON:
{
  "recommendedExecutionMode": "<one of the listed modes>",
  "commercialReadinessAssessment": "<specific assessment with metrics>",
  "biggestRisk": "<single highest-leverage downside>",
  "conditionsToUpgrade": ["condition1", "condition2"],
  "principalCall": "<one CMO-grade sentence>",
  "whatHumanReviewerWouldAsk": ["question1", "question2"],
  "reasoningSteps": ["Step 1: ...", "Step 2: ..."]
}`;
}

function buildJudge(json: string): string {
  return `Hostile reviewer of a System Judgement.

═══ ALLOWED MODES PER VERDICT ═══
- BLOCK verdict → recommendedExecutionMode MUST be one of: HALTED, PROOF_COLLECTION, AWARENESS_BUILD_PHASE, HUMAN_REVIEW_REQUIRED. ALL FOUR are equally valid principal calls — HALTED is the canonical full-stop and is NEVER "softening". Choosing HALTED is correct when the principal's call is "stop everything". Choosing PROOF_COLLECTION is correct when there is a constructive proof-harvest path. Do NOT reject HALTED on a BLOCK verdict — only reject if the mode is FULL_EXECUTION, RESTRICTED_EXECUTION, TEST_ONLY, REVIEW_REQUIRED, LIMITED_SPEND, or CHANNEL_VALIDATION_REQUIRED.
- PASS / PASS_WITH_WARNINGS verdict → any mode EXCEPT the four BLOCK-only modes is allowable.

═══ AUTOMATIC REJECTION ═══
- recommendedExecutionMode is invalid for the verdict per the table above (e.g., BLOCK paired with FULL_EXECUTION or RESTRICTED_EXECUTION)
- commercialReadinessAssessment lacks specific numeric inputs from the data
- biggestRisk is generic ("performance may suffer") instead of dollar/trust framing
- conditionsToUpgrade are vague ("improve") instead of measurable conditions
- principalCall is empty or a single word. NEVER reject for being "concise", "brief", "short", "insufficiently directive", or "not CMO-grade enough" — terse principal calls like "Halt all paid spend until proof is rebuilt." or "Freeze all execution and re-validate channels." are FULLY ACCEPTABLE. Only reject if it is empty, a single word, or genuinely meaningless (e.g., "yes", "tbd", "halt").
- whatHumanReviewerWouldAsk has fewer than 2 questions or is generic

═══ DESIGN ═══
${json}

Return ONLY JSON: { "verdict": "ACCEPTED|REJECTED", "reason": "...", "specificFix": "..." }`;
}

function safeJson(text: string): any { if (!text) return null; const c = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim(); try { return JSON.parse(c); } catch { return null; } }

function parseJud(p: any, model: string, retry: number, verdict: SystemVerdict): SystemJudgement | null {
  if (!p || !p.recommendedExecutionMode) return null;
  const m = String(p.recommendedExecutionMode);
  if (!VALID_MODES.includes(m as ExecutionMode)) return null;
  // BLOCK guard
  if (verdict === "BLOCK" && !["HALTED", "PROOF_COLLECTION", "AWARENESS_BUILD_PHASE", "HUMAN_REVIEW_REQUIRED"].includes(m)) return null;
  return {
    verdict,
    recommendedExecutionMode: m as ExecutionMode,
    commercialReadinessAssessment: String(p.commercialReadinessAssessment || "").trim(),
    biggestRisk: String(p.biggestRisk || "").trim(),
    conditionsToUpgrade: Array.isArray(p.conditionsToUpgrade) ? p.conditionsToUpgrade.map(String).slice(0, 6) : [],
    principalCall: String(p.principalCall || "").trim(),
    whatHumanReviewerWouldAsk: Array.isArray(p.whatHumanReviewerWouldAsk) ? p.whatHumanReviewerWouldAsk.map(String).slice(0, 5) : [],
    reasoningSteps: Array.isArray(p.reasoningSteps) ? p.reasoningSteps.map(String) : [],
    judgeVerdict: "NOT_RUN", retryCount: retry, modelUsed: model, generatedAt: new Date().toISOString(),
  };
}

export async function designSystemJudgement(args: Parameters<typeof buildDesigner>[0] & { accountId: string }): Promise<SystemJudgement | null> {
  const start = Date.now();
  const MODEL = "gpt-4.1-mini";

  console.log(`[SystemJudgement] STEP_1 | designing | verdict=${args.verdict} | proposedMode=${args.proposedExecutionMode} | blocks=${args.blockReasons.length} | downgrades=${args.downgrades.length} | dna=${args.commercialDnaPresent}/5`);

  let raw = "";
  try {
    const r = await aiChat({ model: MODEL, messages: [{ role: "user", content: buildDesigner(args) }], temperature: 0.3, max_tokens: 1300, endpoint: "system-judgement", accountId: args.accountId });
    raw = r.choices[0]?.message?.content?.trim() || "";
  } catch (err: any) { console.error(`[SystemJudgement] DESIGN_FAILED | ${err.message}`); return null; }

  let j = parseJud(safeJson(raw), MODEL, 0, args.verdict);
  if (!j) { console.error(`[SystemJudgement] PARSE_FAILED | raw=${raw.slice(0,200)}`); return null; }

  console.log(`[SystemJudgement] STEP_2 | v1 | mode=${j.recommendedExecutionMode}`);

  let verdict: "ACCEPTED" | "REJECTED" = "ACCEPTED"; let reason = ""; let fix = "";
  try {
    const jr = await aiChat({ model: MODEL, messages: [{ role: "user", content: buildJudge(JSON.stringify(j, null, 2)) }], temperature: 0.1, max_tokens: 400, endpoint: "system-judgement-judge", accountId: args.accountId });
    const jp = safeJson(jr.choices[0]?.message?.content?.trim() || "");
    if (jp) { verdict = jp.verdict === "REJECTED" ? "REJECTED" : "ACCEPTED"; reason = String(jp.reason || ""); fix = String(jp.specificFix || ""); }
  } catch (err: any) { console.warn(`[SystemJudgement] JUDGE_FAILED | ${err.message}`); }

  console.log(`[SystemJudgement] STEP_3 | judge=${verdict}${reason ? ` | "${reason.slice(0,80)}"` : ""}`);

  for (let attempt = 1; attempt <= 2 && verdict === "REJECTED" && (reason || fix); attempt++) {
    const fb = [reason, fix].filter(Boolean).join(" — ");
    console.log(`[SystemJudgement] STEP_4 | retry ${attempt}/2`);
    try {
      const retryTemp = attempt === 1 ? 0.5 : 0.7;
      const r2 = await aiChat({ model: MODEL, messages: [{ role: "user", content: buildDesigner({ ...args, judgeFeedback: fb }) }], temperature: retryTemp, max_tokens: 1300, endpoint: `system-judgement-retry-${attempt}`, accountId: args.accountId });
      const j2 = parseJud(safeJson(r2.choices[0]?.message?.content?.trim() || ""), MODEL, attempt, args.verdict);
      if (j2) {
        j = j2;
        reason = ""; fix = "";
        try {
          const jr2 = await aiChat({ model: MODEL, messages: [{ role: "user", content: buildJudge(JSON.stringify(j, null, 2)) }], temperature: 0.1, max_tokens: 400, endpoint: `system-judgement-judge-retry-${attempt}`, accountId: args.accountId });
          const jp2 = safeJson(jr2.choices[0]?.message?.content?.trim() || "");
          if (jp2) { verdict = jp2.verdict === "REJECTED" ? "REJECTED" : "ACCEPTED"; reason = String(jp2.reason || ""); fix = String(jp2.specificFix || ""); }
        } catch {}
      } else { break; }
    } catch (err: any) { console.warn(`[SystemJudgement] RETRY_FAILED | ${err.message}`); break; }
  }

  j.judgeVerdict = verdict; j.judgeReason = reason || undefined;
  console.log(`[SystemJudgement] DONE in ${Date.now() - start}ms | verdict=${verdict} | retries=${j.retryCount}`);
  if (verdict === "REJECTED") { console.warn(`[SystemJudgement] FINAL_REJECTED — falling back`); return null; }
  return j;
}
