import { aiChat } from "../../ai-client";

export interface IterationStrategy {
  learningPriority: string;
  killVsRetainHeuristic: string;
  hypothesisDependencyChain: string[];
  acceptableLossPerTest: string;
  decisionVelocity: "fast" | "measured" | "slow";
  testSequencingLogic: string;
  whatWeWillNotTest: string[];
  reasoningSteps: string[];
  judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN";
  judgeReason?: string;
  retryCount: number;
  modelUsed: string;
  generatedAt: string;
}

const FEW_SHOT = `
═══ CALIBRATION EXAMPLES ═══
WEAK (REJECTED): "Run hypotheses in order, kill underperformers."
STRONG (ACCEPTED):
  learningPriority: "Resolve the trust-deficit hypothesis FIRST (H3 - peer-CMO proof) because it gates 4 downstream creative tests; running creative tests before fixing trust would burn $2k learning nothing."
  killVsRetainHeuristic: "Kill any creative below 60% of top performer's CTR after 200 impressions; retain anything within 60-100% even if unprofitable — those carry signal about hook angles, not just performance."
  hypothesisDependencyChain: ["H3 trust-deficit → unblocks H1 hook test", "H1 hook → unblocks H4 offer-position test", "H4 offer-position → unblocks H2 funnel-step compression"]
  acceptableLossPerTest: "Maximum $400 per hypothesis, $1.6k total weekly learning budget — anything above must be approved as strategic spend not test"
  decisionVelocity: "fast"
  testSequencingLogic: "Sequential not parallel — funnel has 1.8% conversion rate; parallel would split signal below detection threshold"
═══`;

function buildDesigner(args: {
  campaignId: string;
  performanceROAS: number;
  performanceCPA: number;
  performanceConversions: number;
  funnelConversionRate: number;
  hypothesisCount: number;
  topHypotheses: string[];
  optimizationTargets: string[];
  failedStrategies: string[];
  fatigueSignals: string[];
  layerScores: Record<string, number>;
  judgeFeedback?: string;
}): string {
  const judge = args.judgeFeedback ? `\n═══ PRIOR REJECTED ═══\n${args.judgeFeedback}\nRewrite with specific dependency logic and concrete kill thresholds.\n` : "";
  return `You are a Performance Iteration Principal — the senior marketer who decides WHICH test runs first, what dies, and what the campaign learns next. Your job is NOT to list hypotheses — it's to design the LEARNING AGENDA.

A weak system says: "iterate on creative."
A strong system says: "trust-deficit hypothesis FIRST because it gates 4 downstream tests; kill below 60% of top CTR after 200 impressions; max $400/test; sequential because funnel CR is too low for parallel signal."
${judge}
${FEW_SHOT}

═══ INPUT DATA ═══
Campaign: ${args.campaignId}
Performance: ROAS ${args.performanceROAS.toFixed(2)}, CPA $${args.performanceCPA.toFixed(0)}, conversions ${args.performanceConversions}
Funnel conversion rate: ${(args.funnelConversionRate * 100).toFixed(2)}%
Hypotheses queued: ${args.hypothesisCount}

Top hypotheses:
${args.topHypotheses.slice(0, 5).map((h, i) => `[H${i+1}] ${h}`).join("\n") || "(none)"}

Optimization targets:
${args.optimizationTargets.slice(0, 5).map((t, i) => `[T${i+1}] ${t}`).join("\n") || "(none)"}

Failed strategies (do NOT re-run):
${args.failedStrategies.slice(0, 4).map(f => `- ${f}`).join("\n") || "(none)"}

Fatigue signals:
${args.fatigueSignals.slice(0, 4).map(f => `- ${f}`).join("\n") || "(none)"}

Layer scores: ${Object.entries(args.layerScores).map(([k,v]) => `${k}=${v.toFixed(2)}`).join(", ")}

═══ HARD RULES ═══
1. learningPriority MUST name SPECIFIC hypothesis ID + reason it gates downstream tests.
2. killVsRetainHeuristic MUST be a CONCRETE numeric rule (% of top CTR, impressions count, etc), NEVER "kill underperformers".
3. hypothesisDependencyChain MUST be 2-5 ordered "X → unblocks Y" links from the actual hypotheses.
4. acceptableLossPerTest MUST cite a $ ceiling per test AND total learning budget per period.
5. decisionVelocity ("fast"|"measured"|"slow") MUST match funnel conversion rate (low CR → slow/sequential, high CR → fast/parallel).
6. whatWeWillNotTest MUST list 2-4 things deliberately excluded with reason — proves principal is making tradeoffs, not running every test.

Return ONLY valid JSON:
{
  "learningPriority": "<which hypothesis first + why it gates>",
  "killVsRetainHeuristic": "<concrete numeric rule>",
  "hypothesisDependencyChain": ["A → unblocks B", "B → unblocks C"],
  "acceptableLossPerTest": "<$X per test, $Y total budget>",
  "decisionVelocity": "fast|measured|slow",
  "testSequencingLogic": "<sequential or parallel + why>",
  "whatWeWillNotTest": ["thing1 because reason", "thing2 because reason"],
  "reasoningSteps": ["Step 1: ...", "Step 2: ..."]
}`;
}

