import { aiChat } from "../ai-client";
import { acknowledgeAelInput, applyPartialAelDowngrade } from "../analytical-enrichment-layer/consumer-guard";
import { checkGroundingContract } from "../shared/grounding-contract";
import { evaluateClaimSemanticEntailment } from "../shared/claim-entailment";
import {
  type AuthoritativeCompetitorEvidenceContext,
  evaluateAwarenessComparativeClaims,
  repairContradictedMythBreaker,
} from "./competitor-evidence-guard";
import type { MythBreakerReasoning } from "./types";

interface RootCauseRef {
  id: string;
  description: string;
}

function extractRootCausesFromAEL(ael: any): RootCauseRef[] {
  if (!ael) return [];
  const candidates: RootCauseRef[] = [];
  const arrays: any[][] = [];
  if (Array.isArray(ael.rootCauses)) arrays.push(ael.rootCauses);
  if (Array.isArray(ael.root_causes)) arrays.push(ael.root_causes);
  if (Array.isArray(ael.causalChains)) arrays.push(ael.causalChains);
  if (Array.isArray(ael.causal_chains)) arrays.push(ael.causal_chains);
  for (const arr of arrays) {
    for (const item of arr) {
      if (!item) continue;
      const id = String(item.id || item.rootCauseId || item.rcId || `RC${candidates.length + 1}`);
      const desc = String(
        item.deepCause || item.description || item.statement ||
        item.rootCause || item.cause || item.surfaceSignal || "",
      ).trim();
      if (desc) candidates.push({ id, description: desc.slice(0, 240) });
    }
  }
  return candidates.slice(0, 8);
}

function formatTextItem(item: any): string {
  if (!item) return "";
  if (typeof item === "string") return item.trim();
  if (typeof item === "object") {
    const val = item.statement || item.canonical || item.belief || item.pain || item.objection || item.text || item.description || (Array.isArray(item.evidence) && item.evidence[0]) || "";
    if (typeof val === "string" && val.trim()) return val.trim();
    try {
      return JSON.stringify(item);
    } catch {
      return "";
    }
  }
  return String(item).trim();
}

