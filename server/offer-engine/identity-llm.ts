import { deriveValidatedCapabilities } from "../shared/capability-registry";
import { aiChat } from "../ai-client";
import { acknowledgeAelInput, applyPartialAelDowngrade } from "../analytical-enrichment-layer/consumer-guard";
import type { OfferIdentityReasoning } from "./types";
import type { ProductAnchor } from "../shared/strategic-doctrine";
import { buildGroundingContract, buildAelReferenceIndex, checkGroundingContract } from "../shared/grounding-contract";

function buildPrompt(args: {
  offerName: string;
  coreOutcome: string;
  mechanismDescription: string;
  enemyDefinition: string | null;
  contrastAxis: string | null;
  audiencePains: string[];
  audienceDesires: string[];
  audienceObjections: string[];
  sophisticationTier: number | null;
  rejectedClaimPatterns: string[];
  cialdiniPrinciple: string | null;
  cialdiniRationale: string | null;
  competitorEquivalentClaim: string | null;
  rootCauses: Array<{ id: string; description: string }>;
  productAnchor?: ProductAnchor | null;
  analyticalEnrichment?: any;
}): string {
  const painBlock = args.audiencePains.slice(0, 6).map((p, i) => `[PAIN${i + 1}] ${p}`).join("\n") || "(none)";
  const desireBlock = args.audienceDesires.slice(0, 6).map((d, i) => `[DES${i + 1}] ${d}`).join("\n") || "(none)";
  const objBlock = args.audienceObjections.slice(0, 6).map((o, i) => `[OBJ${i + 1}] ${o}`).join("\n") || "(none)";
  const rcBlock = args.rootCauses.length ? args.rootCauses.map(rc => `${rc.id}: ${rc.description}`).join("\n") : "(none)";
  const rejectedBlock = args.rejectedClaimPatterns.length ? args.rejectedClaimPatterns.slice(0, 6).map(r => `- ${r}`).join("\n") : "(none)";
  const aelRefIndex = buildAelReferenceIndex(args.analyticalEnrichment || null);
  const groundingContractBlock = buildGroundingContract(args.productAnchor || null, args.analyticalEnrichment || null, { capabilities: deriveValidatedCapabilities(args.productAnchor || null, null) });

  return `You are an Offer-Identity Strategist. Your job is to add the missing reasoning layer to a finished offer:
identity payoff, commercial reasoning, and value translation. You do NOT change the offer's mechanism or outcome.

═══ THE OFFER (do not change these) ═══
Name: ${args.offerName}
Core outcome: ${args.coreOutcome}
Mechanism: ${args.mechanismDescription}

═══ POSITIONING ═══
Enemy: ${args.enemyDefinition || "not specified"}
Contrast axis: ${args.contrastAxis || "not specified"}
Closest competitor's near-equivalent claim: ${args.competitorEquivalentClaim || "(none — open territory)"}

═══ AUDIENCE ═══
Sophistication tier: ${args.sophisticationTier ?? "unknown"} (1=naive, 5=saturated)
Pains:
${painBlock}
Desires:
${desireBlock}
Objections:
${objBlock}

═══ ROOT CAUSES (cite by id) ═══
${rcBlock}
${aelRefIndex}

═══ CHOSEN PERSUASION PRINCIPLE ═══
Principle: ${args.cialdiniPrinciple || "(not chosen)"}
Why it was chosen: ${args.cialdiniRationale || "(not provided)"}

═══ CLAIMS THE AUDIENCE HAS REJECTED — DO NOT ECHO THESE ═══
${rejectedBlock}
${groundingContractBlock}
═══ HARD RULES ═══
1. identityPayoff MUST start with "This is for the kind of person who ..." and describe the buyer's identity (not features).
2. commercialReasoning MUST explain the buyer's commercial situation in one paragraph: what their P&L / pipeline / scoreboard looks like and why this offer changes it.
3. valueTranslation MUST translate the emotional payoff into an economic statement (time saved, revenue gained, loss avoided), citing [PAIN#]/[DES#] or RC#.
4. rejectedAlternatives must list at least 2 alternative framings you considered and explain why they were rejected (cite evidence).
5. NO marketing jargon: no "transform", "unlock", "scale", "leverage", "synergy", "next-level".
6. Do NOT contradict the chosen Cialdini principle.
7. Return ONLY valid JSON.

Return JSON:
{
  "identityPayoff": "This is for the kind of person who ...",
  "commercialReasoning": "<one paragraph on the buyer's commercial situation and how this offer changes it>",
  "valueTranslation": "<emotional → economic, citing [PAIN#]/[DES#] or RC#>",
  "groundedSignals": ["[PAIN2] quote", "RC1"],
  "reasoningSteps": [
    "Step 1: identified buyer identity from sophistication tier ${args.sophisticationTier ?? "?"} and pains ...",
    "Step 2: connected commercial situation to enemy '${args.enemyDefinition || "?"}' ...",
    "Step 3: translated emotional payoff to economic terms via [PAIN#]/[DES#] ...",
    "Step 4: rejected alternative framings A and B because ..."
  ],
  "rejectedAlternatives": [
    { "alternative": "<short framing>", "reasonRejected": "<evidence>" },
    { "alternative": "<short framing>", "reasonRejected": "<evidence>" }
  ],
  "groundingRefs": ["RC1"]
}`;
}