function buildJudge(json: string): string {
  return `Hostile reviewer of an Iteration Strategy.

═══ AUTOMATIC REJECTION ═══
- learningPriority does not name SPECIFIC hypothesis ID and dependency reason
- killVsRetainHeuristic lacks concrete numeric rule
- hypothesisDependencyChain has fewer than 2 links or links are not in "X → unblocks Y" form
- acceptableLossPerTest missing $ ceiling
- decisionVelocity contradicts funnel data (e.g., "fast" with low CR)
- whatWeWillNotTest is empty or generic — must show real tradeoffs

═══ DESIGN ═══
${json}

Return ONLY JSON: { "verdict": "ACCEPTED|REJECTED", "reason": "...", "specificFix": "..." }`;
}

function safeJson(text: string): any { if (!text) return null; const c = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim(); try { return JSON.parse(c); } catch { return null; } }

function parseStrategy(p: any, model: string, retry: number): IterationStrategy | null {
  if (!p || !p.learningPriority) return null;
  const dv = String(p.decisionVelocity || "");
  if (!["fast", "measured", "slow"].includes(dv)) return null;
  return {
    learningPriority: String(p.learningPriority).trim(),
    killVsRetainHeuristic: String(p.killVsRetainHeuristic || "").trim(),
    hypothesisDependencyChain: Array.isArray(p.hypothesisDependencyChain) ? p.hypothesisDependencyChain.map(String).slice(0, 6) : [],
    acceptableLossPerTest: String(p.acceptableLossPerTest || "").trim(),
    decisionVelocity: dv as any,
    testSequencingLogic: String(p.testSequencingLogic || "").trim(),
    whatWeWillNotTest: Array.isArray(p.whatWeWillNotTest) ? p.whatWeWillNotTest.map(String).slice(0, 5) : [],
    reasoningSteps: Array.isArray(p.reasoningSteps) ? p.reasoningSteps.map(String) : [],
    judgeVerdict: "NOT_RUN", retryCount: retry, modelUsed: model, generatedAt: new Date().toISOString(),
  };
}