function buildPrompt(args: {
  rootCauses: RootCauseRef[];
  audienceObjections: string[];
  audienceBeliefs: string[];
  audiencePains: string[];
  marketDiagnosis: string | null;
  enemyDefinition: string | null;
  contrastAxis: string | null;
  awarenessStage: string;
  sophisticationTier: number | null;
  rejectedClaimPatterns: string[];
  productTruthFacts?: string[];
  competitorEvidenceContext?: AuthoritativeCompetitorEvidenceContext | null;
}): string {
  const rcBlock = args.rootCauses.length
    ? args.rootCauses.map(rc => `${rc.id}: ${rc.description}`).join("\n")
    : "(no root causes — use audience pains instead)";
  const objBlock = args.audienceObjections.map(formatTextItem).filter(Boolean).slice(0, 8).map((o, i) => `[OBJ${i + 1}] ${o}`).join("\n") || "(none)";
  const beliefBlock = args.audienceBeliefs.map(formatTextItem).filter(Boolean).slice(0, 6).map((b, i) => `[BLF${i + 1}] ${b}`).join("\n") || "(none)";
  const painBlock = args.audiencePains.map(formatTextItem).filter(Boolean).slice(0, 8).map((p, i) => `[PAIN${i + 1}] ${p}`).join("\n") || "(none)";
  const rejectedBlock = args.rejectedClaimPatterns.length ? args.rejectedClaimPatterns.slice(0, 6).map(r => `- ${r}`).join("\n") : "(none observed)";
  const factsBlock = args.productTruthFacts && args.productTruthFacts.length > 0
    ? `\n═══ VERIFIED PRODUCT TRUTH FACTS (CANONICAL BOUNDARIES) ═══\n${args.productTruthFacts.map((f, i) => `[FACT${i + 1}] ${f}`).join("\n")}\n`
    : "";
  const compBlock = args.competitorEvidenceContext?.promptBlock
    ? `\n${args.competitorEvidenceContext.promptBlock}\n`
    : "";

  return `You are a Direct-Response Myth-Breaker writer.
Your job: pick ONE belief the audience holds, contradict it, and tie the contradiction to a specific root cause from the Analytical Enrichment Layer.${factsBlock}${compBlock}
═══ ROOT CAUSES (cite by id, e.g. RC1) ═══
${rcBlock}

═══ AUDIENCE BELIEFS / OBJECTIONS / PAINS ═══
Beliefs:
${beliefBlock}

Objections:
${objBlock}

Pains:
${painBlock}

═══ MARKET CONTEXT ═══
Diagnosis: ${args.marketDiagnosis || "not specified"}
Enemy: ${args.enemyDefinition || "not specified"}
Contrast Axis: ${args.contrastAxis || "not specified"}
Awareness stage: ${args.awarenessStage}
Sophistication tier: ${args.sophisticationTier ?? "unknown"} (1=naive, 5=saturated)

═══ CLAIMS THE AUDIENCE HAS ALREADY REJECTED — DO NOT REPEAT THESE ═══
${rejectedBlock}

═══ HARD RULES ═══
1. mythBreakerStatement MUST be a single sharp sentence that contradicts a real belief in this market.
2. beliefToContradict MUST be a paraphrase of an actual [BLF#], [OBJ#], or [PAIN#] item — not invented.
3. rootCauseContradicted MUST cite EXACTLY the RC# and the exact text from the list above. DO NOT invent, summarize, or redefine the root cause. If none of the root causes apply, use "RC_PAIN" and quote the [PAIN#] item.
4. The myth-breaker must NOT match any of the rejected claim patterns above.
5. contradictionLogic must explain in plain language: "The audience believes X because of Y. The actual root cause is Z, so the right answer is W."
6. No marketing jargon. No "transform", "unlock", "leverage", "scale", "optimize", "next-level".
7. Return ONLY valid JSON.
8. CAPABILITY & PRODUCT TRUTH BOUNDARY (ANTI-PAIN-INVERSION & HONEST COMPETITIVE SCOPE):
   - You MUST NOT invert audience pain points or desires into asserted product capabilities. Audience pains and desires are market perceptions; they are NOT product feature claims.
   - Do NOT assert unverified product attributes, materials, or guarantees (e.g. do NOT claim 'breathable', 'natural fibers', 'non-see-through', 'no layering required', 'fast shipping guaranteed', 'money-back guarantee', 'revision guarantees', 'multi-version preview selection', 'iterative editing controls', 'lifetime cloud hosting', 'permanent downloadable MP3 access', or guaranteed emotional outcomes like 'never generic' / 'ensuring emotional authenticity' unless explicitly stated in Verified Product Facts above).
   - Do NOT claim exclusive category capability such as "Only platforms like [Brand] can..." or "Only [Brand]..." when competitors share the core category capability.
   - Do NOT turn attributed customer complaints about specific competitors into universal statements that all competitors or "every alternative in the market" fail, and do NOT convert customer complaints about generic-sounding outputs or AEL hypotheses into factual claims about competitors' internal production workflows ("mass-produced automated prompt workflows", "template-bound music generation services produce..."). Always attribute customer complaints as customer-reported output perceptions on named competitors.
   - PAYMENT-TRIGGER FIDELITY: Never rewrite a conditional trial/gifting payment model (e.g., creating a trial song for free and paying when gifting) into a satisfaction-contingent payment policy ("pay only when satisfied", "only pay if satisfied") or unqualified "risk-free" guarantee unless explicitly stated in Verified Product Facts above.
   - Do NOT turn an existing business model (such as upfront package pricing) into an invented strategic sacrifice, and do NOT portray ordinary subscription models or upsells as deceptive traps without scoped evidence.
   - Distinguish recommendations about future messaging from factual descriptions of the business.
   - Frame the contradiction around verified strategic positioning and validated mechanism logic, never by fabricating physical or operational capabilities.

Return JSON:
{
  "mythBreakerStatement": "<one sharp sentence>",
  "beliefToContradict": "<the belief, in audience's own framing>",
  "rootCauseContradicted": "<Exact RC# and exact description text from the list above>",
  "rootCauseRefs": ["RC1", "RC4"],
  "groundingRefs": ["RC1"],
  "evidenceForBelief": ["[BLF#] or [OBJ#] or [PAIN#] quote"],
  "contradictionLogic": "<3-4 sentence walkthrough of the contradiction>",
  "reasoningSteps": [
    "Step 1: scanned beliefs/objections — strongest pattern was ...",
    "Step 2: matched to root cause RC# because ...",
    "Step 3: drafted contradiction that breaks the belief without repeating rejected patterns",
    "Step 4: tightened to one sentence"
  ]
}`;
}

