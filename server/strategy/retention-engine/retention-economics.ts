import { aiChat } from "../../ai-client";

export interface RetentionEconomics {
  ltvUnlockSequence: string;
  churnDefensePriority: string;
  expansionRevenuePath: string;
  paybackPeriodAssessment: string;
  retentionROIThesis: string;
  topThreeChurnMoments: string[];
  defensiveInvestmentPlan: string;
  reasoningSteps: string[];
  judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN";
  judgeReason?: string;
  retryCount: number;
  modelUsed: string;
  generatedAt: string;
}

const FEW_SHOT = `
═══ CALIBRATION EXAMPLES ═══
WEAK (REJECTED): "Improve retention with onboarding emails."
STRONG (ACCEPTED):
  ltvUnlockSequence: "Day 0 — onboarding completion gates 67% of LTV (avg $480 vs $160 for non-completers); Day 14 — first value-realization moment (3 use cases done) drives 2.4x LTV; Day 60 — relationship transition from tool to platform unlocks tier 2 expansion"
  churnDefensePriority: "Defend Day 7 churn FIRST — it accounts for 42% of total churn and resolving it is cheap ($14/save vs $87/save at Day 30); Day 7 churn signals 'value not understood' which is fixable by activation, not discount"
  expansionRevenuePath: "Tier 1 → Tier 2 path runs through team-invite usage; customers who invite 2+ teammates by Day 30 have 3.1x conversion to Tier 2; trigger expansion offer at 2nd invite, not at quota or anniversary"
  paybackPeriodAssessment: "CAC payback at 4.2 months at current LTV — acceptable for SaaS but compresses to 2.8 months if Day 7 retention rises 10%; this is the highest-leverage retention investment"
═══`;

function buildDesigner(args: {
  customerLTV: number | null;
  churnRate: number | null;
  repeatPurchaseRate: number | null;
  retentionWindowDays: number | null;
  topMotivations: string[];
  topPostPurchaseObjections: string[];
  retentionLoops: string[];
  topChurnRiskFlags: string[];
  topLTVPaths: string[];
  topUpsellTriggers: string[];
  offerCoreOutcome: string | null;
  offerProofStrength: number | null;
  judgeFeedback?: string;
}): string {
  const judge = args.judgeFeedback ? `\n═══ PRIOR REJECTED ═══\n${args.judgeFeedback}\nRewrite with concrete % churn-by-stage and dollar leverage.\n` : "";
  return `You are a Lifetime Value Principal — the senior marketer who designs the post-purchase economic engine. Your job is NOT to list retention loops — it's to design the COMMERCIAL LTV PROGRAM that turns the first dollar into compounding revenue.

A weak system says: "improve onboarding, send re-engagement emails."
A strong system says: "Day 7 churn = 42% of total churn at $14/save vs $87 at Day 30 — defend it FIRST; expansion runs through team-invite at Day 30; CAC payback compresses 4.2→2.8 months if Day 7 retention rises 10%."
${judge}
${FEW_SHOT}

═══ INPUT DATA ═══
Customer LTV: ${args.customerLTV !== null ? `$${args.customerLTV.toFixed(0)}` : "(unknown)"}
Churn rate: ${args.churnRate !== null ? `${(args.churnRate * 100).toFixed(1)}%` : "(unknown)"}
Repeat purchase rate: ${args.repeatPurchaseRate !== null ? `${(args.repeatPurchaseRate * 100).toFixed(1)}%` : "(unknown)"}
Retention window: ${args.retentionWindowDays !== null ? `${args.retentionWindowDays} days` : "(unknown)"}
Offer core outcome: ${args.offerCoreOutcome || "(unspecified)"}
Offer proof strength: ${args.offerProofStrength !== null ? args.offerProofStrength.toFixed(2) : "(unknown)"}

Top purchase motivations:
${args.topMotivations.slice(0, 5).map(m => `- ${m}`).join("\n") || "(none)"}

Top post-purchase objections:
${args.topPostPurchaseObjections.slice(0, 5).map(o => `- ${o}`).join("\n") || "(none)"}

Retention loops queued:
${args.retentionLoops.slice(0, 5).map(l => `- ${l}`).join("\n") || "(none)"}

Top churn risk flags:
${args.topChurnRiskFlags.slice(0, 5).map(c => `- ${c}`).join("\n") || "(none)"}

Top LTV expansion paths:
${args.topLTVPaths.slice(0, 5).map(p => `- ${p}`).join("\n") || "(none)"}

Top upsell triggers:
${args.topUpsellTriggers.slice(0, 5).map(t => `- ${t}`).join("\n") || "(none)"}

═══ HARD RULES ═══
1. ltvUnlockSequence MUST name SPECIFIC time-points (Day N) and the LTV multiplier each gates.
2. churnDefensePriority MUST identify the SINGLE highest-leverage churn moment with $/save economics.
3. expansionRevenuePath MUST trace a CONCRETE behavioral path from tier 1 → tier 2 with trigger metric (NOT "send upsell email").
4. paybackPeriodAssessment MUST cite CAC payback in months AND describe one retention lever that compresses it.
5. topThreeChurnMoments MUST be 3 specific moments (Day 1, Day 7, Day 30 etc) with % of total churn each represents.
6. If LTV is unknown — explicitly state estimation method used and confidence in assessment.

Return ONLY valid JSON:
{
  "ltvUnlockSequence": "<time-sequenced unlock moments>",
  "churnDefensePriority": "<single highest-leverage moment + $ economics>",
  "expansionRevenuePath": "<behavioral path with trigger metric>",
  "paybackPeriodAssessment": "<months + compression lever>",
  "retentionROIThesis": "<one paragraph: $1 retention spend → $X LTV defended/expanded>",
  "topThreeChurnMoments": ["Day X — Y% of churn — Z mitigation", "...", "..."],
  "defensiveInvestmentPlan": "<where to invest first dollar of retention budget>",
  "reasoningSteps": ["Step 1: ...", "Step 2: ..."]
}`;
}