export async function designIterationStrategy(args: Parameters<typeof buildDesigner>[0] & {
  accountId: string;
  // Anchor doctrine (criteria A + F): pre-rendered doctrine/DNA anchor block
  // computed by the orchestrator and threaded down. Prepended to BOTH the
  // designer prompts and the judge prompts (anchor in first prompt AND judge).
  doctrineBlock?: string | null;
  anchorSource?: "doctrine" | "dna" | "none";
}): Promise<IterationStrategy | null> {
  const start = Date.now();
  const MODEL = "gpt-4.1-mini";
  // Explicit if/else source classification — no semantic-fallback chains (D1).
  let itAnchorSource: "doctrine" | "dna" | "none" = "none";
  if (args.anchorSource === "doctrine") itAnchorSource = "doctrine";
  else if (args.anchorSource === "dna") itAnchorSource = "dna";
  const itAnchorPresent = args.doctrineBlock && args.doctrineBlock.length > 0;
  const itAnchorPrefix = itAnchorPresent ? `${args.doctrineBlock}\n\n` : "";

  if (args.hypothesisCount === 0) { console.log("[IterationStrategy] SKIPPED — no hypotheses to sequence"); return null; }

  console.log(`[IterationStrategy] STEP_1 | designing | hypotheses=${args.hypothesisCount} | conversions=${args.performanceConversions}`);

  let raw = "";
  try {
    console.log(`[IterationStrategy] ANCHOR_EVIDENCE | engine=strategy_iteration | site=first_prompt | attempt=1 | present=${itAnchorPresent ? "yes" : "no"} | source=${itAnchorSource}`);
    const r = await aiChat({ model: MODEL, messages: [{ role: "user", content: `${itAnchorPrefix}${buildDesigner(args)}` }], temperature: 0.3, max_tokens: 1200, endpoint: "iteration-strategy", accountId: args.accountId });
    raw = r.choices[0]?.message?.content?.trim() || "";
  } catch (err: any) { console.error(`[IterationStrategy] DESIGN_FAILED | ${err.message}`); return null; }

  let s = parseStrategy(safeJson(raw), MODEL, 0);
  if (!s) { console.error(`[IterationStrategy] PARSE_FAILED | raw=${raw.slice(0,200)}`); return null; }

  console.log(`[IterationStrategy] STEP_2 | v1 | velocity=${s.decisionVelocity} | chain=${s.hypothesisDependencyChain.length}`);

  let verdict: "ACCEPTED" | "REJECTED" = "ACCEPTED"; let reason = ""; let fix = "";
  try {
    console.log(`[IterationStrategy] ANCHOR_EVIDENCE | engine=strategy_iteration | site=judge | attempt=1 | present=${itAnchorPresent ? "yes" : "no"} | source=${itAnchorSource}`);
    const jr = await aiChat({ model: MODEL, messages: [{ role: "user", content: `${itAnchorPrefix}${buildJudge(JSON.stringify(s, null, 2))}` }], temperature: 0.1, max_tokens: 400, endpoint: "iteration-strategy-judge", accountId: args.accountId });
    const jp = safeJson(jr.choices[0]?.message?.content?.trim() || "");
    if (jp) { verdict = jp.verdict === "REJECTED" ? "REJECTED" : "ACCEPTED"; reason = String(jp.reason || ""); fix = String(jp.specificFix || ""); }
  } catch (err: any) { console.warn(`[IterationStrategy] JUDGE_FAILED | ${err.message}`); }

  console.log(`[IterationStrategy] STEP_3 | judge=${verdict}${reason ? ` | "${reason.slice(0,80)}"` : ""}`);

  if (verdict === "REJECTED" && (reason || fix)) {
    const fb = [reason, fix].filter(Boolean).join(" — ");
    console.log(`[IterationStrategy] STEP_4 | retry`);
    try {
      console.log(`[IterationStrategy] ANCHOR_EVIDENCE | engine=strategy_iteration | site=first_prompt | attempt=2 | present=${itAnchorPresent ? "yes" : "no"} | source=${itAnchorSource}`);
      const r2 = await aiChat({ model: MODEL, messages: [{ role: "user", content: `${itAnchorPrefix}${buildDesigner({ ...args, judgeFeedback: fb })}` }], temperature: 0.3, max_tokens: 1200, endpoint: "iteration-strategy-retry", accountId: args.accountId });
      const s2 = parseStrategy(safeJson(r2.choices[0]?.message?.content?.trim() || ""), MODEL, 1);
      if (s2) {
        s = s2;
        try {
          console.log(`[IterationStrategy] ANCHOR_EVIDENCE | engine=strategy_iteration | site=judge | attempt=2 | present=${itAnchorPresent ? "yes" : "no"} | source=${itAnchorSource}`);
          const jr2 = await aiChat({ model: MODEL, messages: [{ role: "user", content: `${itAnchorPrefix}${buildJudge(JSON.stringify(s, null, 2))}` }], temperature: 0.1, max_tokens: 400, endpoint: "iteration-strategy-judge-retry", accountId: args.accountId });
          const jp2 = safeJson(jr2.choices[0]?.message?.content?.trim() || "");
          if (jp2) { verdict = jp2.verdict === "REJECTED" ? "REJECTED" : "ACCEPTED"; reason = String(jp2.reason || ""); }
        } catch {}
      }
    } catch (err: any) { console.warn(`[IterationStrategy] RETRY_FAILED | ${err.message}`); }
  }

  s.judgeVerdict = verdict; s.judgeReason = reason || undefined;
  console.log(`[IterationStrategy] DONE in ${Date.now() - start}ms | verdict=${verdict} | retries=${s.retryCount}`);
  if (verdict === "REJECTED") { console.warn(`[IterationStrategy] FINAL_REJECTED — falling back`); return null; }
  return s;
}
