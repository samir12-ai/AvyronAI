import { aiChat } from "../../ai-client";
import { generateWithRepair, LLMReliabilityError } from "../../shared/llm-reliability/reliability-runner";
import type { JudgeResult } from "../../shared/llm-reliability/types";
import {
  deriveAnchorFromProductDna,
  type ProductAnchor,
  type ProductDnaLike,
} from "../../shared/strategic-doctrine";

export interface ChannelOrchestration {
  primaryChannel: string;
  secondaryChannel: string;
  marketEntryPattern: string;
  channelInterlock: string;
  withdrawalTrigger: string;
  validationMilestone: string;
  riskBudgetBalance: string;
  reasoningSteps: string[];
  whatWeWillNotPursue: string[];
  judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN";
  judgeReason?: string;
  retryCount: number;
  modelUsed: string;
  generatedAt: string;
}

const FEW_SHOT = `
═══ CALIBRATION EXAMPLES ═══
WEAK (REJECTED): "LinkedIn primary, Google secondary; both are strong fits."
STRONG (ACCEPTED):
  marketEntryPattern: "Beachhead-and-spread: LinkedIn organic builds B2B authority via 3 named-customer case posts/week (zero ad spend); Google paid only fires for branded + 'vs competitor' high-intent search after 4 weeks of organic authority signal — Google ads BEFORE authority signal would burn $4-6 CPC with cold trust."
  channelInterlock: "LinkedIn organic generates 'who is X' search volume; Google paid harvests that intent at branded-CPC ($1.20 vs $4.80 cold). LinkedIn warms, Google converts. Without LinkedIn, Google paid CPC stays cold."
  withdrawalTrigger: "Pull LinkedIn if engagement rate falls below 2.5% across 4 consecutive posts (signals founder voice exhausted). Pull Google paid if branded search volume hasn't grown 30% in 8 weeks of organic spend."
  validationMilestone: "12 LinkedIn posts published + branded search lift ≥30% + 3 inbound demos before unlocking secondary paid spend on Google."
  riskBudgetBalance: "85% organic LinkedIn (sweat equity), 15% Google paid (small validation spend); reverses to 60/40 after validation milestone hit."
═══`;