function buildJudge(json: string): string {
  return `Hostile reviewer of a Retention Economics design.

═══ AUTOMATIC REJECTION ═══
- ltvUnlockSequence lacks specific time-points or LTV multipliers
- churnDefensePriority is generic ("reduce churn") instead of named moment + $/save
- expansionRevenuePath is "send upsell email" instead of behavioral trigger
- paybackPeriodAssessment lacks months figure or compression lever
- topThreeChurnMoments has fewer than 3 entries or lacks % of churn each
- retentionROIThesis is platitude — must cite $-leverage ratio

═══ DESIGN ═══
${json}

Return ONLY JSON: { "verdict": "ACCEPTED|REJECTED", "reason": "...", "specificFix": "..." }`;
}

function safeJson(text: string): any { if (!text) return null; const c = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim(); try { return JSON.parse(c); } catch { return null; } }

function parseEcon(p: any, model: string, retry: number): RetentionEconomics | null {
  if (!p || !p.ltvUnlockSequence) return null;
  return {
    ltvUnlockSequence: String(p.ltvUnlockSequence).trim(),
    churnDefensePriority: String(p.churnDefensePriority || "").trim(),
    expansionRevenuePath: String(p.expansionRevenuePath || "").trim(),
    paybackPeriodAssessment: String(p.paybackPeriodAssessment || "").trim(),
    retentionROIThesis: String(p.retentionROIThesis || "").trim(),
    topThreeChurnMoments: Array.isArray(p.topThreeChurnMoments) ? p.topThreeChurnMoments.map(String).slice(0, 5) : [],
    defensiveInvestmentPlan: String(p.defensiveInvestmentPlan || "").trim(),
    reasoningSteps: Array.isArray(p.reasoningSteps) ? p.reasoningSteps.map(String) : [],
    judgeVerdict: "NOT_RUN", retryCount: retry, modelUsed: model, generatedAt: new Date().toISOString(),
  };
}