function safeJsonParse(text: string): any {
  if (!text) return null;
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

export async function generateMythBreaker(args: {
  analyticalEnrichment: any;
  audienceObjections: string[];
  audienceBeliefs: string[];
  audiencePains: string[];
  marketDiagnosis: string | null;
  enemyDefinition: string | null;
  contrastAxis: string | null;
  awarenessStage: string;
  sophisticationTier: number | null;
  rejectedClaimPatterns: string[];
  accountId: string;
  doctrineBlock?: string | null;
  anchorSource?: "doctrine" | "dna" | "none";
  groundingContractBlock?: string | null;
  productTruthFacts?: string[];
  competitorEvidenceContext?: AuthoritativeCompetitorEvidenceContext | null;
}): Promise<MythBreakerReasoning | null> {
  const startTs = Date.now();
  const aelAck = acknowledgeAelInput("AwarenessMythBreaker", args.analyticalEnrichment, args.accountId);
  const rootCauses = extractRootCausesFromAEL(args.analyticalEnrichment);

  if (args.audienceObjections.length === 0 && args.audienceBeliefs.length === 0 && args.audiencePains.length === 0) {
    console.log("[AwarenessMythBreaker] SKIPPED — no audience evidence to contradict");
    return null;
  }

  console.log(`[AwarenessMythBreaker] STEP_1 | invoking LLM | rootCauses=${rootCauses.length} | objections=${args.audienceObjections.length} | beliefs=${args.audienceBeliefs.length} | pains=${args.audiencePains.length} | tier=${args.sophisticationTier ?? "?"}`);

  const prompt = buildPrompt({ ...args, rootCauses });
  // Explicit if/else source classification — no semantic-fallback chains (D1).
  let mbAnchorSource: "doctrine" | "dna" | "none" = "none";
  if (args.anchorSource === "doctrine") mbAnchorSource = "doctrine";
  else if (args.anchorSource === "dna") mbAnchorSource = "dna";
  const mbAnchorPresent = args.doctrineBlock && args.doctrineBlock.length > 0;
  const mbGroundingBlock = args.groundingContractBlock && args.groundingContractBlock.length > 0 ? `${args.groundingContractBlock}\n\n` : "";
  console.log(`[AwarenessMythBreaker] ANCHOR_EVIDENCE | engine=awareness_myth_breaker | site=first_prompt | attempt=1 | present=${mbAnchorPresent ? "yes" : "no"} | source=${mbAnchorSource}`);
  const finalPrompt = `${mbAnchorPresent ? `${args.doctrineBlock}\n\n` : ""}${mbGroundingBlock}${prompt}`;
  let response;
  try {
    response = await aiChat({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: finalPrompt }],
      temperature: 0.3,
      max_tokens: 900,
      endpoint: "awareness-engine-myth-breaker",
      accountId: args.accountId,
    });
  } catch (err: any) {
    console.error(`[AwarenessMythBreaker] LLM_FAILED | ${err.message}`);
    return null;
  }

  const raw = response.choices[0]?.message?.content?.trim() || "";
  const parsed = safeJsonParse(raw);
  if (!parsed || !parsed.mythBreakerStatement) {
    console.error(`[AwarenessMythBreaker] PARSE_FAILED | raw=${raw.slice(0, 200)}`);
    return null;
  }

  const result: MythBreakerReasoning = {
    mythBreakerStatement: String(parsed.mythBreakerStatement || "").trim(),
    beliefToContradict: String(parsed.beliefToContradict || "").trim(),
    rootCauseContradicted: String(parsed.rootCauseContradicted || "").trim(),
    rootCauseRefs: Array.isArray(parsed.rootCauseRefs) ? parsed.rootCauseRefs.map(String) : [],
    evidenceForBelief: Array.isArray(parsed.evidenceForBelief) ? parsed.evidenceForBelief.map(String) : [],
    contradictionLogic: String(parsed.contradictionLogic || "").trim(),
    reasoningSteps: Array.isArray(parsed.reasoningSteps) ? parsed.reasoningSteps.map(String) : [],
    modelUsed: "gpt-4.1-mini",
    generatedAt: new Date().toISOString(),
  };
  applyPartialAelDowngrade("AwarenessMythBreaker", result, aelAck);

  if (args.productTruthFacts && args.productTruthFacts.length > 0) {
    const combinedMb = [result.mythBreakerStatement, result.beliefToContradict, result.contradictionLogic].join(" ");
    const mbEntailment = evaluateClaimSemanticEntailment(combinedMb, args.productTruthFacts);
    if (!mbEntailment.entailed) {
      try {
        console.log(`[AwarenessMythBreaker] ENTAILMENT_REPAIR | Fixing unentailed claims in MythBreaker: ${mbEntailment.violations.join("; ")}`);
        const repairResp = await aiChat({
          model: "gpt-4.1-mini",
          temperature: 0.1,
          accountId: args.accountId,
          endpoint: "awareness-engine-myth-breaker-repair",
          response_format: { type: "json_object" },
          max_tokens: 500,
          messages: [
            {
              role: "system",
              content: `You are a Direct-Response Myth-Breaker Fact-Check Editor. Rewrite the JSON fields so they strictly match Verified Product Facts without any satisfaction-contingent payment claims ("pay only when satisfied"), unqualified "risk-free" claims, or unverified competitor internal workflow claims ("mass-produced automated prompt workflows", "template-bound services"). Attribute customer complaints as customer-reported output perceptions on named competitors, and preserve exact conditional payment triggers (such as creating a trial song for free and paying when gifting). Return ONLY JSON: {"mythBreakerStatement": "...", "beliefToContradict": "...", "contradictionLogic": "..."}`,
            },
            {
              role: "user",
              content: JSON.stringify({
                current: {
                  mythBreakerStatement: result.mythBreakerStatement,
                  beliefToContradict: result.beliefToContradict,
                  contradictionLogic: result.contradictionLogic,
                },
                violationsToFix: mbEntailment.violations,
                verifiedProductFacts: args.productTruthFacts,
              }),
            },
          ],
        });
        const repairedMb = safeJsonParse(repairResp.choices?.[0]?.message?.content || "");
        if (repairedMb?.mythBreakerStatement) {
          result.mythBreakerStatement = String(repairedMb.mythBreakerStatement).trim();
          if (repairedMb.beliefToContradict) result.beliefToContradict = String(repairedMb.beliefToContradict).trim();
          if (repairedMb.contradictionLogic) result.contradictionLogic = String(repairedMb.contradictionLogic).trim();
        }
      } catch (repErr: any) {
        console.warn(`[AwarenessMythBreaker] ENTAILMENT_REPAIR_FAILED: ${repErr.message}`);
      }
    }
  }

  if (args.competitorEvidenceContext) {
    const compEval = evaluateAwarenessComparativeClaims(result as any, args.competitorEvidenceContext);
    if (!compEval.passed) {
      console.log(`[AwarenessMythBreaker] COMPETITOR_EVIDENCE_REPAIR | version=${args.competitorEvidenceContext.evidenceVersionHash} | violations=${compEval.violations.map(v => v.code).join(",")}`);
      const repairedMb = repairContradictedMythBreaker(result as any, args.competitorEvidenceContext, compEval);
      result.mythBreakerStatement = repairedMb.mythBreakerStatement;
      result.beliefToContradict = repairedMb.beliefToContradict;
      result.contradictionLogic = repairedMb.contradictionLogic;
      if (Array.isArray(repairedMb.reasoningSteps)) {
        result.reasoningSteps = repairedMb.reasoningSteps;
      }
    }
  }

  const mbGroundingRefs: string[] = Array.isArray(parsed.groundingRefs) ? parsed.groundingRefs.map(String) : [];
  checkGroundingContract({
    engine: "awareness_myth_breaker",
    site: "first_prompt",
    groundingRefs: mbGroundingRefs,
    ael: args.analyticalEnrichment,
    accountId: args.accountId,
  });

  console.log(`[AwarenessMythBreaker] STEP_2 | parsed | mythBreaker="${result.mythBreakerStatement.slice(0, 100)}" | rcRefs=${result.rootCauseRefs.join(",") || "(none)"} | evidence=${result.evidenceForBelief.length}`);
  console.log(`[AwarenessMythBreaker] STEP_3 | DONE in ${Date.now() - startTs}ms`);
  return result;
}
