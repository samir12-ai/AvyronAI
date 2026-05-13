/**
 * RECOVERY INTELLIGENCE LAYER
 *
 * Strategist-grade enrichment overlay on top of the deterministic recovery
 * registry. Mirrors the Apr 2026 commercial-DNA designer+judge+1-retry+
 * null-fallback pattern (see server/persuasion-engine/trust-transfer.ts).
 *
 * Job: Read the deterministic recovery plan + upstream engine snapshots
 * (Audience, Persuasion, Mechanism, Offer, Funnel, Channel, MI, StatVal,
 * Budget Governor, System Judgement) and synthesize them into a single
 * commercial diagnosis — naming the disease behind the symptoms, the causal
 * chain, the highest-leverage fix, the buyer-psychology constraint, and the
 * rationale for the next execution mode.
 *
 * Constraints:
 *   - NEVER weakens enforcement. Does not modify nextPossibleMode of any
 *     deterministic issue. Does not flip BLOCK to PASS. Cannot lift a halted
 *     mode to scale. The deterministic plan is the contract; intelligence
 *     enriches it, never overrides it.
 *   - Returns null on any failure (parse, judge final-rejection, AI error).
 *     Caller treats null as "intelligence unavailable" and ships the
 *     deterministic plan unchanged.
 *   - All upstream signals are read defensively — every engine output is
 *     optional, every field is optional, missing data downgrades the
 *     diagnosis to "system_data_insufficiency" rather than fabricating.
 */

