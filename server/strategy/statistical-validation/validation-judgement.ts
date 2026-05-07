import { aiChat } from "../../ai-client";

export interface ValidationJudgement {
  validationState: "validated" | "provisional" | "weak" | "rejected";
  evidenceStrength: number;
  signalBackedClaimRatio: number;
  commercialUsability: "usable_for_scale" | "usable_for_test" | "usable_for_learning_only" | "not_usable";
  topTrustGaps: string[];
  whatWouldUnlockNextTier: string;
  proofCollectionPlan: string[];
  reasoningSteps: string[];
  judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN";
  judgeReason?: string;
  retryCount: number;
  modelUsed: string;
  generatedAt: string;
}

const FEW_SHOT = `
═══ CALIBRATION EXAMPLES ═══
WEAK (REJECTED): "Evidence is moderate, can be used for testing."
STRONG (ACCEPTED):
  commercialUsability: "usable_for_test"
  topTrustGaps: ["No named-customer outcomes — only anonymized aggregates", "Mechanism claim 'AI-driven' has zero process documentation grounding it", "Pricing claim grounded in 1 segment, not 3"]
  whatWouldUnlockNextTier: "3 named-customer outcomes from same vertical with monthly metric → moves usability from test to scale"
  proofCollectionPlan: ["Capture 3 case studies with named CMO + 90-day metric", "Document mechanism in 1-page process diagram with screenshots", "Extend pricing test to 2 additional segments before scale decision"]

WEAK (REJECTED): "Strategy lacks signal grounding."
STRONG (ACCEPTED):
  commercialUsability: "usable_for_learning_only"
  topTrustGaps: ["8 of 12 claims are narrative-only (no signal)", "Top objection 'is this safe' has zero proof artifact", "Awareness stage assumed not measured"]
  whatWouldUnlockNextTier: "Signal-backed ratio above 0.50 would move from learning_only to test — currently 0.33"
  proofCollectionPlan: ["Run 3-question survey to confirm awareness stage", "Collect 1 testimonial addressing safety", "Map 4 narrative claims to specific MI signals"]
═══`;

function buildDesignerPrompt(args: {
  validationState: string;
  evidenceStrength: number;
  signalBackedClaimRatio: number;
  signalBackedClaimCount: number;
  totalClaims: number;
  hypothesisCount: number;
  unmappedSignalCount: number;
  lowConfidenceSignalCount: number;
  reliabilityOverall: number;
  topAssumptionFlags: string[];
  topStructuralWarnings: string[];
  layerScores: Record<string, number>;
  judgeFeedback?: string;
}): string {
  const judge = args.judgeFeedback
    ? `\n═══ PRIOR ATTEMPT REJECTED ═══\nReason: ${args.judgeFeedback}\nRewrite with SPECIFIC referents from the data — no platitudes.\n`
    : "";
  return `You are a Validation Judgement Principal. Your job is NOT to relabel the validationState — it is to translate the data quality into a COMMERCIAL VERDICT a CMO would act on.

A weak system says: "claims are weak, treat as provisional."
A strong system says: "data is usable for learning only because [specific gaps]; here are the 3 trust gaps blocking scale; here is what proof collection would unlock the next tier."
${judge}
${FEW_SHOT}

═══ INPUT DATA ═══
Validation state: ${args.validationState}
Evidence strength: ${args.evidenceStrength.toFixed(3)}
Signal-backed claim ratio: ${args.signalBackedClaimRatio.toFixed(2)} (${args.signalBackedClaimCount}/${args.totalClaims})
Hypotheses (excluded from scoring): ${args.hypothesisCount}
Unmapped signals: ${args.unmappedSignalCount}
Low-confidence signals: ${args.lowConfidenceSignalCount}
Reliability overall: ${args.reliabilityOverall.toFixed(3)}
Layer scores: ${Object.entries(args.layerScores).map(([k,v]) => `${k}=${v.toFixed(2)}`).join(", ")}

Top assumption flags:
${args.topAssumptionFlags.slice(0, 6).map(f => `- ${f}`).join("\n") || "(none)"}

Top structural warnings:
${args.topStructuralWarnings.slice(0, 6).map(w => `- ${w}`).join("\n") || "(none)"}

═══ HARD RULES ═══
1. commercialUsability MUST follow the rubric:
   - "usable_for_scale": validated state + evidenceStrength≥0.70 + signalBackedRatio≥0.75
   - "usable_for_test": provisional state OR (validated with weaker grounding)
   - "usable_for_learning_only": weak state OR signalBackedRatio<0.50
   - "not_usable": rejected state OR boundary failure
2. topTrustGaps MUST cite SPECIFIC artifacts (named claim type, named missing signal). NEVER generic "low confidence".
3. whatWouldUnlockNextTier MUST be ONE concrete sentence naming the metric/artifact and the resulting tier shift.
4. proofCollectionPlan MUST be 3-5 ACTIONABLE proof-harvest steps, each with a specific deliverable.
5. If validationState is "rejected", commercialUsability MUST be "not_usable".

Return ONLY valid JSON:
{
  "commercialUsability": "usable_for_scale|usable_for_test|usable_for_learning_only|not_usable",
  "topTrustGaps": ["gap1", "gap2", "gap3"],
  "whatWouldUnlockNextTier": "<one concrete sentence>",
  "proofCollectionPlan": ["step1", "step2", "step3"],
  "reasoningSteps": ["Step 1: assessed state X because...", "Step 2: identified gap Y because..."]
}`;
}