function safeJsonParse(text: string): any {
  if (!text) return null;
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

export async function generateOfferIdentityReasoning(args: {
  offerName: string;
  coreOutcome: string;
  mechanismDescription: string;
  enemyDefinition: string | null;
  contrastAxis: string | null;
  audiencePains: string[];
  audienceDesires: string[];
  audienceObjections: string[];
  sophisticationTier: number | null;
  rejectedClaimPatterns: string[];
  cialdiniPrinciple: string | null;
  cialdiniRationale: string | null;
  competitorEquivalentClaim: string | null;
  analyticalEnrichment: any;
  productAnchor?: ProductAnchor | null;
  anchorSource?: "doctrine" | "dna" | "none";
  accountId: string;
}): Promise<OfferIdentityReasoning | null> {
  const startTs = Date.now();
  const aelAck = acknowledgeAelInput("OfferIdentity", args.analyticalEnrichment, args.accountId);

  if (!args.coreOutcome || !args.mechanismDescription) {
    console.log("[OfferIdentity] SKIPPED — missing offer name/outcome/mechanism");
    return null;
  }

  const rootCauses: Array<{ id: string; description: string }> = [];
  const ael = args.analyticalEnrichment;
  if (ael) {
    const arrays: any[][] = [];
    if (Array.isArray(ael.rootCauses)) arrays.push(ael.rootCauses);
    if (Array.isArray(ael.root_causes)) arrays.push(ael.root_causes);
    for (const arr of arrays) {
      for (const item of arr) {
        if (!item) continue;
        const id = String(item.id || `RC${rootCauses.length + 1}`);
        const desc = String(item.description || item.statement || item.cause || "").trim();
        if (desc) rootCauses.push({ id, description: desc.slice(0, 200) });
      }
    }
  }

  console.log(`[OfferIdentity] STEP_1 | invoking LLM | offer="${args.offerName.slice(0, 60)}" | tier=${args.sophisticationTier ?? "?"} | cialdini=${args.cialdiniPrinciple ?? "?"} | rcs=${rootCauses.length}`);
  console.log(`[OfferIdentity] ANCHOR_EVIDENCE | engine=offer_identity | site=identity_reasoning | attempt=1 | present=${args.productAnchor ? "yes" : "no"} | source=${args.anchorSource ?? "none"}`);

  const prompt = buildPrompt({ ...args, rootCauses });
  let response;
  try {
    response = await aiChat({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 1100,
      endpoint: "offer-engine-identity",
      accountId: args.accountId,
    });
  } catch (err: any) {
    console.error(`[OfferIdentity] LLM_FAILED | ${err.message}`);
    return null;
  }

  const raw = response.choices[0]?.message?.content?.trim() || "";
  const parsed = safeJsonParse(raw);
  if (!parsed || !parsed.identityPayoff) {
    console.error(`[OfferIdentity] PARSE_FAILED | raw=${raw.slice(0, 200)}`);
    return null;
  }

  const result: OfferIdentityReasoning = {
    identityPayoff: String(parsed.identityPayoff || "").trim(),
    commercialReasoning: String(parsed.commercialReasoning || "").trim(),
    valueTranslation: String(parsed.valueTranslation || "").trim(),
    groundedSignals: Array.isArray(parsed.groundedSignals) ? parsed.groundedSignals.map(String) : [],
    reasoningSteps: Array.isArray(parsed.reasoningSteps) ? parsed.reasoningSteps.map(String) : [],
    rejectedAlternatives: Array.isArray(parsed.rejectedAlternatives)
      ? parsed.rejectedAlternatives.map((r: any) => ({
          alternative: String(r.alternative || "").trim(),
          reasonRejected: String(r.reasonRejected || "").trim(),
        }))
      : [],
    modelUsed: "gpt-4.1-mini",
    generatedAt: new Date().toISOString(),
    groundingRefs: Array.isArray(parsed.groundingRefs)
      ? parsed.groundingRefs.filter((r: any) => typeof r === "string" && r.trim().length > 0).map((r: string) => r.trim())
      : [],
  };
  applyPartialAelDowngrade("OfferIdentity", result, aelAck);
  checkGroundingContract({
    engine: "offer_identity",
    site: "identity_reasoning",
    groundingRefs: result.groundingRefs,
    ael: args.analyticalEnrichment || null,
    accountId: args.accountId,
  });

  console.log(`[OfferIdentity] STEP_2 | parsed | identityPayoff="${result.identityPayoff.slice(0, 100)}" | rejectedAlts=${result.rejectedAlternatives.length} | groundedSignals=${result.groundedSignals.length}`);
  console.log(`[OfferIdentity] STEP_3 | DONE in ${Date.now() - startTs}ms`);
  return result;
}