function buildDesigner(args: {
  primaryChannelName: string;
  secondaryChannelName: string;
  primaryChannelType: string;
  secondaryChannelType: string;
  primaryFitScore: number;
  secondaryFitScore: number;
  channelMode: string;
  awarenessStage: string;
  audienceMaturityIndex: number | null;
  testBudgetMin: number; testBudgetMax: number;
  killFlag: boolean;
  expansionAllowed: boolean;
  rejectedChannels: string[];
  funnelAwarenessCount: number;
  funnelNurtureCount: number;
  funnelConversionCount: number;
  judgeFeedback?: string;
  /** Fix 4: doctrine anchor (may be null) — resolved anchor is computed in
   *  designChannelOrchestration (doctrine first, else DNA-derived). */
  productAnchor?: ProductAnchor | null;
  /** F5a: Product DNA used to derive the anchor when doctrine's anchor is absent. */
  productDna?: ProductDnaLike | null;
}): string {
  // Fix 5: when a prior attempt was rejected, steer the rewrite back to THIS
  // product's anchor (mirrors positioning's battery steering sentence).
  const anchorSteer = args.productAnchor
    ? ` Anchor the interlock and entry pattern to THIS product — cite its differentiating feature ("${args.productAnchor.differentiatingFeature.slice(0, 100)}") or core problem so no generic competitor could truthfully reuse the design.`
    : "";
  const judge = args.judgeFeedback ? `\n═══ PRIOR REJECTED ═══\n${args.judgeFeedback}\nRewrite with named interlock + concrete withdrawal triggers.${anchorSteer}\n` : "";
  // Fix 4: product-anchor grounding block — orchestration must sequence THIS
  // product's motion, not a category-generic channel playbook.
  const anchorBlock = args.productAnchor
    ? `\n═══ LOCKED PRODUCT ANCHOR (ground the orchestration in THIS product) ═══
Product name: ${args.productAnchor.name}
Product type: ${args.productAnchor.type}
${args.productAnchor.keyAttributes.length > 0 ? `Key attributes: ${args.productAnchor.keyAttributes.join("; ")}\n` : ""}Core problem solved: ${args.productAnchor.coreProblemSolved}
Differentiating feature: ${args.productAnchor.differentiatingFeature}

GROUNDING RULE: marketEntryPattern and channelInterlock MUST reference what is specific to THIS product (its differentiating feature, its core problem, its buyer's trust state) — a design that could be pasted onto a generic competitor in the same category will be REJECTED.
═══`
    : "";
  return `You are a Channel Orchestration Principal — the senior marketer who decides not just WHICH channels but HOW they sequence, INTERLOCK, and when to WITHDRAW. Your job is NOT to list primary+secondary — it's to design the MARKET ENTRY pattern.

A weak system says: "LinkedIn primary, Google secondary."
A strong system says: "beachhead-and-spread: LinkedIn organic builds authority FIRST; Google paid only fires AFTER branded search volume lifts; pull LinkedIn if engagement <2.5% / 4 posts; pull Google if branded volume not +30% in 8 weeks."
${anchorBlock}${judge}
${FEW_SHOT}

═══ INPUT DATA ═══
Primary: ${args.primaryChannelName} (${args.primaryChannelType}) — fit ${args.primaryFitScore.toFixed(2)}
Secondary: ${args.secondaryChannelName} (${args.secondaryChannelType}) — fit ${args.secondaryFitScore.toFixed(2)}
Channel mode: ${args.channelMode}
Awareness stage: ${args.awarenessStage}
Audience maturity index: ${args.audienceMaturityIndex !== null ? args.audienceMaturityIndex.toFixed(2) : "(unknown)"}
Test budget range: $${args.testBudgetMin}–$${args.testBudgetMax}
Kill flag: ${args.killFlag} | Expansion allowed: ${args.expansionAllowed}
Funnel coverage: awareness=${args.funnelAwarenessCount}, nurture=${args.funnelNurtureCount}, conversion=${args.funnelConversionCount}

Rejected channels (and why):
${args.rejectedChannels.slice(0, 5).map(r => `- ${r}`).join("\n") || "(none)"}

═══ HARD RULES ═══
1. marketEntryPattern MUST be a named pattern (beachhead-and-spread, dual-front, single-channel-validation, etc) with reason rooted in awareness stage + budget.
2. channelInterlock MUST describe HOW primary feeds secondary in CONCRETE causal terms (search volume, list growth, retargeting pool size, etc), not "they support each other".
3. withdrawalTrigger MUST be a CONCRETE numeric trigger per channel ("if metric X falls below Y across Z time").
4. validationMilestone MUST name the PRECISE conditions before unlocking secondary spend.
5. riskBudgetBalance MUST give explicit % allocation primary/secondary with reason rooted in trust state.
6. whatWeWillNotPursue MUST list 2-4 deliberately-rejected approaches with reason — proves principal-level discipline.
7. If killFlag=true: marketEntryPattern MUST be "halted" and withdrawalTrigger="already withdrawn".
8. If conversion stage count is 0: design MUST acknowledge no scaling without conversion path.
${args.productAnchor ? `9. marketEntryPattern and channelInterlock MUST be grounded in the LOCKED PRODUCT ANCHOR above — designs interchangeable with a generic competitor are REJECTED.` : ""}

Return ONLY valid JSON:
{
  "marketEntryPattern": "<named pattern + reason>",
  "channelInterlock": "<concrete causal interlock>",
  "withdrawalTrigger": "<numeric trigger per channel>",
  "validationMilestone": "<precise unlock conditions>",
  "riskBudgetBalance": "<% allocation with reason>",
  "whatWeWillNotPursue": ["approach1 because reason", "approach2 because reason"],
  "reasoningSteps": ["Step 1: ...", "Step 2: ..."]
}`;
}