function buildJudgePrompt(json: string): string {
  return `You are a hostile reviewer of a Validation Judgement.

═══ AUTOMATIC REJECTION ═══
- topTrustGaps are generic ("low evidence", "needs more data") instead of naming SPECIFIC artifacts
- whatWouldUnlockNextTier is vague ("collect more data") instead of named metric + tier shift
- proofCollectionPlan steps are abstract ("improve grounding") instead of concrete deliverables
- commercialUsability does NOT follow the rubric (e.g., rejected state but "usable_for_test")
- Any field reads like a textbook label rather than a CMO-grade verdict

═══ JUDGEMENT TO EVALUATE ═══
${json}

Return ONLY valid JSON:
{ "verdict": "ACCEPTED|REJECTED", "reason": "<brutal specific reason>", "specificFix": "<concrete change>" }`;
}

function safeJson(text: string): any {
  if (!text) return null;
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

function parseJudgement(parsed: any, model: string, retry: number): ValidationJudgement | null {
  if (!parsed || !parsed.commercialUsability) return null;
  const u = String(parsed.commercialUsability);
  const validUsability = ["usable_for_scale", "usable_for_test", "usable_for_learning_only", "not_usable"];
  if (!validUsability.includes(u)) return null;
  return {
    validationState: "provisional",
    evidenceStrength: 0,
    signalBackedClaimRatio: 0,
    commercialUsability: u as any,
    topTrustGaps: Array.isArray(parsed.topTrustGaps) ? parsed.topTrustGaps.map(String).slice(0, 6) : [],
    whatWouldUnlockNextTier: String(parsed.whatWouldUnlockNextTier || "").trim(),
    proofCollectionPlan: Array.isArray(parsed.proofCollectionPlan) ? parsed.proofCollectionPlan.map(String).slice(0, 6) : [],
    reasoningSteps: Array.isArray(parsed.reasoningSteps) ? parsed.reasoningSteps.map(String) : [],
    judgeVerdict: "NOT_RUN",
    retryCount: retry,
    modelUsed: model,
    generatedAt: new Date().toISOString(),
  };
}

export async function designValidationJudgement(args: {
  validationState: "validated" | "provisional" | "weak" | "rejected";
  evidenceStrength: number;
  signalBackedClaimRatio: number;
  signalBackedClaimCount: number;
  totalClaims: number;
  hypothesisCount: number;
  unmappedSignalCount: number;
  lowConfidenceSignalCount: number;
  reliabilityOverall: number;
  topAssumptionFlags: string[];
  topStructuralWarnings: string[];
  layerScores: Record<string, number>;
  accountId: string;
}): Promise<ValidationJudgement | null> {
  const start = Date.now();
  const MODEL = "gpt-4.1-mini";

  if (args.totalClaims === 0 && args.unmappedSignalCount === 0) {
    console.log("[ValidationJudgement] SKIPPED — no claims or signals to judge");
    return null;
  }

  console.log(`[ValidationJudgement] STEP_1 | designing | state=${args.validationState} | evidence=${args.evidenceStrength.toFixed(2)} | sbRatio=${args.signalBackedClaimRatio.toFixed(2)}`);

  let prompt = buildDesignerPrompt(args);
  let raw = "";
  try {
    const r = await aiChat({ model: MODEL, messages: [{ role: "user", content: prompt }], temperature: 0.3, max_tokens: 1200, endpoint: "statval-judgement", accountId: args.accountId });
    raw = r.choices[0]?.message?.content?.trim() || "";
  } catch (err: any) {
    console.error(`[ValidationJudgement] DESIGN_FAILED | ${err.message}`);
    return null;
  }

  let parsed = safeJson(raw);
  let j = parseJudgement(parsed, MODEL, 0);
  if (!j) { console.error(`[ValidationJudgement] PARSE_FAILED | raw=${raw.slice(0,200)}`); return null; }

  j.validationState = args.validationState;
  j.evidenceStrength = args.evidenceStrength;
  j.signalBackedClaimRatio = args.signalBackedClaimRatio;

  console.log(`[ValidationJudgement] STEP_2 | v1 | usability=${j.commercialUsability} | gaps=${j.topTrustGaps.length}`);

  let verdict: "ACCEPTED" | "REJECTED" = "ACCEPTED";
  let reason = ""; let fix = "";
  try {
    const jr = await aiChat({ model: MODEL, messages: [{ role: "user", content: buildJudgePrompt(JSON.stringify(j, null, 2)) }], temperature: 0.1, max_tokens: 400, endpoint: "statval-judgement-judge", accountId: args.accountId });
    const jp = safeJson(jr.choices[0]?.message?.content?.trim() || "");
    if (jp) { verdict = jp.verdict === "REJECTED" ? "REJECTED" : "ACCEPTED"; reason = String(jp.reason || ""); fix = String(jp.specificFix || ""); }
  } catch (err: any) { console.warn(`[ValidationJudgement] JUDGE_FAILED | ${err.message} | accept v1`); }

  console.log(`[ValidationJudgement] STEP_3 | judge=${verdict}${reason ? ` | "${reason.slice(0, 80)}"` : ""}`);

  if (verdict === "REJECTED" && (reason || fix)) {
    const fb = [reason, fix].filter(Boolean).join(" — ");
    console.log(`[ValidationJudgement] STEP_4 | retry`);
    try {
      const r2 = await aiChat({ model: MODEL, messages: [{ role: "user", content: buildDesignerPrompt({ ...args, judgeFeedback: fb }) }], temperature: 0.3, max_tokens: 1200, endpoint: "statval-judgement-retry", accountId: args.accountId });
      const j2 = parseJudgement(safeJson(r2.choices[0]?.message?.content?.trim() || ""), MODEL, 1);
      if (j2) {
        j2.validationState = args.validationState;
        j2.evidenceStrength = args.evidenceStrength;
        j2.signalBackedClaimRatio = args.signalBackedClaimRatio;
        j = j2;
        try {
          const jr2 = await aiChat({ model: MODEL, messages: [{ role: "user", content: buildJudgePrompt(JSON.stringify(j, null, 2)) }], temperature: 0.1, max_tokens: 400, endpoint: "statval-judgement-judge-retry", accountId: args.accountId });
          const jp2 = safeJson(jr2.choices[0]?.message?.content?.trim() || "");
          if (jp2) { verdict = jp2.verdict === "REJECTED" ? "REJECTED" : "ACCEPTED"; reason = String(jp2.reason || ""); }
        } catch {}
      }
    } catch (err: any) { console.warn(`[ValidationJudgement] RETRY_FAILED | ${err.message}`); }
  }

  j.judgeVerdict = verdict; j.judgeReason = reason || undefined;
  console.log(`[ValidationJudgement] DONE in ${Date.now() - start}ms | verdict=${verdict} | retries=${j.retryCount}`);
  if (verdict === "REJECTED") { console.warn(`[ValidationJudgement] FINAL_REJECTED — falling back`); return null; }
  return j;
}
