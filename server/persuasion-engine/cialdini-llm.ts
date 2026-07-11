import { aiChat } from "../ai-client";
import { acknowledgeAelInput, applyPartialAelDowngrade } from "../analytical-enrichment-layer/consumer-guard";
import { checkGroundingContract } from "../shared/grounding-contract";
import type { CialdiniReasoning, CialdiniPrinciple, TrustTransferDesign } from "./types";

const PRINCIPLES: CialdiniPrinciple[] = [
  "reciprocity",
  "commitment_consistency",
  "social_proof",
  "authority",
  "liking",
  "scarcity",
  "unity",
];

function extractRootCauses(ael: any): Array<{ id: string; description: string }> {
  if (!ael) return [];
  const out: Array<{ id: string; description: string }> = [];
  const arrays: any[][] = [];
  if (Array.isArray(ael.rootCauses)) arrays.push(ael.rootCauses);
  if (Array.isArray(ael.root_causes)) arrays.push(ael.root_causes);
  if (Array.isArray(ael.causalChains)) arrays.push(ael.causalChains);
  for (const arr of arrays) {
    for (const item of arr) {
      if (!item) continue;
      const id = String(item.id || item.rootCauseId || `RC${out.length + 1}`);
      const desc = String(item.description || item.statement || item.rootCause || item.cause || "").trim();
      if (desc) out.push({ id, description: desc.slice(0, 200) });
    }
  }
  return out.slice(0, 6);
}

function buildPrompt(args: {
  rootCauses: Array<{ id: string; description: string }>;
  objectionStatements: string[];
  trustBarriers: string[];
  audienceSegmentDescriptions: string[];
  sophisticationTier: number | null;
  awarenessStage: string;
  marketDiagnosis: string | null;
  enemyDefinition: string | null;
  trustRequirement: string;
  rejectedClaimPatterns: string[];
  trustTransferDesign?: TrustTransferDesign;
}): string {
  const rcBlock = args.rootCauses.length ? args.rootCauses.map(rc => `${rc.id}: ${rc.description}`).join("\n") : "(none)";
  const objBlock = args.objectionStatements.slice(0, 8).map((o, i) => `[OBJ${i + 1}] ${o}`).join("\n") || "(none)";
  const trustBlock = args.trustBarriers.slice(0, 6).map((t, i) => `[TRUST${i + 1}] ${t}`).join("\n") || "(none)";
  const segBlock = args.audienceSegmentDescriptions.slice(0, 4).map((s, i) => `[SEG${i + 1}] ${s}`).join("\n") || "(none)";
  const rejectedBlock = args.rejectedClaimPatterns.length ? args.rejectedClaimPatterns.slice(0, 6).map(r => `- ${r}`).join("\n") : "(none)";

  const ttBlock = args.trustTransferDesign
    ? `\n═══ UPSTREAM TRUST-TRANSFER DESIGN (you MUST ground in this) ═══
Buyer risk state: ${args.trustTransferDesign.buyerRiskState}
Risk severity: ${args.trustTransferDesign.riskSeverity}
Trust deficit: ${args.trustTransferDesign.trustDeficit}
Designed transfer mechanism: ${args.trustTransferDesign.transferMechanism.name}
  description: ${args.trustTransferDesign.transferMechanism.description}
  proof artifact: ${args.trustTransferDesign.transferMechanism.proofArtifact}
Required proof shape: ${args.trustTransferDesign.requiredProofShape}
Commercial function: ${args.trustTransferDesign.commercialFunction}
Failure modes already ruled out by upstream design:
${args.trustTransferDesign.failureModes.map(f => `  - ${f.mechanism}: ${f.whyItWouldFail}`).join("\n")}

GROUNDING RULE: The Cialdini principle you pick MUST be the natural label for the trust mechanism above. If the mechanism is "Named-CMO peer outcomes from same vertical", the principle is social_proof. If it is "Founder credentials + institutional endorsement", it is authority. If it is "Reframe scarcity as buyer's own quarterly budget", it is scarcity. The trust mechanism is the master; you are NAMING it, not re-deciding it.
═══`
    : "";

  return `You are a Buyer-Psychology Strategist (Cialdini-trained).
Pick the ONE Cialdini principle that gives this market the highest probability of conversion, and prove WHY.${ttBlock}

═══ AUDIENCE PSYCHOLOGY ═══
Sophistication tier: ${args.sophisticationTier ?? "unknown"} (1=naive, 5=saturated/burnt)
Awareness stage: ${args.awarenessStage}
Market diagnosis: ${args.marketDiagnosis || "not specified"}
Enemy: ${args.enemyDefinition || "not specified"}
Trust requirement: ${args.trustRequirement}

Segments:
${segBlock}

═══ ROOT CAUSES (Analytical Enrichment Layer) ═══
${rcBlock}

═══ OBJECTIONS ═══
${objBlock}

═══ TRUST BARRIERS ═══
${trustBlock}

═══ CLAIMS ALREADY REJECTED BY THIS AUDIENCE ═══
${rejectedBlock}

═══ THE 7 PRINCIPLES ═══
- reciprocity: give value first, buyer feels obliged
- commitment_consistency: get small yes, escalate to bigger commitment
- social_proof: show that "people like me" already chose this
- authority: credentialed expertise, evidence-based dominance
- liking: similarity, warmth, in-group identification
- scarcity: real limits on availability or window
- unity: shared identity / "we are one of you" framing

═══ HARD RULES ═══
1. Pick exactly ONE primaryCialdiniPrinciple.
2. principleRationale MUST cite [OBJ#], [TRUST#], [SEG#], or RC# evidence.
3. For SATURATED audiences (tier 4-5): scarcity and naive social-proof usually fail — explain why if you pick them.
4. whyOthersFail must list at least 4 of the OTHER 6 principles with concrete reasons (not generic).
5. buyerPsychologyFit must answer: "What does the buyer's lizard brain need to hear, and why does this principle satisfy it?"
6. Do not pick a principle that triggers any rejected claim pattern above.
7. Return ONLY valid JSON.

Return JSON:
{
  "primaryCialdiniPrinciple": "reciprocity|commitment_consistency|social_proof|authority|liking|scarcity|unity",
  "principleRationale": "<2-3 sentences citing [OBJ#]/[TRUST#]/[SEG#]/RC#>",
  "buyerPsychologyFit": "<2-3 sentences on the lizard-brain need this satisfies>",
  "whyOthersFail": [
    { "principle": "<other principle>", "whyItWouldFail": "<concrete reason for THIS audience>" }
  ],
  "groundedSignals": ["[OBJ2] quote", "RC3"],
  "rootCauseRefs": ["RC1", "RC3"],
  "groundingRefs": ["RC1"],
  "reasoningSteps": [
    "Step 1: scored each principle against tier ${args.sophisticationTier ?? "?"} ...",
    "Step 2: eliminated <principle> because <evidence> ...",
    "Step 3: chose <principle> because <evidence> ...",
    "Step 4: validated against rejected claim patterns ..."
  ]
}`;
}