function buildJudge(json: string, productAnchor?: ProductAnchor | null): string {
  // Fix 4: generic-competitor rejection rule — judged against the locked anchor.
  const anchorRule = productAnchor
    ? `\n- Is INTERCHANGEABLE with a generic competitor: neither marketEntryPattern nor channelInterlock resolves to this product's differentiating feature ("${productAnchor.differentiatingFeature.slice(0, 120)}") or its core problem ("${productAnchor.coreProblemSolved.slice(0, 120)}") — if the design could be pasted onto any competitor in the category without edits, REJECT it`
    : "";
  return `Hostile reviewer of a Channel Orchestration design.

═══ AUTOMATIC REJECTION ═══
- marketEntryPattern is generic ("multi-channel") instead of named pattern with reason
- channelInterlock describes "they support each other" instead of CONCRETE causal mechanism
- withdrawalTrigger lacks numeric metric or threshold
- validationMilestone is "good performance" instead of precise unlock conditions
- riskBudgetBalance lacks % allocation
- whatWeWillNotPursue is empty — must show real tradeoffs${anchorRule}

═══ DESIGN ═══
${json}

Return ONLY JSON: { "verdict": "ACCEPTED|REJECTED", "reason": "...", "specificFix": "..." }`;
}

function safeJson(text: string): any { if (!text) return null; const c = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim(); try { return JSON.parse(c); } catch { return null; } }

function parseOrch(p: any, model: string, retry: number, primary: string, secondary: string): ChannelOrchestration | null {
  if (!p || !p.marketEntryPattern) return null;
  return {
    primaryChannel: primary, secondaryChannel: secondary,
    marketEntryPattern: String(p.marketEntryPattern).trim(),
    channelInterlock: String(p.channelInterlock || "").trim(),
    withdrawalTrigger: String(p.withdrawalTrigger || "").trim(),
    validationMilestone: String(p.validationMilestone || "").trim(),
    riskBudgetBalance: String(p.riskBudgetBalance || "").trim(),
    reasoningSteps: Array.isArray(p.reasoningSteps) ? p.reasoningSteps.map(String) : [],
    whatWeWillNotPursue: Array.isArray(p.whatWeWillNotPursue) ? p.whatWeWillNotPursue.map(String).slice(0, 5) : [],
    judgeVerdict: "NOT_RUN", retryCount: retry, modelUsed: model, generatedAt: new Date().toISOString(),
  };
}

