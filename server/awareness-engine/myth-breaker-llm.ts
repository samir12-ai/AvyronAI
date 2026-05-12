import { aiChat } from "../ai-client";
import { acknowledgeAelInput, applyPartialAelDowngrade } from "../analytical-enrichment-layer/consumer-guard";
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
  for (const arr of arrays) {
    for (const item of arr) {
      if (!item) continue;
      const id = String(item.id || item.rootCauseId || item.rcId || `RC${candidates.length + 1}`);
      const desc = String(item.description || item.statement || item.rootCause || item.cause || "").trim();
      if (desc) candidates.push({ id, description: desc.slice(0, 240) });
    }
  }
  return candidates.slice(0, 8);
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
}): string {
  const rcBlock = args.rootCauses.length
    ? args.rootCauses.map(rc => `${rc.id}: ${rc.description}`).join("\n")
    : "(no root causes — use audience pains instead)";
  const objBlock = args.audienceObjections.slice(0, 8).map((o, i) => `[OBJ${i + 1}] ${o}`).join("\n") || "(none)";
  const beliefBlock = args.audienceBeliefs.slice(0, 6).map((b, i) => `[BLF${i + 1}] ${b}`).join("\n") || "(none)";
  const painBlock = args.audiencePains.slice(0, 8).map((p, i) => `[PAIN${i + 1}] ${p}`).join("\n") || "(none)";
  const rejectedBlock = args.rejectedClaimPatterns.length ? args.rejectedClaimPatterns.slice(0, 6).map(r => `- ${r}`).join("\n") : "(none observed)";

  return `You are a Direct-Response Myth-Breaker writer.
Your job: pick ONE belief the audience holds, contradict it, and tie the contradiction to a specific root cause from the Analytical Enrichment Layer.

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
3. rootCauseContradicted MUST cite at least one RC# from the list above (e.g. "RC2: ..."). If none of the root causes apply, use "RC_PAIN" and ground in a [PAIN#] item.
4. The myth-breaker must NOT match any of the rejected claim patterns above.
5. contradictionLogic must explain in plain language: "The audience believes X because of Y. The actual root cause is Z, so the right answer is W."
6. No marketing jargon. No "transform", "unlock", "leverage", "scale", "optimize", "next-level".
7. Return ONLY valid JSON.

Return JSON:
{
  "mythBreakerStatement": "<one sharp sentence>",
  "beliefToContradict": "<the belief, in audience's own framing>",
  "rootCauseContradicted": "<RC# and short description>",
  "rootCauseRefs": ["RC1", "RC4"],
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
  let response;
  try {
    response = await aiChat({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
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

  console.log(`[AwarenessMythBreaker] STEP_2 | parsed | mythBreaker="${result.mythBreakerStatement.slice(0, 100)}" | rcRefs=${result.rootCauseRefs.join(",") || "(none)"} | evidence=${result.evidenceForBelief.length}`);
  console.log(`[AwarenessMythBreaker] STEP_3 | DONE in ${Date.now() - startTs}ms`);
  return result;
}