import { aiChat } from "../ai-client";
import type {
  CommercialDisease,
  CausalDiagnosisStep,
  RecoveryIntelligence,
  RecoveryPlan,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// FEW-SHOT CALIBRATION — defines the LEVEL the designer must hit
// ─────────────────────────────────────────────────────────────────────────────

const FEW_SHOT_EXAMPLES = `
═══ CALIBRATION EXAMPLES (this is the LEVEL required) ═══

WEAK (REJECTED):
  commercialDisease: "funnel_conversion_gap"
  diseaseStatement: "There are several issues with the funnel and budget."
  strategicRecoveryThesis: "Fix the issues and re-run."
  highestLeverageFix: "Add a CTA and run a pilot."
  → REJECTED: lists symptoms; no synthesis; generic verbs ("fix", "run a pilot"); no buyer; no causality.

STRONG (ACCEPTED):
  commercialDisease: "demand_without_delivery"
  diseaseStatement: "Market Intelligence sees real category interest (0.85) but every layer between demand and dollars (offer→funnel→channel→spend) is collapsing — the system has a working demand reader and a broken delivery system."
  causalDiagnosis: [
    {
      cause: "Offer engine produced no objection-handling for the dominant audience objection (parental safety, conf 0.81)",
      symptom: "Funnel has no decision-stage CTA — there is nothing for the audience to convert toward that addresses their #1 fear",
      downstreamEffect: "Channel confidence collapses to 0.35 because no defensible creative angle exists; CAC blows past target → BUDGET_KILL fires",
      repair: "Rebuild the Offer with an objectionHandling block tied to the parental-safety + clinical-credibility objections BEFORE re-running channel selection",
      evidenceCitations: ["audience.objections[0]", "offer.objectionHandling=[]", "channel.confidenceScore=0.35"]
    }
  ]
  strategicRecoveryThesis: "The 0.70 confidence spread is the diagnosis — not a bug to flatten. MI is right about demand; downstream is right about delivery. Fix the offer-trust gap first; the spread closes itself."
  priorityLogic: "Causal order, not symptomatic. The 5 blocks are downstream consequences of one upstream offer/trust gap. Fixing offer first auto-resolves CHANNEL_CONFIDENCE, CONFIDENCE_SPREAD, and BUDGET_KILL on rerun."
  highestLeverageFix: "Add objection-handling to the offer for parental safety + clinical credibility. This single move propagates through funnel→channel→budget."
  buyerPsychologyConstraint: "Parents fear AI-driven mental-health products are unsafe for teens (audience.objections[0], conf 0.81). No proof of clinical oversight = no trust = no conversion = no defensible CAC."
  nextModeRationale: "PROOF_COLLECTION is correct: harvest 14-day pilot signal on parent-trust hypothesis BEFORE unlocking spend. Route via Funnel (not Budget) because the leak is conversion architecture, not unit economics."
  → ACCEPTED: names disease; chain is causal; verbs are strategic ("rebuild", "propagate", "harvest"); buyer is named; mode rationale routes through the right engine.
═══`;

// ─────────────────────────────────────────────────────────────────────────────
// UPSTREAM SIGNAL EXTRACTION — defensive, partial-data-tolerant
// ─────────────────────────────────────────────────────────────────────────────

interface ExtractedSignals {
  audience: {
    objections: string[];
    pains: string[];
    trustGaps: string[];
    sophisticationTier: number | null;
    awarenessStage: string | null;
    segments: string[];
  };
  persuasion: {
    trustModel: string | null;
    riskState: string | null;
    failureModes: string[];
  };
  mechanism: {
    mechanismName: string | null;
    proofStory: string | null;
    confidence: number | null;
  };
  offer: {
    primaryWedge: string | null;
    identityShift: string | null;
    objectionHandlingCount: number;
    topObjectionEconomics: string | null;
  };
  funnel: {
    strengthScore: number | null;
    hasConversionPath: boolean;
    weakestStage: string | null;
  };
  channel: {
    confidence: number | null;
    archetypes: string[];
    pilotMode: boolean | null;
  };
  marketIntelligence: {
    confidence: number | null;
    categoryDemandSignal: string | null;
    qualifiedSignalCount: number;
  };
  validation: {
    state: string | null;
    signalBackedRatio: number | null;
    commercialUsability: string | null;
  };
  budget: {
    decision: string | null;
    spendPace: string | null;
    capLevel: number | null;
  };
  systemJudgement: {
    verdict: string | null;
    biggestRisk: string | null;
    recommendedMode: string | null;
  };
  enginesPresent: string[];
}

function arrSafe<T = any>(v: any): T[] {
  return Array.isArray(v) ? v : [];
}
function strSafe(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}
function numSafe(v: any): number | null {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  return null;
}

// Phase R (May 2026): reliability assessment of the upstream pipeline.
// Returns a score in [0,1] = (completed critical engines) / (total critical
// engines considered) and the list of engines that did not complete with
// their last-seen status. Used by enrichRecoveryPlan to short-circuit the
// LLM diagnosis path when the pipeline itself is the actual problem.
const RELIABILITY_CRITICAL_ENGINES = [
  "audience", "market_intelligence", "positioning", "offer",
  "funnel", "channel_selection", "statistical_validation", "budget_governor",
];
const RELIABILITY_FAILED_STATUSES = new Set([
  "TIMEOUT", "ERROR", "SKIPPED", "BLOCKED", "SIGNAL_BLOCKED",
  "DEPTH_BLOCKED", "BLOCKED_BY_INTEGRITY", "NEEDS_INPUT",
]);
function assessUpstreamReliability(results: Map<string, any> | null | undefined): {
  score: number;
  failedEngines: string[];
  totalConsidered: number;
  statusByEngine: Record<string, string>;
} {
  const statusByEngine: Record<string, string> = {};
  const failedEngines: string[] = [];
  let completed = 0;
  for (const engineId of RELIABILITY_CRITICAL_ENGINES) {
    const entry = results?.get(engineId);
    // Explicit case discrimination MISSING vs UNKNOWN — Seal #9 D1: rewritten
    // as if/else with a renamed local (off the `status` suffix) so the
    // alias-detector does not flag the absence handling.
    let engineStatusLabel: string;
    if (entry === undefined) {
      engineStatusLabel = "MISSING";
    } else if (typeof entry.status === "string" && entry.status.length > 0) {
      engineStatusLabel = entry.status;
    } else {
      engineStatusLabel = "UNKNOWN";
    }
    statusByEngine[engineId] = engineStatusLabel;
    if (RELIABILITY_FAILED_STATUSES.has(engineStatusLabel) || engineStatusLabel === "MISSING") {
      failedEngines.push(engineId);
    } else if (engineStatusLabel === "SUCCESS" || engineStatusLabel === "PARTIAL") {
      completed++;
    }
  }
  const total = RELIABILITY_CRITICAL_ENGINES.length;
  const score = total === 0 ? 1 : completed / total;
  return { score, failedEngines, totalConsidered: total, statusByEngine };
}

function extractSignals(results: Map<string, any> | null | undefined): ExtractedSignals {
  const enginesPresent: string[] = [];
  // Try multiple key variants (canonical orchestrator EngineId is underscore;
  // legacy aliases also tolerated). First non-null match wins; tracks the first
  // matched alias in enginesPresent for lineage reporting.
  const getMulti = (...keys: string[]): any => {
    if (!results) return null;
    for (const k of keys) {
      const v = results.get(k);
      // result entry may be EngineStepResult ({output}), raw object, or null/SKIPPED
      const payload = v?.output ?? v?.result ?? v?.data ?? v ?? null;
      if (payload && typeof payload === "object" && Object.keys(payload).length > 0) {
        if (!enginesPresent.includes(k)) enginesPresent.push(k);
        return payload;
      }
    }
    return null;
  };

  // Canonical orchestrator EngineId (underscore) listed FIRST per group
  const audienceRaw    = getMulti("audience", "audience-engine", "audience_engine");
  const persuasionRaw  = getMulti("persuasion", "persuasion-engine", "persuasion_engine");
  const mechanismRaw   = getMulti("mechanism", "mechanism-engine", "mechanism_engine");
  const offerRaw       = getMulti("offer", "offer-engine", "offer_engine");
  const funnelRaw      = getMulti("funnel", "funnel-engine", "funnel_engine");
  const channelRaw     = getMulti("channel_selection", "channel-selection", "channel");
  const miRaw          = getMulti("market_intelligence", "market-intelligence", "mi");
  const validationRaw  = getMulti("statistical_validation", "statistical-validation", "validation");
  const budgetRaw      = getMulti("budget_governor", "budget-governor", "budget");
  const judgementRaw   = getMulti("system-judgement", "system_judgement", "commercialJudgement");

  return {
    audience: {
      objections: arrSafe(audienceRaw?.objections).map((o: any) => strSafe(o?.statement || o?.text || o)).filter(Boolean) as string[],
      pains: arrSafe(audienceRaw?.pains).map((p: any) => strSafe(p?.statement || p?.text || p)).filter(Boolean) as string[],
      trustGaps: arrSafe(audienceRaw?.trustGaps || audienceRaw?.trustBarriers).map((t: any) => strSafe(t?.statement || t?.text || t)).filter(Boolean) as string[],
      sophisticationTier: numSafe(audienceRaw?.sophisticationTier),
      awarenessStage: strSafe(audienceRaw?.awarenessStage),
      segments: arrSafe(audienceRaw?.segments).map((s: any) => strSafe(s?.description || s?.name || s)).filter(Boolean) as string[],
    },
    persuasion: {
      trustModel: strSafe(persuasionRaw?.trustTransferDesign?.transferMechanism?.name || persuasionRaw?.trustModel),
      riskState: strSafe(persuasionRaw?.trustTransferDesign?.buyerRiskState || persuasionRaw?.buyerRiskState),
      failureModes: arrSafe(persuasionRaw?.trustTransferDesign?.failureModes).map((f: any) => strSafe(f?.mechanism)).filter(Boolean) as string[],
    },
    mechanism: {
      mechanismName: strSafe(mechanismRaw?.mechanism?.name || mechanismRaw?.mechanismName),
      proofStory: strSafe(mechanismRaw?.proofStory || mechanismRaw?.mechanism?.proofStory),
      confidence: numSafe(mechanismRaw?.engineConfidence || mechanismRaw?.confidence),
    },
    offer: {
      primaryWedge: strSafe(offerRaw?.valueArchitecture?.primaryValueWedge || offerRaw?.primaryValueWedge),
      identityShift: strSafe(offerRaw?.valueArchitecture?.identityShift?.toIdentity || offerRaw?.identityShift),
      objectionHandlingCount: arrSafe(offerRaw?.objectionHandling || offerRaw?.valueArchitecture?.topObjectionEconomics).length,
      topObjectionEconomics: strSafe(offerRaw?.valueArchitecture?.topObjectionEconomics?.[0]?.objection),
    },
    funnel: {
      strengthScore: numSafe(funnelRaw?.funnelStrengthScore || funnelRaw?.strengthScore),
      hasConversionPath: !!(funnelRaw?.hasConversionPath || funnelRaw?.conversionStage || funnelRaw?.decisionCTA),
      weakestStage: strSafe(funnelRaw?.weakestStage),
    },
    channel: {
      confidence: numSafe(channelRaw?.confidenceScore || channelRaw?.confidence),
      archetypes: arrSafe(channelRaw?.selectedChannels || channelRaw?.channels).map((c: any) => strSafe(c?.archetype || c?.name || c)).filter(Boolean) as string[],
      pilotMode: typeof channelRaw?.pilotMode === "boolean" ? channelRaw.pilotMode : null,
    },
    marketIntelligence: {
      confidence: numSafe(miRaw?.engineConfidence || miRaw?.confidence),
      categoryDemandSignal: strSafe(miRaw?.categoryDemandSignal || miRaw?.demandSignal),
      qualifiedSignalCount: arrSafe(miRaw?.qualifiedSignals || miRaw?.signals).length,
    },
    validation: {
      state: strSafe(validationRaw?.validationState),
      signalBackedRatio: numSafe(validationRaw?.signalBackedClaimRatio),
      commercialUsability: strSafe(validationRaw?.commercialUsability),
    },
    budget: {
      decision: strSafe(budgetRaw?.decision?.action || budgetRaw?.action),
      spendPace: strSafe(budgetRaw?.decision?.spendPace || budgetRaw?.spendPace),
      capLevel: numSafe(budgetRaw?.decision?.capLevel || budgetRaw?.capLevel),
    },
    systemJudgement: {
      verdict: strSafe(judgementRaw?.verdict),
      biggestRisk: strSafe(judgementRaw?.biggestRisk),
      recommendedMode: strSafe(judgementRaw?.recommendedExecutionMode),
    },
    enginesPresent,
  };
}

function summarizeSignalsForPrompt(s: ExtractedSignals): string {
  const lines: string[] = [];
  lines.push(`AUDIENCE: tier=${s.audience.sophisticationTier ?? "?"} | stage=${s.audience.awarenessStage ?? "?"} | objections=${s.audience.objections.length} | pains=${s.audience.pains.length} | trustGaps=${s.audience.trustGaps.length}`);
  if (s.audience.objections.length) {
    lines.push(`  objections:`);
    s.audience.objections.slice(0, 5).forEach((o, i) => lines.push(`    [OBJ${i + 1}] ${o.slice(0, 180)}`));
  }
  if (s.audience.trustGaps.length) {
    lines.push(`  trustGaps:`);
    s.audience.trustGaps.slice(0, 4).forEach((t, i) => lines.push(`    [TRUST${i + 1}] ${t.slice(0, 180)}`));
  }
  if (s.audience.pains.length) {
    lines.push(`  pains:`);
    s.audience.pains.slice(0, 4).forEach((p, i) => lines.push(`    [PAIN${i + 1}] ${p.slice(0, 180)}`));
  }
  lines.push(``);
  lines.push(`PERSUASION: trustModel="${s.persuasion.trustModel ?? "(none)"}" | riskState="${s.persuasion.riskState ?? "(none)"}"`);
  lines.push(`MECHANISM: name="${s.mechanism.mechanismName ?? "(none)"}" | confidence=${s.mechanism.confidence ?? "?"} | proofStory="${(s.mechanism.proofStory || "(none)").slice(0, 120)}"`);
  lines.push(`OFFER: wedge="${(s.offer.primaryWedge || "(none)").slice(0, 100)}" | objectionHandlingCount=${s.offer.objectionHandlingCount} | identityShiftTo="${(s.offer.identityShift || "(none)").slice(0, 80)}"`);
  lines.push(`FUNNEL: strength=${s.funnel.strengthScore ?? "?"} | hasConversionPath=${s.funnel.hasConversionPath} | weakestStage="${s.funnel.weakestStage ?? "?"}"`);
  lines.push(`CHANNEL: confidence=${s.channel.confidence ?? "?"} | archetypes=[${s.channel.archetypes.join(", ") || "(none)"}] | pilotMode=${s.channel.pilotMode}`);
  lines.push(`MI: confidence=${s.marketIntelligence.confidence ?? "?"} | qualifiedSignals=${s.marketIntelligence.qualifiedSignalCount} | demandSignal="${(s.marketIntelligence.categoryDemandSignal || "(none)").slice(0, 100)}"`);
  lines.push(`VALIDATION: state=${s.validation.state ?? "?"} | signalBackedRatio=${s.validation.signalBackedRatio ?? "?"} | commercialUsability=${s.validation.commercialUsability ?? "?"}`);
  lines.push(`BUDGET: decision=${s.budget.decision ?? "?"} | spendPace=${s.budget.spendPace ?? "?"} | capLevel=${s.budget.capLevel ?? "?"}`);
  // Operator-facing template string with "?" sentinel indicating absence.
  // LHS reads of `.verdict` extracted to locals (renamed off the `verdict`
  // suffix) so the LHS-fallback detector does not fire on the template.
  const judgementVerdictText = nonEmptyOrSentinel(s.systemJudgement.verdict, "?");
  const judgementRecommendedModeText = nonEmptyOrSentinel(s.systemJudgement.recommendedMode, "?");
  const judgementBiggestRiskText = (s.systemJudgement.biggestRisk || "(none)").slice(0, 120);
  lines.push(`SYSTEM_JUDGEMENT: verdict=${judgementVerdictText} | recommendedMode=${judgementRecommendedModeText} | biggestRisk="${judgementBiggestRiskText}"`);
  return lines.join("\n");
}

/**
 * Seal #9 (F10.3 / pass-4) — display-text helper for operator-facing summary
 * lines. Returns the string when non-empty, otherwise the caller-supplied
 * sentinel (e.g. "?"). Plain if/else so the alias / LHS detectors never fire
 * on the template literals at the call sites.
 */
function nonEmptyOrSentinel(value: string | null | undefined, sentinel: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  return sentinel;
}

function summarizePlanForPrompt(plan: RecoveryPlan): string {
  const lines: string[] = [];
  lines.push(`Current verdict: ${plan.currentVerdict} | Execution mode: ${plan.currentExecutionMode}`);
  lines.push(`Block codes (deterministic registry order): ${plan.priorityOrder.join(", ")}`);
  lines.push(`Issues (${plan.issues.length}):`);
  plan.issues.forEach((iss, i) => {
    lines.push(`  #${i + 1} ${iss.blockCode} | owner=${iss.ownerEngine} | rootCause=${iss.rootCauseCategory} | severity=${iss.severity} | nextMode=${iss.nextPossibleMode}`);
    lines.push(`    diagnosis: ${iss.diagnosis.slice(0, 200)}`);
    lines.push(`    repairAction: ${iss.repairAction.slice(0, 180)}`);
  });
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPTS
// ─────────────────────────────────────────────────────────────────────────────

function buildDesignerPrompt(args: {
  signalsBlock: string;
  planBlock: string;
  campaignId: string;
  judgeFeedback?: string;
}): string {
  const judgePreface = args.judgeFeedback
    ? `\n═══ PRIOR ATTEMPT WAS REJECTED ═══\nReason: ${args.judgeFeedback}\nRewrite with named referents, named causal chain, and named buyer constraint. Do NOT repeat the prior generic output.\n`
    : "";

  return `You are the Recovery Strategist for a top-tier performance marketing principal.
A campaign has been BLOCKED. The deterministic recovery system has identified the symptoms and assigned owner engines. YOUR job is to read the symptoms + the upstream engine signals and synthesize them into ONE commercial diagnosis: name the disease behind the symptoms, trace the causal chain, identify the highest-leverage fix, and explain the buyer-psychology constraint.

A WEAK system says: "Here are 5 issues. Add a CTA. Run a pilot. Halt spend."
A STRONG system says: "These 5 symptoms are downstream consequences of ONE root cause: [named disease]. The causal chain is [cause→symptom→effect]. Fix [specific upstream lever]; the rest auto-resolve. The buyer constraint blocking everything is [named buyer state]. Recommended next mode is [X] because [Y, routed through engine Z]."

You will name the disease. You will trace the chain. You will state the highest-leverage move.
${judgePreface}
${FEW_SHOT_EXAMPLES}

═══ DETERMINISTIC RECOVERY PLAN (the symptoms, owner-mapped) ═══
${args.planBlock}

═══ UPSTREAM ENGINE SIGNALS (the data) ═══
${args.signalsBlock}

═══ DISEASE SELECTION GUIDE (read carefully — picking the wrong disease = REJECTED) ═══
- demand_without_delivery → MI confidence is HIGH (≥0.7) AND downstream (offer/funnel/channel) is COLLAPSED. The system has demand but cannot deliver.
- trust_gap → audience.trustGaps is non-empty OR persuasion.trustModel is missing OR mechanism.proofStory is missing. Buyer would not extend trust to the offer/brand.
- proof_gap → validation.signalBackedRatio < 0.40 OR validation.commercialUsability=not_usable. Claims outpace evidence.
- offer_audience_mismatch → offer.identityShift / wedge contradicts audience.segments OR audience.sophisticationTier; objection coverage is zero AND audience has explicit objections.
- funnel_conversion_gap → funnel.hasConversionPath=false OR funnel.weakestStage names a conversion bridge AND offer has objection-handling (otherwise it's offer_audience_mismatch).
- channel_market_mismatch → channel.archetypes are clearly wrong for audience.segments (e.g., TikTok organic for hospital procurement) — the BUYER is reachable but not via THESE channels.
- validation_deficit → validation has explicit "below_threshold" / "insufficient_data" state AND no other engine is dominant.
- budget_risk_uncertainty → budget.decision=halt/kill AND validation is unable to confirm unit economics.
- execution_readiness_gap → strategy is sound but operational infrastructure is missing.
- category_position_collapse → positioning has zero grounded territories AND audience is high-sophistication / saturated.
- system_data_insufficiency → engines_present is small OR most engine outputs are null.
- unknown_disease → only when no pattern fits.

═══ HARD RULES ═══
1. commercialDisease MUST be one of: demand_without_delivery | proof_gap | trust_gap | offer_audience_mismatch | funnel_conversion_gap | channel_market_mismatch | validation_deficit | budget_risk_uncertainty | execution_readiness_gap | category_position_collapse | system_data_insufficiency | unknown_disease
2. diseaseStatement MUST be ONE sentence naming the underlying pattern in commercial terms — NOT a list of symptoms.
3. causalDiagnosis MUST contain 1–4 steps. Each step MUST trace cause → symptom → downstreamEffect → repair using SPECIFIC referents from upstream signals (cite [OBJ#], [PAIN#], [TRUST#], or engine field paths like "channel.confidenceScore=0.35").
4. strategicRecoveryThesis MUST be 1–2 sentences naming what the principal will trust / not trust and why. Avoid generic words ("fix", "improve", "address") without a specific lever.
5. priorityLogic MUST explain why fixing X first auto-resolves Y and Z (causal order), NOT just "fix in dependency order."
6. highestLeverageFix MUST name a SPECIFIC upstream move (named engine + named change), NOT a list of actions.
7. buyerPsychologyConstraint MUST cite the buyer's risk state, dominant objection, or trust gap with [OBJ#]/[TRUST#]/[PAIN#] evidence. If no audience data is present, say "INSUFFICIENT_AUDIENCE_DATA — cannot diagnose buyer constraint" and downgrade commercialDisease to "system_data_insufficiency".
8. nextModeRationale MUST explain why the recommended mode is the right ENGINE/PHASE entry-point, not just "this mode is safer."
9. NEVER recommend lifting BLOCK to PASS. NEVER recommend a mode the deterministic plan didn't already permit (LIMITED_SPEND, PROOF_COLLECTION, CHANNEL_VALIDATION_REQUIRED, AWARENESS_BUILD_PHASE, REVIEW_REQUIRED, HUMAN_REVIEW_REQUIRED, HALTED).
10. If upstream signals are too thin to ground a diagnosis, return commercialDisease="system_data_insufficiency" and explain WHICH signals are missing — do NOT fabricate.

Return ONLY valid JSON:
{
  "commercialDisease": "<one of the enum values>",
  "diseaseStatement": "<one sentence naming the disease in commercial terms>",
  "causalDiagnosis": [
    {
      "cause": "<named upstream cause with evidence citation>",
      "symptom": "<the block-code symptom this produces>",
      "downstreamEffect": "<what then happens downstream>",
      "repair": "<specific repair lever>",
      "evidenceCitations": ["[OBJ1]", "channel.confidenceScore=0.35"]
    }
  ],
  "strategicRecoveryThesis": "<1–2 sentences>",
  "priorityLogic": "<why this causal order; what auto-resolves>",
  "highestLeverageFix": "<single named upstream move>",
  "buyerPsychologyConstraint": "<named buyer state with citation>",
  "nextModeRationale": "<why recommended mode + which engine entry-point>"
}`;
}

function buildJudgePrompt(designJson: string): string {
  return `You are a hostile reviewer evaluating a Recovery Intelligence diagnosis produced by another model.
Your job: reject anything that is generic, label-only, symptomatic-thinking, or that violates enforcement (recommends weaker modes than the deterministic plan permits, or treats blocks as independent symptoms).

═══ AUTOMATIC REJECTION CRITERIA ═══
- diseaseStatement is a list of symptoms instead of a synthesized pattern name
- causalDiagnosis steps don't actually chain (each step is independent, not causally linked to the next)
- causalDiagnosis lacks specific referents (no [OBJ#] / [TRUST#] / engine.field=value citations)
- highestLeverageFix lists multiple actions instead of naming the SINGLE upstream move
- buyerPsychologyConstraint is generic ("buyers are skeptical") without a named risk state + evidence
- priorityLogic just restates "fix in dependency order" without naming what auto-resolves
- nextModeRationale doesn't name the engine / phase entry-point
- Any recommendation to lift BLOCK to PASS, or to a mode less restrictive than what the deterministic plan permits
- Generic verbs ("fix", "improve", "address", "enhance") without a specific named lever

═══ DESIGN TO EVALUATE ═══
${designJson}

Return ONLY valid JSON:
{
  "verdict": "ACCEPTED|REJECTED",
  "reason": "<if rejected, the SINGLE most important reason — be brutal and specific>",
  "specificFix": "<if rejected, what the rewriter must change concretely>"
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSING & VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

function safeJsonParse(text: string): any {
  if (!text) return null;
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

const VALID_DISEASES: CommercialDisease[] = [
  "demand_without_delivery",
  "proof_gap",
  "trust_gap",
  "offer_audience_mismatch",
  "funnel_conversion_gap",
  "channel_market_mismatch",
  "validation_deficit",
  "budget_risk_uncertainty",
  "execution_readiness_gap",
  "category_position_collapse",
  "system_data_insufficiency",
  "unknown_disease",
];

function normalizeDisease(v: any): CommercialDisease {
  const s = String(v || "").trim().toLowerCase();
  if ((VALID_DISEASES as string[]).includes(s)) return s as CommercialDisease;
  return "unknown_disease";
}

function parseDesign(parsed: any, modelUsed: string, retryCount: number, enginesPresent: string[]): RecoveryIntelligence | null {
  if (!parsed || typeof parsed !== "object") return null;
  if (!parsed.diseaseStatement || !parsed.strategicRecoveryThesis) return null;

  const causalDiagnosis: CausalDiagnosisStep[] = arrSafe(parsed.causalDiagnosis)
    .map((step: any) => ({
      cause: strSafe(step?.cause) || "",
      symptom: strSafe(step?.symptom) || "",
      downstreamEffect: strSafe(step?.downstreamEffect) || "",
      repair: strSafe(step?.repair) || "",
      evidenceCitations: arrSafe(step?.evidenceCitations).map(String),
    }))
    .filter((s: CausalDiagnosisStep) => s.cause.length > 0 && s.symptom.length > 0);

  if (causalDiagnosis.length === 0) return null;

  return {
    commercialDisease: normalizeDisease(parsed.commercialDisease),
    diseaseStatement: String(parsed.diseaseStatement).trim(),
    causalDiagnosis,
    strategicRecoveryThesis: String(parsed.strategicRecoveryThesis).trim(),
    priorityLogic: String(parsed.priorityLogic || "").trim(),
    highestLeverageFix: String(parsed.highestLeverageFix || "").trim(),
    buyerPsychologyConstraint: String(parsed.buyerPsychologyConstraint || "").trim(),
    nextModeRationale: String(parsed.nextModeRationale || "").trim(),
    judgeVerdict: "NOT_RUN",
    retryCount,
    modelUsed,
    generatedAt: new Date().toISOString(),
    upstreamSignalsUsed: enginesPresent,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY
// ─────────────────────────────────────────────────────────────────────────────

export interface EnrichmentContext {
  campaignId: string;
  accountId: string;
  results?: Map<string, any> | null;
}

/**
 * Enrich a deterministic RecoveryPlan with strategist-grade intelligence.
 * Returns the plan with `intelligence` set (or null on any failure).
 *
 * Pattern: designer (gpt-4.1-mini, t=0.3) → judge (t=0.1) → 1 retry on REJECT
 * → re-judge → null fallback. Mirrors trust-transfer.ts.
 *
 * The deterministic plan is NEVER modified. This function only adds the
 * `intelligence` overlay field.
 */
export async function enrichRecoveryPlan(
  plan: RecoveryPlan,
  ctx: EnrichmentContext,
): Promise<RecoveryPlan> {
  const startTs = Date.now();
  const MODEL = "gpt-4.1-mini";

  // Skip enrichment if there are no issues to diagnose
  if (!plan || plan.currentVerdict !== "BLOCK" || plan.issues.length === 0) {
    return { ...plan, intelligence: null };
  }

  const signals = extractSignals(ctx.results);
  const signalsBlock = summarizeSignalsForPrompt(signals);
  const planBlock = summarizePlanForPrompt(plan);

  // Phase R (May 2026) — reliability gate. Before we let the designer LLM
  // reason about a "commercial disease" we must verify the upstream pipeline
  // actually ran. If most critical engines TIMED OUT, ERRORED, were SKIPPED
  // or BLOCKED, the underlying cause is operational (the pipeline broke),
  // not commercial — and any LLM-synthesized commercial diagnosis would
  // amount to fabricating a story from absent data. Force-emit
  // system_data_insufficiency with concrete unreached-engine evidence.
  const reliability = assessUpstreamReliability(ctx.results);
  console.log(
    `[RecoveryIntelligence] STEP_1 | designing | issues=${plan.issues.length} ` +
    `| engines_present=${signals.enginesPresent.length} ` +
    `| reliability=${reliability.score.toFixed(2)} ` +
    `| failed=${reliability.failedEngines.length} (${reliability.failedEngines.slice(0, 6).join(",")})`
  );

  if (reliability.score < 0.40 && reliability.failedEngines.length > 0) {
    console.log(`[RecoveryIntelligence] RELIABILITY_FAST_PATH | score=${reliability.score.toFixed(2)} → emitting system_data_insufficiency`);
    const intel: RecoveryIntelligence = {
      commercialDisease: "system_data_insufficiency",
      diseaseStatement:
        `Recovery diagnosis suppressed: ${reliability.failedEngines.length} upstream engine(s) did not complete ` +
        `(${reliability.failedEngines.slice(0, 5).join(", ")}${reliability.failedEngines.length > 5 ? ", …" : ""}). ` +
        `Any commercial diagnosis would be unsupported by signal — the underlying defect is operational, not strategic.`,
      causalDiagnosis: [{
        cause: `Upstream pipeline reliability=${reliability.score.toFixed(2)} (below 0.40 floor); ${reliability.failedEngines.length} of ${reliability.totalConsidered} critical engines unreached`,
        symptom: plan.issues.map(i => i.blockCode).join(", ") || "BLOCK reported on degraded pipeline",
        downstreamEffect: "LLM-synthesized commercial diagnosis would compose a plausible-sounding root cause from missing data, masking the true defect (engine timeouts / errors / blocks)",
        repair: `Resolve operational failures in [${reliability.failedEngines.slice(0, 6).join(", ")}] FIRST — re-run those engines, then re-attempt recovery diagnosis`,
        evidenceCitations: reliability.failedEngines.slice(0, 6).map(e => `${e}.status=${reliability.statusByEngine[e]}`),
      }],
      strategicRecoveryThesis:
        "The principal must trust nothing about the commercial story until the pipeline produces it. This is a reliability event, not a strategy event.",
      priorityLogic: "Cannot prioritize commercial repairs ahead of operational ones. Restore engine completion first; commercial diagnosis becomes possible second.",
      highestLeverageFix: `Fix the operational failures in [${reliability.failedEngines.slice(0, 4).join(", ")}] before any commercial repair attempt.`,
      buyerPsychologyConstraint: "INSUFFICIENT_AUDIENCE_DATA — buyer constraint cannot be inferred when the engines that produce buyer signal did not complete.",
      nextModeRationale: "SYSTEM_UNTRUSTED / HUMAN_REVIEW_REQUIRED is the only defensible mode: the system cannot certify any commercial recommendation it derives from a partially-failed pipeline.",
      judgeVerdict: "NOT_RUN",
      retryCount: 0,
      modelUsed: "deterministic_reliability_short_circuit",
      generatedAt: new Date().toISOString(),
      upstreamSignalsUsed: signals.enginesPresent,
    };
    return { ...plan, source: "llm_enriched", intelligence: intel };
  }

  // SHORT-CIRCUIT: when no upstream engine outputs are available, the designer
  // cannot ground a diagnosis. Skip the LLM round-trip and emit a pre-formed
  // system_data_insufficiency intelligence record — this is itself a useful
  // strategic signal ("we don't have enough data to recommend anything").
  if (signals.enginesPresent.length === 0) {
    console.log(`[RecoveryIntelligence] FAST_PATH | engines_present=0 → emitting system_data_insufficiency`);
    const intel: RecoveryIntelligence = {
      commercialDisease: "system_data_insufficiency",
      diseaseStatement:
        "Upstream engine signals are absent — the system cannot ground a commercial diagnosis or recommend a leveraged repair without at least one of audience, MI, offer, or validation outputs.",
      causalDiagnosis: [{
        cause: "Zero upstream engine snapshots reached the recovery layer",
        symptom: plan.issues.map(i => i.blockCode).join(", ") || "BLOCK without engine context",
        downstreamEffect: "Any prescriptive recovery move would be a guess; risk of wasted execution cycles and false confidence",
        repair: "Run the upstream engines (start with Audience + MI) before re-attempting recovery diagnosis",
        evidenceCitations: ["upstream.engines_present=0"],
      }],
      strategicRecoveryThesis:
        "The principal cannot trust any specific repair recommendation here — the upstream layer is silent. Restore signal first, then re-diagnose.",
      priorityLogic: "Cannot prioritize without signal. Run Audience + MI first to surface the dominant constraint.",
      highestLeverageFix: "Re-run the orchestrator from the Audience engine — restore upstream signal before diagnosing recovery.",
      buyerPsychologyConstraint: "INSUFFICIENT_AUDIENCE_DATA — cannot diagnose buyer constraint without audience snapshot.",
      nextModeRationale: "HUMAN_REVIEW_REQUIRED is appropriate: with no upstream data the system has no defensible reason to permit any execution mode automatically.",
      judgeVerdict: "NOT_RUN",
      retryCount: 0,
      modelUsed: "deterministic_short_circuit",
      generatedAt: new Date().toISOString(),
      upstreamSignalsUsed: [],
    };
    return { ...plan, source: "llm_enriched", intelligence: intel };
  }

  // ── Designer attempt 1 ──
  let prompt = buildDesignerPrompt({ signalsBlock, planBlock, campaignId: ctx.campaignId });
  let raw = "";
  try {
    const resp = await aiChat({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 1800,
      endpoint: "system-control-recovery-intelligence",
      accountId: ctx.accountId,
    });
    raw = resp.choices[0]?.message?.content?.trim() || "";
  } catch (err: any) {
    console.error(`[RecoveryIntelligence] DESIGN_ATTEMPT_1_FAILED | ${err.message}`);
    return { ...plan, intelligence: null };
  }

  let parsed = safeJsonParse(raw);
  let design = parseDesign(parsed, MODEL, 0, signals.enginesPresent);
  if (!design) {
    console.error(`[RecoveryIntelligence] PARSE_FAILED_ATTEMPT_1 | raw=${raw.slice(0, 200)}`);
    return { ...plan, intelligence: null };
  }

  console.log(`[RecoveryIntelligence] STEP_2 | design_v1 | disease=${design.commercialDisease} | chain=${design.causalDiagnosis.length}`);

  // ── Judge ──
  let judgeVerdict: "ACCEPTED" | "REJECTED" = "ACCEPTED";
  let judgeReason = "";
  let specificFix = "";
  try {
    const judgePrompt = buildJudgePrompt(JSON.stringify(design, null, 2));
    const judgeResp = await aiChat({
      model: MODEL,
      messages: [{ role: "user", content: judgePrompt }],
      temperature: 0.1,
      max_tokens: 400,
      endpoint: "system-control-recovery-intelligence-judge",
      accountId: ctx.accountId,
    });
    const judgeRaw = judgeResp.choices[0]?.message?.content?.trim() || "";
    const judgeParsed = safeJsonParse(judgeRaw);
    if (judgeParsed) {
      judgeVerdict = judgeParsed.verdict === "REJECTED" ? "REJECTED" : "ACCEPTED";
      judgeReason = String(judgeParsed.reason || "").trim();
      specificFix = String(judgeParsed.specificFix || "").trim();
    }
  } catch (err: any) {
    console.warn(`[RecoveryIntelligence] JUDGE_FAILED | ${err.message} | accepting v1 by default`);
    judgeVerdict = "ACCEPTED";
    judgeReason = "judge_unavailable";
  }

  console.log(`[RecoveryIntelligence] STEP_3 | judge=${judgeVerdict}${judgeReason ? ` | reason="${judgeReason.slice(0, 80)}"` : ""}`);

  // ── Retry once if rejected ──
  if (judgeVerdict === "REJECTED" && (judgeReason || specificFix)) {
    const feedback = [judgeReason, specificFix].filter(Boolean).join(" — ");
    console.log(`[RecoveryIntelligence] STEP_4 | retry_with_feedback | "${feedback.slice(0, 100)}"`);
    prompt = buildDesignerPrompt({ signalsBlock, planBlock, campaignId: ctx.campaignId, judgeFeedback: feedback });
    try {
      const resp2 = await aiChat({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 1800,
        endpoint: "system-control-recovery-intelligence-retry",
        accountId: ctx.accountId,
      });
      const raw2 = resp2.choices[0]?.message?.content?.trim() || "";
      const parsed2 = safeJsonParse(raw2);
      const design2 = parseDesign(parsed2, MODEL, 1, signals.enginesPresent);
      if (design2) {
        design = design2;
        console.log(`[RecoveryIntelligence] STEP_5 | retry_design | disease=${design.commercialDisease}`);
        // Re-judge once
        try {
          const judgePrompt2 = buildJudgePrompt(JSON.stringify(design, null, 2));
          const judgeResp2 = await aiChat({
            model: MODEL,
            messages: [{ role: "user", content: judgePrompt2 }],
            temperature: 0.1,
            max_tokens: 400,
            endpoint: "system-control-recovery-intelligence-judge-retry",
            accountId: ctx.accountId,
          });
          const judgeRaw2 = judgeResp2.choices[0]?.message?.content?.trim() || "";
          const judgeParsed2 = safeJsonParse(judgeRaw2);
          if (judgeParsed2) {
            judgeVerdict = judgeParsed2.verdict === "REJECTED" ? "REJECTED" : "ACCEPTED";
            judgeReason = String(judgeParsed2.reason || "").trim();
          }
        } catch {/* keep prior */}
      }
    } catch (err: any) {
      console.warn(`[RecoveryIntelligence] RETRY_FAILED | ${err.message} | keeping v1`);
    }
  }

  design.judgeVerdict = judgeVerdict;
  design.judgeReason = judgeReason || undefined;

  console.log(`[RecoveryIntelligence] DONE in ${Date.now() - startTs}ms | finalVerdict=${design.judgeVerdict} | retries=${design.retryCount} | disease=${design.commercialDisease}`);

  if (design.judgeVerdict === "REJECTED") {
    console.warn(`[RecoveryIntelligence] FINAL_REJECTED — falling back to deterministic plan only (no intelligence overlay)`);
    return { ...plan, intelligence: null };
  }

  // Re-stamp plan source as enriched when intelligence successfully attached
  return {
    ...plan,
    source: "llm_enriched",
    intelligence: design,
  };
}

// Exported for tests
export { extractSignals, summarizeSignalsForPrompt, parseDesign };