export async function designRetentionEconomics(args: Parameters<typeof buildDesigner>[0] & {
  accountId: string;
  // Anchor doctrine (criteria A + F): pre-rendered doctrine/DNA anchor block
  // computed by the orchestrator and threaded down. Prepended to BOTH the
  // designer prompts and the judge prompts (anchor in first prompt AND judge).
  doctrineBlock?: string | null;
  anchorSource?: "doctrine" | "dna" | "none";
}): Promise<RetentionEconomics | null> {
  const start = Date.now();
  const MODEL = "gpt-4.1-mini";
  // Explicit if/else source classification — no semantic-fallback chains (D1).
  let reAnchorSource: "doctrine" | "dna" | "none" = "none";
  if (args.anchorSource === "doctrine") reAnchorSource = "doctrine";
  else if (args.anchorSource === "dna") reAnchorSource = "dna";
  const reAnchorPresent = args.doctrineBlock && args.doctrineBlock.length > 0;
  const reAnchorPrefix = reAnchorPresent ? `${args.doctrineBlock}\n\n` : "";

  if (args.retentionLoops.length === 0 && args.topLTVPaths.length === 0 && args.topMotivations.length === 0) {
    console.log("[RetentionEconomics] SKIPPED — no retention signal to design from"); return null;
  }

  console.log(`[RetentionEconomics] STEP_1 | designing | ltv=${args.customerLTV ?? "?"} | churn=${args.churnRate ?? "?"} | loops=${args.retentionLoops.length}`);

  let raw = "";
  try {
    console.log(`[RetentionEconomics] ANCHOR_EVIDENCE | engine=strategy_retention | site=first_prompt | attempt=1 | present=${reAnchorPresent ? "yes" : "no"} | source=${reAnchorSource}`);
    const r = await aiChat({ model: MODEL, messages: [{ role: "user", content: `${reAnchorPrefix}${buildDesigner(args)}` }], temperature: 0.3, max_tokens: 1300, endpoint: "retention-economics", accountId: args.accountId });
    raw = r.choices[0]?.message?.content?.trim() || "";
  } catch (err: any) { console.error(`[RetentionEconomics] DESIGN_FAILED | ${err.message}`); return null; }

  let e = parseEcon(safeJson(raw), MODEL, 0);
  if (!e) { console.error(`[RetentionEconomics] PARSE_FAILED | raw=${raw.slice(0,200)}`); return null; }

  console.log(`[RetentionEconomics] STEP_2 | v1 | churnMoments=${e.topThreeChurnMoments.length}`);

  let verdict: "ACCEPTED" | "REJECTED" = "ACCEPTED"; let reason = ""; let fix = "";
  try {
    console.log(`[RetentionEconomics] ANCHOR_EVIDENCE | engine=strategy_retention | site=judge | attempt=1 | present=${reAnchorPresent ? "yes" : "no"} | source=${reAnchorSource}`);
    const jr = await aiChat({ model: MODEL, messages: [{ role: "user", content: `${reAnchorPrefix}${buildJudge(JSON.stringify(e, null, 2))}` }], temperature: 0.1, max_tokens: 400, endpoint: "retention-economics-judge", accountId: args.accountId });
    const jp = safeJson(jr.choices[0]?.message?.content?.trim() || "");
    if (jp) { verdict = jp.verdict === "REJECTED" ? "REJECTED" : "ACCEPTED"; reason = String(jp.reason || ""); fix = String(jp.specificFix || ""); }
  } catch (err: any) { console.warn(`[RetentionEconomics] JUDGE_FAILED | ${err.message}`); }

  console.log(`[RetentionEconomics] STEP_3 | judge=${verdict}${reason ? ` | "${reason.slice(0,80)}"` : ""}`);

  if (verdict === "REJECTED" && (reason || fix)) {
    const fb = [reason, fix].filter(Boolean).join(" — ");
    console.log(`[RetentionEconomics] STEP_4 | retry`);
    try {
      console.log(`[RetentionEconomics] ANCHOR_EVIDENCE | engine=strategy_retention | site=first_prompt | attempt=2 | present=${reAnchorPresent ? "yes" : "no"} | source=${reAnchorSource}`);
      const r2 = await aiChat({ model: MODEL, messages: [{ role: "user", content: `${reAnchorPrefix}${buildDesigner({ ...args, judgeFeedback: fb })}` }], temperature: 0.3, max_tokens: 1300, endpoint: "retention-economics-retry", accountId: args.accountId });
      const e2 = parseEcon(safeJson(r2.choices[0]?.message?.content?.trim() || ""), MODEL, 1);
      if (e2) {
        e = e2;
        try {
          console.log(`[RetentionEconomics] ANCHOR_EVIDENCE | engine=strategy_retention | site=judge | attempt=2 | present=${reAnchorPresent ? "yes" : "no"} | source=${reAnchorSource}`);
          const jr2 = await aiChat({ model: MODEL, messages: [{ role: "user", content: `${reAnchorPrefix}${buildJudge(JSON.stringify(e, null, 2))}` }], temperature: 0.1, max_tokens: 400, endpoint: "retention-economics-judge-retry", accountId: args.accountId });
          const jp2 = safeJson(jr2.choices[0]?.message?.content?.trim() || "");
          if (jp2) { verdict = jp2.verdict === "REJECTED" ? "REJECTED" : "ACCEPTED"; reason = String(jp2.reason || ""); }
        } catch {}
      }
    } catch (err: any) { console.warn(`[RetentionEconomics] RETRY_FAILED | ${err.message}`); }
  }

  e.judgeVerdict = verdict; e.judgeReason = reason || undefined;
  console.log(`[RetentionEconomics] DONE in ${Date.now() - start}ms | verdict=${verdict} | retries=${e.retryCount}`);
  if (verdict === "REJECTED") { console.warn(`[RetentionEconomics] FINAL_REJECTED — falling back`); return null; }
  return e;
}