export async function designChannelOrchestration(args: Parameters<typeof buildDesigner>[0] & { accountId: string }): Promise<ChannelOrchestration | null> {
  const start = Date.now();
  const MODEL = "gpt-4.1-mini";

  // F5a (Fix 4): resolve the anchor INSIDE this module — doctrine anchor first,
  // else derived from Product DNA (explicit if/else — D1; derivation returns
  // null unless differentiator + problem + name + type all exist — D5).
  let resolvedAnchor: ProductAnchor | null = null;
  if (args.productAnchor) {
    resolvedAnchor = args.productAnchor;
  } else if (args.productDna) {
    const derivedOrchAnchor = deriveAnchorFromProductDna(args.productDna);
    if (derivedOrchAnchor) {
      resolvedAnchor = derivedOrchAnchor;
      console.log(`[ChannelOrchestration] ANCHOR_FROM_DNA | doctrine anchor absent — anchor derived from Product DNA`);
    }
  }
  const groundedArgs = { ...args, productAnchor: resolvedAnchor };
  // T003: anchor-usage evidence (audit trail — engine × site × attempt × source).
  let orchAnchorSource: "doctrine" | "dna" | "none" = "none";
  if (args.productAnchor) {
    orchAnchorSource = "doctrine";
  } else if (resolvedAnchor) {
    orchAnchorSource = "dna";
  }
  const orchAnchorPresent = resolvedAnchor ? "yes" : "no";
  console.log(`[ChannelOrchestration] ANCHOR_EVIDENCE | engine=channel_orchestration | site=first_prompt | attempt=1 | present=${orchAnchorPresent} | source=${orchAnchorSource}`);

  console.log(`[ChannelOrchestration] STEP_1 | designing | primary=${args.primaryChannelName} | secondary=${args.secondaryChannelName} | mode=${args.channelMode} | anchored=${!!resolvedAnchor}`);

  let raw = "";
  try {
    const r = await aiChat({ model: MODEL, messages: [{ role: "user", content: buildDesigner(groundedArgs) }], temperature: 0.3, max_tokens: 1300, endpoint: "channel-orchestration", accountId: args.accountId });
    raw = r.choices[0]?.message?.content?.trim() || "";
  } catch (err: any) { console.error(`[ChannelOrchestration] DESIGN_FAILED | ${err.message}`); return null; }

  let o = parseOrch(safeJson(raw), MODEL, 0, args.primaryChannelName, args.secondaryChannelName);
  if (!o) { console.error(`[ChannelOrchestration] PARSE_FAILED | raw=${raw.slice(0,200)}`); return null; }

  console.log(`[ChannelOrchestration] STEP_2 | v1 | pattern="${o.marketEntryPattern.slice(0,60)}"`);

  let verdict: "ACCEPTED" | "REJECTED" = "ACCEPTED"; let reason = ""; let fix = "";
  try {
    console.log(`[ChannelOrchestration] ANCHOR_EVIDENCE | engine=channel_orchestration | site=judge | attempt=1 | present=${orchAnchorPresent} | source=${orchAnchorSource}`);
    const jr = await aiChat({ model: MODEL, messages: [{ role: "user", content: buildJudge(JSON.stringify(o, null, 2), resolvedAnchor) }], temperature: 0.1, max_tokens: 400, endpoint: "channel-orchestration-judge", accountId: args.accountId });
    const jp = safeJson(jr.choices[0]?.message?.content?.trim() || "");
    if (jp) { verdict = jp.verdict === "REJECTED" ? "REJECTED" : "ACCEPTED"; reason = String(jp.reason || ""); fix = String(jp.specificFix || ""); }
  } catch (err: any) { console.warn(`[ChannelOrchestration] JUDGE_FAILED | ${err.message}`); }

  console.log(`[ChannelOrchestration] STEP_3 | judge=${verdict}${reason ? ` | "${reason.slice(0,80)}"` : ""}`);

  if (verdict === "REJECTED" && (reason || fix)) {
    const fb = [reason, fix].filter(Boolean).join(" — ");
    console.log(`[ChannelOrchestration] STEP_4 | retry`);
    try {
      console.log(`[ChannelOrchestration] ANCHOR_EVIDENCE | engine=channel_orchestration | site=first_prompt | attempt=2 | present=${orchAnchorPresent} | source=${orchAnchorSource}`);
      const r2 = await aiChat({ model: MODEL, messages: [{ role: "user", content: buildDesigner({ ...groundedArgs, judgeFeedback: fb }) }], temperature: 0.3, max_tokens: 1300, endpoint: "channel-orchestration-retry", accountId: args.accountId });
      const o2 = parseOrch(safeJson(r2.choices[0]?.message?.content?.trim() || ""), MODEL, 1, args.primaryChannelName, args.secondaryChannelName);
      if (o2) {
        o = o2;
        try {
          console.log(`[ChannelOrchestration] ANCHOR_EVIDENCE | engine=channel_orchestration | site=judge | attempt=2 | present=${orchAnchorPresent} | source=${orchAnchorSource}`);
          const jr2 = await aiChat({ model: MODEL, messages: [{ role: "user", content: buildJudge(JSON.stringify(o, null, 2), resolvedAnchor) }], temperature: 0.1, max_tokens: 400, endpoint: "channel-orchestration-judge-retry", accountId: args.accountId });
          const jp2 = safeJson(jr2.choices[0]?.message?.content?.trim() || "");
          if (jp2) { verdict = jp2.verdict === "REJECTED" ? "REJECTED" : "ACCEPTED"; reason = String(jp2.reason || ""); }
        } catch {}
      }
    } catch (err: any) { console.warn(`[ChannelOrchestration] RETRY_FAILED | ${err.message}`); }
  }

  o.judgeVerdict = verdict; o.judgeReason = reason || undefined;
  console.log(`[ChannelOrchestration] DONE in ${Date.now() - start}ms | verdict=${verdict} | retries=${o.retryCount}`);
  if (verdict === "REJECTED") { console.warn(`[ChannelOrchestration] FINAL_REJECTED — falling back`); return null; }
  return o;
}