function safeJsonParse(text: string): any {
  if (!text) return null;
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

function normalizePrinciple(v: any): CialdiniPrinciple {
  const s = String(v || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (PRINCIPLES.includes(s as CialdiniPrinciple)) return s as CialdiniPrinciple;
  if (s.startsWith("commitment")) return "commitment_consistency";
  if (s.startsWith("social")) return "social_proof";
  return "authority";
}

export async function pickCialdiniPrinciple(args: {
  analyticalEnrichment: any;
  objectionStatements: string[];
  trustBarriers: string[];
  audienceSegmentDescriptions: string[];
  sophisticationTier: number | null;
  awarenessStage: string;
  marketDiagnosis: string | null;
  enemyDefinition: string | null;
  trustRequirement: string;
  rejectedClaimPatterns: string[];
  accountId: string;
  trustTransferDesign?: TrustTransferDesign;
  // Anchor doctrine (criteria A + F): pre-rendered doctrine/DNA anchor block
  // computed ONCE by the parent persuasion engine and threaded down.
  doctrineBlock?: string | null;
  anchorSource?: "doctrine" | "dna" | "none";
  // GROUNDING CONTRACT (RULES 1-3): pre-rendered block built ONCE by the parent
  // (which owns the ProductAnchor) and threaded down. Additive; the existing
  // gates remain the sole enforcement authority.
  groundingContractBlock?: string | null;
}): Promise<CialdiniReasoning | null> {
  const startTs = Date.now();
  const aelAck = acknowledgeAelInput("PersuasionCialdini", args.analyticalEnrichment, args.accountId);
  if (args.objectionStatements.length === 0 && args.trustBarriers.length === 0) {
    console.log("[PersuasionCialdini] SKIPPED — no objections or trust barriers to ground decision");
    return null;
  }

  const rootCauses = extractRootCauses(args.analyticalEnrichment);
  console.log(`[PersuasionCialdini] STEP_1 | invoking LLM | rootCauses=${rootCauses.length} | objections=${args.objectionStatements.length} | trustBarriers=${args.trustBarriers.length} | tier=${args.sophisticationTier ?? "?"} | stage=${args.awarenessStage}`);

  const prompt = buildPrompt({ ...args, rootCauses });
  // Explicit if/else source classification — no semantic-fallback chains (D1).
  let cdAnchorSource: "doctrine" | "dna" | "none" = "none";
  if (args.anchorSource === "doctrine") cdAnchorSource = "doctrine";
  else if (args.anchorSource === "dna") cdAnchorSource = "dna";
  const cdAnchorPresent = args.doctrineBlock && args.doctrineBlock.length > 0;
  const cdGroundingBlock = args.groundingContractBlock && args.groundingContractBlock.length > 0 ? `${args.groundingContractBlock}\n\n` : "";
  console.log(`[PersuasionCialdini] ANCHOR_EVIDENCE | engine=persuasion_cialdini | site=first_prompt | attempt=1 | present=${cdAnchorPresent ? "yes" : "no"} | source=${cdAnchorSource}`);
  const finalPrompt = `${cdAnchorPresent ? `${args.doctrineBlock}\n\n` : ""}${cdGroundingBlock}${prompt}`;
  let response;
  try {
    response = await aiChat({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: finalPrompt }],
      temperature: 0.25,
      max_tokens: 1200,
      endpoint: "persuasion-engine-cialdini",
      accountId: args.accountId,
    });
  } catch (err: any) {
    console.error(`[PersuasionCialdini] LLM_FAILED | ${err.message}`);
    return null;
  }

  const raw = response.choices[0]?.message?.content?.trim() || "";
  const parsed = safeJsonParse(raw);
  if (!parsed || !parsed.primaryCialdiniPrinciple) {
    console.error(`[PersuasionCialdini] PARSE_FAILED | raw=${raw.slice(0, 200)}`);
    return null;
  }

  const result: CialdiniReasoning = {
    primaryCialdiniPrinciple: normalizePrinciple(parsed.primaryCialdiniPrinciple),
    principleRationale: String(parsed.principleRationale || "").trim(),
    buyerPsychologyFit: String(parsed.buyerPsychologyFit || "").trim(),
    whyOthersFail: Array.isArray(parsed.whyOthersFail)
      ? parsed.whyOthersFail
          .map((w: any) => ({
            principle: normalizePrinciple(w.principle),
            whyItWouldFail: String(w.whyItWouldFail || "").trim(),
          }))
          .filter((w: any) => w.whyItWouldFail.length > 0)
      : [],
    groundedSignals: Array.isArray(parsed.groundedSignals) ? parsed.groundedSignals.map(String) : [],
    rootCauseRefs: Array.isArray(parsed.rootCauseRefs) ? parsed.rootCauseRefs.map(String) : [],
    reasoningSteps: Array.isArray(parsed.reasoningSteps) ? parsed.reasoningSteps.map(String) : [],
    audienceSophisticationTier: args.sophisticationTier ?? undefined,
    modelUsed: "gpt-4.1-mini",
    generatedAt: new Date().toISOString(),
  };
  applyPartialAelDowngrade("PersuasionCialdini", result, aelAck);

  const cdGroundingRefs: string[] = Array.isArray(parsed.groundingRefs) ? parsed.groundingRefs.map(String) : [];
  checkGroundingContract({
    engine: "persuasion_cialdini",
    site: "primary_principle",
    groundingRefs: cdGroundingRefs,
    ael: args.analyticalEnrichment,
    accountId: args.accountId,
  });

  console.log(`[PersuasionCialdini] STEP_2 | parsed | principle=${result.primaryCialdiniPrinciple} | rcRefs=${result.rootCauseRefs.join(",") || "(none)"} | whyOthersFail=${result.whyOthersFail.length}`);
  console.log(`[PersuasionCialdini] STEP_3 | DONE in ${Date.now() - startTs}ms`);
  return result;
}
